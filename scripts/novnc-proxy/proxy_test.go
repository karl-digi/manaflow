package main

import (
	"bytes"
	"context"
	"io"
	"log"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestStaticFileServing(t *testing.T) {
	t.Parallel()

	webDir := t.TempDir()
	expected := []byte("hello world")
	if err := os.WriteFile(filepath.Join(webDir, "vnc.html"), expected, 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	proxy, err := NewProxy(ProxyConfig{
		ListenAddr: "127.0.0.1:0",
		TargetAddr: "127.0.0.1:5901",
		WebRoot:    webDir,
		Logger:     log.New(io.Discard, "", 0),
	})
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}

	req := httptest.NewRequest("GET", "/vnc.html", nil)
	rr := httptest.NewRecorder()

	proxy.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}
	if got := rr.Body.Bytes(); !bytes.Equal(got, expected) {
		t.Fatalf("unexpected body: %q", rr.Body.String())
	}
}

func TestWebSocketProxy(t *testing.T) {
	t.Parallel()

	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "vnc.html"), []byte("ok"), 0o644); err != nil {
		t.Fatalf("write web asset: %v", err)
	}

	backendListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen backend: %v", err)
	}
	defer backendListener.Close()

	proxy, err := NewProxy(ProxyConfig{
		ListenAddr: "127.0.0.1:0",
		TargetAddr: backendListener.Addr().String(),
		WebRoot:    webDir,
		Logger:     log.New(io.Discard, "", 0),
	})
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}

	srv := httptest.NewServer(proxy)
	defer srv.Close()

	var acceptWG sync.WaitGroup
	acceptWG.Add(1)
	go func() {
		defer acceptWG.Done()
		conn, err := backendListener.Accept()
		if err != nil {
			t.Logf("backend accept error: %v", err)
			return
		}
		defer conn.Close()

		buf := make([]byte, 5)
		if _, err := io.ReadFull(conn, buf); err != nil {
			t.Errorf("backend read: %v", err)
			return
		}
		if string(buf) != "hello" {
			t.Errorf("backend received %q, want hello", string(buf))
			return
		}
		if _, err := conn.Write([]byte("world")); err != nil {
			t.Errorf("backend write: %v", err)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/websockify"
	client, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial: %v", err)
	}
	defer client.Close(websocket.StatusNormalClosure, "")

	if err := client.Write(ctx, websocket.MessageBinary, []byte("hello")); err != nil {
		t.Fatalf("write to websocket: %v", err)
	}

	msgType, data, err := client.Read(ctx)
	if err != nil {
		t.Fatalf("read from websocket: %v", err)
	}
	if msgType != websocket.MessageBinary {
		t.Fatalf("unexpected message type: %v", msgType)
	}
	if string(data) != "world" {
		t.Fatalf("unexpected payload %q", string(data))
	}

	acceptWG.Wait()
}
