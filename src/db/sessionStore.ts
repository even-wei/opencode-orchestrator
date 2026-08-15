import { query } from "./client";
import { Tenant, Session, ChatEventRecord } from "../events/types";
import { config } from "../config";

export class SessionStore {
  async ensureTenant(id: string, name: string): Promise<Tenant> {
    const res = await query<Tenant>(
      `INSERT INTO tenants (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, created_at AS "createdAt"`,
      [id, name]
    );
    return res.rows[0];
  }

  async getTenant(id: string): Promise<Tenant | null> {
    const res = await query<Tenant>(
      `SELECT id, name, created_at AS "createdAt" FROM tenants WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async createSession(id: string, tenantId: string, title?: string): Promise<Session> {
    const res = await query<Session>(
      `INSERT INTO sessions (id, tenant_id, title, status)
       VALUES ($1, $2, $3, 'idle')
       ON CONFLICT (id) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, sessions.title),
         updated_at = CURRENT_TIMESTAMP
       RETURNING 
         id, 
         tenant_id AS "tenantId", 
         title, 
         status, 
         latest_summary AS "latestSummary", 
         created_at AS "createdAt", 
         updated_at AS "updatedAt"`,
      [id, tenantId, title || null]
    );
    return res.rows[0];
  }

  async getSession(id: string): Promise<Session | null> {
    const res = await query<Session>(
      `SELECT 
         id, 
         tenant_id AS "tenantId", 
         title, 
         status, 
         latest_summary AS "latestSummary", 
         created_at AS "createdAt", 
         updated_at AS "updatedAt"
       FROM sessions 
       WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async updateSessionStatus(
    id: string,
    status: Session["status"]
  ): Promise<void> {
    await query(
      `UPDATE sessions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, id]
    );
  }

  async updateSessionSummary(id: string, summary: string): Promise<void> {
    await query(
      `UPDATE sessions SET latest_summary = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [summary, id]
    );
  }

  async recordChatEvent(
    sessionId: string,
    turnIndex: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<ChatEventRecord> {
    const res = await query<ChatEventRecord>(
      `INSERT INTO chat_events (session_id, turn_index, event_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING 
         id, 
         session_id AS "sessionId", 
         turn_index AS "turnIndex", 
         event_type AS "eventType", 
         payload, 
         created_at AS "createdAt"`,
      [sessionId, turnIndex, eventType, JSON.stringify(payload)]
    );
    return res.rows[0];
  }

  async getNextTurnIndex(sessionId: string): Promise<number> {
    const res = await query<{ maxTurn: number | null }>(
      `SELECT MAX(turn_index) AS "maxTurn" FROM chat_events WHERE session_id = $1`,
      [sessionId]
    );
    const maxTurn = res.rows[0]?.maxTurn;
    return maxTurn !== null && maxTurn !== undefined ? maxTurn + 1 : 1;
  }

  async getRecentChatEvents(
    sessionId: string,
    limit: number = 20
  ): Promise<ChatEventRecord[]> {
    const res = await query<ChatEventRecord>(
      `SELECT 
         id, 
         session_id AS "sessionId", 
         turn_index AS "turnIndex", 
         event_type AS "eventType", 
         payload, 
         created_at AS "createdAt"
       FROM chat_events
       WHERE session_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return res.rows.reverse();
  }

  /**
   * Rehydrates context by combining latest summary and previous K turns from PostgreSQL.
   */
  async rehydrateContext(
    sessionId: string,
    currentTurnPrompt: string,
    maxTurns: number = config.defaultContextTurns
  ): Promise<string> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return currentTurnPrompt;
    }

    const sections: string[] = [];

    // 1. Prior Session Summary
    if (session.latestSummary && session.latestSummary.trim().length > 0) {
      sections.push(`=== PREVIOUS SESSION SUMMARY ===\n${session.latestSummary.trim()}`);
    }

    // 2. Recent Message turns & events
    const events = await this.getRecentChatEvents(sessionId, maxTurns * 10);
    if (events.length > 0) {
      const formattedTurns: string[] = [];
      // Group by turn_index
      const turnMap = new Map<number, ChatEventRecord[]>();
      for (const ev of events) {
        if (!turnMap.has(ev.turnIndex)) {
          turnMap.set(ev.turnIndex, []);
        }
        turnMap.get(ev.turnIndex)!.push(ev);
      }

      const sortedTurnKeys = Array.from(turnMap.keys()).sort((a, b) => a - b).slice(-maxTurns);
      for (const turn of sortedTurnKeys) {
        const turnEvents = turnMap.get(turn)!;
        const turnLines: string[] = [];
        for (const ev of turnEvents) {
          if (ev.eventType === "user_prompt") {
            turnLines.push(`User: ${ev.payload.prompt || JSON.stringify(ev.payload)}`);
          } else if (ev.eventType === "assistant_response" || ev.eventType === "token") {
            turnLines.push(`Assistant: ${ev.payload.text || ev.payload.delta || JSON.stringify(ev.payload)}`);
          } else if (ev.eventType === "tool_finish") {
            turnLines.push(`Tool [${ev.payload.tool}]: ${JSON.stringify(ev.payload.result)}`);
          } else if (ev.eventType === "session_compacted") {
            turnLines.push(`Summary: ${ev.payload.summary}`);
          }
        }
        if (turnLines.length > 0) {
          formattedTurns.push(`[Turn ${turn}]\n${turnLines.join("\n")}`);
        }
      }

      if (formattedTurns.length > 0) {
        sections.push(`=== RECENT CONVERSATION HISTORY ===\n${formattedTurns.join("\n\n")}`);
      }
    }

    // 3. Current Turn Prompt
    sections.push(`=== CURRENT TASK ===\n${currentTurnPrompt}`);

    return sections.join("\n\n");
  }
}

export const sessionStore = new SessionStore();
