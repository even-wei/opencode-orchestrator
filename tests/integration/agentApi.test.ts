import { test, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/index";

test("GET /api/v1/catalog/mcp returns verified MCP list", async () => {
  const res = await request(app).get("/api/v1/catalog/mcp");
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some((m: any) => m.id === "postgres")).toBe(true);
});

test("GET /api/v1/catalog/skills returns curated skills list", async () => {
  const res = await request(app).get("/api/v1/catalog/skills");
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some((s: any) => s.id === "db-analyzer")).toBe(true);
});

test("POST /api/v1/agents/synthesize creates a valid AgentBundle", async () => {
  const res = await request(app)
    .post("/api/v1/agents/synthesize")
    .send({
      name: "api-guard-agent",
      description: "Smoke test REST APIs and verify responses",
      selectedMcpIds: ["fetch"],
      selectedSkillIds: ["api-tester"],
    });

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("bundle");
  expect(res.body.bundle.name).toBe("api-guard-agent");
  expect(res.body.bundle.taskConfig.mcp).toHaveProperty("fetch");
});

test("Full Lifecycle: Publish -> List -> Get -> Refine -> Delete Agent", async () => {
  const synthRes = await request(app)
    .post("/api/v1/agents/synthesize")
    .send({
      name: "lifecycle-test-agent",
      description: "Lifecycle test agent",
      selectedMcpIds: ["sqlite"],
    });

  const bundle = synthRes.body.bundle;

  // 1. Publish
  const pubRes = await request(app)
    .post("/api/v1/agents/publish")
    .send(bundle);
  expect(pubRes.status).toBe(201);
  expect(pubRes.body.name).toBe("lifecycle-test-agent");

  // 2. List
  const listRes = await request(app).get("/api/v1/agents");
  expect(listRes.status).toBe(200);
  expect(listRes.body.templates.some((t: any) => t.name === "lifecycle-test-agent")).toBe(true);

  // 3. Get
  const getRes = await request(app).get("/api/v1/agents/lifecycle-test-agent");
  expect(getRes.status).toBe(200);
  expect(getRes.body.name).toBe("lifecycle-test-agent");

  // 4. Refine
  const refineRes = await request(app)
    .post("/api/v1/agents/refine")
    .send({
      currentBundle: bundle,
      feedback: "Enforce read-only queries",
    });
  expect(refineRes.status).toBe(200);
  expect(refineRes.body.updatedBundle.version).toBe("1.0.1");

  // 5. Delete
  const delRes = await request(app).delete("/api/v1/agents/lifecycle-test-agent");
  expect(delRes.status).toBe(200);
  expect(delRes.body.status).toBe("deleted");
});
