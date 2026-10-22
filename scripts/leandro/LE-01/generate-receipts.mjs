import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../../../tests/fixtures/leandro/LE-01/', import.meta.url)
await mkdir(root, { recursive: true })
const image = () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffcc33' } })
await image().png().toFile(new URL('valid.png', root).pathname)
await image().jpeg().toFile(new URL('valid.jpg', root).pathname)
await image().jpeg({ progressive: true }).toFile(new URL('progressive.jpg', root).pathname)
await image().webp().toFile(new URL('valid.webp', root).pathname)
await image().webp({ lossless: true }).toFile(new URL('lossless.webp', root).pathname)

// Original minimal one-page PDF with correct byte offsets/xref, no third-party document.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>',
]
let pdf = '%PDF-1.7\n'
const offsets = []
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
}
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile(new URL('valid.pdf', root), pdf)
console.log('Generated six original synthetic receipt containers.')
