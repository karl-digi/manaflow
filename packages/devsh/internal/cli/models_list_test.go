package cli

import (
	"strings"
	"testing"

	"github.com/karlorz/devsh/internal/credentials"
)

func TestFilterModels(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus-4.6", DisplayName: "Opus 4.6", Vendor: "anthropic", Tier: "paid", Disabled: false},
		{Name: "gpt-4o", DisplayName: "GPT-4o", Vendor: "openai", Tier: "paid", Disabled: false},
		{Name: "gemini-pro", DisplayName: "Gemini Pro", Vendor: "google", Tier: "free", Disabled: true},
	}

	tests := []struct {
		name        string
		provider    string
		enabledOnly bool
		filter      string
		wantCount   int
	}{
		{"no filter", "", false, "", 3},
		{"filter by anthropic", "anthropic", false, "", 1},
		{"filter by openai", "openai", false, "", 1},
		{"enabled only", "", true, "", 2},
		{"text filter claude", "", false, "claude", 1},
		{"text filter opus", "", false, "opus", 1},
		{"combined anthropic enabled", "anthropic", true, "", 1},
		{"no match", "nonexistent", false, "", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := filterModels(models, tt.provider, tt.enabledOnly, tt.filter)
			if len(result) != tt.wantCount {
				t.Errorf("filterModels() got %d models, want %d", len(result), tt.wantCount)
			}
		})
	}
}

func TestFilterModelsCaseInsensitive(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus-4.6", DisplayName: "Opus 4.6", Vendor: "Anthropic", Tier: "paid"},
	}

	result := filterModels(models, "ANTHROPIC", false, "")
	if len(result) != 1 {
		t.Errorf("provider filter should be case-insensitive (uppercase)")
	}

	result = filterModels(models, "anthropic", false, "")
	if len(result) != 1 {
		t.Errorf("provider filter should be case-insensitive (lowercase)")
	}
}

func TestFilterModelsTextFilterMatchesMultipleFields(t *testing.T) {
	models := []ModelInfo{
		{Name: "model-a", DisplayName: "claude-sonnet", Vendor: "test", Tier: "paid"},
		{Name: "claude-opus", DisplayName: "Model B", Vendor: "test", Tier: "paid"},
		{Name: "model-c", DisplayName: "Model C", Vendor: "anthropic", Tier: "paid"},
	}

	result := filterModels(models, "", false, "claude")
	if len(result) != 2 {
		t.Errorf("text filter should match name or displayName, got %d, want 2", len(result))
	}

	result = filterModels(models, "", false, "anthropic")
	if len(result) != 1 {
		t.Errorf("text filter should match vendor, got %d, want 1", len(result))
	}
}

func TestFilterModelsEmptySlice(t *testing.T) {
	result := filterModels([]ModelInfo{}, "", false, "")
	if len(result) != 0 {
		t.Errorf("filterModels() got %d models for empty input, want 0", len(result))
	}
}

func TestFilterModelsDisabledWithReason(t *testing.T) {
	reason := "API key expired"
	models := []ModelInfo{
		{Name: "model-a", DisplayName: "A", Vendor: "test", Tier: "paid", Disabled: true, DisabledReason: &reason},
		{Name: "model-b", DisplayName: "B", Vendor: "test", Tier: "paid", Disabled: false},
	}

	result := filterModels(models, "", true, "")
	if len(result) != 1 {
		t.Errorf("enabled-only should filter disabled models, got %d, want 1", len(result))
	}
	if result[0].Name != "model-b" {
		t.Errorf("enabled-only should return model-b, got %s", result[0].Name)
	}
}

