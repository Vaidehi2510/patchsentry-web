import type { Database } from "./database";
export async function migrateAssurance(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS qa_assessment_ledger(
 id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 sequence bigint NOT NULL,event_key text NOT NULL,event_type text NOT NULL,record_id text,
 payload_digest text NOT NULL,previous_hash text NOT NULL,entry_hash text NOT NULL,
 actor_digest text NOT NULL,created_at text NOT NULL,UNIQUE(project_id,sequence),UNIQUE(project_id,event_key))`);
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_ledger_payloads(entry_id text PRIMARY KEY REFERENCES qa_assessment_ledger(id) ON DELETE CASCADE,encrypted bytea NOT NULL,expires_at timestamptz NOT NULL)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_ledger_connections(project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,origin text NOT NULL,remote_project text NOT NULL,encrypted bytea NOT NULL)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_ledger_delivery(entry_id text PRIMARY KEY REFERENCES qa_assessment_ledger(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,claimed_at timestamptz,receipt jsonb)`,
  );
  await db.query(`CREATE OR REPLACE FUNCTION qa_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RAISE EXCEPTION 'Assessment ledger entries are append-only'; END IF; RETURN OLD; END $$`);
  await db.query(
    "CREATE OR REPLACE TRIGGER qa_ledger_immutable BEFORE UPDATE OR DELETE ON qa_assessment_ledger FOR EACH ROW EXECUTE FUNCTION qa_ledger_immutable()",
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_pilot_suites(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name text NOT NULL,kind text NOT NULL,payload jsonb NOT NULL,author_id text NOT NULL,reviewer_id text,reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_pilot_observations(suite_id text NOT NULL REFERENCES qa_pilot_suites(id) ON DELETE CASCADE,case_id text NOT NULL,record_id text NOT NULL,report_digest text NOT NULL,actual_status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(suite_id,case_id))`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_assurance_policy(project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,version integer NOT NULL DEFAULT 1,payload jsonb NOT NULL)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_assurance_evidence(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,kind text NOT NULL,payload jsonb NOT NULL,author_id text NOT NULL,reviewer_id text,created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS qa_build_provenance(project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,record_id text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(project_id,record_id))`,
  );
  // Additive migration: existing acknowledgments stay visible but cannot satisfy
  // a newly enabled destination-bound policy until explicitly reconciled.
  await db.query("ALTER TABLE qa_ledger_delivery ADD COLUMN IF NOT EXISTS destination_origin text");
  await db.query("ALTER TABLE qa_ledger_delivery ADD COLUMN IF NOT EXISTS destination_project text");
  await db.query("ALTER TABLE qa_ledger_connections ADD COLUMN IF NOT EXISTS last_delivery_at timestamptz");
  await db.query("CREATE INDEX IF NOT EXISTS qa_ledger_pending ON qa_ledger_delivery(status,claimed_at)");

  await db.query("ALTER TABLE qa_jobs ADD COLUMN IF NOT EXISTS execution_context jsonb");
  await db.query("ALTER TABLE qa_ledger_delivery ADD COLUMN IF NOT EXISTS claim_id text");
  await db.query("ALTER TABLE qa_ledger_delivery ADD COLUMN IF NOT EXISTS verified_at timestamptz");

  await db.query("ALTER TABLE qa_evidence ADD COLUMN IF NOT EXISTS report_digest text");

  await db.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS quality_policy_version integer NOT NULL DEFAULT 0");

  await db.query("ALTER TABLE qa_automation_settings ADD COLUMN IF NOT EXISTS last_checked_at timestamptz");
  await db.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS notification_checked_at timestamptz");

  await db.query("CREATE TABLE IF NOT EXISTS qa_operation_health(name text PRIMARY KEY,run_id text NOT NULL,state text NOT NULL,last_started_at timestamptz NOT NULL,last_succeeded_at timestamptz,last_failed_at timestamptz,summary jsonb)");

}
