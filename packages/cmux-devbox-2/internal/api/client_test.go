package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type recordedRequest struct {
	method string
	path   string
	body   []byte
}

func newTestClient(t *testing.T, provider Provider, srv *httptest.Server) *Client {
	t.Helper()

	basePath, err := provider.apiBasePath()
	if err != nil {
		t.Fatalf("apiBasePath: %v", err)
	}

	return &Client{
		baseURL:        srv.URL,
		apiBasePath:    basePath,
		provider:       provider,
		httpClient:     srv.Client(),
		defaultTimeout: 5 * time.Second,
		getAccessTokenF: func() (string, error) {
			return "test-token", nil
		},
	}
}

func TestCreateInstance_E2BUsesTemplateId(t *testing.T) {
	var mu sync.Mutex
	var rec recordedRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		rec = recordedRequest{method: r.Method, path: r.URL.String(), body: body}
		mu.Unlock()

		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":        "cmux_test",
			"status":    "running",
			"vscodeUrl": "https://example.invalid",
			"workerUrl": "https://example.invalid",
			"vncUrl":    "https://example.invalid",
		})
	}))
	t.Cleanup(srv.Close)

	client := newTestClient(t, ProviderE2B, srv)
	if _, err := client.CreateInstance("team", "tmpl_123", "mybox"); err != nil {
		t.Fatalf("CreateInstance: %v", err)
	}

	mu.Lock()
	got := rec
	mu.Unlock()

	if got.method != http.MethodPost {
		t.Fatalf("method: got %q want %q", got.method, http.MethodPost)
	}
	if got.path != "/api/v2/devbox/instances" {
		t.Fatalf("path: got %q want %q", got.path, "/api/v2/devbox/instances")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if payload["teamSlugOrId"] != "team" {
		t.Fatalf("teamSlugOrId: got %v want %q", payload["teamSlugOrId"], "team")
	}
	if payload["templateId"] != "tmpl_123" {
		t.Fatalf("templateId: got %v want %q", payload["templateId"], "tmpl_123")
	}
	if _, ok := payload["snapshot"]; ok {
		t.Fatalf("snapshot: unexpectedly present")
	}
}

func TestRewriteDaytonaProxyURL_RewritesHostAndScheme(t *testing.T) {
	c := &Client{
		provider:            ProviderDaytona,
		proxyOverrideScheme: "http",
		proxyOverrideDomain: "cmux.localhost:8080",
		defaultTimeout:      5 * time.Second,
		httpClient:          &http.Client{},
		getAccessTokenF:     func() (string, error) { return "test-token", nil },
		baseURL:             "https://example.invalid",
		apiBasePath:         "/api/v3/devbox",
	}

	in := "https://port-39377-daytona-bdbee509-4ca2-4926-b70f-23f5b66b1035.cmux.sh/health?x=y"
	want := "http://port-39377-daytona-bdbee509-4ca2-4926-b70f-23f5b66b1035.cmux.localhost:8080/health?x=y"
	if got := c.rewriteDaytonaProxyURL(in); got != want {
		t.Fatalf("rewriteDaytonaProxyURL mismatch:\n  in:   %s\n  got:  %s\n  want: %s", in, got, want)
	}

	nonProxyURL := "https://39377-bdbee509-4ca2-4926-b70f-23f5b66b1035.proxy.daytona.works/health"
	if got := c.rewriteDaytonaProxyURL(nonProxyURL); got != nonProxyURL {
		t.Fatalf("expected non-proxy URL to remain unchanged, got %q", got)
	}
}

func TestCreateInstance_DaytonaUsesSnapshot(t *testing.T) {
	var mu sync.Mutex
	var rec recordedRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		rec = recordedRequest{method: r.Method, path: r.URL.String(), body: body}
		mu.Unlock()

		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":        "cmux_test",
			"status":    "running",
			"vscodeUrl": "https://example.invalid",
			"workerUrl": "https://example.invalid",
			"vncUrl":    "https://example.invalid",
		})
	}))
	t.Cleanup(srv.Close)

	client := newTestClient(t, ProviderDaytona, srv)
	if _, err := client.CreateInstance("team", "cmux-devbox-full", "mybox"); err != nil {
		t.Fatalf("CreateInstance: %v", err)
	}

	mu.Lock()
	got := rec
	mu.Unlock()

	if got.method != http.MethodPost {
		t.Fatalf("method: got %q want %q", got.method, http.MethodPost)
	}
	if got.path != "/api/v3/devbox/instances" {
		t.Fatalf("path: got %q want %q", got.path, "/api/v3/devbox/instances")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if payload["teamSlugOrId"] != "team" {
		t.Fatalf("teamSlugOrId: got %v want %q", payload["teamSlugOrId"], "team")
	}
	if payload["snapshot"] != "cmux-devbox-full" {
		t.Fatalf("snapshot: got %v want %q", payload["snapshot"], "cmux-devbox-full")
	}
	if _, ok := payload["templateId"]; ok {
		t.Fatalf("templateId: unexpectedly present")
	}
}

