package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	websocketGUID      = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	opcodeContinuation = 0x0
	opcodeText         = 0x1
	opcodeBinary       = 0x2
	opcodeClose        = 0x8
	opcodePing         = 0x9
	opcodePong         = 0xA
	maxFramePayload    = 64 * 1024 * 1024 // 64MiB cap to avoid unbounded allocations while supporting large frames
)

type proxyConfig struct {
	listenAddr string
	targetAddr string
	staticDir  string
}

type proxyServer struct {
	cfg        proxyConfig
	fileServer http.Handler
}

type wsConn struct {
	conn    net.Conn
	reader  *bufio.Reader
	writer  *bufio.Writer
	writeMu sync.Mutex
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func parsePort(raw string, fallback int) int {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 || value > 65535 {
		log.Fatalf("invalid port value %q", raw)
	}
	return value
}

func loadConfig() proxyConfig {
	listenHost := getenv("CMUX_VNC_PROXY_HOST", "0.0.0.0")
	listenPort := parsePort(getenv("CMUX_VNC_PROXY_PORT", "39380"), 39380)
	targetHost := getenv("CMUX_VNC_PROXY_TARGET_HOST", "127.0.0.1")
	targetPort := parsePort(getenv("CMUX_VNC_PROXY_TARGET_PORT", "5901"), 5901)
	staticDir := getenv("CMUX_VNC_PROXY_STATIC_DIR", "/usr/share/novnc")
	return proxyConfig{
		listenAddr: net.JoinHostPort(listenHost, strconv.Itoa(listenPort)),
		targetAddr: net.JoinHostPort(targetHost, strconv.Itoa(targetPort)),
		staticDir:  staticDir,
	}
}

func newProxyServer(cfg proxyConfig) (*proxyServer, error) {
	absDir, err := filepath.Abs(cfg.staticDir)
	if err != nil {
		return nil, fmt.Errorf("resolve static dir: %w", err)
	}
	info, err := os.Stat(absDir)
	if err != nil {
		return nil, fmt.Errorf("static dir %s: %w", absDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("static dir %s is not a directory", absDir)
	}

	fs := http.FileServer(http.Dir(absDir))
	return &proxyServer{
		cfg:        cfg,
		fileServer: fs,
	}, nil
}

func isWebSocketRequest(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	connectionHeader := strings.ToLower(r.Header.Get("Connection"))
	if !strings.Contains(connectionHeader, "upgrade") {
		return false
	}
	return true
}

func (p *proxyServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isWebSocketRequest(r) {
		p.handleWebSocket(w, r)
		return
	}
	// Serve the bundled noVNC assets for non-WebSocket requests.
	p.fileServer.ServeHTTP(w, r)
}

func computeAcceptKey(clientKey string) string {
	h := sha1.New()
	_, _ = h.Write([]byte(clientKey))
	_, _ = h.Write([]byte(websocketGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

func (p *proxyServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	version := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Version"))
	if version != "13" {
		w.Header().Set("Sec-WebSocket-Version", "13")
		http.Error(w, "Unsupported WebSocket version", http.StatusUpgradeRequired)
		return
	}

	clientKey := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if clientKey == "" {
		http.Error(w, "Missing Sec-WebSocket-Key", http.StatusBadRequest)
		return
	}

	backendConn, err := net.DialTimeout("tcp", p.cfg.targetAddr, 5*time.Second)
	if err != nil {
		log.Printf("failed to connect to backend %s: %v", p.cfg.targetAddr, err)
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		backendConn.Close()
		http.Error(w, "Hijacking not supported", http.StatusInternalServerError)
		return
	}

	clientConn, clientRW, err := hj.Hijack()
	if err != nil {
		backendConn.Close()
		http.Error(w, "Hijack failed", http.StatusInternalServerError)
		return
	}

	acceptKey := computeAcceptKey(clientKey)
	responseHeaders := []string{
		"HTTP/1.1 101 Switching Protocols",
		"Upgrade: websocket",
		"Connection: Upgrade",
		fmt.Sprintf("Sec-WebSocket-Accept: %s", acceptKey),
	}
	if protocol := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Protocol")); protocol != "" {
		responseHeaders = append(responseHeaders, fmt.Sprintf("Sec-WebSocket-Protocol: %s", protocol))
	}

	if _, err := clientRW.WriteString(strings.Join(responseHeaders, "\r\n") + "\r\n\r\n"); err != nil {
		backendConn.Close()
		clientConn.Close()
		return
	}
	if err := clientRW.Flush(); err != nil {
		backendConn.Close()
		clientConn.Close()
		return
	}

	ws := &wsConn{
		conn:   clientConn,
		reader: clientRW.Reader,
		writer: clientRW.Writer,
	}

	errCh := make(chan error, 2)

	go func() {
		errCh <- pipeWebSocketToTCP(ws, backendConn)
	}()

	go func() {
		errCh <- pipeTCPToWebSocket(ws, backendConn)
	}()

	// Wait for either direction to finish, then ensure both connections are closed.
	err = <-errCh
	if err != nil && !errors.Is(err, io.EOF) {
		log.Printf("VNC proxy connection ended with error: %v", err)
	}
	_ = backendConn.Close()
	_ = clientConn.Close()
	// Drain the other goroutine if it is still running.
	<-errCh
}

type wsFrame struct {
	fin     bool
	opcode  byte
	payload []byte
}

func (c *wsConn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	header := []byte{0x80 | (opcode & 0x0F)}
	payloadLen := len(payload)

	switch {
	case payloadLen <= 125:
		header = append(header, byte(payloadLen))
	case payloadLen <= 0xFFFF:
		header = append(header, 126, byte(payloadLen>>8), byte(payloadLen))
	default:
		if payloadLen > int(^uint64(0)>>1) {
			return fmt.Errorf("payload too large: %d", payloadLen)
		}
		header = append(header, 127)
		length := uint64(payloadLen)
		for i := 7; i >= 0; i-- {
			header = append(header, byte(length>>(uint(i)*8)))
		}
	}

	if _, err := c.writer.Write(header); err != nil {
		return err
	}
	if payloadLen > 0 {
		if _, err := c.writer.Write(payload); err != nil {
			return err
		}
	}
	return c.writer.Flush()
}

func (c *wsConn) readFrame() (wsFrame, error) {
	var frame wsFrame

	firstByte, err := c.reader.ReadByte()
	if err != nil {
		return frame, err
	}
	frame.fin = (firstByte & 0x80) != 0
	frame.opcode = firstByte & 0x0F
	if firstByte&0x70 != 0 {
		return frame, fmt.Errorf("received frame with unsupported RSV bits set")
	}

	secondByte, err := c.reader.ReadByte()
	if err != nil {
		return frame, err
	}
	isMasked := (secondByte & 0x80) != 0
	if !isMasked {
		return frame, fmt.Errorf("client frame missing mask bit")
	}

	payloadLenIndicator := int(secondByte & 0x7F)
	var payloadLen uint64

	switch payloadLenIndicator {
	case 126:
		var extended [2]byte
		if _, err := io.ReadFull(c.reader, extended[:]); err != nil {
			return frame, err
		}
		payloadLen = uint64(extended[0])<<8 | uint64(extended[1])
	case 127:
		var extended [8]byte
		if _, err := io.ReadFull(c.reader, extended[:]); err != nil {
			return frame, err
		}
		payloadLen = 0
		for i := 0; i < 8; i++ {
			payloadLen = payloadLen<<8 | uint64(extended[i])
		}
		if payloadLen > maxFramePayload {
			return frame, fmt.Errorf("payload too large: %d", payloadLen)
		}
	default:
		payloadLen = uint64(payloadLenIndicator)
	}

	if payloadLen > maxFramePayload {
		return frame, fmt.Errorf("payload too large: %d", payloadLen)
	}

	var maskKey [4]byte
	if _, err := io.ReadFull(c.reader, maskKey[:]); err != nil {
		return frame, err
	}

	if payloadLen > 0 {
		frame.payload = make([]byte, payloadLen)
		if _, err := io.ReadFull(c.reader, frame.payload); err != nil {
			return frame, err
		}
		for i := range frame.payload {
			frame.payload[i] ^= maskKey[i%4]
		}
	} else {
		frame.payload = nil
	}

	return frame, nil
}

func pipeWebSocketToTCP(ws *wsConn, backend net.Conn) error {
	for {
		frame, err := ws.readFrame()
		if err != nil {
			return err
		}
		switch frame.opcode {
		case opcodeBinary, opcodeContinuation, opcodeText:
			if len(frame.payload) > 0 {
				if _, err := backend.Write(frame.payload); err != nil {
					return err
				}
			}
		case opcodePing:
			if err := ws.writeFrame(opcodePong, frame.payload); err != nil {
				return err
			}
		case opcodePong:
			// No action required.
		case opcodeClose:
			if err := ws.writeFrame(opcodeClose, frame.payload); err != nil {
				return err
			}
			return io.EOF
		default:
			return fmt.Errorf("unsupported opcode: %d", frame.opcode)
		}
	}
}

func pipeTCPToWebSocket(ws *wsConn, backend net.Conn) error {
	buf := make([]byte, 32*1024)
	for {
		n, err := backend.Read(buf)
		if n > 0 {
			if err := ws.writeFrame(opcodeBinary, buf[:n]); err != nil {
				return err
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				// Send a close frame to notify the WebSocket client.
				_ = ws.writeFrame(opcodeClose, []byte{0x03, 0xE8})
			}
			return err
		}
	}
}

func run(cfg proxyConfig) error {
	server, err := newProxyServer(cfg)
	if err != nil {
		return err
	}

	httpServer := &http.Server{
		Addr:              cfg.listenAddr,
		Handler:           server,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       0,
		ReadTimeout:       0,
		WriteTimeout:      0,
	}

	log.Printf("cmux VNC proxy listening on %s -> %s (serving %s)", cfg.listenAddr, cfg.targetAddr, server.cfg.staticDir)
	return httpServer.ListenAndServe()
}

func main() {
	listenFlag := flag.String("listen", "", "optional override for listen address (host:port)")
	targetFlag := flag.String("target", "", "optional override for target address (host:port)")
	staticFlag := flag.String("static", "", "optional override for static directory")
	flag.Parse()

	cfg := loadConfig()
	if *listenFlag != "" {
		cfg.listenAddr = *listenFlag
	}
	if *targetFlag != "" {
		cfg.targetAddr = *targetFlag
	}
	if *staticFlag != "" {
		cfg.staticDir = *staticFlag
	}

	if err := run(cfg); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server exited: %v", err)
	}
}
