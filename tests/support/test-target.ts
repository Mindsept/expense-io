/** Read only explicitly selected test settings. Never load a development .env. */
export function readTestTarget(env: Record<string, string | undefined> = process.env): string {
  if (env.ARLA_TEST_ENV !== 'isolated' || !env.ARLA_TEST_BASE_URL) {
    throw new Error('Set ARLA_TEST_ENV=isolated and ARLA_TEST_BASE_URL to the dedicated local test application.')
  }
  let url: URL
  try { url = new URL(env.ARLA_TEST_BASE_URL) }
  catch { throw new Error('ARLA_TEST_BASE_URL must be a valid local test URL.') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port || Number(url.port) < 1024 || url.port === '3000' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ARLA_TEST_BASE_URL must use HTTP loopback with an explicit dedicated port (not 3000), without credentials, path or query.')
  }
  return url.origin
}

export function readTestIdentity(role: 'EMPLOYEE' | 'MANAGER' | 'HR', env: Record<string, string | undefined> = process.env) {
  const email = env[`ARLA_TEST_${role}_EMAIL`]
  const password = env[`ARLA_TEST_${role}_PASSWORD`]
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    throw new Error(`Set ARLA_TEST_${role}_EMAIL and ARLA_TEST_${role}_PASSWORD for a synthetic account in the isolated test database.`)
  }
  return { email, password }
}
