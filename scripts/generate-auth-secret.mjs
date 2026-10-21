import { randomBytes } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { isKnownAuthSecretPlaceholder, readAuthConfig } from '../src/lib/auth-config.mjs'

// Explicit provisioning only: this script is never called by auth initialization.
// Node 24+ is the project's documented runtime; no npm dependency is required.
const file = resolve(process.argv[2] ?? '.env')
const lock = `${file}.auth-secret.lock`
const temporary = `${file}.auth-secret-${process.pid}.tmp`
let descriptor
let ownsTemporary = false
try {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/generate-auth-secret.mjs [env-file]')
  descriptor = openSync(lock, 'wx', 0o600)
  let contents = ''
  try {
    if (!lstatSync(file).isFile()) throw new Error('The environment target must be a regular file, not a symlink.')
    contents = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const assignments = contents.split(/\r?\n/).filter((line) => /^(?:\s*export\s+|\s*)AUTH_SECRET\s*=/.test(line))
  if (assignments.length > 1) throw new Error('Multiple AUTH_SECRET entries found. Resolve them explicitly before provisioning.')
  const current = parseEnv(contents).AUTH_SECRET
  if (current && !isKnownAuthSecretPlaceholder(current)) {
    readAuthConfig({ AUTH_SECRET: current })
    console.log('Existing AUTH_SECRET preserved. No secret was printed or changed.')
  } else {
    // A multiline assignment needs an explicit operator edit to avoid leaving
    // trailing quoted content that could change the meaning of unrelated keys.
    if (assignments.length === 1 && parseEnv(assignments[0]).AUTH_SECRET !== current) {
      throw new Error('Multiline AUTH_SECRET entry found. Remove it explicitly before provisioning.')
    }
    const assignment = `AUTH_SECRET=${randomBytes(32).toString('base64url')}`
    const updated = assignments.length === 1
      ? contents.replace(/^(?:\s*export\s+|[ \t]*)AUTH_SECRET\s*=.*$/m, assignment)
      : `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${assignment}\n`
    const temporaryDescriptor = openSync(temporary, 'wx', 0o600)
    ownsTemporary = true
    try {
      writeFileSync(temporaryDescriptor, updated)
    } finally {
      closeSync(temporaryDescriptor)
    }
    renameSync(temporary, file)
    console.log('Private AUTH_SECRET configured. Keep the environment file outside Git.')
  }
} catch (error) {
  // File-system errors may contain paths; never forward arbitrary error values.
  const safeMessages = [
    'Usage: node scripts/generate-auth-secret.mjs [env-file]',
    'The environment target must be a regular file, not a symlink.',
    'Multiple AUTH_SECRET entries found. Resolve them explicitly before provisioning.',
    'Multiline AUTH_SECRET entry found. Remove it explicitly before provisioning.',
  ]
  const message = error instanceof Error ? error.message : ''
  console.error(safeMessages.includes(message) || message.startsWith('Invalid AUTH_SECRET configuration.')
    ? message
    : 'AUTH_SECRET provisioning failed. Check the target directory, permissions and any active provisioning lock; no secret was printed.')
  process.exitCode = 1
} finally {
  if (descriptor !== undefined) {
    closeSync(descriptor)
    if (ownsTemporary) {
      try { unlinkSync(temporary) } catch { /* No temporary file after successful rename. */ }
    }
    unlinkSync(lock)
  }
}
