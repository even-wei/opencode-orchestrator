import { AgentBundle, EvalTestCase, EvalTestCaseResult, EvalAssertionResult } from "./types";
import { SandboxManager } from "../runner/sandbox";
import { OrchestratedProcess } from "../runner/process";
import { config } from "../config";
import fs from "node:fs/promises";
import path from "node:path";

export class EvalRunner {
  private sandboxManager: SandboxManager;

  constructor(baseDir: string = config.sandboxBaseDir) {
    this.sandboxManager = new SandboxManager(baseDir);
  }

  /**
   * Executes a single test case in an isolated ephemeral sandbox.
   */
  async runTestCase(bundle: AgentBundle, testCase: EvalTestCase): Promise<EvalTestCaseResult> {
    const testSessionId = `eval_${bundle.name}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const startTime = Date.now();
    const toolsCalled: string[] = [];
    let accumulatedText = "";
    let exitCode = 0;
    let tokensConsumed: any = undefined;
    let costUsd: number | undefined = undefined;

    try {
      // 1. Provision sandbox with bundle taskConfig & skills
      const env = await this.sandboxManager.provision({
        sessionId: testSessionId,
        taskConfig: bundle.taskConfig,
        skills: bundle.skills,
      });

      // 2. Execute process
      await new Promise<void>((resolve, reject) => {
        const proc = new OrchestratedProcess(
          config.opencodeBinPath,
          testCase.prompt,
          env,
          "eval_runner",
          { model: bundle.runtime.model }
        );

        proc.on("event", (event: any) => {
          if (event.type === "token") {
            accumulatedText += event.data?.delta || "";
          } else if (event.type === "text" && event.part?.text) {
            accumulatedText += event.part.text;
          } else if (event.type === "tool_start" || event.type === "tool_use") {
            const toolName = event.data?.tool || event.part?.tool || "tool";
            if (!toolsCalled.includes(toolName)) {
              toolsCalled.push(toolName);
            }
          } else if (event.type === "step_finish" && event.part) {
            if (event.part.tokens) tokensConsumed = event.part.tokens;
            if (event.part.cost) costUsd = event.part.cost;
          }
        });

        proc.on("error", (err: Error) => {
          reject(err);
        });

        proc.on("closed", (code: number) => {
          exitCode = code;
          resolve();
        });

        proc.start();
      });

      // 3. Evaluate Assertions
      const assertionResults: EvalAssertionResult[] = [];
      const assertions = testCase.assertions || [];

      for (const assertion of assertions) {
        let passed = false;
        let details = "";

        if (assertion.type === "output_contains") {
          passed = accumulatedText.toLowerCase().includes(assertion.target.toLowerCase());
          details = passed ? `Output contains "${assertion.target}"` : `Output missing "${assertion.target}"`;
        } else if (assertion.type === "forbidden_pattern") {
          passed = !accumulatedText.toLowerCase().includes(assertion.target.toLowerCase());
          details = passed ? `Forbidden pattern not found` : `Found forbidden pattern "${assertion.target}"`;
        } else if (assertion.type === "expected_tool_called") {
          passed = toolsCalled.includes(assertion.target);
          details = passed ? `Tool "${assertion.target}" was called` : `Tool "${assertion.target}" was not called`;
        } else if (assertion.type === "file_exists") {
          try {
            await fs.access(path.join(env.workspacePath, assertion.target));
            passed = true;
            details = `File "${assertion.target}" exists in sandbox`;
          } catch {
            passed = false;
            details = `File "${assertion.target}" does not exist in sandbox`;
          }
        }

        assertionResults.push({ assertion, passed, details });
      }

      const allAssertionsPassed = assertionResults.every((r) => r.passed);
      const overallPassed = exitCode === 0 && allAssertionsPassed;

      return {
        testId: testCase.id,
        title: testCase.title,
        passed: overallPassed,
        durationMs: Date.now() - startTime,
        tokens: tokensConsumed,
        costUsd,
        toolsCalled,
        assertionResults,
      };
    } catch (err: any) {
      return {
        testId: testCase.id,
        title: testCase.title,
        passed: false,
        durationMs: Date.now() - startTime,
        toolsCalled,
        assertionResults: [],
        error: err.message,
      };
    } finally {
      await this.sandboxManager.cleanup(testSessionId);
    }
  }

  /**
   * Executes the entire evalSuite for an AgentBundle.
   */
  async runEvalSuite(bundle: AgentBundle): Promise<EvalTestCaseResult[]> {
    const results: EvalTestCaseResult[] = [];
    for (const testCase of bundle.evalSuite) {
      const res = await this.runTestCase(bundle, testCase);
      results.push(res);
    }
    return results;
  }
}

export const evalRunner = new EvalRunner();