func TestFilterByAvailability(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus-4.6", DisplayName: "Opus 4.6", Vendor: "anthropic", Tier: "paid"},
		{Name: "gpt-4o", DisplayName: "GPT-4o", Vendor: "openai", Tier: "paid"},
		{Name: "gemini-pro", DisplayName: "Gemini Pro", Vendor: "google", Tier: "free"},
		{Name: "qwen-max", DisplayName: "Qwen Max", Vendor: "qwen", Tier: "paid"},
	}

	status := credentials.AllProviderStatus{
		Providers: map[string]credentials.ProviderStatus{
			"anthropic": {Available: true, Source: "env:ANTHROPIC_API_KEY"},
			"openai":    {Available: true, Source: "env:OPENAI_API_KEY"},
			"google":    {Available: false, Source: ""},
			"qwen":      {Available: false, Source: ""},
		},
	}

	result := filterByAvailability(models, status)

	if len(result) != 2 {
		t.Errorf("filterByAvailability() got %d models, want 2", len(result))
	}

	// Check that only anthropic and openai models are returned
	vendors := make(map[string]bool)
	for _, m := range result {
		vendors[m.Vendor] = true
	}

	if !vendors["anthropic"] {
		t.Error("filterByAvailability() should include anthropic models")
	}
	if !vendors["openai"] {
		t.Error("filterByAvailability() should include openai models")
	}
	if vendors["google"] {
		t.Error("filterByAvailability() should not include google models (no credentials)")
	}
	if vendors["qwen"] {
		t.Error("filterByAvailability() should not include qwen models (no credentials)")
	}
}

func TestFilterByAvailabilityEmpty(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus-4.6", DisplayName: "Opus 4.6", Vendor: "anthropic", Tier: "paid"},
	}

	// No providers available
	status := credentials.AllProviderStatus{
		Providers: map[string]credentials.ProviderStatus{},
	}

	result := filterByAvailability(models, status)

	if len(result) != 0 {
		t.Errorf("filterByAvailability() got %d models with no providers, want 0", len(result))
	}
}

func TestFilterByAvailabilityWithVendorMapping(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus", DisplayName: "Opus", Vendor: "claude", Tier: "paid"},   // "claude" maps to "anthropic"
		{Name: "gemini-pro", DisplayName: "Gemini Pro", Vendor: "gemini", Tier: "paid"}, // "gemini" maps to "google"
	}

	status := credentials.AllProviderStatus{
		Providers: map[string]credentials.ProviderStatus{
			"anthropic": {Available: true, Source: "test"},
			"google":    {Available: false, Source: ""},
		},
	}

	result := filterByAvailability(models, status)

	if len(result) != 1 {
		t.Errorf("filterByAvailability() got %d models, want 1 (only claude/anthropic available)", len(result))
	}
	if len(result) > 0 && result[0].Vendor != "claude" {
		t.Errorf("filterByAvailability() should return claude model, got %s", result[0].Vendor)
	}
}

// --- Tier and Source Filtering Tests (OpenRouter Discovery) ---

func TestFilterModelsByTier(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus-4.6", DisplayName: "Opus 4.6", Vendor: "anthropic", Tier: "paid"},
		{Name: "gpt-4o", DisplayName: "GPT-4o", Vendor: "openai", Tier: "paid"},
		{Name: "gemini-flash", DisplayName: "Gemini Flash", Vendor: "google", Tier: "free"},
		{Name: "llama-3-8b", DisplayName: "Llama 3 8B", Vendor: "meta", Tier: "free"},
	}

	// Filter free models
	freeModels := filterModelsByTier(models, "free")
	if len(freeModels) != 2 {
		t.Errorf("filterModelsByTier(free) got %d models, want 2", len(freeModels))
	}
	for _, m := range freeModels {
		if m.Tier != "free" {
			t.Errorf("filterModelsByTier(free) returned model with tier %q", m.Tier)
		}
	}

	// Filter paid models
	paidModels := filterModelsByTier(models, "paid")
	if len(paidModels) != 2 {
		t.Errorf("filterModelsByTier(paid) got %d models, want 2", len(paidModels))
	}
	for _, m := range paidModels {
		if m.Tier != "paid" {
			t.Errorf("filterModelsByTier(paid) returned model with tier %q", m.Tier)
		}
	}

	// Empty tier returns all
	allModels := filterModelsByTier(models, "")
	if len(allModels) != 4 {
		t.Errorf("filterModelsByTier(\"\") got %d models, want 4", len(allModels))
	}
}

