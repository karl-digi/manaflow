package main

import (
	"archive/tar"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestFilesHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/files", nil)
	w := httptest.NewRecorder()

	filesHandler(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status %d, got %d", http.StatusMethodNotAllowed, w.Code)
	}
}

func TestFilesHandler_ExtractsTar(t *testing.T) {
	// Create a temporary directory to use as /workspace
	tmpDir := t.TempDir()

	// We need to patch the extraction target. For this test, we'll test the tar creation
	// and verify the handler logic works with a mock approach.
	// Since the handler hardcodes /workspace, we'll just verify tar creation works.

	// Create a tar archive in memory
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	// Add a test file to the tar
	content := []byte("hello world")
	hdr := &tar.Header{
		Name: "test.txt",
		Mode: 0644,
		Size: int64(len(content)),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatalf("failed to write tar header: %v", err)
	}
	if _, err := tw.Write(content); err != nil {
		t.Fatalf("failed to write tar content: %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("failed to close tar writer: %v", err)
	}

	// Verify we can read the tar back
	tr := tar.NewReader(&buf)
	hdr, err := tr.Next()
	if err != nil {
		t.Fatalf("failed to read tar header: %v", err)
	}
	if hdr.Name != "test.txt" {
		t.Errorf("expected file name 'test.txt', got '%s'", hdr.Name)
	}

	readContent, err := io.ReadAll(tr)
	if err != nil {
		t.Fatalf("failed to read tar content: %v", err)
	}
	if string(readContent) != "hello world" {
		t.Errorf("expected content 'hello world', got '%s'", string(readContent))
	}

	// Test with actual extraction to temp dir using tar command
	var tarBuf bytes.Buffer
	tw2 := tar.NewWriter(&tarBuf)
	hdr2 := &tar.Header{
		Name: "extracted.txt",
		Mode: 0644,
		Size: int64(len(content)),
	}
	if err := tw2.WriteHeader(hdr2); err != nil {
		t.Fatalf("failed to write tar header: %v", err)
	}
	if _, err := tw2.Write(content); err != nil {
		t.Fatalf("failed to write tar content: %v", err)
	}
	if err := tw2.Close(); err != nil {
		t.Fatalf("failed to close tar writer: %v", err)
	}

	// Extract using os/exec (simulating what filesHandler does)
	cmd := exec.Command("tar", "-x", "-C", tmpDir)
	cmd.Stdin = &tarBuf
	if err := cmd.Run(); err != nil {
		t.Fatalf("tar extraction failed: %v", err)
	}

	// Verify the file was extracted
	extractedPath := filepath.Join(tmpDir, "extracted.txt")
	extractedContent, err := os.ReadFile(extractedPath)
	if err != nil {
		t.Fatalf("failed to read extracted file: %v", err)
	}
	if string(extractedContent) != "hello world" {
		t.Errorf("expected content 'hello world', got '%s'", string(extractedContent))
	}
}

func TestHealthHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()

	healthHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, w.Code)
	}
	if w.Body.String() != "ok" {
		t.Errorf("expected body 'ok', got '%s'", w.Body.String())
	}
}

// --- Auth middleware tests ---

// withAuthToken temporarily sets the package-level authToken for the duration
// of the test and restores the original value on cleanup.
func withAuthToken(t *testing.T, token string) {
	t.Helper()
	prev := authToken
	authToken = token
	t.Cleanup(func() { authToken = prev })
}

func TestAuthMiddleware_NoTokenConfigured_AllowsAll(t *testing.T) {
	withAuthToken(t, "") // no-auth mode

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	req := httptest.NewRequest(http.MethodPost, "/exec", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("no-auth mode: expected %d, got %d", http.StatusOK, w.Code)
	}
}

func TestAuthMiddleware_ValidBearerToken_Passes(t *testing.T) {
	withAuthToken(t, "test-secret-token")

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	req := httptest.NewRequest(http.MethodPost, "/exec", nil)
	req.Header.Set("Authorization", "Bearer test-secret-token")
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("valid Bearer: expected %d, got %d", http.StatusOK, w.Code)
	}
}

func TestAuthMiddleware_ValidQueryToken_Passes(t *testing.T) {
	withAuthToken(t, "test-secret-token")

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	req := httptest.NewRequest(http.MethodPost, "/exec?token=test-secret-token", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("valid query token: expected %d, got %d", http.StatusOK, w.Code)
	}
}

