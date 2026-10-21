import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { expenseValidatorSql } from '@/lib/expense-access'

/** Proposed EL-06/LE-10 contract; current HA-02 visibility also applies after a decision. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'expense-notes.history', async () => {
    return withCurrentActor(undefined, async (client, actor) => {
      const { id } = await params
      const visible = await client.query(
        `SELECT en.id FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE en.id = $1 AND u.company_id = $3
           AND (u.id = $2 OR (${expenseValidatorSql(actor.role)}))
         FOR SHARE OF en, u`,
        [id, actor.id, actor.companyId],
      )
      if (!visible.rows[0]) throw new ApiError('not_found')
      const events = await client.query<{
        id: string; from_status: 'pending'; to_status: 'approved' | 'rejected';
        decided_at: Date; actor_id: string; actor_display_name: string;
      }>(
        `SELECT id, from_status, to_status, decided_at, actor_id, actor_display_name
         FROM expense_decision_history WHERE expense_note_id = $1 AND company_id = $2
         ORDER BY decided_at ASC, id ASC`,
        [id, actor.companyId],
      )
      return Response.json({ items: events.rows.map((event) => ({
        id: event.id, fromStatus: event.from_status, toStatus: event.to_status,
        decidedAt: event.decided_at.toISOString(),
        actor: { id: event.actor_id, displayName: event.actor_display_name },
      })) })
    })
  })
}
