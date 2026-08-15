package pvelxc

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/karlorz/devsh/internal/provider"
)

// testExecdToken is a synthetic 64-character lowercase hex token fixture.
const testExecdToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestIsPveLxcInstanceID(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"pvelxc-abc123", true},
		{"cmux-200", true},
		{"200", true},
		{"cmux_abc123", false},
		{"morphvm_xyz", false},
		{"e2b-sandbox", false},
	}

	for _, tt := range tests {
		if got := provider.IsPveLxcInstanceID(tt.id); got != tt.want {
			t.Errorf("IsPveLxcInstanceID(%q) = %v, want %v", tt.id, got, tt.want)
		}
	}
}

func TestDetectProviderFromEnv(t *testing.T) {
	t.Setenv("PVE_API_URL", "https://pve.test:8006")
	t.Setenv("PVE_API_TOKEN", "root@pam!token=abc")
	t.Setenv("E2B_API_KEY", "")
	if got := provider.DetectFromEnv(); got != provider.PveLxc {
		t.Fatalf("DetectFromEnv() = %q, want %q", got, provider.PveLxc)
	}

	t.Setenv("PVE_API_URL", "")
	t.Setenv("PVE_API_TOKEN", "")
	t.Setenv("E2B_API_KEY", "")
	if got := provider.DetectFromEnv(); got != provider.Morph {
		t.Fatalf("DetectFromEnv() = %q, want %q", got, provider.Morph)
	}
}

func TestParseFirstDomainFromSearchList(t *testing.T) {
	tests := []struct {
		search string
		want   string
	}{
		{"example.com", ".example.com"},
		{"corp.example.com local", ".corp.example.com"},
		{"a.com b.com c.com", ".a.com"},
		{"  spaced.com  other.com  ", ".spaced.com"},
		{"", ""},
		{"   ", ""},
	}

	for _, tt := range tests {
		search := tt.search
		var got string
		trimmed := strings.TrimSpace(search)
		if trimmed == "" {
			got = ""
		} else {
			firstDomain := strings.Fields(trimmed)[0]
			got = "." + firstDomain
		}
		if got != tt.want {
			t.Errorf("parseFirstDomain(%q) = %q, want %q", tt.search, got, tt.want)
		}
	}
}

func TestNumericHostnameFallback(t *testing.T) {
	tests := []struct {
		instanceID string
		wantVMID   int
		wantOK     bool
	}{
		{"200", 200, true},
		{"cmux-200", 200, true},
		{"pvelxc-abc123", 0, false},
	}

	for _, tt := range tests {
		vmid, ok := ParseVMID(tt.instanceID)
		if ok != tt.wantOK {
			t.Errorf("ParseVMID(%q) ok = %v, want %v", tt.instanceID, ok, tt.wantOK)
		}
		if ok && vmid != tt.wantVMID {
			t.Errorf("ParseVMID(%q) = %d, want %d", tt.instanceID, vmid, tt.wantVMID)
		}

		// Test hostname fallback logic for numeric IDs
		if ok {
			hostname := normalizeHostID(tt.instanceID)
			if hostname == "" || reDigits.MatchString(hostname) {
				hostname = fmt.Sprintf("cmux-%d", vmid)
			}
			expected := fmt.Sprintf("cmux-%d", tt.wantVMID)
			if hostname != expected {
				t.Errorf("hostname fallback for %q = %q, want %q", tt.instanceID, hostname, expected)
			}
		}
	}
}

func TestExecURLFormat(t *testing.T) {
	host, err := ExecHostFromPublicDomain("example.com", 39375, "pvelxc-abc123")
	if err != nil {
		t.Fatalf("ExecHostFromPublicDomain() error = %v", err)
	}
	if host != "https://port-39375-pvelxc-abc123.example.com" {
		t.Fatalf("ExecHostFromPublicDomain() = %q", host)
	}

	execURL, err := buildExecURL(host)
	if err != nil {
		t.Fatalf("buildExecURL() error = %v", err)
	}
	if execURL != "https://port-39375-pvelxc-abc123.example.com/exec" {
		t.Fatalf("buildExecURL() = %q", execURL)
	}

	execURL2, err := buildExecURL("10.0.0.1:39375")
	if err != nil {
		t.Fatalf("buildExecURL(bare host) error = %v", err)
	}
	if execURL2 != "http://10.0.0.1:39375/exec" {
		t.Fatalf("buildExecURL(bare host) = %q", execURL2)
	}
}

