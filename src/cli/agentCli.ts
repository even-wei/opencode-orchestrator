import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { synthesizeAgent } from "../agent-factory/synthesizer";
import { evalRunner } from "../agent-factory/evalRunner";
import { refineAgentBundle } from "../agent-factory/refiner";
import { agentStore } from "../db/agentStore";
import { AgentBundle } from "../agent-factory/types";

function askQuestion(query: string, defaultValue: string = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    const promptText = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function handleAgentCommand(args: string[]): Promise<void> {
  const subCommand = args[0] || "help";

  switch (subCommand) {
    case "init":
      await handleAgentInit(args.slice(1));
      break;
    case "test":
      await handleAgentTest(args.slice(1));
      break;
    case "iterate":
    case "refine":
      await handleAgentIterate(args.slice(1));
      break;
    case "publish":
      await handleAgentPublish(args.slice(1));
      break;
    case "list":
      await handleAgentList(args.slice(1));
      break;
    default:
      printAgentHelp();
      break;
  }
}

async function handleAgentInit(args: string[]): Promise<void> {
  console.log("\n🏭 OpenCode Agent Genesis Wizard");
  console.log("=================================\n");

  let desc = "";
  let repoPath = "";
  let name = "";
  let model = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--desc" && args[i + 1]) desc = args[++i];
    if (args[i] === "--repo" && args[i + 1]) repoPath = args[++i];
    if (args[i] === "--name" && args[i + 1]) name = args[++i];
    if (args[i] === "-m" || args[i] === "--model") model = args[++i];
  }

  if (!desc) {
    desc = await askQuestion("1. What task or workflow should this agent perform?", "Database query & triage assistant");
  }
  if (!repoPath) {
    repoPath = await askQuestion("2. (Optional) Path to repository to scan", ".");
  }
  if (!name) {
    name = await askQuestion("3. Agent name", desc.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24));
  }

  console.log("\n[1/3] 🔍 Scanning environment & synthesizing AgentBundle...");
  const synthesis = await synthesizeAgent({
    description: desc,
    repoPath: repoPath || undefined,
    name,
    model: model || undefined,
  });

  if (synthesis.scannedRepoContext) {
    console.log(`[2/3] 📦 Discovered stack: ${JSON.stringify(synthesis.scannedRepoContext)}`);
  }

  console.log(`[3/3] ✨ Synthesized ${synthesis.bundle.skills.length} skill(s) and ${Object.keys(synthesis.bundle.taskConfig.mcp).length} MCP tool(s).`);

  if (synthesis.lintIssues.length > 0) {
    console.warn("\n⚠️  Skill Linter Warnings:");
    for (const iss of synthesis.lintIssues) {
      console.warn(`  - ${iss}`);
    }
  }

  const outputPath = path.resolve(process.cwd(), `${name}.agent.json`);
  await fs.writeFile(outputPath, JSON.stringify(synthesis.bundle, null, 2), "utf-8");
  console.log(`\n🎉 Agent configuration saved to: ${outputPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Test your agent:    npx opencode-orchestrator agent test ${outputPath}`);
  console.log(`  2. Iterate & steer:    npx opencode-orchestrator agent iterate ${outputPath}`);
  console.log(`  3. Publish to team:    npx opencode-orchestrator agent publish ${outputPath}\n`);
}

