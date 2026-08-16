import { query } from "./client";
import { AgentBundle, AgentTemplateRecord } from "../agent-factory/types";

export class AgentStore {
  /**
   * Saves or updates an AgentBundle template in the database.
   */
  async saveAgentTemplate(bundle: AgentBundle, owner: string = "platform_team"): Promise<AgentTemplateRecord> {
    const id = `tpl_${bundle.name}_${bundle.version.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const tags = bundle.tags || [];

    const sql = `
      INSERT INTO agent_templates (id, name, version, owner, description, bundle_json, tags, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (name, version) DO UPDATE SET
        owner = EXCLUDED.owner,
        description = EXCLUDED.description,
        bundle_json = EXCLUDED.bundle_json,
        tags = EXCLUDED.tags,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id, 
        name, 
        version, 
        owner, 
        description, 
        bundle_json AS "bundleJson", 
        tags, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
    `;

    const res = await query<AgentTemplateRecord>(sql, [
      id,
      bundle.name,
      bundle.version,
      owner,
      bundle.description || "",
      JSON.stringify(bundle),
      tags,
    ]);

    return res.rows[0];
  }

  /**
   * Retrieves an agent template by name and optional version (defaults to latest by semver / update time).
   */
  async getAgentTemplate(name: string, version?: string): Promise<AgentTemplateRecord | null> {
    try {
      let sql: string;
      let params: any[];

      if (version && version !== "latest") {
        sql = `
          SELECT 
            id, 
            name, 
            version, 
            owner, 
            description, 
            bundle_json AS "bundleJson", 
            tags, 
            created_at AS "createdAt", 
            updated_at AS "updatedAt"
          FROM agent_templates
          WHERE name = $1 AND version = $2
        `;
        params = [name, version];
      } else {
        sql = `
          SELECT 
            id, 
            name, 
            version, 
            owner, 
            description, 
            bundle_json AS "bundleJson", 
            tags, 
            created_at AS "createdAt", 
            updated_at AS "updatedAt"
          FROM agent_templates
          WHERE name = $1
          ORDER BY updated_at DESC
          LIMIT 1
        `;
        params = [name];
      }

      const res = await query<AgentTemplateRecord>(sql, params);
      return res.rows[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Lists all published agent templates with trust telemetry stats.
   */
  async listAgentTemplates(tag?: string): Promise<AgentTemplateRecord[]> {
    try {
      let sql = `
        SELECT 
          id, 
          name, 
          version, 
          owner, 
          description, 
          bundle_json AS "bundleJson", 
          tags, 
          created_at AS "createdAt", 
          updated_at AS "updatedAt"
        FROM agent_templates
      `;
      const params: any[] = [];

      if (tag) {
        sql += ` WHERE $1 = ANY(tags)`;
        params.push(tag);
      }

      sql += ` ORDER BY name ASC, updated_at DESC`;

      const res = await query<AgentTemplateRecord>(sql, params);
      return res.rows;
    } catch {
      return [];
    }
  }

  /**
   * Deletes an agent template by name and version.
   */
  async deleteAgentTemplate(name: string, version?: string): Promise<boolean> {
    try {
      if (version) {
        const res = await query(`DELETE FROM agent_templates WHERE name = $1 AND version = $2`, [name, version]);
        return (res.rowCount ?? 0) > 0;
      } else {
        const res = await query(`DELETE FROM agent_templates WHERE name = $1`, [name]);
        return (res.rowCount ?? 0) > 0;
      }
    } catch {
      return false;
    }
  }
}

export const agentStore = new AgentStore();
