import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type QueryResult<Row = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
  command?: string;
};
export interface Database {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  connect(): Promise<{ query: Database["query"]; release(): void }>;
  end(): Promise<void>;
  options: object;
}

/** Development/test PostgreSQL engine with one transaction-safe leased connection. */
export async function createPGliteDatabase(
  dataDir?: string,
): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir && !dataDir.includes("://"))
    await mkdir(dirname(resolve(dataDir)), { recursive: true });
  const engine = new PGlite(dataDir);
  await engine.waitReady;
  let tail = Promise.resolve();
  const query: Database["query"] = async <Row>(
    sql: string,
    values: readonly unknown[] = [],
  ) => {
    const result = await engine.query<Row>(sql, [...values]);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
      command: sql.trim().split(/\s+/)[0].toUpperCase(),
    };
  };
  const database: Database = {
    options: {},
    async connect() {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      let released = false;
      return {
        query,
        release() {
          if (!released) {
            released = true;
            release();
          }
        },
      };
    },
    async query<Row>(sql: string, values: readonly unknown[] = []) {
      const connection = await database.connect();
      try {
        return await connection.query<Row>(sql, values);
      } finally {
        connection.release();
      }
    },
    async end() {
      await tail;
      await engine.close();
    },
  };
  return database;
}

export async function createDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Database> {
  if (env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
    });
    return pool as unknown as Database;
  }
  if (env.NODE_ENV !== "production" && env.PGLITE_DATA_DIR)
    return createPGliteDatabase(env.PGLITE_DATA_DIR);
  throw new Error("Persistent database is not configured");
}
