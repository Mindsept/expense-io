import { randomBytes } from 'node:crypto'

const roles = { EMPLOYEE: 'employee', MANAGER: 'manager', HR: 'hr' }
const secret = () => randomBytes(32).toString('base64url')

export function createTestConfig() {
  const id = randomBytes(4).toString('hex')
  const dbPassword = secret()
  return {
    mode: 'isolated', id, project: `arla-test-${id}`,
    appPort: 3210, dbPort: 55440, s3Port: 45740, authPort: 3211,
    database: `expense_${id}_test`, bucket: `receipts-${id}-test`,
    databaseURL: `postgres://expense_test:${dbPassword}@127.0.0.1:55440/expense_${id}_test`,
    baseURL: 'http://127.0.0.1:3210', s3URL: 'http://127.0.0.1:45740',
    authSecret: secret(), fixturePassword: secret(),
    accounts: Object.fromEntries(Object.entries(roles).map(([key, role]) =>
      [key, { email: `${role}@mathis-${id}.example.test`, password: secret() }])),
  }
}

/** Validate the entire target before calling Docker, SQL, S3 or any cleanup. */
export function validateTestConfig(config) {
  const fail = () => { throw new Error('Unsafe test target: require the isolated marker, owned project/database/bucket and explicit matching loopback ports. No preparation or cleanup was started.') }
  if (!config || typeof config !== 'object' || config.mode !== 'isolated' ||
      !/^[a-f0-9]{8}$/.test(config.id ?? '') || config.project !== `arla-test-${config.id}` ||
      config.database !== `expense_${config.id}_test` || config.bucket !== `receipts-${config.id}-test`) fail()
  const ports = [config.appPort, config.dbPort, config.s3Port, config.authPort]
  if (ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535 || [3000,5433,4567].includes(port)) || new Set(ports).size !== 4) fail()
  let database, app, storage
  try { database = new URL(config.databaseURL); app = new URL(config.baseURL); storage = new URL(config.s3URL) }
  catch { fail() }
  if (![database,app,storage].every(url => url.hostname === '127.0.0.1' && !url.search && !url.hash)) fail()
  if (database.protocol !== 'postgres:' || database.username !== 'expense_test' ||
      !/^[A-Za-z0-9_-]{43}$/.test(database.password) || database.port !== String(config.dbPort) ||
      database.pathname !== `/${config.database}`) fail()
  for (const [url, port] of [[app,config.appPort],[storage,config.s3Port]]) {
    if (url.protocol !== 'http:' || url.username || url.password || url.port !== String(port) || url.pathname !== '/') fail()
  }
  if (![config.authSecret,config.fixturePassword].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value))) fail()
  if (Object.keys(config.accounts ?? {}).sort().join(',') !== 'EMPLOYEE,HR,MANAGER') fail()
  for (const [key,role] of Object.entries(roles)) {
    const account = config.accounts?.[key]
    if (!account || account.email !== `${role}@mathis-${config.id}.example.test` || !/^[A-Za-z0-9_-]{43}$/.test(account.password ?? '')) fail()
  }
  return config
}

export function assertLocalDockerEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !/^(unix:\/\/\/|npipe:\/\/)/.test(endpoint.trim())) {
    throw new Error('Test preparation refuses a remote Docker endpoint. Select a local Unix socket or Windows named pipe.')
  }
}

/** @returns {Record<string, string>} */
export function testEnvironment(config) {
  validateTestConfig(config)
  const env = {
    ARLA_TEST_ENV: 'isolated', ARLA_TEST_BASE_URL: config.baseURL,
    DATABASE_URL: config.databaseURL, AUTH_SECRET: config.authSecret, AUTH_TRUST_HOST: 'true',
    S3_ENDPOINT: config.s3URL, S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test',
    S3_BUCKET: config.bucket, S3_FORCE_PATH_STYLE: 'true', NEXT_TELEMETRY_DISABLED: '1',
    TEST_RUN_ID: config.id, TEST_DB_NAME: config.database, TEST_DB_PASSWORD: new URL(config.databaseURL).password,
    TEST_DB_PORT: String(config.dbPort), TEST_S3_PORT: String(config.s3Port),
    HA01_SERVER_MODE: 'production', HA01_TEST_PORT: String(config.authPort), HA07_TEST_PASSWORD: config.fixturePassword,
  }
  for (const prefix of ['HA01','HA07','LE04','LE12']) {
    env[`${prefix}_TEST_DATABASE_URL`] = config.databaseURL
    env[`${prefix}_TEST_BASE_URL`] = config.baseURL
  }
  for (const [role,account] of Object.entries(config.accounts)) {
    for (const prefix of ['ARLA_TEST','SEED']) {
      env[`${prefix}_${role}_EMAIL`] = account.email
      env[`${prefix}_${role}_PASSWORD`] = account.password
    }
  }
  // Temporary real-contract failure: removed after the remote red-CI control.
  env.ARLA_TEST_EMPLOYEE_PASSWORD = 'intentional-ci-negative-control'
  return env
}

export function redactTestOutput(text, config) {
  const values = [config.databaseURL,new URL(config.databaseURL).password,config.authSecret,
    config.fixturePassword,...Object.values(config.accounts).map(account => account.password)]
  let output = String(text)
  for (const value of values.sort((a,b) => b.length-a.length)) output = output.split(value).join('[REDACTED]')
  return output.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[DATABASE_URL_REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]*X-Amz-[^\s"'<>]*/gi,'[SIGNED_URL_REDACTED]')
    .replace(/(set-cookie:\s*)[^\r\n"']+/gi,'$1[REDACTED]')
}

export function summarizeTarget(config) {
  validateTestConfig(config)
  return { project: config.project, database: config.database, bucket: config.bucket,
    appPort: config.appPort, dbPort: config.dbPort, s3Port: config.s3Port,
    isolation: 'bootstrap-reference-only; HA-04 restricted role and business fixtures not integrated' }
}