func TestFilterModelsOpenRouterFree(t *testing.T) {
	models := []ModelInfo{
		{Name: "openrouter/meta-llama/llama-3-8b-instruct:free", DisplayName: "Llama 3 8B Free", Vendor: "openrouter", Tier: "free", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "openrouter/meta-llama/llama-3-8b-instruct", DisplayName: "Llama 3 8B", Vendor: "openrouter", Tier: "paid", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "openrouter/anthropic/claude-3-opus", DisplayName: "Claude 3 Opus", Vendor: "openrouter", Tier: "paid", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "openrouter/google/gemma-7b:free", DisplayName: "Gemma 7B Free", Vendor: "openrouter", Tier: "free", Source: "discovered", DiscoveredFrom: "openrouter"},
	}

	// Filter models with :free suffix (OpenRouter free models)
	freeOpenRouter := filterModelsOpenRouterFree(models)
	if len(freeOpenRouter) != 2 {
		t.Errorf("filterModelsOpenRouterFree() got %d models, want 2", len(freeOpenRouter))
	}

	// Verify all returned models have :free suffix
	for _, m := range freeOpenRouter {
		if !strings.HasSuffix(m.Name, ":free") {
			t.Errorf("filterModelsOpenRouterFree() returned model without :free suffix: %s", m.Name)
		}
	}
}

func TestFilterModelsDiscoveredSource(t *testing.T) {
	models := []ModelInfo{
		{Name: "claude/opus-4.6", DisplayName: "Opus 4.6", Vendor: "anthropic", Tier: "paid", Source: "curated"},
		{Name: "gpt-4o", DisplayName: "GPT-4o", Vendor: "openai", Tier: "paid", Source: "curated"},
		{Name: "openrouter/llama-3-8b", DisplayName: "Llama 3 8B", Vendor: "openrouter", Tier: "free", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "openrouter/mistral-7b", DisplayName: "Mistral 7B", Vendor: "openrouter", Tier: "free", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "local-model", DisplayName: "Local Model", Vendor: "local", Tier: "free"}, // No source (legacy)
	}

	// Filter curated models
	curated := filterModelsBySource(models, "curated")
	if len(curated) != 2 {
		t.Errorf("filterModelsBySource(curated) got %d models, want 2", len(curated))
	}
	for _, m := range curated {
		if m.Source != "curated" {
			t.Errorf("filterModelsBySource(curated) returned model with source %q", m.Source)
		}
	}

	// Filter discovered models
	discovered := filterModelsBySource(models, "discovered")
	if len(discovered) != 2 {
		t.Errorf("filterModelsBySource(discovered) got %d models, want 2", len(discovered))
	}
	for _, m := range discovered {
		if m.Source != "discovered" {
			t.Errorf("filterModelsBySource(discovered) returned model with source %q", m.Source)
		}
		if m.DiscoveredFrom == "" {
			t.Errorf("discovered model %s should have DiscoveredFrom set", m.Name)
		}
	}

	// Empty source returns all
	allModels := filterModelsBySource(models, "")
	if len(allModels) != 5 {
		t.Errorf("filterModelsBySource(\"\") got %d models, want 5", len(allModels))
	}
}

func TestFilterModelsByDiscoveredFrom(t *testing.T) {
	models := []ModelInfo{
		{Name: "openrouter/llama-3-8b", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "openrouter/mistral-7b", Source: "discovered", DiscoveredFrom: "openrouter"},
		{Name: "local/custom-model", Source: "discovered", DiscoveredFrom: "local-registry"},
		{Name: "claude/opus", Source: "curated"},
	}

	// Filter by OpenRouter source
	openrouterModels := filterModelsByDiscoveredFrom(models, "openrouter")
	if len(openrouterModels) != 2 {
		t.Errorf("filterModelsByDiscoveredFrom(openrouter) got %d models, want 2", len(openrouterModels))
	}

	// Filter by local-registry
	localModels := filterModelsByDiscoveredFrom(models, "local-registry")
	if len(localModels) != 1 {
		t.Errorf("filterModelsByDiscoveredFrom(local-registry) got %d models, want 1", len(localModels))
	}

	// Empty discoveredFrom returns all
	allModels := filterModelsByDiscoveredFrom(models, "")
	if len(allModels) != 4 {
		t.Errorf("filterModelsByDiscoveredFrom(\"\") got %d models, want 4", len(allModels))
	}
}
