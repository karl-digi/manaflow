// internal/cli/server_providers.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/karlorz/devsh/internal/auth"
)

// ServerAgentStatus represents an individual agent's availability from the server
type ServerAgentStatus struct {
	Name        string `json:"name"`
	IsAvailable bool   `json:"isAvailable"`
}

// ServerProviderStatus represents a vendor-level provider status from the server
type ServerProviderStatus struct {
	Name        string              `json:"name"`
	IsAvailable bool                `json:"isAvailable"`
	Agents      []ServerAgentStatus `json:"agents,omitempty"`
}

// ServerProvidersResponse is the response from GET /api/providers
type ServerProvidersResponse struct {
	Success   bool                   `json:"success"`
	Providers []ServerProviderStatus `json:"providers"`
	Error     string                 `json:"error,omitempty"`
}

// fetchServerProviderStatus calls GET /api/providers (authenticated) to get
// provider status from Convex-stored API keys. This reflects the actual
// credentials available for remote sandbox execution.
func fetchServerProviderStatus(ctx context.Context) (*ServerProvidersResponse, error) {
	cfg := auth.GetConfig()
	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("CMUX_SERVER_URL not configured")
	}

	accessToken, err := auth.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("not authenticated: %w", err)
	}

	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return nil, fmt.Errorf("failed to get team: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/providers?teamSlugOrId=%s", cfg.ServerURL, url.QueryEscape(teamSlug))
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch providers: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}

	var result ServerProvidersResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &result, nil
}
