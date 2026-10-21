import path from 'node:path'
import { createWorker } from 'tesseract.js'
import { parseReceiptText, type ExpenseNoteSuggestion } from '@/lib/ocr-parser'
export type { ExpenseNoteSuggestion } from '@/lib/ocr-parser'

const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const TESSDATA_PATH = path.join(process.cwd(), 'tessdata')

// Pas de limite de taille de fichier ici (contrairement à la création d'une
// note de frais) : un gros fichier peut monopoliser le worker un long
// moment avant de renvoyer une suggestion vide.
export async function suggestFields(receipt: {
  data: Buffer
  mimeType: string
}): Promise<ExpenseNoteSuggestion> {
  if (!SUPPORTED_MIME_TYPES.includes(receipt.mimeType)) {
    return {}
  }

  try {
    const worker = await createWorker('fra', undefined, {
      langPath: TESSDATA_PATH,
      cacheMethod: 'none',
    })
    try {
      const {
        data: { text },
      } = await worker.recognize(receipt.data)
      return parseReceiptText(text)
    } finally {
      await worker.terminate()
    }
  } catch (error) {
    console.error('[ocr] Extraction échouée, suggestion vide renvoyée', error)
    return {}
  }
}
