import { test, expect } from "vitest";
import { scanRepository, getMcpCatalog, getMcpById } from "../../src/agent-factory/mcpCatalog";
import { getCuratedSkills, getCuratedSkillById } from "../../src/agent-factory/skillCatalog";
import { lintSkill, lintBundleSkills } from "../../src/agent-factory/linter";
import { synthesizeAgent } from "../../src/agent-factory/synthesizer";
import { refineAgentBundle } from "../../src/agent-factory/refiner";
import path from "node:path";

test("Verified MCP catalog contains standard database, VCS, and utility tools", () => {
  const catalog = getMcpCatalog();
  expect(catalog.length).toBeGreaterThanOrEqual(5);

  const pg = getMcpById("postgres");
  expect(pg).toBeDefined();
  expect(pg?.defaultConfig.command).toBe("npx");

  const gh = getMcpById("github");
  expect(gh).toBeDefined();
  expect(gh?.category).toBe("vcs");
});

test("Curated Skills catalog contains standard engineering skills", () => {
  const skills = getCuratedSkills();
  expect(skills.length).toBeGreaterThanOrEqual(4);

  const dbSkill = getCuratedSkillById("db-analyzer");
  expect(dbSkill).toBeDefined();
  expect(dbSkill?.content).toContain("Database Analysis & Query Guidelines");

  const gitSkill = getCuratedSkillById("git-release");
  expect(gitSkill).toBeDefined();
  expect(gitSkill?.content).toContain("Semver Bumping Rules");
});

test("Codebase scanner inspects current repository correctly", async () => {
  const repoPath = path.resolve(__dirname, "../../");
  const scan = await scanRepository(repoPath);

  expect(scan.detectedLanguages).toContain("TypeScript/JavaScript");
  expect(scan.detectedDatabases).toContain("PostgreSQL");
  expect(scan.suggestedMcpIds).toContain("postgres");
  expect(scan.suggestedSkillIds).toContain("db-analyzer");
});

test("Skill linter validates frontmatter, word count, and structure", () => {
  const validSkill = {
    name: "test-skill",
    description: "A valid test skill",
    content: "---\nname: test-skill\n---\n# Action Guidelines\n1. Do this.\n2. Do that.",
  };
  const res = lintSkill(validSkill);
  expect(res.valid).toBe(true);
  expect(res.issues).toHaveLength(0);

  const invalidSkill = {
    name: "bad skill with spaces!",
    description: "",
    content: "No frontmatter here and no headings",
  };
  const badRes = lintSkill(invalidSkill);
  expect(badRes.valid).toBe(false);
  expect(badRes.issues.length).toBeGreaterThan(0);
});

test("Synthesizer compiles valid AgentBundle with default test cases", async () => {
  const res = await synthesizeAgent({
    name: "billing-guard",
    description: "Triage customer invoices and check PostgreSQL database",
    selectedMcpIds: ["postgres"],
    selectedSkillIds: ["db-analyzer"],
  });

  expect(res.bundle.name).toBe("billing-guard");
  expect(res.bundle.version).toBe("1.0.0");
  expect(res.bundle.taskConfig.mcp).toHaveProperty("postgres");
  expect(res.bundle.skills.some((s) => s.name === "db-analyzer")).toBe(true);
  expect(res.bundle.evalSuite.length).toBeGreaterThan(0);
  expect(res.lintIssues).toHaveLength(0);
});

test("Refiner applies feedback, generates unified diff, and bumps patch version", async () => {
  const synthesis = await synthesizeAgent({
    name: "release-bot",
    description: "Automate releases",
    selectedSkillIds: ["git-release"],
  });

  const refineRes = await refineAgentBundle({
    currentBundle: synthesis.bundle,
    feedback: "Never publish release if tests failed",
  }, false);

  expect(refineRes.updatedBundle.version).toBe("1.0.1");
  expect(refineRes.skillDiffs.length).toBeGreaterThan(0);
  expect(refineRes.skillDiffs[0].diff).toContain("+");
  expect(refineRes.skillDiffs[0].newContent).toContain("Never publish release if tests failed");
});