async function handleAgentTest(args: string[]): Promise<void> {
  const filePath = args[0] || "agent.json";
  console.log(`\n🧪 Testing Agent Bundle: ${filePath}`);
  console.log("=====================================\n");

  const raw = await fs.readFile(filePath, "utf-8");
  const bundle: AgentBundle = JSON.parse(raw);

  console.log(`Running ${bundle.evalSuite.length} benchmark test case(s) in ephemeral sandboxes...\n`);
  const results = await evalRunner.runEvalSuite(bundle);

  let allPassed = true;
  for (const res of results) {
    const statusIcon = res.passed ? "✅ PASS" : "❌ FAIL";
    if (!res.passed) allPassed = false;
    console.log(`${statusIcon} [${res.testId}] ${res.title} (${res.durationMs}ms)`);
    for (const a of res.assertionResults) {
      console.log(`    ${a.passed ? "✓" : "✗"} ${a.details}`);
    }
    if (res.error) {
      console.log(`    Error: ${res.error}`);
    }
  }

  console.log("\n-------------------------------------");
  if (allPassed) {
    console.log("🎉 All benchmark assertions passed!\n");
  } else {
    console.log("⚠️  Some assertions failed. Run 'agent iterate' to steer your agent.\n");
  }
}

async function handleAgentIterate(args: string[]): Promise<void> {
  const filePath = args[0] || "agent.json";
  let feedback = "";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--feedback" && args[i + 1]) feedback = args[++i];
  }

  const raw = await fs.readFile(filePath, "utf-8");
  const bundle: AgentBundle = JSON.parse(raw);

  if (!feedback) {
    feedback = await askQuestion("Enter steering feedback or instruction to add");
  }

  console.log(`\n🔄 Refining agent "${bundle.name}" with feedback: "${feedback}"...`);
  const res = await refineAgentBundle({ currentBundle: bundle, feedback }, false);

  console.log("\nProposed SKILL.md Unified Diff:");
  console.log("-------------------------------------");
  for (const d of res.skillDiffs) {
    console.log(d.diff);
  }
  console.log("-------------------------------------");

  const confirm = await askQuestion("Apply this patch to agent.json? (Y/n)", "Y");
  if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
    await fs.writeFile(filePath, JSON.stringify(res.updatedBundle, null, 2), "utf-8");
    console.log(`\n✅ Updated ${filePath} to version ${res.updatedBundle.version}.\n`);
  } else {
    console.log("\n❌ Patch rejected. File unchanged.\n");
  }
}

async function handleAgentPublish(args: string[]): Promise<void> {
  const filePath = args[0] || "agent.json";
  const raw = await fs.readFile(filePath, "utf-8");
  const bundle: AgentBundle = JSON.parse(raw);

  console.log(`\n🚀 Publishing agent "${bundle.name}@${bundle.version}" to team registry...`);
  const record = await agentStore.saveAgentTemplate(bundle, "platform_team");
  console.log(`✅ Successfully published! Template ID: ${record.id}`);
  console.log(`\nTeammates can now run this agent via:`);
  console.log(`  npx opencode-orchestrator run --agent ${bundle.name} "Your task prompt here"\n`);
}

async function handleAgentList(args: string[]): Promise<void> {
  console.log("\n📚 Team Published Agent Catalog");
  console.log("================================\n");

  const templates = await agentStore.listAgentTemplates();
  if (templates.length === 0) {
    console.log("No agent templates currently registered. Create one with 'agent init'.\n");
    return;
  }

  for (const t of templates) {
    console.log(`• ${t.name} (v${t.version}) - Owner: ${t.owner}`);
    console.log(`  Description: ${t.description || "No description"}`);
    console.log(`  Tags: [${t.tags.join(", ")}]`);
    console.log(`  Run: npx opencode-orchestrator run --agent ${t.name} "<prompt>"\n`);
  }
}

function printAgentHelp(): void {
  console.log(`
OpenCode Agent Genesis & Continuous Iteration CLI

Commands:
  agent init [options]       Interactively create or scan repo to draft agent.json
  agent test <file>          Execute benchmark evalSuite in ephemeral sandbox
  agent iterate <file>       Diff-driven iterative steering with natural language
  agent publish <file>       Register agent bundle to PostgreSQL team catalog
  agent list                 Display published team agents and invocation tokens

Options for 'agent init':
  --desc <text>              Task description or goal
  --repo <path>              Path to repository to scan
  --name <name>              Agent name identifier
  -m, --model <model>        LLM model override
`);
}
