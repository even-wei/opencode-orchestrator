import { test, expect } from "vitest";
import { OrchestratedProcess } from "../../src/runner/process";
import { SandboxManager } from "../../src/runner/sandbox";
import { interactionRegistry } from "../../src/interactive/interactionRegistry";

test("halts when permission is required and unblocks when input is written to stdin", async () => {
  const sandbox = new SandboxManager();
  const env = await sandbox.provision({
    sessionId: "interactive_test",
    taskConfig: {},
    skills: [],
  });

  // Mock script that asks for permission and waits for stdin response
  const mockScript = `
    console.log(JSON.stringify({ type: "permission_request", data: { id: "act_1", tool: "bash", details: { cmd: "ls" } } }));
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const parsed = JSON.parse(line);
      if (parsed.allow) {
        console.log(JSON.stringify({ type: "token", data: { delta: "Execution approved." } }));
        process.exit(0);
      } else {
        process.exit(1);
      }
    });
  `;

  const proc = new OrchestratedProcess("node", `-e '${mockScript}'`, env, "user_test");

  let receivedApproval = false;
  let receivedSuccessToken = false;

  proc.on("event", (evt) => {
    if (evt.type === "permission_request") {
      receivedApproval = true;
      proc.writeStdin({ id: evt.data.id, allow: true });
    }
    if (evt.type === "token" && evt.data.delta === "Execution approved.") {
      receivedSuccessToken = true;
    }
  });

  proc.start();

  await new Promise((resolve) => proc.on("closed", resolve));

  expect(receivedApproval).toBe(true);
  expect(receivedSuccessToken).toBe(true);

  await sandbox.cleanup("interactive_test");
});

test("interactionRegistry manages and resolves pending requests", async () => {
  const sandbox = new SandboxManager();
  const sessionId = "sess_registry_test";
  const env = await sandbox.provision({
    sessionId,
    taskConfig: {},
    skills: [],
  });

  const mockScript = `
    console.log(JSON.stringify({ type: "permission_request", data: { id: "perm_100", tool: "file_write", details: { path: "test.txt" } } }));
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const parsed = JSON.parse(line);
      if (parsed.allow && parsed.feedback === "looks good") {
        console.log(JSON.stringify({ type: "token", data: { delta: "All good" } }));
        process.exit(0);
      } else {
        process.exit(1);
      }
    });
  `;

  const proc = new OrchestratedProcess("node", `-e '${mockScript}'`, env, "user_test");

  let resolved = false;

  proc.on("event", (evt) => {
    if (evt.type === "permission_request") {
      interactionRegistry.register(sessionId, evt.data.id, evt.data.tool, evt.data.details, proc, 5000);
      
      const pending = interactionRegistry.getPendingBySession(sessionId);
      expect(pending).toBeDefined();
      expect(pending?.interactionId).toBe("perm_100");

      resolved = interactionRegistry.resolve(sessionId, {
        interactionId: "perm_100",
        resolution: "approved",
        data: { feedback: "looks good" },
      });
    }
  });

  proc.start();

  await new Promise((resolve) => proc.on("closed", resolve));

  expect(resolved).toBe(true);
  expect(interactionRegistry.getPendingBySession(sessionId)).toBeUndefined();

  await sandbox.cleanup(sessionId);
});
