import { EventEmitter } from "node:events";
import { UserInteractionResolution } from "../events/types";
import { OrchestratedProcess } from "../runner/process";

export interface PendingInteraction {
  interactionId: string;
  sessionId: string;
  tool: string;
  details: Record<string, any>;
  options: string[];
  proc: OrchestratedProcess;
  createdAt: Date;
  timer?: NodeJS.Timeout;
}

export class InteractionRegistry extends EventEmitter {
  private pending = new Map<string, PendingInteraction>(); // key: sessionId
  private interactionIndex = new Map<string, string>(); // key: interactionId -> sessionId

  register(
    sessionId: string,
    interactionId: string,
    tool: string,
    details: Record<string, any>,
    proc: OrchestratedProcess,
    timeoutMs: number = 300000
  ): void {
    // Clear any previous pending interaction for this session
    this.clear(sessionId);

    const timer = setTimeout(() => {
      this.handleTimeout(sessionId, interactionId);
    }, timeoutMs);

    const pendingItem: PendingInteraction = {
      interactionId,
      sessionId,
      tool,
      details,
      options: ["approve", "reject"],
      proc,
      createdAt: new Date(),
      timer,
    };

    this.pending.set(sessionId, pendingItem);
    this.interactionIndex.set(interactionId, sessionId);
    this.emit("registered", pendingItem);
  }

  resolve(sessionId: string, resolution: UserInteractionResolution): boolean {
    const item = this.pending.get(sessionId);
    if (!item) {
      return false;
    }

    if (item.interactionId !== resolution.interactionId) {
      return false;
    }

    if (item.timer) {
      clearTimeout(item.timer);
    }

    const stdinPayload = {
      id: resolution.interactionId,
      allow: resolution.resolution === "approved",
      selection: resolution.data?.selectedOption ?? null,
      feedback: resolution.data?.feedback ?? null,
    };

    try {
      item.proc.writeStdin(stdinPayload);
    } catch (err) {
      this.emit("error", { sessionId, err });
      this.clear(sessionId);
      return false;
    }

    this.clear(sessionId);
    this.emit("resolved", { sessionId, resolution });
    return true;
  }

  getPendingBySession(sessionId: string): PendingInteraction | undefined {
    return this.pending.get(sessionId);
  }

  getPendingByInteractionId(interactionId: string): PendingInteraction | undefined {
    const sessionId = this.interactionIndex.get(interactionId);
    if (!sessionId) return undefined;
    return this.pending.get(sessionId);
  }

  clear(sessionId: string): void {
    const item = this.pending.get(sessionId);
    if (item) {
      if (item.timer) {
        clearTimeout(item.timer);
      }
      this.interactionIndex.delete(item.interactionId);
      this.pending.delete(sessionId);
    }
  }

  private handleTimeout(sessionId: string, interactionId: string): void {
    const item = this.pending.get(sessionId);
    if (item && item.interactionId === interactionId) {
      // Auto reject on timeout
      try {
        item.proc.writeStdin({
          id: interactionId,
          allow: false,
          feedback: "Interaction timed out awaiting user input.",
        });
      } catch {
        // ignore if process terminated
      }
      this.clear(sessionId);
      this.emit("timeout", { sessionId, interactionId });
    }
  }
}

export const interactionRegistry = new InteractionRegistry();
