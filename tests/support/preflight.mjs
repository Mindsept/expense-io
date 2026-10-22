import path from 'node:path'
import { fileURLToPath } from 'node:url'

function reject(field, requirement) {
  // Never include supplied values: URLs and even malformed fields may be secrets.
  throw new Error(`Unsafe test configuration: ${field} ${requirement}.`)
}

function port(value, field) {
  if (typeof value !== 'string' || !/^[1-9]\d{3,4}$/.test(value) ||
      Number(value) < 1024 || Number(value) > 65535 ||
      ['3000', '5432', '5433', '4566', '4567'].includes(value)) {
    reject(field, 'must select a dedicated test port, not a development or service default')
  }
  return Number(value)
}

function parseUrl(value, field) {
  if (typeof value !== 'string') reject(field, 'must be explicitly set')
  try { return new URL(value) }
  catch { reject(field, 'must be a valid URL') }
}

function loopbackHttp(value, field) {
  const url = parseUrl(value, field)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    reject(field, 'must be plain HTTP on 127.0.0.1 without credentials, path, query or fragment')
  }
  return { url: url.origin, port: port(url.port, field) }
}

/**
 * Pure guard used before preparation and cleanup. Does not load dotenv or open services.
 * @param {Record<string, string | undefined>} env
 */
export function preflight(env = process.env) {
  if (env.ARLA_TEST_ENV !== 'isolated') reject('ARLA_TEST_ENV', 'must equal isolated')
  const project = env.ARLA_TEST_PROJECT
  if (typeof project !== 'string' || !/^arla-ci-[a-z0-9][a-z0-9-]{0,39}$/.test(project)) {
    reject('ARLA_TEST_PROJECT', 'must use the arla-ci- prefix and a lowercase alphanumeric/hyphen suffix')
  }

  const app = loopbackHttp(env.ARLA_TEST_BASE_URL, 'ARLA_TEST_BASE_URL')
  const databasePort = port(env.ARLA_TEST_DB_PORT, 'ARLA_TEST_DB_PORT')
  const storagePort = port(env.ARLA_TEST_S3_PORT, 'ARLA_TEST_S3_PORT')
  const authPort = port(env.HA01_TEST_PORT, 'HA01_TEST_PORT')
  if (new Set([app.port, databasePort, storagePort, authPort]).size !== 4) {
    reject('test ports', 'must be distinct for the application, authentication test, database and storage')
  }

  const database = parseUrl(env.DATABASE_URL, 'DATABASE_URL')
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' ||
      database.port !== String(databasePort) || database.pathname !== '/expense_io_test' ||
      database.username !== 'expense_test' || database.search || database.hash ||
      env.POSTGRES_USER !== 'expense_test' || env.POSTGRES_DB !== 'expense_io_test') {
    reject('DATABASE_URL/POSTGRES_USER/POSTGRES_DB', 'must identify the dedicated loopback expense_test user and expense_io_test database on ARLA_TEST_DB_PORT')
  }
  let databasePassword
  try { databasePassword = decodeURIComponent(database.password) }
  catch { reject('DATABASE_URL password', 'must be valid URL-encoded text') }
  if (!databasePassword || databasePassword.length < 16 || databasePassword !== env.POSTGRES_PASSWORD) {
    reject('POSTGRES_PASSWORD', 'must be generated for this test run and match the database URL password (at least 16 characters)')
  }

  if (env.HA04_TEST_ADMIN_DATABASE_URL !== undefined) {
    const rls = parseUrl(env.HA04_TEST_ADMIN_DATABASE_URL, 'HA04_TEST_ADMIN_DATABASE_URL')
    let rlsPassword
    try { rlsPassword = decodeURIComponent(rls.password) }
    catch { reject('HA04_TEST_ADMIN_DATABASE_URL', 'must use the same generated database credentials') }
    if (!['postgres:', 'postgresql:'].includes(rls.protocol) || rls.hostname !== database.hostname ||
        rls.port !== database.port || rls.username !== database.username || rlsPassword !== databasePassword ||
        rls.pathname !== '/expense_rls_test' || rls.search || rls.hash) {
      reject('HA04_TEST_ADMIN_DATABASE_URL', 'must select expense_rls_test on the same isolated cluster with the same credentials')
    }
  }

  const storage = loopbackHttp(env.S3_ENDPOINT, 'S3_ENDPOINT')
  if (storage.port !== storagePort) reject('S3_ENDPOINT', 'must use ARLA_TEST_S3_PORT')
  if (env.S3_BUCKET !== 'receipts-ci-test') reject('S3_BUCKET', 'must equal receipts-ci-test')
  if (env.S3_ACCESS_KEY_ID !== 'test' || env.S3_SECRET_ACCESS_KEY !== 'test' ||
      env.S3_REGION !== 'us-east-1' || env.S3_FORCE_PATH_STYLE !== 'true') {
    reject('S3 configuration', 'must use the local test credentials, us-east-1 and path-style addressing')
  }

  for (const role of ['HR', 'MANAGER', 'EMPLOYEE']) {
    const email = env[`ARLA_TEST_${role}_EMAIL`]
    const password = env[`ARLA_TEST_${role}_PASSWORD`]
    if (email !== `${role.toLowerCase()}@expense.test` || email !== env[`SEED_${role}_EMAIL`] ||
        typeof password !== 'string' || password.length < 16 || password !== env[`SEED_${role}_PASSWORD`]) {
      reject(`ARLA_TEST_${role}/SEED_${role}`, 'must match the synthetic role email and generated password')
    }
  }

  // This object is safe to print. No connection string, identity or password.
  return Object.freeze({
    project,
    baseUrl: app.url,
    appPort: app.port,
    authPort,
    databaseHost: database.hostname,
    databasePort,
    databaseName: 'expense_io_test',
    databaseUser: 'expense_test',
    rlsDatabaseName: env.HA04_TEST_ADMIN_DATABASE_URL === undefined ? undefined : 'expense_rls_test',
    storageEndpoint: storage.url,
    storagePort,
    bucket: 'receipts-ci-test',
    baseline: 'privileged-bootstrap-no-rls-proof',
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.info(JSON.stringify(preflight())) }
  catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
