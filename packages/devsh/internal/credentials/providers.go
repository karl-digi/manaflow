package credentials

// AllProviderStatus holds credential status for all providers
type AllProviderStatus struct {
	Providers map[string]ProviderStatus
	// Models from opencode CLI (includes custom providers)
	OpenCodeModels []OpenCodeModel
}

// ProviderOrder defines the display order for providers
var ProviderOrder = []string{
	"anthropic",
	"openai",
	"google",
	"opencode",
	"amp",
	"cursor",
	"qwen",
	"xai",
	"deepseek",
	"groq",
	"openrouter",
}

// VendorToProviderMap maps model vendors to their credential provider names.
// Some vendors may map to the same provider credentials.
var VendorToProviderMap = map[string]string{
	// Primary providers
	"anthropic":  "anthropic",
	"openai":     "openai",
	"google":     "google",
	"opencode":   "opencode",
	"amp":        "amp",
	"cursor":     "cursor",
	"qwen":       "qwen",
	"xai":        "xai",
	"deepseek":   "deepseek",
	"groq":       "groq",
	"openrouter": "openrouter",
	// Aliases
	"gemini":     "google",
	"codex":      "openai",
	"claude":     "anthropic",
	"gpt":        "openai",
	"grok":       "xai",
	"alibaba":    "qwen",
	"dashscope":  "qwen",
}

// CheckAllProviders returns combined status from native checks + opencode CLI.
func CheckAllProviders() AllProviderStatus {
	result := AllProviderStatus{
		Providers: make(map[string]ProviderStatus),
	}

	// Native API key checks
	result.Providers["anthropic"] = CheckAnthropicCredentials()
	result.Providers["openai"] = CheckOpenAICredentials()
	result.Providers["google"] = CheckGoogleCredentials()
	result.Providers["amp"] = CheckAmpCredentials()
	result.Providers["cursor"] = CheckCursorCredentials()
	result.Providers["qwen"] = CheckQwenCredentials()
	result.Providers["xai"] = CheckXAICredentials()
	result.Providers["deepseek"] = CheckDeepSeekCredentials()
	result.Providers["groq"] = CheckGroqCredentials()
	result.Providers["openrouter"] = CheckOpenRouterCredentials()

	// CLI tool checks (may provide additional credential sources)
	claudeStatus := CheckClaudeCredentials()
	if claudeStatus.Available {
		// Claude CLI can use OAuth, which is a valid credential for anthropic vendor
		if !result.Providers["anthropic"].Available {
			result.Providers["anthropic"] = claudeStatus
		}
	}

	codexStatus := CheckCodexCredentials()
	if codexStatus.Available && !result.Providers["openai"].Available {
		result.Providers["openai"] = codexStatus
	}

	geminiStatus := CheckGeminiCredentials()
	if geminiStatus.Available && !result.Providers["google"].Available {
		result.Providers["google"] = geminiStatus
	}

	// OpenCode CLI integration
	openCodeModels, _ := GetOpenCodeModels()
	result.OpenCodeModels = openCodeModels

	// Mark opencode providers as available
	for _, m := range openCodeModels {
		if existing, ok := result.Providers[m.Provider]; !ok || !existing.Available {
			result.Providers[m.Provider] = ProviderStatus{true, "opencode"}
		}
	}

	// Mark opencode vendor itself if we got any models
	if len(openCodeModels) > 0 {
		if !result.Providers["opencode"].Available {
			result.Providers["opencode"] = ProviderStatus{true, "opencode CLI"}
		}
	}

	return result
}

// IsProviderAvailable checks if a specific provider is available
func (s AllProviderStatus) IsProviderAvailable(provider string) bool {
	// First try direct lookup
	if status, ok := s.Providers[provider]; ok {
		return status.Available
	}

	// Try vendor mapping
	if mapped, ok := VendorToProviderMap[provider]; ok {
		if status, ok := s.Providers[mapped]; ok {
			return status.Available
		}
	}

	return false
}

// GetProviderForVendor returns the provider name for a given vendor
func GetProviderForVendor(vendor string) string {
	if mapped, ok := VendorToProviderMap[vendor]; ok {
		return mapped
	}
	return vendor
}
