# Sandbox / dmux CLI instructions

SCOPE: Only follow these instructions when working on the Rust sandbox/dmux code in `packages/sandbox/`.
If you are editing other parts of the repo (e.g. `packages/shared/src/providers/opencode/*`) or user config files (e.g. `~/.config/opencode/opencode.json`), ignore this file.

Do not use `.unwrap()` (except in tests).
Make sure to run `cargo clippy` and fix all lint warnings.
Before finishing, make sure to run tests and `cargo fmt`.
After tests pass (and only for sandbox/dmux changes), run `cd packages/sandbox && ./scripts/reload.sh` to rebuild/reinstall the dmux CLI (debug) and restart the sandbox server.
After finishing, use the macOS `say` command to notify the user with a short description of what to check/the next action the user should take (like a shell command/url/program they should interact with to verify).

## Git Policy (IMPORTANT)

**ALWAYS follow these rules:**

1. **NO direct commits to main/master** - Create feature branch first
2. **NO direct push to main/master** - Push to feature branches only
3. **NO merging PRs without explicit user approval** - Wait for user to say "merge" or "approve"
4. **NO force push to main/master**
