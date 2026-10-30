import type {Database} from './database';
export async function migrateEnterprise(db:Database){
  await db.query(`CREATE TABLE IF NOT EXISTS qa_device_connections(
    project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    project_arn text NOT NULL,pool_arn text NOT NULL,encrypted bytea NOT NULL,max_daily integer NOT NULL DEFAULT 1,
    automatic boolean NOT NULL DEFAULT false)`);
  await db.query(`CREATE TABLE IF NOT EXISTS qa_device_runs(
    id text PRIMARY KEY,project_id text REFERENCES projects(id) ON DELETE CASCADE,
    request_key text NOT NULL,payload jsonb NOT NULL,status text NOT NULL,run_arn text,result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,request_key))`);

  await db.query(`CREATE TABLE IF NOT EXISTS qa_visual_candidates(
    project_id text REFERENCES projects(id) ON DELETE CASCADE,id text PRIMARY KEY,
    record_id text NOT NULL,metadata jsonb NOT NULL,encrypted bytea NOT NULL,bytes integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,record_id,id))`);
  await db.query(`CREATE TABLE IF NOT EXISTS qa_visual_baselines(
    project_id text REFERENCES projects(id) ON DELETE CASCADE,key text NOT NULL,
    candidate_id text NOT NULL,metadata jsonb NOT NULL,encrypted bytea NOT NULL,bytes integer NOT NULL,
    approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,key))`);

  await db.query("ALTER TABLE qa_jobs ADD COLUMN IF NOT EXISTS hosted_unit_result jsonb, ADD COLUMN IF NOT EXISTS hosted_visual_digest text");
  await db.query(`CREATE TABLE IF NOT EXISTS qa_sso_connections (
    project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id text NOT NULL,client_id text NOT NULL,secret bytea NOT NULL,
    generation text NOT NULL,enforced boolean NOT NULL DEFAULT false,
    scim_hash text UNIQUE,created_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`CREATE TABLE IF NOT EXISTS qa_sso_identities (
    project_id text REFERENCES projects(id) ON DELETE CASCADE,user_id text REFERENCES "user"(id) ON DELETE CASCADE,
    tenant_id text NOT NULL,object_id text NOT NULL,subject text NOT NULL,active boolean NOT NULL DEFAULT true,
    PRIMARY KEY(project_id,user_id),UNIQUE(project_id,tenant_id,object_id))`);
  await db.query("ALTER TABLE qa_sso_identities ADD COLUMN IF NOT EXISTS generation text NOT NULL DEFAULT ''");
  await db.query(`CREATE TABLE IF NOT EXISTS qa_sso_flows (
    state_hash text PRIMARY KEY,project_id text REFERENCES projects(id) ON DELETE CASCADE,
    browser_hash text NOT NULL,generation text NOT NULL,verifier text NOT NULL,nonce text NOT NULL,
    link_user text,link_session text,expires_at timestamptz NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS qa_sso_sessions (
    session_id text PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE,
    project_id text REFERENCES projects(id) ON DELETE CASCADE,generation text NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS qa_directory_users (
    id text PRIMARY KEY,project_id text REFERENCES projects(id) ON DELETE CASCADE,
    external_id text,email text NOT NULL,active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id,email),UNIQUE(project_id,external_id))`);
}
