import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
// Local development tooling only. Reuse the existing typed LE-02 contract,
// including parameter properties; no generated copy or application change.
export async function seedImplementation() {
  const source=new URL('../../../',import.meta.url)
  const hooks=registerHooks({
    resolve(specifier,context,next) {
      if(specifier.startsWith('@/')) return next(new URL('src/'+specifier.slice(2)+(/\.[a-z]+$/.test(specifier)?'':'.ts'),source).href,context)
      return next(specifier,context)
    },
    load(url,context,next) {
      if(url.startsWith(source.href)&&url.endsWith('.ts')) return {format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true}
      return next(url,context)
    },
  })
  try { return await import('./seed.ts') } finally { hooks.deregister() }
}
