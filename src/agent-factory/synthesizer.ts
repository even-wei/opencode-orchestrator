import { AgentBundle, AgentSynthesisRequest, AgentSynthesisResult, AgentSkill, AgentMcpServer } from "./types";
import { scanRepository, getMcpById } from "./mcpCatalog";
import { getCuratedSkillById } from "./skillCatalog";
import { lintBundleSkills } from "./linter";

/**
 * Synthesizes a validated AgentBundle based on user intent and optional repository scanning.
 */
export async function synthesizeAgent(request: AgentSynthesisRequest): Promise<AgentSynthesisResult> {
  const agentName = (request.name || generateSlug(request.description)).toLowerCase();
  let selectedMcpIds = request.selectedMcpIds || [];
  let selectedSkillIds = request.selectedSkillIds || [];
  let scannedRepoContext: any = undefined;

  // 1. Scan repo if provided
  if (request.repoPath) {
    const scan = await scanRepository(request.repoPath);
    scannedRepoContext = {
      detectedLanguages: scan.detectedLanguages,
      detectedDatabases: scan.detectedDatabases,
      detectedFrameworks: scan.detectedFrameworks,
    };
    if (selectedMcpIds.length === 0) {
      selectedMcpIds = scan.suggestedMcpIds;
    }
    if (selectedSkillIds.length === 0) {
      selectedSkillIds = scan.suggestedSkillIds;
    }
  }

  // Fallback defaults if nothing specified
  if (selectedMcpIds.length === 0) {
    selectedMcpIds = ["filesystem"];
  }

  // 2. Assemble MCP Tools
  const mcpConfig: Record<string, AgentMcpServer> = {};
  for (const mcpId of selectedMcpIds) {
    const entry = getMcpById(mcpId);
    if (entry) {
      mcpConfig[mcpId] = { ...entry.defaultConfig };
    }
  }

  // 3. Assemble Skills (Curated + Custom Tailored)
  const skills: AgentSkill[] = [];
  for (const skillId of selectedSkillIds) {
    const entry = getCuratedSkillById(skillId);
    if (entry) {
      skills.push({
        name: entry.id,
        description: entry.description,
        content: entry.content,
      });
    }
  }

  // If no curated skill or custom domain needed, synthesize a custom primary skill
  if (skills.length === 0 || request.description.length > 20) {
    const customSkillName = `${agentName}-workflow`;
    if (!skills.some((s) => s.name === customSkillName)) {
      skills.push({
        name: customSkillName,
        description: `Operational workflow and guidelines for ${request.description}`,
        content: `---
name: ${customSkillName}
description: Standard operational workflow for ${request.description}
---

# ${capitalize(agentName)} Operational Guidelines

## Objective
${request.description}

## Action Protocol
1. **Analyze First:** Inspect relevant state or context before executing any mutations.
2. **Safety Boundaries:** ${
          request.requireApprovalForMutations !== false
            ? "Require explicit human confirmation for any destructive commands or database updates."
            : "Execute authorized actions safely with minimal friction."
        }
3. **Structured Reporting:** Provide clear, concise responses with actionable next steps.
`,
      });
    }
  }

  // 4. Determine Permissions
  const requireApprovalTools = request.requireApprovalForMutations !== false ? ["bash", "sql_write", "db_mutate"] : [];
  const autoApprovedTools = ["read", "glob", "sql_read", "fetch"];

  // 5. Generate Benchmark Test Cases
  const evalSuite = [
    {
      id: "test_smoke_1",
      title: "Initial Status & Health Check",
      prompt: `Inspect current environment and confirm readiness for ${request.description}.`,
      expectedTools: selectedMcpIds.length > 0 ? [selectedMcpIds[0]] : undefined,
      assertions: [
        {
          type: "output_contains" as const,
          target: "",
          description: "Produces non-empty response",
        },
      ],
    },
    {
      id: "test_task_2",
      title: "Core Workflow Execution",
      prompt: `Execute primary workflow: ${request.description}`,
      assertions: [
        {
          type: "output_contains" as const,
          target: "",
          description: "Executes task without unhandled error",
        },
      ],
    },
  ];

  // 6. Assemble Full Bundle
  const bundle: AgentBundle = {
    name: agentName,
    version: "1.0.0",
    description: request.description,
    owner: "platform_team",
    runtime: {
      model: request.model || "openrouter/deepseek/deepseek-v4-flash",
      timeoutMs: 300000,
    },
    taskConfig: {
      mcp: mcpConfig,
    },
    skills,
    permissions: {
      requireApprovalTools,
      autoApprovedTools,
    },
    evalSuite,
    tags: selectedMcpIds,
  };

  // 7. Lint Skills
  const lintRes = lintBundleSkills(bundle.skills);

  return {
    bundle,
    scannedRepoContext,
    lintIssues: lintRes.issues,
  };
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "custom-agent";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
