/**
 * Domain types for Agent Genesis & Continuous Iteration Engine
 */

export interface AgentSkill {
  name: string;
  description: string;
  content: string; // Markdown content of SKILL.md
}

export interface AgentMcpServer {
  type: "local" | "remote";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  description?: string;
}

export interface EvalAssertion {
  type: "file_exists" | "output_contains" | "forbidden_pattern" | "expected_tool_called";
  target: string;
  description?: string;
}

export interface EvalTestCase {
  id: string;
  title: string;
  prompt: string;
  expectedTools?: string[];
  assertions?: EvalAssertion[];
}

export interface EvalAssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  details?: string;
}

export interface EvalTestCaseResult {
  testId: string;
  title: string;
  passed: boolean;
  durationMs: number;
  tokens?: { input?: number; output?: number; total?: number };
  costUsd?: number;
  traceUrl?: string;
  toolsCalled: string[];
  assertionResults: EvalAssertionResult[];
  error?: string;
}

export interface AgentBundle {
  name: string;
  version: string;
  description: string;
  owner: string;
  runtime: {
    model: string;
    timeoutMs: number;
    maxTurnsPerSession?: number;
  };
  dependencies?: Record<string, string>; // e.g. { "sql-sanitizer": "^1.0.0" }
  taskConfig: {
    mcp: Record<string, AgentMcpServer>;
  };
  skills: AgentSkill[];
  permissions: {
    requireApprovalTools: string[];
    autoApprovedTools: string[];
  };
  evalSuite: EvalTestCase[];
  tags?: string[];
}

export interface AgentTemplateRecord {
  id: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  bundleJson: AgentBundle;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  telemetrySummary?: {
    totalRuns: number;
    successRate: number;
    avgDurationSeconds: number;
    avgCostUsd: number;
  };
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  category: "database" | "vcs" | "communication" | "filesystem" | "observability" | "utility";
  description: string;
  defaultConfig: AgentMcpServer;
  requiredEnvVars?: string[];
  suggestedSkills?: string[];
}

export interface CuratedSkillEntry {
  id: string;
  name: string;
  category: "database" | "git" | "code_review" | "security" | "devops" | "testing";
  description: string;
  content: string;
  recommendedMcp: string[];
}

export interface AgentSynthesisRequest {
  description: string;
  name?: string;
  repoPath?: string;
  selectedMcpIds?: string[];
  selectedSkillIds?: string[];
  model?: string;
  requireApprovalForMutations?: boolean;
}

export interface AgentSynthesisResult {
  bundle: AgentBundle;
  scannedRepoContext?: {
    detectedLanguages: string[];
    detectedDatabases: string[];
    detectedFrameworks: string[];
  };
  lintIssues: string[];
}

export interface AgentRefineRequest {
  currentBundle: AgentBundle;
  feedback: string;
  failedTraceId?: string;
}

export interface AgentRefineResult {
  updatedBundle: AgentBundle;
  skillDiffs: Array<{
    skillName: string;
    diff: string;
    oldContent: string;
    newContent: string;
  }>;
  shadowEvalResults?: EvalTestCaseResult[];
  regressionDetected: boolean;
}
