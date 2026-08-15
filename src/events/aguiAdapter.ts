import { Response } from "express";
import { randomUUID } from "node:crypto";
import { OpenCodeRawEvent } from "./types";

export interface SseWritable {
  write: (chunk: string) => boolean | void;
  end: () => void;
}

export class AGUIStreamAdapter {
  private currentMessageId: string | null = null;

  constructor(
    private sseRes: Response | SseWritable,
    private runId: string
  ) {}

  private sendEvent(event: string, data: Record<string, any>) {
    this.sseRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  processRawEvent(raw: OpenCodeRawEvent) {
    switch (raw.type) {
      // 1. Token / Text Events
      case "token":
        if (!this.currentMessageId) {
          this.currentMessageId = `msg_${randomUUID()}`;
          this.sendEvent("MESSAGE_START", {
            messageId: this.currentMessageId,
            role: "assistant",
            runId: this.runId,
          });
        }
        this.sendEvent("TEXT_MESSAGE_CONTENT", {
          messageId: this.currentMessageId,
          delta: raw.data.delta,
        });
        break;

      case "text":
        if (raw.part?.text) {
          if (!this.currentMessageId) {
            this.currentMessageId = raw.part.id || `msg_${randomUUID()}`;
            this.sendEvent("MESSAGE_START", {
              messageId: this.currentMessageId,
              role: "assistant",
              runId: this.runId,
            });
          }
          this.sendEvent("TEXT_MESSAGE_CONTENT", {
            messageId: this.currentMessageId,
            delta: raw.part.text,
          });
        }
        break;

      // 2. Planning & Metrics
      case "plan_update":
        this.sendEvent("STATE_DELTA", {
          path: "/todos",
          op: "replace",
          value: raw.data.todos,
        });
        break;

      case "step_finish":
        if (raw.part?.tokens || raw.part?.cost !== undefined) {
          this.sendEvent("STATE_DELTA", {
            path: "/metrics",
            op: "replace",
            value: {
              tokens: raw.part.tokens,
              cost: raw.part.cost,
            },
          });
        }
        break;

      // 3. Tool Calls
      case "tool_start":
        this.sendEvent("TOOL_CALL_START", {
          callId: raw.data.id || `call_${randomUUID()}`,
          tool: raw.data.tool,
          params: raw.data.params,
        });
        break;

      case "tool_finish":
        this.sendEvent("TOOL_CALL_RESULT", {
          callId: raw.data.id || `call_unknown`,
          result: raw.data.result,
          isError: Boolean(raw.data.isError),
        });
        break;

      case "tool_use":
        if (raw.part) {
          const callId = raw.part.callID || raw.part.id || `call_${randomUUID()}`;
          this.sendEvent("TOOL_CALL_START", {
            callId,
            tool: raw.part.tool,
            params: raw.part.state?.input || {},
          });
          if (raw.part.state?.status === "completed" || raw.part.state?.output !== undefined) {
            this.sendEvent("TOOL_CALL_RESULT", {
              callId,
              result: raw.part.state.output,
              isError: raw.part.state.status === "error",
            });
          }
        }
        break;

      // 4. Permissions & Interactions
      case "permission_request":
        this.sendEvent("INTERACTION_REQUEST", {
          interactionId: raw.data.id,
          type: "approval",
          tool: raw.data.tool,
          details: raw.data.details,
          options: ["approve", "reject"],
        });
        break;

      case "permission":
        if (raw.part) {
          this.sendEvent("INTERACTION_REQUEST", {
            interactionId: raw.part.id,
            type: "approval",
            tool: raw.part.tool,
            details: raw.part.details || {},
            options: ["approve", "reject"],
          });
        }
        break;

      case "session_compacted":
        this.sendEvent("STATE_DELTA", {
          path: "/summary",
          op: "replace",
          value: raw.data.summary,
        });
        break;

      // 5. Completion
      case "done":
        if (this.currentMessageId) {
          this.sendEvent("MESSAGE_END", { messageId: this.currentMessageId });
          this.currentMessageId = null;
        }
        this.sendEvent("RUN_FINISHED", {
          runId: this.runId,
          status: raw.data.exitCode === 0 ? "completed" : "failed",
          exitCode: raw.data.exitCode,
        });
        this.sseRes.end();
        break;
    }
  }
}
