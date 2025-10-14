import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerOTel } from "@vercel/otel";

const AXIOM_DATASET = process.env.AXIOM_DATASET;
const AXIOM_API_TOKEN = process.env.AXIOM_API_TOKEN;
const AXIOM_DOMAIN = process.env.AXIOM_DOMAIN;
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "cmux-www";

const isNodeRuntime = process.env.NEXT_RUNTIME === "nodejs";

const normalizeDomain = (domain: string) => {
  const trimmed = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${trimmed}`;
};

export function register() {
  if (!isNodeRuntime) {
    return;
  }

  if (!AXIOM_DATASET || !AXIOM_API_TOKEN) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[@vercel/otel] Skipping telemetry registration because AXIOM_DATASET or AXIOM_API_TOKEN is missing.",
      );
    }
    return;
  }

  const baseUrl = AXIOM_DOMAIN ? normalizeDomain(AXIOM_DOMAIN) : "https://api.axiom.co";

  registerOTel({
    serviceName: SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({
      url: `${baseUrl}/v1/traces`,
      headers: {
        Authorization: `Bearer ${AXIOM_API_TOKEN}`,
        "X-Axiom-Dataset": AXIOM_DATASET,
      },
    }),
  });
}
