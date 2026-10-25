import type { Pool, PoolClient } from 'pg'
import type { NotificationPort } from '@/ports/NotificationPort'
import type { ExpenseDecisionEvent } from '@/ports/ExpenseDecisionPort'
import type { CurrentActor } from '@/lib/current-actor'

/** Call only from HA-03's extendTransaction with its same client and recorded event. */
export async function enqueueDecisionNotification(client: PoolClient, event: ExpenseDecisionEvent): Promise<void> {
  await client.query(`INSERT INTO public.decision_notification_outbox
    (event_id, company_id, recipient_id, expense_id, decision)
    SELECT h.id, h.company_id, en.user_id, en.id, h.to_status
    FROM public.expense_decision_history h JOIN public.expense_notes en ON en.id=h.expense_note_id
    JOIN public.users owner ON owner.id=en.user_id
    WHERE h.id=$1 AND en.id=$2 AND owner.id=$3 AND owner.company_id=$4
      AND h.company_id=$4 AND h.to_status=$5 AND en.status=h.to_status
    ON CONFLICT (event_id) DO NOTHING`, [event.id, event.expenseId, event.ownerId, event.companyId, event.toStatus])
  const recorded = await client.query(`SELECT 1 FROM public.decision_notification_outbox
    WHERE event_id=$1 AND expense_id=$2 AND recipient_id=$3 AND company_id=$4 AND decision=$5`,
  [event.id, event.expenseId, event.ownerId, event.companyId, event.toStatus])
  if (!recorded.rows[0]) throw new Error('The decision notification intent could not be recorded.')
}

/** Database-only channel; a real inbox row and acknowledgement share one transaction. */
export class PostgresInAppNotificationAdapter implements NotificationPort {
  private readonly client: PoolClient
  constructor(client: PoolClient) { this.client = client }
  async notifyDecision(userId: string, noteId: string, decision: 'approved' | 'rejected', context?: Readonly<{ eventId: string }>) {
    if (!context?.eventId || !['approved','rejected'].includes(decision)) throw new Error('The notification event is invalid.')
    await this.client.query(`INSERT INTO public.decision_inbox (event_id, recipient_id, company_id, expense_id, decision)
      SELECT o.event_id, o.recipient_id, o.company_id, o.expense_id, o.decision
      FROM public.decision_notification_outbox o JOIN public.users owner ON owner.id=o.recipient_id
      JOIN public.expense_notes en ON en.id=o.expense_id AND en.user_id=owner.id
      WHERE o.event_id=$1 AND o.recipient_id=$2 AND o.expense_id=$3 AND o.decision=$4 AND owner.company_id=o.company_id
      ON CONFLICT (event_id,recipient_id) DO NOTHING`, [context.eventId, userId, noteId, decision])
    const visible = await this.client.query(`SELECT 1 FROM public.decision_inbox n JOIN public.users owner ON owner.id=n.recipient_id
      JOIN public.expense_notes en ON en.id=n.expense_id AND en.user_id=owner.id
      WHERE n.event_id=$1 AND n.recipient_id=$2 AND n.expense_id=$3 AND n.decision=$4 AND owner.company_id=n.company_id`,
    [context.eventId, userId, noteId, decision])
    if (!visible.rows[0]) throw new Error('The notification recipient is unavailable.')
  }
}

export type RetryPolicy = Readonly<{ maxAttempts: number; retryDelaySeconds: number }>

/** One bounded reservation; PostgreSQL releases its lock on connection loss.
 * No network call, long-lived lease, global pool or administrator fallback.
 */
