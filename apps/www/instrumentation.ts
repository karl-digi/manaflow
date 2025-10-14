import { registerOTel } from "@vercel/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

export function register() {
  const axiomDomain = process.env.AXIOM_DOMAIN || "api.axiom.co";
  const axiomToken = process.env.AXIOM_API_TOKEN;
  const axiomDataset = process.env.AXIOM_DATASET;

  if (!axiomToken || !axiomDataset) {
    console.warn("AXIOM_API_TOKEN and AXIOM_DATASET environment variables are required for OpenTelemetry tracing to Axiom");
    return;
  }

  const traceExporter = new OTLPTraceExporter({
    url: `https://${axiomDomain}/v1/traces`,
    headers: {
      Authorization: `Bearer ${axiomToken}`,
      "X-Axiom-Dataset": axiomDataset,
    },
  });

  registerOTel({
    serviceName: "cmux-www",
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
}