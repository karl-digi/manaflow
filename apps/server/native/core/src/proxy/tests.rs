#[cfg(test)]
mod tests {
    use super::super::rewrite::*;
    use super::super::types::*;
    use super::super::server::*;

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
    fn test_derive_route_invalid() {
        let url = "http://example.com/path";
        let route = derive_route(url);
        assert!(route.is_none());
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
    fn test_build_cmux_host() {
        let route = ProxyRoute {
            morph_id: "test".to_string(),
            scope: "base".to_string(),
            domain_suffix: "cmux.sh".to_string(),
        };
        assert_eq!(build_cmux_host(&route, 8080), "cmux-test-base-8080.cmux.sh");
    }

    #[tokio::test]
    async fn test_proxy_server_starts() {
        let config = ProxyConfig {
            port_start: 50000, // Use high port to avoid conflicts
            port_range: 10,
        };

        let server = ProxyServer::start(config).await;
        assert!(server.is_ok());

        if let Ok(server) = server {
            assert!(server.port() >= 50000);
            assert!(server.port() < 50010);
            server.shutdown();
        }
    }

    #[tokio::test]
    async fn test_proxy_state() {
        let state = ProxyState::new();

        let context = ProxyContext {
            username: "test-user".to_string(),
            password: "test-pass".to_string(),
            route: None,
            web_contents_id: 1,
            persist_key: Some("test-key".to_string()),
        };

        // Add context
        state.add_context(context.clone()).await;

        // Retrieve by username
        let retrieved = state.get_context_by_username("test-user").await;
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().password, "test-pass");

        // Retrieve by web_contents_id
        let retrieved = state.get_context_by_web_contents_id(1).await;
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().username, "test-user");

        // Remove context
        let removed = state.remove_context(1).await;
        assert!(removed.is_some());

        // Verify removal
        let retrieved = state.get_context_by_username("test-user").await;
        assert!(retrieved.is_none());
    }

    #[tokio::test]
    async fn test_logging_enabled() {
        let state = ProxyState::new();

        // Default should be false
        assert!(!state.is_logging_enabled().await);

        // Enable logging
        state.set_logging_enabled(true).await;
        assert!(state.is_logging_enabled().await);

        // Disable logging
        state.set_logging_enabled(false).await;
        assert!(!state.is_logging_enabled().await);
    }
}
