// Package auth provides authentication for the devsh CLI via Stack Auth.
package auth

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

func TestSetBuildMode(t *testing.T) {
	// Save original
	orig := buildMode
	defer func() { buildMode = orig }()

	SetBuildMode("dev")
	if GetBuildMode() != "dev" {
		t.Errorf("expected mode 'dev', got '%s'", GetBuildMode())
	}

	SetBuildMode("prod")
	if GetBuildMode() != "prod" {
		t.Errorf("expected mode 'prod', got '%s'", GetBuildMode())
	}

	// Invalid mode should be ignored
	SetBuildMode("invalid")
	if GetBuildMode() != "prod" {
		t.Errorf("expected mode to remain 'prod' after invalid set, got '%s'", GetBuildMode())
	}
}

func TestGetDefaultsForMode(t *testing.T) {
	// Save original
	orig := buildMode
	defer func() { buildMode = orig }()

	// Test dev mode
	SetBuildMode("dev")
	projectID, publishableKey, cmuxURL, convexSiteURL, serverURL := getDefaultsForMode()

	if projectID != DevProjectID {
		t.Errorf("dev mode: expected DevProjectID, got '%s'", projectID)
	}
	if publishableKey != DevPublishableKey {
		t.Errorf("dev mode: expected DevPublishableKey, got '%s'", publishableKey)
	}
	if cmuxURL != DevCmuxURL {
		t.Errorf("dev mode: expected DevCmuxURL, got '%s'", cmuxURL)
	}
	if convexSiteURL != DevConvexSiteURL {
		t.Errorf("dev mode: expected DevConvexSiteURL, got '%s'", convexSiteURL)
	}
	if serverURL != DevServerURL {
		t.Errorf("dev mode: expected DevServerURL, got '%s'", serverURL)
	}

	// Test prod mode
	SetBuildMode("prod")
	projectID, publishableKey, cmuxURL, convexSiteURL, serverURL = getDefaultsForMode()

	if projectID != ProdProjectID {
		t.Errorf("prod mode: expected ProdProjectID, got '%s'", projectID)
	}
	if publishableKey != ProdPublishableKey {
		t.Errorf("prod mode: expected ProdPublishableKey, got '%s'", publishableKey)
	}
	if cmuxURL != ProdCmuxURL {
		t.Errorf("prod mode: expected ProdCmuxURL, got '%s'", cmuxURL)
	}
	if convexSiteURL != ProdConvexSiteURL {
		t.Errorf("prod mode: expected ProdConvexSiteURL, got '%s'", convexSiteURL)
	}
	// Prod mode has empty serverURL by default
	if serverURL != "" {
		t.Errorf("prod mode: expected empty serverURL, got '%s'", serverURL)
	}
}

func TestSetConfigOverrides(t *testing.T) {
	// Save originals
	origProjectID := cliProjectID
	origPublishableKey := cliPublishableKey
	origCmuxURL := cliCmuxURL
	origConvexSiteURL := cliConvexSiteURL
	defer func() {
		cliProjectID = origProjectID
		cliPublishableKey = origPublishableKey
		cliCmuxURL = origCmuxURL
		cliConvexSiteURL = origConvexSiteURL
	}()

	SetConfigOverrides("test-project", "test-key", "http://test.com", "http://convex.test")

	if cliProjectID != "test-project" {
		t.Errorf("expected cliProjectID 'test-project', got '%s'", cliProjectID)
	}
	if cliPublishableKey != "test-key" {
		t.Errorf("expected cliPublishableKey 'test-key', got '%s'", cliPublishableKey)
	}
	if cliCmuxURL != "http://test.com" {
		t.Errorf("expected cliCmuxURL 'http://test.com', got '%s'", cliCmuxURL)
	}
	if cliConvexSiteURL != "http://convex.test" {
		t.Errorf("expected cliConvexSiteURL 'http://convex.test', got '%s'", cliConvexSiteURL)
	}
}

