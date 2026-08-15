import { test, expect } from "vitest";
import http from "node:http";
import { app } from "../../src/index";

test("Real OpenCode execution with OpenRouter deepseek-v4-flash", async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  const sessionId = `sess_real_${Date.now()}`;
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
        });

        res.on("end", () => {
          resolve();
        });

        res.on("error", reject);
      }
    );

    req.write(
      JSON.stringify({
        model: "openrouter/deepseek/deepseek-v4-flash",
        prompt: "Reply with the exact word: OPORCH_SUCCESS",
      })
    );
    req.end();
  });

  await streamPromise;
  server.close();

  const combinedStream = sseEvents.join("");
  console.log("Real OpenCode SSE Events Output:\n", combinedStream);

  expect(combinedStream).toContain("event: MESSAGE_START");
  expect(combinedStream).toContain("event: TEXT_MESSAGE_CONTENT");
  expect(combinedStream).toContain("event: RUN_FINISHED");
  expect(combinedStream).toContain('"status":"completed"');
}, 60000);
