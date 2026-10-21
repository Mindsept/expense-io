import { createHash } from 'node:crypto'

// Fingerprint of the compromised value from the initial commit, never a fallback.
const COMPROMISED_SECRET_SHA256 = '99c7b7067e51ba5a9792598a0856cccd0d64be8f919108f641343c08e84c0b30'
const PLACEHOLDERS = new Set([
  'changeme',
  'change-me',
  'changeme-generate-a-real-secret-for-non-local-use',
  'your-secret',
  'your-auth-secret',
  'replace-me',
])

/** @param {string} value */
export function isKnownAuthSecretPlaceholder(value) {
  const normalized = value.trim().toLowerCase()
  return PLACEHOLDERS.has(normalized) ||
    createHash('sha256').update(normalized).digest('hex') === COMPROMISED_SECRET_SHA256
}

/**
 * Presence/format checks cannot establish entropy or secrecy. Provision with a
 * CSPRNG and keep the resulting value private; never generate it at startup.
 * @param {{ AUTH_SECRET?: string }} [environment]
 */
export function readAuthConfig(environment = process.env) {
  const secret = environment.AUTH_SECRET
  if (
    !secret || secret.length < 32 || secret.length > 512 ||
    /\s/.test(secret) || isKnownAuthSecretPlaceholder(secret)
  ) {
    throw new Error(
      'Invalid AUTH_SECRET configuration. Set a private 32–512 character value without whitespace; ' +
      'local setup: node scripts/generate-auth-secret.mjs. See docs/authentication-configuration.md.'
    )
  }
  return { secret }
}
