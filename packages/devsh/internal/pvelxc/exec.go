package pvelxc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type ExecResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

const DefaultSandboxTimezone = "Asia/Hong_Kong"

type execEvent struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

const (
	execReadyProbeCommand = "echo ready"
	execReadyProbeTimeout = 2 * time.Second
	execReadyPollInterval = 1 * time.Second
)

func buildExecURL(host string) (string, error) {
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		u, err := url.Parse(host)
		if err != nil {
			return "", err
		}
		if u.Path == "" || u.Path == "/" {
			u.Path = "/exec"
		}
		return u.String(), nil
	}

	u := &url.URL{
		Scheme: "http",
		Host:   host,
		Path:   "/exec",
	}
	return u.String(), nil
}

// ShellSingleQuote wraps value in single quotes with POSIX-safe escaping.
func ShellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

// fetchExecToken retrieves the /root/.worker-auth-token from inside the
// container. When PVE_EXECD_TOKEN_FILE is set, the token is read from that
// file: CI snapshot runs persist the template's execd token there, because
// the PVE API has no LXC file-read endpoint and CI runners cannot reach the
// PVE host over SSH. Otherwise, when PVE_SSH_HOST is set it reads the file
// via SSH to the PVE host + pct exec; without SSH it falls back to the PVE
// API file endpoint. The token is cached on the Client after the first
// successful fetch. Returns "" (no error) when the token file doesn't exist —
// in that case the execd daemon is in no-auth mode and requests pass through.
func (c *Client) fetchExecToken(ctx context.Context, vmid int) (string, error) {
	if tokenFile := os.Getenv("PVE_EXECD_TOKEN_FILE"); tokenFile != "" {
		raw, err := os.ReadFile(tokenFile)
		if err != nil {
			if os.IsNotExist(err) {
				// No persisted token — execd runs in no-auth mode.
				return "", nil
			}
			return "", fmt.Errorf("fetch exec token from %s: %w", tokenFile, err)
		}
		return strings.TrimSpace(string(raw)), nil
	}

	sshHost := SSHHostFromEnv()
	if sshHost == "" {
		return c.fetchExecTokenViaAPI(ctx, vmid)
	}

	out, err := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=5",
		sshHost,
		fmt.Sprintf("pct exec %d -- cat /root/.worker-auth-token 2>/dev/null || true", vmid),
	).Output()
	if err != nil {
		return "", fmt.Errorf("fetch exec token via SSH+pct: %w", err)
	}

	token := strings.TrimSpace(string(out))
	if token == "" {
		// Token file doesn't exist in the container — execd is in no-auth mode.
		return "", nil
	}
	return token, nil
}