func TestSetServerURLOverride(t *testing.T) {
	orig := cliServerURL
	defer func() { cliServerURL = orig }()

	SetServerURLOverride("http://server.test")
	if cliServerURL != "http://server.test" {
		t.Errorf("expected cliServerURL 'http://server.test', got '%s'", cliServerURL)
	}
}

func TestLoadEnvFileSkipComment(t *testing.T) {
	// Create temp dir with .env file
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")

	// Write test .env file
	content := `# This is a comment
TEST_AUTH_VAR=test_value
# Another comment
TEST_AUTH_VAR2="quoted value"
TEST_AUTH_VAR3='single quoted'
`
	if err := os.WriteFile(envPath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write .env: %v", err)
	}

	// Change to temp dir
	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	// Reset envLoaded flag
	origEnvLoaded := envLoaded
	envLoaded = false
	defer func() { envLoaded = origEnvLoaded }()

	// Clear test vars
	os.Unsetenv("TEST_AUTH_VAR")
	os.Unsetenv("TEST_AUTH_VAR2")
	os.Unsetenv("TEST_AUTH_VAR3")

	LoadEnvFile()

	// Check values were loaded
	if v := os.Getenv("TEST_AUTH_VAR"); v != "test_value" {
		t.Errorf("expected TEST_AUTH_VAR='test_value', got '%s'", v)
	}
	if v := os.Getenv("TEST_AUTH_VAR2"); v != "quoted value" {
		t.Errorf("expected TEST_AUTH_VAR2='quoted value', got '%s'", v)
	}
	if v := os.Getenv("TEST_AUTH_VAR3"); v != "single quoted" {
		t.Errorf("expected TEST_AUTH_VAR3='single quoted', got '%s'", v)
	}

	// Clean up
	os.Unsetenv("TEST_AUTH_VAR")
	os.Unsetenv("TEST_AUTH_VAR2")
	os.Unsetenv("TEST_AUTH_VAR3")
}

