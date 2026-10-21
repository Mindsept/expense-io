import type { Pool, PoolClient } from 'pg'
import type { NotificationPort } from '../../src/ports/NotificationPort'
import type { ExpenseDecisionEvent } from '../../src/ports/ExpenseDecisionPort'
import type { CurrentActor } from '../../src/lib/current-actor'

/** Call only from HA-03's extendTransaction with its same client and recorded event. */
export async function enqueueDecisionNotification(client: PoolClient, event: ExpenseDecisionEvent): Promise<void> {
  await client.query(`INSERT INTO decision_notification_outbox
    (event_id, company_id, recipient_id, expense_id, decision)
    SELECT h.id, h.company_id, en.user_id, en.id, h.to_status
    FROM expense_decision_history h JOIN expense_notes en ON en.id=h.expense_note_id
    JOIN users owner ON owner.id=en.user_id
    WHERE h.id=$1 AND en.id=$2 AND owner.id=$3 AND owner.company_id=$4
      AND h.company_id=$4 AND h.to_status=$5 AND en.status=h.to_status
    ON CONFLICT (event_id) DO NOTHING`, [event.id, event.expenseId, event.ownerId, event.companyId, event.toStatus])
  const recorded = await client.query(`SELECT 1 FROM decision_notification_outbox
    WHERE event_id=$1 AND expense_id=$2 AND recipient_id=$3 AND company_id=$4 AND decision=$5`,
  [event.id, event.expenseId, event.ownerId, event.companyId, event.toStatus])
  if (!recorded.rows[0]) throw new Error('The decision notification intent could not be recorded.')
}

/** Database-only channel; a real inbox row and acknowledgement share one transaction. */
export class PostgresInAppNotificationAdapter implements NotificationPort {
  constructor(private readonly client: PoolClient) {}
  async notifyDecision(userId: string, noteId: string, decision: 'approved' | 'rejected', context?: Readonly<{ eventId: string }>) {
    if (!context?.eventId || !['approved','rejected'].includes(decision)) throw new Error('The notification event is invalid.')
    await this.client.query(`INSERT INTO decision_inbox (event_id, recipient_id, company_id, expense_id, decision)
      SELECT o.event_id, o.recipient_id, o.company_id, o.expense_id, o.decision
      FROM decision_notification_outbox o JOIN users owner ON owner.id=o.recipient_id
      JOIN expense_notes en ON en.id=o.expense_id AND en.user_id=owner.id
      WHERE o.event_id=$1 AND o.recipient_id=$2 AND o.expense_id=$3 AND o.decision=$4 AND owner.company_id=o.company_id
      ON CONFLICT (event_id,recipient_id) DO NOTHING`, [context.eventId, userId, noteId, decision])
    const visible = await this.client.query(`SELECT 1 FROM decision_inbox n JOIN users owner ON owner.id=n.recipient_id
      JOIN expense_notes en ON en.id=n.expense_id AND en.user_id=owner.id
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
      `SELECT event_id, recipient_id, expense_id, decision, attempts FROM decision_notification_outbox
       WHERE state='pending' AND next_attempt_at<=clock_timestamp()
       ORDER BY created_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    )
    const event = selected.rows[0]
    if (!event) { await client.query('COMMIT'); transaction = false; return { outcome: 'idle' as const } }
    if (event.attempts >= policy.maxAttempts) {
      await client.query("UPDATE decision_notification_outbox SET state='failed' WHERE event_id=$1", [event.event_id])
      await client.query('COMMIT'); transaction = false; return { outcome: 'failed' as const, eventId: event.event_id }
    }
    await client.query('UPDATE decision_notification_outbox SET attempts=attempts+1 WHERE event_id=$1', [event.event_id])
    await client.query('SAVEPOINT inbox_delivery')
    let outcome: 'delivered' | 'retry' | 'failed' = 'delivered'
    try {
      await new PostgresInAppNotificationAdapter(client).notifyDecision(event.recipient_id, event.expense_id, event.decision, { eventId: event.event_id })
      await client.query("UPDATE decision_notification_outbox SET state='delivered', delivered_at=clock_timestamp(), last_failure_code=NULL WHERE event_id=$1", [event.event_id])
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT inbox_delivery')
      outcome = event.attempts + 1 >= policy.maxAttempts ? 'failed' : 'retry'
      await client.query(`UPDATE decision_notification_outbox SET state=$2,
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
    `SELECT n.event_id,n.expense_id,n.decision,n.created_at,n.read_at FROM decision_inbox n
     JOIN users recipient ON recipient.id=n.recipient_id JOIN expense_notes en ON en.id=n.expense_id AND en.user_id=recipient.id
     WHERE recipient.id=$1 AND recipient.company_id=$2 AND recipient.is_active AND n.company_id=$2
     ORDER BY n.created_at DESC,n.event_id DESC LIMIT 50`, [actor.id, actor.companyId],
  )
  return result.rows.map(row => ({ eventId: row.event_id, expenseId: row.expense_id, decision: row.decision, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }))
}

/** Draft EL-06 command; caller supplies the current authenticated actor/client.
 * First-read time is server-side and immutable under retries. This marks only a
 * currently visible notification and never changes a decision/delivery state.
 */
export async function markDecisionInboxRead(client: PoolClient, actor: CurrentActor, eventId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId)) return null
  const result = await client.query<{ event_id: string; read_at: Date }>(
    `UPDATE decision_inbox n SET read_at=coalesce(n.read_at,clock_timestamp())
     FROM users recipient,expense_notes en
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
  const result = await client.query(`UPDATE decision_notification_outbox o SET state='pending', attempts=0, next_attempt_at=clock_timestamp(), last_failure_code=NULL
    WHERE o.event_id=$1 AND o.state='failed' AND o.company_id=$2 AND EXISTS (
      SELECT 1 FROM users current_actor WHERE current_actor.id=$3 AND current_actor.company_id=$2 AND current_actor.is_active AND current_actor.role='hr_admin'
    ) RETURNING event_id`, [eventId, actor.companyId, actor.id])
  return result.rows.length === 1
}
