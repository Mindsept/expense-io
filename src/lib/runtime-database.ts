import type { Pool, PoolClient } from 'pg'

const protectedTables = ['companies','users','expense_notes','expense_decision_history','management_changes','expense_submission_operations','expense_submission_attempts','enrollment_invitations','decision_notification_outbox','decision_inbox','expense_notification_routes','assignment_notification_outbox','assignment_inbox']
const diagnostic = 'Database isolation check failed. Apply the HA-04 migration with a separate administrator, provision expense_web, and configure only its private DATABASE_URL for the web process.'

/** Runs at Node startup before accepting work; verifies the actual login, not its URL label. */
export async function assertRuntimeDatabase(pool: Pick<Pool,'connect'>, env: Record<string,string|undefined> = process.env): Promise<void> {
  let client: PoolClient | undefined
  try {
    const connection = new URL(env.DATABASE_URL || 'invalid:')
    client = await pool.connect()
    const {rows:[identity]} = await client.query<{
      current_role:string;login_role:string;rolsuper:boolean;rolbypassrls:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolreplication:boolean;rolinherit:boolean;memberships:number
    }>(`SELECT current_user AS current_role,session_user AS login_role,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolinherit,
      (SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) AS memberships
      FROM pg_roles r WHERE r.rolname=current_user`)
    // The shared test runner explicitly advertises a privileged bootstrap baseline.
    // It is permitted only for that exact generated, disposable loopback target.
    // The HA-04 runtime suites always use expense_web and cannot take this branch.
    const baseline = env.ARLA_TEST_ENV==='isolated' && /^arla-ci-[0-9a-f]{12}$/.test(env.ARLA_TEST_PROJECT || '') &&
      ['127.0.0.1','localhost'].includes(connection.hostname) && connection.pathname.endsWith('_test') &&
      connection.username==='expense_test' && identity?.current_role==='expense_test' && identity.login_role==='expense_test'
    if (baseline) return
    if (!identity || identity.current_role!=='expense_web' || identity.login_role!=='expense_web' ||
      identity.rolsuper || identity.rolbypassrls || identity.rolcreatedb || identity.rolcreaterole || identity.rolreplication || identity.rolinherit || identity.memberships) throw new Error(diagnostic)
    if (Object.keys(env).some(key => /(?:ADMIN|MIGRATION|BOOTSTRAP).*DATABASE_URL/.test(key) && env[key])) throw new Error(diagnostic)
    const {rows:[rights]} = await client.query<{database_create:boolean;schema_create:boolean;owned:number;protected:number;bad_functions:number;unsafe_grants:boolean}>(
      `SELECT has_database_privilege(current_database(),'CREATE') AS database_create,
       (has_schema_privilege('public','CREATE') OR has_schema_privilege('expense_auth','CREATE')) AS schema_create,
       (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,
       (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity AND c.relforcerowsecurity) AS protected,
       (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND p.prosecdef AND has_function_privilege(p.oid,'EXECUTE') AND (
          n.nspname<>'expense_auth' OR p.proname NOT IN ('current_actor','credentials','session_identity','can_validate','issue_invitation','revoke_invitation','redeem_invitation') OR
          r.rolname<>'expense_identity' OR r.rolsuper OR r.rolbypassrls OR r.rolcanlogin OR
          NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) setting WHERE setting ~ '^search_path=pg_catalog, ?pg_temp$') OR
          EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
       )) AS bad_functions,
       (has_column_privilege('users','password_hash','SELECT,INSERT,UPDATE') OR
        has_column_privilege('enrollment_invitations','token_sha256','SELECT,UPDATE') OR
        has_column_privilege('enrollment_invitations','proof_sha256','SELECT,UPDATE') OR
        EXISTS (SELECT 1 FROM unnest($1::text[]) relation WHERE has_table_privilege(('public.'||relation)::regclass,'DELETE,TRUNCATE'))) AS unsafe_grants`,[protectedTables],
    )
    if (!rights || rights.database_create || rights.schema_create || rights.owned || rights.protected!==protectedTables.length || rights.bad_functions || rights.unsafe_grants) throw new Error(diagnostic)
  } catch { throw new Error(diagnostic) }
  finally { client?.release() }
}
