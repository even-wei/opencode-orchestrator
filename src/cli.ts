#!/usr/bin/env node

import { config } from "./config";
import { startServer } from "./index";
import { applySchema, getPool, closePool } from "./db/client";
import { SandboxManager } from "./runner/sandbox";
import { OrchestratedProcess } from "./runner/process";
import { AGUIStreamAdapter } from "./events/aguiAdapter";
import { sessionStore } from "./db/sessionStore";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const VERSION = "1.0.0";

function printHelp() {
  console.log(`
OpenCode Ephemeral Orchestrator CLI (v${VERSION})

Usage:
  opencode-orchestrator <command> [options]

Commands:
  serve                      Start the HTTP & SSE orchestrator server
  run <prompt>               Execute a one-off ephemeral turn directly from CLI
  migrate                    Apply schema.sql to the configured PostgreSQL database
  health                     Check PostgreSQL connection and opencode CLI status

Options for 'serve':
  -p, --port <port>          Port to listen on (default: 8080 or $PORT)
  -h, --host <host>          Host address to bind (default: 0.0.0.0 or $HOST)

Options for 'run':
  -m, --model <model>        Model identifier (e.g. openrouter/deepseek/deepseek-v4-flash)
  -s, --session <id>         Session ID (default: generates a new ephemeral session)
  -t, --tenant <id>          Tenant ID (default: default_tenant)
      --format <format>      Output format: text | sse | json (default: text)
      --skill <name=file>    Attach custom skill file to the ephemeral sandbox

Global Options:
  -v, --version              Show version number
      --help                 Show this help message
`);
}

async function handleMigrate() {
  console.log("Applying PostgreSQL database schema from schema.sql...");
  try {
    await applySchema();
    console.log("✓ Schema migrations applied successfully.");
  } catch (err: any) {
    console.error("✗ Failed to apply schema:", err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

async function handleHealth() {
  console.log("Checking system components...");

  // 1. PostgreSQL Check
  try {
    const pool = getPool();
    const res = await pool.query("SELECT NOW() as now");
    console.log(`✓ PostgreSQL: Connected (${res.rows[0].now})`);
  } catch (err: any) {
    console.log(`! PostgreSQL: Disconnected or not reachable (${err.message})`);
  } finally {
    await closePool();
  }

  // 2. Binary check
  const sandbox = new SandboxManager();
  console.log(`✓ Sandbox base directory: ${config.sandboxBaseDir}`);
  console.log(`✓ OpenCode binary configured: ${config.opencodeBinPath}`);
  console.log("Health check completed.");
}

async function handleRun(args: string[]) {
  let prompt = "";
  let model = "";
  let sessionId = `sess_${randomUUID().slice(0, 8)}`;
  let tenantId = "default_tenant";
  let format: "text" | "sse" | "json" = "text";
  const skills: Array<{ name: string; content: string }> = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-m" || arg === "--model") {
      model = args[++i];
    } else if (arg === "-s" || arg === "--session") {
      sessionId = args[++i];
    } else if (arg === "-t" || arg === "--tenant") {
      tenantId = args[++i];
    } else if (arg === "--format") {
      format = (args[++i] as any) || "text";
    } else if (!arg.startsWith("-")) {
      prompt = prompt ? `${prompt} ${arg}` : arg;
    }
  }

  if (!prompt) {
    console.error("Error: Please provide a prompt to run.");
    printHelp();
    process.exit(1);
  }

  const sandboxManager = new SandboxManager();
  const env = await sandboxManager.provision({
    sessionId,
    taskConfig: model ? { model } : {},
    skills,
  });

  console.log(`[Orchestrator] Provisioned sandbox: ${env.rootPath}`);
  if (model) console.log(`[Orchestrator] Using model: ${model}`);

  // Try rehydrating context if PostgreSQL is active
  let effectivePrompt = prompt;
  try {
    await sessionStore.ensureTenant(tenantId, `Tenant ${tenantId}`);
    await sessionStore.createSession(sessionId, tenantId);
    effectivePrompt = await sessionStore.rehydrateContext(sessionId, prompt);
  } catch {}

  const proc = new OrchestratedProcess(
    config.opencodeBinPath,
    effectivePrompt,
    env,
    tenantId,
    { model: model || undefined }
  );

  let rl: readline.Interface | null = null;
  if (process.stdin.isTTY) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  if (format === "sse") {
    const adapter = new AGUIStreamAdapter(
      {
        write: (chunk: string) => process.stdout.write(chunk),
        end: () => {},
      },
      `run_${Date.now()}`
    );
    proc.on("event", (evt) => adapter.processRawEvent(evt));
  } else if (format === "json") {
    proc.on("event", (evt) => console.log(JSON.stringify(evt)));
  } else {
    // Human-friendly text format
    proc.on("event", (evt) => {
      if (evt.type === "token") {
        process.stdout.write(evt.data.delta);
      } else if (evt.type === "text" && evt.part?.text) {
        process.stdout.write(evt.part.text);
      } else if (evt.type === "tool_use" && evt.part) {
        console.log(`\n\x1b[36m⚙ [Tool: ${evt.part.tool}]\x1b[0m ${JSON.stringify(evt.part.state?.input || {})}`);
      } else if (evt.type === "permission_request" || evt.type === "permission") {
        const id = (evt as any).data?.id || (evt as any).part?.id;
        const tool = (evt as any).data?.tool || (evt as any).part?.tool;
        console.log(`\n\x1b[33m⚠ Approval required for tool '${tool}' (id: ${id})\x1b[0m`);
        if (rl) {
          rl.question("Approve action? (y/N): ", (answer) => {
            const allow = answer.trim().toLowerCase() === "y";
            proc.writeStdin({ id, allow });
          });
        }
      } else if (evt.type === "step_finish" && evt.part?.tokens) {
        console.log(`\n\x1b[90m[Tokens: ${evt.part.tokens.total || 0} | Cost: $${(evt.part.cost || 0).toFixed(4)}]\x1b[0m`);
      }
    });
  }

  proc.on("closed", async (code) => {
    if (rl) rl.close();
    await sandboxManager.cleanup(sessionId);
    console.log(`\n[Orchestrator] Ephemeral sandbox cleaned up. (Exit code: ${code})`);
    process.exit(code);
  });

  proc.start();
}

function handleServe(args: string[]) {
  let port = config.port;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--port") {
      port = parseInt(args[++i], 10) || port;
    }
  }

  startServer(port);
}

export async function main(argv: string[] = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(`opencode-orchestrator v${VERSION}`);
    return;
  }

  switch (command) {
    case "serve":
    case "start":
      handleServe(argv.slice(1));
      break;

    case "run":
      await handleRun(argv.slice(1));
      break;

    case "migrate":
      await handleMigrate();
      break;

    case "health":
      await handleHealth();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}
