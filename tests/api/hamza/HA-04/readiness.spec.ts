import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { Pool } from 'pg'
import { inspectRls } from '../../../../scripts/rls/readiness.mjs'
import { withUserScope } from '../../../../src/lib/db'

// This suite provisions its own roles only in an explicitly empty, local test DB.
const connection = process.env.HA04_TEST_ADMIN_DATABASE_URL
if (!connection) throw new Error('Set HA04_TEST_ADMIN_DATABASE_URL to an empty disposable local *_test database.')
const target = new URL(connection)
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname) || !decodeURIComponent(target.pathname).endsWith('_test')) {
  throw new Error('HA-04 requires an empty disposable local *_test database.')
}
const admin = new Pool({ connectionString: connection, max: 1 })
const role = `ha04_${randomUUID().replaceAll('-', '')}`
const password = randomBytes(32).toString('base64url')
let runtime: Pool
let ownsSchema = false
let ownsRole = false

test.beforeAll(async () => {
  const existing = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
  if (existing.rows.length) throw new Error('HA-04 refuses a database that already has public tables.')
  ownsSchema = true
  for (const migration of [
    '1700000000001_init-schema.sql',
    '1792583999000_hamza_current-account.sql',
    '1792584000000_hamza_decision-history.sql',
    '1792749600000_leandro_expense_submission_registry.sql',
    '1792749601000_hamza_management-audit.sql',
  ]) await admin.query(readFileSync(`migrations/${migration}`, 'utf8').split('-- Down Migration')[0])
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
  ownsRole = true
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON companies, users, expense_notes TO ${role}`)
  const url = new URL(connection!)
  url.username = role
  url.password = password
  runtime = new Pool({ connectionString: url.toString(), max: 1 })
})

test.afterAll(async () => {
  globalThis.__pgPool = undefined
  await runtime?.end()
  if (ownsRole) await admin.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`)
  if (ownsSchema) {
    await admin.query('DROP FUNCTION IF EXISTS ha04_definer_probe()')
    await admin.query('DROP TABLE IF EXISTS ha04_private_probe, ha04_column_probe, ha04_probe, management_changes, expense_submission_attempts, expense_submission_operations, expense_decision_history, expense_notes, users, companies CASCADE')
  }
  await admin.end()
})

test('reports the actual administrator and table-owner bypass instead of certifying RLS', async () => {
  const report = await inspectRls(admin)
  expect(report.status).toBe('blocked')
  expect(report.issues).toContainEqual({ code: 'role.superuser' })
  expect(report.issues).toContainEqual({ code: 'table.owner', table: 'expense_notes' })
})

test('a real limited login still detects baseline users/company exposure', async () => {
  const report = await inspectRls(runtime)
  expect(report.role).toMatchObject({ name: role, superuser: false, bypass_rls: false, create_role: false, create_database: false })
  expect(report.status).toBe('blocked')
  expect(report.issues).toContainEqual({ code: 'table.rls_disabled', table: 'users' })
  expect(report.issues).toContainEqual({ code: 'table.rls_disabled', table: 'companies' })
  expect(report.issues.some((issue: { code: string }) => issue.code === 'table.owner')).toBe(false)
})

test('SET ROLE does not hide the privileged login that can RESET ROLE', async () => {
  const client = await admin.connect()
  try {
    await client.query(`SET ROLE ${role}`)
    const report = await inspectRls(client)
    expect(report.role).toMatchObject({ name: role, superuser: false })
    expect(report.sessionRole.superuser).toBe(true)
    expect(report.issues).toContainEqual({ code: 'session.superuser' })
    expect(report.status).toBe('blocked')
  } finally { await client.query('RESET ROLE'); client.release() }
})

test('NOINHERIT does not hide a membership that requires a separate privilege review', async () => {
  const owner = (await admin.query('SELECT current_user AS name')).rows[0].name
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(owner)) throw new Error('The disposable role name must be a simple identifier.')
  await admin.query(`GRANT ${owner} TO ${role}`)
  try {
    const report = await inspectRls(runtime)
    expect(report.role.superuser).toBe(false)
    expect(report.issues).toContainEqual({ code: 'role.membership_review', role: owner })
    expect(report.status).toBe('blocked')
  } finally { await admin.query(`REVOKE ${owner} FROM ${role}`) }
})

