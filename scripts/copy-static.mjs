import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const publicDir = new URL('../public/', import.meta.url)
const manifest = new URL('../manifest.json', import.meta.url)
const dist = new URL('../dist/', import.meta.url)

await mkdir(dist, { recursive: true })
await cp(publicDir, dist, { recursive: true })
await cp(manifest, new URL('manifest.json', dist))

// pdf.js ships its own worker plus data files; the reader page loads them from
// dist/vendor/pdfjs at runtime.
const pkg = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const vendor = new URL('vendor/pdfjs/', dist)
if (!existsSync(pkg)) {
  throw new Error('pdfjs-dist is missing — run `npm install` before building')
}
await mkdir(vendor, { recursive: true })
await cp(new URL('build/pdf.min.mjs', pkg), new URL('pdf.min.mjs', vendor))
await cp(new URL('build/pdf.worker.min.mjs', pkg), new URL('pdf.worker.min.mjs', vendor))
await cp(new URL('cmaps/', pkg), new URL('cmaps/', vendor), { recursive: true })
await cp(new URL('standard_fonts/', pkg), new URL('standard_fonts/', vendor), { recursive: true })

console.log(`[focusline] static files copied → ${root}dist`)
