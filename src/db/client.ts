import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";
import { config } from "../config";
import fs from "node:fs/promises";
import path from "node:path";

let pool: Pool | null = null;

export function getPoolConfig(): PoolConfig {
  if (config.databaseUrl) {
    return {
      connectionString: config.databaseUrl,
      ssl: config.pg.ssl ? { rejectUnauthorized: false } : undefined,
    };
  }

  return {
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    ssl: config.pg.ssl ? { rejectUnauthorized: false } : undefined,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    pool.on("error", (err) => {
      console.error("Unexpected error on idle PostgreSQL client:", err);
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const p = getPool();
  return p.query<T>(text, params);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function applySchema(schemaFilePath?: string): Promise<void> {
  const filePath = schemaFilePath || path.resolve(__dirname, "../../schema.sql");
  const sql = await fs.readFile(filePath, "utf-8");
  const p = getPool();
  await p.query(sql);
}
