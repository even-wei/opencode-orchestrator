import { trace, Span, SpanStatusCode, Tracer } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { config } from "../config";

let tracerProvider: BasicTracerProvider | null = null;
let otelTracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!otelTracer) {
    if (config.telemetry.enabled) {
      try {
        const exporter = new OTLPTraceExporter({
          url: config.telemetry.endpoint,
        });
        const resource = resourceFromAttributes({
          "service.name": config.telemetry.serviceName,
          "project.name": config.telemetry.serviceName,
        });
        tracerProvider = new BasicTracerProvider({
          resource,
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        trace.setGlobalTracerProvider(tracerProvider);
        otelTracer = tracerProvider.getTracer(config.telemetry.serviceName);
      } catch (err: any) {
        console.warn(`[Observability] Failed to initialize OTLPTraceExporter: ${err.message}`);
      }
    }
    if (!otelTracer) {
      otelTracer = trace.getTracer(config.telemetry.serviceName);
    }
  }
  return otelTracer;
}

export class TurnTracer {
  private rootSpan: Span | null = null;
  private activeToolSpans = new Map<string, Span>();
  private activeApprovalSpans = new Map<string, Span>();

  constructor(
    private sessionId: string,
    private tenantId: string,
    private runId: string,
    private model: string,
    private prompt: string
  ) {
    if (config.telemetry.enabled) {
      const tracer = getTracer();
      this.rootSpan = tracer.startSpan(`Turn: ${sessionId}`, {
        attributes: {
          "openinference.span.kind": "CHAIN",
          "session.id": this.sessionId,
          "session_id": this.sessionId,
          "tenant.id": this.tenantId,
          "tenant_id": this.tenantId,
          "user.id": this.tenantId,
          "user_id": this.tenantId,
          "run.id": this.runId,
          "llm.model_name": this.model,
          "input.value": this.prompt,
        },
      });
    }
  }

  onToolStart(callId: string, tool: string, params: Record<string, any>): void {
    if (!this.rootSpan) return;
    const tracer = getTracer();
    const span = tracer.startSpan(`Tool: ${tool}`, {
      attributes: {
        "openinference.span.kind": "TOOL",
        "session.id": this.sessionId,
        "session_id": this.sessionId,
        "tenant.id": this.tenantId,
        "tenant_id": this.tenantId,
        "user.id": this.tenantId,
        "user_id": this.tenantId,
        "tool.name": tool,
        "tool.call_id": callId,
        "input.value": typeof params === "string" ? params : JSON.stringify(params),
      },
    });
    this.activeToolSpans.set(callId, span);
  }

  onToolFinish(callId: string, result: string, isError: boolean = false): void {
    const span = this.activeToolSpans.get(callId);
    if (span) {
      span.setAttribute("output.value", typeof result === "string" ? result : JSON.stringify(result));
      span.setStatus({
        code: isError ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      });
      span.end();
      this.activeToolSpans.delete(callId);
    }
  }

  onMetrics(tokens?: { input?: number; output?: number; total?: number }, cost?: number): void {
    if (!this.rootSpan) return;
    if (tokens) {
      if (tokens.input !== undefined) this.rootSpan.setAttribute("llm.usage.prompt_tokens", tokens.input);
      if (tokens.output !== undefined) this.rootSpan.setAttribute("llm.usage.completion_tokens", tokens.output);
      if (tokens.total !== undefined) this.rootSpan.setAttribute("llm.usage.total_tokens", tokens.total);
    }
    if (cost !== undefined) {
      this.rootSpan.setAttribute("llm.cost", cost);
    }
  }

  onInteractionRequest(interactionId: string, tool: string, details: Record<string, any>): void {
    if (!this.rootSpan) return;
    const tracer = getTracer();
    const span = tracer.startSpan(`Approval: ${tool}`, {
      attributes: {
        "openinference.span.kind": "APPROVAL",
        "session.id": this.sessionId,
        "interaction.id": interactionId,
        "tool.name": tool,
        "details": JSON.stringify(details),
      },
    });
    this.activeApprovalSpans.set(interactionId, span);
  }

  onInteractionResolved(interactionId: string, resolution: string): void {
    const span = this.activeApprovalSpans.get(interactionId);
    if (span) {
      span.setAttribute("interaction.resolution", resolution);
      span.setStatus({
        code: resolution === "approved" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      span.end();
      this.activeApprovalSpans.delete(interactionId);
    }
  }

  finish(status: "completed" | "failed", exitCode: number, outputText?: string): void {
    if (!this.rootSpan) return;

    // Clean up any remaining open tool spans
    for (const [_, span] of this.activeToolSpans) {
      span.end();
    }
    this.activeToolSpans.clear();

    for (const [_, span] of this.activeApprovalSpans) {
      span.end();
    }
    this.activeApprovalSpans.clear();

    if (outputText) {
      this.rootSpan.setAttribute("output.value", outputText);
    }
    this.rootSpan.setAttribute("run.exit_code", exitCode);
    this.rootSpan.setStatus({
      code: status === "completed" && exitCode === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    this.rootSpan.end();
    this.rootSpan = null;

    if (tracerProvider) {
      tracerProvider.forceFlush().catch(() => {});
    }
  }
}

export async function shutdownTracer(): Promise<void> {
  if (tracerProvider) {
    await tracerProvider.shutdown().catch(() => {});
    tracerProvider = null;
    otelTracer = null;
  }
}
