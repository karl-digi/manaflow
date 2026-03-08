package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var (
	clonePathPattern = regexp.MustCompile(`^/api2/json/nodes/([^/]+)/lxc/(\d+)/clone/?$`)
	hopByHopHeaders  = map[string]struct{}{
		"Connection":          {},
		"Proxy-Connection":    {},
		"Keep-Alive":          {},
		"Proxy-Authenticate":  {},
		"Proxy-Authorization": {},
		"Te":                  {},
		"Trailer":             {},
		"Transfer-Encoding":   {},
		"Upgrade":             {},
	}
)

// config holds runtime settings sourced from environment variables.
type config struct {
	listenAddr     string
	targetURL      string
	pollInterval   time.Duration
	pollTimeout    time.Duration
	requestTimeout time.Duration
	skipTLSVerify  bool
	queueSize      int
}

func main() {
	cfg := config{
		listenAddr:     getenv("CLONE_PROXY_LISTEN", "127.0.0.1:8081"),
		targetURL:      getenv("CLONE_PROXY_TARGET", getenv("PVE_API_URL", "https://127.0.0.1:8006")),
		pollInterval:   mustParseDuration(getenv("CLONE_PROXY_POLL_INTERVAL", "2s")),
		pollTimeout:    mustParseDuration(getenv("CLONE_PROXY_POLL_TIMEOUT", "15m")),
		requestTimeout: mustParseDuration(getenv("CLONE_PROXY_REQUEST_TIMEOUT", "30s")),
		skipTLSVerify:  strings.EqualFold(getenv("CLONE_PROXY_SKIP_TLS_VERIFY", "false"), "true"),
		queueSize:      mustParseInt(getenv("CLONE_PROXY_QUEUE_SIZE", "100")),
	}

	proxy, err := newCloneProxy(cfg)
	if err != nil {
		log.Fatalf("failed to initialize proxy: %v", err)
	}

	srv := &http.Server{
		Addr:              cfg.listenAddr,
		Handler:           proxy,
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownCtx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown failed: %v", err)
		}
	}()

	log.Printf("pve clone proxy listening on %s -> %s (queue=%d, poll=%s, timeout=%s)", cfg.listenAddr, cfg.targetURL, cfg.queueSize, cfg.pollInterval, cfg.pollTimeout)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server exited with error: %v", err)
	}
}

// cloneProxy proxies requests to the PVE API while serializing clone operations
// using a bounded in-memory queue.
type cloneProxy struct {
	target       *url.URL
	reverseProxy *httputil.ReverseProxy
	httpClient   *http.Client
	pollInterval time.Duration
	pollTimeout  time.Duration
	queue        chan *cloneRequest
}

type cloneRequest struct {
	w    http.ResponseWriter
	r    *http.Request
	body []byte
	node string
	done chan struct{}
}

func newCloneProxy(cfg config) (*cloneProxy, error) {
	target, err := url.Parse(cfg.targetURL)
	if err != nil {
		return nil, err
	}

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: cfg.skipTLSVerify},
	}

	rp := httputil.NewSingleHostReverseProxy(target)
	rp.Transport = transport
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy error: %v", err)
		http.Error(w, "upstream error", http.StatusBadGateway)
	}

	cp := &cloneProxy{
		target:       target,
		reverseProxy: rp,
		httpClient:   &http.Client{Transport: transport, Timeout: cfg.requestTimeout},
		pollInterval: cfg.pollInterval,
		pollTimeout:  cfg.pollTimeout,
		queue:        make(chan *cloneRequest, cfg.queueSize),
	}

	go cp.worker()

	return cp, nil
}

func (p *cloneProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && clonePathPattern.MatchString(r.URL.Path) {
		p.enqueueClone(w, r)
		return
	}
	p.reverseProxy.ServeHTTP(w, r)
}

func (p *cloneProxy) enqueueClone(w http.ResponseWriter, r *http.Request) {
	matches := clonePathPattern.FindStringSubmatch(r.URL.Path)
	node := matches[1]

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}
	r.Body.Close()

	req := &cloneRequest{
		w:    w,
		r:    r,
		body: body,
		node: node,
		done: make(chan struct{}),
	}

	select {
	case p.queue <- req:
		<-req.done
	default:
		log.Printf("clone queue full (size=%d)", cap(p.queue))
		http.Error(w, "clone queue full", http.StatusServiceUnavailable)
	}
}

func (p *cloneProxy) worker() {
	for req := range p.queue {
		p.processClone(req)
		close(req.done)
	}
}

