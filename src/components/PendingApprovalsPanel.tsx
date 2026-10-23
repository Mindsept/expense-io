'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCivilDate } from '@/utils/civil-date'
import { getClientErrorMessage, isConflict } from '@/utils/client-errors'

interface ExpenseNote {
  id: string
  userId: string
  author?: { id: string; displayName: string }
  amount: number
  expenseDate: string
  description: string
  createdAt: string
}

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

export function PendingApprovalsPanel() {
  const [notes, setNotes] = useState<ExpenseNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const loadPending = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/manager/expense-notes')
      if (!response.ok) {
        setError(await getClientErrorMessage(response, 'Impossible de charger les notes en attente.'))
        return
      }
      const result: unknown = await response.json()
      if (!Array.isArray(result)) throw new Error('Invalid pending list')
      setNotes(result as ExpenseNote[])
      setError(null)
    } catch {
      setError('Impossible de charger les notes en attente. Vérifie ta connexion puis réessaie.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPending()
  }, [loadPending])

  async function handleViewReceipt(id: string) {
    setError(null)
    try {
      const response = await fetch(`/api/manager/expense-notes/${id}/receipt-url`)
      if (!response.ok) {
        setError(await getClientErrorMessage(response, 'Impossible de récupérer le reçu.'))
        return
      }
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || typeof (result as { url?: unknown }).url !== 'string') throw new Error()
      window.open((result as { url: string }).url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Impossible de récupérer le reçu. Vérifie ta connexion puis réessaie.')
    }
  }

  async function retryPending() {
    await loadPending()
    headingRef.current?.focus()
  }

  async function handleDecide(id: string, decision: 'approve' | 'reject') {
    setDecidingId(id)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/manager/expense-notes/${id}/${decision}`, { method: 'POST' })
      if (response.ok) {
        setNotice(decision === 'approve' ? 'Note de frais approuvée.' : 'Note de frais rejetée.')
        await loadPending()
        headingRef.current?.focus()
      } else if (isConflict(response)) {
        setError('Cette note a été modifiée depuis son affichage. Actualise la liste avant de décider.')
      } else {
        setError(await getClientErrorMessage(response, "Échec de la décision sur cette note de frais."))
      }
    } catch {
      setError('Résultat non confirmé à cause du réseau. Actualise la liste avant de réessayer.')
    } finally {
      setDecidingId(null)
    }
  }

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Validation des notes de frais</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Notes en attente des employés qui vous sont rattachés. Le
          rattachement est géré par la RH de votre entreprise (page RH).
        </p>
      </div>

      {error && (
        <div>
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
          <button type="button" onClick={retryPending} disabled={loading || decidingId !== null} className="mt-2 text-sm font-medium text-brand-600 hover:underline disabled:opacity-60">
            {loading ? 'Actualisation…' : 'Réessayer'}
          </button>
        </div>
      )}
      {notice && <p role="status" className="text-sm text-green-700 dark:text-green-300">{notice}</p>}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 ref={headingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          En attente ({notes.length})
        </h2>
        {loading && notes.length === 0 ? (
          <p role="status" className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Chargement…
          </p>
        ) : error && notes.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>Liste indisponible.</p>
          </div>
        ) : notes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Aucune note en attente.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} aria-label="Notes en attente, tableau défilant">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Employé</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 text-right font-medium">Montant</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {notes.map((note) => (
                  <tr key={note.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-3">
                      {note.author?.displayName || 'Auteur non disponible'}
                    </td>
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
                        aria-label={`Voir le reçu de ${note.author?.displayName || 'l’auteur non disponible'}, ${note.description}`}
                        onClick={() => handleViewReceipt(note.id)}
                        className="mr-3 text-sm font-medium text-brand-600 hover:underline"
                      >
                        Voir le reçu
                      </button>
                      <button
                        type="button"
                        disabled={decidingId !== null}
                        aria-label={`Approuver la note de ${note.author?.displayName || 'l’auteur non disponible'}, ${note.description}`}
                        onClick={() => handleDecide(note.id, 'approve')}
                        className="mr-3 text-sm font-medium text-green-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Approuver
                      </button>
                      <button
                        type="button"
                        disabled={decidingId !== null}
                        aria-label={`Rejeter la note de ${note.author?.displayName || 'l’auteur non disponible'}, ${note.description}`}
                        onClick={() => handleDecide(note.id, 'reject')}
                        className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Rejeter
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
