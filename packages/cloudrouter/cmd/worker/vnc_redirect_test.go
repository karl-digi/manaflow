package main

import (
	"net/url"
	"testing"
)

func TestVncPostAuthRedirectKeepsAutoconnectAndWebsockifyToken(t *testing.T) {
	got := vncPostAuthRedirect("/vnc.html", url.Values{
		"tkn":          []string{"secret-token"},
		"autoconnect":  []string{"1"},
		"resize":       []string{"scale"},
	}, "secret-token")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/vnc.html" {
		t.Fatalf("path: got %q", parsed.Path)
	}
	q := parsed.Query()
	if q.Get("tkn") != "" || q.Get("token") != "" {
		t.Fatalf("viewer URL still has tkn: %q", got)
	}
	if q.Get("autoconnect") != "1" || q.Get("resize") != "scale" {
		t.Fatalf("lost noVNC defaults: %q", got)
	}
	if q.Get("path") != "websockify?tkn=secret-token" {
		t.Fatalf("websockify path: got %q", q.Get("path"))
	}
}

func TestVncPostAuthRedirectPreservesExplicitPath(t *testing.T) {
	got := vncPostAuthRedirect("/vnc.html", url.Values{
		"tkn":  []string{"secret-token"},
		"path": []string{"websockify?tkn=already"},
	}, "secret-token")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("path") != "websockify?tkn=already" {
		t.Fatalf("path overwritten: %q", got)
	}
}
