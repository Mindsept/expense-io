'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCivilDate } from '@/utils/civil-date'
import { getClientErrorMessage, isConflict } from '@/utils/client-errors'
import { parsePagedList, type PageInfo, type PageTotals } from '@/utils/paged-list'
import { PaginationControls } from '@/components/PaginationControls'

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
  const [notesPage, setNotesPage] = useState<PageInfo>({ page: 1, pageSize: 20, totalItems: 0 })
  const [notesTotals, setNotesTotals] = useState<PageTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const requestGeneration = useRef(0)

  const loadPending = useCallback(async () => {
    const generation = ++requestGeneration.current
    setLoading(true)
    try {
      const response = await fetch(`/api/manager/expense-notes?page=${notesPage.page}&pageSize=${notesPage.pageSize}`)
      if (!response.ok) {
        setError(await getClientErrorMessage(response, 'Impossible de charger les notes en attente.'))
        return
      }
      const result: unknown = await response.json()
      const pageResult = parsePagedList<ExpenseNote>(result, true)
      if (generation !== requestGeneration.current) return
      if (pageResult.items.length === 0 && pageResult.pagination.page > 1 &&
          pageResult.pagination.totalItems <= (pageResult.pagination.page - 1) * pageResult.pagination.pageSize) {
        setNotesPage((current) => ({ ...current, page: current.page - 1 }))
        return
      }
      setNotes(pageResult.items)
      setNotesPage(pageResult.pagination)
      setNotesTotals(pageResult.totals)
      setError(null)
    } catch {
      if (generation !== requestGeneration.current) return
      setError('Impossible de charger les notes en attente. Vérifie ta connexion puis réessaie.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [notesPage.page, notesPage.pageSize])

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
    const source = document.activeElement
    await loadPending()
    if (document.activeElement === source || document.activeElement === document.body) headingRef.current?.focus()
  }

  async function handleDecide(id: string, decision: 'approve' | 'reject') {
    const source = document.activeElement
    setDecidingId(id)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/manager/expense-notes/${id}/${decision}`, { method: 'POST' })
      if (response.ok) {
        setNotice(decision === 'approve' ? 'Note de frais approuvée.' : 'Note de frais rejetée.')
        await loadPending()
        if (document.activeElement === source || document.activeElement === document.body) headingRef.current?.focus()
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
          <button type="button" onClick={retryPending} disabled={loading || decidingId !== null} className="mt-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-200 disabled:opacity-60">
            {loading ? 'Actualisation…' : 'Réessayer'}
          </button>
        </div>
      )}
      {notice && <p role="status" className="text-sm text-green-700 dark:text-green-300">{notice}</p>}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 ref={headingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          En attente{notesTotals ? ` (${notesPage.totalItems})` : ''}
        </h2>
        {notesTotals && <p className="px-6 pt-3 text-sm text-gray-500 dark:text-gray-400">
          Total des notes en attente : {notesTotals.count} · {currencyFormatter.format(notesTotals.amount ?? 0)}
        </p>}
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
          <div role="region" className="relative overflow-x-auto" tabIndex={0} aria-label="Notes en attente, tableau défilant">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Employé</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 text-right font-medium">Montant</th>
                  <th className="px-6 py-3"><span className="sr-only">Actions</span></th>
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
                        aria-label={`Voir le reçu de ${note.author?.displayName || 'l’auteur non disponible'}, ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                        onClick={() => handleViewReceipt(note.id)}
                        className="mr-3 text-sm font-medium text-brand-600 hover:underline dark:text-brand-200"
                      >
                        Voir le reçu
                      </button>
                      <button
                        type="button"
                        disabled={decidingId !== null}
                        aria-label={`Approuver la note de ${note.author?.displayName || 'l’auteur non disponible'}, ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                        onClick={() => handleDecide(note.id, 'approve')}
                        className="mr-3 text-sm font-medium text-green-700 hover:underline dark:text-green-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Approuver
                      </button>
                      <button
                        type="button"
                        disabled={decidingId !== null}
                        aria-label={`Rejeter la note de ${note.author?.displayName || 'l’auteur non disponible'}, ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                        onClick={() => handleDecide(note.id, 'reject')}
                        className="text-sm font-medium text-red-600 hover:underline dark:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
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
        {notesPage.totalItems > 0 && (
          <PaginationControls page={notesPage.page} pageSize={notesPage.pageSize} totalItems={notesPage.totalItems}
            disabled={loading || decidingId !== null} label="Pagination des notes en attente"
            onPageChange={(page) => setNotesPage((current) => ({ ...current, page }))} />
        )}
      </section>
    </main>
  )
}
