package pvelxc

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultSnapshotID   = "snapshot_5141774e"
	defaultTemplateVMID = 9045
)

type SnapshotResolver func(snapshotID string) (templateVMID int, err error)

type Config struct {
	APIURL           string
	APIToken         string
	Node             string
	PublicDomain     string
	VerifyTLS        bool
	SnapshotResolver SnapshotResolver
}

type Client struct {
	apiURL   string
	apiToken string

	publicDomain string
	verifyTLS    bool

	apiHTTP  *http.Client
	execHTTP *http.Client

	snapshotResolver SnapshotResolver

	nodeMu sync.Mutex
	node   string

	dnsMu         sync.Mutex
	domainSuffix  string
	domainFetched bool
}

type Instance struct {
	ID        string
	VMID      int
	Status    string
	Hostname  string
	FQDN      string
	VSCodeURL string
	WorkerURL string
	VNCURL    string
	XTermURL  string
}

type StartOptions struct {
	SnapshotID   string
	TemplateVMID int
	InstanceID   string
}

type pveEnvelope struct {
	Data json.RawMessage `json:"data"`
}

type pveNodeInfo struct {
	Node string `json:"node"`
}

type pveDNSConfig struct {
	Search string `json:"search,omitempty"`
}

type pveTaskStatus struct {
	Status     string `json:"status"`
	ExitStatus string `json:"exitstatus,omitempty"`
}

type pveContainerStatus struct {
	Status   string `json:"status"`
	VMID     int    `json:"vmid"`
	Name     string `json:"name,omitempty"`
	Template int    `json:"template,omitempty"`
}

type pveContainerConfig struct {
	Net0     string `json:"net0,omitempty"`
	Hostname string `json:"hostname,omitempty"`
}

var (
	reDigits     = regexp.MustCompile(`^\d+$`)
	reCmuxVmid   = regexp.MustCompile(`^cmux-(\d+)$`)
	reSnapshotID = regexp.MustCompile(`^snapshot_[a-z0-9]+$`)
)

func NewClient(cfg Config) (*Client, error) {
	apiURL := strings.TrimRight(strings.TrimSpace(cfg.APIURL), "/")
	if apiURL == "" {
		return nil, errors.New("PVE apiUrl is required")
	}
	if cfg.APIToken == "" {
		return nil, errors.New("PVE apiToken is required")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: !cfg.VerifyTLS}

	return &Client{
		apiURL:           apiURL,
		apiToken:         cfg.APIToken,
		publicDomain:     strings.TrimSpace(cfg.PublicDomain),
		verifyTLS:        cfg.VerifyTLS,
		apiHTTP:          &http.Client{Transport: transport, Timeout: 180 * time.Second},
		execHTTP:         &http.Client{Timeout: 0},
		snapshotResolver: cfg.SnapshotResolver,
		node:             strings.TrimSpace(cfg.Node),
	}, nil
}

func NewClientFromEnv() (*Client, error) {
	apiURL := os.Getenv("PVE_API_URL")
	apiToken := os.Getenv("PVE_API_TOKEN")

	verifyTLS := false
	if v := strings.TrimSpace(os.Getenv("PVE_VERIFY_TLS")); v != "" && v != "0" && strings.ToLower(v) != "false" {
		verifyTLS = true
	}

	return NewClient(Config{
		APIURL:           apiURL,
		APIToken:         apiToken,
		Node:             os.Getenv("PVE_NODE"),
		PublicDomain:     os.Getenv("PVE_PUBLIC_DOMAIN"),
		VerifyTLS:        verifyTLS,
		SnapshotResolver: resolveSnapshotFromManifestOrDefault,
	})
}

func normalizeHostID(value string) string {
	return strings.TrimSpace(strings.ToLower(strings.ReplaceAll(value, "_", "-")))
}

func generateInstanceID() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "pvelxc-" + hex.EncodeToString(b), nil
}

func ParseVMID(instanceID string) (int, bool) {
	id := strings.TrimSpace(strings.ToLower(instanceID))
	if reDigits.MatchString(id) {
		vmid, err := strconv.Atoi(id)
		return vmid, err == nil && vmid > 0
	}
	if m := reCmuxVmid.FindStringSubmatch(id); len(m) == 2 {
		vmid, err := strconv.Atoi(m[1])
		return vmid, err == nil && vmid > 0
	}
	return 0, false
}

