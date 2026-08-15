package pvelxc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
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

func newExecTestClient(t *testing.T, apiHandler http.HandlerFunc, execHandler http.HandlerFunc) *Client {
	t.Helper()

	apiServer := httptest.NewServer(apiHandler)
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
		node:               "test-node",
		execRetryBaseDelay: time.Nanosecond,
	}
}

// execTestToken is a synthetic 64-character lowercase hex token fixture.
const execTestToken = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

func newExecReadyTestClient(t *testing.T, execHandler http.HandlerFunc) *Client {
	t.Helper()

	return newExecTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(r.URL.Path, "/dns"):
			_, _ = w.Write([]byte(`{"data":{"search":""}}`))
		case strings.HasSuffix(r.URL.Path, "/config"):
			_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
		case strings.HasSuffix(r.URL.Path, "/files"):
			// Token file absent in the container — execd in no-auth mode.
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"data":null}`))
		default:
			t.Fatalf("unexpected PVE API path: %s", r.URL.Path)
		}
	}), execHandler)
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
		mu           sync.Mutex
		callCount    int
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

func TestExecCommandTokenFetchViaAPI(t *testing.T) {
	tests := []struct {
		name        string
		filesStatus int
		filesBody   string
		wantAuth    string
	}{
		{
			name:        "json wrapped token",
			filesStatus: http.StatusOK,
			filesBody:   `{"data":{"content":"api-secret-token"}}`,
			wantAuth:    "Bearer api-secret-token",
		},
		{
			name:        "raw content token",
			filesStatus: http.StatusOK,
			filesBody:   "raw-secret-token\n",
			wantAuth:    "Bearer raw-secret-token",
		},
		{
			name:        "token file absent",
			filesStatus: http.StatusNotFound,
			filesBody:   `{"data":null}`,
			wantAuth:    "",
		},
		{
			name:        "file endpoint not implemented",
			filesStatus: http.StatusNotImplemented,
			filesBody:   `{"data":null}`,
			wantAuth:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var (
				mu         sync.Mutex
				gotAuth    string
				filesCalls int
			)

			client := newExecTestClient(t,
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch {
					case strings.HasSuffix(r.URL.Path, "/dns"):
						_, _ = w.Write([]byte(`{"data":{"search":""}}`))
					case strings.HasSuffix(r.URL.Path, "/config"):
						_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
					case strings.HasSuffix(r.URL.Path, "/files"):
						mu.Lock()
						filesCalls++
						mu.Unlock()
						if got := r.Header.Get("Authorization"); got != "PVEAPIToken=token" {
							t.Errorf("files request Authorization = %q, want %q", got, "PVEAPIToken=token")
						}
						if got := r.URL.Query().Get("path"); got != "/root/.worker-auth-token" {
							t.Errorf("files request path = %q, want %q", got, "/root/.worker-auth-token")
						}
						w.WriteHeader(tt.filesStatus)
						_, _ = w.Write([]byte(tt.filesBody))
					default:
						t.Errorf("unexpected PVE API path: %s", r.URL.Path)
					}
				}),
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					mu.Lock()
					gotAuth = r.Header.Get("Authorization")
					mu.Unlock()
					w.Header().Set("Content-Type", "application/jsonlines")
					_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ok\"}\n{\"type\":\"exit\",\"code\":0}\n"))
				}),
			)

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
			if gotAuth != tt.wantAuth {
				t.Errorf("exec Authorization = %q, want %q", gotAuth, tt.wantAuth)
			}
			if filesCalls != 1 {
				t.Errorf("files fetch calls = %d, want 1", filesCalls)
			}
		})
	}
}

func TestExecCommandTokenFromEnvFile(t *testing.T) {
	tokenFile := filepath.Join(t.TempDir(), "execd-token.txt")
	if err := os.WriteFile(tokenFile, []byte(execTestToken+"\n"), 0o600); err != nil {
		t.Fatalf("write token file: %v", err)
	}
	t.Setenv("PVE_EXECD_TOKEN_FILE", tokenFile)

	var (
		mu         sync.Mutex
		gotAuth    string
		filesCalls int
	)

	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/dns"):
				_, _ = w.Write([]byte(`{"data":{"search":""}}`))
			case strings.HasSuffix(r.URL.Path, "/config"):
				_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
			case strings.HasSuffix(r.URL.Path, "/files"):
				mu.Lock()
				filesCalls++
				mu.Unlock()
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"data":null}`))
			default:
				t.Errorf("unexpected PVE API path: %s", r.URL.Path)
			}
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			gotAuth = r.Header.Get("Authorization")
			mu.Unlock()
			w.Header().Set("Content-Type", "application/jsonlines")
			_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ok\"}\n{\"type\":\"exit\",\"code\":0}\n"))
		}),
	)

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
	if gotAuth != "Bearer "+execTestToken {
		t.Errorf("exec Authorization = %q, want %q", gotAuth, "Bearer "+execTestToken)
	}
	if filesCalls != 0 {
		t.Errorf("files fetch calls = %d, want 0 (env file must bypass the PVE API)", filesCalls)
	}
}

func TestExecdTokenFileMissingRejected(t *testing.T) {
	// A configured-but-missing token file is a misconfiguration: the exec
	// cannot authenticate with the injected clone token, so the fetch must
	// fail without touching SSH or the PVE API.
	t.Setenv("PVE_EXECD_TOKEN_FILE", filepath.Join(t.TempDir(), "missing-token.txt"))

	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Errorf("PVE API must not be reached for a missing token file, got %s", r.URL.Path)
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Errorf("exec endpoint must not be reached for a missing token file, got %s", r.URL.Path)
		}),
	)

	if _, err := client.fetchExecToken(context.Background(), 200); err == nil {
		t.Fatal("fetchExecToken() error = nil, want missing-file error")
	}
}