// fetchExecTokenViaAPI retrieves /root/.worker-auth-token via the PVE API file
// endpoint (used when PVE_SSH_HOST is not set). The endpoint may return the
// content JSON-wrapped ({"data":{"content":"..."}}) or as raw file content;
// both are handled. A 404 means the token file doesn't exist (execd in no-auth
// mode) and yields "". A 501 means the endpoint itself is not implemented on
// this PVE server, so the token cannot be fetched that way either — treat it
// like no-auth and attempt the request without a token (the execd will answer
// 401 if it does require auth). Other HTTP errors are returned as errors.
func (c *Client) fetchExecTokenViaAPI(ctx context.Context, vmid int) (string, error) {
	apiCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	node, err := c.getNode(apiCtx)
	if err != nil {
		return "", fmt.Errorf("fetch exec token via PVE API: %w", err)
	}

	raw, status, err := c.apiRequestRaw(apiCtx, http.MethodGet,
		fmt.Sprintf("/api2/json/nodes/%s/lxc/%d/files", node, vmid),
		url.Values{"path": []string{"/root/.worker-auth-token"}})
	if err != nil {
		if apiCtx.Err() != nil {
			return "", apiCtx.Err()
		}
		return "", fmt.Errorf("fetch exec token via PVE API: %w", err)
	}

	if status == http.StatusNotFound || status == http.StatusNotImplemented {
		// Token file doesn't exist, or the file endpoint is not implemented on
		// this PVE server — proceed without a token (execd no-auth mode) rather
		// than failing the exec outright.
		return "", nil
	}
	if status < 200 || status >= 300 {
		msg := strings.TrimSpace(string(raw))
		if msg == "" {
			msg = "(empty response)"
		}
		return "", fmt.Errorf("fetch exec token via PVE API: HTTP %d: %s", status, msg)
	}

	// Try JSON-wrapped content first, then fall back to raw file content.
	// JSON-looking responses without usable content mean no token.
	var env struct {
		Data struct {
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err == nil && strings.TrimSpace(env.Data.Content) != "" {
		return strings.TrimSpace(env.Data.Content), nil
	}
	token := strings.TrimSpace(string(raw))
	if token == "" || strings.HasPrefix(token, "{") {
		return "", nil
	}
	return token, nil
}

// getExecToken returns the cached exec token, fetching it on first use.
func (c *Client) getExecToken(ctx context.Context, vmid int) (string, error) {
	c.execTokenMu.Lock()
	token := c.execToken
	c.execTokenMu.Unlock()
	if token != "" {
		return token, nil
	}

	fetched, err := c.fetchExecToken(ctx, vmid)
	if err != nil {
		return "", err
	}

	c.execTokenMu.Lock()
	c.execToken = fetched
	c.execTokenMu.Unlock()
	return fetched, nil
}

// invalidateExecToken clears the cached token so the next call re-fetches.
func (c *Client) invalidateExecToken() {
	c.execTokenMu.Lock()
	c.execToken = ""
	c.execTokenMu.Unlock()
}

func VerifyTimezoneCommand(timezone string) string {
	return fmt.Sprintf("TZ=%s; date +%%Z", ShellSingleQuote(timezone))
}

func ApplyTimezoneCommand(timezone string) string {
	quotedTimezone := ShellSingleQuote(timezone)
	zoneInfoPath := ShellSingleQuote("/usr/share/zoneinfo/" + timezone)
	return strings.Join([]string{
		"if [ -e " + zoneInfoPath + " ]; then",
		"timedatectl set-timezone " + quotedTimezone + " 2>/dev/null || {",
		"ln -snf " + zoneInfoPath + " /etc/localtime && printf '%s\\n' " + quotedTimezone + " > /etc/timezone;",
		"} || {",
		"printf 'devsh: failed to set system timezone to %s\\n' " + quotedTimezone + " >&2; exit 1;",
		"};",
		"else",
		"printf 'devsh: timezone %s not found, skipping system timezone update\\n' " + quotedTimezone + " >&2; exit 1;",
		"fi",
	}, " ")
}

func (c *Client) ApplyTimezone(ctx context.Context, instanceID string, timezone string) (*ExecResult, error) {
	stdout, stderr, exitCode, err := c.ExecCommand(ctx, instanceID, ApplyTimezoneCommand(timezone))
	if err != nil {
		return nil, err
	}
	return &ExecResult{ExitCode: exitCode, Stdout: stdout, Stderr: stderr}, nil
}

func (c *Client) VerifyTimezone(ctx context.Context, instanceID string, timezone string) (*ExecResult, error) {
	stdout, stderr, exitCode, err := c.ExecCommand(ctx, instanceID, VerifyTimezoneCommand(timezone))
	if err != nil {
		return nil, err
	}
	return &ExecResult{ExitCode: exitCode, Stdout: stdout, Stderr: stderr}, nil
}

// ErrExecUnauthorized indicates the execd server returned 401 Unauthorized,
// signaling the cached token is stale or missing and should be re-fetched.
var ErrExecUnauthorized = errors.New("execd returned 401 Unauthorized")

func (c *Client) tryHTTPExec(ctx context.Context, host string, command string, timeout time.Duration, token string) (*ExecResult, error) {
	execURL, err := buildExecURL(host)
	if err != nil {
		return nil, err
	}

	effectiveTimeout := timeout
	if effectiveTimeout <= 0 {
		effectiveTimeout = 5 * time.Minute
	}
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline) - 30*time.Second
		if remaining > 0 && remaining < effectiveTimeout {
			effectiveTimeout = remaining
		}
	}

	body := map[string]any{
		"command":    fmt.Sprintf("export HOME=/root XDG_RUNTIME_DIR=/run/user/0; %s", command),
		"timeout_ms": int(effectiveTimeout.Milliseconds()),
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, execURL, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.execHTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrExecUnauthorized
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := 0

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev execEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		switch ev.Type {
		case "stdout":
			if ev.Data != "" {
				stdout.WriteString(ev.Data)
				stdout.WriteString("\n")
			}
		case "stderr":
			if ev.Data != "" {
				stderr.WriteString(ev.Data)
				stderr.WriteString("\n")
			}
		case "exit":
			exitCode = ev.Code
		case "error":
			if ev.Message != "" {
				stderr.WriteString(ev.Message)
				stderr.WriteString("\n")
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return &ExecResult{
		ExitCode: exitCode,
		Stdout:   strings.TrimRight(stdout.String(), "\n"),
		Stderr:   strings.TrimRight(stderr.String(), "\n"),
	}, nil
}

func (c *Client) resolveExecCandidates(ctx context.Context, instanceID string) (int, []string, error) {
	vmid, ok := ParseVMID(instanceID)
	hostname := normalizeHostID(instanceID)
	if ok {
		if h, err := c.getContainerHostname(ctx, vmid); err == nil && h != "" {
			hostname = normalizeHostID(h)
		}
		if hostname == "" || reDigits.MatchString(hostname) {
			hostname = fmt.Sprintf("cmux-%d", vmid)
		}
	} else {
		resolved, err := c.findVMIDByHostname(ctx, instanceID)
		if err != nil {
			return 0, nil, err
		}
		vmid = resolved
	}

	domainSuffix, _ := c.getDomainSuffix(ctx)

	candidates := make([]string, 0, 3)
	if publicURL, ok := c.buildPublicServiceURL(39375, hostname); ok {
		candidates = append(candidates, publicURL)
	}
	if domainSuffix != "" {
		candidates = append(candidates, fmt.Sprintf("http://%s%s:%d", hostname, domainSuffix, 39375))
	}
	if ip, _ := c.getContainerIP(ctx, vmid); ip != "" {
		candidates = append(candidates, fmt.Sprintf("http://%s:%d", ip, 39375))
	}

	if len(candidates) == 0 {
		return 0, nil, fmt.Errorf("cannot execute command in container %d: no reachable exec host candidates", vmid)
	}

	return vmid, candidates, nil
}

func execReadyProbeError(instanceID string, waitErr error, lastErr error) error {
	if errors.Is(waitErr, context.Canceled) {
		return waitErr
	}
	if lastErr != nil {
		return fmt.Errorf("exec endpoint did not become ready for %s: %w; last probe: %v", instanceID, waitErr, lastErr)
	}
	return fmt.Errorf("exec endpoint did not become ready for %s: %w", instanceID, waitErr)
}

func (c *Client) WaitForExecReady(ctx context.Context, instanceID string, timeout time.Duration) error {
	if strings.TrimSpace(instanceID) == "" {
		return errors.New("instanceID is required")
	}

	waitCtx := ctx
	cancel := func() {}
	if timeout > 0 {
		waitCtx, cancel = context.WithTimeout(ctx, timeout)
	}
	defer cancel()

	vmid, candidates, err := c.resolveExecCandidates(waitCtx, instanceID)
	if err != nil {
		return err
	}

	var lastErr error
	for {
		if err := waitCtx.Err(); err != nil {
			return execReadyProbeError(instanceID, err, lastErr)
		}

		probeTimeout := execReadyProbeTimeout
		if deadline, ok := waitCtx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return execReadyProbeError(instanceID, context.DeadlineExceeded, lastErr)
			}
			if remaining < probeTimeout {
				probeTimeout = remaining
			}
		}

		for _, host := range candidates {
			token, tokenErr := c.getExecToken(waitCtx, vmid)
			if tokenErr != nil {
				lastErr = fmt.Errorf("fetch exec token: %w", tokenErr)
				continue
			}

			probeCtx, cancelProbe := context.WithTimeout(waitCtx, probeTimeout)
			result, probeErr := c.tryHTTPExec(probeCtx, host, execReadyProbeCommand, probeTimeout, token)
			cancelProbe()

			if errors.Is(probeErr, ErrExecUnauthorized) {
				// Token is stale — invalidate and re-fetch on the next iteration.
				c.invalidateExecToken()
				lastErr = fmt.Errorf("probe via %s: 401 Unauthorized (token stale)", host)
				continue
			}

			if probeErr != nil {
				if waitCtx.Err() != nil {
					return execReadyProbeError(instanceID, waitCtx.Err(), lastErr)
				}
				lastErr = fmt.Errorf("probe via %s failed: %w", host, probeErr)
				continue
			}

			if result == nil {
				lastErr = fmt.Errorf("probe via %s returned no result", host)
				continue
			}

			if result.ExitCode == 0 && strings.Contains(result.Stdout, "ready") {
				return nil
			}

			lastErr = fmt.Errorf(
				"probe via %s returned exit=%d stdout=%q stderr=%q",
				host,
				result.ExitCode,
				result.Stdout,
				result.Stderr,
			)
		}

		select {
		case <-waitCtx.Done():
			return execReadyProbeError(instanceID, waitCtx.Err(), lastErr)
		case <-time.After(execReadyPollInterval):
		}
	}
}

func (c *Client) ExecCommand(ctx context.Context, instanceID string, command string) (string, string, int, error) {
	if strings.TrimSpace(command) == "" {
		return "", "", -1, errors.New("command is required")
	}

	vmid, candidates, err := c.resolveExecCandidates(ctx, instanceID)
	if err != nil {
		return "", "", -1, err
	}

	maxRetries := 5
	baseDelay := 2 * time.Second

	for _, host := range candidates {
		for attempt := 1; attempt <= maxRetries; attempt++ {
			if ctx.Err() != nil {
				return "", "", -1, ctx.Err()
			}

			token, tokenErr := c.getExecToken(ctx, vmid)
			if tokenErr != nil {
				return "", "", -1, fmt.Errorf("fetch exec token: %w", tokenErr)
			}

			result, err := c.tryHTTPExec(ctx, host, command, 0, token)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return "", "", -1, err
				}
				// 401: invalidate token and retry with a fresh one (once per attempt).
				if errors.Is(err, ErrExecUnauthorized) && attempt == 1 {
					c.invalidateExecToken()
					continue
				}
			}
			if err == nil && result != nil {
				return result.Stdout, result.Stderr, result.ExitCode, nil
			}

			if attempt < maxRetries {
				select {
				case <-ctx.Done():
					return "", "", -1, ctx.Err()
				case <-time.After(time.Duration(attempt) * baseDelay):
				}
			}
		}
	}

	return "", "", -1, fmt.Errorf("HTTP exec failed for container %d via candidates: %s", vmid, strings.Join(candidates, ", "))
}

func ExecHostFromPublicDomain(publicDomain string, port int, instanceID string) (string, error) {
	if strings.TrimSpace(publicDomain) == "" {
		return "", errors.New("publicDomain is required")
	}
	if port <= 0 {
		return "", errors.New("port is required")
	}
	hostID := normalizeHostID(instanceID)
	if hostID == "" {
		return "", errors.New("instanceID is required")
	}
	return fmt.Sprintf("https://port-%d-%s.%s", port, hostID, strings.TrimSpace(publicDomain)), nil
}

func ParsePortFromPublicHost(host string) (int, bool) {
	u, err := url.Parse(host)
	if err != nil || u.Host == "" {
		return 0, false
	}
	parts := strings.Split(u.Host, ".")
	if len(parts) == 0 {
		return 0, false
	}
	first := parts[0]
	if !strings.HasPrefix(first, "port-") {
		return 0, false
	}
	rest := strings.TrimPrefix(first, "port-")
	portPart := strings.SplitN(rest, "-", 2)[0]
	p, err := strconv.Atoi(portPart)
	return p, err == nil && p > 0
}
