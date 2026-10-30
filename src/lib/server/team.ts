import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { memberRoles, roleRank, SlackSettingsSchema, slackDefaults, type AccessRole } from '../team';
import { computeScore, type RunInput } from '../contracts';
import type { Database } from './database';
import { requireDomainEmail, restrictedDomain } from './domain-policy';
import { JobError } from './jobs';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export async function audit(q: Database['query'], projectId: string, actor: string, action: string, detail: string) { await q('INSERT INTO qa_activity (id,project_id,actor,action,detail) VALUES ($1,$2,$3,$4,$5)', [randomUUID(),projectId,actor.slice(0,100),action,detail.slice(0,300)]); }
export async function members(database: Database, projectId: string) {
  return (await database.query(`SELECT m.user_id AS id,m.role,u.name,u.email FROM qa_members m JOIN "user" u ON u.id=m.user_id WHERE m.project_id=$1 UNION ALL SELECT u.id,'owner' AS role,u.name,u.email FROM projects p JOIN "user" u ON u.id=p.owner_id WHERE p.id=$1 ORDER BY name`,[projectId])).rows;
}
export async function invite(database: Database, projectId: string, actor: string, role: AccessRole, body: unknown) {
  const input = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), role: z.enum(memberRoles) }).strict().safeParse(body);
  if (!input.success) throw new JobError(400,'Choose a valid email and membership role.');
  if (roleRank[role] < 2 || role === 'admin' && input.data.role === 'admin') throw new JobError(403,'Only the project owner can appoint an admin.');
  const token = randomBytes(32).toString('base64url');
  const c = await database.connect();
  try { await c.query('BEGIN'); await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);
    await requireDomainEmail(c.query.bind(c),projectId,input.data.email);
    const prior=(await c.query<{role:string}>('SELECT m.role FROM qa_members m JOIN "user" u ON u.id=m.user_id WHERE m.project_id=$1 AND lower(u.email)=$2',[projectId,input.data.email])).rows[0];
    if(prior)throw new JobError(409,'This person is already a member. Change their role in the member list instead.');
    if((await c.query('SELECT p.id FROM projects p JOIN "user" u ON u.id=p.owner_id WHERE p.id=$1 AND lower(u.email)=$2',[projectId,input.data.email])).rows.length)throw new JobError(409,'The project owner is already a member.');
    const count = await c.query<{n:string}>('SELECT (SELECT count(*) FROM qa_members WHERE project_id=$1)+(SELECT count(*) FROM qa_invites WHERE project_id=$1 AND expires_at>now()) AS n',[projectId]);
    if (Number(count.rows[0].n) >= 200) throw new JobError(409,'This product supports up to 200 members and active invitations.');
    await c.query('DELETE FROM qa_invites WHERE project_id=$1 AND email=$2',[projectId,input.data.email]);
    await c.query("INSERT INTO qa_invites (token_hash,project_id,email,role,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days')",[hash(token),projectId,input.data.email,input.data.role]);
    await audit(c.query.bind(c),projectId,actor,'member.invited',`${input.data.email} · ${input.data.role}`); await c.query('COMMIT');
    return { token, expiresInDays: 7, email:input.data.email, role:input.data.role };
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function acceptInvite(database: Database, user: {id:string;name:string;email:string}, body: unknown) {
  const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(body); if (!parsed.success) throw new JobError(400,'Use the invitation code shared by your admin.');
  const c=await database.connect(); try { await c.query('BEGIN');
    const row=(await c.query<{project_id:string;email:string;role:string}>('SELECT * FROM qa_invites WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[hash(parsed.data.token)])).rows[0];
    if (!row || row.email.toLowerCase()!==user.email.toLowerCase()) throw new JobError(404,'This invitation is unavailable for your verified email.');
    const project=(await c.query<{owner_id:string}>('SELECT owner_id FROM projects WHERE id=$1 FOR UPDATE',[row.project_id])).rows[0];
    await requireDomainEmail(c.query.bind(c),row.project_id,user.email);
    if((await c.query("SELECT user_id FROM qa_members WHERE project_id=$1 AND user_id=$2 AND role='admin'",[row.project_id,user.id])).rows.length && row.role!=='admin')throw new JobError(409,'An existing admin role cannot be replaced by this invitation.');
    if (project.owner_id!==user.id) await c.query('INSERT INTO qa_members (project_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (project_id,user_id) DO UPDATE SET role=EXCLUDED.role',[row.project_id,user.id,row.role]);
    if(row.role==='admin'){await c.query('DELETE FROM qa_trusted_devices WHERE user_id=$1',[user.id]);await c.query("DELETE FROM verification WHERE value=$1 AND identifier LIKE 'trust-device-%'",[user.id]);}
    await c.query('DELETE FROM qa_invites WHERE token_hash=$1',[hash(parsed.data.token)]); await audit(c.query.bind(c),row.project_id,user.name,'member.joined',row.role); await c.query('COMMIT'); return { projectId:row.project_id };
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function removeMember(database:Database,projectId:string,actor:string,role:AccessRole,userId:string) {
  const result=await database.query('DELETE FROM qa_members WHERE project_id=$1 AND user_id=$2 AND ($3=true OR role<>\'admin\') RETURNING user_id',[projectId,userId,role==='owner']);
  if (!result.rows.length) throw new JobError(404,'Member not found or only the owner can remove this admin.');
  await audit(database.query.bind(database),projectId,actor,'member.removed',userId); return {removed:true};
}
export async function queueNotification(q:Database['query'],projectId:string,event:string,key:string,payload:Record<string,unknown>) {
  if(await restrictedDomain(q,projectId))return;
  const project=(await q<{slack_settings:unknown}>('SELECT slack_settings FROM projects WHERE id=$1',[projectId])).rows[0];
  const settings=SlackSettingsSchema.parse(project?.slack_settings || slackDefaults);
  if (!settings.enabled || !settings.events.includes(event as never)) return;
  await q("INSERT INTO qa_notifications (id,project_id,event_key,payload) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (project_id,event_key) DO NOTHING",[randomUUID(),projectId,key,JSON.stringify({...payload,event,channelId:settings.channelId})]);
}
export function resultSummary(report:RunInput) { const score=computeScore(report); return {result:score.status,score:score.score,checks:{passed:score.passed,total:score.total,failed:score.failed,blocked:score.blocked},findings:report.findings.length,model:report.ai.model,recordId:report.recordId,people:report.people}; }
export async function claimNotification(database:Database,projectId:string,body:unknown) {
  const parsed=z.object({channelId:z.string().regex(/^[CG][A-Z0-9]{8,30}$/)}).strict().safeParse(body); if(!parsed.success)throw new JobError(400,'Provide the locally enrolled Slack channel.');
  const c=await database.connect();try{await c.query('BEGIN'); await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);
    if(await restrictedDomain(c.query.bind(c),projectId)){await c.query('COMMIT');return {notification:null};}
    await c.query("UPDATE qa_notifications SET status='uncertain' WHERE project_id=$1 AND status='sending' AND claimed_at<now()-interval '2 minutes'",[projectId]);
    const settings=(await c.query<{slack_settings:unknown}>('SELECT slack_settings FROM projects WHERE id=$1',[projectId])).rows[0]?.slack_settings;const cfg=SlackSettingsSchema.parse(settings||slackDefaults);
    if(!cfg.enabled||cfg.channelId!==parsed.data.channelId){await c.query('COMMIT');return {notification:null};}
    if((await c.query("SELECT id FROM qa_notifications WHERE project_id=$1 AND status='sending'",[projectId])).rows.length){await c.query('COMMIT');return {notification:null};}
    const row=(await c.query<{id:string;payload:Record<string,unknown>}>("SELECT id,payload FROM qa_notifications WHERE project_id=$1 AND status='pending' AND payload->>'channelId'=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE",[projectId,cfg.channelId])).rows[0];
    if(!row){await c.query('COMMIT');return {notification:null};}
    const thread=(await c.query<{ts:string}>('SELECT ts FROM qa_slack_threads WHERE project_id=$1 AND channel_id=$2 AND job_id=$3',[projectId,cfg.channelId,row.payload.jobId])).rows[0];
    const token=randomBytes(32).toString('base64url');await c.query("UPDATE qa_notifications SET status='sending',claim_hash=$2,claimed_at=now() WHERE id=$1",[row.id,hash(token)]);await c.query('COMMIT');return {notification:{id:row.id,...row.payload,...(thread ? {threadTs:thread.ts} : {})},claimToken:token};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function finishNotification(database:Database,projectId:string,id:string,body:unknown) {
  const parsed=z.object({claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),status:z.enum(['sent','uncertain']),ts:z.string().regex(/^\d+\.\d+$/).optional()}).strict().safeParse(body);if(!parsed.success)throw new JobError(400,'Invalid delivery acknowledgement.');
  const c=await database.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);
    const r=await c.query<{payload:{channelId:string;jobId:string}}>("UPDATE qa_notifications SET status=$4,slack_ts=$5 WHERE id=$1 AND project_id=$2 AND claim_hash=$3 AND status='sending' AND claimed_at>now()-interval '2 minutes' RETURNING payload",[id,projectId,hash(parsed.data.claimToken),parsed.data.status,parsed.data.ts||null]);if(!r.rows.length)throw new JobError(409,'Delivery claim expired or was already acknowledged.');
    if(parsed.data.status==='sent' && parsed.data.ts)await c.query('INSERT INTO qa_slack_threads (project_id,channel_id,job_id,ts) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[projectId,r.rows[0].payload.channelId,r.rows[0].payload.jobId,parsed.data.ts]);
    await c.query('COMMIT');return {ok:true};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function changeMemberRole(database:Database,projectId:string,actor:string,actingRole:AccessRole,userId:string,body:unknown){const parsed=z.object({role:z.enum(memberRoles)}).strict().safeParse(body);if(!parsed.success)throw new JobError(400,'Choose Admin, QA engineer or Viewer.');const c=await database.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);const member=(await c.query<{role:string}>('SELECT role FROM qa_members WHERE project_id=$1 AND user_id=$2 FOR UPDATE',[projectId,userId])).rows[0];if(!member)throw new JobError(404,'Member not found. The project owner cannot be changed here.');if(roleRank[actingRole]<2||actingRole!=='owner'&&(member.role==='admin'||parsed.data.role==='admin'))throw new JobError(403,'Only the project owner can appoint or change an admin.');await c.query('UPDATE qa_members SET role=$3 WHERE project_id=$1 AND user_id=$2',[projectId,userId,parsed.data.role]);if(parsed.data.role==='admin'){await c.query('DELETE FROM qa_trusted_devices WHERE user_id=$1',[userId]);await c.query("DELETE FROM verification WHERE value=$1 AND identifier LIKE 'trust-device-%'",[userId]);}await audit(c.query.bind(c),projectId,actor,'member.role_changed',`${userId} · ${member.role} → ${parsed.data.role}`);await c.query('COMMIT');return {role:parsed.data.role};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
