import { CuratedSkillEntry } from "./types";

export const CURATED_SKILLS_CATALOG: CuratedSkillEntry[] = [
  {
    id: "db-analyzer",
    name: "Database Query & Schema Analyzer",
    category: "database",
    description: "Inspect schemas, verify indexes, analyze query plans with EXPLAIN, and enforce safe query boundaries.",
    recommendedMcp: ["postgres", "sqlite"],
    content: `---
name: db-analyzer
description: PostgreSQL and SQLite query inspection, index verification, and schema analysis.
---

# Database Analysis & Query Guidelines

When analyzing databases or writing SQL queries:
1. **Safety First:** Always include a \`LIMIT\` clause on exploration queries (e.g. \`LIMIT 50\`). Never execute unrestricted \`SELECT *\` on high-cardinality tables.
2. **Schema Inspection:** First query \`information_schema.tables\` or \`\\dt\` to discover table structures before querying rows.
3. **Performance:** When investigating slow queries, prepend with \`EXPLAIN (ANALYZE, BUFFERS)\` to inspect the scan type (Index Scan vs Seq Scan).
4. **Mutations:** Never execute \`DROP\`, \`TRUNCATE\`, or destructive \`ALTER\` statements without explicit user interaction approval.
`,
  },
  {
    id: "git-release",
    name: "Semantic Versioning & Git Release",
    category: "git",
    description: "Analyzes conventional commits, calculates semver bumps (major/minor/patch), and drafts changelogs.",
    recommendedMcp: ["github"],
    content: `---
name: git-release
description: Semantic versioning analysis, commit log inspection, and release changelog generation.
---

# Git Release & Versioning Guidelines

When determining release version and drafting release notes:
1. **Inspect Commit History:** Read git log from the last tag using \`git log <last-tag>..HEAD --oneline\`.
2. **Semver Bumping Rules:**
   - **MAJOR:** Any commit with \`BREAKING CHANGE:\` in body or \`!\` in type (e.g., \`feat!:\`).
   - **MINOR:** Commits starting with \`feat:\` or \`feat(scope):\`.
   - **PATCH:** Commits starting with \`fix:\`, \`perf:\`, \`refactor:\`, or \`chore:\`.
3. **Draft Changelog:** Group commits under \`### Features\`, \`### Bug Fixes\`, and \`### Breaking Changes\`.
4. **Never Force Push:** Never push with \`--force\` to protected branches.
`,
  },
  {
    id: "pr-reviewer",
    name: "Pull Request Quality & Security Reviewer",
    category: "code_review",
    description: "Reviews code diffs for security vulnerabilities, edge cases, error handling, and test coverage.",
    recommendedMcp: ["github", "filesystem"],
    content: `---
name: pr-reviewer
description: Pull request code review for security vulnerabilities, edge cases, and test coverage.
---

# Pull Request Review Guidelines

When reviewing code changes:
1. **Security Vulnerabilities:**
   - Check for SQL injection (unparameterized query strings).
   - Check for hardcoded credentials, API keys, or JWT secrets.
   - Check for unbounded memory allocations or regex denial-of-service (ReDoS).
2. **Error Handling:** Ensure asynchronous operations catch errors and resources (connections, file handles) are closed in \`finally\` blocks.
3. **Constructive Feedback:** Explain *why* a pattern is risky and propose a concrete, drop-in replacement snippet.
`,
  },
  {
    id: "api-tester",
    name: "REST API Endpoint & Smoke Tester",
    category: "testing",
    description: "Tests HTTP REST endpoints, validates response status codes, headers, and JSON schema payloads.",
    recommendedMcp: ["fetch"],
    content: `---
name: api-tester
description: HTTP REST API endpoint testing, response verification, and contract validation.
---

# API Smoke Testing Guidelines

When testing REST APIs:
1. **Health Verification:** Start by checking \`/health\`, \`/livez\`, and \`/readyz\` endpoints.
2. **Status Codes:** Verify expected HTTP status codes (200 for GET, 201 for POST, 400 for bad payloads, 404 for missing resources).
3. **Headers & Content-Type:** Verify \`Content-Type: application/json\` or \`text/event-stream\` headers.
4. **Error Payloads:** Verify error responses contain structured \`{ error: string }\` messages rather than unhandled stack dumps.
`,
  },
  {
    id: "security-auditor",
    name: "Repository Security & Dependency Auditor",
    category: "security",
    description: "Audits dependency lockfiles, Dockerfile security configurations, and permissions.",
    recommendedMcp: ["filesystem"],
    content: `---
name: security-auditor
description: Security auditing for dependencies, container configurations, and sensitive files.
---

# Security Audit Guidelines

When auditing a codebase:
1. **Dependencies:** Check package manifests for outdated or vulnerable packages (\`npm audit\`, \`cargo audit\`).
2. **Container Security:** Ensure \`Dockerfile\` does not run as root user (\`USER node\` or \`USER nonroot\`).
3. **File Permissions:** Check that \`.env\`, \`auth.json\`, and private keys are in \`.gitignore\`.
`,
  },
];

export function getCuratedSkills(): CuratedSkillEntry[] {
  return CURATED_SKILLS_CATALOG;
}

export function getCuratedSkillById(id: string): CuratedSkillEntry | undefined {
  return CURATED_SKILLS_CATALOG.find((s) => s.id === id);
}
