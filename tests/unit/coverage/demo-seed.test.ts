import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { S3Client } from '@aws-sdk/client-s3'
import { runDemoSeed } from '../../../scripts/mathis/MATH-03/seed'
import { demoNote, demoSettings } from '../../../scripts/mathis/MATH-03/settings.mjs'
import { newDemo } from '../../../scripts/mathis/MATH-06/guards.mjs'
import { database } from './database-helper'
const storage = vi.hoisted(() => ({ healthy: vi.fn(), put: vi.fn(), remove: vi.fn(), bucket: vi.fn() }))
vi.mock('../../../scripts/mathis/MATH-03/storage.mjs', () => ({ DEMO_PNG: Buffer.from('png'), healthyDemoObject: storage.healthy, putDemoObject: storage.put, removeDemoObject: storage.remove, checkDemoBucket: storage.bucket }))
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'password-hash' } }))
const config = newDemo({ app: 3215, auth: 3216, db: 55440, s3: 45740 })
const settings = () => demoSettings({ ...config.env, SEED_ADMIN_DATABASE_URL: config.env.DATABASE_URL, SEED_DEMO_ENV: 'local-test', SEED_CONFIRM_DATABASE: 'expense_io_test' })
const actors = ['HR', 'MANAGER', 'EMPLOYEE'].map((key, index) => ({ id: `${index + 1}`.repeat(8) + '-1111-4111-8111-111111111111', company_id: 'company', role: key === 'HR' ? 'hr_admin' : key.toLowerCase(), name: key, manager_id: key === 'EMPLOYEE' ? 'manager' : null, is_active: true }))
beforeEach(() => { vi.resetAllMocks(); storage.healthy.mockResolvedValue(false) })
afterEach(() => vi.restoreAllMocks())
function fixture(options: { existing?: boolean; notes?: boolean; receiptKey?: string; identity?: boolean; locked?: boolean; foreign?: boolean; inactive?: boolean; legacy?: boolean; updateCount?: number; failInsert?: boolean; commitFailure?: boolean } = {}) {
  let companyCreated = false, commits = 0
  return database((sql, values) => {
    if (sql.includes('current_database()')) return { rows: [{ database: 'expense_io_test', current_role: 'expense_test', login: 'expense_test', rolsuper: options.identity ?? true }] }
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: options.locked ?? true }] }
    if (sql.includes('SELECT id FROM companies')) return { rows: options.existing || companyCreated ? [{ id: 'company' }] : [] }
    if (sql.includes('INSERT INTO companies')) { companyCreated = true; return { rows: [{ id: 'company' }] } }
    if (sql.includes('WHERE email=$1')) return { rows: options.existing ? [{ ...actors.find(a => `${a.name.toLowerCase()}@expense.test` === values[0]), ...(options.foreign ? { company_id: 'foreign' } : {}) }] : [] }
    if (sql.includes('INSERT INTO users')) return { rows: [actors.find(a => a.role === values[3])] }
    if (sql.includes('FROM users WHERE id=$1')) return { rows: [{ ...actors.find(a => a.id === values[0]), is_active: !options.inactive }] }
    if (sql.includes('SELECT id,user_id,description,receipt_key')) {
      const actor = actors.find(a => a.id === values[0])!, expected = demoNote(actor.id, actor.name)
      return { rows: options.notes ? [{ id: expected.id, user_id: actor.id, description: expected.description, receipt_key: options.receiptKey ?? expected.key }] : [] }
    }
    if (sql.includes('SELECT 1 FROM expense_notes')) return { rows: [], rowCount: options.legacy ? 1 : 0 }
    if (sql.includes('INSERT INTO expense_notes')) { if (options.failInsert) throw new Error('insert failed'); return { rows: [{ id: values[0], user_id: values[1], description: values[4], receipt_key: values[5] }] } }
    if (sql.includes('UPDATE expense_notes')) return { rows: [{ id: 'note' }], rowCount: options.updateCount ?? 1 }
    if (sql === 'COMMIT' && ++commits > 1 && options.commitFailure) throw new Error('commit lost')
    return { rows: [] }
  })
}
const s3 = {} as S3Client
describe('synthetic demo initialization', () => {
  it('creates the three actors and two complete receipts with the real submission service', async () => {
    const db = fixture(), checkpoint = vi.fn(async () => {})
    expect(await runDemoSeed(settings(), { pool: db.pool, s3, checkpoint })).toMatchObject({ companiesCreated: 1, usersCreated: 3, notesCreated: 2, receiptsUploaded: 2, cleanupNotices: [] })
    expect(storage.put).toHaveBeenCalledTimes(2); expect(checkpoint).toHaveBeenCalledTimes(6); expect(db.release).toHaveBeenCalledOnce()
    expect(db.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock')
  })
  it('preserves existing healthy actors, notes and receipts', async () => {
    storage.healthy.mockResolvedValue(true); const db = fixture({ existing: true, notes: true })
    expect(await runDemoSeed(settings(), { pool: db.pool, s3 })).toMatchObject({ usersPreserved: 3, notesPreserved: 2, notesCreated: 0, receiptsUploaded: 0 })
    expect(storage.put).not.toHaveBeenCalled()
  })
  it.each([false, true])('repairs only recognized notes, reusing healthy objects (%s)', async healthy => {
    storage.healthy.mockResolvedValue(healthy); const db = fixture({ existing: true, notes: true, receiptKey: '' })
    expect(await runDemoSeed(settings(), { pool: db.pool, s3, mode: 'repair' })).toMatchObject({ receiptsRepaired: 2, notesPreserved: 2, receiptsUploaded: healthy ? 0 : 2 })
  })
  it.each([
    [{ identity: false }, 'separate_maintenance_login_required'], [{ locked: false }, 'demo_preparation_busy'],
    [{ existing: true, foreign: true }, 'foreign_demo_identity'], [{ existing: true, inactive: true }, 'demo_actor_changed'],
    [{ existing: true, legacy: true }, 'legacy_demo_requires_review'], [{ existing: true, notes: true }, 'receipt_incomplete_run_seed_repair'],
  ] as const)('refuses unsafe initialization %j', async (options, code) => {
    const db = fixture(options)
    await expect(runDemoSeed(settings(), { pool: db.pool, s3 })).rejects.toThrow(code)
    expect(storage.put).not.toHaveBeenCalled(); expect(db.release).toHaveBeenCalledOnce()
  })
  it.each([{ existing: false }, { existing: true }])('repair never creates missing identities or notes (%j)', async options => {
    const db = fixture(options)
    await expect(runDemoSeed(settings(), { pool: db.pool, s3, mode: 'repair' })).rejects.toThrow('initialisation_required')
    expect(storage.put).not.toHaveBeenCalled()
  })
  it('requires strong private passwords for new demo accounts', async () => {
    const input = { ...config.env, SEED_ADMIN_DATABASE_URL: config.env.DATABASE_URL, SEED_DEMO_ENV: 'local-test', SEED_CONFIRM_DATABASE: 'expense_io_test', SEED_HR_PASSWORD: '' }
    const db = fixture(); await expect(runDemoSeed(demoSettings(input), { pool: db.pool, s3 })).rejects.toThrow('private_initial_password_required')
  })
  it('fails safely when a note changes during repair', async () => {
    const db = fixture({ existing: true, notes: true, receiptKey: '', updateCount: 0 })
    await expect(runDemoSeed(settings(), { pool: db.pool, s3, mode: 'repair' })).rejects.toThrow('demo_note_changed')
    expect(db.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true)
  })
  it.each([false, true])('cleans only certainly uncommitted receipts (uncertain=%s)', async uncertain => {
    const db = fixture({ failInsert: !uncertain, commitFailure: uncertain })
    await expect(runDemoSeed(settings(), { pool: db.pool, s3 })).rejects.toThrow()
    expect(storage.remove).toHaveBeenCalledTimes(uncertain ? 0 : 1)
    expect(db.release).toHaveBeenCalledOnce()
  })
  it('refuses expired work before uploading receipts', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(60001)
    const db = fixture({ existing: true }); await expect(runDemoSeed(settings(), { pool: db.pool, s3 })).rejects.toThrow('operation_deadline')
    expect(storage.put).not.toHaveBeenCalled()
  })
})
