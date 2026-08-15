import { test, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/index";

test("GET /health returns ok", async () => {
  const res = await request(app).get("/health");
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("ok");
  expect(res.body.timestamp).toBeDefined();
});

test("POST /api/v1/sessions/:id/interactions returns 404 when no pending interaction", async () => {
  const res = await request(app)
    .post("/api/v1/sessions/non_existent/interactions")
    .send({
      interactionId: "act_123",
      resolution: "approved",
    });

  expect(res.status).toBe(404);
  expect(res.body.error).toContain("No active session");
});
