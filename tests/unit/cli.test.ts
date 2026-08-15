import { test, expect, vi } from "vitest";
import { main } from "../../src/cli";

test("CLI --help displays usage guide", async () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await main(["--help"]);
  expect(consoleLogSpy).toHaveBeenCalled();
  const output = consoleLogSpy.mock.calls.flat().join("\n");
  expect(output).toContain("OpenCode Ephemeral Orchestrator CLI");
  expect(output).toContain("serve");
  expect(output).toContain("run");
  expect(output).toContain("migrate");
  consoleLogSpy.mockRestore();
});

test("CLI --version displays version number", async () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await main(["--version"]);
  expect(consoleLogSpy).toHaveBeenCalledWith("opencode-orchestrator v1.0.0");
  consoleLogSpy.mockRestore();
});
