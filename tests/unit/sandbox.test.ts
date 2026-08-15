import { test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { SandboxManager } from "../../src/runner/sandbox";

const TEST_BASE = "/tmp/test-sandboxes";
const sandboxManager = new SandboxManager(TEST_BASE);

beforeAll(async () => {
  await fs.mkdir(TEST_BASE, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_BASE, { recursive: true, force: true });
});

test("provisions sandbox files and purges them completely on cleanup", async () => {
  const sessionId = "sess_test_101";
  const env = await sandboxManager.provision({
    sessionId,
    baseDir: TEST_BASE,
    taskConfig: { model: "anthropic/claude-3-5-sonnet" },
    skills: [{ name: "db-migrate", content: "# Migration Skill" }],
  });

  const configPath = path.join(env.homePath, ".config", "opencode", "opencode.json");
  const skillPath = path.join(env.workspacePath, ".opencode", "skills", "db-migrate", "SKILL.md");

  expect((await fs.stat(configPath)).isFile()).toBe(true);
  expect((await fs.stat(skillPath)).isFile()).toBe(true);

  const rawConfig = await fs.readFile(configPath, "utf-8");
  const parsedConfig = JSON.parse(rawConfig);
  expect(parsedConfig.model).toBe("anthropic/claude-3-5-sonnet");

  const rawSkill = await fs.readFile(skillPath, "utf-8");
  expect(rawSkill).toBe("# Migration Skill");

  await sandboxManager.cleanup(sessionId);
  await expect(fs.stat(env.rootPath)).rejects.toThrow();
});