test('newly granted tables enter the inventory and missing policies remain visible', async () => {
  await admin.query(`CREATE TABLE ha04_probe (owner_id uuid); GRANT SELECT ON ha04_probe TO ${role}`)
  let report = await inspectRls(runtime)
  expect(report.issues).toContainEqual({ code: 'table.rls_disabled', table: 'ha04_probe' })
  await admin.query('ALTER TABLE ha04_probe ENABLE ROW LEVEL SECURITY')
  report = await inspectRls(runtime)
  expect(report.issues).toContainEqual({ code: 'table.no_policy', table: 'ha04_probe' })
  await admin.query("CREATE POLICY ha04_probe_owner ON ha04_probe FOR SELECT USING (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid)")
  report = await inspectRls(runtime)
  expect(report.issues.filter((issue: { table?: string }) => issue.table === 'ha04_probe')).toEqual([])
})

test('detects TRUNCATE which bypasses row-level policies', async () => {
  await admin.query(`GRANT TRUNCATE ON expense_notes TO ${role}`)
  try {
    expect((await inspectRls(runtime)).issues).toContainEqual({ code: 'table.truncate', table: 'expense_notes' })
  } finally {
    await admin.query(`REVOKE TRUNCATE ON expense_notes FROM ${role}`)
  }
})

test('inventories the merged history and LE-03 tables without granting them implicitly', async () => {
  const report = await inspectRls(runtime)
  for (const name of ['expense_decision_history', 'expense_submission_operations', 'expense_submission_attempts', 'management_changes']) {
    expect(report.tables).toContainEqual(expect.objectContaining({ name, enabled: true, forced: true, business_access: false, column_access: false }))
    await expect(runtime.query(`SELECT * FROM ${name}`)).rejects.toMatchObject({ code: '42501' })
  }
})

test('column-only grants cannot hide a table without RLS', async () => {
  await admin.query(`CREATE TABLE ha04_column_probe (owner_id uuid); GRANT SELECT (owner_id) ON ha04_column_probe TO ${role}`)
  const report = await inspectRls(runtime)
  expect(report.tables).toContainEqual(expect.objectContaining({ name: 'ha04_column_probe', business_access: false, column_access: true }))
  expect(report.issues).toContainEqual({ code: 'table.rls_disabled', table: 'ha04_column_probe' })
})

test('reports database CREATE even when public-schema CREATE is absent', async () => {
  const name = (await admin.query('SELECT current_database() AS name')).rows[0].name
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('The disposable database name must be a simple identifier.')
  await admin.query(`GRANT CREATE ON DATABASE ${name} TO ${role}`)
  try {
    expect((await inspectRls(runtime)).issues).toContainEqual({ code: 'database.create_schema' })
  } finally { await admin.query(`REVOKE CREATE ON DATABASE ${name} FROM ${role}`) }
})

test('detects a callable definer bypass and still requires review after explicit hardening', async () => {
  await admin.query(`
    CREATE TABLE ha04_private_probe (marker integer);
    INSERT INTO ha04_private_probe VALUES (1);
    ALTER TABLE ha04_private_probe ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ha04_private_probe FORCE ROW LEVEL SECURITY;
    CREATE FUNCTION ha04_definer_probe() RETURNS bigint LANGUAGE sql SECURITY DEFINER
      AS 'SELECT count(*) FROM public.ha04_private_probe';
  `)
  try {
    await expect(runtime.query('SELECT * FROM ha04_private_probe')).rejects.toMatchObject({ code: '42501' })
    // Default PUBLIC EXECUTE plus a privileged owner bypasses the inaccessible table.
    expect((await runtime.query('SELECT ha04_definer_probe() AS count')).rows[0].count).toBe('1')
    let report = await inspectRls(runtime)
    for (const code of ['function.definer_review', 'function.public_execute', 'function.unpinned_search_path', 'function.privileged_owner']) {
      expect(report.issues).toContainEqual({ code, function: 'ha04_definer_probe()' })
    }
    await admin.query('REVOKE ALL ON FUNCTION ha04_definer_probe() FROM PUBLIC')
    await expect(runtime.query('SELECT ha04_definer_probe()')).rejects.toMatchObject({ code: '42501' })
    report = await inspectRls(runtime)
    expect(report.issues.filter((issue: { function?: string }) => issue.function === 'ha04_definer_probe()')).toEqual([])
    await admin.query(`ALTER FUNCTION ha04_definer_probe() SET search_path = pg_catalog, pg_temp; GRANT EXECUTE ON FUNCTION ha04_definer_probe() TO ${role}`)
    report = await inspectRls(runtime)
    expect(report.issues).toContainEqual({ code: 'function.definer_review', function: 'ha04_definer_probe()' })
    expect(report.issues).toContainEqual({ code: 'function.privileged_owner', function: 'ha04_definer_probe()' })
    expect(report.issues).not.toContainEqual({ code: 'function.public_execute', function: 'ha04_definer_probe()' })
    expect(report.issues).not.toContainEqual({ code: 'function.unpinned_search_path', function: 'ha04_definer_probe()' })
  } finally {
    await admin.query('DROP FUNCTION ha04_definer_probe(); DROP TABLE ha04_private_probe')
  }
})

