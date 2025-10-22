package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func createStaticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "vnc.html"), []byte("<html>ok</html>"), 0o644); err != nil {
		t.Fatalf("write vnc.html: %v", err)
	}
	return dir
}

func startTestProxy(t *testing.T, cfg proxyConfig) (string, func()) {
	t.Helper()
	server, err := newProxyServer(cfg)
	if err != nil {
		t.Fatalf("newProxyServer: %v", err)
	}
	listener, err := net.Listen("tcp", cfg.listenAddr)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	httpServer := &http.Server{Handler: server}
	go func() {
		_ = httpServer.Serve(listener)
	}()

	shutdown := func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	}

	return listener.Addr().String(), shutdown
}

func TestProxyHandshakeAndDataFlow(t *testing.T) {
	staticDir := createStaticDir(t)
	backend, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("backend listen: %v", err)
	}
	defer backend.Close()

	cfg := proxyConfig{
		listenAddr: "127.0.0.1:0",
		targetAddr: backend.Addr().String(),
		staticDir:  staticDir,
	}

	addr, shutdown := startTestProxy(t, cfg)
	defer shutdown()

	backendConnCh := make(chan net.Conn, 1)
	go func() {
		conn, acceptErr := backend.Accept()
		if acceptErr != nil {
			return
		}
		backendConnCh <- conn
	}()

	client, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatalf("client dial: %v", err)
	}
	defer client.Close()

	hostHeader := addr
	if !strings.Contains(hostHeader, ":") {
		hostHeader += ":80"
	}

	key := "dGhlIHNhbXBsZSBub25jZQ=="
	handshake := fmt.Sprintf(
		"GET /websockify HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n\r\n",
		hostHeader,
		key,
	)
	if _, err := client.Write([]byte(handshake)); err != nil {
		t.Fatalf("write handshake: %v", err)
	}

	reader := bufio.NewReader(client)
	status, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	if !strings.Contains(status, "101") {
		t.Fatalf("expected 101 Switching Protocols, got %q", status)
	}

	headers := map[string]string{}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read header: %v", err)
		}
		if line == "\r\n" {
			break
		}
		parts := strings.SplitN(strings.TrimRight(line, "\r\n"), ":", 2)
		if len(parts) != 2 {
			continue
		}
		headers[strings.ToLower(strings.TrimSpace(parts[0]))] = strings.TrimSpace(parts[1])
	}

	expectedAccept := computeAcceptKey(key)
	if got := headers["sec-websocket-accept"]; got != expectedAccept {
		t.Fatalf("unexpected Sec-WebSocket-Accept: got %q want %q", got, expectedAccept)
	}

	var backendConn net.Conn
	select {
	case backendConn = <-backendConnCh:
	case <-time.After(time.Second):
		t.Fatal("backend connection not established")
	}
	defer backendConn.Close()

	clientPayload := []byte{0x01, 0x02, 0x03, 0x04}
	if _, err := client.Write(buildClientFrame(opcodeBinary, clientPayload)); err != nil {
		t.Fatalf("send client frame: %v", err)
	}

	received := make([]byte, len(clientPayload))
	if _, err := io.ReadFull(backendConn, received); err != nil {
		t.Fatalf("backend read: %v", err)
	}
	if !bytes.Equal(received, clientPayload) {
		t.Fatalf("backend payload mismatch: got %v want %v", received, clientPayload)
	}

	serverPayload := []byte{0xAA, 0xBB, 0xCC}
	if _, err := backendConn.Write(serverPayload); err != nil {
		t.Fatalf("backend write: %v", err)
	}

	frame := readServerFrame(t, reader)
	if frame.opcode != opcodeBinary {
		t.Fatalf("expected binary opcode, got %d", frame.opcode)
	}
	if !bytes.Equal(frame.payload, serverPayload) {
		t.Fatalf("client payload mismatch: got %v want %v", frame.payload, serverPayload)
	}

	if _, err := client.Write(buildClientCloseFrame()); err != nil {
		t.Fatalf("send close frame: %v", err)
	}

	closeFrame := readServerFrame(t, reader)
	if closeFrame.opcode != opcodeClose {
		t.Fatalf("expected close opcode, got %d", closeFrame.opcode)
	}

	_ = backendConn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, err := backendConn.Read(make([]byte, 1)); err == nil {
		t.Fatal("expected backend connection to close")
	}
}

func TestStaticFileServing(t *testing.T) {
	staticDir := createStaticDir(t)
	cfg := proxyConfig{
		listenAddr: "127.0.0.1:0",
		targetAddr: "127.0.0.1:59399", // no backend listener required for static test
		staticDir:  staticDir,
	}

	addr, shutdown := startTestProxy(t, cfg)
	defer shutdown()

	url := fmt.Sprintf("http://%s/vnc.html", addr)
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("http get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !bytes.Contains(body, []byte("ok")) {
		t.Fatalf("unexpected body: %q", body)
	}
}

func buildClientFrame(opcode byte, payload []byte) []byte {
	mask := [4]byte{0x11, 0x22, 0x33, 0x44}
	frame := []byte{0x80 | (opcode & 0x0F)}
	payloadLen := len(payload)
	switch {
	case payloadLen <= 125:
		frame = append(frame, 0x80|byte(payloadLen))
	case payloadLen <= 0xFFFF:
		frame = append(frame, 0x80|126, byte(payloadLen>>8), byte(payloadLen))
	default:
		length := uint64(payloadLen)
		frame = append(frame, 0x80|127)
		for i := 7; i >= 0; i-- {
			frame = append(frame, byte(length>>(uint(i)*8)))
		}
	}
	frame = append(frame, mask[:]...)
	for i, b := range payload {
		frame = append(frame, b^mask[i%4])
	}
	return frame
}

func buildClientCloseFrame() []byte {
	payload := []byte{0x03, 0xE8}
	return buildClientFrame(opcodeClose, payload)
}

func readServerFrame(t *testing.T, reader *bufio.Reader) wsFrame {
	t.Helper()
	first, err := reader.ReadByte()
	if err != nil {
		t.Fatalf("read first byte: %v", err)
	}
	if first&0x80 == 0 {
		t.Fatalf("expected FIN bit set, got %02x", first)
	}
	opcode := first & 0x0F

	second, err := reader.ReadByte()
	if err != nil {
		t.Fatalf("read second byte: %v", err)
	}
	if second&0x80 != 0 {
		t.Fatalf("server frames must not be masked, got %02x", second)
	}
	payloadLen := int(second & 0x7F)
	switch payloadLen {
	case 126:
		b1, err := reader.ReadByte()
		if err != nil {
			t.Fatalf("read ext len 1: %v", err)
		}
		b2, err := reader.ReadByte()
		if err != nil {
			t.Fatalf("read ext len 2: %v", err)
		}
		payloadLen = int(b1)<<8 | int(b2)
	case 127:
		payloadLen = 0
		for i := 0; i < 8; i++ {
			b, err := reader.ReadByte()
			if err != nil {
				t.Fatalf("read ext len %d: %v", i, err)
			}
			payloadLen = (payloadLen << 8) | int(b)
		}
	}
	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(reader, payload); err != nil {
		t.Fatalf("read payload: %v", err)
	}
	return wsFrame{fin: true, opcode: opcode, payload: payload}
}
