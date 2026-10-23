'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCivilDate } from '@/utils/civil-date'
import { getClientErrorMessage, isConflict } from '@/utils/client-errors'

interface CompanyUser {
  id: string
  name: string
  email: string
  role: 'employee' | 'manager'
  managerId: string | null
}

interface ExpenseNote {
  id: string
  userId: string
  author?: { id: string; displayName: string }
  amount: number
  expenseDate: string
  description: string
  createdAt: string
}

const selectClass =
  'rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900'

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

export function AdminConsole() {
  const [users, setUsers] = useState<CompanyUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [usersNotice, setUsersNotice] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [notes, setNotes] = useState<ExpenseNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [notesNotice, setNotesNotice] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const notesHeadingRef = useRef<HTMLHeadingElement>(null)
  const usersHeadingRef = useRef<HTMLHeadingElement>(null)
  const assignmentPending = useRef(false)

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const response = await fetch('/api/hr/users')
      if (!response.ok) {
        setUsersError(await getClientErrorMessage(response, "Impossible de charger l'annuaire."))
        return
      }
      const result: unknown = await response.json()
      if (!Array.isArray(result)) throw new Error('Invalid users list')
      setUsers(result as CompanyUser[])
      setUsersError(null)
    } catch {
      setUsersError("Impossible de charger l'annuaire. Vérifie la connexion puis réessaie.")
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const loadNotes = useCallback(async () => {
    setNotesLoading(true)
    try {
      const response = await fetch('/api/hr/expense-notes')
      if (!response.ok) {
        setNotesError(await getClientErrorMessage(response, 'Impossible de charger les notes en attente.'))
        return
      }
      const result: unknown = await response.json()
      if (!Array.isArray(result)) throw new Error('Invalid notes list')
      setNotes(result as ExpenseNote[])
      setNotesError(null)
    } catch {
      setNotesError('Impossible de charger les notes en attente. Vérifie la connexion puis réessaie.')
    } finally {
      setNotesLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers()
    loadNotes()
  }, [loadUsers, loadNotes])

  const managers = users.filter((user) => user.role === 'manager')

  async function retryUsers() {
    await loadUsers()
    usersHeadingRef.current?.focus()
  }

  async function retryNotes() {
    await loadNotes()
    notesHeadingRef.current?.focus()
  }

  async function handleManagerChange(userId: string, managerId: string) {
    if (assignmentPending.current) return
    assignmentPending.current = true
    setSavingId(userId)
    setUsersError(null)
    setUsersNotice(null)
    try {
      const response = await fetch(`/api/hr/users/${userId}/manager`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ managerId: managerId === '' ? null : managerId }),
      })
      if (response.ok) {
        setUsersNotice('Affectation enregistrée.')
        await Promise.all([loadUsers(), loadNotes()])
      } else {
        setUsersError(await getClientErrorMessage(response, "Échec de l'assignation."))
      }
    } catch {
      setUsersError("Résultat non confirmé pour l'affectation : vérifie l'organigramme avant de réessayer.")
    } finally {
      assignmentPending.current = false
      setSavingId(null)
    }
  }

  async function handleViewReceipt(id: string) {
    setNotesError(null)
    try {
      const response = await fetch(`/api/hr/expense-notes/${id}/receipt-url`)
      if (!response.ok) {
        setNotesError(await getClientErrorMessage(response, 'Impossible de récupérer le reçu.'))
        return
      }
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || typeof (result as { url?: unknown }).url !== 'string') throw new Error()
      window.open((result as { url: string }).url, '_blank', 'noopener,noreferrer')
    } catch {
      setNotesError('Impossible de récupérer le reçu. Vérifie la connexion puis réessaie.')
    }
  }

  async function handleDecide(id: string, decision: 'approve' | 'reject') {
    setDecidingId(id)
    setNotesError(null)
    setNotesNotice(null)
    try {
      const response = await fetch(`/api/hr/expense-notes/${id}/${decision}`, { method: 'POST' })
      if (response.ok) {
        setNotesNotice(decision === 'approve' ? 'Note de frais approuvée.' : 'Note de frais rejetée.')
        await loadNotes()
        notesHeadingRef.current?.focus()
      } else if (isConflict(response)) {
        setNotesError('Cette note a été modifiée depuis son affichage. Actualise la liste avant de décider.')
      } else {
        setNotesError(await getClientErrorMessage(response, 'Échec de la décision sur cette note de frais.'))
      }
    } catch {
      setNotesError('Résultat non confirmé à cause du réseau. Actualise la liste avant de réessayer.')
    } finally {
      setDecidingId(null)
    }
  }

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Espace RH</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Organigramme de votre entreprise et validation des notes de frais
          des managers sans manager assigné.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 ref={usersHeadingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          Organigramme ({users.length})
        </h2>
        {usersError && (
          <div className="mx-6 mt-4">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {usersError}
            </p>
            <button type="button" onClick={retryUsers} disabled={usersLoading || savingId !== null} className="mt-2 text-sm font-medium text-brand-600 hover:underline disabled:opacity-60">
              {usersLoading ? 'Actualisation…' : 'Réessayer l’annuaire'}
            </button>
          </div>
        )}
        {usersNotice && <p role="status" className="mx-6 mt-4 text-sm text-green-700 dark:text-green-300">{usersNotice}</p>}
        {usersLoading && users.length === 0 ? (
          <p role="status" className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Chargement…
          </p>
        ) : users.length === 0 ? (
          usersError ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              <p>Annuaire indisponible.</p>
            </div>
          ) : (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Aucun employé ou manager dans cette entreprise.
          </p>
          )
        ) : (
          <div className="overflow-x-auto" tabIndex={0} aria-label="Annuaire de l’entreprise, tableau défilant">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Nom</th>
                  <th className="px-6 py-3 font-medium">Rôle</th>
                  <th className="px-6 py-3 font-medium">Manager</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-3">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
                    </td>
                    <td className="px-6 py-3 capitalize">{user.role}</td>
                    <td className="px-6 py-3">
                      <label className="sr-only" htmlFor={`manager-${user.id}`}>
                        Manager de {user.name}
                      </label>
                      <select
                        id={`manager-${user.id}`}
                        value={user.managerId ?? ''}
                        disabled={savingId !== null || usersLoading}
                        onChange={(event) => handleManagerChange(user.id, event.target.value)}
                        className={selectClass}
                      >
                        <option value="">— aucun (racine) —</option>
                        {managers
                          .filter((manager) => manager.id !== user.id)
                          .map((manager) => (
                            <option key={manager.id} value={manager.id}>
                              {manager.name}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 ref={notesHeadingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          Notes des managers racine en attente ({notes.length})
        </h2>
        {notesError && (
          <div className="mx-6 mt-4">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {notesError}
            </p>
            <button type="button" onClick={retryNotes} disabled={notesLoading || decidingId !== null} className="mt-2 text-sm font-medium text-brand-600 hover:underline disabled:opacity-60">
              {notesLoading ? 'Actualisation…' : 'Réessayer les notes'}
            </button>
          </div>
        )}
        {notesNotice && <p role="status" className="mx-6 mt-4 text-sm text-green-700 dark:text-green-300">{notesNotice}</p>}
        {notesLoading && notes.length === 0 ? (
          <p role="status" className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Chargement…
          </p>
        ) : notes.length === 0 && notesError ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>Liste indisponible.</p>
          </div>
        ) : notes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Aucune note en attente.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} aria-label="Notes des managers en attente, tableau défilant">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Manager</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 text-right font-medium">Montant</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {notes.map((note) => {
                  const authorName = note.author?.displayName || 'Auteur non disponible'
                  return (
                    <tr key={note.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-6 py-3">{authorName}</td>
                      <td className="px-6 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {formatCivilDate(note.expenseDate)}
                      </td>
                      <td className="px-6 py-3">{note.description}</td>
                      <td className="px-6 py-3 text-right font-medium whitespace-nowrap">
                        {currencyFormatter.format(note.amount)}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          aria-label={`Voir le reçu de ${authorName}, ${note.description}`}
                          onClick={() => handleViewReceipt(note.id)}
                          className="mr-3 text-sm font-medium text-brand-600 hover:underline"
                        >
                          Voir le reçu
                        </button>
                        <button
                          type="button"
                          disabled={decidingId !== null}
                          aria-label={`Approuver la note de ${authorName}, ${note.description}`}
                          onClick={() => handleDecide(note.id, 'approve')}
                          className="mr-3 text-sm font-medium text-green-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Approuver
                        </button>
                        <button
                          type="button"
                          disabled={decidingId !== null}
                          aria-label={`Rejeter la note de ${authorName}, ${note.description}`}
                          onClick={() => handleDecide(note.id, 'reject')}
                          className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Rejeter
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
