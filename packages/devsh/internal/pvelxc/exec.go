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
	"strconv"
	"strings"
	"time"
)

type ExecResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

type execEvent struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

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

func (c *Client) tryHTTPExec(ctx context.Context, host string, command string, timeout time.Duration) (*ExecResult, error) {
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

	resp, err := c.execHTTP.Do(req)
	if err != nil {
		// Propagate context errors immediately (don't retry on cancellation/timeout)
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, nil
	}
	defer resp.Body.Close()

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

func (c *Client) ExecCommand(ctx context.Context, instanceID string, command string) (string, string, int, error) {
	if strings.TrimSpace(command) == "" {
		return "", "", -1, errors.New("command is required")
	}

	vmid, ok := ParseVMID(instanceID)
	hostname := normalizeHostID(instanceID)
	if ok {
		if h, err := c.getContainerHostname(ctx, vmid); err == nil && h != "" {
			hostname = normalizeHostID(h)
		}
		// Always fallback to cmux-<vmid> for numeric-only hostnames
		if hostname == "" || reDigits.MatchString(hostname) {
			hostname = fmt.Sprintf("cmux-%d", vmid)
		}
	} else {
		resolved, err := c.findVMIDByHostname(ctx, instanceID)
		if err != nil {
			return "", "", -1, err
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
		return "", "", -1, fmt.Errorf("cannot execute command in container %d: no reachable exec host candidates", vmid)
	}

	maxRetries := 5
	baseDelay := 2 * time.Second

	for _, host := range candidates {
		for attempt := 1; attempt <= maxRetries; attempt++ {
			// Check context before each attempt
			if ctx.Err() != nil {
				return "", "", -1, ctx.Err()
			}

			result, err := c.tryHTTPExec(ctx, host, command, 0)
			if err != nil {
				// Propagate context errors immediately
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return "", "", -1, err
				}
			}
			if err == nil && result != nil {
				return result.Stdout, result.Stderr, result.ExitCode, nil
			}

			if attempt < maxRetries {
				// Use select to respect context cancellation during sleep
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
	// Best-effort helper for tests/logging only.
	// Expected: https://port-39375-<id>.<domain>
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
