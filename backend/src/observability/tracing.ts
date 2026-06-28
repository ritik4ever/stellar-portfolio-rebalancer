import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { trace } from "@opentelemetry/api";

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces";
const OTEL_ENABLED = parseBoolean(process.env.OTEL_ENABLED, false);

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  if (!OTEL_ENABLED) return;

  const exporter = new OTLPTraceExporter({
    url: OTLP_ENDPOINT,
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "stellar-portfolio-backend",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "1.0.0",
      "deployment.environment": process.env.NODE_ENV || "development",
    }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingPaths: ["/health", "/ready", "/readiness", "/metrics"],
      }),
      new ExpressInstrumentation(),
    ],
    spanProcessors: [],
  });

  sdk.start();
  console.log("[OTEL] Tracing enabled, exporting to " + OTLP_ENDPOINT);
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

export function getTracer(name?: string) {
  return trace.getTracer(name || "stellar-portfolio-backend", "1.0.0");
}

export function getActiveSpan() {
  return trace.getActiveSpan();
}

export function getTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  return span.spanContext().traceId;
}

export function getSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  return span.spanContext().spanId;
}
