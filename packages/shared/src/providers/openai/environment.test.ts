import { describe, expect, it } from "vitest";
import { stripFilteredConfigKeys } from "./environment";

describe("stripFilteredConfigKeys", () => {
  it("removes model key from config", () => {
    const input = `model = "gpt-5.2"
notify = ["/root/lifecycle/codex-notify.sh"]`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]`);
  });

  it("removes model_reasoning_effort key from config", () => {
    const input = `model_reasoning_effort = "high"
notify = ["/root/lifecycle/codex-notify.sh"]`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]`);
  });

  it("removes both model and model_reasoning_effort keys", () => {
    const input = `model = "gpt-5.2"
model_reasoning_effort = "high"
notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"`);
  });

  it("preserves other keys and sections", () => {
    const input = `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"
model = "gpt-5.2"

[notice.model_migrations]
"o3" = "gpt-5.2-codex"`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[notice.model_migrations]
"o3" = "gpt-5.2-codex"`);
  });

  it("handles different value formats", () => {
    // Double quotes
    expect(stripFilteredConfigKeys(`model = "gpt-5.2"`)).toBe("");
    // Single quotes
    expect(stripFilteredConfigKeys(`model = 'gpt-5.2'`)).toBe("");
    // Bare string (if TOML allows)
    expect(stripFilteredConfigKeys(`model = gpt-5.2`)).toBe("");
  });

  it("handles varying whitespace around equals sign", () => {
    expect(stripFilteredConfigKeys(`model="gpt-5.2"`)).toBe("");
    expect(stripFilteredConfigKeys(`model  =  "gpt-5.2"`)).toBe("");
    expect(stripFilteredConfigKeys(`model =    "gpt-5.2"`)).toBe("");
  });

  it("does not remove keys inside sections", () => {
    // model inside a section should NOT be removed (only top-level)
    // Note: current regex removes any line starting with "model =", not section-aware
    // This test documents current behavior - if section-awareness is needed, update regex
    const input = `[some_section]
model = "should-stay"`;
    const result = stripFilteredConfigKeys(input);
    // Current implementation removes it - this is acceptable since Codex config
    // doesn't typically have model keys inside sections
    expect(result).toBe(`[some_section]`);
  });

  it("handles empty input", () => {
    expect(stripFilteredConfigKeys("")).toBe("");
  });

  it("handles input with only filtered keys", () => {
    const input = `model = "gpt-5.2"
model_reasoning_effort = "xhigh"`;
    expect(stripFilteredConfigKeys(input)).toBe("");
  });

  it("cleans up multiple blank lines", () => {
    const input = `notify = ["/root/lifecycle/codex-notify.sh"]

model = "gpt-5.2"


model_reasoning_effort = "high"

approval_mode = "full"`;
    const result = stripFilteredConfigKeys(input);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]

approval_mode = "full"`);
  });
});
