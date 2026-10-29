import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins";
import { gmailSender, type SendSignInLink } from "./email";
import type { Database } from "./database";

export interface AuthConfig {
  secret: string;
  origin: string;
  production: boolean;
  sendSignInLink?: SendSignInLink;
}

export function authConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig | null {
  if (
    !env.BETTER_AUTH_SECRET ||
    !env.BETTER_AUTH_URL ||
    (!env.DATABASE_URL && !env.PGLITE_DATA_DIR)
  )
    return null;
  if (env.BETTER_AUTH_SECRET.length < 32)
    throw new Error(
      "BETTER_AUTH_SECRET must contain at least 32 random characters",
    );
  const url = new URL(env.BETTER_AUTH_URL);
  const production = env.NODE_ENV === "production";
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("BETTER_AUTH_URL must be an exact site origin");
  if (production && (url.protocol !== "https:" || !env.DATABASE_URL))
    throw new Error("Production requires HTTPS and DATABASE_URL");
  return { secret: env.BETTER_AUTH_SECRET, origin: url.origin, production, sendSignInLink: gmailSender(url.origin, env) };
}

export function authOptions(
  database: Database,
  config: AuthConfig,
): BetterAuthOptions {
  return {
    appName: "Patchsentry",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.secret,
    database: database as unknown as NonNullable<BetterAuthOptions["database"]>,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: false },
    plugins: [magicLink({
      expiresIn: 600,
      storeToken: "hashed",
      rateLimit: { window: 60, max: 5 },
      async sendMagicLink(message) {
        if (!config.sendSignInLink) throw new Error("Email sign-in is not configured.");
        await config.sendSignInLink(message);
      },
    })],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/magic-link/verify": { window: 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: config.production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.production,
      },
    },
    logger: { disabled: true },
  };
}

export function createAuth(database: Database, config: AuthConfig) {
  return betterAuth(authOptions(database, config));
}
export type Auth = ReturnType<typeof createAuth>;

export async function migrateDatabase(database: Database, config: AuthConfig) {
  const migrations = await getMigrations(authOptions(database, config));
  if (migrations.schemaProblems.length)
    throw new Error(
      "Authentication database schema needs review before migration",
    );
  await migrations.runMigrations();
  await database.query(`CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name text NOT NULL, repository text NOT NULL, settings jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    agent_token_hash text UNIQUE, agent_last_seen timestamptz, local_models jsonb NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE(owner_id, repository)
  )`);
  await database.query(
    "CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id)",
  );
  await database.query(`CREATE TABLE IF NOT EXISTS qa_runs (
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    record_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id, record_id)
  )`);
  await database.query(
    "CREATE INDEX IF NOT EXISTS qa_runs_project_updated_idx ON qa_runs(project_id, updated_at DESC)",
  );
  await database.query(`CREATE TABLE IF NOT EXISTS qa_test_cases (
    id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL, framework text NOT NULL, source text NOT NULL, enabled boolean NOT NULL DEFAULT false,
    sha256 text NOT NULL, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(framework IN ('node','vitest','pytest','junit','dotnet')),
    CHECK(NOT enabled OR framework='node'), CHECK(octet_length(source) <= 24000)
  )`);
  await database.query("CREATE INDEX IF NOT EXISTS qa_test_cases_project_idx ON qa_test_cases(project_id)");
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS testing_profile jsonb");
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS runner jsonb");
  // Tokens from the password-only beta carry no proof of mailbox ownership.
  // Keep those tokens unusable even after the mailbox owner verifies the account.
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS agent_email_verified boolean NOT NULL DEFAULT false");
  await database.query(`CREATE TABLE IF NOT EXISTS qa_jobs (
    id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dedupe_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0, runner_id text, lease_hash text, lease_expires_at timestamptz,
    message text NOT NULL DEFAULT '', record_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id, dedupe_key), CHECK(attempts BETWEEN 0 AND 3),
    CHECK(status IN ('queued','running','completed','blocked','failed','cancelled'))
  )`);
  await database.query("CREATE INDEX IF NOT EXISTS qa_jobs_project_queue_idx ON qa_jobs(project_id, status, created_at)");
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_settings jsonb");
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS max_parallel integer NOT NULL DEFAULT 1 CHECK(max_parallel BETWEEN 1 AND 8)");
  await database.query(`CREATE TABLE IF NOT EXISTS qa_members (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('admin','qa','viewer')),PRIMARY KEY(project_id,user_id))`);
  await database.query(`CREATE TABLE IF NOT EXISTS qa_invites (token_hash text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,email text NOT NULL,role text NOT NULL CHECK(role IN ('admin','qa','viewer')),expires_at timestamptz NOT NULL,UNIQUE(project_id,email))`);
  await database.query(`CREATE TABLE IF NOT EXISTS qa_activity (id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor text NOT NULL,action text NOT NULL,detail text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await database.query(`CREATE TABLE IF NOT EXISTS qa_runners (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id text NOT NULL,payload jsonb NOT NULL,last_seen timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,id))`);
  await database.query(`CREATE TABLE IF NOT EXISTS qa_notifications (id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,event_key text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','uncertain')),claim_hash text,claimed_at timestamptz,slack_ts text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,event_key))`);
  await database.query('CREATE INDEX IF NOT EXISTS qa_notifications_project_idx ON qa_notifications(project_id,status,created_at)');
  await database.query('CREATE TABLE IF NOT EXISTS qa_slack_threads (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,channel_id text NOT NULL,job_id text NOT NULL,ts text NOT NULL,PRIMARY KEY(project_id,channel_id,job_id))');
}
