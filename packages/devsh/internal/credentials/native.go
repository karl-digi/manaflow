package credentials

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// ProviderStatus represents the credential status for a provider
type ProviderStatus struct {
	Available bool
	Source    string // e.g., "env:ANTHROPIC_API_KEY", "~/.claude.json", "keychain", etc.
}

// CheckClaudeCredentials checks Claude Code CLI credentials.
// Checks: ANTHROPIC_API_KEY env, CLAUDE_CODE_OAUTH_TOKEN env,
// ~/.claude.json (oauthAccessToken), ~/.claude/.credentials.json, macOS keychain
func CheckClaudeCredentials() ProviderStatus {
	// 1. Environment variables
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		return ProviderStatus{true, "env:ANTHROPIC_API_KEY"}
	}
	if os.Getenv("CLAUDE_CODE_OAUTH_TOKEN") != "" {
		return ProviderStatus{true, "env:CLAUDE_CODE_OAUTH_TOKEN"}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ProviderStatus{false, ""}
	}

	// 2. ~/.claude.json
	claudeJSON := filepath.Join(home, ".claude.json")
	if data, err := os.ReadFile(claudeJSON); err == nil {
		var config map[string]interface{}
		if json.Unmarshal(data, &config) == nil {
			if _, ok := config["oauthAccessToken"]; ok {
				return ProviderStatus{true, "~/.claude.json"}
			}
		}
	}

	// 3. ~/.claude/.credentials.json
	credJSON := filepath.Join(home, ".claude", ".credentials.json")
	if _, err := os.Stat(credJSON); err == nil {
		return ProviderStatus{true, "~/.claude/.credentials.json"}
	}

	// 4. macOS Keychain
	if runtime.GOOS == "darwin" {
		cmd := exec.Command("security", "find-generic-password", "-s", "Claude Code", "-w")
		if err := cmd.Run(); err == nil {
			return ProviderStatus{true, "keychain:Claude Code"}
		}
	}

	return ProviderStatus{false, ""}
}

// CheckCodexCredentials checks Codex CLI credentials.
// Checks: OPENAI_API_KEY env, CODEX_AUTH_JSON env, ~/.codex/auth.json
func CheckCodexCredentials() ProviderStatus {
	if os.Getenv("OPENAI_API_KEY") != "" {
		return ProviderStatus{true, "env:OPENAI_API_KEY"}
	}
	if os.Getenv("CODEX_AUTH_JSON") != "" {
		return ProviderStatus{true, "env:CODEX_AUTH_JSON"}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ProviderStatus{false, ""}
	}

	authJSON := filepath.Join(home, ".codex", "auth.json")
	if _, err := os.Stat(authJSON); err == nil {
		return ProviderStatus{true, "~/.codex/auth.json"}
	}

	return ProviderStatus{false, ""}
}

// CheckGeminiCredentials checks Gemini CLI credentials.
// Checks: GEMINI_API_KEY env, ~/.gemini/settings.json, ~/.config/gemini-cli/oauth_creds.json
func CheckGeminiCredentials() ProviderStatus {
	if os.Getenv("GEMINI_API_KEY") != "" {
		return ProviderStatus{true, "env:GEMINI_API_KEY"}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ProviderStatus{false, ""}
	}

	// ~/.gemini/settings.json
	settings := filepath.Join(home, ".gemini", "settings.json")
	if _, err := os.Stat(settings); err == nil {
		return ProviderStatus{true, "~/.gemini/settings.json"}
	}

	// ~/.config/gemini-cli/oauth_creds.json
	oauth := filepath.Join(home, ".config", "gemini-cli", "oauth_creds.json")
	if _, err := os.Stat(oauth); err == nil {
		return ProviderStatus{true, "~/.config/gemini-cli/oauth_creds.json"}
	}

	return ProviderStatus{false, ""}
}