func TestExtendTimeout_E2BSendsTtlSeconds(t *testing.T) {
	var mu sync.Mutex
	var rec recordedRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		rec = recordedRequest{method: r.Method, path: r.URL.String(), body: body}
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := newTestClient(t, ProviderE2B, srv)
	if err := client.ExtendTimeout("team", "cmux_123", 90_000); err != nil {
		t.Fatalf("ExtendTimeout: %v", err)
	}

	mu.Lock()
	got := rec
	mu.Unlock()

	if got.method != http.MethodPost {
		t.Fatalf("method: got %q want %q", got.method, http.MethodPost)
	}
	if got.path != "/api/v2/devbox/instances/cmux_123/extend" {
		t.Fatalf("path: got %q want %q", got.path, "/api/v2/devbox/instances/cmux_123/extend")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if payload["ttlSeconds"] != float64(90) {
		t.Fatalf("ttlSeconds: got %v want %v", payload["ttlSeconds"], 90)
	}
	if _, ok := payload["timeoutMs"]; ok {
		t.Fatalf("timeoutMs: unexpectedly present")
	}
}

func TestExtendTimeout_DaytonaSendsTimeoutMs(t *testing.T) {
	var mu sync.Mutex
	var rec recordedRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		rec = recordedRequest{method: r.Method, path: r.URL.String(), body: body}
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := newTestClient(t, ProviderDaytona, srv)
	if err := client.ExtendTimeout("team", "cmux_123", 90_000); err != nil {
		t.Fatalf("ExtendTimeout: %v", err)
	}

	mu.Lock()
	got := rec
	mu.Unlock()

	if got.method != http.MethodPost {
		t.Fatalf("method: got %q want %q", got.method, http.MethodPost)
	}
	if got.path != "/api/v3/devbox/instances/cmux_123/extend" {
		t.Fatalf("path: got %q want %q", got.path, "/api/v3/devbox/instances/cmux_123/extend")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if payload["timeoutMs"] != float64(90_000) {
		t.Fatalf("timeoutMs: got %v want %v", payload["timeoutMs"], 90_000)
	}
	if _, ok := payload["ttlSeconds"]; ok {
		t.Fatalf("ttlSeconds: unexpectedly present")
	}
}

func TestDeleteInstance_DaytonaUsesDELETE(t *testing.T) {
	var mu sync.Mutex
	var rec recordedRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		rec = recordedRequest{method: r.Method, path: r.URL.String(), body: body}
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := newTestClient(t, ProviderDaytona, srv)
	if err := client.DeleteInstance("team", "cmux_123"); err != nil {
		t.Fatalf("DeleteInstance: %v", err)
	}

	mu.Lock()
	got := rec
	mu.Unlock()

	if got.method != http.MethodDelete {
		t.Fatalf("method: got %q want %q", got.method, http.MethodDelete)
	}
	if got.path != "/api/v3/devbox/instances/cmux_123?teamSlugOrId=team" {
		t.Fatalf("path: got %q want %q", got.path, "/api/v3/devbox/instances/cmux_123?teamSlugOrId=team")
	}
	if len(got.body) != 0 {
		t.Fatalf("body: got %q want empty", string(got.body))
	}
}

func TestDeleteInstance_E2BUsesStopPOST(t *testing.T) {
	var mu sync.Mutex
	var rec recordedRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		rec = recordedRequest{method: r.Method, path: r.URL.String(), body: body}
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := newTestClient(t, ProviderE2B, srv)
	if err := client.DeleteInstance("team", "cmux_123"); err != nil {
		t.Fatalf("DeleteInstance: %v", err)
	}

	mu.Lock()
	got := rec
	mu.Unlock()

	if got.method != http.MethodPost {
		t.Fatalf("method: got %q want %q", got.method, http.MethodPost)
	}
	if got.path != "/api/v2/devbox/instances/cmux_123/stop" {
		t.Fatalf("path: got %q want %q", got.path, "/api/v2/devbox/instances/cmux_123/stop")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if payload["teamSlugOrId"] != "team" {
		t.Fatalf("teamSlugOrId: got %v want %q", payload["teamSlugOrId"], "team")
	}
}
