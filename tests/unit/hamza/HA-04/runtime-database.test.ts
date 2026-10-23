import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { assertRuntimeDatabase } from '@/lib/runtime-database'

const web = {current_role:'expense_web',login_role:'expense_web',rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolinherit:false,memberships:0}
const rights = {database_create:false,schema_create:false,owned:0,protected:8,bad_functions:0,unsafe_grants:false}
function fixture(identity = web, privileges = rights) {
  const release = vi.fn(), query = vi.fn().mockResolvedValueOnce({rows:[identity]}).mockResolvedValueOnce({rows:[privileges]})
  const connect = vi.fn().mockResolvedValue({query,release})
  return {pool:{connect} as unknown as Pick<Pool,'connect'>,query,release}
}
const env = {DATABASE_URL:'postgres://expense_web:private@127.0.0.1/runtime'}
describe('actual runtime login guard', () => {
  it('accepts the exact restricted login with protected non-owned tables', async () => {
    const db = fixture(); await expect(assertRuntimeDatabase(db.pool,env)).resolves.toBeUndefined(); expect(db.release).toHaveBeenCalledOnce()
  })
  it.each([{rolsuper:true},{rolbypassrls:true},{rolcreaterole:true},{memberships:1},{login_role:'administrator'}])('rejects privilege escalation and SET ROLE hiding the login (case %#)', async patch => {
    const db=fixture({...web,...patch}); await expect(assertRuntimeDatabase(db.pool,env)).rejects.toThrow('Database isolation check failed.'); expect(db.release).toHaveBeenCalledOnce()
  })
  it.each([{owned:1},{schema_create:true},{database_create:true},{protected:7},{bad_functions:1},{unsafe_grants:true}])('rejects ownership, DDL or an unprotected table (case %#)', async patch => {
    const db=fixture(web,{...rights,...patch}); await expect(assertRuntimeDatabase(db.pool,env)).rejects.toThrow('Database isolation check failed.')
  })
  it('does not accept an administrator URL in the web environment', async () => {
    const db=fixture(); await expect(assertRuntimeDatabase(db.pool,{...env,HA04_ADMIN_DATABASE_URL:'private'})).rejects.toThrow('Database isolation check failed.')
  })
  it('allows only the runner’s named disposable bootstrap baseline', async () => {
    const identity={...web,current_role:'expense_test',login_role:'expense_test',rolsuper:true}
    const settings={DATABASE_URL:'postgres://expense_test:private@127.0.0.1/expense_io_test',ARLA_TEST_ENV:'isolated',ARLA_TEST_PROJECT:'arla-ci-123456abcdef'}
    await expect(assertRuntimeDatabase(fixture(identity).pool,settings)).resolves.toBeUndefined()
    await expect(assertRuntimeDatabase(fixture(identity).pool,{...settings,DATABASE_URL:'postgres://expense_test:private@foreign.test/expense_io_test'})).rejects.toThrow()
    await expect(assertRuntimeDatabase(fixture(identity).pool,{...settings,ARLA_TEST_PROJECT:'personal'})).rejects.toThrow()
  })
})
