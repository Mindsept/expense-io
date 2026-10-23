/** Reject invalid resource limits at Node server startup, before accepting work. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ocrSettings } = await import('./lib/ocr-settings')
    ocrSettings()
  }
}
