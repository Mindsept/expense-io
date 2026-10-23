'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { signup, type AuthFormState } from '@/app/actions/auth'

export function SignupForm() {
  const [capability, setCapability] = useState<{ invitation: string; emailProof: string } | null>(null)
  const [state, action, pending] = useActionState(signup, {} as AuthFormState)
  const [linkError, setLinkError] = useState(false)
  function openInvitation() {
    const match = /^#([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(window.location.hash)
    // Remove private capabilities from the visible URL/history before navigation.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
    if (match) setCapability({ invitation: match[1], emailProof: match[2] })
    else setLinkError(true)
  }
  const input = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900'
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 pt-8">
      <h1 className="text-center text-2xl font-semibold">Inscription sur invitation</h1>
      {state.accountCreated ? (
        <p role="status">Votre compte a été créé. Connectez-vous pour continuer.</p>
      ) : capability ? (
        <form action={action} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm">Votre entreprise et votre adresse sont celles de l’invitation reçue.</p>
          <input type="hidden" name="invitation" value={capability.invitation} />
          <input type="hidden" name="emailProof" value={capability.emailProof} />
          <label className="text-sm">Nom<input name="name" autoComplete="name" required maxLength={200} className={input} /></label>
          <label className="text-sm">Mot de passe<input name="password" type="password" autoComplete="new-password" required minLength={8} className={input} /></label>
          <p className="text-xs text-gray-500">8 caractères minimum, 72 octets maximum.</p>
          <button type="submit" disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-60">{pending ? 'Création…' : 'Créer mon compte'}</button>
        </form>
      ) : (
        <div className="flex flex-col gap-4"><p>Utilisez le lien reçu à votre adresse email après une invitation de votre service RH. Une adresse déclarée ne suffit pas à rejoindre une entreprise.</p>
          <button type="button" onClick={openInvitation} className="rounded-md bg-brand-600 px-4 py-2 text-white">Ouvrir mon invitation</button>
          {linkError && <p role="alert">Lien d’invitation invalide. Utilisez le lien complet reçu à votre adresse email.</p>}
        </div>
      )}
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      <Link href="/login" className="text-center font-medium text-brand-600 hover:underline">Se connecter</Link>
    </main>
  )
}
