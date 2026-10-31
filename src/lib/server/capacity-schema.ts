import type {Database} from './database';
export async function migrateCapacity(db:Database){
 await db.query("CREATE TABLE IF NOT EXISTS qa_hosted_pool(id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL,payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
 await db.query("CREATE TABLE IF NOT EXISTS qa_hosted_tenants(tenant_key text PRIMARY KEY,version integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,last_dispatched_at timestamptz)");
 await db.query('CREATE TABLE IF NOT EXISTS qa_hosted_tenant_members(owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,tenant_key text NOT NULL REFERENCES qa_hosted_tenants(tenant_key))');
 await db.query("CREATE TABLE IF NOT EXISTS qa_hosted_reservations(job_id text PRIMARY KEY,tenant_key text NOT NULL,project_id text NOT NULL,period timestamptz NOT NULL,reserved_cpu_seconds bigint NOT NULL,reserved_memory_gb_seconds bigint NOT NULL,reserved_infra_usd numeric NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),release_after timestamptz NOT NULL,released_at timestamptz,finish_status text,wall_ms bigint,vm_stages integer NOT NULL,policy_version integer NOT NULL)");
 await db.query("ALTER TABLE qa_hosted_reservations ADD COLUMN IF NOT EXISTS tenant_version integer NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS tenant_limits jsonb,ADD COLUMN IF NOT EXISTS pool_policy jsonb");
 await db.query("CREATE INDEX IF NOT EXISTS qa_hosted_reservation_period ON qa_hosted_reservations(period,tenant_key)");
 await db.query("ALTER TABLE qa_jobs ADD COLUMN IF NOT EXISTS capacity_mode text NOT NULL DEFAULT 'legacy',ADD COLUMN IF NOT EXISTS queue_expires_at timestamptz,ADD COLUMN IF NOT EXISTS hosted_started_at timestamptz");
 await db.query("CREATE INDEX IF NOT EXISTS qa_hosted_fair_queue ON qa_jobs(capacity_mode,status,created_at) WHERE execution_mode='hosted'");
 await db.query("CREATE TABLE IF NOT EXISTS qa_hosted_stages(id text PRIMARY KEY,job_id text NOT NULL,status text NOT NULL,vm_id text,started_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz)");
 await db.query("CREATE INDEX IF NOT EXISTS qa_hosted_stage_job ON qa_hosted_stages(job_id)");

 await db.query('CREATE TABLE IF NOT EXISTS qa_enterprise_profiles(project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,version integer NOT NULL,payload jsonb NOT NULL,configuration_digest text NOT NULL,approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now())');

}
