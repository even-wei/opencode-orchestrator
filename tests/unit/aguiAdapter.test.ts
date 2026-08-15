import { test, expect, vi } from "vitest";
import { AGUIStreamAdapter } from "../../src/events/aguiAdapter";

test("translates OpenCode plan updates and tokens to AG-UI events", () => {
  const writtenChunks: string[] = [];
  const mockRes = {
    write: vi.fn((chunk: string) => {
      writtenChunks.push(chunk);
      return true;
    }),
    end: vi.fn(),
  };

  const adapter = new AGUIStreamAdapter(mockRes, "run_001");

  adapter.processRawEvent({ type: "token", data: { delta: "Refactoring database" } });
  adapter.processRawEvent({
    type: "plan_update",
    data: { todos: [{ id: "1", text: "Create migration", status: "in_progress" }] },
  });

  expect(writtenChunks.some((c) => c.includes("event: MESSAGE_START"))).toBe(true);
  expect(writtenChunks.some((c) => c.includes("event: TEXT_MESSAGE_CONTENT"))).toBe(true);
  expect(
    writtenChunks.some((c) => c.includes("event: STATE_DELTA") && c.includes("/todos"))
  ).toBe(true);
});

test("translates tool start and finish events to AG-UI events", () => {
  const writtenChunks: string[] = [];
  const mockRes = {
    write: vi.fn((chunk: string) => {
      writtenChunks.push(chunk);
      return true;
    }),
    end: vi.fn(),
  };

  const adapter = new AGUIStreamAdapter(mockRes, "run_002");

  adapter.processRawEvent({
    type: "tool_start",
    data: { id: "call_123", tool: "bash", params: { command: "ls -la" } },
  });

  adapter.processRawEvent({
    type: "tool_finish",
    data: { id: "call_123", tool: "bash", result: "file1.ts\nfile2.ts", isError: false },
  });

  expect(
    writtenChunks.some(
      (c) => c.includes("event: TOOL_CALL_START") && c.includes("call_123") && c.includes("bash")
    )
  ).toBe(true);
  expect(
    writtenChunks.some(
      (c) => c.includes("event: TOOL_CALL_RESULT") && c.includes("call_123") && c.includes("file1.ts")
    )
  ).toBe(true);
});

test("translates permission_request and done events to AG-UI events and closes stream", () => {
  const writtenChunks: string[] = [];
  const mockRes = {
    write: vi.fn((chunk: string) => {
      writtenChunks.push(chunk);
      return true;
    }),
    end: vi.fn(),
  };

  const adapter = new AGUIStreamAdapter(mockRes, "run_003");

  adapter.processRawEvent({
    type: "token",
    data: { delta: "Executing command" },
  });

  adapter.processRawEvent({
    type: "permission_request",
    data: { id: "perm_999", tool: "rm_rf", details: { target: "/tmp/data" } },
  });

  adapter.processRawEvent({
    type: "done",
    data: { exitCode: 0 },
  });

  expect(
    writtenChunks.some(
      (c) => c.includes("event: INTERACTION_REQUEST") && c.includes("perm_999")
    )
  ).toBe(true);
  expect(writtenChunks.some((c) => c.includes("event: MESSAGE_END"))).toBe(true);
  expect(
    writtenChunks.some(
      (c) => c.includes("event: RUN_FINISHED") && c.includes("completed")
    )
  ).toBe(true);
  expect(mockRes.end).toHaveBeenCalled();
});