func (c *Client) apiRequestData(ctx context.Context, method, path string, params url.Values) (json.RawMessage, error) {
	reqURL := c.apiURL + path
	headers := http.Header{}
	headers.Set("Authorization", "PVEAPIToken="+c.apiToken)

	var body io.Reader
	if params != nil && len(params) > 0 {
		encoded := params.Encode()
		if method == http.MethodGet || method == http.MethodDelete {
			if strings.Contains(reqURL, "?") {
				reqURL += "&" + encoded
			} else {
				reqURL += "?" + encoded
			}
		} else {
			headers.Set("Content-Type", "application/x-www-form-urlencoded")
			body = strings.NewReader(encoded)
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return nil, err
	}
	req.Header = headers

	resp, err := c.apiHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if msg == "" {
			msg = "(empty response)"
		}
		return nil, fmt.Errorf("PVE API error %d: %s", resp.StatusCode, msg)
	}

	var env pveEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("failed to decode PVE response: %w", err)
	}
	return env.Data, nil
}

func apiRequest[T any](ctx context.Context, c *Client, method, path string, params url.Values) (T, error) {
	var zero T
	data, err := c.apiRequestData(ctx, method, path, params)
	if err != nil {
		return zero, err
	}
	if err := json.Unmarshal(data, &zero); err != nil {
		return zero, fmt.Errorf("failed to decode PVE data: %w", err)
	}
	return zero, nil
}

func normalizeUpid(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if strings.Contains(trimmed, "%3A") {
		if decoded, err := url.QueryUnescape(trimmed); err == nil {
			return decoded
		}
	}
	return trimmed
}

func extractUpid(data json.RawMessage) string {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		return normalizeUpid(s)
	}
	var obj struct {
		UPID string `json:"upid"`
	}
	if err := json.Unmarshal(data, &obj); err == nil {
		return normalizeUpid(obj.UPID)
	}
	return ""
}

func (c *Client) getNode(ctx context.Context) (string, error) {
	c.nodeMu.Lock()
	defer c.nodeMu.Unlock()
	if c.node != "" {
		return c.node, nil
	}

	nodes, err := apiRequest[[]pveNodeInfo](ctx, c, http.MethodGet, "/api2/json/nodes", nil)
	if err != nil {
		return "", err
	}
	if len(nodes) == 0 || nodes[0].Node == "" {
		return "", errors.New("no nodes found in PVE cluster")
	}
	c.node = nodes[0].Node
	return c.node, nil
}

