use url::Url;
use super::types::{ProxyRoute, ProxyContext, CMUX_DOMAINS};

/// Parse route information from a URL
pub fn derive_route(url_str: &str) -> Option<ProxyRoute> {
    let url = Url::parse(url_str).ok()?;
    let hostname = url.host_str()?.to_lowercase();

    // Pattern 1: port-{port}-morphvm-{morphId}.http.cloud.morph.so
    if let Some(caps) = hostname.strip_prefix("port-") {
        if let Some(morph_match) = caps.strip_suffix(".http.cloud.morph.so") {
            if let Some(morph_idx) = morph_match.find("-morphvm-") {
                let morph_id = &morph_match[morph_idx + 9..];
                if !morph_id.is_empty() {
                    return Some(ProxyRoute {
                        morph_id: morph_id.to_string(),
                        scope: "base".to_string(),
                        domain_suffix: "cmux.app".to_string(),
                    });
                }
            }
        }
    }

    // Pattern 2: cmux-{morphId}-{scope}-{port}.{domainSuffix}
    for &domain in CMUX_DOMAINS {
        let suffix = format!(".{}", domain);
        if !hostname.ends_with(&suffix) {
            continue;
        }

        let subdomain = &hostname[..hostname.len() - suffix.len()];
        if !subdomain.starts_with("cmux-") {
            continue;
        }

        let remainder = &subdomain[5..]; // Skip "cmux-"
        let segments: Vec<&str> = remainder.split('-').filter(|s| !s.is_empty()).collect();
        if segments.len() < 3 {
            continue;
        }

        // Last segment should be port (numeric)
        let port_segment = segments.last()?;
        if !port_segment.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        // Second-to-last is scope
        let scope_segment = segments[segments.len() - 2];

        // Everything before is morphId
        let morph_id = segments[..segments.len() - 2].join("-");
        if morph_id.is_empty() {
            continue;
        }

        return Some(ProxyRoute {
            morph_id,
            scope: scope_segment.to_string(),
            domain_suffix: domain.to_string(),
        });
    }

    None
}

/// Check if a hostname is a loopback address
pub fn is_loopback_hostname(hostname: &str) -> bool {
    matches!(
        hostname.to_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | "[::1]"
    ) || hostname.starts_with("127.")
        || hostname.starts_with("[::ffff:127.")
}

/// Determine the requested port from a URL
pub fn determine_requested_port(url: &Url) -> u16 {
    if let Some(port) = url.port() {
        return port;
    }
    match url.scheme() {
        "https" | "wss" => 443,
        _ => 80,
    }
}

/// Build a cmux hostname from route and port
pub fn build_cmux_host(route: &ProxyRoute, port: u16) -> String {
    format!(
        "cmux-{}-{}-{}.{}",
        route.morph_id, route.scope, port, route.domain_suffix
    )
}

/// Rewrite a target URL using the proxy context
pub fn rewrite_target(url: &Url, context: &ProxyContext) -> (Url, bool) {
    let mut rewritten = url.clone();
    let mut secure = url.scheme() == "https" || url.scheme() == "wss";

    if let Some(route) = &context.route {
        if let Some(host) = url.host_str() {
            if is_loopback_hostname(host) {
                let requested_port = determine_requested_port(url);
                let new_host = build_cmux_host(route, requested_port);

                // Rewrite to HTTPS
                let new_scheme = if url.scheme() == "ws" || url.scheme() == "wss" {
                    "wss"
                } else {
                    "https"
                };

                rewritten.set_scheme(new_scheme).ok();
                rewritten.set_host(Some(&new_host)).ok();
                rewritten.set_port(None).ok();
                secure = true;
            }
        }
    }

    (rewritten, secure)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_route_morph_pattern() {
        let url = "http://port-8080-morphvm-test123.http.cloud.morph.so/path";
        let route = derive_route(url).unwrap();
        assert_eq!(route.morph_id, "test123");
        assert_eq!(route.scope, "base");
        assert_eq!(route.domain_suffix, "cmux.app");
    }

    #[test]
    fn test_derive_route_cmux_pattern() {
        let url = "http://cmux-morphid-base-8080.cmux.sh/path";
        let route = derive_route(url).unwrap();
        assert_eq!(route.morph_id, "morphid");
        assert_eq!(route.scope, "base");
        assert_eq!(route.domain_suffix, "cmux.sh");
    }

    #[test]
    fn test_derive_route_cmux_multi_segment_morph() {
        let url = "http://cmux-my-long-morph-id-base-3000.cmux.app/";
        let route = derive_route(url).unwrap();
        assert_eq!(route.morph_id, "my-long-morph-id");
        assert_eq!(route.scope, "base");
        assert_eq!(route.domain_suffix, "cmux.app");
    }

    #[test]
    fn test_is_loopback_hostname() {
        assert!(is_loopback_hostname("localhost"));
        assert!(is_loopback_hostname("127.0.0.1"));
        assert!(is_loopback_hostname("127.18.0.5"));
        assert!(is_loopback_hostname("::1"));
        assert!(is_loopback_hostname("[::1]"));
        assert!(!is_loopback_hostname("cmux.app"));
        assert!(!is_loopback_hostname("example.com"));
    }

    #[test]
    fn test_determine_requested_port() {
        let url = Url::parse("http://localhost:8080/").unwrap();
        assert_eq!(determine_requested_port(&url), 8080);

        let url = Url::parse("https://localhost/").unwrap();
        assert_eq!(determine_requested_port(&url), 443);

        let url = Url::parse("http://localhost/").unwrap();
        assert_eq!(determine_requested_port(&url), 80);
    }

    #[test]
    fn test_build_cmux_host() {
        let route = ProxyRoute {
            morph_id: "test".to_string(),
            scope: "base".to_string(),
            domain_suffix: "cmux.sh".to_string(),
        };
        assert_eq!(build_cmux_host(&route, 8080), "cmux-test-base-8080.cmux.sh");
    }
}
