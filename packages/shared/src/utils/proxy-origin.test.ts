import { describe, expect, it } from "vitest";
import {
  buildTrustedProxyDomainSet,
  isTrustedProxyHostname,
  parseProxyHostname,
} from "./proxy-origin";

describe("parseProxyHostname", () => {
  it("parses a valid proxy hostname", () => {
    expect(
      parseProxyHostname("port-9776-pvelxc-30b1cc26.alphasolves.com"),
    ).toEqual({
      port: 9776,
      hostId: "pvelxc-30b1cc26",
      domain: "alphasolves.com",
    });
  });

  it("normalizes uppercase hostnames", () => {
    expect(
      parseProxyHostname("PORT-39380-MORPHVM-ABC123.HTTP.CLOUD.MORPH.SO"),
    ).toEqual({
      port: 39380,
      hostId: "morphvm-abc123",
      domain: "http.cloud.morph.so",
    });
  });

  it("rejects invalid ports and malformed values", () => {
    expect(parseProxyHostname("port-0-test.cmux.sh")).toBeNull();
    expect(parseProxyHostname("port-65536-test.cmux.sh")).toBeNull();
    expect(parseProxyHostname("port-39380--test.cmux.sh")).toBeNull();
    expect(parseProxyHostname("localhost")).toBeNull();
  });
});

describe("buildTrustedProxyDomainSet", () => {
  it("includes normalized additional domains", () => {
    const trusted = buildTrustedProxyDomainSet([
      ".alphasolves.com",
      "https://preview.example.com",
    ]);

    expect(trusted.has("alphasolves.com")).toBe(true);
    expect(trusted.has("preview.example.com")).toBe(true);
    expect(trusted.has("http.cloud.morph.so")).toBe(true);
  });
});

describe("isTrustedProxyHostname", () => {
  it("allows trusted proxy domains", () => {
    const trusted = buildTrustedProxyDomainSet(["alphasolves.com"]);
    expect(
      isTrustedProxyHostname(
        "port-39379-morphvm-abc123.http.cloud.morph.so",
        trusted,
      ),
    ).toBe(true);
    expect(
      isTrustedProxyHostname("port-39379-pvelxc-abc123.alphasolves.com", trusted),
    ).toBe(true);
  });

  it("rejects untrusted or malformed proxy domains", () => {
    const trusted = buildTrustedProxyDomainSet();
    expect(
      isTrustedProxyHostname("port-39379-evil.attacker.com", trusted),
    ).toBe(false);
    expect(
      isTrustedProxyHostname("port-39379--attacker.cmux.sh", trusted),
    ).toBe(false);
  });
});
