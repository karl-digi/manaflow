//! Integration test to verify all coding agent CLIs are properly installed.
//!
//! This test runs inside the Docker container and verifies that all CLI tools
//! can be invoked with --version. This catches issues like:
//! - Missing binaries
//! - Broken symlinks
//! - Accidentally removed vendor directories during image optimization

/// Test that all coding agent CLIs are installed and can print their version.
/// This test is ignored by default and should be run inside the sandbox container.
#[test]
#[ignore = "requires sandbox container environment"]
fn test_coding_agent_clis_installed() {
    let agents = [
        ("claude", "--version"),
        ("codex", "--version"),
        ("gemini", "--version"),
        ("opencode", "--version"),
        ("amp", "--version"),
    ];

    for (agent, flag) in agents {
        let output = std::process::Command::new(agent)
            .arg(flag)
            .output()
            .unwrap_or_else(|e| panic!("Failed to execute {}: {}", agent, e));

        assert!(
            output.status.success(),
            "{} {} failed with status {:?}\nstdout: {}\nstderr: {}",
            agent,
            flag,
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        println!(
            "{}: {}",
            agent,
            String::from_utf8_lossy(&output.stdout).trim()
        );
    }
}