for (const rollback of [false, true]) {
  test(`the limited-role pooled connection clears actor context after ${rollback ? 'rollback' : 'commit'}`, async () => {
    globalThis.__pgPool = runtime
    const id = randomUUID()
    let pid: number | undefined
    const operation = withUserScope(id, async (client) => {
      const result = await client.query("SELECT pg_backend_pid() AS pid, current_setting('app.current_user_id', true) AS actor")
      pid = result.rows[0].pid
      expect(result.rows[0].actor).toBe(id)
      if (rollback) throw new Error('intentional rollback')
    })
    if (rollback) await expect(operation).rejects.toThrow('intentional rollback')
    else await operation
    const reused = await runtime.query("SELECT pg_backend_pid() AS pid, nullif(current_setting('app.current_user_id', true), '') AS actor")
    expect(reused.rows[0]).toEqual({ pid, actor: null })
  })
}


test('merged management audit has positive and cross-company negative policies under the real restricted login', async () => {
  const companies = [randomUUID(), randomUUID()]
  const actors = [randomUUID(), randomUUID(), randomUUID()]
  await admin.query(`GRANT SELECT,INSERT ON management_changes TO ${role}`)
  const append = `INSERT INTO management_changes (company_id,actor_id,target_id,from_role,to_role,from_active,to_active)
    VALUES ($1,$2,$3,'employee','manager',true,true) RETURNING id`
  let client
  try {
    for (const id of companies) await admin.query("INSERT INTO companies (id,name,email_domain) VALUES ($1,'HA04 audit',$2)", [id, `${id}.test`])
    for (let index=0; index<actors.length; index++) await admin.query("INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES ($1,$2,'HA04 audit',$3,'unused',$4)", [actors[index], companies[index===1?1:0], `${actors[index]}@example.test`, index===2?'employee':'hr_admin'])
    await admin.query(append, [companies[1],actors[1],actors[1]])
    client = await runtime.connect()
    expect((await client.query('SELECT * FROM management_changes')).rows).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.current_user_id',$1,true)", [actors[0]])
    expect((await client.query(append, [companies[0],actors[0],actors[2]])).rows).toHaveLength(1)
    const visible = await client.query('SELECT company_id FROM management_changes')
    expect(visible.rows).toEqual([{ company_id: companies[0] }])
    for (const values of [[companies[1],actors[0],actors[1]], [companies[0],actors[1],actors[2]]]) {
      await client.query('SAVEPOINT refused_audit')
      await expect(client.query(append, values)).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK TO SAVEPOINT refused_audit')
    }
    await client.query("SELECT set_config('app.current_user_id',$1,true)", [actors[2]])
    expect((await client.query('SELECT * FROM management_changes')).rows).toEqual([])
    await client.query('SAVEPOINT employee_refused')
    await expect(client.query(append,[companies[0],actors[2],actors[2]])).rejects.toMatchObject({ code: '42501' })
    await client.query('ROLLBACK TO SAVEPOINT employee_refused')
    await client.query('COMMIT')
    expect((await client.query('SELECT * FROM management_changes')).rows).toEqual([])
    await expect(client.query('TRUNCATE management_changes')).rejects.toMatchObject({ code: '42501' })
  } finally {
    if (client) { await client.query('ROLLBACK'); client.release() }
    await admin.query(`REVOKE SELECT,INSERT ON management_changes FROM ${role}`)
    await admin.query('DELETE FROM management_changes WHERE company_id=ANY($1::uuid[])', [companies])
    await admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [actors])
    await admin.query('DELETE FROM companies WHERE id=ANY($1::uuid[])', [companies])
  }
})
