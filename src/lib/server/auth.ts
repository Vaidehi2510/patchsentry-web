import {migrateAssurance} from './assurance-schema';
import {migrateEnterprise} from "./enterprise-schema";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink, twoFactor } from "better-auth/plugins";
import { gmailSender, gmailSecuritySender, gmailInvitationSender, gmailWeeklyReportSender, type SendWeeklyReport, type SendSignInLink, type SendSecurityCode, type SendInvitation } from "./email";
import { sendFactorCode } from './factor-delivery';
import type { Database } from "./database";

export interface AuthConfig {
  secret: string;
  origin: string;
  production: boolean;
  sendSignInLink?: SendSignInLink;
  sendSecurityCode?: SendSecurityCode;
  sendInvitation?: SendInvitation;
  cronSecret?: string;
  ledgerAllowedOrigins?: string[];
  sendWeeklyReport?: SendWeeklyReport;
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
  return { secret: env.BETTER_AUTH_SECRET, origin: url.origin, production, sendSignInLink: gmailSender(url.origin, env), sendSecurityCode:gmailSecuritySender(env), sendInvitation:gmailInvitationSender(url.origin,env),sendWeeklyReport:gmailWeeklyReportSender(url.origin,env),ledgerAllowedOrigins:(env.LEDGER_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean),cronSecret:env.CRON_SECRET };
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
    emailAndPassword: { enabled: true, disableSignUp:true, requireEmailVerification:true, minPasswordLength:12, maxPasswordLength:128, revokeSessionsOnPasswordReset:true,
      async sendResetPassword({user,url}) { if(!config.sendSignInLink)throw new Error('Email delivery unavailable');await config.sendSignInLink({email:user.email,url,purpose:'reset'}); },
    },
    plugins: [magicLink({
      expiresIn: 600,
      storeToken: "hashed",
      rateLimit: { window: 60, max: 5 },
      async sendMagicLink(message) {
        if (!config.sendSignInLink) throw new Error("Email sign-in is not configured.");
        await config.sendSignInLink(message);
      },
    }), twoFactor({issuer:'Patchsentry',skipVerificationOnEnable:false,otpOptions:{storeOTP:'hashed',period:5,allowedAttempts:5,async sendOTP({user,otp}){await sendFactorCode(database,config,user.id,user.email,otp);}},backupCodeOptions:{storeBackupCodes:'encrypted'},accountLockout:{enabled:true,maxFailedAttempts:10,durationSeconds:900}})],
    user:{changeEmail:{enabled:true,updateEmailWithoutVerification:false,async sendChangeEmailConfirmation({user,url}){if(!config.sendSignInLink)throw new Error('Email delivery unavailable');await config.sendSignInLink({email:user.email,url,purpose:'change'});}}},
    emailVerification:{expiresIn:600,autoSignInAfterVerification:false,async sendVerificationEmail({user,url}){if(!config.sendSignInLink)throw new Error('Email delivery unavailable');await config.sendSignInLink({email:user.email,url,purpose:'change'});},async afterEmailVerification(user){await database.query('DELETE FROM "session" WHERE "userId"=$1',[user.id]);await database.query('DELETE FROM qa_trusted_devices WHERE user_id=$1',[user.id]);await database.query('DELETE FROM qa_auth_challenges WHERE user_id=$1',[user.id]);await database.query('DELETE FROM verification WHERE value=$1 AND (identifier LIKE \'trust-device-%\' OR identifier LIKE \'2fa-%\')',[user.id]);}},
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/magic-link/verify": { window: 60, max: 10 },
        "/sign-in/email": {window:60,max:5},
        "/request-password-reset": {window:60,max:3},
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
  await database.query('CREATE TABLE IF NOT EXISTS qa_auth_profiles (user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,method text CHECK(method IN (\'totp\',\'email\')),pending_method text CHECK(pending_method IN (\'totp\',\'email\')))');
  await database.query('CREATE TABLE IF NOT EXISTS qa_auth_proofs (session_id text PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE,password_verified boolean NOT NULL DEFAULT false,mfa_verified boolean NOT NULL DEFAULT false)');
  await database.query('CREATE TABLE IF NOT EXISTS qa_totp_used (user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,code_hash text NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(user_id,code_hash))');
  await database.query('CREATE TABLE IF NOT EXISTS qa_auth_challenges (id text PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)');
  await database.query('CREATE TABLE IF NOT EXISTS qa_security_limits (id text PRIMARY KEY,attempts integer NOT NULL,expires_at timestamptz NOT NULL)');
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
  await database.query("CREATE TABLE IF NOT EXISTS qa_model_setup (id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,runner_id text NOT NULL,payload jsonb NOT NULL,sealed_key text,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','passed','failed','uncertain')),key_verified_at timestamptz,claim_hash text,claimed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,result jsonb)");
  await database.query('ALTER TABLE qa_runners ADD COLUMN IF NOT EXISTS setup_key text');
  await database.query("ALTER TABLE qa_auth_proofs ADD COLUMN IF NOT EXISTS device_id text");
  await database.query("ALTER TABLE qa_auth_proofs ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz");
  await database.query("CREATE TABLE IF NOT EXISTS qa_trusted_devices (id text PRIMARY KEY,user_id text NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE,agent_hash text NOT NULL,label text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL)");
  await database.query("CREATE TABLE IF NOT EXISTS qa_work_domains (project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,domain text NOT NULL,challenge text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),verified_at timestamptz)");
  await database.query("ALTER TABLE qa_work_domains ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false");
  await migrateEnterprise(database);
  await migrateAssurance(database);
  // Enforce even for an email-change confirmation issued before policy activation.
  await database.query(`CREATE OR REPLACE FUNCTION qa_guard_owner_domain() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.email IS DISTINCT FROM OLD.email AND EXISTS (SELECT 1 FROM projects p JOIN qa_work_domains d ON d.project_id=p.id WHERE p.owner_id=OLD.id AND d.restricted=true AND split_part(lower(NEW.email),'@',2)<>d.domain) THEN
      RAISE EXCEPTION 'Disable the owned project domain restriction before changing to an outside email';
    END IF;
    RETURN NEW;
  END $$`);
  await database.query('CREATE OR REPLACE TRIGGER qa_guard_owner_domain BEFORE UPDATE OF email ON "user" FOR EACH ROW EXECUTE FUNCTION qa_guard_owner_domain()');

