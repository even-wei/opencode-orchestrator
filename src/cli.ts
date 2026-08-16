#!/usr/bin/env node

import { config } from "./config";
import { startServer } from "./index";
import { applySchema, getPool, closePool } from "./db/client";
import { SandboxManager } from "./runner/sandbox";
import { OrchestratedProcess } from "./runner/process";
import { AGUIStreamAdapter } from "./events/aguiAdapter";
import { sessionStore } from "./db/sessionStore";
import { agentStore } from "./db/agentStore";
import { handleAgentCommand } from "./cli/agentCli";
import { OpenCodeRawEvent } from "./events/types";
import { getTracer } from "./observability/tracer";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VERSION = "1.0.0";

function printHelp() {
  console.log(`
OpenCode Ephemeral Orchestrator CLI (v${VERSION})

Usage:
  opencode-orchestrator <command> [options]

Commands:
  serve                      Start the HTTP & SSE orchestrator server
  run <prompt>               Execute a one-off ephemeral turn directly from CLI
  agent <subcommand>         Interactive Agent Genesis & Continuous Iteration wizard
  verify                     Run complete system verification (DB, CLI, Sandbox, OTel, Live Turn)
  migrate                    Apply schema.sql to the configured PostgreSQL database
  health                     Check PostgreSQL connection and opencode CLI status

Options for 'serve':
  -p, --port <port>          Port to listen on (default: 8080 or $PORT)
  -h, --host <host>          Host address to bind (default: 0.0.0.0 or $HOST)

Options for 'run':
  -m, --model <model>        Model identifier (e.g. openrouter/deepseek/deepseek-v4-flash)
  -s, --session <id>         Session ID (default: generates a new ephemeral session)
  -t, --tenant <id>          Tenant ID (default: default_tenant)
  -a, --agent <name[@ver]>   Load configuration & skills from published AgentBundle
      --format <format>      Output format: text | sse | json (default: text)
      --skill <name=file>    Attach custom skill file to the ephemeral sandbox

Options for 'agent':
  agent init                 Interactive questionnaire / repo scan to draft agent.json
  agent test <file>          Execute benchmark evalSuite in ephemeral sandboxes
  agent iterate <file>       Diff-driven iterative steering with natural language
  agent publish <file>       Publish agent bundle to team PostgreSQL registry
  agent list                 Display published team agents and invocation tokens

Options for 'verify':
  -l, --live                 Execute a live turn test with LLM execution
  -m, --model <model>        Model identifier for live verification

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

async function handleVerify(args: string[]) {
  let isLive = false;
  let model = "openrouter/deepseek/deepseek-v4-flash";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--live" || arg === "-l") {
      isLive = true;
    } else if (arg === "-m" || arg === "--model") {
      model = args[++i];
    }
  }

  console.log(`\n🔍 OpenCode Ephemeral Orchestrator System Verification\n${"=".repeat(56)}`);

  let allPassed = true;

  // 1. PostgreSQL Check
  process.stdout.write("1. PostgreSQL Database & Schema... ");
  try {
    const pool = getPool();
    await pool.query("SELECT NOW() as now");
    const tablesRes = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('tenants', 'sessions', 'chat_events')"
    );
    const tableNames = tablesRes.rows.map((r) => r.table_name);
    if (tableNames.length >= 3) {
      console.log(`\x1b[32mPASSED\x1b[0m (Tables: ${tableNames.join(", ")})`);
    } else {
      console.log(`\x1b[33mWARNING\x1b[0m (Missing tables. Found: ${tableNames.join(", ") || "none"} — run 'migrate')`);
    }
  } catch (err: any) {
    console.log(`\x1b[31mFAILED\x1b[0m (${err.message})`);
    allPassed = false;
  }

  // 2. OpenCode CLI Binary Check
  process.stdout.write("2. OpenCode CLI Binary Check...   ");
  try {
    const versionOutput = execSync(`${config.opencodeBinPath} --version 2>&1`, { encoding: "utf-8" }).trim();
    console.log(`\x1b[32mPASSED\x1b[0m (Binary: ${config.opencodeBinPath} [${versionOutput}])`);
  } catch (err: any) {
    console.log(`\x1b[31mFAILED\x1b[0m (Cannot execute ${config.opencodeBinPath}: ${err.message})`);
    allPassed = false;
  }

  // 3. Ephemeral Sandbox & Skills Provisioning
  process.stdout.write("3. Ephemeral Sandbox & Skills...  ");
  const testSessionId = `sess_verify_${Date.now()}`;
  const sandbox = new SandboxManager();
  try {
    const env = await sandbox.provision({
      sessionId: testSessionId,
      taskConfig: {
        mcp: {
          test_mcp: { command: "npx", args: ["-y", "test-pkg"] },
        },
      },
      skills: [{ name: "verify-skill", content: "---\nname: verify\n---\nTest skill" }],
    });

    const skillFile = path.join(env.workspacePath, ".opencode", "skills", "verify-skill", "SKILL.md");
    const configFile = path.join(env.homePath, ".config", "opencode", "opencode.json");

    if (fs.existsSync(skillFile) && fs.existsSync(configFile)) {
      await sandbox.cleanup(testSessionId);
      console.log(`\x1b[32mPASSED\x1b[0m (Provisioned and cleaned /tmp/sandboxes/${testSessionId})`);
    } else {
      throw new Error("Sandbox files were not generated properly");
    }
  } catch (err: any) {
    console.log(`\x1b[31mFAILED\x1b[0m (${err.message})`);
    allPassed = false;
  }

  // 4. Arize Phoenix Observability Check
  process.stdout.write("4. Arize Phoenix Observability... ");
  if (config.telemetry.enabled) {
    try {
      const tracer = getTracer();
      const span = tracer.startSpan("Verify: system_check");
      span.end();
      console.log(`\x1b[32mPASSED\x1b[0m (Collector: ${config.telemetry.endpoint})`);
    } catch (err: any) {
      console.log(`\x1b[33mWARNING\x1b[0m (${err.message})`);
    }
  } else {
    console.log(`\x1b[90mSKIPPED\x1b[0m (Observability disabled in config)`);
  }

  // 5. Live Turn Execution (if requested)
  if (isLive) {
    console.log(`\n5. Live Turn Execution (Model: ${model})...`);
    const liveSessionId = `sess_live_verify_${Date.now()}`;
    const liveEnv = await sandbox.provision({
      sessionId: liveSessionId,
      taskConfig: { model },
    });

    await new Promise<void>((resolve) => {
      const proc = new OrchestratedProcess(
        config.opencodeBinPath,
        "Write a 1-sentence haiku about coding.",
        liveEnv,
        "verify_tenant",
        { model }
      );

      let text = "";
      proc.on("event", (evt: OpenCodeRawEvent) => {
        if (evt.type === "token") text += evt.data.delta;
        if (evt.type === "text" && evt.part?.text) text += evt.part.text;
      });

      proc.on("closed", async (code) => {
        await sandbox.cleanup(liveSessionId);
        if (code === 0 && text.trim().length > 0) {
          console.log(`   Response: "\x1b[36m${text.trim()}\x1b[0m"`);
          console.log(`   \x1b[32mPASSED\x1b[0m (Live execution successful)`);
        } else {
          console.log(`   \x1b[31mFAILED\x1b[0m (Exit code: ${code})`);
          allPassed = false;
        }
        resolve();
      });

      proc.start();
    });
  }

  await closePool();
  console.log(`${"=".repeat(56)}`);
  if (allPassed) {
    console.log(`🎉 System verification \x1b[32mSUCCEEDED\x1b[0m. All components are operational!\n`);
  } else {
    console.log(`❌ System verification \x1b[31mFAILED\x1b[0m. Review issues above.\n`);
    process.exit(1);
  }
}

async function handleRun(args: string[]) {
  let prompt = "";
  let model = "";
  let sessionId = `sess_${randomUUID().slice(0, 8)}`;
  let tenantId = "default_tenant";
  let format: "text" | "sse" | "json" = "text";
  let agentName = "";
  const skills: Array<{ name: string; content: string }> = [];
  let taskConfig: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-m" || arg === "--model") {
      model = args[++i];
    } else if (arg === "-s" || arg === "--session") {
      sessionId = args[++i];
    } else if (arg === "-t" || arg === "--tenant") {
      tenantId = args[++i];
    } else if (arg === "-a" || arg === "--agent") {
      agentName = args[++i];
    } else if (arg === "--format") {
      format = (args[++i] as any) || "text";
    } else if (arg === "--skill") {
      const skillArg = args[++i];
      if (skillArg && skillArg.includes("=")) {
        const eqIdx = skillArg.indexOf("=");
        const name = skillArg.slice(0, eqIdx);
        const filePath = skillArg.slice(eqIdx + 1);
        try {
          const content = fs.readFileSync(path.resolve(filePath), "utf-8");
          skills.push({ name, content });
        } catch (err: any) {
          console.warn(`[Orchestrator] Failed to read skill file ${filePath}: ${err.message}`);
        }
      }
    } else if (!arg.startsWith("-")) {
      prompt = prompt ? `${prompt} ${arg}` : arg;
    }
  }

  // Load from Agent Template if --agent specified
  if (agentName) {
    let nameOnly = agentName;
    let versionOnly: string | undefined = undefined;
    if (agentName.includes("@")) {
      const parts = agentName.split("@");
      nameOnly = parts[0];
      versionOnly = parts[1];
    }

    try {
      const template = await agentStore.getAgentTemplate(nameOnly, versionOnly);
      if (template) {
        const bundle = template.bundleJson;
        console.log(`[Orchestrator] Loaded agent template: ${bundle.name} (v${bundle.version})`);
        if (!model && bundle.runtime?.model) {
          model = bundle.runtime.model;
        }
        if (bundle.taskConfig) {
          taskConfig = { ...bundle.taskConfig };
        }
        if (bundle.skills && Array.isArray(bundle.skills)) {
          for (const s of bundle.skills) {
            skills.push({ name: s.name, content: s.content });
          }
        }
      } else {
        console.warn(`[Orchestrator] Agent template "${agentName}" not found in database registry. Proceeding with default.`);
      }
    } catch {}
  }

  if (model) {
    taskConfig.model = model;
  }

  if (!prompt) {
    console.error("Error: Please provide a prompt to run.");
    printHelp();
    process.exit(1);
  }

  const sandboxManager = new SandboxManager();
  const env = await sandboxManager.provision({
    sessionId,
    taskConfig,
    skills,
  });

  console.log(`[Orchestrator] Provisioned sandbox: ${env.rootPath}`);
  if (model) console.log(`[Orchestrator] Using model: ${model}`);

  // 1. Context Rehydration from PostgreSQL
  let turnIndex = 1;
  let effectivePrompt = prompt;
  try {
    await sessionStore.ensureTenant(tenantId, `Tenant ${tenantId}`);
    await sessionStore.createSession(sessionId, tenantId);
    turnIndex = await sessionStore.getNextTurnIndex(sessionId);
    await sessionStore.recordChatEvent(sessionId, turnIndex, "user_prompt", { prompt });
    effectivePrompt = await sessionStore.rehydrateContext(sessionId, prompt);
  } catch {}

  const proc = new OrchestratedProcess(
    config.opencodeBinPath,
    effectivePrompt,
    env,
    tenantId,
    { model: model || undefined }
  );

  let accumulatedText = "";
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
    proc.on("event", (evt: OpenCodeRawEvent) => {
      if (evt.type === "token") accumulatedText += evt.data.delta;
      if (evt.type === "text" && evt.part?.text) accumulatedText += evt.part.text;
      adapter.processRawEvent(evt);
    });
  } else if (format === "json") {
    proc.on("event", (evt: OpenCodeRawEvent) => {
      if (evt.type === "token") accumulatedText += evt.data.delta;
      if (evt.type === "text" && evt.part?.text) accumulatedText += evt.part.text;
      console.log(JSON.stringify(evt));
    });
  } else {
    // Human-friendly text format
    proc.on("event", (evt: OpenCodeRawEvent) => {
      if (evt.type === "token") {
        accumulatedText += evt.data.delta;
        process.stdout.write(evt.data.delta);
      } else if (evt.type === "text" && evt.part?.text) {
        accumulatedText += evt.part.text;
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

    // 2. Persist turn completion & assistant response to PostgreSQL
    if (accumulatedText) {
      try {
        await sessionStore.recordChatEvent(sessionId, turnIndex, "assistant_response", {
          text: accumulatedText,
        });
        await sessionStore.updateSessionStatus(sessionId, code === 0 ? "completed" : "failed");
      } catch {}
    }

    await sandboxManager.cleanup(sessionId);
    await closePool();
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

    case "agent":
      await handleAgentCommand(argv.slice(1));
      break;

    case "verify":
    case "test":
      await handleVerify(argv.slice(1));
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
