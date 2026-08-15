/**
 * Example: Triggering an Ephemeral Turn with Custom Skills and MCP Servers
 *
 * Run with: npx tsx examples/run_turn.ts
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const serverUrl = process.env.ORCHESTRATOR_URL || "http://localhost:8080";
  const sessionId = `sess_example_${Date.now()}`;

  // 1. Load skill content from examples directory
  const skillPath = path.resolve(__dirname, "skills/db-analyzer/SKILL.md");
  const skillContent = await fs.readFile(skillPath, "utf-8");

  // 2. Prepare payload with MCP and Declarative Skills
  const payload = {
    tenantId: "tenant_dev_101",
    model: "openrouter/deepseek/deepseek-v4-flash",
    prompt: "List all public database tables and summarize their structure using postgres-mcp.",
    taskConfig: {
      model: "openrouter/deepseek/deepseek-v4-flash",
      mcp: {
        postgres: {
          command: "npx",
          args: [
            "-y",
            "@modelcontextprotocol/server-postgres",
            process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/opencode"
          ]
        }
      }
    },
    skills: [
      {
        name: "db-analyzer",
        content: skillContent
      }
    ]
  };

  console.log(`Connecting to ${serverUrl}/api/v1/sessions/${sessionId}/stream ...\n`);

  // 3. Initiate SSE turn stream
  const req = http.request(
    `${serverUrl}/api/v1/sessions/${sessionId}/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    },
    (res) => {
      res.on("data", (chunk) => {
        // Stream AG-UI SSE events directly to stdout
        process.stdout.write(chunk.toString());
      });

      res.on("end", () => {
        console.log("\n[Stream Finished]");
      });
    }
  );

  req.on("error", (err) => {
    console.error("Stream error:", err.message);
  });

  req.write(JSON.stringify(payload));
  req.end();
}

if (require.main === module) {
  main().catch(console.error);
}