  await database.query("ALTER TABLE qa_invites ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'manual'");
  await database.query('CREATE INDEX IF NOT EXISTS qa_model_setup_project_idx ON qa_model_setup(project_id,status,created_at)');
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS quality_version integer NOT NULL DEFAULT 0");
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS quality_brief text NOT NULL DEFAULT ''");
  await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS quality_policy jsonb");
  await database.query("CREATE TABLE IF NOT EXISTS qa_requirements (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id text NOT NULL,version integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,id))");
  await database.query("CREATE TABLE IF NOT EXISTS qa_bugs (id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,payload jsonb NOT NULL,fingerprint text NOT NULL,status text NOT NULL DEFAULT 'open',assignee text,version integer NOT NULL DEFAULT 1,decision jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,fingerprint))");
  await database.query("CREATE TABLE IF NOT EXISTS qa_evidence (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id text NOT NULL,record_id text NOT NULL,metadata jsonb NOT NULL,bytes integer NOT NULL,encrypted bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,record_id) REFERENCES qa_runs(project_id,record_id) ON DELETE CASCADE)");
  await database.query("CREATE INDEX IF NOT EXISTS qa_evidence_retention_idx ON qa_evidence(expires_at)");
  await database.query("CREATE TABLE IF NOT EXISTS qa_usage (project_id text NOT NULL,record_id text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(project_id,record_id),FOREIGN KEY(project_id,record_id) REFERENCES qa_runs(project_id,record_id) ON DELETE CASCADE)");
  await database.query("CREATE TABLE IF NOT EXISTS qa_repository_authorizations (project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,owner_id text NOT NULL,github_repository_id bigint NOT NULL,github_user_id bigint,github_login text,mode text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now())");

 await database.query("ALTER TABLE qa_jobs ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'self-hosted', ADD COLUMN IF NOT EXISTS sandbox_id text, ADD COLUMN IF NOT EXISTS callback_hash text, ADD COLUMN IF NOT EXISTS hosted_expires_at timestamptz");
 await database.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'self-hosted'");
 await database.query("CREATE SEQUENCE IF NOT EXISTS qa_provider_generation START 100000");
 await database.query("CREATE TABLE IF NOT EXISTS qa_provider_credentials (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,provider text NOT NULL,encrypted bytea NOT NULL,suffix text NOT NULL,version integer NOT NULL DEFAULT 1,verified_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,provider))");
 await database.query("CREATE TABLE IF NOT EXISTS qa_provider_probes (project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id text NOT NULL,model text NOT NULL,credential_version integer NOT NULL,status text NOT NULL,message text NOT NULL DEFAULT 'Check in progress.',created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,PRIMARY KEY(project_id,id))");

 await database.query("CREATE TABLE IF NOT EXISTS qa_automation_settings(project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,payload jsonb NOT NULL,reconcile_page integer NOT NULL DEFAULT 1,lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now())");
 await database.query("ALTER TABLE qa_automation_settings ADD COLUMN IF NOT EXISTS reconcile_page integer NOT NULL DEFAULT 1");
 await database.query("CREATE TABLE IF NOT EXISTS qa_automation_events(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,delivery_id text NOT NULL,body_hash text NOT NULL,kind text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'received',reason text NOT NULL DEFAULT '',job_id text,admitted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,delivery_id))");
 await database.query("ALTER TABLE qa_automation_events ADD COLUMN IF NOT EXISTS admitted_at timestamptz");
 await database.query("CREATE INDEX IF NOT EXISTS qa_automation_pending_idx ON qa_automation_events(project_id,status,created_at)");
 await database.query("CREATE TABLE IF NOT EXISTS qa_weekly_reports(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,period_start timestamptz NOT NULL,payload jsonb NOT NULL,email_status text NOT NULL DEFAULT 'disabled',email_claimed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,period_start))");

}
