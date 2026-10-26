/** Build a web-only environment: never inherit maintenance credentials.
 * @param {{databaseURL: string, runtimeDatabaseURL?: string, env: Record<string, string | undefined>}} target
 * @param {Record<string, string | undefined>} inherited
 */
export function benchmarkWebEnvironment(target, inherited = process.env) {
  let admin, web
  try { admin = new URL(target.databaseURL); web = new URL(target.runtimeDatabaseURL) }
  catch { throw Error('Explicit isolated benchmark runtime connection required.') }
  if (admin.protocol !== 'postgres:' || admin.hostname !== '127.0.0.1' || admin.pathname !== '/expense_io_test' ||
      web.protocol !== admin.protocol || web.hostname !== admin.hostname || web.port !== admin.port ||
      web.pathname !== admin.pathname || web.username !== 'expense_web' || web.password.length < 32 || web.search || web.hash) {
    throw Error('Benchmark web connection must use expense_web on the owned isolated database.')
  }
  const env = { DATABASE_URL: web.href, NODE_ENV: 'production', AWS_EC2_METADATA_DISABLED: 'true' }
  for (const key of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE']) {
    if (inherited[key] !== undefined) env[key] = inherited[key]
  }
  for (const key of ['ARLA_TEST_ENV','ARLA_TEST_PROJECT','S3_ENDPOINT','S3_BUCKET','S3_REGION',
    'S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_FORCE_PATH_STYLE','AUTH_SECRET','AUTH_TRUST_HOST','AUTH_URL','NEXT_TELEMETRY_DISABLED']) {
    if (target.env[key] !== undefined) env[key] = target.env[key]
  }
  return env
}