export async function deliverOneDecisionNotification(pool: Pick<Pool, 'connect'>, policy: RetryPolicy) {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 10 ||
    !Number.isInteger(policy.retryDelaySeconds) || policy.retryDelaySeconds < 0 || policy.retryDelaySeconds > 3600) throw new Error('Invalid notification retry policy.')
  let client
  try { client = await pool.connect() } catch { throw new Error('The notification worker is unavailable.') }
  let transaction = false
  try {
    await client.query('BEGIN'); transaction = true
    await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='10s'")
    const selected = await client.query<{ event_id: string; recipient_id: string; expense_id: string; decision: 'approved' | 'rejected'; attempts: number }>(
      `SELECT event_id, recipient_id, expense_id, decision, attempts FROM public.decision_notification_outbox
       WHERE state='pending' AND next_attempt_at<=clock_timestamp()
       ORDER BY created_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    )
    const event = selected.rows[0]
    if (!event) { await client.query('COMMIT'); transaction = false; return { outcome: 'idle' as const } }
    if (event.attempts >= policy.maxAttempts) {
      await client.query("UPDATE public.decision_notification_outbox SET state='failed' WHERE event_id=$1", [event.event_id])
      await client.query('COMMIT'); transaction = false; return { outcome: 'failed' as const, eventId: event.event_id }
    }
    await client.query('UPDATE public.decision_notification_outbox SET attempts=attempts+1 WHERE event_id=$1', [event.event_id])
    await client.query('SAVEPOINT inbox_delivery')
    let outcome: 'delivered' | 'retry' | 'failed' = 'delivered'
    try {
      await new PostgresInAppNotificationAdapter(client).notifyDecision(event.recipient_id, event.expense_id, event.decision, { eventId: event.event_id })
      await client.query("UPDATE public.decision_notification_outbox SET state='delivered', delivered_at=clock_timestamp(), last_failure_code=NULL WHERE event_id=$1", [event.event_id])
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT inbox_delivery')
      outcome = event.attempts + 1 >= policy.maxAttempts ? 'failed' : 'retry'
      await client.query(`UPDATE public.decision_notification_outbox SET state=$2,
        next_attempt_at=clock_timestamp()+$3::int*interval '1 second', last_failure_code='delivery_failed'
        WHERE event_id=$1`, [event.event_id, outcome === 'failed' ? 'failed' : 'pending', policy.retryDelaySeconds])
    }
    await client.query('COMMIT'); transaction = false
    return { outcome, eventId: event.event_id }
  } catch {
    if (transaction) {
      try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined }
    }
    throw new Error('The notification worker could not complete this attempt.')
  } finally { client?.release() }
}

export async function readDecisionInbox(client: PoolClient, actor: CurrentActor) {
  const result = await client.query<{ event_id: string; expense_id: string; decision: string; created_at: Date; read_at: Date | null }>(
    `SELECT n.event_id,n.expense_id,n.decision,n.created_at,n.read_at FROM public.decision_inbox n
     JOIN public.users recipient ON recipient.id=n.recipient_id JOIN public.expense_notes en ON en.id=n.expense_id AND en.user_id=recipient.id
     WHERE recipient.id=$1 AND recipient.company_id=$2 AND recipient.is_active AND n.company_id=$2
     ORDER BY n.created_at DESC,n.event_id DESC LIMIT 50`, [actor.id, actor.companyId],
  )
  return result.rows.map(row => ({ eventId: row.event_id, expenseId: row.expense_id, decision: row.decision, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }))
}

/** Current-rights inbox command; caller supplies the current authenticated actor/client.
 * First-read time is server-side and immutable under retries. This marks only a
 * currently visible notification and never changes a decision/delivery state.
 */
export async function markDecisionInboxRead(client: PoolClient, actor: CurrentActor, eventId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId)) return null
  const result = await client.query<{ event_id: string; read_at: Date }>(
    `UPDATE public.decision_inbox n SET read_at=coalesce(n.read_at,clock_timestamp())
     FROM public.users recipient,public.expense_notes en
     WHERE n.event_id=$1 AND n.recipient_id=$2 AND n.company_id=$3
       AND recipient.id=n.recipient_id AND recipient.company_id=$3 AND recipient.is_active
       AND en.id=n.expense_id AND en.user_id=recipient.id
     RETURNING n.event_id,n.read_at`, [eventId,actor.id,actor.companyId],
  )
  const row = result.rows[0]
  return row ? { eventId: row.event_id, readAt: row.read_at.toISOString() } : null
}

/** Future operator capability; the caller supplies the authenticated server ID. */
export async function requeueFailedDecisionNotification(client: PoolClient, eventId: string, actor: CurrentActor): Promise<boolean> {
  if (actor.role !== 'hr_admin') return false
  const result = await client.query(`UPDATE public.decision_notification_outbox o SET state='pending', attempts=0, next_attempt_at=clock_timestamp(), last_failure_code=NULL
    WHERE o.event_id=$1 AND o.state='failed' AND o.company_id=$2 AND EXISTS (
      SELECT 1 FROM public.users current_actor WHERE current_actor.id=$3 AND current_actor.company_id=$2 AND current_actor.is_active AND current_actor.role='hr_admin'
    ) RETURNING event_id`, [eventId, actor.companyId, actor.id])
  return result.rows.length === 1
}

/** A separately provisioned worker identity, never the migration/web connection. */
export async function assertNotificationWorker(pool: Pick<Pool,'query'>) {
  try {
    const {rows:[role]} = await pool.query(`SELECT current_user AS role,session_user AS login,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit,
      (SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
      has_column_privilege('public.users','password_hash','SELECT') AS passwords,
      has_column_privilege('public.expense_notes','receipt_key','SELECT') AS receipts,
      has_any_column_privilege('public.expense_notes','UPDATE') AS can_decide,
      has_schema_privilege('public','CREATE') AS schema_create,
      has_database_privilege(current_database(),'CREATE') AS database_create,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid) AS owned,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(n.oid,'USAGE') AND has_function_privilege(p.oid,'EXECUTE')) AS unsafe_definer
      FROM pg_roles r WHERE r.rolname=current_user`)
    if (!role || role.role!=='expense_notifications' || role.login!=='expense_notifications' || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolinherit || role.memberships || role.passwords || role.receipts || role.can_decide || role.schema_create || role.database_create || role.owned || role.unsafe_definer) throw new Error('invalid worker')
  } catch { throw new Error('Use the separately provisioned limited notification worker connection.') }
}

export async function notificationInbox(client: PoolClient, actor: CurrentActor) {
  const result=await client.query<{event_id:string;expense_id:string;decision:'approved'|'rejected'|null;kind:'decision'|'assignment';expense_status:'pending'|'approved'|'rejected';created_at:Date;read_at:Date|null}>(`
    SELECT event_id,expense_id,decision,'decision'::text AS kind,decision AS expense_status,created_at,read_at FROM public.decision_inbox WHERE recipient_id=$1 AND company_id=$2
    UNION ALL
    SELECT n.event_id,n.expense_id,NULL::text,'assignment'::text,en.status,n.created_at,n.read_at FROM public.assignment_inbox n JOIN public.expense_notes en ON en.id=n.expense_id WHERE n.recipient_id=$1 AND n.company_id=$2
    ORDER BY created_at DESC,event_id DESC LIMIT 50`,[actor.id,actor.companyId])
  return result.rows.map(row=>({eventId:row.event_id,expenseId:row.expense_id,kind:row.kind,decision:row.decision,expenseStatus:row.expense_status,createdAt:row.created_at.toISOString(),readAt:row.read_at?.toISOString()??null,
    href:row.kind==='decision'?'/expenses':actor.role==='manager'?'/manager':'/hr'}))
}

/** Eligibility is resolved from current database rights; notify every eligible recipient. */
export function chooseAssignmentRecipients(candidates: readonly string[]) {
  const recipients=[...new Set(candidates)].sort()
  return {recipients,reason:recipients.length?null:'no_active_validator'}
}

/** Discover pending notes, keeping the manager circuit and fanning out HR recourse. */
export async function scanAssignments(pool: Pick<Pool,'connect'>, limit=25) {
  if (!Number.isInteger(limit)||limit<1||limit>100) throw new Error('Invalid assignment batch.')
  const client=await pool.connect();let transaction=false
  let routed=0,pendingPolicy=0
  try{
    await client.query('BEGIN');transaction=true
    await client.query("SET LOCAL statement_timeout='5s';SET LOCAL idle_in_transaction_session_timeout='10s'")
    const pending=await client.query<{id:string;user_id:string;company_id:string;role:string;manager_id:string|null}>(
      `SELECT en.id,en.user_id,u.company_id,u.role,u.manager_id FROM public.expense_notes en JOIN public.users u ON u.id=en.user_id
       LEFT JOIN public.expense_notification_routes r ON r.expense_id=en.id WHERE en.status='pending'
       ORDER BY r.checked_at NULLS FIRST,en.created_at,en.id LIMIT $1`,[limit])
    const started=Date.now()
    for(const note of pending.rows){
      if(Date.now()-started>10_000)break
      await client.query(`INSERT INTO public.expense_notification_routes(expense_id,company_id) VALUES($1,$2) ON CONFLICT(expense_id) DO NOTHING`,[note.id,note.company_id])
      const route=(await client.query<{generation:number;signature:string}>(`SELECT generation,signature FROM public.expense_notification_routes WHERE expense_id=$1 FOR UPDATE SKIP LOCKED`,[note.id])).rows[0]
      if(!route)continue
      const candidates=(await client.query<{id:string}>(`SELECT candidate.id FROM public.users candidate WHERE candidate.company_id=$1 AND candidate.is_active AND candidate.id<>$2 AND (
        (candidate.role='manager' AND $3<>'hr_admin' AND candidate.id=$4) OR
        (candidate.role='hr_admin' AND ($3='hr_admin' OR NOT EXISTS(SELECT 1 FROM public.users m WHERE m.id=$4 AND m.id<>$2 AND m.company_id=$1 AND m.role='manager' AND m.is_active)))
      ) ORDER BY candidate.id`,[note.company_id,note.user_id,note.role,note.manager_id])).rows.map(row=>row.id)
      const selection=chooseAssignmentRecipients(candidates)
      const signature=JSON.stringify([note.company_id,selection.recipients,selection.reason])
      const generation=route.signature===signature?route.generation:route.generation+1
      await client.query(`UPDATE public.expense_notification_routes SET generation=$2,signature=$3,state=$4,reason=$5,checked_at=clock_timestamp(),company_id=$6 WHERE expense_id=$1`,[note.id,generation,signature,selection.recipients.length?'routed':'routing_pending',selection.reason,note.company_id])
      if(!selection.recipients.length){pendingPolicy++;continue}
      if(route.signature!==signature){
        await client.query(`INSERT INTO public.assignment_notification_outbox(expense_id,company_id,recipient_id,generation) SELECT $1,$2,recipient,$4 FROM unnest($3::uuid[]) AS recipient
          WHERE EXISTS(SELECT 1 FROM public.expense_notes en WHERE en.id=$1 AND en.status='pending')
          ON CONFLICT(expense_id,generation,recipient_id) DO NOTHING`,[note.id,note.company_id,selection.recipients,generation])
        routed++
      }
    }
    await client.query('COMMIT');transaction=false
    return{routed,pendingPolicy}
  }catch{
    if(transaction){try{await client.query('ROLLBACK');transaction=false}catch{client.release(true);throw new Error('Assignment scan unavailable.')}}
    throw new Error('Assignment scan unavailable.')
  }finally{if(!transaction)client.release()}
}

export async function deliverOneAssignment(pool: Pick<Pool,'connect'>,policy:RetryPolicy){
  if(!Number.isInteger(policy.maxAttempts)||policy.maxAttempts<1||policy.maxAttempts>10||!Number.isInteger(policy.retryDelaySeconds)||policy.retryDelaySeconds<0||policy.retryDelaySeconds>3600)throw new Error('Invalid notification retry policy.')
  const client=await pool.connect();let transaction=false,discard=false
  try{
    await client.query('BEGIN');transaction=true
    await client.query("SET LOCAL statement_timeout='5s';SET LOCAL idle_in_transaction_session_timeout='10s'")
    const event=(await client.query<{event_id:string;attempts:number}>(`SELECT event_id,attempts FROM public.assignment_notification_outbox WHERE state='pending' AND next_attempt_at<=clock_timestamp() ORDER BY created_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0]
    if(!event){await client.query('COMMIT');transaction=false;return{outcome:'idle' as const}}
    const current=await client.query(`SELECT 1 FROM public.assignment_notification_outbox o JOIN public.expense_notification_routes r ON r.expense_id=o.expense_id AND r.generation=o.generation AND r.state='routed'
      JOIN public.expense_notes en ON en.id=o.expense_id AND en.status='pending' JOIN public.users owner ON owner.id=en.user_id AND owner.company_id=o.company_id
      JOIN public.users recipient ON recipient.id=o.recipient_id AND recipient.company_id=o.company_id AND recipient.is_active
      WHERE o.event_id=$1 AND recipient.id<>owner.id AND ((recipient.role='manager' AND owner.role<>'hr_admin' AND owner.manager_id=recipient.id) OR
        (recipient.role='hr_admin' AND(owner.role='hr_admin' OR NOT EXISTS(SELECT 1 FROM public.users m WHERE m.id=owner.manager_id AND m.id<>owner.id AND m.company_id=owner.company_id AND m.role='manager' AND m.is_active))))`,[event.event_id])
    if(!current.rows[0]){await client.query("UPDATE public.assignment_notification_outbox SET state='obsolete' WHERE event_id=$1",[event.event_id]);await client.query('COMMIT');transaction=false;return{outcome:'obsolete' as const}}
    if(event.attempts>=policy.maxAttempts){await client.query("UPDATE public.assignment_notification_outbox SET state='failed' WHERE event_id=$1",[event.event_id]);await client.query('COMMIT');transaction=false;return{outcome:'failed' as const}}
    await client.query('UPDATE public.assignment_notification_outbox SET attempts=attempts+1 WHERE event_id=$1',[event.event_id])
    await client.query('SAVEPOINT inbox_delivery')
    let outcome:'delivered'|'retry'|'failed'='delivered'
    try{
      await client.query(`INSERT INTO public.assignment_inbox(event_id,recipient_id,company_id,expense_id,generation)
        SELECT event_id,recipient_id,company_id,expense_id,generation FROM public.assignment_notification_outbox WHERE event_id=$1 ON CONFLICT(event_id,recipient_id) DO NOTHING`,[event.event_id])
      const visible=await client.query(`SELECT 1 FROM public.assignment_inbox n JOIN public.assignment_notification_outbox o ON o.event_id=n.event_id AND o.recipient_id=n.recipient_id AND o.company_id=n.company_id AND o.expense_id=n.expense_id AND o.generation=n.generation WHERE n.event_id=$1`,[event.event_id])
      if(!visible.rows[0])throw new Error('Assignment inbox not recorded.')
      await client.query("UPDATE public.assignment_notification_outbox SET state='delivered',delivered_at=clock_timestamp(),last_failure_code=NULL WHERE event_id=$1",[event.event_id])
    }catch{
      await client.query('ROLLBACK TO SAVEPOINT inbox_delivery')
      outcome=event.attempts+1>=policy.maxAttempts?'failed':'retry'
      await client.query(`UPDATE public.assignment_notification_outbox SET state=$2,next_attempt_at=clock_timestamp()+$3::int*interval '1 second',last_failure_code='delivery_failed' WHERE event_id=$1`,[event.event_id,outcome==='failed'?'failed':'pending',policy.retryDelaySeconds])
    }
    await client.query('COMMIT');transaction=false;return{outcome,eventId:event.event_id}
  }catch{
    if(transaction){try{await client.query('ROLLBACK')}catch{discard=true}}
    throw new Error('Assignment delivery unavailable.')
  }finally{client.release(discard)}
}

export async function markAssignmentRead(client:PoolClient,actor:CurrentActor,eventId:string){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId))return null
  const row=(await client.query<{event_id:string;read_at:Date}>(`UPDATE public.assignment_inbox SET read_at=coalesce(read_at,clock_timestamp()) WHERE event_id=$1 AND recipient_id=$2 AND company_id=$3 RETURNING event_id,read_at`,[eventId,actor.id,actor.companyId])).rows[0]
  return row?{eventId:row.event_id,readAt:row.read_at.toISOString()}:null
}
