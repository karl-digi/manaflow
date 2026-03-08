package credentials

import (
	"os"
	"testing"
)

func TestIsProviderAvailable(t *testing.T) {
	status := AllProviderStatus{
		Providers: map[string]ProviderStatus{
			"anthropic": {Available: true, Source: "env:ANTHROPIC_API_KEY"},
			"openai":    {Available: true, Source: "env:OPENAI_API_KEY"},
			"google":    {Available: false, Source: ""},
		},
	}

	tests := []struct {
		provider string
		want     bool
	}{
		{"anthropic", true},
		{"openai", true},
		{"google", false},
		{"nonexistent", false},
	}

	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			got := status.IsProviderAvailable(tt.provider)
			if got != tt.want {
				t.Errorf("IsProviderAvailable(%q) = %v, want %v", tt.provider, got, tt.want)
			}
		})
	}
}

func TestIsProviderAvailableWithVendorMapping(t *testing.T) {
	status := AllProviderStatus{
		Providers: map[string]ProviderStatus{
			"anthropic": {Available: true, Source: "test"},
			"openai":    {Available: true, Source: "test"},
			"google":    {Available: true, Source: "test"},
		},
	}

	tests := []struct {
		vendor string
		want   bool
	}{
		// Direct providers
		{"anthropic", true},
		{"openai", true},
		{"google", true},
		// Aliases should map to providers
		{"claude", true},    // maps to anthropic
		{"codex", true},     // maps to openai
		{"gpt", true},       // maps to openai
		{"gemini", true},    // maps to google
		// Unknown
		{"unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.vendor, func(t *testing.T) {
			got := status.IsProviderAvailable(tt.vendor)
			if got != tt.want {
				t.Errorf("IsProviderAvailable(%q) = %v, want %v", tt.vendor, got, tt.want)
			}
		})
	}
}

func TestGetProviderForVendor(t *testing.T) {
	tests := []struct {
		vendor string
		want   string
	}{
		{"anthropic", "anthropic"},
		{"claude", "anthropic"},
		{"openai", "openai"},
		{"codex", "openai"},
		{"gpt", "openai"},
		{"google", "google"},
		{"gemini", "google"},
		{"unknown", "unknown"}, // passthrough for unknown
	}

	for _, tt := range tests {
		t.Run(tt.vendor, func(t *testing.T) {
			got := GetProviderForVendor(tt.vendor)
			if got != tt.want {
				t.Errorf("GetProviderForVendor(%q) = %v, want %v", tt.vendor, got, tt.want)
			}
		})
	}
}

func TestCheckAnthropicCredentialsWithEnv(t *testing.T) {
	// Save and restore env
	original := os.Getenv("ANTHROPIC_API_KEY")
	defer os.Setenv("ANTHROPIC_API_KEY", original)

	// Test with env var set
	os.Setenv("ANTHROPIC_API_KEY", "test-key")
	status := CheckAnthropicCredentials()
	if !status.Available {
		t.Error("CheckAnthropicCredentials() should be available when ANTHROPIC_API_KEY is set")
	}
	if status.Source != "env:ANTHROPIC_API_KEY" {
		t.Errorf("CheckAnthropicCredentials() source = %q, want %q", status.Source, "env:ANTHROPIC_API_KEY")
	}

	// Test without env var
	os.Setenv("ANTHROPIC_API_KEY", "")
	status = CheckAnthropicCredentials()
	if status.Available {
		t.Error("CheckAnthropicCredentials() should not be available when ANTHROPIC_API_KEY is empty")
	}
}

func TestCheckOpenAICredentialsWithEnv(t *testing.T) {
	// Save and restore env
	original := os.Getenv("OPENAI_API_KEY")
	defer os.Setenv("OPENAI_API_KEY", original)

	// Test with env var set
	os.Setenv("OPENAI_API_KEY", "test-key")
	status := CheckOpenAICredentials()
	if !status.Available {
		t.Error("CheckOpenAICredentials() should be available when OPENAI_API_KEY is set")
	}
	if status.Source != "env:OPENAI_API_KEY" {
		t.Errorf("CheckOpenAICredentials() source = %q, want %q", status.Source, "env:OPENAI_API_KEY")
	}

	// Test without env var
	os.Setenv("OPENAI_API_KEY", "")
	status = CheckOpenAICredentials()
	if status.Available {
		t.Error("CheckOpenAICredentials() should not be available when OPENAI_API_KEY is empty")
	}
}

func TestCheckGoogleCredentialsWithEnv(t *testing.T) {
	// Save and restore env vars
	originalGemini := os.Getenv("GEMINI_API_KEY")
	originalGoogle := os.Getenv("GOOGLE_API_KEY")
	defer func() {
		os.Setenv("GEMINI_API_KEY", originalGemini)
		os.Setenv("GOOGLE_API_KEY", originalGoogle)
	}()

	// Clear both
	os.Setenv("GEMINI_API_KEY", "")
	os.Setenv("GOOGLE_API_KEY", "")

	// Test with GEMINI_API_KEY
	os.Setenv("GEMINI_API_KEY", "test-key")
	status := CheckGoogleCredentials()
	if !status.Available {
		t.Error("CheckGoogleCredentials() should be available when GEMINI_API_KEY is set")
	}
	if status.Source != "env:GEMINI_API_KEY" {
		t.Errorf("CheckGoogleCredentials() source = %q, want %q", status.Source, "env:GEMINI_API_KEY")
	}

	// Test with GOOGLE_API_KEY
	os.Setenv("GEMINI_API_KEY", "")
	os.Setenv("GOOGLE_API_KEY", "test-key")
	status = CheckGoogleCredentials()
	if !status.Available {
		t.Error("CheckGoogleCredentials() should be available when GOOGLE_API_KEY is set")
	}
	if status.Source != "env:GOOGLE_API_KEY" {
		t.Errorf("CheckGoogleCredentials() source = %q, want %q", status.Source, "env:GOOGLE_API_KEY")
	}

	// Test without any env var
	os.Setenv("GOOGLE_API_KEY", "")
	status = CheckGoogleCredentials()
	if status.Available {
		t.Error("CheckGoogleCredentials() should not be available when no API key is set")
	}
}

func TestVendorToProviderMap(t *testing.T) {
	// Ensure common mappings exist
	required := map[string]string{
		"anthropic": "anthropic",
		"claude":    "anthropic",
		"openai":    "openai",
		"codex":     "openai",
		"gpt":       "openai",
		"google":    "google",
		"gemini":    "google",
	}

	for vendor, expectedProvider := range required {
		if got, ok := VendorToProviderMap[vendor]; !ok {
			t.Errorf("VendorToProviderMap missing vendor %q", vendor)
		} else if got != expectedProvider {
			t.Errorf("VendorToProviderMap[%q] = %q, want %q", vendor, got, expectedProvider)
		}
	}
}

func TestProviderOrder(t *testing.T) {
	// Ensure common providers are in the order list
	required := []string{"anthropic", "openai", "google"}
	orderSet := make(map[string]bool)
	for _, p := range ProviderOrder {
		orderSet[p] = true
	}

	for _, p := range required {
		if !orderSet[p] {
			t.Errorf("ProviderOrder missing required provider %q", p)
		}
	}
}
