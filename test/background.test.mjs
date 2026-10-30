/**
 * Background service worker smoke test: imports the compiled worker with a
 * stubbed chrome API and checks the wiring of commands, install and auto-inject.
 *
 * Run with: node test/background.test.mjs
 */
import assert from 'node:assert/strict'

const calls = { created: [], injected: [], sent: [] }
const handlers = {}

globalThis.chrome = {
  runtime: {
    lastError: undefined,
    getURL: (path) => `chrome-extension://test/${path}`,
    onInstalled: { addListener: (fn) => (handlers.installed = fn) },
  },
  commands: { onCommand: { addListener: (fn) => (handlers.command = fn) } },
  tabs: {
    onUpdated: { addListener: (fn) => (handlers.updated = fn) },
    query: (_query, callback) => callback([{ id: 1, url: 'https://example.com/page' }]),
    sendMessage: (_tabId, message, callback) => {
      calls.sent.push(message)
      callback({ active: true, config: {}, host: 'example.com', pro: false })
    },
    create: (options) => calls.created.push(options.url),
  },
  scripting: {
    executeScript: (options, callback) => {
      calls.injected.push(options.target.tabId)
      callback()
    },
  },
  storage: {
    local: {
      get: (_keys, callback) => callback({ autoHosts: ['example.com'] }),
      set: (_items, callback) => callback?.(),
    },
  },
  permissions: { contains: (_options, callback) => callback(true) },
}

await import(new URL('../dist/background.js', import.meta.url).href)
await new Promise((resolve) => setTimeout(resolve, 20))

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('background')

check('registers the install, command and tab listeners', () => {
  assert.equal(typeof handlers.installed, 'function')
  assert.equal(typeof handlers.command, 'function')
  assert.equal(typeof handlers.updated, 'function')
})

{
  handlers.installed({ reason: 'install' })
  check('opens the welcome page on first install', () => {
    assert.ok(calls.created.includes('chrome-extension://test/welcome.html'))
  })
}

{
  handlers.command('toggle-overlay')
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('toggles the reading line from the keyboard shortcut', () => {
    assert.ok(calls.sent.some((message) => message.type === 'fl:toggle'))
  })
}

{
  handlers.command('toggle-lock')
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('locks the reading line from its keyboard shortcut', () => {
    assert.ok(calls.sent.some((message) => message.type === 'fl:lock'))
  })
}

{
  handlers.updated(5, { status: 'complete' }, { url: 'https://example.com/article' })
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('auto-injects the content script on an enabled host', () => {
    assert.ok(calls.injected.includes(5))
  })
}

{
  const before = calls.injected.length
  handlers.updated(6, { status: 'complete' }, { url: 'https://not-enabled.test/article' })
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('does not inject on a host that is not enabled', () => {
    assert.equal(calls.injected.length, before)
  })
}

console.log(`\n${passed} checks passed`)
