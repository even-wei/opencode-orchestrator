import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { SandboxManager } from "./runner/sandbox";
import { OrchestratedProcess } from "./runner/process";
import { AGUIStreamAdapter } from "./events/aguiAdapter";
import { sessionStore } from "./db/sessionStore";
import { interactionRegistry } from "./interactive/interactionRegistry";
import { UserInteractionResolution, OpenCodeRawEvent } from "./events/types";
import { closePool } from "./db/client";

export const app = express();
app.use(express.json());

const sandboxManager = new SandboxManager(config.sandboxBaseDir);

interface ActiveSessionEntry {
  proc: OrchestratedProcess;
  adapter: AGUIStreamAdapter;
  turnIndex: number;
  accumulatedText: string;
}

const activeSessions = new Map<string, ActiveSessionEntry>();

function extractString(val: unknown, fallback: string = ""): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return fallback;
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/v1/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Tenant creation endpoint
app.post("/api/v1/tenants", async (req: Request, res: Response) => {
  const { id, name } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "Missing tenant 'id' or 'name'." });
  }
  try {
    const tenant = await sessionStore.ensureTenant(String(id), String(name));
    return res.status(201).json(tenant);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Session creation endpoint
app.post("/api/v1/sessions", async (req: Request, res: Response) => {
  const { id, tenantId, title } = req.body;
  const sessionId = id ? String(id) : `sess_${randomUUID()}`;
  const effectiveTenantId = tenantId ? String(tenantId) : "default_tenant";

  try {
    await sessionStore.ensureTenant(effectiveTenantId, "Default Tenant");
    const session = await sessionStore.createSession(
      sessionId,
      effectiveTenantId,
      title ? String(title) : undefined
    );
    return res.status(201).json(session);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get session details
app.get("/api/v1/sessions/:id", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  try {
    const session = await sessionStore.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }
    return res.json(session);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get session events
app.get("/api/v1/sessions/:id/events", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  const limit = parseInt(extractString(req.query.limit, "50"), 10) || 50;
  try {
    const events = await sessionStore.getRecentChatEvents(sessionId, limit);
    return res.json(events);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Stream handler logic for a session turn
async function handleTurnStream(req: Request, res: Response) {
  const sessionId = extractString(req.params.id);
  const tenantId = extractString(req.body?.tenantId ?? req.query.tenantId, "default_tenant");
  const prompt = extractString(req.body?.prompt ?? req.query.prompt, "Hello OpenCode");
  const taskConfig = req.body?.taskConfig || { model: "anthropic/claude-3-5-sonnet" };
  const model = extractString(
    req.body?.model ?? req.query.model ?? taskConfig?.model,
    ""
  );
  const skills = req.body?.skills || [];
  const customBin = extractString(
    req.body?.binaryPath ?? req.query.binaryPath,
    config.opencodeBinPath
  );

  if (activeSessions.has(sessionId)) {
    return res.status(409).json({ error: "Session currently has an active turn running." });
  }

  // Ensure tenant and session exist in DB
  try {
    await sessionStore.ensureTenant(tenantId, `Tenant ${tenantId}`);
    await sessionStore.createSession(sessionId, tenantId);
    await sessionStore.updateSessionStatus(sessionId, "running");
  } catch {
    // Database might be optional in isolated test setups
  }

  // Rehydrate context from database (unless executing a test script starting with -e)
  let turnIndex = 1;
  let rehydratedPrompt = prompt;
  if (!prompt.startsWith("-e ")) {
    try {
      turnIndex = await sessionStore.getNextTurnIndex(sessionId);
      await sessionStore.recordChatEvent(sessionId, turnIndex, "user_prompt", { prompt });
      rehydratedPrompt = await sessionStore.rehydrateContext(sessionId, prompt);
    } catch {
      // fallback if db is not connected
    }
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const runId = `run_${Date.now()}`;
  const adapter = new AGUIStreamAdapter(res, runId);

  // Provision ephemeral sandbox
  const env = await sandboxManager.provision({
    sessionId,
    taskConfig,
    skills,
  });

  // Spawn sub-process
  const proc = new OrchestratedProcess(customBin, rehydratedPrompt, env, tenantId, {
    model: model || undefined,
  });
  const sessionEntry: ActiveSessionEntry = {
    proc,
    adapter,
    turnIndex,
    accumulatedText: "",
  };

  activeSessions.set(sessionId, sessionEntry);

  proc.on("event", async (rawEvent: OpenCodeRawEvent) => {
    // Handle interaction/permission request
    if (rawEvent.type === "permission_request") {
      interactionRegistry.register(
        sessionId,
        rawEvent.data.id,
        rawEvent.data.tool,
        rawEvent.data.details,
        proc,
        config.interactionTimeoutMs
      );
      try {
        await sessionStore.updateSessionStatus(sessionId, "waiting_for_interaction");
        await sessionStore.recordChatEvent(
          sessionId,
          turnIndex,
          "permission_request",
          rawEvent.data
        );
      } catch {}
    } else if (rawEvent.type === "token") {
      sessionEntry.accumulatedText += rawEvent.data.delta;
    } else if (rawEvent.type === "text" && rawEvent.part?.text) {
      sessionEntry.accumulatedText += rawEvent.part.text;
    } else if (rawEvent.type === "session_compacted") {
      try {
        await sessionStore.updateSessionSummary(sessionId, rawEvent.data.summary);
        await sessionStore.recordChatEvent(
          sessionId,
          turnIndex,
          "session_compacted",
          rawEvent.data
        );
      } catch {}
    } else if (
      rawEvent.type === "tool_start" ||
      rawEvent.type === "tool_finish" ||
      rawEvent.type === "tool_use" ||
      rawEvent.type === "plan_update"
    ) {
      try {
        await sessionStore.recordChatEvent(sessionId, turnIndex, rawEvent.type, rawEvent as any);
      } catch {}
    }

    adapter.processRawEvent(rawEvent);
  });

  proc.on("stderr", (data: string) => {
    console.error(`[Process stderr] ${data}`);
  });

  proc.on("error", (err: Error) => {
    console.error(`[Process error] ${err.message}`);
  });

  proc.on("closed", async (exitCode: number) => {
    if (sessionEntry.accumulatedText) {
      try {
        await sessionStore.recordChatEvent(sessionId, turnIndex, "assistant_response", {
          text: sessionEntry.accumulatedText,
        });
      } catch {}
    }

    try {
      await sessionStore.updateSessionStatus(
        sessionId,
        exitCode === 0 ? "completed" : "failed"
      );
    } catch {}

    interactionRegistry.clear(sessionId);
    activeSessions.delete(sessionId);
    await sandboxManager.cleanup(sessionId);
  });

  proc.start();
}

// 1. Initiate Turn & Open AG-UI SSE Stream (Supports GET and POST)
app.get("/api/v1/sessions/:id/stream", handleTurnStream);
app.post("/api/v1/sessions/:id/stream", handleTurnStream);
app.post("/api/v1/sessions/:id/turn", handleTurnStream);

// 2. Resolve User Approval / Interaction via HTTP POST
app.post("/api/v1/sessions/:id/interactions", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  const resolution = req.body as UserInteractionResolution;

  if (!resolution || !resolution.interactionId || !resolution.resolution) {
    return res.status(400).json({ error: "Invalid interaction resolution payload." });
  }

  const pending = interactionRegistry.getPendingBySession(sessionId);
  if (!pending) {
    return res.status(404).json({ error: "No active session awaiting user interaction." });
  }

  if (pending.interactionId !== resolution.interactionId) {
    return res.status(400).json({ error: "Interaction correlation ID mismatch." });
  }

  const resolved = interactionRegistry.resolve(sessionId, resolution);
  if (!resolved) {
    return res.status(500).json({ error: "Failed to resolve interaction." });
  }

  try {
    await sessionStore.updateSessionStatus(sessionId, "running");
    await sessionStore.recordChatEvent(
      sessionId,
      0,
      "user_interaction_resolved",
      resolution as any
    );
  } catch {}

  return res.json({ status: "acknowledged", interactionId: resolution.interactionId });
});

// Process cleanup on exit
export function cleanupAllSandboxes(): void {
  for (const [sessionId, entry] of activeSessions.entries()) {
    try {
      entry.proc.kill("SIGTERM");
      sandboxManager.cleanup(sessionId);
    } catch {}
  }
  activeSessions.clear();
}

process.on("SIGTERM", async () => {
  cleanupAllSandboxes();
  await closePool();
  process.exit(0);
});

process.on("SIGINT", async () => {
  cleanupAllSandboxes();
  await closePool();
  process.exit(0);
});

export function startServer(port: number = config.port) {
  return app.listen(port, () => {
    console.log(`OpenCode Ephemeral Orchestrator listening on port ${port}`);
  });
}

if (require.main === module) {
  startServer();
}
