import { Effect } from "effect";
import { SignJWT } from "jose";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { otelTracesProxyEffect } from "./otel_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";

const TEST_SECRET = "otel_test_secret";
const TEST_AXIOM_DOMAIN = "https://api.axiom.co";
const TEST_AXIOM_TOKEN = "xaat-test-token";
const TEST_AXIOM_DATASET = "test-traces";

async function makeJwt(payload: { sandboxId: string; teamId: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe("otel_http", () => {
  const envLayer = makeEnvLayer({
    ACP_CALLBACK_SECRET: TEST_SECRET,
    CMUX_TASK_RUN_JWT_SECRET: "unused",
    AXIOM_DOMAIN: TEST_AXIOM_DOMAIN,
    AXIOM_TOKEN: TEST_AXIOM_TOKEN,
    AXIOM_TRACES_DATASET: TEST_AXIOM_DATASET,
  } satisfies EnvValues);

  const envLayerNoAxiom = makeEnvLayer({
    ACP_CALLBACK_SECRET: TEST_SECRET,
    CMUX_TASK_RUN_JWT_SECRET: "unused",
  } satisfies EnvValues);

  // Mock global fetch for Axiom forwarding
  const originalFetch = global.fetch;
  type FetchMock = ReturnType<typeof vi.fn> & { preconnect: ReturnType<typeof vi.fn> };
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = Object.assign(vi.fn(), { preconnect: vi.fn() });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects missing bearer token", async () => {
    const req = new Request("http://localhost/api/otel/v1/traces", {
      method: "POST",
      headers: { "content-type": "application/x-protobuf" },
      body: new ArrayBuffer(10),
    });

    const response = await runHttpEffect(
      otelTracesProxyEffect(req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid JWT", async () => {
    const req = new Request("http://localhost/api/otel/v1/traces", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-token",
        "content-type": "application/x-protobuf",
      },
      body: new ArrayBuffer(10),
    });

    const response = await runHttpEffect(
      otelTracesProxyEffect(req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(401);
  });

  it("rejects when Axiom not configured", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const req = new Request("http://localhost/api/otel/v1/traces", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-protobuf",
      },
      body: new ArrayBuffer(10),
    });

    const response = await runHttpEffect(
      otelTracesProxyEffect(req).pipe(Effect.provide(envLayerNoAxiom))
    );

    expect(response.status).toBe(503);
  });

  it("forwards valid request to Axiom", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const traceData = new Uint8Array([1, 2, 3, 4, 5]);

    const req = new Request("http://localhost/api/otel/v1/traces", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-protobuf",
      },
      body: traceData,
    });

    // Mock successful Axiom response
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await runHttpEffect(
      otelTracesProxyEffect(req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify Axiom was called with correct URL and headers
    const [axiomUrl, axiomOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(axiomUrl).toBe(`${TEST_AXIOM_DOMAIN}/v1/traces`);
    expect(axiomOptions.method).toBe("POST");
    expect(axiomOptions.headers).toMatchObject({
      "Content-Type": "application/x-protobuf",
      Authorization: `Bearer ${TEST_AXIOM_TOKEN}`,
      "X-Axiom-Dataset": TEST_AXIOM_DATASET,
    });
  });

  it("returns success even if Axiom fails (non-blocking telemetry)", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const traceData = new Uint8Array([1, 2, 3, 4, 5]);

    const req = new Request("http://localhost/api/otel/v1/traces", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-protobuf",
      },
      body: traceData,
    });

    // Mock Axiom error response
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const response = await runHttpEffect(
      otelTracesProxyEffect(req).pipe(Effect.provide(envLayer))
    );

    // Should still return 200 - telemetry shouldn't block the client
    expect(response.status).toBe(200);
  });

  it("normalizes Axiom domain without protocol", async () => {
    const envLayerNoProtocol = makeEnvLayer({
      ACP_CALLBACK_SECRET: TEST_SECRET,
      CMUX_TASK_RUN_JWT_SECRET: "unused",
      AXIOM_DOMAIN: "api.axiom.co", // No https://
      AXIOM_TOKEN: TEST_AXIOM_TOKEN,
      AXIOM_TRACES_DATASET: TEST_AXIOM_DATASET,
    } satisfies EnvValues);

    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const req = new Request("http://localhost/api/otel/v1/traces", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-protobuf",
      },
      body: new ArrayBuffer(10),
    });

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await runHttpEffect(
      otelTracesProxyEffect(req).pipe(Effect.provide(envLayerNoProtocol))
    );

    expect(response.status).toBe(200);
    const [axiomUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(axiomUrl).toBe("https://api.axiom.co/v1/traces");
  });
});