func TestConfigStruct(t *testing.T) {
	cfg := Config{
		APIURL:       "https://pve.example.com:8006",
		APIToken:     "root@pam!token=secret",
		Node:         "pve1",
		PublicDomain: "example.com",
		VerifyTLS:    true,
	}

	if cfg.APIURL != "https://pve.example.com:8006" {
		t.Errorf("expected APIURL, got '%s'", cfg.APIURL)
	}
	if cfg.APIToken != "root@pam!token=secret" {
		t.Errorf("expected APIToken, got '%s'", cfg.APIToken)
	}
	if cfg.Node != "pve1" {
		t.Errorf("expected Node 'pve1', got '%s'", cfg.Node)
	}
	if cfg.PublicDomain != "example.com" {
		t.Errorf("expected PublicDomain 'example.com', got '%s'", cfg.PublicDomain)
	}
	if !cfg.VerifyTLS {
		t.Error("expected VerifyTLS true")
	}
}

func TestInstanceStruct(t *testing.T) {
	inst := Instance{
		ID:        "pvelxc-abc123",
		VMID:      200,
		Status:    "running",
		Hostname:  "cmux-200",
		FQDN:      "cmux-200.example.com",
		VSCodeURL: "https://vscode.example.com",
		WorkerURL: "https://worker.example.com",
		VNCURL:    "https://vnc.example.com",
		XTermURL:  "https://xterm.example.com",
	}

	if inst.ID != "pvelxc-abc123" {
		t.Errorf("expected ID 'pvelxc-abc123', got '%s'", inst.ID)
	}
	if inst.VMID != 200 {
		t.Errorf("expected VMID 200, got %d", inst.VMID)
	}
	if inst.Status != "running" {
		t.Errorf("expected Status 'running', got '%s'", inst.Status)
	}
	if inst.Hostname != "cmux-200" {
		t.Errorf("expected Hostname 'cmux-200', got '%s'", inst.Hostname)
	}
}

func TestStartOptionsStruct(t *testing.T) {
	opts := StartOptions{
		SnapshotID:   "snapshot_abc123",
		TemplateVMID: 9000,
		InstanceID:   "pvelxc-test",
	}

	if opts.SnapshotID != "snapshot_abc123" {
		t.Errorf("expected SnapshotID 'snapshot_abc123', got '%s'", opts.SnapshotID)
	}
	if opts.TemplateVMID != 9000 {
		t.Errorf("expected TemplateVMID 9000, got %d", opts.TemplateVMID)
	}
	if opts.InstanceID != "pvelxc-test" {
		t.Errorf("expected InstanceID 'pvelxc-test', got '%s'", opts.InstanceID)
	}
}

func TestStartOptionsDefaults(t *testing.T) {
	opts := StartOptions{}

	if opts.SnapshotID != "" {
		t.Errorf("expected empty SnapshotID, got '%s'", opts.SnapshotID)
	}
	if opts.TemplateVMID != 0 {
		t.Errorf("expected TemplateVMID 0, got %d", opts.TemplateVMID)
	}
	if opts.InstanceID != "" {
		t.Errorf("expected empty InstanceID, got '%s'", opts.InstanceID)
	}
}

func TestNewClientMissingAPIURL(t *testing.T) {
	_, err := NewClient(Config{
		APIToken: "token",
	})
	if err == nil {
		t.Error("expected error for missing APIURL")
	}
	if err != nil && !strings.Contains(err.Error(), "apiUrl") {
		t.Errorf("expected error about apiUrl, got: %v", err)
	}
}

func TestNewClientMissingAPIToken(t *testing.T) {
	_, err := NewClient(Config{
		APIURL: "https://pve.example.com:8006",
	})
	if err == nil {
		t.Error("expected error for missing APIToken")
	}
	if err != nil && !strings.Contains(err.Error(), "apiToken") {
		t.Errorf("expected error about apiToken, got: %v", err)
	}
}

