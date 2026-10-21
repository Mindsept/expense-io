/** Reject invalid resource limits at Node server startup, before accepting work. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ocrSettings } = await import('./lib/ocr-settings')
    ocrSettings()
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { getPool } = await import('./lib/db')
      const { assertRuntimeDatabase } = await import('./lib/runtime-database')
      await assertRuntimeDatabase(getPool())
    }
  }
}
