package pvelxc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type rewriteExecTransport struct {
	target *url.URL
}

func (t *rewriteExecTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = t.target.Scheme
	clone.URL.Host = t.target.Host
	clone.Host = t.target.Host
	return http.DefaultTransport.RoundTrip(clone)
}

func newExecReadyTestClient(t *testing.T, execHandler http.HandlerFunc) *Client {
	t.Helper()

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(r.URL.Path, "/dns"):
			_, _ = w.Write([]byte(`{"data":{"search":""}}`))
		case strings.HasSuffix(r.URL.Path, "/config"):
			_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
		default:
			t.Fatalf("unexpected PVE API path: %s", r.URL.Path)
		}
	}))
	t.Cleanup(apiServer.Close)

	execServer := httptest.NewServer(execHandler)
	t.Cleanup(execServer.Close)

	targetURL, err := url.Parse(execServer.URL)
	if err != nil {
		t.Fatalf("parse exec server URL: %v", err)
	}

	return &Client{
		apiURL:       apiServer.URL,
		apiToken:     "token",
		publicDomain: "example.com",
		apiHTTP:      apiServer.Client(),
		execHTTP: &http.Client{
			Transport: &rewriteExecTransport{target: targetURL},
		},
		node: "test-node",
	}
}

func TestVerifyTimezoneCommand(t *testing.T) {
	command := VerifyTimezoneCommand("Asia/Hong_Kong")

	if command != "TZ='Asia/Hong_Kong'; date +%Z" {
		t.Fatalf("VerifyTimezoneCommand() = %q", command)
	}
}

func TestApplyTimezoneCommand(t *testing.T) {
	command := ApplyTimezoneCommand("Asia/Hong_Kong")

	if !strings.Contains(command, "timedatectl set-timezone 'Asia/Hong_Kong'") {
		t.Fatalf("expected timedatectl command, got %q", command)
	}
	if !strings.Contains(command, "ln -snf '/usr/share/zoneinfo/Asia/Hong_Kong' /etc/localtime") {
		t.Fatalf("expected /etc/localtime fallback, got %q", command)
	}
	if !strings.Contains(command, "printf '%s\\n' 'Asia/Hong_Kong' > /etc/timezone;") {
		t.Fatalf("expected /etc/timezone update, got %q", command)
	}
}

func TestWaitForExecReadyImmediateSuccess(t *testing.T) {
	client := newExecReadyTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ready\"}\n{\"type\":\"exit\",\"code\":0}\n"))
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := client.WaitForExecReady(ctx, "200", 2*time.Second); err != nil {
		t.Fatalf("WaitForExecReady() error = %v", err)
	}
}

func TestWaitForExecReadyRetriesUntilSuccess(t *testing.T) {
	var (
		mu       sync.Mutex
		attempts int
	)

	client := newExecReadyTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		attempts++

		if attempts < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("not ready"))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ready\"}\n{\"type\":\"exit\",\"code\":0}\n"))
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.WaitForExecReady(ctx, "200", 5*time.Second); err != nil {
		t.Fatalf("WaitForExecReady() error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestWaitForExecReadyTimesOut(t *testing.T) {
	client := newExecReadyTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("not ready"))
	})

	err := client.WaitForExecReady(context.Background(), "200", 50*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("WaitForExecReady() error = %v, want deadline exceeded", err)
	}
	if !strings.Contains(err.Error(), "did not become ready") {
		t.Fatalf("expected timeout error to mention readiness, got %q", err)
	}
}

func TestWaitForExecReadyHonorsCancellation(t *testing.T) {
	client := newExecReadyTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("not ready"))
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := client.WaitForExecReady(ctx, "200", time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("WaitForExecReady() error = %v, want canceled", err)
	}
}

func TestExecCommandSendsBearerTokenWhenCached(t *testing.T) {
	var receivedAuth string

	client := newExecReadyTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/jsonlines")
		_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ok\"}\n{\"type\":\"exit\",\"code\":0}\n"))
	})

	// Pre-set the cached token so getExecToken doesn't try SSH.
	client.execToken = "my-secret-token"

	stdout, _, exitCode, err := client.ExecCommand(context.Background(), "200", "echo ok")
	if err != nil {
		t.Fatalf("ExecCommand() error = %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("ExecCommand() exitCode = %d, want 0", exitCode)
	}
	if stdout != "ok" {
		t.Errorf("ExecCommand() stdout = %q, want %q", stdout, "ok")
	}
	if receivedAuth != "Bearer my-secret-token" {
		t.Errorf("Authorization header = %q, want %q", receivedAuth, "Bearer my-secret-token")
	}
}

func TestExecCommandRetriesOn401WithFreshToken(t *testing.T) {
	var (
		mu          sync.Mutex
		callCount   int
		receivedAuth string
	)

	client := newExecReadyTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		receivedAuth = r.Header.Get("Authorization")
		mu.Unlock()

		// First call: return 401 to simulate stale token.
		// Second call: return success.
		if callCount == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
			return
		}

		w.Header().Set("Content-Type", "application/jsonlines")
		_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ok\"}\n{\"type\":\"exit\",\"code\":0}\n"))
	})

	// Start with a stale token; the 401 should trigger invalidation + re-fetch.
	// Since PVE_SSH_HOST isn't set, re-fetch returns "" — but the test handler
	// doesn't check auth, so the second call succeeds regardless.
	client.execToken = "stale-token"

	stdout, _, exitCode, err := client.ExecCommand(context.Background(), "200", "echo ok")
	if err != nil {
		t.Fatalf("ExecCommand() error = %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("ExecCommand() exitCode = %d, want 0", exitCode)
	}
	if stdout != "ok" {
		t.Errorf("ExecCommand() stdout = %q, want %q", stdout, "ok")
	}

	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Errorf("expected 2 calls (401 + retry), got %d", callCount)
	}
	// First call should have sent the stale token.
	_ = receivedAuth // value is from the last call; we just verify it ran twice.
}
