/** Read-only structural inventory. A clean report is not a tenant-isolation proof. */
export async function inspectRls(client) {
  const { rows: [role] } = await client.query(`
    SELECT current_user AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls,
           rolcreaterole AS create_role, rolcreatedb AS create_database
    FROM pg_roles WHERE rolname = current_user
  `)
  const { rows: tables } = await client.query(`
    SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
           pg_has_role(current_user, c.relowner, 'USAGE') AS effective_owner,
           has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS business_access,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
             AND a.attnum > 0 AND NOT a.attisdropped
             AND has_column_privilege(current_user, c.oid, a.attnum, 'SELECT,INSERT,UPDATE')) AS column_access,
           has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname <> 'pgmigrations'
    ORDER BY c.relname
  `)
  const { rows: [sessionRole] } = await client.query(`
    SELECT session_user AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls,
           rolcreaterole AS create_role, rolcreatedb AS create_database
    FROM pg_roles WHERE rolname = session_user
  `)
  const { rows: memberships } = await client.query(`
    SELECT rolname AS name FROM pg_roles
    WHERE rolname NOT IN (current_user, session_user)
      AND (pg_has_role(current_user, oid, 'MEMBER') OR pg_has_role(session_user, oid, 'MEMBER'))
    ORDER BY rolname
  `)
  const { rows: [schema] } = await client.query(
    "SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create",
  )
  const { rows: [database] } = await client.query(
    "SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema",
  )
  const { rows: functions } = await client.query(`
    SELECT p.oid::regprocedure::text AS name, pg_get_userbyid(p.proowner) AS owner,
           has_schema_privilege(current_user, n.oid, 'USAGE')
             AND has_function_privilege(current_user, p.oid, 'EXECUTE') AS executable,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
           (SELECT substr(setting, 13) FROM unnest(p.proconfig) setting
             WHERE setting LIKE 'search_path=%') AS search_path,
           r.rolsuper AS owner_superuser, r.rolbypassrls AS owner_bypass_rls
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND p.prosecdef AND p.prokind IN ('f', 'p')
    ORDER BY p.oid::regprocedure::text
  `)
  const issues = []
  for (const key of ['superuser', 'bypass_rls', 'create_role', 'create_database']) {
    if (role[key]) issues.push({ code: `role.${key}` })
    if (sessionRole[key]) issues.push({ code: `session.${key}` })
  }
  for (const membership of memberships) issues.push({ code: 'role.membership_review', role: membership.name })
  if (schema.can_create) issues.push({ code: 'schema.create' })
  if (database.can_create_schema) issues.push({ code: 'database.create_schema' })
  for (const fn of functions) {
    if (!fn.executable) continue
    // A pinned path is not proof that its schemas or function body are safe.
    issues.push({ code: 'function.definer_review', function: fn.name })
    if (fn.public_execute) issues.push({ code: 'function.public_execute', function: fn.name })
    if (fn.search_path === null) issues.push({ code: 'function.unpinned_search_path', function: fn.name })
    if (fn.owner_superuser || fn.owner_bypass_rls) issues.push({ code: 'function.privileged_owner', function: fn.name })
  }
  if (!tables.length) issues.push({ code: 'schema.empty' })
  for (const table of tables) {
    if (table.effective_owner) issues.push({ code: 'table.owner', table: table.name })
    if (table.can_truncate) issues.push({ code: 'table.truncate', table: table.name })
    if ((table.business_access || table.column_access) && !table.enabled) issues.push({ code: 'table.rls_disabled', table: table.name })
    if ((table.business_access || table.column_access) && table.enabled && !table.policy_count) {
      issues.push({ code: 'table.no_policy', table: table.name })
    }
  }
  return {
    scope: 'public tables and non-system SECURITY DEFINER routines; structural inventory is not an application-flow proof',
    role, sessionRole, memberships, database, tables, functions, issues,
    status: issues.length ? 'blocked' : 'structural_checks_passed_not_isolation_proof',
  }
}