func (c *Client) getDomainSuffix(ctx context.Context) (string, error) {
	c.dnsMu.Lock()
	defer c.dnsMu.Unlock()

	if c.domainFetched {
		return c.domainSuffix, nil
	}

	node, err := c.getNode(ctx)
	if err != nil {
		c.domainFetched = true
		c.domainSuffix = ""
		return "", err
	}

	dns, err := apiRequest[pveDNSConfig](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/dns", node), nil)
	if err != nil {
		c.domainFetched = true
		c.domainSuffix = ""
		return "", nil
	}

	search := strings.TrimSpace(dns.Search)
	if search == "" {
		c.domainSuffix = ""
	} else {
		// Use only the first search domain (PVE may return space-separated list)
		firstDomain := strings.Fields(search)[0]
		c.domainSuffix = "." + firstDomain
	}
	c.domainFetched = true
	return c.domainSuffix, nil
}

func (c *Client) getContainerConfig(ctx context.Context, vmid int) (pveContainerConfig, error) {
	node, err := c.getNode(ctx)
	if err != nil {
		return pveContainerConfig{}, err
	}
	return apiRequest[pveContainerConfig](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/lxc/%d/config", node, vmid), nil)
}

func (c *Client) getContainerIP(ctx context.Context, vmid int) (string, error) {
	cfg, err := c.getContainerConfig(ctx, vmid)
	if err != nil {
		return "", err
	}
	net0 := cfg.Net0
	if net0 == "" {
		return "", nil
	}
	// Format: name=eth0,bridge=vmbr0,ip=10.100.0.123/24,gw=...
	if m := regexp.MustCompile(`ip=([0-9.]+)`).FindStringSubmatch(net0); len(m) == 2 {
		return m[1], nil
	}
	return "", nil
}

func (c *Client) getContainerHostname(ctx context.Context, vmid int) (string, error) {
	cfg, err := c.getContainerConfig(ctx, vmid)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(cfg.Hostname), nil
}

func (c *Client) getContainerStatus(ctx context.Context, vmid int) (string, error) {
	node, err := c.getNode(ctx)
	if err != nil {
		return "", err
	}

	status, err := apiRequest[pveContainerStatus](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/lxc/%d/status/current", node, vmid), nil)
	if err != nil {
		return "unknown", nil
	}
	switch status.Status {
	case "running", "stopped", "paused":
		return status.Status, nil
	default:
		return "unknown", nil
	}
}

func (c *Client) waitForTask(ctx context.Context, upid string, timeout time.Duration) error {
	upid = normalizeUpid(upid)
	if upid == "" {
		return nil
	}

	node, err := c.getNode(ctx)
	if err != nil {
		return err
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		status, err := apiRequest[pveTaskStatus](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/tasks/%s/status", node, url.PathEscape(upid)), nil)
		if err != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(2 * time.Second):
			}
			continue
		}
		if status.Status == "stopped" {
			if status.ExitStatus != "" && status.ExitStatus != "OK" {
				return fmt.Errorf("task failed: %s", status.ExitStatus)
			}
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	return errors.New("task timeout")
}

func (c *Client) linkedCloneFromTemplate(ctx context.Context, templateVMID, newVMID int, hostname string) error {
	node, err := c.getNode(ctx)
	if err != nil {
		return err
	}

	data, err := c.apiRequestData(ctx, http.MethodPost, fmt.Sprintf("/api2/json/nodes/%s/lxc/%d/clone", node, templateVMID), url.Values{
		"newid":    []string{strconv.Itoa(newVMID)},
		"hostname": []string{hostname},
		"full":     []string{"0"},
	})
	if err != nil {
		return err
	}
	upid := extractUpid(data)
	return c.waitForTask(ctx, upid, 5*time.Minute)
}

func (c *Client) startContainer(ctx context.Context, vmid int) error {
	node, err := c.getNode(ctx)
	if err != nil {
		return err
	}
	data, err := c.apiRequestData(ctx, http.MethodPost, fmt.Sprintf("/api2/json/nodes/%s/lxc/%d/status/start", node, vmid), nil)
	if err != nil {
		return err
	}
	return c.waitForTask(ctx, extractUpid(data), 5*time.Minute)
}

func (c *Client) stopContainer(ctx context.Context, vmid int) error {
	status, _ := c.getContainerStatus(ctx, vmid)
	if status == "stopped" {
		return nil
	}

	node, err := c.getNode(ctx)
	if err != nil {
		return err
	}
	data, err := c.apiRequestData(ctx, http.MethodPost, fmt.Sprintf("/api2/json/nodes/%s/lxc/%d/status/stop", node, vmid), nil)
	if err != nil {
		return err
	}
	return c.waitForTask(ctx, extractUpid(data), 5*time.Minute)
}

func (c *Client) deleteContainer(ctx context.Context, vmid int) error {
	_ = c.stopContainer(ctx, vmid)

	node, err := c.getNode(ctx)
	if err != nil {
		return err
	}
	data, err := c.apiRequestData(ctx, http.MethodDelete, fmt.Sprintf("/api2/json/nodes/%s/lxc/%d", node, vmid), url.Values{
		"force": []string{"1"},
		"purge": []string{"1"},
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "does not exist") || strings.Contains(msg, "not found") {
			return nil
		}
		return err
	}
	return c.waitForTask(ctx, extractUpid(data), 5*time.Minute)
}

func (c *Client) findNextVMID(ctx context.Context) (int, error) {
	node, err := c.getNode(ctx)
	if err != nil {
		return 0, err
	}

	containers, err := apiRequest[[]pveContainerStatus](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/lxc", node), nil)
	if err != nil {
		return 0, err
	}
	vms, _ := apiRequest[[]struct {
		VMID int `json:"vmid"`
	}](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/qemu", node), nil)

	used := map[int]struct{}{}
	for _, c := range containers {
		used[c.VMID] = struct{}{}
	}
	for _, v := range vms {
		used[v.VMID] = struct{}{}
	}

	vmid := 200
	for {
		if _, ok := used[vmid]; !ok {
			return vmid, nil
		}
		vmid++
	}
}

func (c *Client) findVMIDByHostname(ctx context.Context, hostname string) (int, error) {
	node, err := c.getNode(ctx)
	if err != nil {
		return 0, err
	}
	containers, err := apiRequest[[]pveContainerStatus](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/lxc", node), nil)
	if err != nil {
		return 0, err
	}
	normalized := normalizeHostID(hostname)
	for _, ctr := range containers {
		if normalizeHostID(ctr.Name) == normalized {
			return ctr.VMID, nil
		}
	}
	return 0, fmt.Errorf("unable to resolve VMID for instance %s", hostname)
}

func (c *Client) resolveSnapshot(snapshotID string) (string, int, error) {
	id := strings.TrimSpace(strings.ToLower(snapshotID))
	if id == "" {
		id = defaultSnapshotID
	}
	if !reSnapshotID.MatchString(id) {
		return "", 0, fmt.Errorf("invalid PVE LXC snapshot ID: %s (expected snapshot_*)", id)
	}

	if c.snapshotResolver != nil {
		vmid, err := c.snapshotResolver(id)
		if err == nil && vmid > 0 {
			return id, vmid, nil
		}
		if err != nil {
			return "", 0, err
		}
	}

	if id == defaultSnapshotID {
		return id, defaultTemplateVMID, nil
	}
	return "", 0, fmt.Errorf("cannot resolve snapshot %s (run from repo root or set template VMID)", id)
}

func (c *Client) buildPublicServiceURL(port int, hostID string) (string, bool) {
	if strings.TrimSpace(c.publicDomain) == "" {
		return "", false
	}
	normalized := normalizeHostID(hostID)
	return fmt.Sprintf("https://port-%d-%s.%s", port, normalized, c.publicDomain), true
}

func (c *Client) buildServiceURL(ctx context.Context, port int, vmid int, hostname string, domainSuffix string, publicHostID string) (string, error) {
	if publicURL, ok := c.buildPublicServiceURL(port, publicHostID); ok {
		return publicURL, nil
	}
	if domainSuffix != "" {
		return fmt.Sprintf("http://%s%s:%d", hostname, domainSuffix, port), nil
	}
	ip, err := c.getContainerIP(ctx, vmid)
	if err != nil {
		return "", err
	}
	if ip != "" {
		return fmt.Sprintf("http://%s:%d", ip, port), nil
	}
	return "", fmt.Errorf("cannot build service URL for container %d: no public domain, DNS search domain, or container IP available", vmid)
}

func (c *Client) StartInstance(ctx context.Context, opts StartOptions) (*Instance, error) {
	_, templateVMID, err := c.resolveSnapshot(opts.SnapshotID)
	if err != nil {
		return nil, err
	}
	if opts.TemplateVMID > 0 {
		templateVMID = opts.TemplateVMID
	}

	instanceID := normalizeHostID(opts.InstanceID)
	if instanceID == "" {
		generated, err := generateInstanceID()
		if err != nil {
			return nil, err
		}
		instanceID = generated
	}
	hostname := instanceID

	domainSuffix, _ := c.getDomainSuffix(ctx)
	fqdn := ""
	if domainSuffix != "" {
		fqdn = hostname + domainSuffix
	}

	var vmid int
	var lastErr error
	for attempt := 1; attempt <= 5; attempt++ {
		vmid, err = c.findNextVMID(ctx)
		if err != nil {
			return nil, err
		}

		if err := c.linkedCloneFromTemplate(ctx, templateVMID, vmid, hostname); err != nil {
			msg := err.Error()
			if strings.Contains(msg, "already exists") {
				lastErr = err
				time.Sleep(time.Duration(attempt) * 100 * time.Millisecond)
				continue
			}
			return nil, err
		}

		if err := c.startContainer(ctx, vmid); err != nil {
			_ = c.deleteContainer(ctx, vmid)
			return nil, err
		}

		time.Sleep(3 * time.Second)

		vscodeURL, err := c.buildServiceURL(ctx, 39378, vmid, hostname, domainSuffix, hostname)
		if err != nil {
			return nil, err
		}
		workerURL, err := c.buildServiceURL(ctx, 39376, vmid, hostname, domainSuffix, hostname)
		if err != nil {
			return nil, err
		}
		vncURL, err := c.buildServiceURL(ctx, 39380, vmid, hostname, domainSuffix, hostname)
		if err != nil {
			return nil, err
		}
		xtermURL, err := c.buildServiceURL(ctx, 39383, vmid, hostname, domainSuffix, hostname)
		if err != nil {
			return nil, err
		}

		return &Instance{
			ID:        hostname,
			VMID:      vmid,
			Status:    "running",
			Hostname:  hostname,
			FQDN:      fqdn,
			VSCodeURL: vscodeURL,
			WorkerURL: workerURL,
			VNCURL:    vncURL,
			XTermURL:  xtermURL,
		}, nil
	}

	return nil, lastErr
}

func (c *Client) GetInstance(ctx context.Context, instanceID string) (*Instance, error) {
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
			return nil, err
		}
		vmid = resolved
	}

	status, _ := c.getContainerStatus(ctx, vmid)
	domainSuffix, _ := c.getDomainSuffix(ctx)
	fqdn := ""
	if domainSuffix != "" {
		fqdn = hostname + domainSuffix
	}

	vscodeURL, _ := c.buildServiceURL(ctx, 39378, vmid, hostname, domainSuffix, hostname)
	workerURL, _ := c.buildServiceURL(ctx, 39376, vmid, hostname, domainSuffix, hostname)
	vncURL, _ := c.buildServiceURL(ctx, 39380, vmid, hostname, domainSuffix, hostname)
	xtermURL, _ := c.buildServiceURL(ctx, 39383, vmid, hostname, domainSuffix, hostname)

	return &Instance{
		ID:        hostname,
		VMID:      vmid,
		Status:    status,
		Hostname:  hostname,
		FQDN:      fqdn,
		VSCodeURL: vscodeURL,
		WorkerURL: workerURL,
		VNCURL:    vncURL,
		XTermURL:  xtermURL,
	}, nil
}

func (c *Client) ListInstances(ctx context.Context) ([]Instance, error) {
	node, err := c.getNode(ctx)
	if err != nil {
		return nil, err
	}
	containers, err := apiRequest[[]pveContainerStatus](ctx, c, http.MethodGet, fmt.Sprintf("/api2/json/nodes/%s/lxc", node), nil)
	if err != nil {
		return nil, err
	}

	domainSuffix, _ := c.getDomainSuffix(ctx)
	instances := make([]Instance, 0, len(containers))
	for _, ctr := range containers {
		hostname := strings.TrimSpace(ctr.Name)
		if hostname == "" {
			continue
		}
		if !strings.HasPrefix(hostname, "cmux-") && !strings.HasPrefix(hostname, "pvelxc-") {
			continue
		}

		fqdn := ""
		if domainSuffix != "" {
			fqdn = hostname + domainSuffix
		}

		vscodeURL, _ := c.buildServiceURL(ctx, 39378, ctr.VMID, hostname, domainSuffix, hostname)
		instances = append(instances, Instance{
			ID:        hostname,
			VMID:      ctr.VMID,
			Status:    ctr.Status,
			Hostname:  hostname,
			FQDN:      fqdn,
			VSCodeURL: vscodeURL,
		})
	}

	return instances, nil
}

func (c *Client) PauseInstance(ctx context.Context, instanceID string) error {
	vmid, ok := ParseVMID(instanceID)
	if !ok {
		resolved, err := c.findVMIDByHostname(ctx, instanceID)
		if err != nil {
			return err
		}
		vmid = resolved
	}
	return c.stopContainer(ctx, vmid)
}

func (c *Client) ResumeInstance(ctx context.Context, instanceID string) error {
	vmid, ok := ParseVMID(instanceID)
	if !ok {
		resolved, err := c.findVMIDByHostname(ctx, instanceID)
		if err != nil {
			return err
		}
		vmid = resolved
	}
	return c.startContainer(ctx, vmid)
}

func (c *Client) StopInstance(ctx context.Context, instanceID string) error {
	vmid, ok := ParseVMID(instanceID)
	if !ok {
		resolved, err := c.findVMIDByHostname(ctx, instanceID)
		if err != nil {
			return err
		}
		vmid = resolved
	}
	return c.deleteContainer(ctx, vmid)
}

func findRepoRootForPveManifest() (string, bool) {
	wd, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		candidate := filepath.Join(wd, "packages", "shared", "src", "pve-lxc-snapshots.json")
		if _, err := os.Stat(candidate); err == nil {
			return wd, true
		}
		next := filepath.Dir(wd)
		if next == wd {
			return "", false
		}
		wd = next
	}
}

func resolveSnapshotFromManifestOrDefault(snapshotID string) (int, error) {
	id := strings.TrimSpace(strings.ToLower(snapshotID))
	if id == "" {
		id = defaultSnapshotID
	}

	root, ok := findRepoRootForPveManifest()
	if !ok {
		if id == defaultSnapshotID {
			return defaultTemplateVMID, nil
		}
		return 0, fmt.Errorf("snapshot manifest not found (run from repo root to resolve %s)", id)
	}

	path := filepath.Join(root, "packages", "shared", "src", "pve-lxc-snapshots.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	var manifest struct {
		Presets []struct {
			Versions []struct {
				Version      int    `json:"version"`
				SnapshotID   string `json:"snapshotId"`
				TemplateVMID int    `json:"templateVmid"`
			} `json:"versions"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return 0, err
	}

	for _, preset := range manifest.Presets {
		for _, v := range preset.Versions {
			if strings.ToLower(v.SnapshotID) == id {
				if v.TemplateVMID <= 0 {
					return 0, fmt.Errorf("invalid template VMID for snapshot %s", id)
				}
				return v.TemplateVMID, nil
			}
		}
	}

	if id == defaultSnapshotID {
		return defaultTemplateVMID, nil
	}
	return 0, fmt.Errorf("PVE LXC snapshot not found: %s", id)
}
