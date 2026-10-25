import { expect, test } from 'vitest'
import { benchmarkSql, explainPagedQuery } from '../../../../scripts/mathis/MATH-05/sql.mjs'

test('plans use the real paginated aggregate and current HR eligibility source',async()=>{
 const calls:Array<{sql:string;values:unknown[]}>=[]
 const pool={query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return sql.startsWith('EXPLAIN')?{rows:[{'QUERY PLAN':[{Plan:{'Node Type':'Result'}}]}]}:{rows:[{items:[],total_count:'0',total_cents:'0'}]}}}
 const {hrPendingExpenseSource}=await benchmarkSql()
 const result=await explainPagedQuery(pool,{sourceSql:hrPendingExpenseSource(),values:['actor','company'],order:{column:'created_at',direction:'ASC'},page:{page:1,pageSize:100,offset:0},monetary:true})
 expect(calls).toHaveLength(2)
 expect(calls[0].values).toEqual(['actor','company',100,0])
 expect(calls[0].sql).toBe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+calls[1].sql)
 expect(result?.sql).toContain('LIMIT $3 OFFSET $4')
 expect(result?.sql).toContain('count(*)::text AS total_count')
 expect(result?.sql).toContain('JOIN LATERAL')
})