func (p *cloneProxy) processClone(req *cloneRequest) {
	start := time.Now()

	upstreamURL := p.joinURL(req.r.URL)
	upstreamReq, err := http.NewRequestWithContext(req.r.Context(), req.r.Method, upstreamURL.String(), bytes.NewReader(req.body))
	if err != nil {
		http.Error(req.w, "failed to build upstream request", http.StatusBadRequest)
		return
	}
	upstreamReq.ContentLength = int64(len(req.body))
	upstreamReq.Host = p.target.Host
	copyHeaders(upstreamReq.Header, req.r.Header)
	addForwardHeaders(upstreamReq, req.r)

	resp, err := p.httpClient.Do(upstreamReq)
	if err != nil {
		log.Printf("clone request failed: %v", err)
		http.Error(req.w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("failed reading upstream response: %v", err)
		http.Error(req.w, "failed to read upstream response", http.StatusBadGateway)
		return
	}

	// If the clone call failed, return immediately.
	if resp.StatusCode >= 400 {
		copyResponseHeaders(req.w.Header(), resp.Header)
		req.w.WriteHeader(resp.StatusCode)
		if _, err := req.w.Write(respBody); err != nil {
			log.Printf("failed writing error response to client: %v", err)
		}
		return
	}

	upid := extractUPID(respBody)
	if upid == "" {
		copyResponseHeaders(req.w.Header(), resp.Header)
		req.w.WriteHeader(resp.StatusCode)
		if _, err := req.w.Write(respBody); err != nil {
			log.Printf("failed writing response to client: %v", err)
		}
		return
	}

	authHeaders := cloneAuthHeaders(req.r.Header)
	status, exitStatus, timedOut := p.waitForTask(req.node, upid, authHeaders)
	duration := time.Since(start)

	if timedOut {
		// Clone task is still running on PVE. Return an error to the client
		// but keep blocking until the task finishes to maintain serialization.
		log.Printf("clone task %s poll timed out after %s, waiting indefinitely for task completion", upid, duration)
		http.Error(req.w, "clone task poll timed out, task may still be running", http.StatusGatewayTimeout)

		// Continue polling without timeout to ensure we don't release the queue
		// slot until the clone task actually finishes on PVE.
		finalStatus, finalExitStatus := p.waitForTaskIndefinitely(req.node, upid, authHeaders)
		finalDuration := time.Since(start)
		log.Printf("clone task %s eventually finished status=%s exitstatus=%s (duration=%s)", upid, finalStatus, finalExitStatus, finalDuration)
		return
	}

	if status != "" {
		log.Printf("clone task %s finished status=%s exitstatus=%s (duration=%s)", upid, status, exitStatus, duration)
	} else {
		log.Printf("clone task %s finished (duration=%s)", upid, duration)
	}

	copyResponseHeaders(req.w.Header(), resp.Header)
	req.w.WriteHeader(resp.StatusCode)
	if _, err := req.w.Write(respBody); err != nil {
		log.Printf("failed writing response to client: %v", err)
	}
}

func (p *cloneProxy) waitForTask(node, upid string, authHeaders http.Header) (status string, exitStatus string, timedOut bool) {
	ctx, cancel := context.WithTimeout(context.Background(), p.pollTimeout)
	defer cancel()

	statusURL := p.taskStatusURL(node, upid)

	ticker := time.NewTicker(p.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("poll timeout for %s: %v", upid, ctx.Err())
			return "", "", true
		case <-ticker.C:
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
			if err != nil {
				log.Printf("failed to build status request: %v", err)
				continue
			}
			copyHeaders(req.Header, authHeaders)

			resp, err := p.httpClient.Do(req)
			if err != nil {
				log.Printf("status poll failed for %s: %v", upid, err)
				continue
			}

			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				log.Printf("status response read failed for %s: %v", upid, err)
				continue
			}

			if resp.StatusCode >= 300 {
				log.Printf("status poll returned %d for %s: %s", resp.StatusCode, upid, strings.TrimSpace(string(body)))
				continue
			}

			s, es := parseTaskStatus(body)
			if s == "running" {
				continue
			}

			if s == "" {
				s = "unknown"
			}
			return s, es, false
		}
	}
}

