// Explicit maintenance configuration; never load .env or fall back to web DATABASE_URL.
import { demoCli } from './mathis/MATH-03/cli.mjs'
await demoCli('init')
