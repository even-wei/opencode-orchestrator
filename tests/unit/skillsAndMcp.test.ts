import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { SandboxManager } from "../../src/runner/sandbox";

test("SandboxManager injects custom MCP servers and declarative skills", async () => {
  const sandbox = new SandboxManager();
  const sessionId = `sess_skills_mcp_test_${Date.now()}`;

  const taskConfig = {
    model: "openrouter/deepseek/deepseek-v4-flash",
    mcp: {
      "postgres-db": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/test"]
      },
      "filesystem": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      }
    }
  };

  const skills = [
    {
      name: "git-release",
      content: "---\nname: git-release\ndescription: Git release helper\n---\n# Git Release Skill"
    },
    {
      name: "db-analyzer",
      content: "---\nname: db-analyzer\ndescription: SQL inspector\n---\n# DB Analyzer Skill"
    }
  ];

  const env = await sandbox.provision({
    sessionId,
    taskConfig,
    skills,
  });

  // 1. Verify opencode.json contains MCP configuration
  const opencodeJsonPath = path.join(env.homePath, ".config", "opencode", "opencode.json");
  const configRaw = await fs.readFile(opencodeJsonPath, "utf-8");
  const parsed = JSON.parse(configRaw);

  expect(parsed.mcp).toBeDefined();
  expect(parsed.mcp["postgres-db"].command).toBe("npx");
  expect(parsed.mcp["filesystem"].args).toContain("/tmp");

  // 2. Verify skills are provisioned in workspace
  const gitReleaseSkillPath = path.join(
    env.workspacePath,
    ".opencode",
    "skills",
    "git-release",
    "SKILL.md"
  );
  const dbAnalyzerSkillPath = path.join(
    env.workspacePath,
    ".opencode",
    "skills",
    "db-analyzer",
    "SKILL.md"
  );

  const gitSkillContent = await fs.readFile(gitReleaseSkillPath, "utf-8");
  const dbSkillContent = await fs.readFile(dbAnalyzerSkillPath, "utf-8");

  expect(gitSkillContent).toContain("Git Release Skill");
  expect(dbSkillContent).toContain("DB Analyzer Skill");

  // 3. Clean up sandbox
  await sandbox.cleanup(sessionId);
  await expect(fs.stat(env.rootPath)).rejects.toThrow();
});
