import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Synthetic text only. sharp is already installed through Next; no new dependency.
const root = new URL('../../../tests/fixtures/leandro/LE-04/', import.meta.url)
const fixtures = JSON.parse(await readFile(new URL('images.json', root), 'utf8'))
await mkdir(new URL('images/', root), { recursive: true })
for (const fixture of fixtures) {
  const text = fixture.lines.map((line, index) => {
    const escaped = line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    return `<text x="60" y="${90 + index * 80}" font-family="Arial" font-size="44" fill="black">${escaped}</text>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="600"><rect width="100%" height="100%" fill="white"/>${text}</svg>`
  await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL(`images/${fixture.id}.png`, root)))
}
console.log(`Generated ${fixtures.length} synthetic PNG fixtures.`)
