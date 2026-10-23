const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function isPng(data: Buffer): boolean {
  if (!data.subarray(0, 8).equals(pngSignature)) return false
  let offset = 8
  let imageBytes = 0
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > data.length) return false
    const type = data.toString('latin1', offset + 4, offset + 8)
    if (crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) return false
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || data.readUInt32BE(offset + 8) === 0 || data.readUInt32BE(offset + 12) === 0) return false
    } else if (type === 'IHDR') return false
    if (type === 'IDAT') imageBytes += length
    if (type === 'IEND') return length === 0 && imageBytes > 0 && end === data.length
    offset = end
  }
  return false
}

function isJpeg(data: Buffer): boolean {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9) return false
  let offset = 2
  let frame = false
  while (offset + 4 <= data.length) {
    if (data[offset++] !== 0xff) return false
    while (data[offset] === 0xff) offset++
    const marker = data[offset++]
    if (offset + 2 > data.length || marker === 0xd8 || marker === 0xd9 || marker === 0) return false
    const length = data.readUInt16BE(offset)
    if (length < 2 || offset + length > data.length - 2) return false
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || data.readUInt16BE(offset + 3) === 0 || data.readUInt16BE(offset + 5) === 0) return false
      frame = true
    }
    if (marker === 0xda) return frame && length >= 6 && offset + length < data.length - 2
    offset += length
  }
  return false
}

function isWebp(data: Buffer): boolean {
  if (data.length < 20 || data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WEBP' || data.readUInt32LE(4) !== data.length - 8) return false
  let offset = 12
  let frame = false
  while (offset + 8 <= data.length) {
    const type = data.toString('latin1', offset, offset + 4)
    const length = data.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length % 2)
    if (end > data.length) return false
    if (type === 'VP8 ' && length >= 10 && data.subarray(offset + 11, offset + 14).equals(Buffer.from([157, 1, 42]))) frame = true
    if (type === 'VP8L' && length >= 5 && data[offset + 8] === 47) frame = true
    if (type === 'ANMF' && length > 16) frame = true
    offset = end
  }
  return frame && offset === data.length
}

/** Container/type checks only, not full decoding, antivirus or PDF content sanitization. */
export function hasReceiptContent(data: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png': return isPng(data)
    case 'image/jpeg': return isJpeg(data)
    case 'image/webp': return isWebp(data)
    case 'application/pdf':
      return /^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(data.subarray(0, 16).toString('latin1')) &&
        /%%EOF\s*$/.test(data.subarray(-2048).toString('latin1')) &&
        /(?:^|[\r\n])\d{1,10}[ \t]{1,8}\d{1,5}[ \t]{1,8}obj\b/.test(data.toString('latin1')) &&
        data.includes(Buffer.from('endobj'))
    default: return false
  }
}