// CheckAmpCredentials checks Amp CLI credentials.
// Checks: AMP_API_KEY env, ~/.local/share/amp/secrets.json
func CheckAmpCredentials() ProviderStatus {
	if os.Getenv("AMP_API_KEY") != "" {
		return ProviderStatus{true, "env:AMP_API_KEY"}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ProviderStatus{false, ""}
	}

	secrets := filepath.Join(home, ".local", "share", "amp", "secrets.json")
	if _, err := os.Stat(secrets); err == nil {
		return ProviderStatus{true, "~/.local/share/amp/secrets.json"}
	}

	return ProviderStatus{false, ""}
}

// CheckCursorCredentials checks Cursor CLI credentials.
// Checks: CURSOR_API_KEY env, ~/.config/cursor/auth.json, macOS keychain
func CheckCursorCredentials() ProviderStatus {
	if os.Getenv("CURSOR_API_KEY") != "" {
		return ProviderStatus{true, "env:CURSOR_API_KEY"}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ProviderStatus{false, ""}
	}

	authJSON := filepath.Join(home, ".config", "cursor", "auth.json")
	if _, err := os.Stat(authJSON); err == nil {
		return ProviderStatus{true, "~/.config/cursor/auth.json"}
	}

	// macOS Keychain
	if runtime.GOOS == "darwin" {
		cmd := exec.Command("security", "find-generic-password", "-s", "cursor-access-token", "-w")
		if err := cmd.Run(); err == nil {
			return ProviderStatus{true, "keychain:cursor"}
		}
	}

	return ProviderStatus{false, ""}
}

// CheckQwenCredentials checks Qwen/Alibaba credentials.
// Checks: MODEL_STUDIO_API_KEY env, DASHSCOPE_API_KEY env
func CheckQwenCredentials() ProviderStatus {
	if os.Getenv("MODEL_STUDIO_API_KEY") != "" {
		return ProviderStatus{true, "env:MODEL_STUDIO_API_KEY"}
	}
	if os.Getenv("DASHSCOPE_API_KEY") != "" {
		return ProviderStatus{true, "env:DASHSCOPE_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckOpenAICredentials checks OpenAI API credentials.
// Checks: OPENAI_API_KEY env
func CheckOpenAICredentials() ProviderStatus {
	if os.Getenv("OPENAI_API_KEY") != "" {
		return ProviderStatus{true, "env:OPENAI_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckAnthropicCredentials checks Anthropic API credentials.
// Checks: ANTHROPIC_API_KEY env
func CheckAnthropicCredentials() ProviderStatus {
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		return ProviderStatus{true, "env:ANTHROPIC_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckGoogleCredentials checks Google AI API credentials.
// Checks: GEMINI_API_KEY env, GOOGLE_API_KEY env
func CheckGoogleCredentials() ProviderStatus {
	if os.Getenv("GEMINI_API_KEY") != "" {
		return ProviderStatus{true, "env:GEMINI_API_KEY"}
	}
	if os.Getenv("GOOGLE_API_KEY") != "" {
		return ProviderStatus{true, "env:GOOGLE_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckXAICredentials checks xAI credentials.
// Checks: XAI_API_KEY env
func CheckXAICredentials() ProviderStatus {
	if os.Getenv("XAI_API_KEY") != "" {
		return ProviderStatus{true, "env:XAI_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckDeepSeekCredentials checks DeepSeek credentials.
// Checks: DEEPSEEK_API_KEY env
func CheckDeepSeekCredentials() ProviderStatus {
	if os.Getenv("DEEPSEEK_API_KEY") != "" {
		return ProviderStatus{true, "env:DEEPSEEK_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckGroqCredentials checks Groq credentials.
// Checks: GROQ_API_KEY env
func CheckGroqCredentials() ProviderStatus {
	if os.Getenv("GROQ_API_KEY") != "" {
		return ProviderStatus{true, "env:GROQ_API_KEY"}
	}
	return ProviderStatus{false, ""}
}

// CheckOpenRouterCredentials checks OpenRouter credentials.
// Checks: OPENROUTER_API_KEY env
func CheckOpenRouterCredentials() ProviderStatus {
	if os.Getenv("OPENROUTER_API_KEY") != "" {
		return ProviderStatus{true, "env:OPENROUTER_API_KEY"}
	}
	return ProviderStatus{false, ""}
}
