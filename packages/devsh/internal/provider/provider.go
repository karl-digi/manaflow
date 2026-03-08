package provider

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

const (
	Morph  = "morph"
	PveLxc = "pve-lxc"
)

var (
	reDigits   = regexp.MustCompile(`^\d+$`)
	reCmuxVmid = regexp.MustCompile(`^cmux-\d+$`)
	reMorphID  = regexp.MustCompile(`^(cmux|manaflow)_[a-z0-9]+$`)
)

func HasPveEnv() bool {
	return os.Getenv("PVE_API_URL") != "" && os.Getenv("PVE_API_TOKEN") != ""
}

// DetectFromEnv selects a provider based on environment variables.
// If PVE_API_URL and PVE_API_TOKEN are set, it selects pve-lxc. Otherwise it selects morph.
func DetectFromEnv() string {
	if HasPveEnv() {
		return PveLxc
	}
	return Morph
}

// NormalizeProvider normalizes and validates a provider string.
// Returns "" for empty input (caller may use auto-detection).
func NormalizeProvider(value string) (string, error) {
	v := strings.TrimSpace(strings.ToLower(value))
	v = strings.ReplaceAll(v, "_", "-")
	if v == "" {
		return "", nil
	}
	switch v {
	case Morph:
		return Morph, nil
	case PveLxc:
		return PveLxc, nil
	default:
		return "", fmt.Errorf("unknown provider %q (expected %q or %q)", value, Morph, PveLxc)
	}
}

// IsPveLxcInstanceID returns true if the instance ID looks like a PVE LXC instance.
// Supported formats:
//   - "pvelxc-<suffix>"
//   - "cmux-<vmid>"
//   - "<vmid>" (numeric)
func IsPveLxcInstanceID(id string) bool {
	normalized := strings.ToLower(strings.TrimSpace(id))
	if strings.HasPrefix(normalized, "pvelxc-") {
		return true
	}
	if reCmuxVmid.MatchString(normalized) {
		return true
	}
	if reDigits.MatchString(normalized) {
		return true
	}
	return false
}

// IsMorphInstanceID returns true if the instance ID looks like a Morph-backed cmux instance.
// Expected format: "cmux_<id>".
func IsMorphInstanceID(id string) bool {
	normalized := strings.ToLower(strings.TrimSpace(id))
	return reMorphID.MatchString(normalized)
}

// ProviderForInstanceID infers provider from an instance ID, falling back to env detection.
func ProviderForInstanceID(instanceID string) string {
	if IsPveLxcInstanceID(instanceID) {
		return PveLxc
	}
	if IsMorphInstanceID(instanceID) {
		return Morph
	}
	return DetectFromEnv()
}