func TestExecCommandRetriesOn401WithFreshTokenViaAPI(t *testing.T) {
	var (
		mu         sync.Mutex
		execCalls  int
		filesCalls int
		auths      []string
	)

	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/dns"):
				_, _ = w.Write([]byte(`{"data":{"search":""}}`))
			case strings.HasSuffix(r.URL.Path, "/config"):
				_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
			case strings.HasSuffix(r.URL.Path, "/files"):
				mu.Lock()
				filesCalls++
				mu.Unlock()
				_, _ = w.Write([]byte(`{"data":{"content":"fresh-api-token"}}`))
			default:
				t.Errorf("unexpected PVE API path: %s", r.URL.Path)
			}
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			execCalls++
			auths = append(auths, r.Header.Get("Authorization"))
			first := execCalls == 1
			mu.Unlock()

			if first {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
				return
			}
			w.Header().Set("Content-Type", "application/jsonlines")
			_, _ = w.Write([]byte("{\"type\":\"stdout\",\"data\":\"ok\"}\n{\"type\":\"exit\",\"code\":0}\n"))
		}),
	)

	// Start with a stale token; the 401 should invalidate the cache and
	// trigger exactly one re-fetch via the PVE API before the retry.
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
	if execCalls != 2 {
		t.Errorf("exec calls = %d, want 2 (401 + retry)", execCalls)
	}
	if filesCalls != 1 {
		t.Errorf("files fetch calls = %d, want 1", filesCalls)
	}
	if len(auths) != 2 || auths[0] != "Bearer stale-token" || auths[1] != "Bearer fresh-api-token" {
		t.Errorf("exec Authorization sequence = %q, want [Bearer stale-token Bearer fresh-api-token]", auths)
	}
}

func TestFetchExecTokenPrefersSSHWhenHostSet(t *testing.T) {
	t.Setenv("PVE_SSH_HOST", "127.0.0.1")

	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Errorf("PVE API must not be called when PVE_SSH_HOST is set, got %s", r.URL.Path)
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Errorf("exec endpoint must not be called, got %s", r.URL.Path)
		}),
	)

	// No sshd on 127.0.0.1 (or no ssh binary): the SSH path must be taken and
	// must fail with a fetch error rather than touching the PVE API.
	_, err := client.fetchExecToken(context.Background(), 200)
	if err == nil {
		t.Fatal("fetchExecToken() error = nil, want SSH fetch error")
	}
	if !strings.Contains(err.Error(), "fetch exec token via SSH") {
		t.Errorf("fetchExecToken() error = %q, want SSH fetch error", err)
	}
}

func TestTryHTTPExecReturnsErrorOnNonOKStatus(t *testing.T) {
	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/dns"):
				_, _ = w.Write([]byte(`{"data":{"search":""}}`))
			case strings.HasSuffix(r.URL.Path, "/config"):
				_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
			default:
				t.Errorf("unexpected PVE API path: %s", r.URL.Path)
			}
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"Bad Gateway"}`))
		}),
	)

	_, err := client.tryHTTPExec(context.Background(), "https://port-39375-cmux-200.example.com", "echo ok", 0, "")
	if err == nil {
		t.Fatal("tryHTTPExec() error = nil, want HTTP 502 error")
	}
	if !strings.Contains(err.Error(), "HTTP 502") {
		t.Errorf("tryHTTPExec() error = %v, want it to mention HTTP 502", err)
	}
}

func TestTryHTTPExecReturnsErrorOnConnectionFailure(t *testing.T) {
	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{}}`))
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("exec handler must not be reached")
		}),
	)

	// Point the exec transport at a closed listener so the request fails
	// with a connection error instead of a response.
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL, err := url.Parse(dead.URL)
	if err != nil {
		t.Fatalf("parse dead server URL: %v", err)
	}
	dead.Close()
	client.execHTTP = &http.Client{Transport: &rewriteExecTransport{target: deadURL}}

	_, err = client.tryHTTPExec(context.Background(), "https://port-39375-cmux-200.example.com", "echo ok", 0, "")
	if err == nil {
		t.Fatal("tryHTTPExec() error = nil, want connection error")
	}
	if !strings.Contains(err.Error(), "connection refused") {
		t.Errorf("tryHTTPExec() error = %v, want it to mention connection refused", err)
	}
}

func TestExecCommandSurfacesLastError(t *testing.T) {
	// A persistent 401 must surface in the final error (with the fast retry
	// base delay of 0 set by the test client) instead of a generic message.
	client := newExecTestClient(t,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/dns"):
				_, _ = w.Write([]byte(`{"data":{"search":""}}`))
			case strings.HasSuffix(r.URL.Path, "/config"):
				_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200"}}`))
			case strings.HasSuffix(r.URL.Path, "/files"):
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"data":null}`))
			default:
				t.Errorf("unexpected PVE API path: %s", r.URL.Path)
			}
		}),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
		}),
	)

	_, _, _, err := client.ExecCommand(context.Background(), "200", "echo ok")
	if err == nil {
		t.Fatal("ExecCommand() error = nil, want surfaced last error")
	}
	if !strings.Contains(err.Error(), "401 Unauthorized") {
		t.Errorf("ExecCommand() error = %v, want it to mention 401 Unauthorized", err)
	}
	if !strings.Contains(err.Error(), "last error:") {
		t.Errorf("ExecCommand() error = %v, want it to mention last error", err)
	}
}
