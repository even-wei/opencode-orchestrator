import fs from "node:fs/promises";
import path from "node:path";
import { McpCatalogEntry } from "./types";

export const VERIFIED_MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "postgres",
    name: "PostgreSQL Database MCP",
    category: "database",
    description: "Read schemas, run SELECT queries, inspect tables and indexes safely in PostgreSQL.",
    defaultConfig: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"],
      enabled: true,
      description: "PostgreSQL database query and schema explorer",
    },
    requiredEnvVars: ["DATABASE_URL"],
    suggestedSkills: ["db-analyzer"],
  },
  {
    id: "sqlite",
    name: "SQLite Database MCP",
    category: "database",
    description: "Query and inspect local SQLite database files.",
    defaultConfig: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "${SQLITE_DB_PATH:-app.db}"],
      enabled: true,
      description: "SQLite database explorer",
    },
    suggestedSkills: ["db-analyzer"],
  },
  {
    id: "github",
    name: "GitHub MCP",
    category: "vcs",
    description: "Inspect repositories, search code, list issues, pull requests, and commit histories.",
    defaultConfig: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
      enabled: true,
      description: "GitHub API tool for repositories, issues, PRs",
    },
    requiredEnvVars: ["GITHUB_TOKEN"],
    suggestedSkills: ["git-release", "pr-reviewer"],
  },
  {
    id: "filesystem",
    name: "Secure Filesystem MCP",
    category: "filesystem",
    description: "Read, write, search, and list files inside designated workspace paths.",
    defaultConfig: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "${WORKSPACE_DIR:-.}"],
      enabled: true,
      description: "Local workspace filesystem navigator",
    },
    suggestedSkills: ["code-auditor"],
  },
  {
    id: "fetch",
    name: "HTTP Web & API Fetch MCP",
    category: "utility",
    description: "Fetch web pages, REST APIs, JSON payloads, and markdown content securely over HTTP.",
    defaultConfig: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      enabled: true,
      description: "HTTP web & REST endpoint fetcher",
    },
    suggestedSkills: ["api-tester"],
  },
  {
    id: "slack",
    name: "Slack Notifications MCP",
    category: "communication",
    description: "Post messages, alerts, incident updates, and reply to threads in Slack channels.",
    defaultConfig: {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
      enabled: true,
      description: "Slack messaging and notification bridge",
    },
    requiredEnvVars: ["SLACK_BOT_TOKEN"],
  },
];

export interface ScannedRepoResult {
  detectedLanguages: string[];
  detectedDatabases: string[];
  detectedFrameworks: string[];
  detectedSchemas: string[];
  suggestedMcpIds: string[];
  suggestedSkillIds: string[];
}

/**
 * Scans a repository directory to detect tech stack, database schemas, and recommend MCPs & Skills.
 */
export async function scanRepository(repoPath: string): Promise<ScannedRepoResult> {
  const result: ScannedRepoResult = {
    detectedLanguages: [],
    detectedDatabases: [],
    detectedFrameworks: [],
    detectedSchemas: [],
    suggestedMcpIds: ["filesystem"],
    suggestedSkillIds: [],
  };

  try {
    const entries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => []);
    const fileNames = entries.map((e) => e.name.toLowerCase());

    // 1. Languages & Frameworks
    if (fileNames.includes("package.json")) {
      result.detectedLanguages.push("TypeScript/JavaScript");
      try {
        const pkgStr = await fs.readFile(path.join(repoPath, "package.json"), "utf-8");
        const pkg = JSON.parse(pkgStr);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (allDeps.pg || allDeps["@prisma/client"] || allDeps.drizzle || allDeps.knex) {
          result.detectedDatabases.push("PostgreSQL");
          result.suggestedMcpIds.push("postgres");
          result.suggestedSkillIds.push("db-analyzer");
        }
        if (allDeps.better_sqlite3 || allDeps.sqlite3 || allDeps.sqlite) {
          result.detectedDatabases.push("SQLite");
          result.suggestedMcpIds.push("sqlite");
          result.suggestedSkillIds.push("db-analyzer");
        }
        if (allDeps.express || allDeps.fastify || allDeps.koa || allDeps["@nestjs/core"]) {
          result.detectedFrameworks.push("Node.js REST API");
          result.suggestedSkillIds.push("api-tester");
        }
      } catch {}
    }

    if (fileNames.includes("go.mod")) {
      result.detectedLanguages.push("Go");
    }
    if (fileNames.includes("requirements.txt") || fileNames.includes("pyproject.toml")) {
      result.detectedLanguages.push("Python");
    }

    // 2. Git & Release
    if (fileNames.includes(".git") || fileNames.includes(".github")) {
      result.suggestedMcpIds.push("github");
      result.suggestedSkillIds.push("git-release", "pr-reviewer");
    }

    // 3. Database Schemas
    if (fileNames.includes("schema.sql") || fileNames.includes("migrations")) {
      result.detectedSchemas.push("SQL Schema/Migrations");
      if (!result.suggestedMcpIds.includes("postgres")) {
        result.suggestedMcpIds.push("postgres");
      }
      if (!result.suggestedSkillIds.includes("db-analyzer")) {
        result.suggestedSkillIds.push("db-analyzer");
      }
    }

    // Deduplicate suggestions
    result.suggestedMcpIds = Array.from(new Set(result.suggestedMcpIds));
    result.suggestedSkillIds = Array.from(new Set(result.suggestedSkillIds));
  } catch {}

  return result;
}

export function getMcpCatalog(): McpCatalogEntry[] {
  return VERIFIED_MCP_CATALOG;
}

export function getMcpById(id: string): McpCatalogEntry | undefined {
  return VERIFIED_MCP_CATALOG.find((m) => m.id === id);
}
