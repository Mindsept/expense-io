'use server'

import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { issueEmployeeInvitation, revokeEmployeeInvitation } from '@/lib/enrollment/invitations'
import { deliverInvitation, readInvitationDelivery } from '@/lib/enrollment/delivery'

export type InvitationFormState = { error?: string; success?: string }

export async function inviteEmployee(_previous: InvitationFormState, form: FormData): Promise<InvitationFormState> {
  void _previous
  const session = await auth()
  if (!session?.user?.id) return { error: 'Connectez-vous avec un compte RH actif.' }
  const email = form.get('email')
  if (typeof email !== 'string') return { error: 'Adresse email invalide.' }
  let issued: Awaited<ReturnType<typeof issueEmployeeInvitation>> | undefined
  try {
    const settings = readInvitationDelivery()
    issued = await issueEmployeeInvitation(getPool(), session.user.id, { email, ttlSeconds: settings.ttlSeconds })
    await deliverInvitation(issued, settings)
    return { success: 'Invitation confiée au service d’envoi. Seule l’adresse invitée peut activer le compte.' }
  } catch {
    // A bridge timeout is ambiguous: invalidate even a possibly delivered link.
    // Revocation is best effort here; proof tokens are never returned to the HR.
    if (issued) {
      try { await revokeEmployeeInvitation(getPool(), session.user.id, issued.invitationId) } catch { /* bounded failure below */ }
    }
    return { error: 'Invitation non confirmée. Vérifiez la configuration d’envoi ou réessayez plus tard.' }
  }
}

export async function revokeInvitation(_previous: InvitationFormState, form: FormData): Promise<InvitationFormState> {
  void _previous
  const session = await auth()
  if (!session?.user?.id) return { error: 'Connectez-vous avec un compte RH actif.' }
  const id = form.get('invitationId')
  if (typeof id !== 'string') return { error: 'Invitation indisponible.' }
  try {
    await revokeEmployeeInvitation(getPool(), session.user.id, id)
    return { success: 'Invitation révoquée.' }
  } catch { return { error: 'Invitation indisponible ou droits insuffisants.' } }
}
