import { expect, type Page } from '@playwright/test'
import { readTestIdentity } from '../../support/test-target'

export const employeeNote = {
  id: '00000000-0000-4000-8000-000000000101',
  userId: '00000000-0000-4000-8000-000000000201',
  amount: 12.34,
  expenseDate: '2026-10-16',
  description: 'Taxi de recette',
  status: 'pending',
  createdAt: '2026-10-16T12:00:00Z',
}

export const companyUsers = [
  { id: employeeNote.userId, name: 'Alice Test', email: 'alice@example.test', role: 'employee', managerId: null },
  { id: '00000000-0000-4000-8000-000000000202', name: 'Bob Test', email: 'bob@example.test', role: 'employee', managerId: null },
  { id: '00000000-0000-4000-8000-000000000203', name: 'Manager Test', email: 'manager@example.test', role: 'manager', managerId: null },
]

export function pagedNotes<T extends { amount?: number }>(items: T[]) {
  return {
    items,
    pagination: { page: 1, pageSize: 20, totalItems: items.length },
    totals: { amount: items.reduce((sum, item) => sum + (item.amount ?? 0), 0), count: items.length, scope: 'filtered' as const },
  }
}

export function pagedDirectory<T>(items: T[]) {
  return {
    items,
    pagination: { page: 1, pageSize: 20, totalItems: items.length },
    totals: { count: items.length, scope: 'filtered' as const },
  }
}

export function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

export class ExpenseUi {
  constructor(readonly page: Page) {}

  async signIn(role: 'EMPLOYEE' | 'MANAGER' | 'HR', path = '/expenses') {
    const identity = readTestIdentity(role)
    await this.page.goto('/login')
    await this.page.getByLabel('Email', { exact: true }).fill(identity.email)
    await this.page.getByLabel('Mot de passe', { exact: true }).fill(identity.password)
    await this.page.getByRole('button', { name: 'Se connecter', exact: true }).click()
    await expect(this.page).toHaveURL(/\/expenses$/)
    if (path !== '/expenses') await this.page.goto(path)
  }

  async attachReceipt(name = 'receipt.png') {
    await this.page.getByLabel('Reçu (image ou PDF)', { exact: true }).setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    })
  }

  async fillExpense() {
    await this.page.getByLabel('Montant (€)', { exact: true }).fill('12.34')
    await this.page.getByLabel('Date', { exact: true }).fill('2026-10-16')
    await this.page.getByLabel('Description', { exact: true }).fill('Nouvelle note de recette')
    await this.attachReceipt()
  }
}
