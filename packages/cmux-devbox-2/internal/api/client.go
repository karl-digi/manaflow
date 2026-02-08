// Package api provides the cmux devbox API client.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/cmux-cli/cmux-devbox-2/internal/auth"
)

type Client struct {
	baseURL         string
	apiBasePath     string
	provider        Provider
	httpClient      *http.Client
	defaultTimeout  time.Duration
	getAccessTokenF func() (string, error)

	// Daytona URLs returned by Convex default to a production proxy domain.
	// In dev, it can be useful to point these URLs at a locally running proxy
	// (e.g. apps/global-proxy on *.cmux.localhost:8080).
	proxyOverrideScheme string
	proxyOverrideDomain string
}

func NewClient(provider Provider) (*Client, error) {
	cfg := auth.GetConfig()
	basePath, err := provider.apiBasePath()
	if err != nil {
		return nil, err
	}
	c := &Client{
		baseURL:         cfg.ConvexSiteURL,
		apiBasePath:     basePath,
		provider:        provider,
		httpClient:      &http.Client{},
		defaultTimeout:  60 * time.Second,
		getAccessTokenF: auth.GetAccessToken,
	}

	if provider == ProviderDaytona {
		c.proxyOverrideScheme, c.proxyOverrideDomain = readDaytonaProxyOverrideFromEnv()
	}

	return c, nil
}

func (c *Client) doRequest(method, path string, body interface{}) ([]byte, error) {
	return c.doRequestWithTimeout(method, path, body, c.defaultTimeout)
}

