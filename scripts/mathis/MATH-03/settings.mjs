import { createHash } from 'node:crypto'

export class DemoSeedError extends Error {
  constructor(code) { super(`Demo preparation refused: ${code}. See docs/demo.md.`); this.code = code }
}
const recognisedSettings = new WeakSet()
export function assertDemoSettings(settings) { if(!recognisedSettings.has(settings)) throw new DemoSeedError('validated_configuration_required') }
const refuse = code => { throw new DemoSeedError(code) }
/** Pure guard: no dotenv, driver, storage request or mutation. */
export function demoSettings(env) {
  let database, endpoint
  try { database = new URL(env.SEED_ADMIN_DATABASE_URL); endpoint = new URL(env.S3_ENDPOINT) }
  catch { refuse('explicit_configuration_required') }
  const name = database.pathname.slice(1)
  if (env.SEED_DEMO_ENV !== 'local-test' || env.SEED_CONFIRM_DATABASE !== name ||
      !/^(expense_(?:io|demo)|math03_[a-f0-9]{32})_test$/.test(name) ||
      !['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' ||
      !database.port || ['5432','5433'].includes(database.port) || !database.username || !database.password ||
      database.username === 'expense_web' || database.search || database.hash) refuse('non_demo_database')
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port ||
      ['4566','4567'].includes(endpoint.port) || endpoint.pathname !== '/' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !['receipts-ci-test','receipts-demo-test'].includes(env.S3_BUCKET) || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) refuse('non_demo_storage')
  const roles = [['HR','hr_admin','Hr'],['MANAGER','manager','Manager'],['EMPLOYEE','employee','Demo']].map(([key,role,name]) => {
    const email = env[`SEED_${key}_EMAIL`]?.trim().toLowerCase()
    if (!email || !/^[^\s@]+@(?:[a-z0-9-]+\.)+test$/.test(email)) refuse('synthetic_emails_required')
    return { key, role, name, email, password: env[`SEED_${key}_PASSWORD`] }
  })
  const domain = roles[0].email.split('@')[1]
  if (new Set(roles.map(x => x.email)).size !== 3 || roles.some(x => x.email.split('@')[1] !== domain)) refuse('demo_identity_conflict')
  const result = { databaseURL: database.href, databaseName: name, endpoint: endpoint.origin, bucket: env.S3_BUCKET,
    region: env.S3_REGION || 'us-east-1', accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, domain, roles: Object.freeze(roles.map(role=>Object.freeze(role))) }
  recognisedSettings.add(result)
  return Object.freeze(result)
}

/** Stable UUID/key plus exact marker and verified actor, never a fuzzy description. */
export function demoNote(actorId, kind) {
  const hex = createHash('sha256').update(`ARLA:MATH-03:v1:${actorId}:${kind}`).digest('hex')
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
  const employee = kind === 'EMPLOYEE'
  return { id, key: `receipts/${id}.png`, description: `[ARLA:MATH-03:v1:${kind}] ${employee ? 'Taxi aéroport' : 'Café client'}`,
    legacyDescription: employee ? 'Taxi aéroport (seed)' : 'Café client (seed)', amount: employee ? '42.50' : '5.90' }
}
export function selectDemoNote(rows, actorId, expected) {
  if (rows.length > 1) refuse('ambiguous_demo_notes')
  const row = rows[0]
  if (row && (row.id !== expected.id || row.user_id !== actorId || row.description !== expected.description ||
      (row.receipt_key !== '' && row.receipt_key !== expected.key))) refuse('unrecognised_demo_note')
  return row
}
