import { Pool } from 'pg'

/** Explicit administrator operation. Never loaded by web code and never reads .env. */
export async function provisionRuntime(pool, password) {
  if (typeof password !== 'string' || Buffer.byteLength(password)<32 || Buffer.byteLength(password)>256 || /[\r\n\0]/.test(password)) throw Error('A private runtime password of at least 32 bytes is required.')
  const client = await pool.connect()
  try {
    const {rows:[identity]} = await client.query('SELECT current_user AS current_role,session_user AS login_role,rolsuper FROM pg_roles WHERE rolname=current_user')
    if (!identity?.rolsuper || identity.current_role!==identity.login_role) throw Error('Use a separate actual administrator login, without SET ROLE.')
    const {rows:[role]} = await client.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname='expense_web'")
    if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolinherit) throw Error('Apply/review the HA-04 role migration first.')
    const sql = (await client.query("SELECT format('ALTER ROLE expense_web LOGIN PASSWORD %L',$1::text) AS command",[password])).rows[0].command
    await client.query(sql)
  } finally { client.release() }
}

export async function provisionFromEnvironment(env, input) {
  if (!env.HA04_ADMIN_DATABASE_URL) throw Error('Private HA04_ADMIN_DATABASE_URL is required; web DATABASE_URL is never used as fallback.')
  const pool = new Pool({connectionString:env.HA04_ADMIN_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:5000})
  try { await provisionRuntime(pool,input) } finally { await pool.end() }
}