func (c *Client) doRequestWithTimeout(
	method, path string,
	body interface{},
	timeout time.Duration,
) ([]byte, error) {
	token, err := c.getAccessTokenF()
	if err != nil {
		return nil, err
	}

	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(data)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+c.apiBasePath+path, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// Instance represents a sandbox instance
type Instance struct {
	ID        string `json:"id"`
	Name      string `json:"name,omitempty"`
	Status    string `json:"status"`
	Template  string `json:"templateId,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
	VSCodeURL string `json:"vscodeUrl,omitempty"`
	VNCURL    string `json:"vncUrl,omitempty"`
	WorkerURL string `json:"workerUrl,omitempty"`
}

type CreateInstanceRequest struct {
	TeamSlugOrID string `json:"teamSlugOrId"`
	TemplateID   string `json:"templateId,omitempty"`
	Snapshot     string `json:"snapshot,omitempty"`
	Name         string `json:"name,omitempty"`
}

type CreateInstanceResponse struct {
	DevboxID  string `json:"id"`
	Status    string `json:"status"`
	VSCodeURL string `json:"vscodeUrl,omitempty"`
	WorkerURL string `json:"workerUrl,omitempty"`
	VNCURL    string `json:"vncUrl,omitempty"`
}

func readDaytonaProxyOverrideFromEnv() (scheme string, domain string) {
	// Prefer a single origin value: http://cmux.localhost:8080
	if origin := os.Getenv("CMUX_DAYTONA_PROXY_ORIGIN"); origin != "" {
		if parsed, err := url.Parse(origin); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			return parsed.Scheme, parsed.Host
		}
	}

	scheme = os.Getenv("CMUX_DAYTONA_PROXY_SCHEME")
	domain = os.Getenv("CMUX_DAYTONA_PROXY_DOMAIN")

	// Optional generic aliases (useful if we want one override across providers later).
	if scheme == "" {
		scheme = os.Getenv("CMUX_DEVBOX_PROXY_SCHEME")
	}
	if domain == "" {
		domain = os.Getenv("CMUX_DEVBOX_PROXY_DOMAIN")
	}

	return scheme, domain
}

func (c *Client) rewriteDaytonaProxyURL(raw string) string {
	if raw == "" {
		return raw
	}
	if c.provider != ProviderDaytona {
		return raw
	}
	if c.proxyOverrideScheme == "" && c.proxyOverrideDomain == "" {
		return raw
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return raw
	}

	host := parsed.Hostname()
	// Only rewrite URLs that look like our cmux proxy pattern.
	// Example: port-39377-daytona-<uuid>.<domain>
	if !strings.HasPrefix(host, "port-") || !strings.Contains(host, "-daytona-") {
		return raw
	}
	firstDot := strings.Index(host, ".")
	if firstDot < 0 {
		return raw
	}
	prefix := host[:firstDot]

	if c.proxyOverrideDomain != "" {
		parsed.Host = prefix + "." + c.proxyOverrideDomain
	}
	if c.proxyOverrideScheme != "" {
		parsed.Scheme = c.proxyOverrideScheme
	}

	return parsed.String()
}

func (c *Client) CreateInstance(teamSlug, templateID, name string) (*CreateInstanceResponse, error) {
	body := CreateInstanceRequest{TeamSlugOrID: teamSlug, Name: name}
	switch c.provider {
	case ProviderDaytona:
		body.Snapshot = templateID
	default:
		body.TemplateID = templateID
	}

	timeout := 2 * time.Minute
	if c.provider == ProviderDaytona {
		timeout = 10 * time.Minute
	}
	respBody, err := c.doRequestWithTimeout("POST", "/instances", body, timeout)
	if err != nil {
		return nil, err
	}

	var resp CreateInstanceResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w (body: %s)", err, string(respBody))
	}

	resp.VSCodeURL = c.rewriteDaytonaProxyURL(resp.VSCodeURL)
	resp.WorkerURL = c.rewriteDaytonaProxyURL(resp.WorkerURL)
	resp.VNCURL = c.rewriteDaytonaProxyURL(resp.VNCURL)

	return &resp, nil
}

type ListInstancesResponse struct {
	Instances []Instance `json:"instances"`
}

func (c *Client) ListInstances(teamSlug string) ([]Instance, error) {
	path := fmt.Sprintf("/instances?teamSlugOrId=%s", url.QueryEscape(teamSlug))
	respBody, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListInstancesResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return resp.Instances, nil
}

func (c *Client) GetInstance(teamSlug, id string) (*Instance, error) {
	path := fmt.Sprintf("/instances/%s?teamSlugOrId=%s", id, url.QueryEscape(teamSlug))
	respBody, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var inst Instance
	if err := json.Unmarshal(respBody, &inst); err != nil {
		return nil, err
	}

	inst.VSCodeURL = c.rewriteDaytonaProxyURL(inst.VSCodeURL)
	inst.WorkerURL = c.rewriteDaytonaProxyURL(inst.WorkerURL)
	inst.VNCURL = c.rewriteDaytonaProxyURL(inst.VNCURL)

	return &inst, nil
}

func (c *Client) StopInstance(teamSlug, id string) error {
	path := fmt.Sprintf("/instances/%s/stop", id)
	_, err := c.doRequest("POST", path, map[string]string{"teamSlugOrId": teamSlug})
	return err
}

// ExtendTimeout extends the sandbox timeout (E2B doesn't have pause/resume)
func (c *Client) ExtendTimeout(teamSlug, id string, timeoutMs int) error {
	path := fmt.Sprintf("/instances/%s/extend", id)

	body := map[string]interface{}{
		"teamSlugOrId": teamSlug,
	}

	switch c.provider {
	case ProviderDaytona:
		body["timeoutMs"] = timeoutMs
	default:
		ttlSeconds := timeoutMs / 1000
		if ttlSeconds <= 0 {
			ttlSeconds = 1
		}
		body["ttlSeconds"] = ttlSeconds
	}

	_, err := c.doRequest("POST", path, body)
	return err
}

type ExecRequest struct {
	TeamSlugOrID string `json:"teamSlugOrId"`
	Command      string `json:"command"`
	Timeout      int    `json:"timeout,omitempty"`
}

type ExecResponse struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
}

func (c *Client) Exec(teamSlug, id, command string, timeout int) (*ExecResponse, error) {
	path := fmt.Sprintf("/instances/%s/exec", id)
	body := ExecRequest{
		TeamSlugOrID: teamSlug,
		Command:      command,
		Timeout:      timeout,
	}

	reqTimeout := c.defaultTimeout
	if timeout > 0 {
		// Give Convex and the provider some buffer beyond the sandbox command timeout.
		reqTimeout = time.Duration(timeout+30) * time.Second
		if reqTimeout < c.defaultTimeout {
			reqTimeout = c.defaultTimeout
		}
	}
	respBody, err := c.doRequestWithTimeout("POST", path, body, reqTimeout)
	if err != nil {
		return nil, err
	}

	var resp ExecResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

type Template struct {
	ID             string `json:"templateId"`
	PresetID       string `json:"presetId"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	SupportsDocker bool   `json:"supportsDocker,omitempty"`
}

type ListTemplatesResponse struct {
	Templates []Template `json:"templates"`
}

func (c *Client) ListTemplates(teamSlug string) ([]Template, error) {
	if c.provider == ProviderDaytona {
		// Daytona doesn't have templates; we expose the default snapshot(s) as "templates"
		// so `cmux templates` stays useful across providers.
		return []Template{
			{
				ID:             "cmux-devbox-full",
				PresetID:       "cmux-devbox-full",
				Name:           "cmux-devbox-full",
				Description:    "Daytona snapshot with Docker, cmux-code, VNC, and worker preinstalled",
				SupportsDocker: true,
			},
		}, nil
	}

	path := fmt.Sprintf("/templates?teamSlugOrId=%s", url.QueryEscape(teamSlug))
	respBody, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListTemplatesResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return resp.Templates, nil
}

type AuthTokenResponse struct {
	Token string `json:"token"`
}

// GetAuthToken fetches the auth token from the sandbox
func (c *Client) GetAuthToken(teamSlug, id string) (string, error) {
	path := fmt.Sprintf("/instances/%s/token", id)
	body := map[string]string{"teamSlugOrId": teamSlug}

	respBody, err := c.doRequest("POST", path, body)
	if err != nil {
		return "", err
	}

	var resp AuthTokenResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return "", err
	}
	return resp.Token, nil
}

func (c *Client) DeleteInstance(teamSlug, id string) error {
	if c.provider == ProviderDaytona {
		path := fmt.Sprintf("/instances/%s?teamSlugOrId=%s", id, url.QueryEscape(teamSlug))
		_, err := c.doRequest("DELETE", path, nil)
		return err
	}
	// E2B doesn't have a distinct delete operation; stopping releases the sandbox.
	return c.StopInstance(teamSlug, id)
}

// DoWorkerRequest makes a direct request to the worker daemon
func DoWorkerRequest(workerURL, path, token string, body []byte) ([]byte, error) {
	return DoWorkerRequestWithTimeout(workerURL, path, token, body, 60)
}

// DoWorkerRequestWithTimeout makes a direct request to the worker daemon with custom timeout
func DoWorkerRequestWithTimeout(workerURL, path, token string, body []byte, timeoutSecs int) ([]byte, error) {
	client := &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second}

	req, err := http.NewRequest("POST", workerURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("worker error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}
