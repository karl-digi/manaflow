use anyhow::{anyhow, Result};
use std::process::{Command, Stdio};

/// Redact sensitive tokens from strings for safe logging.
/// Handles URLs like https://x-access-token:TOKEN@github.com/...
pub fn redact_token(s: &str) -> String {
    // Pattern: https://x-access-token:TOKEN@github.com
    if let Some(start) = s.find("x-access-token:") {
        if let Some(at_pos) = s[start..].find('@') {
            let token_start = start + "x-access-token:".len();
            let token_end = start + at_pos;
            return format!("{}[REDACTED]{}", &s[..token_start], &s[token_end..]);
        }
    }
    s.to_string()
}

/// Redact tokens from a list of arguments for safe error messages.
fn redact_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|a| redact_token(a)).collect()
}

pub fn run_git(cwd: &str, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args).stdin(Stdio::null());
    let output = cmd.output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        // Redact potential tokens from args and stderr before logging
        let safe_args = redact_args(args);
        let safe_err = redact_token(&err);
        Err(anyhow!("git {:?} failed: {}", safe_args, safe_err))
    }
}
