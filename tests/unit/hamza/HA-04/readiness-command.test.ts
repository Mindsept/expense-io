import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('private RLS readiness command', () => {
  it('requires an explicit connection without reaching a default database', () => {
    const env = { ...process.env }
    delete env.DATABASE_URL
    const result = spawnSync(process.execPath, ['scripts/check-rls-readiness.mjs'], { env, encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('DATABASE_URL is required. Supply the application connection privately.\n')
  })

  it('redacts malformed connection values even when the client constructor throws', () => {
    const privateValue = 'postgres://private-user:private-password@invalid host/expense'
    const result = spawnSync(process.execPath, ['scripts/check-rls-readiness.mjs'], {
      env: { ...process.env, DATABASE_URL: privateValue }, encoding: 'utf8',
    })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('RLS inspection failed; check the private connection and database access.\n')
    expect(result.stderr).not.toContain(privateValue)
  })
})