func TestLoadEnvFileDoesNotOverwrite(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")

	content := `TEST_AUTH_EXISTING=new_value`
	if err := os.WriteFile(envPath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write .env: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	// Reset envLoaded flag
	origEnvLoaded := envLoaded
	envLoaded = false
	defer func() { envLoaded = origEnvLoaded }()

	// Set existing value
	os.Setenv("TEST_AUTH_EXISTING", "original_value")
	defer os.Unsetenv("TEST_AUTH_EXISTING")

	LoadEnvFile()

	// Should NOT overwrite existing value
	if v := os.Getenv("TEST_AUTH_EXISTING"); v != "original_value" {
		t.Errorf("expected TEST_AUTH_EXISTING to remain 'original_value', got '%s'", v)
	}
}

func TestConstants(t *testing.T) {
	// Verify constants are defined
	if KeychainService != "cmux" {
		t.Errorf("expected KeychainService 'cmux', got '%s'", KeychainService)
	}
	if ConfigDirName != "cmux" {
		t.Errorf("expected ConfigDirName 'cmux', got '%s'", ConfigDirName)
	}
	if StackAuthAPIURL != "https://api.stack-auth.com" {
		t.Errorf("expected StackAuthAPIURL 'https://api.stack-auth.com', got '%s'", StackAuthAPIURL)
	}
}

func TestDevConstants(t *testing.T) {
	// Verify dev constants are set (unlike prod which are intentionally empty)
	if DevProjectID == "" {
		t.Error("expected DevProjectID to be set")
	}
	if DevPublishableKey == "" {
		t.Error("expected DevPublishableKey to be set")
	}
	if DevCmuxURL == "" {
		t.Error("expected DevCmuxURL to be set")
	}
	if DevConvexSiteURL == "" {
		t.Error("expected DevConvexSiteURL to be set")
	}
	if DevServerURL == "" {
		t.Error("expected DevServerURL to be set")
	}
}

func TestProdConstantsEmpty(t *testing.T) {
	// Verify prod constants are intentionally empty (must be injected at build time)
	if ProdProjectID != "" {
		t.Error("expected ProdProjectID to be empty (injected at build time)")
	}
	if ProdPublishableKey != "" {
		t.Error("expected ProdPublishableKey to be empty (injected at build time)")
	}
	if ProdCmuxURL != "" {
		t.Error("expected ProdCmuxURL to be empty (injected at build time)")
	}
	if ProdConvexSiteURL != "" {
		t.Error("expected ProdConvexSiteURL to be empty (injected at build time)")
	}
}

func TestConfigStruct(t *testing.T) {
	cfg := Config{
		ProjectID:      "proj-123",
		PublishableKey: "pk_test",
		CmuxURL:        "https://cmux.example.com",
		ConvexSiteURL:  "https://convex.example.com",
		ServerURL:      "https://server.example.com",
		StackAuthURL:   "https://api.stack-auth.com",
		IsDev:          true,
	}

	if cfg.ProjectID != "proj-123" {
		t.Errorf("expected ProjectID 'proj-123', got '%s'", cfg.ProjectID)
	}
	if cfg.IsDev != true {
		t.Error("expected IsDev true")
	}
}

func TestConfigValidateSuccess(t *testing.T) {
	cfg := Config{
		ProjectID:      "proj-123",
		PublishableKey: "pk_test",
		CmuxURL:        "https://cmux.example.com",
		ConvexSiteURL:  "https://convex.example.com",
	}

	if err := cfg.Validate(); err != nil {
		t.Errorf("expected validation to pass, got error: %v", err)
	}
}

func TestConfigValidateMissingProjectID(t *testing.T) {
	cfg := Config{
		PublishableKey: "pk_test",
		CmuxURL:        "https://cmux.example.com",
		ConvexSiteURL:  "https://convex.example.com",
	}

	err := cfg.Validate()
	if err == nil {
		t.Error("expected validation error for missing ProjectID")
	}
	if err != nil && !strings.Contains(err.Error(), "STACK_PROJECT_ID") {
		t.Errorf("expected error to mention STACK_PROJECT_ID, got: %v", err)
	}
}

func TestConfigValidateMissingPublishableKey(t *testing.T) {
	cfg := Config{
		ProjectID:     "proj-123",
		CmuxURL:       "https://cmux.example.com",
		ConvexSiteURL: "https://convex.example.com",
	}

	err := cfg.Validate()
	if err == nil {
		t.Error("expected validation error for missing PublishableKey")
	}
	if err != nil && !strings.Contains(err.Error(), "STACK_PUBLISHABLE_CLIENT_KEY") {
		t.Errorf("expected error to mention STACK_PUBLISHABLE_CLIENT_KEY, got: %v", err)
	}
}

func TestConfigValidateMissingCmuxURL(t *testing.T) {
	cfg := Config{
		ProjectID:      "proj-123",
		PublishableKey: "pk_test",
		ConvexSiteURL:  "https://convex.example.com",
	}

	err := cfg.Validate()
	if err == nil {
		t.Error("expected validation error for missing CmuxURL")
	}
	if err != nil && !strings.Contains(err.Error(), "CMUX_API_URL") {
		t.Errorf("expected error to mention CMUX_API_URL, got: %v", err)
	}
}

func TestConfigValidateMissingConvexSiteURL(t *testing.T) {
	cfg := Config{
		ProjectID:      "proj-123",
		PublishableKey: "pk_test",
		CmuxURL:        "https://cmux.example.com",
	}

	err := cfg.Validate()
	if err == nil {
		t.Error("expected validation error for missing ConvexSiteURL")
	}
	if err != nil && !strings.Contains(err.Error(), "CONVEX_SITE_URL") {
		t.Errorf("expected error to mention CONVEX_SITE_URL, got: %v", err)
	}
}

func TestConfigValidateServerURLOptional(t *testing.T) {
	// ServerURL is optional - should pass without it
	cfg := Config{
		ProjectID:      "proj-123",
		PublishableKey: "pk_test",
		CmuxURL:        "https://cmux.example.com",
		ConvexSiteURL:  "https://convex.example.com",
		// ServerURL intentionally empty
	}

	if err := cfg.Validate(); err != nil {
		t.Errorf("expected validation to pass without ServerURL, got error: %v", err)
	}
}

func TestConfigValidateMultipleMissing(t *testing.T) {
	cfg := Config{} // All empty

	err := cfg.Validate()
	if err == nil {
		t.Error("expected validation error for empty config")
	}
	// Should mention multiple missing fields
	errStr := err.Error()
	if !strings.Contains(errStr, "STACK_PROJECT_ID") {
		t.Error("expected error to mention STACK_PROJECT_ID")
	}
	if !strings.Contains(errStr, "STACK_PUBLISHABLE_CLIENT_KEY") {
		t.Error("expected error to mention STACK_PUBLISHABLE_CLIENT_KEY")
	}
}

func TestGetAccessTokenUsesEnvironmentRefreshTokenWithoutFallback(t *testing.T) {
	envToken := "environment-refresh-token-valid"
	server, requests := newRefreshTokenTestServer(t, map[string]int{
		envToken: http.StatusOK,
	})
	defer server.Close()
	setAccessTokenTestEnvironment(t, server.URL)
	t.Setenv("DEVSH_DEV_REFRESH_TOKEN", envToken)

	storedLoads := 0
	accessToken, err := getAccessTokenWithStoredRefreshTokenLoader(func() (string, error) {
		storedLoads++
		return "stored-refresh-token-valid", nil
	})
	if err != nil {
		t.Fatalf("GetAccessToken returned error: %v", err)
	}
	if accessToken != envToken+"-access" {
		t.Fatalf("access token = %q, want %q", accessToken, envToken+"-access")
	}
	if storedLoads != 0 {
		t.Fatalf("stored credential loads = %d, want 0", storedLoads)
	}
	if got := requests(); len(got) != 1 || got[0] != envToken {
		t.Fatalf("refresh requests = %q, want [%q]", got, envToken)
	}
}

func TestGetRefreshTokenCredentialTracksEnvironmentSource(t *testing.T) {
	for _, envVar := range []string{
		"DEVSH_DEV_REFRESH_TOKEN",
		"DEVSH_REFRESH_TOKEN",
		"DEVBOX_REFRESH_TOKEN",
	} {
		t.Run(envVar, func(t *testing.T) {
			setAccessTokenTestEnvironment(t, "http://stack-auth.invalid")
			token := "refresh-token-selected-from-" + envVar
			t.Setenv(envVar, token)

			credential, err := getRefreshTokenCredential(func() (string, error) {
				return "", fmt.Errorf("stored credentials should not be loaded")
			})
			if err != nil {
				t.Fatalf("getRefreshTokenCredential returned error: %v", err)
			}
			if credential.token != token {
				t.Fatalf("token = %q, want %q", credential.token, token)
			}
			if credential.envVar != envVar {
				t.Fatalf("env var = %q, want %q", credential.envVar, envVar)
			}
		})
	}
}

func TestGetAccessTokenFallsBackToStoredCredentialAfterEnvironmentUnauthorized(t *testing.T) {
	envToken := "environment-refresh-token-stale"
	genericToken := "generic-refresh-token-not-used"
	storedToken := "stored-refresh-token-valid"
	server, requests := newRefreshTokenTestServer(t, map[string]int{
		envToken:     http.StatusUnauthorized,
		genericToken: http.StatusOK,
		storedToken:  http.StatusOK,
	})
	defer server.Close()
	setAccessTokenTestEnvironment(t, server.URL)
	t.Setenv("DEVSH_DEV_REFRESH_TOKEN", envToken)
	t.Setenv("DEVSH_REFRESH_TOKEN", genericToken)

	storedLoads := 0
	var accessToken string
	var accessErr error
	stderr := captureStderr(t, func() {
		accessToken, accessErr = getAccessTokenWithStoredRefreshTokenLoader(func() (string, error) {
			storedLoads++
			return storedToken, nil
		})
	})

	if accessErr != nil {
		t.Fatalf("GetAccessToken returned error: %v", accessErr)
	}
	if accessToken != storedToken+"-access" {
		t.Fatalf("access token = %q, want %q", accessToken, storedToken+"-access")
	}
	if storedLoads != 1 {
		t.Fatalf("stored credential loads = %d, want 1", storedLoads)
	}
	if got := requests(); len(got) != 2 || got[0] != envToken || got[1] != storedToken {
		t.Fatalf("refresh requests = %q, want [%q %q]", got, envToken, storedToken)
	}
	if !strings.Contains(stderr, "DEVSH_DEV_REFRESH_TOKEN") {
		t.Fatalf("warning %q does not name DEVSH_DEV_REFRESH_TOKEN", stderr)
	}
	if strings.Contains(stderr, envToken) || strings.Contains(stderr, storedToken) {
		t.Fatalf("warning leaked refresh-token contents: %q", stderr)
	}
}

func TestGetAccessTokenDoesNotFallbackForNonUnauthorizedResponse(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			envToken := fmt.Sprintf("environment-refresh-token-%d", status)
			server, requests := newRefreshTokenTestServer(t, map[string]int{
				envToken: status,
			})
			defer server.Close()
			setAccessTokenTestEnvironment(t, server.URL)
			t.Setenv("DEVSH_DEV_REFRESH_TOKEN", envToken)

			storedLoads := 0
			_, err := getAccessTokenWithStoredRefreshTokenLoader(func() (string, error) {
				storedLoads++
				return "stored-refresh-token-valid", nil
			})
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("status %d", status)) {
				t.Fatalf("error = %v, want status %d", err, status)
			}
			if storedLoads != 0 {
				t.Fatalf("stored credential loads = %d, want 0", storedLoads)
			}
			if got := requests(); len(got) != 1 || got[0] != envToken {
				t.Fatalf("refresh requests = %q, want [%q]", got, envToken)
			}
		})
	}
}

