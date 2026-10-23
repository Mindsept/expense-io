import { ApiError } from '@/lib/errors'
import { hasReceiptContent } from '@/lib/receipt-validation'

/** Header pixel bounds precede native/WASM decoding; not a full image decoder. */
export function validateOcrImage(data: Buffer, mime: string, maxPixels: number): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new ApiError('unsupported_ocr_media')
  if (!hasReceiptContent(data, mime)) throw new ApiError('validation')
  let width = 0, height = 0
  if (mime === 'image/png') {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20)
    for (let offset = 8; offset + 12 <= data.length; offset += data.readUInt32BE(offset) + 12) {
      if (data.toString('latin1', offset + 4, offset + 8) === 'acTL') throw new ApiError('validation')
    }
  } else if (mime === 'image/jpeg') {
    let offset = 2
    while (offset + 4 <= data.length) {
      while (data[offset] === 0xff) offset++
      const marker = data[offset++]
      const size = data.readUInt16BE(offset)
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break
      }
      if (marker === 0xda) break
      offset += size
    }
  } else {
    for (let offset = 12; offset + 8 <= data.length;) {
      const type = data.toString('latin1', offset, offset + 4), size = data.readUInt32LE(offset + 4), start = offset + 8
      if (type === 'ANIM' || type === 'ANMF') throw new ApiError('validation')
      if (type === 'VP8X' && size >= 10) { if (data[start] & 2) throw new ApiError('validation'); width = data.readUIntLE(start + 4, 3) + 1; height = data.readUIntLE(start + 7, 3) + 1 }
      if (type === 'VP8 ' && size >= 10) { const w = data.readUInt16LE(start + 6) & 0x3fff, h = data.readUInt16LE(start + 8) & 0x3fff; width = Math.max(width, w); height = Math.max(height, h) }
      if (type === 'VP8L' && size >= 5) { const bits = data.readUInt32LE(start + 1); width = Math.max(width, (bits & 0x3fff) + 1); height = Math.max(height, ((bits >>> 14) & 0x3fff) + 1) }
      offset += 8 + size + size % 2
    }
  }
  if (!width || !height) throw new ApiError('validation')
  if (width > 16384 || height > 16384 || width * height > maxPixels) throw new ApiError('ocr_image_too_large')
}