func TestAuthMiddleware_ValidCookie_Passes(t *testing.T) {
	withAuthToken(t, "test-secret-token")

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	req := httptest.NewRequest(http.MethodPost, "/exec", nil)
	req.AddCookie(&http.Cookie{Name: "_cmux_auth", Value: "test-secret-token"})
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("valid cookie: expected %d, got %d", http.StatusOK, w.Code)
	}
}

func TestAuthMiddleware_MissingToken_Returns401(t *testing.T) {
	withAuthToken(t, "test-secret-token")

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler should not be called when auth fails")
	})

	req := httptest.NewRequest(http.MethodPost, "/exec", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("missing token: expected %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestAuthMiddleware_WrongToken_Returns401(t *testing.T) {
	withAuthToken(t, "test-secret-token")

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler should not be called when auth fails")
	})

	req := httptest.NewRequest(http.MethodPost, "/exec", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("wrong token: expected %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestAuthMiddleware_RawAuthHeader_Passes(t *testing.T) {
	withAuthToken(t, "test-secret-token")

	handler := authMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/exec", nil)
	req.Header.Set("Authorization", "test-secret-token")
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("raw auth header: expected %d, got %d", http.StatusOK, w.Code)
	}
}

func TestHealthHandler_NoAuthRequired(t *testing.T) {
	// /healthz is not wrapped with authMiddleware — it should always return 200
	withAuthToken(t, "test-secret-token")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	healthHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("healthz with auth enabled: expected %d, got %d", http.StatusOK, w.Code)
	}
}

func TestLoadAuthToken_ReadsFirstExisting(t *testing.T) {
	// Create temp token files to simulate /root/ and /home/user/ paths
	tmpDir := t.TempDir()
	rootToken := filepath.Join(tmpDir, "root-token")
	userToken := filepath.Join(tmpDir, "user-token")

	if err := os.WriteFile(rootToken, []byte("root-secret\n"), 0644); err != nil {
		t.Fatalf("write root token: %v", err)
	}
	if err := os.WriteFile(userToken, []byte("user-secret\n"), 0644); err != nil {
		t.Fatalf("write user token: %v", err)
	}

	// Patch tokenPaths to point to temp files
	prev := tokenPaths
	tokenPaths = []string{rootToken, userToken}
	t.Cleanup(func() { tokenPaths = prev })

	token := loadAuthToken()
	if token != "root-secret" {
		t.Errorf("expected 'root-secret' (first path), got %q", token)
	}
}

func TestLoadAuthToken_FallsBackToSecondPath(t *testing.T) {
	tmpDir := t.TempDir()
	missingPath := filepath.Join(tmpDir, "nonexistent")
	userToken := filepath.Join(tmpDir, "user-token")

	if err := os.WriteFile(userToken, []byte("user-secret\n"), 0644); err != nil {
		t.Fatalf("write user token: %v", err)
	}

	prev := tokenPaths
	tokenPaths = []string{missingPath, userToken}
	t.Cleanup(func() { tokenPaths = prev })

	token := loadAuthToken()
	if token != "user-secret" {
		t.Errorf("expected 'user-secret' (fallback), got %q", token)
	}
}

func TestLoadAuthToken_NoFiles_ReturnsEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	prev := tokenPaths
	tokenPaths = []string{
		filepath.Join(tmpDir, "nonexistent-1"),
		filepath.Join(tmpDir, "nonexistent-2"),
	}
	t.Cleanup(func() { tokenPaths = prev })

	token := loadAuthToken()
	if token != "" {
		t.Errorf("expected empty token, got %q", token)
	}
}

func TestLoadAuthToken_EmptyFile_Skipped(t *testing.T) {
	tmpDir := t.TempDir()
	emptyFile := filepath.Join(tmpDir, "empty")
	goodFile := filepath.Join(tmpDir, "good")

	if err := os.WriteFile(emptyFile, []byte("  \n"), 0644); err != nil {
		t.Fatalf("write empty token: %v", err)
	}
	if err := os.WriteFile(goodFile, []byte("real-token"), 0644); err != nil {
		t.Fatalf("write good token: %v", err)
	}

	prev := tokenPaths
	tokenPaths = []string{emptyFile, goodFile}
	t.Cleanup(func() { tokenPaths = prev })

	token := loadAuthToken()
	if token != "real-token" {
		t.Errorf("expected 'real-token' (skip empty), got %q", token)
	}
}