// waitForTaskIndefinitely polls the task status without any timeout.
// This is used after the initial poll timeout to ensure we don't release
// the queue slot while the clone task is still running on PVE.
func (p *cloneProxy) waitForTaskIndefinitely(node, upid string, authHeaders http.Header) (string, string) {
	statusURL := p.taskStatusURL(node, upid)

	ticker := time.NewTicker(p.pollInterval)
	defer ticker.Stop()

	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), p.httpClient.Timeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
		if err != nil {
			cancel()
			log.Printf("failed to build status request: %v", err)
			continue
		}
		copyHeaders(req.Header, authHeaders)

		resp, err := p.httpClient.Do(req)
		if err != nil {
			cancel()
			log.Printf("indefinite poll failed for %s: %v", upid, err)
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		cancel()
		if err != nil {
			log.Printf("indefinite poll response read failed for %s: %v", upid, err)
			continue
		}

		if resp.StatusCode >= 300 {
			log.Printf("indefinite poll returned %d for %s: %s", resp.StatusCode, upid, strings.TrimSpace(string(body)))
			continue
		}

		status, exitStatus := parseTaskStatus(body)
		if status == "running" {
			continue
		}

		if status == "" {
			status = "unknown"
		}
		return status, exitStatus
	}

	// Unreachable, but needed for compilation
	return "unknown", ""
}

func (p *cloneProxy) taskStatusURL(node, upid string) string {
	escapedNode := url.PathEscape(node)
	escapedUpid := url.PathEscape(upid)

	// Build an escaped path without letting url.URL double-encode percent sequences
	path := singleJoiningSlash(p.target.Path, "/api2/json/nodes/"+escapedNode+"/tasks/"+escapedUpid+"/status")

	u := *p.target
	u.RawQuery = ""

	// Keep the escaped form in RawPath and the unescaped form in Path so
	// EscapedPath uses the provided encoding instead of re-encoding the `%`.
	unescapedPath, err := url.PathUnescape(path)
	if err != nil {
		// Fallback to the escaped path if unescape ever fails (should not happen)
		unescapedPath = path
	}
	u.Path = unescapedPath
	u.RawPath = path

	return u.String()
}

func (p *cloneProxy) joinURL(reqURL *url.URL) *url.URL {
	target := *p.target
	target.Path = singleJoiningSlash(p.target.Path, reqURL.Path)
	if reqURL.RawQuery == "" {
		target.RawQuery = ""
	} else {
		target.RawQuery = reqURL.RawQuery
	}
	return &target
}

func extractUPID(body []byte) string {
	var payload struct {
		Data any `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}

	switch v := payload.Data.(type) {
	case string:
		return v
	case map[string]any:
		if upid, ok := v["upid"].(string); ok {
			return upid
		}
	}
	return ""
}

func parseTaskStatus(body []byte) (string, string) {
	var payload struct {
		Data struct {
			Status     string `json:"status"`
			ExitStatus string `json:"exitstatus"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", ""
	}

	return payload.Data.Status, payload.Data.ExitStatus
}

func copyHeaders(dst, src http.Header) {
	for k, vs := range src {
		if _, skip := hopByHopHeaders[k]; skip {
			continue
		}
		for _, v := range vs {
			dst.Add(k, v)
		}
	}
}

func copyResponseHeaders(dst, src http.Header) {
	for k, vs := range src {
		if _, skip := hopByHopHeaders[k]; skip {
			continue
		}
		for _, v := range vs {
			dst.Add(k, v)
		}
	}
}

func cloneAuthHeaders(src http.Header) http.Header {
	dst := http.Header{}
	for _, key := range []string{"Authorization", "Cookie", "CSRFPreventionToken", "Ticket"} {
		if values, ok := src[key]; ok {
			for _, v := range values {
				dst.Add(key, v)
			}
		}
	}
	return dst
}

func addForwardHeaders(outReq, inReq *http.Request) {
	clientIP, _, err := net.SplitHostPort(inReq.RemoteAddr)
	if err == nil {
		if prior := inReq.Header.Get("X-Forwarded-For"); prior != "" {
			clientIP = prior + ", " + clientIP
		}
		outReq.Header.Set("X-Forwarded-For", clientIP)
	}

	if xfProto := inReq.Header.Get("X-Forwarded-Proto"); xfProto != "" {
		outReq.Header.Set("X-Forwarded-Proto", xfProto)
	} else if inReq.TLS != nil {
		outReq.Header.Set("X-Forwarded-Proto", "https")
	} else {
		outReq.Header.Set("X-Forwarded-Proto", "http")
	}

	if xfHost := inReq.Header.Get("X-Forwarded-Host"); xfHost != "" {
		outReq.Header.Set("X-Forwarded-Host", xfHost)
	} else {
		outReq.Header.Set("X-Forwarded-Host", inReq.Host)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustParseDuration(v string) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Fatalf("invalid duration %q: %v", v, err)
	}
	return d
}

func mustParseInt(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		log.Fatalf("invalid int %q: %v", v, err)
	}
	return n
}

func singleJoiningSlash(a, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	}
	return a + b
}
