import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'

/** Owner-facing EL-06 contract. It reports eligibility, without choosing an HR assignee. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'expense-notes.validation-status', async () => withCurrentActor(undefined, async (client, actor) => {
    const { id } = await params
    const result = await client.query<{ status: string; role: string; has_manager: boolean; hr_count: number }>(
      `SELECT en.status, u.role, EXISTS (
         SELECT 1 FROM users manager WHERE manager.id=u.manager_id AND manager.company_id=u.company_id
           AND manager.id<>u.id AND manager.role='manager' AND manager.is_active
       ) AS has_manager, (
         SELECT count(*)::int FROM users hr WHERE hr.company_id=u.company_id AND hr.id<>u.id
           AND hr.role='hr_admin' AND hr.is_active
       ) AS hr_count
       FROM expense_notes en JOIN users u ON u.id=en.user_id
       WHERE en.id=$1 AND u.id=$2 AND u.company_id=$3 FOR SHARE OF en, u`, [id, actor.id, actor.companyId],
    )
    const row = result.rows[0]
    if (!row) throw new ApiError('not_found')
    let validation: { kind: 'manager' | 'hr' | 'none'; reasonCode: string; message: string }
    if (row.status !== 'pending') validation = { kind: 'none', reasonCode: 'already_decided', message: 'Cette note a déjà été traitée.' }
    else if (row.role !== 'hr_admin' && row.has_manager) validation = { kind: 'manager', reasonCode: 'direct_manager', message: 'En attente de validation par votre manager direct.' }
    else if (row.hr_count > 0) validation = { kind: 'hr', reasonCode: row.role === 'hr_admin' ? 'peer_hr' : 'hr_recourse', message: row.role === 'hr_admin' ? 'En attente de validation par un autre RH.' : 'En attente de prise en charge par les RH.' }
    else validation = { kind: 'none', reasonCode: row.role === 'hr_admin' ? 'no_other_active_hr' : 'routing_policy_pending', message: row.role === 'hr_admin' ? 'Aucun autre RH actif ne peut valider cette note. Elle reste en attente.' : 'Aucun RH actif éligible ne peut valider cette note. Elle reste en attente.' }
    return Response.json({ status: row.status, validation })
  }))
}