func TestNewClientSuccess(t *testing.T) {
	client, err := NewClient(Config{
		APIURL:       "https://pve.example.com:8006",
		APIToken:     "root@pam!token=secret",
		Node:         "pve1",
		PublicDomain: "example.com",
		VerifyTLS:    false,
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if client == nil {
		t.Fatal("expected client, got nil")
	}
}

func TestNewClientTrimsAPIURL(t *testing.T) {
	client, err := NewClient(Config{
		APIURL:   "  https://pve.example.com:8006/  ",
		APIToken: "token",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	// URL should be trimmed of whitespace and trailing slash
	if client.apiURL != "https://pve.example.com:8006" {
		t.Errorf("expected trimmed URL, got '%s'", client.apiURL)
	}
}

func TestRegexPatterns(t *testing.T) {
	// Test reDigits
	if !reDigits.MatchString("12345") {
		t.Error("expected reDigits to match '12345'")
	}
	if reDigits.MatchString("abc123") {
		t.Error("expected reDigits to NOT match 'abc123'")
	}

	// Test reCmuxVmid
	if !reCmuxVmid.MatchString("cmux-200") {
		t.Error("expected reCmuxVmid to match 'cmux-200'")
	}
	if reCmuxVmid.MatchString("cmux_200") {
		t.Error("expected reCmuxVmid to NOT match 'cmux_200'")
	}

	// Test reSnapshotID
	if !reSnapshotID.MatchString("snapshot_abc123") {
		t.Error("expected reSnapshotID to match 'snapshot_abc123'")
	}
	if reSnapshotID.MatchString("snapshot-abc123") {
		t.Error("expected reSnapshotID to NOT match 'snapshot-abc123'")
	}
}

func TestResolveSnapshotUsesBuiltInDefaultPair(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("Chdir(tempDir) error = %v", err)
	}
	defer func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore cwd error = %v", err)
		}
	}()

	client, err := NewClient(Config{
		APIURL:   "https://pve.example.com:8006",
		APIToken: "root@pam!token=secret",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	snapshotID, templateVMID, err := client.resolveSnapshot("")
	if err != nil {
		t.Fatalf("resolveSnapshot(\"\") error = %v", err)
	}
	if snapshotID != defaultSnapshotID {
		t.Fatalf("resolveSnapshot(\"\") snapshotID = %q, want %q", snapshotID, defaultSnapshotID)
	}
	if templateVMID != defaultTemplateVMID {
		t.Fatalf("resolveSnapshot(\"\") templateVMID = %d, want %d", templateVMID, defaultTemplateVMID)
	}
	if templateVMID == 9045 {
		t.Fatalf("resolveSnapshot(\"\") unexpectedly returned stale template VMID 9045")
	}
}

func TestResolveSnapshotExplicitCurrentDefault(t *testing.T) {
	client, err := NewClient(Config{
		APIURL:   "https://pve.example.com:8006",
		APIToken: "root@pam!token=secret",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	snapshotID, templateVMID, err := client.resolveSnapshot(defaultSnapshotID)
	if err != nil {
		t.Fatalf("resolveSnapshot(defaultSnapshotID) error = %v", err)
	}
	if snapshotID != defaultSnapshotID {
		t.Fatalf("resolveSnapshot(defaultSnapshotID) snapshotID = %q, want %q", snapshotID, defaultSnapshotID)
	}
	if templateVMID != defaultTemplateVMID {
		t.Fatalf("resolveSnapshot(defaultSnapshotID) templateVMID = %d, want %d", templateVMID, defaultTemplateVMID)
	}
}

func TestResolveSnapshotFromManifestOrDefaultUsesUpdatedFallback(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("Chdir(tempDir) error = %v", err)
	}
	defer func() {
		if err := os.Chdir(wd); err != nil {
			t.Fatalf("restore cwd error = %v", err)
		}
	}()

	templateVMID, err := resolveSnapshotFromManifestOrDefault("")
	if err != nil {
		t.Fatalf("resolveSnapshotFromManifestOrDefault(\"\") error = %v", err)
	}
	if templateVMID != defaultTemplateVMID {
		t.Fatalf("resolveSnapshotFromManifestOrDefault(\"\") = %d, want %d", templateVMID, defaultTemplateVMID)
	}
	if templateVMID == 9045 {
		t.Fatalf("resolveSnapshotFromManifestOrDefault(\"\") unexpectedly returned stale template VMID 9045")
	}
}

func TestRuntimeEnvUpsert(t *testing.T) {
	tests := []struct {
		name  string
		env   string
		token string
		want  string
	}{
		{
			name:  "empty env appends token",
			env:   "",
			token: testExecdToken,
			want:  "CMUX_EXECD_AUTH_TOKEN=" + testExecdToken,
		},
		{
			name:  "preserves unrelated entries exactly once",
			env:   "EXISTING=value",
			token: testExecdToken,
			want:  "EXISTING=value\x00CMUX_EXECD_AUTH_TOKEN=" + testExecdToken,
		},
		{
			name:  "replaces stale entry instead of duplicating",
			env:   "EXISTING=value\x00CMUX_EXECD_AUTH_TOKEN=old",
			token: testExecdToken,
			want:  "EXISTING=value\x00CMUX_EXECD_AUTH_TOKEN=" + testExecdToken,
		},
		{
			name:  "removes all stale entries before appending",
			env:   "A=1\x00CMUX_EXECD_AUTH_TOKEN=old\x00B=2\x00CMUX_EXECD_AUTH_TOKEN=older",
			token: testExecdToken,
			want:  "A=1\x00B=2\x00CMUX_EXECD_AUTH_TOKEN=" + testExecdToken,
		},
		{
			name:  "empty token removes entry",
			env:   "A=1\x00CMUX_EXECD_AUTH_TOKEN=old\x00B=2",
			token: "",
			want:  "A=1\x00B=2",
		},
		{
			name:  "keeps similarly named keys",
			env:   "CMUX_EXECD_AUTH_TOKEN_EXTRA=x\x00CMUX_EXECD_AUTH_TOKEN=old",
			token: testExecdToken,
			want:  "CMUX_EXECD_AUTH_TOKEN_EXTRA=x\x00CMUX_EXECD_AUTH_TOKEN=" + testExecdToken,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := upsertRuntimeEnv(tt.env, tt.token)
			if got != tt.want {
				t.Errorf("upsertRuntimeEnv(%q, %q) = %q, want %q", tt.env, tt.token, got, tt.want)
			}
			if n := strings.Count(got, "CMUX_EXECD_AUTH_TOKEN="); n > 1 {
				t.Errorf("upsertRuntimeEnv() output has %d CMUX_EXECD_AUTH_TOKEN entries, want at most 1: %q", n, got)
			}
		})
	}
}

func TestExecdTokenFileReader(t *testing.T) {
	valid := testExecdToken

	tests := []struct {
		name    string
		env     string // used verbatim when usePath is false
		usePath bool
		content string
		write   bool
		want    string
		wantErr bool
	}{
		{name: "unset or empty", env: ""},
		{name: "blank value", env: "   "},
		{name: "valid token with trailing newline", usePath: true, content: valid + "\n", write: true, want: valid},
		{name: "valid token with trailing CRLF", usePath: true, content: valid + "\r\n", write: true, want: valid},
		{name: "63 chars rejected", usePath: true, content: valid[:63], write: true, wantErr: true},
		{name: "65 chars rejected", usePath: true, content: valid + "a", write: true, wantErr: true},
		{name: "uppercase hex rejected", usePath: true, content: "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF", write: true, wantErr: true},
		{name: "non-hex rejected", usePath: true, content: "g" + valid[1:], write: true, wantErr: true},
		{name: "embedded newline rejected", usePath: true, content: valid[:32] + "\n" + valid[32:], write: true, wantErr: true},
		{name: "missing file rejected", usePath: true, write: false, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "smoke-token.txt")
			if tt.usePath {
				t.Setenv("PVE_EXECD_TOKEN_FILE", path)
			} else {
				t.Setenv("PVE_EXECD_TOKEN_FILE", tt.env)
			}
			if tt.write {
				if err := os.WriteFile(path, []byte(tt.content), 0o600); err != nil {
					t.Fatalf("write token file: %v", err)
				}
			}

			got, err := readExecTokenFile()
			if tt.wantErr {
				if err == nil {
					t.Fatal("readExecTokenFile() error = nil, want error")
				}
				if strings.Contains(err.Error(), path) {
					t.Errorf("readExecTokenFile() error leaks token file path: %v", err)
				}
				if tt.content != "" && strings.Contains(err.Error(), strings.TrimSpace(tt.content)) {
					t.Errorf("readExecTokenFile() error leaks token content: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("readExecTokenFile() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("readExecTokenFile() = %q, want %q", got, tt.want)
			}
		})
	}
}

type startInstanceRecorder struct {
	mu          sync.Mutex
	reqs        []string
	putEnv      string
	cloneCalls  int
	putCalls    int
	configCalls int
	startCalls  int
}

func (r *startInstanceRecorder) index(methodPath string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, req := range r.reqs {
		if req == methodPath {
			return i
		}
	}
	return -1
}

// newStartInstanceTestServer serves a minimal PVE API for StartInstance:
// empty node lists (VMID 200 is free), instant clone/start tasks, and the
// given config env (JSON-escaped, e.g. "A=1\u0000B=2") on GET config.
// putStatus != 0 makes the config PUT fail with that status.
func newStartInstanceTestServer(t *testing.T, configEnvJSON string, putStatus int) (*httptest.Server, *startInstanceRecorder) {
	t.Helper()
	rec := &startInstanceRecorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		rec.mu.Lock()
		rec.reqs = append(rec.reqs, r.Method+" "+path)
		rec.mu.Unlock()
		switch {
		case strings.HasSuffix(path, "/dns"):
			_, _ = w.Write([]byte(`{"data":{"search":""}}`))
		case r.Method == http.MethodGet && strings.HasSuffix(path, "/lxc"):
			_, _ = w.Write([]byte(`{"data":[]}`))
		case strings.HasSuffix(path, "/qemu"):
			_, _ = w.Write([]byte(`{"data":[]}`))
		case strings.HasSuffix(path, "/clone"):
			rec.mu.Lock()
			rec.cloneCalls++
			rec.mu.Unlock()
			_, _ = w.Write([]byte(`{"data":"UPID:0"}`))
		case strings.HasSuffix(path, "/status/current"):
			_, _ = w.Write([]byte(`{"data":{"status":"stopped","vmid":200}}`))
		case strings.HasSuffix(path, "/status/start"):
			rec.mu.Lock()
			rec.startCalls++
			rec.mu.Unlock()
			_, _ = w.Write([]byte(`{"data":"UPID:0"}`))
		case r.Method == http.MethodGet && strings.HasSuffix(path, "/config"):
			rec.mu.Lock()
			rec.configCalls++
			rec.mu.Unlock()
			_, _ = w.Write([]byte(`{"data":{"hostname":"cmux-200","env":"` + configEnvJSON + `"}}`))
		case r.Method == http.MethodPut && strings.HasSuffix(path, "/config"):
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse PUT config form: %v", err)
			}
			rec.mu.Lock()
			rec.putCalls++
			rec.putEnv = r.Form.Get("env")
			rec.mu.Unlock()
			if putStatus != 0 {
				w.WriteHeader(putStatus)
				// Deliberately echo the submitted env in the error body so
				// a leak would surface the token in the returned error.
				_, _ = w.Write([]byte(`{"errors":{"env":"` + r.Form.Get("env") + `"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"data":null}`))
		case r.Method == http.MethodDelete && strings.HasSuffix(path, "/lxc/200"):
			_, _ = w.Write([]byte(`{"data":"UPID:0"}`))
		case strings.HasSuffix(path, "/status"):
			_, _ = w.Write([]byte(`{"data":{"status":"stopped","exitstatus":"OK"}}`))
		default:
			t.Errorf("unexpected PVE API request: %s %s", r.Method, path)
			_, _ = w.Write([]byte(`{"data":null}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

func newStartTestClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	return &Client{
		apiURL:       srv.URL,
		apiToken:     "token",
		publicDomain: "example.com",
		apiHTTP:      srv.Client(),
		execHTTP:     &http.Client{Timeout: 0},
		node:         "test-node",
	}
}

func writeExecdTokenFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "smoke-token.txt")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write token file: %v", err)
	}
	return path
}

func TestExecdTokenFileInjectedBeforeCloneStart(t *testing.T) {
	t.Setenv("PVE_EXECD_TOKEN_FILE", writeExecdTokenFile(t, testExecdToken+"\n"))

	srv, rec := newStartInstanceTestServer(t, "EXISTING=value", 0)
	client := newStartTestClient(t, srv)

	inst, err := client.StartInstance(context.Background(), StartOptions{SnapshotID: defaultSnapshotID})
	if err != nil {
		t.Fatalf("StartInstance() error = %v", err)
	}
	if inst == nil || inst.VMID != 200 {
		t.Fatalf("StartInstance() = %+v, want VMID 200", inst)
	}

	const (
		cloneReq = "POST /api2/json/nodes/test-node/lxc/9027/clone"
		putReq   = "PUT /api2/json/nodes/test-node/lxc/200/config"
		startReq = "POST /api2/json/nodes/test-node/lxc/200/status/start"
	)
	idxClone, idxPut, idxStart := rec.index(cloneReq), rec.index(putReq), rec.index(startReq)
	if idxClone < 0 {
		t.Fatalf("clone request not recorded; requests: %v", rec.reqs)
	}
	if idxPut < 0 || idxStart < 0 || idxPut > idxStart {
		t.Fatalf("config PUT must precede start POST; requests: %v", rec.reqs)
	}
	if idxPut < idxClone {
		t.Fatalf("config PUT must follow clone POST; requests: %v", rec.reqs)
	}

	wantEnv := "EXISTING=value\x00CMUX_EXECD_AUTH_TOKEN=" + testExecdToken
	if rec.putEnv != wantEnv {
		t.Errorf("PUT env = %q, want %q", rec.putEnv, wantEnv)
	}
	if got := strings.Count(rec.putEnv, "EXISTING=value"); got != 1 {
		t.Errorf("PUT env preserves EXISTING=value %d times, want exactly 1: %q", got, rec.putEnv)
	}
	if got := strings.Count(rec.putEnv, "CMUX_EXECD_AUTH_TOKEN="); got != 1 {
		t.Errorf("PUT env has %d CMUX_EXECD_AUTH_TOKEN entries, want exactly 1: %q", got, rec.putEnv)
	}
	rec.mu.Lock()
	configCalls, putCalls := rec.configCalls, rec.putCalls
	rec.mu.Unlock()
	if configCalls != 1 {
		t.Errorf("config GET calls = %d, want exactly 1", configCalls)
	}
	if putCalls != 1 {
		t.Errorf("config PUT calls = %d, want exactly 1", putCalls)
	}

	client.execTokenMu.Lock()
	cached := client.execToken
	client.execTokenMu.Unlock()
	if cached != testExecdToken {
		t.Errorf("cached exec token = %q, want the injected token", cached)
	}
}

func TestExecdTokenFileReplacesStaleEntry(t *testing.T) {
	t.Setenv("PVE_EXECD_TOKEN_FILE", writeExecdTokenFile(t, testExecdToken))

	srv, rec := newStartInstanceTestServer(t, "EXISTING=value\\u0000CMUX_EXECD_AUTH_TOKEN=old", 0)
	client := newStartTestClient(t, srv)

	if _, err := client.StartInstance(context.Background(), StartOptions{SnapshotID: defaultSnapshotID}); err != nil {
		t.Fatalf("StartInstance() error = %v", err)
	}

	wantEnv := "EXISTING=value\x00CMUX_EXECD_AUTH_TOKEN=" + testExecdToken
	if rec.putEnv != wantEnv {
		t.Errorf("PUT env = %q, want %q", rec.putEnv, wantEnv)
	}
	if got := strings.Count(rec.putEnv, "EXISTING=value"); got != 1 {
		t.Errorf("PUT env preserves EXISTING=value %d times, want exactly 1: %q", got, rec.putEnv)
	}
	if got := strings.Count(rec.putEnv, "CMUX_EXECD_AUTH_TOKEN="); got != 1 {
		t.Errorf("PUT env has %d CMUX_EXECD_AUTH_TOKEN entries, want exactly 1: %q", got, rec.putEnv)
	}
	rec.mu.Lock()
	configCalls, putCalls := rec.configCalls, rec.putCalls
	rec.mu.Unlock()
	if configCalls != 1 {
		t.Errorf("config GET calls = %d, want exactly 1", configCalls)
	}
	if putCalls != 1 {
		t.Errorf("config PUT calls = %d, want exactly 1", putCalls)
	}
}

func TestExecdTokenFileNoUpdateWithoutFile(t *testing.T) {
	// Unset and empty PVE_EXECD_TOKEN_FILE both mean no injection: the
	// clone must start without any config update and without seeding the
	// cached exec token.
	for _, tc := range []struct {
		name string
		env  string
	}{
		{name: "unset", env: "unset"},
		{name: "empty", env: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.env == "unset" {
				old, had := os.LookupEnv("PVE_EXECD_TOKEN_FILE")
				os.Unsetenv("PVE_EXECD_TOKEN_FILE")
				t.Cleanup(func() {
					if had {
						os.Setenv("PVE_EXECD_TOKEN_FILE", old)
					} else {
						os.Unsetenv("PVE_EXECD_TOKEN_FILE")
					}
				})
			} else {
				t.Setenv("PVE_EXECD_TOKEN_FILE", "")
			}

			srv, rec := newStartInstanceTestServer(t, "", 0)
			client := newStartTestClient(t, srv)

			// A prior smoke clone's cached token must be cleared so this
			// instance falls back to its SSH/API token path.
			client.execTokenMu.Lock()
			client.execToken = testExecdToken
			client.execTokenMu.Unlock()

			if _, err := client.StartInstance(context.Background(), StartOptions{SnapshotID: defaultSnapshotID}); err != nil {
				t.Fatalf("StartInstance() error = %v", err)
			}

			rec.mu.Lock()
			putCalls, configCalls := rec.putCalls, rec.configCalls
			rec.mu.Unlock()
			if putCalls != 0 {
				t.Errorf("config PUT calls = %d, want 0 (no token file)", putCalls)
			}
			if configCalls != 0 {
				t.Errorf("config GET calls = %d, want 0 (no token file)", configCalls)
			}

			client.execTokenMu.Lock()
			cached := client.execToken
			client.execTokenMu.Unlock()
			if cached != "" {
				t.Errorf("cached exec token = %q, want cleared (no injection)", cached)
			}
		})
	}
}

func TestExecdTokenFileInvalidContentRejectedBeforeStart(t *testing.T) {
	tokenFile := writeExecdTokenFile(t, "not-a-64-char-hex-token")
	t.Setenv("PVE_EXECD_TOKEN_FILE", tokenFile)

	srv, rec := newStartInstanceTestServer(t, "", 0)
	client := newStartTestClient(t, srv)

	if _, err := client.StartInstance(context.Background(), StartOptions{SnapshotID: defaultSnapshotID}); err == nil {
		t.Fatal("StartInstance() error = nil, want invalid token error")
	} else {
		if strings.Contains(err.Error(), tokenFile) {
			t.Errorf("StartInstance() error leaks token file path: %v", err)
		}
		if strings.Contains(err.Error(), "not-a-64-char-hex-token") {
			t.Errorf("StartInstance() error leaks token content: %v", err)
		}
	}

	rec.mu.Lock()
	cloneCalls, putCalls, startCalls := rec.cloneCalls, rec.putCalls, rec.startCalls
	rec.mu.Unlock()
	if cloneCalls != 0 || putCalls != 0 || startCalls != 0 {
		t.Errorf("requests after invalid token: clone=%d put=%d start=%d, want all 0", cloneCalls, putCalls, startCalls)
	}
}

func TestExecdTokenFileInjectionFailureDeletesClone(t *testing.T) {
	t.Setenv("PVE_EXECD_TOKEN_FILE", writeExecdTokenFile(t, testExecdToken))

	srv, rec := newStartInstanceTestServer(t, "", http.StatusInternalServerError)
	client := newStartTestClient(t, srv)

	if _, err := client.StartInstance(context.Background(), StartOptions{SnapshotID: defaultSnapshotID}); err == nil {
		t.Fatal("StartInstance() error = nil, want config injection error")
	} else if strings.Contains(err.Error(), testExecdToken) {
		t.Errorf("StartInstance() error leaks the injected token: %v", err)
	}
	if idxDelete := rec.index("DELETE /api2/json/nodes/test-node/lxc/200"); idxDelete < 0 {
		t.Fatalf("clone deletion not requested after injection failure; requests: %v", rec.reqs)
	}
	if idxStart := rec.index("POST /api2/json/nodes/test-node/lxc/200/status/start"); idxStart >= 0 {
		t.Fatalf("start requested despite injection failure; requests: %v", rec.reqs)
	}
}
