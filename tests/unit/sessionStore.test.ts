import { test, expect, vi } from "vitest";
import { SessionStore } from "../../src/db/sessionStore";

test("rehydrateContext composes summary, history turns, and current prompt", async () => {
  const store = new SessionStore();

  // Mock internal methods
  vi.spyOn(store, "getSession").mockResolvedValue({
    id: "sess_123",
    tenantId: "tenant_1",
    status: "idle",
    latestSummary: "User previously asked to set up Docker and Node environment.",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  vi.spyOn(store, "getRecentChatEvents").mockResolvedValue([
    {
      id: 1,
      sessionId: "sess_123",
      turnIndex: 1,
      eventType: "user_prompt",
      payload: { prompt: "Install express" },
      createdAt: new Date(),
    },
    {
      id: 2,
      sessionId: "sess_123",
      turnIndex: 1,
      eventType: "assistant_response",
      payload: { text: "Express installed successfully" },
      createdAt: new Date(),
    },
  ]);

  const rehydrated = await store.rehydrateContext("sess_123", "Now add TypeScript", 5);

  expect(rehydrated).toContain("=== PREVIOUS SESSION SUMMARY ===");
  expect(rehydrated).toContain("User previously asked to set up Docker");
  expect(rehydrated).toContain("=== RECENT CONVERSATION HISTORY ===");
  expect(rehydrated).toContain("User: Install express");
  expect(rehydrated).toContain("Assistant: Express installed successfully");
  expect(rehydrated).toContain("=== CURRENT TASK ===");
  expect(rehydrated).toContain("Now add TypeScript");
});
