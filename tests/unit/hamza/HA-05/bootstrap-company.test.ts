import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { bootstrapCompany } from '../../../../proposals/HA-05/bootstrap-company.mjs'

const input = () => ({ companyName: 'Explicit company', companyDomain: 'company.test', name: 'First HR', email: 'first@unrelated.test', password: randomBytes(24).toString('base64url') })
describe('offline administrator bootstrap boundary', () => {
  it.each([{ companyName: '' }, { companyDomain: 'not a domain' }, { name: '' }, { email: 'bad' }, { password: 'short' }, { password: 'é'.repeat(37) }, { role: 'hr_admin' }])('refuses invalid/forged fields before any connection (case %#)', async patch => {
    const connect = vi.fn()
    await expect(bootstrapCompany({ connect }, { ...input(), ...patch })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(connect).not.toHaveBeenCalled()
  })
  it('rejects an untrusted schema identifier before opening an administrator connection', async () => {
    const connect = vi.fn()
    await expect(bootstrapCompany({ connect }, input(), { schemaName: 'public; SELECT 1' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(connect).not.toHaveBeenCalled()
  })
  it('requires explicit apply and a separate private administrator connection', () => {
    const env = { ...process.env }; delete env.HA05_BOOTSTRAP_DATABASE_URL
    env.DATABASE_URL = 'postgres://private:private@invalid/private'
    const result = spawnSync(process.execPath, ['proposals/HA-05/bootstrap-company-cli.mjs', '--apply'], { env, encoding: 'utf8', input: '{}' })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('HA05_BOOTSTRAP_DATABASE_URL')
    expect(result.stderr).not.toContain('postgres://')
  })
})
