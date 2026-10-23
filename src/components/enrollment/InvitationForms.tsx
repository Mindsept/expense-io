'use client'

import { useActionState } from 'react'
import { inviteEmployee, revokeInvitation, type InvitationFormState } from '@/app/actions/invitations'

export function InviteEmployeeForm() {
  const [state, action, pending] = useActionState(inviteEmployee, {} as InvitationFormState)
  return <form action={action} className="flex max-w-md flex-col gap-3 rounded-xl border border-gray-200 p-5 dark:border-gray-800">
    <label htmlFor="invitation-email">Adresse email à inviter</label>
    <input id="invitation-email" name="email" type="email" autoComplete="off" required maxLength={254} className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900" />
    <p className="text-sm text-gray-500">L’invitation donne accès à votre entreprise en tant qu’employé. Elle expire selon la durée configurée par l’administrateur.</p>
    <button disabled={pending} type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-60">{pending ? 'Envoi…' : 'Inviter'}</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <p role="status">{state.success}</p>}
  </form>
}

export function RevokeInvitationForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revokeInvitation, {} as InvitationFormState)
  return <form action={action} className="flex flex-col gap-1">
    <input type="hidden" name="invitationId" value={id} />
    <button type="submit" disabled={pending || !!state.success} className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-60">{state.success ? 'Révoquée' : pending ? 'Révocation…' : 'Révoquer'}</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <p role="status" className="sr-only">{state.success}</p>}
  </form>
}
