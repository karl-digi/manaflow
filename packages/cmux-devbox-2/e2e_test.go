//go:build e2e
// +build e2e

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// E2E tests for cmux CLI.
//
// These tests require:
// - Valid authentication (cmux login)
// - Network connectivity
// - For Daytona provider: a running proxy (apps/global-proxy) so worker URLs are reachable in dev.
//
// Run with:
//   go test -tags e2e -v -timeout 30m ./...

func defaultDaytonaProxyOrigin() string {
	if origin := os.Getenv("CMUX_DAYTONA_PROXY_ORIGIN"); origin != "" {
		return origin
	}
	return "http://cmux.localhost:8080"
}

func assertDaytonaProxyReachable(t *testing.T) {
	t.Helper()

	origin := defaultDaytonaProxyOrigin()
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		t.Fatalf("invalid CMUX_DAYTONA_PROXY_ORIGIN %q: %v", origin, err)
	}

	hostPort := parsed.Host
	if !strings.Contains(hostPort, ":") {
		if parsed.Scheme == "https" {
			hostPort = hostPort + ":443"
		} else {
			hostPort = hostPort + ":80"
		}
	}

	conn, err := net.DialTimeout("tcp", hostPort, 2*time.Second)
	if err != nil {
		t.Fatalf(
			"Daytona proxy not reachable at %s (dial %s): %v\nStart it with: cd apps/global-proxy && GLOBAL_PROXY_BIND=127.0.0.1:8080 cargo run",
			origin,
			hostPort,
			err,
		)
	}
	_ = conn.Close()
}

