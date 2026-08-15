import { test, expect } from "vitest";
import { TurnTracer } from "../../src/observability/tracer";

test("TurnTracer handles tool spans, token metrics, and approval lifecycle", () => {
  const tracer = new TurnTracer(
    "sess_obs_test",
    "tenant_101",
    "run_12345",
    "openrouter/deepseek/deepseek-v4-flash",
    "List all tables"
  );

  // 1. Tool Call Span Lifecycle
  expect(() => {
    tracer.onToolStart("call_001", "bash", { command: "ls -la" });
    tracer.onToolFinish("call_001", "file1.txt\nfile2.txt", false);
  }).not.toThrow();

  // 2. Token Usage & Cost Metrics
  expect(() => {
    tracer.onMetrics(
      { input: 1200, output: 250, total: 1450 },
      0.00015
    );
  }).not.toThrow();

  // 3. Human-in-the-loop Approval Span Lifecycle
  expect(() => {
    tracer.onInteractionRequest("perm_001", "bash", { command: "rm -rf /tmp/test" });
    tracer.onInteractionResolved("perm_001", "approved");
  }).not.toThrow();

  // 4. Finish Turn
  expect(() => {
    tracer.finish("completed", 0, "All operations completed successfully.");
  }).not.toThrow();
});
