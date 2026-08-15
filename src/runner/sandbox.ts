import fs from "node:fs/promises";
import path from "node:path";
import { config as appConfig } from "../config";

export interface SandboxConfig {
  sessionId: string;
  baseDir?: string;
  taskConfig: Record<string, any>;
  skills: Array<{ name: string; content: string }>;
  auth?: Record<string, any>;
}

export interface SandboxEnvironment {
  rootPath: string;
  homePath: string;
  workspacePath: string;
}

export class SandboxManager {
  constructor(private baseDir: string = appConfig.sandboxBaseDir) {}

  async provision(config: SandboxConfig): Promise<SandboxEnvironment> {
    const effectiveBaseDir = config.baseDir || this.baseDir;
    const rootPath = path.join(effectiveBaseDir, config.sessionId);
    const homePath = path.join(rootPath, "home");
    const workspacePath = path.join(rootPath, "workspace");
    const configPath = path.join(homePath, ".config", "opencode");
    const authDir = path.join(homePath, ".local", "share", "opencode");

    await fs.mkdir(configPath, { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(authDir, { recursive: true });

    // Normalize taskConfig & MCP server entries to OpenCode format
    const normalizedTaskConfig = { ...(config.taskConfig ?? {}) };
    if (normalizedTaskConfig.mcp && typeof normalizedTaskConfig.mcp === "object") {
      const normalizedMcp: Record<string, any> = {};
      for (const [key, server] of Object.entries(normalizedTaskConfig.mcp)) {
        if (server && typeof server === "object") {
          const s = server as Record<string, any>;
          normalizedMcp[key] = {
            type: s.type || (s.command ? "local" : s.url ? "remote" : "local"),
            enabled: s.enabled !== undefined ? s.enabled : true,
            ...s,
          };
        }
      }
      normalizedTaskConfig.mcp = normalizedMcp;
    }

    // Injected runtime config & MCP mappings
    await fs.writeFile(
      path.join(configPath, "opencode.json"),
      JSON.stringify(normalizedTaskConfig, null, 2),
      "utf-8"
    );

    // Injected auth credentials if available
    if (config.auth) {
      await fs.writeFile(
        path.join(authDir, "auth.json"),
        JSON.stringify(config.auth, null, 2),
        "utf-8"
      );
    } else {
      const hostAuthPath = path.join(
        process.env.HOME || "",
        ".local",
        "share",
        "opencode",
        "auth.json"
      );
      try {
        const hostAuth = await fs.readFile(hostAuthPath, "utf-8");
        await fs.writeFile(path.join(authDir, "auth.json"), hostAuth, "utf-8");
      } catch {
        // Auth file optional
      }
    }

    // Injected declarative skills
    if (config.skills && Array.isArray(config.skills)) {
      for (const skill of config.skills) {
        const skillDir = path.join(workspacePath, ".opencode", "skills", skill.name);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), skill.content, "utf-8");
      }
    }

    return { rootPath, homePath, workspacePath };
  }

  async cleanup(sessionId: string): Promise<void> {
    const rootPath = path.join(this.baseDir, sessionId);
    await fs.rm(rootPath, { recursive: true, force: true }).catch(() => {});
  }
}
