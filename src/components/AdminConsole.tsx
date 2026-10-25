'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCivilDate } from '@/utils/civil-date'
import { getClientErrorMessage, isConflict } from '@/utils/client-errors'
import { parsePagedList, type PageInfo, type PageTotals } from '@/utils/paged-list'
import { PaginationControls } from '@/components/PaginationControls'

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
  const [usersPage, setUsersPage] = useState<PageInfo>({ page: 1, pageSize: 20, totalItems: 0 })
  const [usersTotals, setUsersTotals] = useState<PageTotals | null>(null)
  const [managerSearch, setManagerSearch] = useState('')
  const [managerPage, setManagerPage] = useState<PageInfo>({ page: 1, pageSize: 20, totalItems: 0 })
  const [managerCandidates, setManagerCandidates] = useState<CompanyUser[]>([])
  const [selectedManagers, setSelectedManagers] = useState<Record<string, { id: string; name: string; isEligible: boolean }>>({})
  const [managerSearchLoading, setManagerSearchLoading] = useState(false)
  const [managerSearchError, setManagerSearchError] = useState<string | null>(null)
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [usersNotice, setUsersNotice] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [notes, setNotes] = useState<ExpenseNote[]>([])
  const [notesPage, setNotesPage] = useState<PageInfo>({ page: 1, pageSize: 20, totalItems: 0 })
  const [notesTotals, setNotesTotals] = useState<PageTotals | null>(null)
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [notesNotice, setNotesNotice] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const notesHeadingRef = useRef<HTMLHeadingElement>(null)
  const usersHeadingRef = useRef<HTMLHeadingElement>(null)
  const assignmentPending = useRef(false)
  const usersRequestGeneration = useRef(0)
  const notesRequestGeneration = useRef(0)
  const managerSearchGeneration = useRef(0)

  const loadUsers = useCallback(async () => {
    const generation = ++usersRequestGeneration.current
    setUsersLoading(true)
    try {
      const response = await fetch(`/api/hr/users?page=${usersPage.page}&pageSize=${usersPage.pageSize}`)
      if (!response.ok) {
        setUsersError(await getClientErrorMessage(response, "Impossible de charger l'annuaire."))
        return
      }
      const result: unknown = await response.json()
      const pageResult = parsePagedList<CompanyUser>(result, false)
      if (generation !== usersRequestGeneration.current) return
      setUsers(pageResult.items)
      setUsersPage(pageResult.pagination)
      setUsersTotals(pageResult.totals)
      setUsersError(null)
    } catch {
      if (generation !== usersRequestGeneration.current) return
      setUsersError("Impossible de charger l'annuaire. Vérifie la connexion puis réessaie.")
    } finally {
      if (generation === usersRequestGeneration.current) setUsersLoading(false)
    }
  }, [usersPage.page, usersPage.pageSize])

  const loadNotes = useCallback(async () => {
    const generation = ++notesRequestGeneration.current
    setNotesLoading(true)
    try {
      const response = await fetch(`/api/hr/expense-notes?page=${notesPage.page}&pageSize=${notesPage.pageSize}`)
      if (!response.ok) {
        setNotesError(await getClientErrorMessage(response, 'Impossible de charger les notes en attente.'))
        return
      }
      const result: unknown = await response.json()
      const pageResult = parsePagedList<ExpenseNote>(result, true)
      if (generation !== notesRequestGeneration.current) return
      if (pageResult.items.length === 0 && pageResult.pagination.page > 1 &&
          pageResult.pagination.totalItems <= (pageResult.pagination.page - 1) * pageResult.pagination.pageSize) {
        setNotesPage((current) => ({ ...current, page: current.page - 1 }))
        return
      }
      setNotes(pageResult.items)
      setNotesPage(pageResult.pagination)
      setNotesTotals(pageResult.totals)
      setNotesError(null)
    } catch {
      if (generation !== notesRequestGeneration.current) return
      setNotesError('Impossible de charger les notes en attente. Vérifie ta connexion puis réessaie.')
    } finally {
      if (generation === notesRequestGeneration.current) setNotesLoading(false)
    }
  }, [notesPage.page, notesPage.pageSize])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers()
    loadNotes()
  }, [loadUsers, loadNotes])

  useEffect(() => {
    const generation = ++managerSearchGeneration.current
    const controller = new AbortController()
    const loadManagers = async () => {
      setManagerSearchLoading(true)
      try {
        const parameters = new URLSearchParams({ page: String(managerPage.page), pageSize: String(managerPage.pageSize), role: 'manager' })
        if (managerSearch.trim()) parameters.set('q', managerSearch.trim())
        const response = await fetch(`/api/hr/users?${parameters}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Manager search failed')
        const pageResult = parsePagedList<CompanyUser>(await response.json(), false)
        if (generation !== managerSearchGeneration.current) return
        setManagerCandidates(pageResult.items)
        setManagerPage(pageResult.pagination)
        setManagerSearchError(null)
      } catch {
        if (controller.signal.aborted || generation !== managerSearchGeneration.current) return
        setManagerSearchError('Impossible de rechercher les managers. Vérifie la connexion puis réessaie.')
      } finally {
        if (generation === managerSearchGeneration.current) setManagerSearchLoading(false)
      }
    }
    void loadManagers()
    return () => controller.abort()
  }, [managerSearch, managerPage.page, managerPage.pageSize])

  useEffect(() => {
    const ids = [...new Set(users.map((user) => user.managerId).filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return
    let active = true
    void Promise.all(ids.map(async (id) => {
      try {
        const parameters = new URLSearchParams({ page: '1', pageSize: '1', role: 'manager', selectedManagerId: id })
        const response = await fetch(`/api/hr/users?${parameters}`)
        if (!response.ok) return null
        const result = await response.json() as { selectedManager?: { id: string; name: string; isEligible: boolean } | null }
        return result.selectedManager ?? null
      } catch { return null }
    })).then((resolved) => {
      if (!active) return
      setSelectedManagers((current) => ({ ...current, ...Object.fromEntries(resolved.filter((value): value is NonNullable<typeof value> => value !== null).map((value) => [value.id, value])) }))
    })
    return () => { active = false }
  }, [users])

  async function retryUsers() {
    const source = document.activeElement
    await loadUsers()
    if (document.activeElement === source || document.activeElement === document.body) usersHeadingRef.current?.focus()
  }

  async function retryNotes() {
    const source = document.activeElement
    await loadNotes()
    if (document.activeElement === source || document.activeElement === document.body) notesHeadingRef.current?.focus()
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
        if (managerId) {
          const selected = managerCandidates.find((manager) => manager.id === managerId)
          if (selected) setSelectedManagers((current) => ({ ...current, [managerId]: { id: selected.id, name: selected.name, isEligible: true } }))
        }
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
    const source = document.activeElement
    setDecidingId(id)
    setNotesError(null)
    setNotesNotice(null)
    try {
      const response = await fetch(`/api/hr/expense-notes/${id}/${decision}`, { method: 'POST' })
      if (response.ok) {
        setNotesNotice(decision === 'approve' ? 'Note de frais approuvée.' : 'Note de frais rejetée.')
        await loadNotes()
        if (document.activeElement === source || document.activeElement === document.body) notesHeadingRef.current?.focus()
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
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <label htmlFor="manager-search" className="block text-sm font-medium">Rechercher parmi les managers actifs de l’entreprise</label>
          <input id="manager-search" type="search" value={managerSearch}
            onChange={(event) => { setManagerSearch(event.target.value); setManagerPage((current) => ({ ...current, page: 1 })) }}
            className={`${selectClass} mt-2 w-full max-w-md`} />
          {managerSearchError && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{managerSearchError}</p>}
        </div>
        <h2 ref={usersHeadingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          Organigramme{usersTotals ? ` (${usersPage.totalItems})` : ''}
        </h2>
        {usersTotals && <p className="px-6 pt-3 text-sm text-gray-500 dark:text-gray-400">{usersTotals.count} personnes dans l’annuaire.</p>}
        {usersError && (
          <div className="mx-6 mt-4">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {usersError}
            </p>
            <button type="button" onClick={retryUsers} disabled={usersLoading || savingId !== null} className="mt-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-200 disabled:opacity-60">
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
          <div role="region" className="relative overflow-x-auto" tabIndex={0} aria-label="Annuaire de l’entreprise, tableau défilant">
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
                        Manager de {user.name} ({user.email})
                      </label>
                      <select
                        id={`manager-${user.id}`}
                        value={user.managerId ?? ''}
                        disabled={savingId !== null || usersLoading || managerSearchLoading}
                        onChange={(event) => handleManagerChange(user.id, event.target.value)}
                        className={selectClass}
                      >
                        <option value="">— aucun (racine) —</option>
                        {user.managerId && !managerCandidates.some((manager) => manager.id === user.managerId) && (
                          <option value={user.managerId} key={`selected-${user.managerId}`}>
                            {selectedManagers[user.managerId]
                              ? `${selectedManagers[user.managerId].name}${selectedManagers[user.managerId].isEligible ? '' : ' (inactif ou rôle modifié)'}`
                              : 'Manager actuellement affecté'}
                          </option>
                        )}
                        {managerCandidates
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
        {usersPage.totalItems > 0 && (
          <PaginationControls page={usersPage.page} pageSize={usersPage.pageSize} totalItems={usersPage.totalItems}
            disabled={usersLoading || savingId !== null} label="Pagination de l’annuaire"
            onPageChange={(page) => setUsersPage((current) => ({ ...current, page }))} />
        )}
        {managerPage.totalItems > 0 && (
          <PaginationControls page={managerPage.page} pageSize={managerPage.pageSize} totalItems={managerPage.totalItems}
            disabled={managerSearchLoading || savingId !== null} label="Pagination des résultats de recherche de managers"
            onPageChange={(page) => setManagerPage((current) => ({ ...current, page }))} />
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 ref={notesHeadingRef} tabIndex={-1} className="border-b border-gray-200 px-6 py-4 text-base font-semibold focus:outline focus:outline-2 focus:outline-brand-500 dark:border-gray-800">
          Notes des managers racine en attente{notesTotals ? ` (${notesPage.totalItems})` : ''}
        </h2>
        {notesTotals && <p className="px-6 pt-3 text-sm text-gray-500 dark:text-gray-400">
          Total des notes en attente : {notesTotals.count} · {currencyFormatter.format(notesTotals.amount ?? 0)}
        </p>}
        {notesError && (
          <div className="mx-6 mt-4">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {notesError}
            </p>
            <button type="button" onClick={retryNotes} disabled={notesLoading || decidingId !== null} className="mt-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-200 disabled:opacity-60">
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
          <div role="region" className="relative overflow-x-auto" tabIndex={0} aria-label="Notes des managers en attente, tableau défilant">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Manager</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 text-right font-medium">Montant</th>
                  <th className="px-6 py-3"><span className="sr-only">Actions</span></th>
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
                          aria-label={`Voir le reçu de ${authorName}, ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                          onClick={() => handleViewReceipt(note.id)}
                          className="mr-3 text-sm font-medium text-brand-600 hover:underline dark:text-brand-200"
                        >
                          Voir le reçu
                        </button>
                        <button
                          type="button"
                          disabled={decidingId !== null}
                          aria-label={`Approuver la note de ${authorName}, ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                          onClick={() => handleDecide(note.id, 'approve')}
                          className="mr-3 text-sm font-medium text-green-700 hover:underline dark:text-green-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Approuver
                        </button>
                        <button
                          type="button"
                          disabled={decidingId !== null}
                          aria-label={`Rejeter la note de ${authorName}, ${note.description}, ${formatCivilDate(note.expenseDate)}`}
                          onClick={() => handleDecide(note.id, 'reject')}
                          className="text-sm font-medium text-red-600 hover:underline dark:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
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
        {notesPage.totalItems > 0 && (
          <PaginationControls page={notesPage.page} pageSize={notesPage.pageSize} totalItems={notesPage.totalItems}
            disabled={notesLoading || decidingId !== null} label="Pagination des notes RH en attente"
            onPageChange={(page) => setNotesPage((current) => ({ ...current, page }))} />
        )}
      </section>
    </main>
  )
}
