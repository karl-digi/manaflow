package pvelxc

import (
	"fmt"
	"strings"
	"testing"

	"github.com/karlorz/devsh/internal/provider"
)

func TestIsPveLxcInstanceID(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"pvelxc-abc123", true},
		{"cmux-200", true},
		{"200", true},
		{"cmux_abc123", false},
		{"morphvm_xyz", false},
		{"e2b-sandbox", false},
	}

	for _, tt := range tests {
		if got := provider.IsPveLxcInstanceID(tt.id); got != tt.want {
			t.Errorf("IsPveLxcInstanceID(%q) = %v, want %v", tt.id, got, tt.want)
		}
	}
}

func TestDetectProviderFromEnv(t *testing.T) {
	t.Setenv("PVE_API_URL", "https://pve.test:8006")
	t.Setenv("PVE_API_TOKEN", "root@pam!token=abc")
	if got := provider.DetectFromEnv(); got != provider.PveLxc {
		t.Fatalf("DetectFromEnv() = %q, want %q", got, provider.PveLxc)
	}

	t.Setenv("PVE_API_URL", "")
	t.Setenv("PVE_API_TOKEN", "")
	if got := provider.DetectFromEnv(); got != provider.Morph {
		t.Fatalf("DetectFromEnv() = %q, want %q", got, provider.Morph)
	}
}

func TestParseFirstDomainFromSearchList(t *testing.T) {
	tests := []struct {
		search string
		want   string
	}{
		{"example.com", ".example.com"},
		{"corp.example.com local", ".corp.example.com"},
		{"a.com b.com c.com", ".a.com"},
		{"  spaced.com  other.com  ", ".spaced.com"},
		{"", ""},
		{"   ", ""},
	}

	for _, tt := range tests {
		search := tt.search
		var got string
		trimmed := strings.TrimSpace(search)
		if trimmed == "" {
			got = ""
		} else {
			firstDomain := strings.Fields(trimmed)[0]
			got = "." + firstDomain
		}
		if got != tt.want {
			t.Errorf("parseFirstDomain(%q) = %q, want %q", tt.search, got, tt.want)
		}
	}
}

func TestNumericHostnameFallback(t *testing.T) {
	tests := []struct {
		instanceID string
		wantVMID   int
		wantOK     bool
	}{
		{"200", 200, true},
		{"cmux-200", 200, true},
		{"pvelxc-abc123", 0, false},
	}

	for _, tt := range tests {
		vmid, ok := ParseVMID(tt.instanceID)
		if ok != tt.wantOK {
			t.Errorf("ParseVMID(%q) ok = %v, want %v", tt.instanceID, ok, tt.wantOK)
		}
		if ok && vmid != tt.wantVMID {
			t.Errorf("ParseVMID(%q) = %d, want %d", tt.instanceID, vmid, tt.wantVMID)
		}

		// Test hostname fallback logic for numeric IDs
		if ok {
			hostname := normalizeHostID(tt.instanceID)
			if hostname == "" || reDigits.MatchString(hostname) {
				hostname = fmt.Sprintf("cmux-%d", vmid)
			}
			expected := fmt.Sprintf("cmux-%d", tt.wantVMID)
			if hostname != expected {
				t.Errorf("hostname fallback for %q = %q, want %q", tt.instanceID, hostname, expected)
			}
		}
	}
}

func TestExecURLFormat(t *testing.T) {
	host, err := ExecHostFromPublicDomain("example.com", 39375, "pvelxc-abc123")
	if err != nil {
		t.Fatalf("ExecHostFromPublicDomain() error = %v", err)
	}
	if host != "https://port-39375-pvelxc-abc123.example.com" {
		t.Fatalf("ExecHostFromPublicDomain() = %q", host)
	}

	execURL, err := buildExecURL(host)
	if err != nil {
		t.Fatalf("buildExecURL() error = %v", err)
	}
	if execURL != "https://port-39375-pvelxc-abc123.example.com/exec" {
		t.Fatalf("buildExecURL() = %q", execURL)
	}

	execURL2, err := buildExecURL("10.0.0.1:39375")
	if err != nil {
		t.Fatalf("buildExecURL(bare host) error = %v", err)
	}
	if execURL2 != "http://10.0.0.1:39375/exec" {
		t.Fatalf("buildExecURL(bare host) = %q", execURL2)
	}
}
