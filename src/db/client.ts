import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";
import { config } from "../config";
import fs from "node:fs/promises";
import path from "node:path";

let pool: Pool | null = null;

export function getPoolConfig(): PoolConfig {
  const baseOptions = {
    max: parseInt(process.env.DB_POOL_MAX || "20", 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || "30000", 10),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT_MS || "5000", 10),
  };

  if (config.databaseUrl) {
    return {
      ...baseOptions,
      connectionString: config.databaseUrl,
      ssl: config.pg.ssl ? { rejectUnauthorized: false } : undefined,
    };
  }

  return {
    ...baseOptions,
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
      console.error("[PostgreSQL Pool] Unexpected error on idle client:", err.message);
    });
  }
  return pool;
}

export function getPoolStats(): { totalCount: number; idleCount: number; waitingCount: number } {
  if (!pool) {
    return { totalCount: 0, idleCount: 0, waitingCount: 0 };
  }
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
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