// runCmux executes a cmux command and returns stdout, stderr, and error.
func runCmux(provider string, args ...string) (string, string, error) {
	cmdArgs := []string{"run", "./cmd/cmux"}
	if provider != "" {
		cmdArgs = append(cmdArgs, "--provider", provider)
	}
	cmdArgs = append(cmdArgs, args...)

	cmd := exec.Command("go", cmdArgs...)
	cmd.Dir = getProjectRoot()
	cmd.Env = os.Environ()
	if provider == "daytona" {
		cmd.Env = append(cmd.Env, "CMUX_DAYTONA_PROXY_ORIGIN="+defaultDaytonaProxyOrigin())
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

// runCmuxWithTimeout executes a cmux command with a timeout.
func runCmuxWithTimeout(timeout time.Duration, provider string, args ...string) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmdArgs := []string{"run", "./cmd/cmux"}
	if provider != "" {
		cmdArgs = append(cmdArgs, "--provider", provider)
	}
	cmdArgs = append(cmdArgs, args...)

	cmd := exec.CommandContext(ctx, "go", cmdArgs...)
	cmd.Dir = getProjectRoot()
	cmd.Env = os.Environ()
	if provider == "daytona" {
		cmd.Env = append(cmd.Env, "CMUX_DAYTONA_PROXY_ORIGIN="+defaultDaytonaProxyOrigin())
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return stdout.String(), stderr.String(), fmt.Errorf("command timed out after %v", timeout)
	}
	return stdout.String(), stderr.String(), err
}

func getProjectRoot() string {
	_, err := os.Getwd()
	if err != nil {
		return "."
	}
	return "."
}

// ===========================================================================
// Basic Command Tests (no sandbox required)
// ===========================================================================

func TestVersion(t *testing.T) {
	stdout, _, err := runCmux("", "version")
	if err != nil {
		t.Fatalf("version command failed: %v", err)
	}

	if !strings.Contains(stdout, "cmux") {
		t.Errorf("version output should contain 'cmux', got: %s", stdout)
	}
}

func TestWhoami(t *testing.T) {
	stdout, _, err := runCmux("", "whoami")
	if err != nil {
		t.Fatalf("whoami command failed: %v", err)
	}

	if !strings.Contains(stdout, "User:") {
		t.Errorf("whoami output should contain 'User:', got: %s", stdout)
	}
	if !strings.Contains(stdout, "Team:") {
		t.Errorf("whoami output should contain 'Team:', got: %s", stdout)
	}
}

func TestTemplates(t *testing.T) {
	stdout, _, err := runCmux("e2b", "templates")
	if err != nil {
		t.Fatalf("templates command failed: %v", err)
	}

	if !strings.Contains(stdout, "Templates:") {
		t.Errorf("templates output should contain 'Templates:', got: %s", stdout)
	}
}

func TestHelp(t *testing.T) {
	stdout, _, err := runCmux("", "--help")
	if err != nil {
		t.Fatalf("help command failed: %v", err)
	}

	expectedCommands := []string{"start", "stop", "delete", "exec", "status", "upload", "download", "pty", "computer"}
	for _, cmd := range expectedCommands {
		if !strings.Contains(stdout, cmd) {
			t.Errorf("help output should contain '%s', got: %s", cmd, stdout)
		}
	}
}

// ===========================================================================
// Sandbox Lifecycle Tests
// ===========================================================================

func TestSandboxLifecycle(t *testing.T) {
	providers := []string{"e2b", "daytona"}

	for _, provider := range providers {
		provider := provider
		t.Run(provider, func(t *testing.T) {
			if provider == "daytona" {
				assertDaytonaProxyReachable(t)
			}

			startTimeout := 2 * time.Minute
			if provider == "daytona" {
				startTimeout = 15 * time.Minute
			}

			stdout, stderr, err := runCmuxWithTimeout(startTimeout, provider, "start", "--name", "E2E Test "+provider)
			if err != nil {
				t.Fatalf("start command failed: %v\nstdout: %s\nstderr: %s", err, stdout, stderr)
			}

			sandboxID := ""
			for _, line := range strings.Split(stdout, "\n") {
				if strings.HasPrefix(line, "Created sandbox:") {
					parts := strings.Fields(line)
					if len(parts) >= 3 {
						sandboxID = parts[2]
					}
				}
			}
			if sandboxID == "" {
				t.Fatalf("failed to extract sandbox ID from output: %s", stdout)
			}

			t.Cleanup(func() {
				_, _, _ = runCmuxWithTimeout(2*time.Minute, provider, "delete", sandboxID)
			})

			// Status
			t.Run("Status", func(t *testing.T) {
				out, _, err := runCmux(provider, "status", sandboxID)
				if err != nil {
					t.Fatalf("status command failed: %v", err)
				}
				if !strings.Contains(strings.ToLower(out), "running") {
					t.Errorf("status should show 'running', got: %s", out)
				}
				if !strings.Contains(out, sandboxID) {
					t.Errorf("status should contain sandbox ID, got: %s", out)
				}
			})

			// Status JSON
			t.Run("StatusJSON", func(t *testing.T) {
				out, _, err := runCmux(provider, "status", sandboxID, "--json")
				if err != nil {
					t.Fatalf("status --json command failed: %v", err)
				}

				var status struct {
					ID     string `json:"id"`
					Status string `json:"status"`
				}
				if err := json.Unmarshal([]byte(out), &status); err != nil {
					t.Fatalf("failed to parse JSON output: %v\noutput: %s", err, out)
				}
				if status.Status != "running" {
					t.Errorf("status should be 'running', got: %q", status.Status)
				}
				if status.ID != sandboxID {
					t.Errorf("status id mismatch: expected %q, got %q", sandboxID, status.ID)
				}
			})

			// Exec
			t.Run("Exec", func(t *testing.T) {
				// Pass command and args as separate CLI args to match real shell behavior.
				out, _, err := runCmux(provider, "exec", sandboxID, "echo", "Hello from E2E test")
				if err != nil {
					t.Fatalf("exec command failed: %v", err)
				}
				if !strings.Contains(out, "Hello from E2E test") {
					t.Errorf("exec output should contain echo result, got: %s", out)
				}
			})

			// PTY List
			t.Run("PTYList", func(t *testing.T) {
				out, _, err := runCmux(provider, "pty-list", sandboxID)
				if err != nil {
					t.Fatalf("pty-list command failed: %v", err)
				}
				if !strings.Contains(out, "No active PTY sessions") && !strings.Contains(out, "SESSION ID") {
					t.Errorf("pty-list output unexpected: %s", out)
				}
			})

			// Upload single file
			var uploadedBasename string
			var uploadedContent string
			t.Run("UploadFile", func(t *testing.T) {
				tmpFile, err := os.CreateTemp("", "cmux-e2e-*.txt")
				if err != nil {
					t.Fatalf("failed to create temp file: %v", err)
				}
				t.Cleanup(func() { _ = os.Remove(tmpFile.Name()) })

				uploadedBasename = filepath.Base(tmpFile.Name())
				uploadedContent = fmt.Sprintf("E2E test content %d", time.Now().Unix())
				if _, err := tmpFile.WriteString(uploadedContent); err != nil {
					t.Fatalf("failed to write temp file: %v", err)
				}
				_ = tmpFile.Close()

				out, errOut, err := runCmuxWithTimeout(60*time.Second, provider, "upload", sandboxID, tmpFile.Name(), "-r", "/home/user/workspace")
				if err != nil {
					t.Fatalf("upload command failed: %v\nstdout: %s\nstderr: %s", err, out, errOut)
				}
				if !strings.Contains(out, "Uploaded") {
					t.Errorf("upload output should confirm upload, got: %s", out)
				}

				verifyStdout, _, err := runCmux(provider, "exec", sandboxID, "cat /home/user/workspace/"+uploadedBasename)
				if err != nil {
					t.Fatalf("failed to verify uploaded file: %v", err)
				}
				if !strings.Contains(verifyStdout, uploadedContent) {
					t.Errorf("uploaded file content mismatch, expected %q, got: %s", uploadedContent, verifyStdout)
				}
			})

			// Upload directory (rsync)
			t.Run("UploadDir", func(t *testing.T) {
				tmpDir, err := os.MkdirTemp("", "cmux-e2e-upload-dir-*")
				if err != nil {
					t.Fatalf("failed to create temp dir: %v", err)
				}
				t.Cleanup(func() { _ = os.RemoveAll(tmpDir) })

				for i := 1; i <= 3; i++ {
					content := fmt.Sprintf("file %d content", i)
					if err := os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte(content), 0644); err != nil {
						t.Fatalf("failed to create test file: %v", err)
					}
				}

				out, errOut, err := runCmuxWithTimeout(2*time.Minute, provider, "upload", sandboxID, tmpDir, "-r", "/home/user/e2e-sync")
				if err != nil {
					t.Fatalf("upload dir command failed: %v\nstdout: %s\nstderr: %s", err, out, errOut)
				}
				if !strings.Contains(out, "Synced") && !strings.Contains(out, "Sync") {
					t.Errorf("upload dir output unexpected: %s", out)
				}

				verifyStdout, _, err := runCmux(provider, "exec", sandboxID, "ls -la /home/user/e2e-sync/")
				if err != nil {
					t.Fatalf("failed to verify synced files: %v", err)
				}
				for i := 1; i <= 3; i++ {
					if !strings.Contains(verifyStdout, fmt.Sprintf("file%d.txt", i)) {
						t.Errorf("synced directory should contain file%d.txt, got: %s", i, verifyStdout)
					}
				}
			})

			// Download workspace
			t.Run("Download", func(t *testing.T) {
				tmpOutDir, err := os.MkdirTemp("", "cmux-e2e-download-*")
				if err != nil {
					t.Fatalf("failed to create temp dir: %v", err)
				}
				t.Cleanup(func() { _ = os.RemoveAll(tmpOutDir) })

				out, errOut, err := runCmuxWithTimeout(2*time.Minute, provider, "download", sandboxID, tmpOutDir, "-r", "/home/user/workspace")
				if err != nil {
					t.Fatalf("download command failed: %v\nstdout: %s\nstderr: %s", err, out, errOut)
				}

				downloaded := filepath.Join(tmpOutDir, uploadedBasename)
				data, err := os.ReadFile(downloaded)
				if err != nil {
					t.Fatalf("downloaded file missing: %v", err)
				}
				if !strings.Contains(string(data), uploadedContent) {
					t.Fatalf("downloaded file content mismatch, expected %q, got: %s", uploadedContent, string(data))
				}
			})

			// Extend
			t.Run("Extend", func(t *testing.T) {
				out, _, err := runCmux(provider, "extend", sandboxID)
				if err != nil {
					t.Fatalf("extend command failed: %v", err)
				}
				if !strings.Contains(out, "Extended timeout by") {
					t.Errorf("extend output unexpected: %s", out)
				}
			})

			// Code/VNC print URLs (no browser open)
			t.Run("CodePrint", func(t *testing.T) {
				out, _, err := runCmux(provider, "code", sandboxID, "--print")
				if err != nil {
					t.Fatalf("code --print command failed: %v", err)
				}
				if !strings.Contains(out, "tkn=") {
					t.Errorf("code --print should include token, got: %s", out)
				}
			})

			t.Run("VNCPrint", func(t *testing.T) {
				out, _, err := runCmux(provider, "vnc", sandboxID, "--print")
				if err != nil {
					t.Fatalf("vnc --print command failed: %v", err)
				}
				if !strings.Contains(out, "tkn=") {
					t.Errorf("vnc --print should include token, got: %s", out)
				}
			})

			// Computer screenshot (saves to file)
			t.Run("ComputerScreenshot", func(t *testing.T) {
				tmpPng, err := os.CreateTemp("", "cmux-e2e-*.png")
				if err != nil {
					t.Fatalf("failed to create temp png: %v", err)
				}
				_ = tmpPng.Close()
				t.Cleanup(func() { _ = os.Remove(tmpPng.Name()) })

				out, errOut, err := runCmuxWithTimeout(2*time.Minute, provider, "computer", "screenshot", sandboxID, tmpPng.Name())
				if err != nil {
					t.Fatalf("computer screenshot command failed: %v\nstdout: %s\nstderr: %s", err, out, errOut)
				}

				data, err := os.ReadFile(tmpPng.Name())
				if err != nil {
					t.Fatalf("failed to read screenshot: %v", err)
				}
				if len(data) < 8 || !bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G'}) {
					t.Fatalf("screenshot file does not look like a PNG (len=%d)", len(data))
				}
			})

			// Stop
			t.Run("Stop", func(t *testing.T) {
				out, _, err := runCmux(provider, "stop", sandboxID)
				if err != nil {
					t.Fatalf("stop command failed: %v", err)
				}
				if !strings.Contains(out, "Stopped:") {
					t.Errorf("stop output unexpected: %s", out)
				}
			})

			// Delete
			t.Run("Delete", func(t *testing.T) {
				out, _, err := runCmux(provider, "delete", sandboxID)
				if err != nil {
					t.Fatalf("delete command failed: %v", err)
				}
				if !strings.Contains(out, "Deleted:") {
					t.Errorf("delete output unexpected: %s", out)
				}
			})
		})
	}
}

// ===========================================================================
// Skills Tests
// ===========================================================================

func TestSkillsInstall(t *testing.T) {
	stdout, _, err := runCmux("", "skills", "install")
	if err != nil {
		t.Fatalf("skills install command failed: %v", err)
	}

	if !strings.Contains(stdout, "Skill") {
		t.Errorf("skills install output should mention skill, got: %s", stdout)
	}
}

// ===========================================================================
// Error Handling Tests
// ===========================================================================

func TestInvalidSandboxID(t *testing.T) {
	_, stderr, err := runCmux("", "status", "invalid_sandbox_id_12345")
	if err == nil {
		t.Error("expected error for invalid sandbox ID")
	}

	// Should show some error message
	combined := stderr
	if !strings.Contains(strings.ToLower(combined), "error") && !strings.Contains(strings.ToLower(combined), "not found") {
		t.Logf("Warning: error message may not be descriptive: %s", combined)
	}
}

func TestMissingArguments(t *testing.T) {
	testCases := []struct {
		name string
		args []string
	}{
		{"exec without sandbox", []string{"exec"}},
		{"status without sandbox", []string{"status"}},
		{"upload without args", []string{"upload"}},
		{"download without args", []string{"download"}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := runCmux("", tc.args...)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}
