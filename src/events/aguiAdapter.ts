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

      case "plan_update":
        this.sendEvent("STATE_DELTA", {
          path: "/todos",
          op: "replace",
          value: raw.data.todos,
        });
        break;

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

      case "permission_request":
        this.sendEvent("INTERACTION_REQUEST", {
          interactionId: raw.data.id,
          type: "approval",
          tool: raw.data.tool,
          details: raw.data.details,
          options: ["approve", "reject"],
        });
        break;

      case "session_compacted":
        this.sendEvent("STATE_DELTA", {
          path: "/summary",
          op: "replace",
          value: raw.data.summary,
        });
        break;

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