func TestGetAccessTokenDoesNotFallbackForMalformedSuccessResponse(t *testing.T) {
	envToken := "environment-refresh-token-malformed-response"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"access_token":`))
	}))
	defer server.Close()
	setAccessTokenTestEnvironment(t, server.URL)
	t.Setenv("DEVSH_DEV_REFRESH_TOKEN", envToken)

	storedLoads := 0
	_, err := getAccessTokenWithStoredRefreshTokenLoader(func() (string, error) {
		storedLoads++
		return "stored-refresh-token-valid", nil
	})
	if err == nil || !strings.Contains(err.Error(), "failed to decode refresh response") {
		t.Fatalf("error = %v, want decode failure", err)
	}
	if storedLoads != 0 {
		t.Fatalf("stored credential loads = %d, want 0", storedLoads)
	}
	if requests != 1 {
		t.Fatalf("refresh requests = %d, want 1", requests)
	}
}

func TestGetAccessTokenDoesNotFallbackForTransportFailure(t *testing.T) {
	envToken := "environment-refresh-token-transport-failure"
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	serverURL := server.URL
	server.Close()
	setAccessTokenTestEnvironment(t, serverURL)
	t.Setenv("DEVSH_DEV_REFRESH_TOKEN", envToken)

	storedLoads := 0
	_, err := getAccessTokenWithStoredRefreshTokenLoader(func() (string, error) {
		storedLoads++
		return "stored-refresh-token-valid", nil
	})
	if err == nil || !strings.Contains(err.Error(), "failed to refresh token") {
		t.Fatalf("error = %v, want refresh transport failure", err)
	}
	if storedLoads != 0 {
		t.Fatalf("stored credential loads = %d, want 0", storedLoads)
	}
}

func TestGetAccessTokenBoundsUnauthorizedFallback(t *testing.T) {
	staleEnvToken := "environment-refresh-token-stale"
	rejectedStoredToken := "stored-refresh-token-rejected"
	for _, test := range []struct {
		name         string
		envToken     string
		storedToken  string
		storedErr    error
		statuses     map[string]int
		wantRequests []string
		wantErrors   []string
	}{
		{
			name:         "stored credential is not retried",
			storedToken:  rejectedStoredToken,
			statuses:     map[string]int{rejectedStoredToken: http.StatusUnauthorized},
			wantRequests: []string{rejectedStoredToken},
			wantErrors:   []string{"status 401"},
		},
		{
			name:         "missing fallback credential stops after environment 401",
			envToken:     staleEnvToken,
			storedErr:    fmt.Errorf("token not found in keychain"),
			statuses:     map[string]int{staleEnvToken: http.StatusUnauthorized},
			wantRequests: []string{staleEnvToken},
			wantErrors:   []string{"stored credentials unavailable", "DEVSH_DEV_REFRESH_TOKEN"},
		},
		{
			name:         "rejected fallback credential is tried once",
			envToken:     staleEnvToken,
			storedToken:  rejectedStoredToken,
			statuses:     map[string]int{staleEnvToken: http.StatusUnauthorized, rejectedStoredToken: http.StatusUnauthorized},
			wantRequests: []string{staleEnvToken, rejectedStoredToken},
			wantErrors:   []string{"status 401"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			server, requests := newRefreshTokenTestServer(t, test.statuses)
			defer server.Close()
			setAccessTokenTestEnvironment(t, server.URL)
			if test.envToken != "" {
				t.Setenv("DEVSH_DEV_REFRESH_TOKEN", test.envToken)
			}

			storedLoads := 0
			_, err := getAccessTokenWithStoredRefreshTokenLoader(func() (string, error) {
				storedLoads++
				return test.storedToken, test.storedErr
			})
			if err == nil {
				t.Fatal("GetAccessToken returned nil error")
			}
			for _, want := range test.wantErrors {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("error = %q, want substring %q", err, want)
				}
			}
			if storedLoads != 1 {
				t.Fatalf("stored credential loads = %d, want 1", storedLoads)
			}
			if got := requests(); !slices.Equal(got, test.wantRequests) {
				t.Fatalf("refresh requests = %q, want %q", got, test.wantRequests)
			}
		})
	}
}

func setAccessTokenTestEnvironment(t *testing.T, stackAuthURL string) {
	t.Helper()

	originalBuildMode := buildMode
	originalEnvLoaded := envLoaded
	buildMode = "dev"
	envLoaded = true
	t.Cleanup(func() {
		buildMode = originalBuildMode
		envLoaded = originalEnvLoaded
	})

	t.Setenv("HOME", t.TempDir())
	t.Setenv("AUTH_API_URL", stackAuthURL)
	t.Setenv("DEVSH_DEV", "1")
	t.Setenv("DEVSH_PROD", "")
	t.Setenv("CMUX_DEVBOX_DEV", "")
	t.Setenv("CMUX_DEVBOX_PROD", "")
	t.Setenv("DEVSH_DEV_REFRESH_TOKEN", "")
	t.Setenv("DEVSH_PROD_REFRESH_TOKEN", "")
	t.Setenv("DEVSH_REFRESH_TOKEN", "")
	t.Setenv("DEVBOX_REFRESH_TOKEN", "")
}

func newRefreshTokenTestServer(t *testing.T, statuses map[string]int) (*httptest.Server, func() []string) {
	t.Helper()

	var mu sync.Mutex
	var refreshTokens []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("x-stack-refresh-token")
		mu.Lock()
		refreshTokens = append(refreshTokens, token)
		mu.Unlock()

		status, ok := statuses[token]
		if !ok {
			status = http.StatusBadRequest
		}
		w.WriteHeader(status)
		if status == http.StatusOK {
			_, _ = fmt.Fprintf(w, `{"access_token":%q}`, token+"-access")
		}
	}))

	requests := func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), refreshTokens...)
	}
	return server, requests
}

func captureStderr(t *testing.T, fn func()) string {
	t.Helper()

	original := os.Stderr
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stderr pipe: %v", err)
	}
	os.Stderr = writer
	defer func() {
		os.Stderr = original
	}()

	fn()
	if err := writer.Close(); err != nil {
		t.Fatalf("close stderr writer: %v", err)
	}
	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read stderr: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close stderr reader: %v", err)
	}
	return string(output)
}
