import { test, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/index";

test("GET /health and GET /livez return ok", async () => {
  const healthRes = await request(app).get("/health");
  expect(healthRes.status).toBe(200);
  expect(healthRes.body.status).toBe("ok");

  const livezRes = await request(app).get("/livez");
  expect(livezRes.status).toBe(200);
  expect(livezRes.text).toBe("ok");
});

test("GET /readyz verifies database readiness", async () => {
  const res = await request(app).get("/readyz");
  expect([200, 503]).toContain(res.status);
  if (res.status === 200) {
    expect(res.text).toBe("ready");
  }
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
