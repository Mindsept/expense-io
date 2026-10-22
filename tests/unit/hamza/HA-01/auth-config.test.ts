import { randomBytes } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { decode, encode } from 'next-auth/jwt'
import { isKnownAuthSecretPlaceholder, readAuthConfig } from '../../../../src/lib/auth-config.mjs'

const directories: string[] = []
const generator = resolve('scripts/generate-auth-secret.mjs')
function environment(contents?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'expense-ha-01-'))
  directories.push(directory)
  const file = join(directory, '.env')
  if (contents !== undefined) writeFileSync(file, contents, { mode: 0o600 })
  return file
}
function generate(file: string) {
  return execFileSync(process.execPath, [generator, file], { encoding: 'utf8' })
}
function readSecret(file: string) {
  const secret = parseEnv(readFileSync(file, 'utf8')).AUTH_SECRET
  if (!secret) throw new Error('No secret provisioned')
  return secret
}
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('authentication configuration', () => {
  it.each([undefined, '', ' ', 'short', 'changeme-generate-a-real-secret-for-non-local-use', ` ${'a'.repeat(32)}`, 'a'.repeat(513)])(
    'rejects missing, placeholder and malformed configuration without reflecting it (case %#)',
    (secret) => {
      expect(() => readAuthConfig({ AUTH_SECRET: secret })).toThrow('Invalid AUTH_SECRET configuration')
      try { readAuthConfig({ AUTH_SECRET: secret }) } catch (error) {
        const message = (error as Error).message
        if (secret && secret.trim() && secret.length > 5) expect(message).not.toContain(secret)
        expect(message).toContain('node scripts/generate-auth-secret.mjs')
      }
    }
  )

  it('rejects the previously published secret using its fingerprint', () => {
    // PUBLIC, COMPROMISED negative-test input from initial commit 265924b.
    // Never use this value for an environment, including test servers.
    const old = 'e29f9c3b6a1d4e7f8021c5b6d4a9f0e3c7b8a2d1f6e5c4b3a2918273645fabcd'
    expect(isKnownAuthSecretPlaceholder(old)).toBe(true)
    expect(() => readAuthConfig({ AUTH_SECRET: old })).toThrow('Invalid AUTH_SECRET configuration')
  })

  it('uses the explicitly supplied environment unchanged', () => {
    const secret = randomBytes(32).toString('base64url')
    expect(readAuthConfig({ AUTH_SECRET: secret })).toEqual({ secret })
    expect(readAuthConfig({ AUTH_SECRET: secret })).toEqual({ secret })
  })

  it('invalidates an existing Auth.js encrypted session after rotation', async () => {
    const oldSecret = readAuthConfig({ AUTH_SECRET: randomBytes(32).toString('base64url') }).secret
    const newSecret = readAuthConfig({ AUTH_SECRET: randomBytes(32).toString('base64url') }).secret
    const salt = 'authjs.session-token'
    const token = await encode({ secret: oldSecret, salt, token: { sub: 'test-user' } })
    expect((await decode({ token, secret: oldSecret, salt }))?.sub).toBe('test-user')
    await expect(decode({ token, secret: newSecret, salt })).rejects.toThrow()
  })
})

describe('explicit local secret provisioning', () => {
  it('generates independent private values without printing them', () => {
    const files = [environment(), environment()]
    for (const file of files) {
      const output = generate(file)
      const secret = readSecret(file)
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32)
      expect(readAuthConfig({ AUTH_SECRET: secret }).secret).toBe(secret)
      expect(output).not.toContain(secret)
      expect(lstatSync(file).isFile()).toBe(true)
      // Windows stat mode bits do not describe its access-control list. POSIX
      // environments must still prove the exact private mode; no weakened mask.
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    }
    expect(readSecret(files[0])).not.toBe(readSecret(files[1]))
  })

  it.each(['', 'changeme-generate-a-real-secret-for-non-local-use', 'replace-me'])(
    'replaces an empty or identified placeholder entry (case %#)',
    (placeholder) => {
      const file = environment(`DATABASE_URL=untouched\nAUTH_SECRET="${placeholder}"\nOTHER=keep\n`)
      generate(file)
      expect(readSecret(file)).not.toBe(placeholder)
      expect(parseEnv(readFileSync(file, 'utf8')).DATABASE_URL).toBe('untouched')
      expect(parseEnv(readFileSync(file, 'utf8')).OTHER).toBe('keep')
    }
  )

  it('does not rotate a real secret on repeated runs or rewrite the file', () => {
    const file = environment()
    generate(file)
    const initial = readFileSync(file, 'utf8')
    const metadata = statSync(file)
    generate(file)
    generate(file)
    expect(readFileSync(file, 'utf8')).toBe(initial)
    expect(statSync(file).mtimeMs).toBe(metadata.mtimeMs)
  })

  it('preserves a valid existing quoted secret and all surrounding contents', () => {
    const secret = randomBytes(32).toString('base64')
    const contents = `# existing file\nexport AUTH_SECRET='${secret}' # keep\nOTHER=unchanged\n`
    const file = environment(contents)
    expect(generate(file)).not.toContain(secret)
    expect(readFileSync(file, 'utf8')).toBe(contents)
  })

  it.each(['AUTH_SECRET=too-short\n', 'AUTH_SECRET=\nAUTH_SECRET=\n', 'AUTH_SECRET="\nreplace-me\n"\n'])(
    'requires an explicit decision for malformed, duplicate or multiline entries (case %#)',
    (contents) => {
      const file = environment(contents)
      const result = spawnSync(process.execPath, [generator, file], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(readFileSync(file, 'utf8')).toBe(contents)
      expect(result.stderr).not.toContain('too-short')
    }
  )

  it('does not follow a filesystem link or overwrite its destination', () => {
    const file = environment('OTHER=keep\n')
    const linked = join(dirname(environment()), '.env.link')
    // File symlinks need Windows developer mode/admin privileges. A real NTFS
    // junction exercises the same lstat rejection without those prerequisites.
    // Linux/macOS continue exercising a file symlink, including in CI.
    symlinkSync(process.platform === 'win32' ? dirname(file) : file, linked,
      process.platform === 'win32' ? 'junction' : 'file')
    expect(lstatSync(linked).isSymbolicLink()).toBe(true)
    const result = spawnSync(process.execPath, [generator, linked], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('The environment target must be a regular file, not a symlink.')
    expect(readFileSync(file, 'utf8')).toBe('OTHER=keep\n')
  })

  it('preserves a pre-existing temporary file when exclusive creation fails', () => {
    const file = environment('OTHER=keep\n')
    const marker = join(resolve(file, '..'), 'stale-path')
    const source = `
      import { writeFileSync } from 'node:fs';
      const file = ${JSON.stringify(file)};
      const stale = file + '.auth-secret-' + process.pid + '.tmp';
      writeFileSync(stale, 'pre-existing content');
      writeFileSync(${JSON.stringify(marker)}, stale);
      process.argv = [process.execPath, ${JSON.stringify(generator)}, file];
      await import(${JSON.stringify(pathToFileURL(generator).href)});
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(readFileSync(readFileSync(marker, 'utf8'), 'utf8')).toBe('pre-existing content')
    expect(readFileSync(file, 'utf8')).toBe('OTHER=keep\n')
  })
})
