package api

import (
	"fmt"
	"strings"
)

type Provider string

const (
	ProviderE2B     Provider = "e2b"
	ProviderDaytona Provider = "daytona"
)

func ParseProvider(raw string) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", string(ProviderE2B):
		return ProviderE2B, nil
	case string(ProviderDaytona):
		return ProviderDaytona, nil
	default:
		return "", fmt.Errorf("unknown provider %q (expected: e2b or daytona)", raw)
	}
}

func (p Provider) apiBasePath() (string, error) {
	switch p {
	case ProviderE2B:
		return "/api/v2/devbox", nil
	case ProviderDaytona:
		return "/api/v3/devbox", nil
	default:
		return "", fmt.Errorf("unsupported provider: %q", p)
	}
}
