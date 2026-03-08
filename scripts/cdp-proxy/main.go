package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type proxyConfig struct {
	externalPort  int
	internalPorts []int
	targetPort    int
	targetHost    string
	hostHeader    string
}

type intSliceFlag struct {
	values []int
}

func (f *intSliceFlag) String() string {
	if len(f.values) == 0 {
		return ""
	}
	return fmt.Sprintf("%v", f.values)
}

func (f *intSliceFlag) Set(value string) error {
	port, err := parsePortValue(value)
	if err != nil {
		return err
	}
	f.values = append(f.values, port)
	return nil
}

var internalPortFlags intSliceFlag

func init() {
	flag.Var(&internalPortFlags, "internal-port", "Internal listener port (repeatable). Binds to 127.0.0.1")
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func parsePortValue(raw string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 || value > 65535 {
		return 0, fmt.Errorf("invalid port value %q", raw)
	}
	return value, nil
}

func parsePort(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	value, err := parsePortValue(raw)
	if err != nil {
		log.Fatal(err)
	}
	return value
}

func parseInternalPorts(raw string) []int {
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	var ports []int
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		value, err := parsePortValue(trimmed)
		if err != nil {
			log.Fatal(err)
		}
		ports = append(ports, value)
	}

	return ports
}

func dedupePorts(ports []int) []int {
	seen := make(map[int]struct{}, len(ports))
	var result []int
	for _, port := range ports {
		if _, ok := seen[port]; ok {
			continue
		}
		seen[port] = struct{}{}
		result = append(result, port)
	}
	return result
}

func loadConfig(flagPorts []int) proxyConfig {
	targetPort := parsePort(getenv("CMUX_CDP_TARGET_PORT", "39382"), 39382)

	envInternalPorts := parseInternalPorts(getenv("CMUX_CDP_INTERNAL_PORTS", ""))
	var internalPorts []int
	switch {
	case len(flagPorts) > 0:
		internalPorts = flagPorts
	case len(envInternalPorts) > 0:
		internalPorts = envInternalPorts
	default:
		internalPorts = []int{9222}
	}

	return proxyConfig{
		externalPort:  parsePort(getenv("CMUX_CDP_PROXY_PORT", "39381"), 39381),
		internalPorts: dedupePorts(internalPorts),
		targetPort:    targetPort,
		targetHost:    getenv("CMUX_CDP_TARGET_HOST", "127.0.0.1"),
		hostHeader:    getenv("CMUX_CDP_TARGET_HOST_HEADER", fmt.Sprintf("localhost:%d", targetPort)),
	}
}

func main() {
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.LUTC)
	cfg := loadConfig(internalPortFlags.values)

	targetURL := &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort(cfg.targetHost, strconv.Itoa(cfg.targetPort)),
	}

	// Custom dialer with TCP_NODELAY for low-latency proxying
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	// Custom transport with TCP_NODELAY enabled
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			conn, err := dialer.DialContext(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			if tcpConn, ok := conn.(*net.TCPConn); ok {
				if err := tcpConn.SetNoDelay(true); err != nil {
					log.Printf("warning: failed to set TCP_NODELAY: %v", err)
				}
			}
			return conn, nil
		},
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	proxy.Transport = transport
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = cfg.hostHeader
		req.Header.Set("Host", cfg.hostHeader)
		req.Header.Del("Proxy-Connection")
	}

	proxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, err error) {
		log.Printf("proxy error: %v", err)
		rw.Header().Set("Content-Type", "text/plain")
		rw.WriteHeader(http.StatusBadGateway)
		_, _ = rw.Write([]byte("Bad Gateway"))
	}

	proxy.FlushInterval = 100 * time.Millisecond

	log.Print("TCP_NODELAY enabled for low-latency proxying")

	type listenerConfig struct {
		host  string
		port  int
		label string
	}

	listeners := []listenerConfig{
		{host: "0.0.0.0", port: cfg.externalPort, label: "external"},
	}
	for _, port := range cfg.internalPorts {
		listeners = append(listeners, listenerConfig{host: "127.0.0.1", port: port, label: "internal"})
	}

	errCh := make(chan error, len(listeners))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	for _, listener := range listeners {
		listener := listener
		wg.Add(1)
		go func() {
			defer wg.Done()

			addr := net.JoinHostPort(listener.host, strconv.Itoa(listener.port))
			server := &http.Server{
				Addr:              addr,
				Handler:           proxy,
				ReadHeaderTimeout: 5 * time.Second,
			}

			go func() {
				<-ctx.Done()
				shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancelShutdown()
				_ = server.Shutdown(shutdownCtx)
			}()

			log.Printf(
				"cmux CDP proxy listening on %s (%s), forwarding to %s (Host header: %s)",
				addr,
				listener.label,
				targetURL.Host,
				cfg.hostHeader,
			)

			if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				select {
				case errCh <- fmt.Errorf("%s listener on %s exited: %w", listener.label, addr, err):
				default:
				}
			}
		}()
	}

	err := <-errCh
	cancel()
	wg.Wait()
	log.Fatalf("server exited: %v", err)
}
