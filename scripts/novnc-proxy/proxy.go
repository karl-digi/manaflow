package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

type ProxyConfig struct {
	ListenAddr  string
	TargetAddr  string
	WebRoot     string
	DialTimeout time.Duration
	Logger      *log.Logger
}

type Proxy struct {
	cfg           ProxyConfig
	logger        *log.Logger
	staticHandler http.Handler
}

func NewProxy(cfg ProxyConfig) (*Proxy, error) {
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = "0.0.0.0:39380"
	}
	if cfg.TargetAddr == "" {
		return nil, fmt.Errorf("target address must be provided")
	}
	if cfg.DialTimeout <= 0 {
		cfg.DialTimeout = 5 * time.Second
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.New(io.Discard, "", 0)
	}
	var staticHandler http.Handler = http.NotFoundHandler()
	if cfg.WebRoot != "" {
		absolute, err := filepath.Abs(cfg.WebRoot)
		if err != nil {
			return nil, fmt.Errorf("resolve web root: %w", err)
		}
		info, err := os.Stat(absolute)
		if err != nil {
			return nil, fmt.Errorf("web root: %w", err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("web root %q is not a directory", absolute)
		}
		staticHandler = http.FileServer(http.Dir(absolute))
		cfg.WebRoot = absolute
	}
	return &Proxy{
		cfg:           cfg,
		logger:        logger,
		staticHandler: staticHandler,
	}, nil
}

func (p *Proxy) Run() error {
	server := &http.Server{
		Addr:              p.cfg.ListenAddr,
		Handler:           p,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       0,
	}
	p.logger.Printf("cmux noVNC proxy listening on %s, forwarding to %s, serving assets from %s", p.cfg.ListenAddr, p.cfg.TargetAddr, p.cfg.WebRoot)
	err := server.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isWebSocketRequest(r) {
		p.handleWebSocket(w, r)
		return
	}
	if r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok\n")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	p.staticHandler.ServeHTTP(w, r)
}

func (p *Proxy) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	backendConn, err := p.dialBackend(ctx)
	if err != nil {
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		p.logger.Printf("websocket accept failed: %v", err)
		_ = backendConn.Close()
		return
	}
	conn.SetReadLimit(64 << 20)

	p.proxyConnections(ctx, conn, backendConn, r.RemoteAddr)
}

func (p *Proxy) dialBackend(ctx context.Context) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: p.cfg.DialTimeout}
	return dialer.DialContext(ctx, "tcp", p.cfg.TargetAddr)
}

func (p *Proxy) proxyConnections(ctx context.Context, wsConn *websocket.Conn, backend net.Conn, remoteAddr string) {
	targetAddr := backend.RemoteAddr().String()
	p.logger.Printf("proxy connection started: remote=%s target=%s", remoteAddr, targetAddr)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	errCh := make(chan error, 2)

	go func() {
		errCh <- p.copyWebSocketToTCP(ctx, wsConn, backend)
	}()

	go func() {
		errCh <- p.copyTCPToWebSocket(ctx, backend, wsConn)
	}()

	var closeStatus websocket.StatusCode = websocket.StatusNormalClosure
	var once sync.Once
	cancelBoth := func() { once.Do(cancel) }

	for i := 0; i < 2; i++ {
		if err := <-errCh; err != nil && !isNormalNetworkError(err) {
			p.logger.Printf("proxy stream error: %v", err)
			closeStatus = websocket.StatusInternalError
		}
		cancelBoth()
	}

	_ = wsConn.Close(closeStatus, "")
	_ = backend.Close()
	p.logger.Printf("proxy connection finished: remote=%s target=%s", remoteAddr, targetAddr)
}

func (p *Proxy) copyWebSocketToTCP(ctx context.Context, wsConn *websocket.Conn, backend net.Conn) error {
	for {
		msgType, reader, err := wsConn.Reader(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				return nil
			}
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return fmt.Errorf("read from websocket: %w", err)
		}
		if msgType != websocket.MessageBinary && msgType != websocket.MessageText {
			if err := drainReader(reader); err != nil {
				return fmt.Errorf("discard control frame: %w", err)
			}
			continue
		}
		if _, err := io.Copy(backend, reader); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return fmt.Errorf("write to backend: %w", err)
		}
	}
}

func (p *Proxy) copyTCPToWebSocket(ctx context.Context, backend net.Conn, wsConn *websocket.Conn) error {
	buf := make([]byte, 32*1024)
	for {
		backend.SetReadDeadline(time.Now().Add(30 * time.Second))
		n, err := backend.Read(buf)
		backend.SetReadDeadline(time.Time{})
		if n > 0 {
			writeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err2 := wsConn.Write(writeCtx, websocket.MessageBinary, buf[:n])
			cancel()
			if err2 != nil {
				if websocket.CloseStatus(err2) == websocket.StatusNormalClosure || errors.Is(err2, context.Canceled) {
					return nil
				}
				return fmt.Errorf("write to websocket: %w", err2)
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
				return nil
			}
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				// continue waiting for data to handle keepalive
				continue
			}
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return fmt.Errorf("read from backend: %w", err)
		}
	}
}

func drainReader(r io.Reader) error {
	_, err := io.Copy(io.Discard, r)
	return err
}

func isWebSocketRequest(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, token := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.TrimSpace(strings.ToLower(token)) == "upgrade" {
			return true
		}
	}
	return false
}

func isNormalNetworkError(err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) || errors.Is(err, net.ErrClosed) {
		return true
	}
	switch websocket.CloseStatus(err) {
	case websocket.StatusNormalClosure, websocket.StatusGoingAway:
		return true
	}
	if ne, ok := err.(net.Error); ok {
		return ne.Timeout()
	}
	return false
}
