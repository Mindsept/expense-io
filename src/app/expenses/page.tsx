'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { formatCivilDate } from '@/utils/civil-date'
import { formatRequestFailure, getClientErrorMessage } from '@/utils/client-errors'
import { selectOcrSuggestions } from '@/utils/ocr-suggestion'

interface ExpenseNote {
  id: string
  amount: number
  expenseDate: string
  description: string
  status: string
  createdAt: string
}

interface ValidationStatus {
  kind: 'manager' | 'hr' | 'none'
  reasonCode: string
  message: string
}

interface DecisionHistoryItem {
  id: string
  toStatus: 'approved' | 'rejected'
  decidedAt: string
  actor: { id: string; displayName: string }
}

type WorkflowDetails =
  | { kind: 'validation'; loading: boolean; validation?: ValidationStatus; error?: string }
  | { kind: 'history'; loading: boolean; items?: DecisionHistoryItem[]; error?: string }

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900'

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})
const decisionDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})

function formatDecisionDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date indisponible' : decisionDateFormatter.format(date)
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'en attente',
  approved: 'approuvée',
  rejected: 'rejetée',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default function ExpensesPage() {
  const [notes, setNotes] = useState<ExpenseNote[]>([])
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState('')
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null)
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowDetails>>({})
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [workflowLoadingId, setWorkflowLoadingId] = useState<string | null>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const historyHeadingRef = useRef<HTMLHeadingElement>(null)
  const suggestionGeneration = useRef(0)
  const suggestionFieldsEdited = useRef({ amount: 0, expenseDate: 0 })
  const mounted = useRef(true)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/expense-notes')
      if (!response.ok) {
        setHistoryError(await getClientErrorMessage(response, 'Impossible de charger les notes de frais.'))
        return
      }
      const result: unknown = await response.json()
      if (!Array.isArray(result)) throw new Error('Invalid note list')
      setNotes(result as ExpenseNote[])
      setHistoryError(null)
    } catch {
      setHistoryError('Impossible de charger les notes de frais. Vérifie ta connexion puis réessaie.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // Initialiser le chargement des données au montage de cet écran client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotes()
    return () => {
      mounted.current = false
      suggestionGeneration.current += 1
    }
  }, [loadNotes])

  function updateAmount(value: string) {
    suggestionFieldsEdited.current.amount += 1
    setAmount(value)
  }

  function updateExpenseDate(value: string) {
    suggestionFieldsEdited.current.expenseDate += 1
    setExpenseDate(value)
  }

  async function retryHistory() {
    await loadNotes()
    historyHeadingRef.current?.focus()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSubmissionNotice(null)
    const form = event.currentTarget
    const formData = new FormData(form)

    try {
      const response = await fetch('/api/expense-notes', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        setError(await getClientErrorMessage(response, 'Échec de la soumission de la note de frais.'))
        return
      }
      form.reset()
      setAmount('')
      setExpenseDate('')
      setSuggestionNotice(null)
      suggestionGeneration.current += 1
      setExtracting(false)
      setSubmissionNotice('Note de frais enregistrée.')
      await loadNotes()
    } catch (failure) {
      setError(formatRequestFailure(failure, 'Échec de la soumission de la note de frais.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSuggestFields() {
    const receipt = receiptInputRef.current?.files?.[0]
    if (!receipt) {
      setError('Sélectionne d’abord un reçu.')
      return
    }
    setExtracting(true)
    setError(null)
    setSuggestionNotice(null)
    const generation = ++suggestionGeneration.current
    const fieldEditVersion = { ...suggestionFieldsEdited.current }
    const amountAtStart = amount
    const expenseDateAtStart = expenseDate

    const formData = new FormData()
    formData.set('receipt', receipt)
    try {
      const response = await fetch('/api/expense-notes/receipt-suggestion', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        const message = await getClientErrorMessage(response, 'Impossible d’analyser ce reçu.')
        if (!mounted.current || generation !== suggestionGeneration.current) return
        setError(message)
        return
      }
      const suggestion: unknown = await response.json()
      if (!suggestion || typeof suggestion !== 'object') throw new Error('Invalid suggestion')
      if (
        !mounted.current ||
        generation !== suggestionGeneration.current ||
        receiptInputRef.current?.files?.[0] !== receipt
      ) return
      const fields = suggestion as { amount?: unknown; expenseDate?: unknown }
      const selected = selectOcrSuggestions({
        amount: fields.amount,
        expenseDate: fields.expenseDate,
        amountAtStart,
        expenseDateAtStart,
        amountEditedSinceStart: suggestionFieldsEdited.current.amount !== fieldEditVersion.amount,
        expenseDateEditedSinceStart: suggestionFieldsEdited.current.expenseDate !== fieldEditVersion.expenseDate,
      })
      if (selected.amount !== null) setAmount(selected.amount)
      if (selected.expenseDate !== null) setExpenseDate(selected.expenseDate)
      const foundAmount = typeof fields.amount === 'number' && Number.isFinite(fields.amount) && fields.amount > 0
      const foundDate = typeof fields.expenseDate === 'string' && formatCivilDate(fields.expenseDate) !== 'Date indisponible'
      const preservedFields = [
        foundAmount && selected.amount === null ? 'montant' : null,
        foundDate && selected.expenseDate === null ? 'date' : null,
      ].filter(Boolean)
      if (!foundAmount && !foundDate) {
        setSuggestionNotice('Aucune information reconnue sur ce reçu — saisis les champs manuellement.')
      } else {
        const messages = ['Analyse terminée — vérifie les informations du reçu.']
        if (!foundAmount || !foundDate) messages.push(`${foundAmount ? 'Date' : 'Montant'} non reconnu(e) — vérifie ce champ.`)
        if (preservedFields.length > 0) messages.push(`Saisie conservée : ${preservedFields.join(' et ')}.`)
        setSuggestionNotice(messages.join(' '))
      }
    } catch {
      if (mounted.current && generation === suggestionGeneration.current) {
        setError('Impossible d’analyser ce reçu. Vérifie ta connexion puis réessaie.')
      }
    } finally {
      if (mounted.current && generation === suggestionGeneration.current) setExtracting(false)
    }
  }

  async function handleViewReceipt(id: string) {
    try {
      const response = await fetch(`/api/expense-notes/${id}/receipt-url`)
      if (!response.ok) {
        setError(await getClientErrorMessage(response, 'Impossible de récupérer le reçu.'))
        return
      }
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || typeof (result as { url?: unknown }).url !== 'string') {
        throw new Error('Invalid receipt URL')
      }
      window.open((result as { url: string }).url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Impossible de récupérer le reçu. Vérifie ta connexion puis réessaie.')
    }
  }

  async function toggleWorkflowDetails(note: ExpenseNote) {
    if (expandedWorkflowId === note.id) {
      setExpandedWorkflowId(null)
      return
    }
    setExpandedWorkflowId(note.id)
    const kind = note.status === 'pending' ? 'validation' : 'history'
    setWorkflowLoadingId(note.id)
    setWorkflowDetails((current) => ({ ...current, [note.id]: { kind, loading: true } }))
    try {
      const path = kind === 'validation'
        ? `/api/expense-notes/${note.id}/validation-status`
        : `/api/expense-notes/${note.id}/history`
      const response = await fetch(path)
      if (!response.ok) {
        const message = await getClientErrorMessage(response, 'Impossible de charger le circuit de validation.')
        setWorkflowDetails((current) => ({ ...current, [note.id]: { kind, loading: false, error: message } }))
        return
      }
      const result: unknown = await response.json()
      if (kind === 'validation') {
        if (!result || typeof result !== 'object' || !('validation' in result)) throw new Error('Invalid validation status')
        const validation = (result as { validation?: ValidationStatus }).validation
        if (!validation || typeof validation.message !== 'string' || typeof validation.kind !== 'string') throw new Error('Invalid validation status')
        setWorkflowDetails((current) => ({ ...current, [note.id]: { kind, loading: false, validation } }))
      } else {
        if (!result || typeof result !== 'object' || !Array.isArray((result as { items?: unknown }).items)) throw new Error('Invalid decision history')
        const items = (result as { items: DecisionHistoryItem[] }).items
        if (items.some((item) => typeof item.actor?.displayName !== 'string' || typeof item.decidedAt !== 'string')) throw new Error('Invalid decision history')
        setWorkflowDetails((current) => ({ ...current, [note.id]: { kind, loading: false, items } }))
      }
    } catch {
      setWorkflowDetails((current) => ({
        ...current,
        [note.id]: { kind, loading: false, error: 'Impossible de charger le circuit de validation. Vérifie ta connexion puis réessaie.' },
      }))
    } finally {
      setWorkflowLoadingId(null)
    }
  }

  const total = notes.reduce((sum, note) => sum + note.amount, 0)

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mes notes de frais</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {loading && notes.length === 0
            ? 'Chargement de l’historique…'
            : historyError
            ? 'Historique indisponible — utilise le bouton Réessayer dans la section Historique.'
            : notes.length > 0
            ? `${notes.length} note${notes.length > 1 ? 's' : ''} · ${currencyFormatter.format(total)} au total`
            : 'Soumets ta première note de frais ci-dessous.'}
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-base font-semibold">Nouvelle note de frais</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="amount" className="text-sm font-medium">
                Montant (€)
              </label>
              <input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(event) => updateAmount(event.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="expenseDate" className="text-sm font-medium">
                Date
              </label>
              <input
                id="expenseDate"
                name="expenseDate"
                type="date"
                required
                value={expenseDate}
                onChange={(event) => updateExpenseDate(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
            <input
              id="description"
              name="description"
              type="text"
              placeholder="Ex. Taxi aéroport, repas client…"
              required
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="receipt" className="text-sm font-medium">
              Reçu (image ou PDF)
            </label>
            <input
              ref={receiptInputRef}
              id="receipt"
              name="receipt"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              required
              onChange={() => {
                suggestionGeneration.current += 1
                setExtracting(false)
                setSuggestionNotice(null)
              }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-gray-400 dark:file:bg-gray-800 dark:file:text-brand-300"
            />
            <button
              type="button"
              onClick={handleSuggestFields}
              disabled={extracting}
              className="self-start text-sm font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {extracting ? 'Analyse du reçu…' : 'Pré-remplir depuis le reçu'}
            </button>
            {extracting && <p role="status" className="text-sm text-gray-500">Analyse du reçu en cours.</p>}
            {suggestionNotice && (
              <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{suggestionNotice}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Envoi…' : 'Soumettre'}
          </button>
        </form>
      </section>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {submissionNotice && (
        <p role="status" className="text-sm text-green-700 dark:text-green-300">{submissionNotice}</p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 ref={historyHeadingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          Historique
        </h2>
        {historyError && (
          <div className="px-6 py-4">
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">{historyError}</p>
            <button type="button" onClick={retryHistory} disabled={loading} className="mt-2 text-sm font-medium text-brand-600 hover:underline disabled:opacity-60">
              {loading ? 'Actualisation…' : 'Réessayer'}
            </button>
          </div>
        )}
        {loading && notes.length === 0 ? (
          <p role="status" className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Chargement…
          </p>
        ) : historyError && notes.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>Historique indisponible.</p>
          </div>
        ) : notes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Aucune note de frais pour le moment.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} aria-label="Historique des notes de frais, tableau défilant">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 text-right font-medium">Montant</th>
                  <th className="px-6 py-3 font-medium">Statut</th>
                  <th className="px-6 py-3 font-medium">Circuit / décision</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {notes.map((note) => {
                  const details = workflowDetails[note.id]
                  return (
                  <tr key={note.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {formatCivilDate(note.expenseDate)}
                    </td>
                    <td className="px-6 py-3">{note.description}</td>
                    <td className="px-6 py-3 text-right font-medium whitespace-nowrap">
                      {currencyFormatter.format(note.amount)}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge status={note.status} />
                    </td>
                    <td className="px-6 py-3">
                      <button
                        type="button"
                        aria-expanded={expandedWorkflowId === note.id}
                        aria-label={`${expandedWorkflowId === note.id ? 'Masquer' : 'Voir'} ${note.status === 'pending' ? 'le circuit' : 'la décision'} pour ${note.description}`}
                        onClick={() => toggleWorkflowDetails(note)}
                        disabled={workflowLoadingId === note.id}
                        className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-60"
                      >
                        {workflowLoadingId === note.id ? 'Chargement…' : expandedWorkflowId === note.id ? 'Masquer' : note.status === 'pending' ? 'Voir le circuit' : 'Voir la décision'}
                      </button>
                      {expandedWorkflowId === note.id && details && (
                        <div className="mt-2 min-w-56 text-xs text-gray-600 dark:text-gray-300" aria-live="polite">
                          {details.loading ? (
                            <p role="status">Chargement du circuit…</p>
                          ) : details.error ? (
                            <p role="alert">{details.error}</p>
                          ) : details.kind === 'validation' ? (
                            <p role="status">{details.validation?.message}</p>
                          ) : details.kind === 'history' ? (
                            details.items?.length ? (
                              <ul className="space-y-1">
                                {details.items?.map((item) => (
                                  <li key={item.id}>
                                    {item.toStatus === 'approved' ? 'Approuvée' : 'Rejetée'} par {item.actor.displayName} le {formatDecisionDate(item.decidedAt)}.
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p role="status">L’historique de décision ne contient aucun événement.</p>
                            )
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        aria-label={`Voir le reçu pour ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                        onClick={() => handleViewReceipt(note.id)}
                        className="text-sm font-medium text-brand-600 hover:underline"
                      >
                        Voir le reçu
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
