// OpenCode Engine Raw stdout Events
export type OpenCodeRawEvent =
  | { type: "token"; data: { delta: string } }
  | { type: "plan_update"; data: { todos: Array<{ id: string; text: string; status: "pending" | "in_progress" | "completed" }> } }
  | { type: "tool_start"; data: { id?: string; tool: string; params: Record<string, any> } }
  | { type: "tool_finish"; data: { id?: string; tool: string; result: any; isError?: boolean } }
  | { type: "permission_request"; data: { id: string; tool: string; details: Record<string, any> } }
  | { type: "session_compacted"; data: { summary: string } }
  | { type: "done"; data: { exitCode: number } };

// AG-UI Protocol SSE Payloads
export type AGUIEvent =
  | { event: "MESSAGE_START"; data: { messageId: string; role: "assistant"; runId: string } }
  | { event: "TEXT_MESSAGE_CONTENT"; data: { messageId: string; delta: string } }
  | { event: "MESSAGE_END"; data: { messageId: string } }
  | { event: "STATE_DELTA"; data: { path: string; op: "replace" | "add"; value: any } }
  | { event: "TOOL_CALL_START"; data: { callId: string; tool: string; params: Record<string, any> } }
  | { event: "TOOL_CALL_RESULT"; data: { callId: string; result: any; isError: boolean } }
  | { event: "INTERACTION_REQUEST"; data: { interactionId: string; type: string; tool: string; details: Record<string, any>; options: string[] } }
  | { event: "RUN_FINISHED"; data: { runId: string; status: "completed" | "failed"; exitCode: number } };

export interface UserInteractionResolution {
  interactionId: string;
  resolution: "approved" | "rejected" | "custom_input";
  data?: {
    selectedOption?: string;
    feedback?: string;
  };
}

export interface Tenant {
  id: string;
  name: string;
  createdAt?: Date;
}

export interface Session {
  id: string;
  tenantId: string;
  title?: string;
  status: "idle" | "running" | "waiting_for_interaction" | "completed" | "failed";
  latestSummary?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChatEventRecord {
  id?: number;
  sessionId: string;
  turnIndex: number;
  eventType: string;
  payload: Record<string, any>;
  createdAt?: Date;
}
