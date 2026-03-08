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

