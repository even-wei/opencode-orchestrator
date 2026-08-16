import { AgentBundle, AgentRefineRequest, AgentRefineResult, AgentSkill } from "./types";
import { evalRunner } from "./evalRunner";

/**
 * Computes a simple unified diff representation between two texts.
 */
export function computeSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diffLines: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];

    if (o === undefined) {
      diffLines.push(`+ ${n}`);
    } else if (n === undefined) {
      diffLines.push(`- ${o}`);
    } else if (o !== n) {
      diffLines.push(`- ${o}`);
      diffLines.push(`+ ${n}`);
    } else {
      diffLines.push(`  ${o}`);
    }
  }

  return diffLines.join("\n");
}

/**
 * Refines an AgentBundle based on user feedback, produces unified diffs, and runs shadow regression tests.
 */
export async function refineAgentBundle(
  request: AgentRefineRequest,
  runShadowTests: boolean = false
): Promise<AgentRefineResult> {
  const { currentBundle, feedback } = request;
  const updatedBundle: AgentBundle = JSON.parse(JSON.stringify(currentBundle));
  const skillDiffs: AgentRefineResult["skillDiffs"] = [];

  // Update primary skill with new guideline/rule
  if (updatedBundle.skills.length > 0) {
    const primarySkill = updatedBundle.skills[0];
    const oldContent = primarySkill.content;

    // Append rule to skill content
    const newRule = `\n- **Refined Directive:** ${feedback}\n`;
    let newContent = oldContent;

    if (newContent.includes("## Action Protocol") || newContent.includes("# ")) {
      newContent += newRule;
    } else {
      newContent += `\n# Additional Guidelines\n${newRule}`;
    }

    primarySkill.content = newContent;

    skillDiffs.push({
      skillName: primarySkill.name,
      diff: computeSimpleDiff(oldContent, newContent),
      oldContent,
      newContent,
    });
  } else {
    // Create new skill if none existed
    const newSkill: AgentSkill = {
      name: `${updatedBundle.name}-refined`,
      description: `Refined rules: ${feedback}`,
      content: `---
name: ${updatedBundle.name}-refined
description: Refined rules
---

# Operational Guidelines
- ${feedback}
`,
    };
    updatedBundle.skills.push(newSkill);
    skillDiffs.push({
      skillName: newSkill.name,
      diff: computeSimpleDiff("", newSkill.content),
      oldContent: "",
      newContent: newSkill.content,
    });
  }

  // Increment patch version (e.g. 1.0.0 -> 1.0.1)
  const semverParts = updatedBundle.version.split(".").map((p) => parseInt(p, 10) || 0);
  if (semverParts.length >= 3) {
    semverParts[2] += 1;
    updatedBundle.version = semverParts.join(".");
  }

  let shadowEvalResults = undefined;
  let regressionDetected = false;

  if (runShadowTests && updatedBundle.evalSuite.length > 0) {
    shadowEvalResults = await evalRunner.runEvalSuite(updatedBundle);
    regressionDetected = shadowEvalResults.some((r) => !r.passed);
  }

  return {
    updatedBundle,
    skillDiffs,
    shadowEvalResults,
    regressionDetected,
  };
}
