import { test, expect } from "vitest";
import http from "node:http";
import { app } from "../../src/index";

test("E2E SSE stream with approval interaction flow", async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  const sessionId = `sess_e2e_${Date.now()}`;

  // Mock script for child process
  const mockScript = `
    console.log(JSON.stringify({ type: "token", data: { delta: "Starting task... " } }));
    console.log(JSON.stringify({ type: "plan_update", data: { todos: [{ id: "t1", text: "Do step 1", status: "completed" }] } }));
    console.log(JSON.stringify({ type: "permission_request", data: { id: "perm_e2e_1", tool: "deploy", details: { env: "prod" } } }));
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const parsed = JSON.parse(line);
      if (parsed.allow) {
        console.log(JSON.stringify({ type: "token", data: { delta: "Deploy succeeded!" } }));
        console.log(JSON.stringify({ type: "session_compacted", data: { summary: "Deployed to prod" } }));
        setTimeout(() => {
          process.exit(0);
        }, 50);
      } else {
        process.exit(1);
      }
    });
  `;

  // Start SSE request
  const sseEvents: string[] = [];

  const streamPromise = new Promise<void>((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/api/v1/sessions/${sessionId}/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.on("data", (chunk) => {
          const text = chunk.toString();
          sseEvents.push(text);

          if (text.includes("INTERACTION_REQUEST") && text.includes("perm_e2e_1")) {
            // Trigger approval via HTTP POST
            const postReq = http.request(
              `${baseUrl}/api/v1/sessions/${sessionId}/interactions`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              },
              (postRes) => {
                expect(postRes.statusCode).toBe(200);
              }
            );
            postReq.write(
              JSON.stringify({
                interactionId: "perm_e2e_1",
                resolution: "approved",
                data: { feedback: "approved by e2e test" },
              })
            );
            postReq.end();
          }
        });

        res.on("end", () => {
          resolve();
        });

        res.on("error", reject);
      }
    );

    req.write(
      JSON.stringify({
        binaryPath: "node",
        prompt: `-e '${mockScript}'`,
        taskConfig: { test: true },
      })
    );
    req.end();
  });

  await streamPromise;
  server.close();

  const combinedStream = sseEvents.join("");

  expect(combinedStream).toContain("event: MESSAGE_START");
  expect(combinedStream).toContain("event: TEXT_MESSAGE_CONTENT");
  expect(combinedStream).toContain("Starting task...");
  expect(combinedStream).toContain("event: STATE_DELTA");
  expect(combinedStream).toContain("/todos");
  expect(combinedStream).toContain("event: INTERACTION_REQUEST");
  expect(combinedStream).toContain("perm_e2e_1");
  expect(combinedStream).toContain("Deploy succeeded!");
  expect(combinedStream).toContain("event: STATE_DELTA");
  expect(combinedStream).toContain("Deployed to prod");
  expect(combinedStream).toContain("event: RUN_FINISHED");
  expect(combinedStream).toContain('"status":"completed"');
});
