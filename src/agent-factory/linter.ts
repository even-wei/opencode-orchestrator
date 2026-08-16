import { AgentSkill } from "./types";

export interface SkillLintResult {
  valid: boolean;
  issues: string[];
  wordCount: number;
}

/**
 * Deterministically validates a generated or authored AgentSkill (SKILL.md).
 */
export function lintSkill(skill: AgentSkill): SkillLintResult {
  const issues: string[] = [];

  if (!skill.name || skill.name.trim().length === 0) {
    issues.push("Skill name is missing.");
  } else if (!/^[a-z0-9-_]+$/i.test(skill.name)) {
    issues.push(`Skill name "${skill.name}" contains invalid characters. Use alphanumeric, dash, or underscore.`);
  }

  if (!skill.description || skill.description.trim().length === 0) {
    issues.push("Skill description is missing.");
  }

  if (!skill.content || skill.content.trim().length === 0) {
    issues.push("Skill content is empty.");
    return { valid: false, issues, wordCount: 0 };
  }

  const words = skill.content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount > 500) {
    issues.push(`Skill content is too verbose (${wordCount} words). Recommended maximum is 500 words to preserve LLM context.`);
  }

  // Check frontmatter
  if (!skill.content.startsWith("---")) {
    issues.push("Skill content is missing YAML frontmatter delimiter (---).");
  }

  // Check for action guidelines header
  if (!skill.content.includes("# ") && !skill.content.includes("## ")) {
    issues.push("Skill content lacks markdown section headings for clear instruction hierarchy.");
  }

  return {
    valid: issues.length === 0,
    issues,
    wordCount,
  };
}

/**
 * Lints all skills in an AgentBundle.
 */
export function lintBundleSkills(skills: AgentSkill[]): { valid: boolean; issues: string[] } {
  const allIssues: string[] = [];

  for (const skill of skills) {
    const res = lintSkill(skill);
    if (!res.valid) {
      allIssues.push(...res.issues.map((iss) => `[${skill.name}] ${iss}`));
    }
  }

  return {
    valid: allIssues.length === 0,
    issues: allIssues,
  };
}
