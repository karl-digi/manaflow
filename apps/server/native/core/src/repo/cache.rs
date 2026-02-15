use anyhow::{anyhow, Result};
use dirs_next::cache_dir;
use std::sync::{Mutex, OnceLock};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use crate::util::run_git;

const MAX_CACHE_REPOS: usize = 20;

// Default SWR window for git fetches. Lower means fetch more often.
pub const DEFAULT_FETCH_WINDOW_MS: u128 = 5_000; // 5s

pub fn fetch_window_ms() -> u128 {
    if let Ok(v) = std::env::var("CMUX_GIT_FETCH_WINDOW_MS") {
        if let Ok(parsed) = v.parse::<u128>() {
            return parsed;
        }
    }
    DEFAULT_FETCH_WINDOW_MS
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct CacheIndexEntry {
    slug: String,
    path: String,
    last_access_ms: u128,
    #[serde(default)]
    last_fetch_ms: Option<u128>,
}

#[derive(Default, Debug, Clone, serde::Serialize, serde::Deserialize)]
struct CacheIndex {
    entries: Vec<CacheIndexEntry>,
}

fn default_cache_root() -> PathBuf {
    if let Ok(dir) = std::env::var("CMUX_RUST_GIT_CACHE") {
        return PathBuf::from(dir);
    }
    if let Some(mut d) = cache_dir() {
        d.push("cmux-git-cache");
        return d;
    }
    std::env::temp_dir().join("cmux-git-cache")
}

fn slug_from_url(url: &str) -> String {
    let clean = url.trim_end_matches(".git");
    let name = clean.split('/').rev().take(2).collect::<Vec<_>>();
    if name.len() == 2 {
        format!("{}__{}", name[1], name[0])
    } else {
        clean.replace(['/', ':', '@', '\\'], "_")
    }
}

pub fn ensure_repo(url: &str) -> Result<PathBuf> {
    ensure_repo_with_auth(url, None)
}

/// Ensure a repository is cloned and up-to-date, with optional auth token for private repos.
/// The auth token is only used transiently for clone/fetch operations.
/// Cache paths are derived from the clean URL (without token) to ensure consistent caching.
/// If no explicit auth_token is provided but the URL contains embedded credentials,
/// those credentials will be extracted and used for authentication.
pub fn ensure_repo_with_auth(url: &str, auth_token: Option<&str>) -> Result<PathBuf> {
    let root = default_cache_root();
    fs::create_dir_all(&root)?;

    // Extract token from URL if no explicit token provided (backwards compatibility)
    let url_token = extract_token_from_url(url);
    let effective_token: Option<&str> = auth_token.or(url_token.as_deref());

    // Use clean URL for cache path derivation (token stripped)
    let clean_url = strip_auth_from_url(url);
    let path = root.join(slug_from_url(&clean_url));
    let git_dir = path.join(".git");
    let head = git_dir.join("HEAD");
    if path.exists() && (!git_dir.exists() || !head.exists()) {
        let _ = fs::remove_dir_all(&path);
    }

    if !path.exists() {
        fs::create_dir_all(&path)?;
        // Use git -c url.insteadOf for clone to avoid persisting token
        let clone_result = if let Some(token) = effective_token {
            if !token.is_empty() {
                let auth_prefix = format!("https://x-access-token:{}@github.com/", token);
                let config_arg = format!("url.{}.insteadOf=https://github.com/", auth_prefix);
                run_git(
                    root.to_string_lossy().as_ref(),
                    &[
                        "-c",
                        &config_arg,
                        "clone",
                        "--no-single-branch",
                        &clean_url,
                        path.file_name().unwrap().to_str().unwrap(),
                    ],
                )
            } else {
                run_git(
                    root.to_string_lossy().as_ref(),
                    &[
                        "clone",
                        "--no-single-branch",
                        &clean_url,
                        path.file_name().unwrap().to_str().unwrap(),
                    ],
                )
            }
        } else {
            run_git(
                root.to_string_lossy().as_ref(),
                &[
                    "clone",
                    "--no-single-branch",
                    &clean_url,
                    path.file_name().unwrap().to_str().unwrap(),
                ],
            )
        };
        clone_result?;
        let _ = update_cache_index_with(&root, &path, Some(now_ms()));
    } else {
        let _ = swr_fetch_origin_all_path_with_auth(&path, fetch_window_ms(), effective_token);
    }
    let shallow = path.join(".git").join("shallow");
    if shallow.exists() {
        // Use authenticated fetch for unshallow
        let _ = fetch_with_auth(
            path.to_string_lossy().as_ref(),
            &["fetch", "--unshallow", "--tags"],
            effective_token,
        );
    }

    update_cache_index(&root, &path)?;
    enforce_cache_limit(&root)?;
    Ok(path)
}

/// Strip authentication credentials from a URL for safe caching/logging.
fn strip_auth_from_url(url: &str) -> String {
    // Handle URLs like https://x-access-token:TOKEN@github.com/...
    if let Some(at_pos) = url.find('@') {
        if url.starts_with("https://") {
            if let Some(proto_end) = url.find("://") {
                let before_at = &url[proto_end + 3..at_pos];
                // Check if there's auth info (contains ':' which separates user:pass)
                if before_at.contains(':') {
                    return format!("https://{}", &url[at_pos + 1..]);
                }
            }
        }
    }
    url.to_string()
}

/// Extract auth token from a URL if present.
/// Handles URLs like https://x-access-token:TOKEN@github.com/...
fn extract_token_from_url(url: &str) -> Option<String> {
    if let Some(at_pos) = url.find('@') {
        if url.starts_with("https://") {
            if let Some(proto_end) = url.find("://") {
                let before_at = &url[proto_end + 3..at_pos];
                // Check for x-access-token:TOKEN format
                if let Some(colon_pos) = before_at.find(':') {
                    let token = &before_at[colon_pos + 1..];
                    if !token.is_empty() {
                        return Some(token.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Resolve the repository URL from either repoUrl or repoFullName.
/// Returns the clean (unauthenticated) URL for caching purposes.
pub fn resolve_repo_url(repo_full_name: Option<&str>, repo_url: Option<&str>) -> Result<String> {
    if let Some(u) = repo_url {
        return Ok(u.to_string());
    }
    if let Some(full) = repo_full_name {
        return Ok(format!("https://github.com/{}.git", full));
    }
    Err(anyhow!("repoUrl or repoFullName required"))
}

fn load_index(root: &Path) -> CacheIndex {
    let idx_path = root.join("cache-index.json");
    if let Ok(data) = fs::read(&idx_path) {
        if let Ok(idx) = serde_json::from_slice::<CacheIndex>(&data) {
            return idx;
        }
    }
    CacheIndex::default()
}

fn save_index(root: &Path, idx: &CacheIndex) -> Result<()> {
    let idx_path = root.join("cache-index.json");
    let data = serde_json::to_vec_pretty(idx)?;
    fs::write(idx_path, data)?;
    Ok(())
}

fn update_cache_index(root: &Path, repo_path: &Path) -> Result<()> {
    let mut idx = load_index(root);
    let slug = repo_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    if let Some(e) = idx.entries.iter_mut().find(|e| e.slug == slug) {
        e.last_access_ms = now;
        e.path = repo_path.to_string_lossy().to_string();
    } else {
        idx.entries.push(CacheIndexEntry {
            slug,
            path: repo_path.to_string_lossy().to_string(),
            last_access_ms: now,
            last_fetch_ms: None,
        });
    }
    idx.entries
        .sort_by(|a, b| b.last_access_ms.cmp(&a.last_access_ms));
    idx.entries.dedup_by(|a, b| a.slug == b.slug);
    save_index(root, &idx)?;
    Ok(())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

fn update_cache_index_with(
    root: &Path,
    repo_path: &Path,
    last_fetch_ms: Option<u128>,
) -> Result<()> {
    let mut idx = load_index(root);
    let pstr = repo_path.to_string_lossy().to_string();
    let now = now_ms();
    if let Some(e) = idx.entries.iter_mut().find(|e| e.path == pstr) {
        e.last_access_ms = now;
        if let Some(f) = last_fetch_ms {
            e.last_fetch_ms = Some(f);
        }
    } else {
        let slug = repo_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        idx.entries.push(CacheIndexEntry {
            slug,
            path: pstr,
            last_access_ms: now,
            last_fetch_ms,
        });
    }
    idx.entries
        .sort_by(|a, b| b.last_access_ms.cmp(&a.last_access_ms));
    idx.entries.dedup_by(|a, b| a.slug == b.slug);
    save_index(root, &idx)?;
    Ok(())
}

fn get_cache_last_fetch(root: &Path, repo_path: &Path) -> Option<u128> {
    let idx = load_index(root);
    let pstr = repo_path.to_string_lossy().to_string();
    idx.entries
        .into_iter()
        .find(|e| e.path == pstr)
        .and_then(|e| e.last_fetch_ms)
}

static SWR_FETCH_MAP: OnceLock<Mutex<HashMap<String, u128>>> = OnceLock::new();

fn swr_map() -> &'static Mutex<HashMap<String, u128>> {
    SWR_FETCH_MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_map_last_fetch(repo_path: &Path) -> Option<u128> {
    let pstr = repo_path.to_string_lossy().to_string();
    swr_map().lock().ok().and_then(|m| m.get(&pstr).copied())
}

fn set_map_last_fetch(repo_path: &Path, t: u128) {
    let pstr = repo_path.to_string_lossy().to_string();
    if let Ok(mut m) = swr_map().lock() {
        m.insert(pstr, t);
    }
}

/// Returns true if the repo was fetched within the given window (ms).
/// Currently unused but kept for potential future optimizations.
#[allow(dead_code)]
pub fn was_recently_fetched(path: &std::path::Path, window_ms: u128) -> bool {
    let cwd = path.to_string_lossy().to_string();
    let root = default_cache_root();
    let now = now_ms();

    let last_fetch_idx = get_cache_last_fetch(&root, &PathBuf::from(&cwd));
    let last_fetch_map = get_map_last_fetch(&PathBuf::from(&cwd));
    let last_fetch = last_fetch_idx.or(last_fetch_map);

    if let Some(t) = last_fetch {
        return now.saturating_sub(t) <= window_ms;
    }
    false
}

pub fn swr_fetch_origin_all_path_bool(path: &std::path::Path, window_ms: u128) -> Result<bool> {
    let cwd = path.to_string_lossy().to_string();
    let root = default_cache_root();
    let now = now_ms();

    let last_fetch_idx = get_cache_last_fetch(&root, &PathBuf::from(&cwd));
    let last_fetch_map = get_map_last_fetch(&PathBuf::from(&cwd));
    let last_fetch = last_fetch_idx.or(last_fetch_map);

    if let Some(t) = last_fetch {
        if now.saturating_sub(t) <= window_ms {
            let cwd_bg = cwd.clone();
            let root_bg = root.clone();
            std::thread::spawn(move || {
                let _ = run_git(&cwd_bg, &["fetch", "--all", "--prune"]);
                let _ = update_cache_index_with(&root_bg, &PathBuf::from(&cwd_bg), Some(now_ms()));
                set_map_last_fetch(&PathBuf::from(&cwd_bg), now_ms());
            });
            return Ok(false);
        }
    }

    let _ = run_git(&cwd, &["fetch", "--all", "--prune"]);
    let now2 = now_ms();
    let _ = update_cache_index_with(&root, &PathBuf::from(&cwd), Some(now2));
    set_map_last_fetch(&PathBuf::from(&cwd), now2);
    Ok(true)
}

pub fn swr_fetch_origin_all_path(path: &std::path::Path, window_ms: u128) -> Result<()> {
    let _ = swr_fetch_origin_all_path_bool(path, window_ms)?;
    Ok(())
}
#[allow(dead_code)]
pub fn fetch_origin_all_path(path: &std::path::Path) -> Result<()> {
    let cwd = path.to_string_lossy().to_string();
    let _ = run_git(&cwd, &["fetch", "--all", "--prune"]);
    Ok(())
}

/// Execute a git fetch with optional auth token using git's URL replacement feature.
/// This approach is concurrency-safe as it doesn't modify the repository config.
/// The token is passed via environment-based URL rewriting to avoid persistence.
fn fetch_with_auth(cwd: &str, args: &[&str], auth_token: Option<&str>) -> Result<String> {
    match auth_token {
        Some(token) if !token.is_empty() => {
            // Use git's insteadOf config via -c to rewrite URLs without modifying .git/config
            // This is concurrency-safe as it only affects this process
            let auth_prefix = format!("https://x-access-token:{}@github.com/", token);
            let config_arg = format!("url.{}.insteadOf=https://github.com/", auth_prefix);

            // Build args with -c config prepended
            let mut full_args: Vec<&str> = vec!["-c", &config_arg];
            full_args.extend(args);

            run_git(cwd, &full_args)
        }
        _ => run_git(cwd, args),
    }
}

/// SWR fetch with auth token support for private repos.
/// When auth_token is provided (private repo), background fetch is skipped to avoid failures.
pub fn swr_fetch_origin_all_path_with_auth(
    path: &std::path::Path,
    window_ms: u128,
    auth_token: Option<&str>,
) -> Result<bool> {
    let cwd = path.to_string_lossy().to_string();
    let root = default_cache_root();
    let now = now_ms();

    let last_fetch_idx = get_cache_last_fetch(&root, &PathBuf::from(&cwd));
    let last_fetch_map = get_map_last_fetch(&PathBuf::from(&cwd));
    let last_fetch = last_fetch_idx.or(last_fetch_map);

    let has_auth = auth_token.is_some_and(|t| !t.is_empty());

    if let Some(t) = last_fetch {
        if now.saturating_sub(t) <= window_ms {
            // Within window - for public repos, do background fetch
            // For private repos (auth required), skip background fetch to avoid failures
            if !has_auth {
                let cwd_bg = cwd.clone();
                let root_bg = root.clone();
                std::thread::spawn(move || {
                    let _ = run_git(&cwd_bg, &["fetch", "--all", "--prune"]);
                    let _ =
                        update_cache_index_with(&root_bg, &PathBuf::from(&cwd_bg), Some(now_ms()));
                    set_map_last_fetch(&PathBuf::from(&cwd_bg), now_ms());
                });
            }
            // For private repos within window, return early without background fetch
            // They will get a fresh fetch on the next request outside the window
            return Ok(false);
        }
    }

    // Outside window - fetch synchronously with auth
    let _ = fetch_with_auth(&cwd, &["fetch", "--all", "--prune"], auth_token);
    let now2 = now_ms();
    let _ = update_cache_index_with(&root, &PathBuf::from(&cwd), Some(now2));
    set_map_last_fetch(&PathBuf::from(&cwd), now2);
    Ok(true)
}

/// SWR fetch with optional force refresh bypass.
/// When force_refresh is true, bypasses the SWR window and always performs a synchronous fetch.
pub fn swr_fetch_origin_all_path_with_auth_force(
    path: &std::path::Path,
    window_ms: u128,
    auth_token: Option<&str>,
    force_refresh: bool,
) -> Result<bool> {
    #[cfg(debug_assertions)]
    println!(
        "[native.cache] swr_fetch_force called force_refresh={} path={:?}",
        force_refresh, path
    );
    if force_refresh {
        #[cfg(debug_assertions)]
        println!("[native.cache] force_refresh=true, performing synchronous fetch");
        let cwd = path.to_string_lossy().to_string();
        let root = default_cache_root();
        let fetch_result = fetch_with_auth(&cwd, &["fetch", "--all", "--prune"], auth_token);
        #[cfg(debug_assertions)]
        match &fetch_result {
            Ok(output) => println!(
                "[native.cache] fetch succeeded: {}",
                output.lines().take(3).collect::<Vec<_>>().join(" | ")
            ),
            Err(e) => println!("[native.cache] fetch failed: {:?}", e),
        }
        let now = now_ms();
        let _ = update_cache_index_with(&root, &PathBuf::from(&cwd), Some(now));
        set_map_last_fetch(&PathBuf::from(&cwd), now);
        return Ok(true);
    }
    swr_fetch_origin_all_path_with_auth(path, window_ms, auth_token)
}

/// Fetch a specific ref with auth token support.
pub fn fetch_specific_ref_with_auth(
    path: &std::path::Path,
    ref_name: &str,
    auth_token: Option<&str>,
) -> Result<bool> {
    let cwd = path.to_string_lossy().to_string();

    // Extract the branch name, stripping common prefixes
    let branch = ref_name
        .strip_prefix("origin/")
        .or_else(|| ref_name.strip_prefix("refs/remotes/origin/"))
        .or_else(|| ref_name.strip_prefix("refs/heads/"))
        .unwrap_or(ref_name);

    // Try to fetch the specific branch from origin with auth
    let result = fetch_with_auth(&cwd, &["fetch", "origin", branch], auth_token);

    if result.is_ok() {
        // Update last fetch time since we just fetched
        let root = default_cache_root();
        let now = now_ms();
        let _ = update_cache_index_with(&root, &PathBuf::from(&cwd), Some(now));
        set_map_last_fetch(&PathBuf::from(&cwd), now);
        return Ok(true);
    }

    // If specific branch fetch failed, try fetching all with auth
    let result_all = fetch_with_auth(&cwd, &["fetch", "--all", "--prune"], auth_token);
    if result_all.is_ok() {
        let root = default_cache_root();
        let now = now_ms();
        let _ = update_cache_index_with(&root, &PathBuf::from(&cwd), Some(now));
        set_map_last_fetch(&PathBuf::from(&cwd), now);
        return Ok(true);
    }

    Ok(false)
}

fn enforce_cache_limit(root: &Path) -> Result<()> {
    let mut idx = load_index(root);
    if idx.entries.len() <= MAX_CACHE_REPOS {
        return Ok(());
    }
    idx.entries
        .sort_by(|a, b| b.last_access_ms.cmp(&a.last_access_ms));
    let survivors = idx.entries[..MAX_CACHE_REPOS].to_vec();
    let victims = idx.entries[MAX_CACHE_REPOS..].to_vec();
    for v in &victims {
        let p = PathBuf::from(&v.path);
        let _ = fs::remove_dir_all(&p);
    }
    idx.entries = survivors;
    save_index(root, &idx)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn swr_fetch_skips_within_window_and_backgrounds() {
        let tmp = tempdir().unwrap();
        let repo_dir = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        let status = if cfg!(target_os = "windows") {
            std::process::Command::new("cmd")
                .arg("/C")
                .arg("git init")
                .current_dir(&repo_dir)
                .status()
        } else {
            std::process::Command::new("sh")
                .arg("-c")
                .arg("git init")
                .current_dir(&repo_dir)
                .status()
        }
        .expect("spawn");
        assert!(status.success());

        let first = swr_fetch_origin_all_path_bool(&repo_dir, 5_000).expect("swr fetch 1");
        let second = swr_fetch_origin_all_path_bool(&repo_dir, 5_000).expect("swr fetch 2");
        assert!(first, "first call should be synchronous fetch");
        assert!(
            !second,
            "second call within window should skip and background"
        );
    }
}
