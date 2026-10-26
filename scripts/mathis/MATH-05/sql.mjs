import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

let modules
/** Reuse the actual shared pagination and HR source; never change an app query. */
export async function benchmarkSql() {
 if(modules)return modules
 const root=path.resolve('src')
 const hooks=registerHooks({
  resolve(specifier,context,next){return next(specifier.startsWith('@/')?pathToFileURL(path.join(root,specifier.slice(2)+'.ts')).href:specifier,context)},
  load(url,context,next){if(url.startsWith(pathToFileURL(root+path.sep).href)&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context)},
 })
 try {
  const [{queryPage},{hrPendingExpenseSource}]=await Promise.all([import(pathToFileURL(path.join(root,'lib/pagination.ts')).href),import(pathToFileURL(path.join(root,'lib/pending-expense-source.ts')).href)])
  modules={queryPage,hrPendingExpenseSource};return modules
 }finally{hooks.deregister()}
}
export async function explainPagedQuery(pool,input) {
 const {queryPage}=await benchmarkSql()
 /** @type {{sql:string,plan:unknown}|undefined} */
 let captured
 const client={query:async(sql,values)=>{
  const explained=await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,values)
  captured={sql,plan:explained.rows[0]['QUERY PLAN']}
  return pool.query(sql,values)
 }}
 await queryPage(client,input)
 if(!captured)throw new Error('Paginated SQL was not captured.')
 return captured
}
