import Link from 'next/link'
import { auth } from '@/lib/auth'
import { withCurrentActor } from '@/lib/current-actor'
import { InviteEmployeeForm, RevokeInvitationForm } from '@/components/enrollment/InvitationForms'

export default async function InvitationsPage() {
  const session = await auth()
  if (session?.user?.role !== 'hr_admin') return <main><h1 className="text-xl font-semibold">Accès réservé aux RH</h1><Link href="/login">Se connecter</Link></main>
  const invitations = await withCurrentActor('hr_admin', async (client, actor) => {
    const result = await client.query<{ id: string; intended_email: string; expires_at: Date; revoked_at: Date | null; consumed_at: Date | null; expired: boolean }>(
      `SELECT id,intended_email,expires_at,revoked_at,consumed_at,expires_at <= clock_timestamp() AS expired FROM enrollment_invitations
       WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100`, [actor.companyId],
    )
    return result.rows
  })
  return <main className="flex flex-col gap-6">
    <div><Link href="/hr" className="text-sm text-brand-600 hover:underline">Retour à l’espace RH</Link><h1 className="mt-3 text-2xl font-semibold">Invitations de l’entreprise</h1></div>
    <InviteEmployeeForm />
    <p className="text-sm text-gray-500">Les 100 invitations les plus récentes. Aucun lien privé n’est affiché ici.</p>
    <ul className="flex flex-col gap-3">{invitations.map(invite => {
      const unavailable = !!invite.revoked_at || !!invite.consumed_at || invite.expired
      const status = invite.consumed_at ? 'Utilisée' : invite.revoked_at ? 'Révoquée' : unavailable ? 'Expirée' : 'En attente'
      return <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800"><div><p>{invite.intended_email}</p><p className="text-sm text-gray-500">{status} · expiration {invite.expires_at.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</p></div>{!unavailable && <RevokeInvitationForm id={invite.id} />}</li>
    })}</ul>
  </main>
}
