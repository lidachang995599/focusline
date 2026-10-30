import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.cwd())
const routes = {
  '/': 'demo/index.html',
  '/sample.pdf': 'samples/long-24-pages.pdf',
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const rel = routes[url.pathname] ?? url.pathname.slice(1)
    const path = join(root, normalize(rel))
    if (!path.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    try {
      const data = await readFile(path)
      res.writeHead(200, {
        'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(data)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  .listen(8123, '127.0.0.1', () => {
    console.log('demo:  http://localhost:8123/')
    console.log('pdf:   http://localhost:8123/sample.pdf')
  })
