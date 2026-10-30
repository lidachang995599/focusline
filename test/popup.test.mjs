/**
 * Popup integration test for the free build: loads the real popup markup,
 * stubs the extension APIs, imports the compiled popup module and checks the
 * rendered state plus the support card.
 *
 * Run with: node test/popup.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync(new URL('../public/popup.html', import.meta.url), 'utf8')
const messages = JSON.parse(readFileSync(new URL('../public/_locales/en/messages.json', import.meta.url), 'utf8'))
const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'outside-only' })

const state = {
  host: 'example.com',
  active: true,
  config: {
    active: true,
    y: 0.42,
    height: 56,
    dim: 0.55,
    color: '#7dd3fc',
    follow: false,
    calm: false,
    hidden: [],
  },
  speech: { speaking: false, paused: false, rate: 1, voiceURI: '', color: '#fbbf24', lang: 'auto' },
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const storage = {}
const calls = { injected: 0, created: [], zooms: [], messages: [], closed: 0 }
dom.window.close = () => {
  calls.closed += 1
}

globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.chrome = {
  runtime: { lastError: undefined, getURL: (path) => path },
  i18n: {
    getMessage: (key) => messages[key]?.message ?? '',
  },
  tabs: {
    query: (_query, callback) => callback([{ id: 7, url: 'https://example.com/article' }]),
    sendMessage: (_tabId, message, callback) => {
      calls.messages.push(message)
      if (message.type === 'fl:toggle') state.active = !state.active
      if (message.type === 'fl:patch') Object.assign(state.config, message.patch)
      if (message.type === 'fl:speak') {
        const rate = message.rate ?? state.speech.rate
        if (message.action === 'start') {
          state.speech = {
            speaking: true,
            paused: false,
            rate,
            voiceURI: 'local',
            color: message.color ?? '#fbbf24',
            lang: message.lang ?? 'auto',
          }
        } else if (message.action === 'pause') {
          state.speech.paused = true
        } else if (message.action === 'resume') {
          state.speech.paused = false
        } else if (message.action === 'stop') {
          state.speech = {
            speaking: false,
            paused: false,
            rate,
            voiceURI: '',
            color: state.speech.color,
            lang: state.speech.lang,
          }
        } else if (message.action === 'rate') {
          state.speech.rate = rate
        } else if (message.action === 'color') {
          state.speech.color = message.color
        } else if (message.action === 'lang') {
          state.speech.lang = message.lang
        }
      }
      callback(clone(state))
    },
    create: (options) => calls.created.push(options.url),
    setZoom: (_tabId, zoom, callback) => {
      calls.zooms.push(zoom)
      callback?.()
    },
    getZoom: (_tabId, callback) => callback(1),
  },
  scripting: {
    executeScript: (_options, callback) => {
      calls.injected += 1
      callback([])
    },
  },
  permissions: {
    request: (_options, callback) => callback(true),
    remove: (_options, callback) => callback(true),
    contains: (_options, callback) => callback(true),
  },
  storage: {
    local: {
      get: (keys, callback) => {
        const list = Array.isArray(keys) ? keys : [keys]
        const result = {}
        for (const key of list) if (key in storage) result[key] = storage[key]
        callback(result)
      },
      set: (items, callback) => {
        Object.assign(storage, items)
        callback?.()
      },
    },
    onChanged: { addListener: () => {} },
  },
}

await import(new URL('../dist/popup/popup.js', import.meta.url).href)
await new Promise((resolve) => setTimeout(resolve, 80))

const $ = (id) => dom.window.document.getElementById(id)
let passed = 0

async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('popup')

await check('shows the current host', () => {
  assert.equal($('site').textContent, 'example.com')
})

await check('reveals the controls', () => {
  assert.equal($('controls').hidden, false)
})

await check('reflects the active state on the toggle', () => {
  assert.equal($('toggle').getAttribute('aria-checked'), 'true')
  assert.ok($('toggle').classList.contains('on'))
})

await check('paints the stored config', () => {
  assert.equal($('height').value, '56')
  assert.equal($('heightVal').textContent, '56 px')
  assert.equal($('dim').value, '55')
  assert.equal($('dimVal').textContent, '55%')
})

await check('paints the default text settings', () => {
  assert.equal($('zoom').value, '100')
  assert.equal($('zoomVal').textContent, '100%')
  assert.equal($('lineHeight').value, '0')
  assert.equal($('spacing').value, '0')
  assert.ok(
    dom.window.document.querySelector('.themeDot[data-theme="default"]').classList.contains('selected'),
  )
})

await check('offers five unlocked colour swatches', () => {
  const swatches = [...dom.window.document.querySelectorAll('.swatch:not(.ttsSwatch)')]
  assert.equal(swatches.length, 5)
  assert.ok(swatches.every((swatch) => !swatch.classList.contains('locked')))
  assert.ok(swatches.find((swatch) => swatch.dataset.color === '#7dd3fc').classList.contains('selected'))
})

await check('offers a language menu with every bundled locale', () => {
  const select = $('lang')
  assert.equal(select.options.length, 11)
  assert.equal(select.value, 'auto')
})

await check('toggles the reading line off', async () => {
  $('toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal($('toggle').getAttribute('aria-checked'), 'false')
  assert.equal($('toggle').classList.contains('on'), false)
})

await check('applies a colour without any paywall', async () => {
  dom.window.document.querySelector('.swatch:not(.ttsSwatch)[data-color="#fbbf24"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true }),
  )
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.equal(state.config.color, '#fbbf24')
  assert.ok(
    dom.window.document
      .querySelector('.swatch:not(.ttsSwatch)[data-color="#fbbf24"]')
      .classList.contains('selected'),
  )
})

await check('applies a reading theme', async () => {
  dom.window.document.querySelector('.themeDot[data-theme="paper"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true }),
  )
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.equal(state.config.text.theme, 'paper')
  assert.ok(
    dom.window.document.querySelector('.themeDot[data-theme="paper"]').classList.contains('selected'),
  )
})

await check('locks and releases the line position', async () => {
  const box = $('lock')
  assert.equal(box.checked, false)
  box.click()
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(state.config.locked, true)
  box.click()
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(state.config.locked, false)
})

await check('keeps a height change made right before locking', async () => {
  const height = $('height')
  height.value = '96'
  height.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  $('lock').click()
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.equal(state.config.height, 96, 'the height patch was not dropped')
  assert.equal(state.config.locked, true, 'the lock patch was applied too')
})

await check('applies browser zoom from the size slider', async () => {
  const zoom = $('zoom')
  zoom.value = '120'
  zoom.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.equal(state.config.text.zoom, 1.2)
  assert.ok(calls.zooms.includes(1.2))
})

await check('enables auto-run for the site and stores the permission scope', async () => {
  $('auto').click()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal($('auto').checked, true)
  assert.deepEqual(storage.autoHosts, ['example.com'])
})

await check('gives sliders and selects accessible names', () => {
  for (const id of ['height', 'dim', 'zoom', 'lineHeight', 'spacing', 'rate', 'lang']) {
    const label = ($(id).getAttribute('aria-label') ?? '').trim()
    assert.ok(label.length > 0, `${id} has a name`)
  }
  const dots = [...dom.window.document.querySelectorAll('.themeDot')]
  assert.ok(dots.every((dot) => (dot.getAttribute('aria-label') ?? '').length > 0))
  const swatches = [...dom.window.document.querySelectorAll('.swatch')]
  assert.ok(
    swatches.every((swatch) => {
      const label = swatch.getAttribute('aria-label') ?? ''
      return label.length > 0 && !label.startsWith('#')
    }),
  )
})

await check('keeps numeric values left-to-right', () => {
  for (const id of ['heightVal', 'dimVal', 'zoomVal', 'lineVal', 'spacingVal']) {
    assert.equal($(id).getAttribute('dir'), 'ltr')
  }
})

await check('offers highlight colours for read-aloud', async () => {
  const swatches = [...dom.window.document.querySelectorAll('.ttsSwatch')]
  assert.equal(swatches.length, 6)
  assert.ok(
    swatches.find((swatch) => swatch.dataset.color === '#fbbf24').classList.contains('selected'),
  )
  swatches.find((swatch) => swatch.dataset.color === '#34d399').click()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(storage.ttsHighlight, '#34d399')
  assert.ok(
    swatches.find((swatch) => swatch.dataset.color === '#34d399').classList.contains('selected'),
  )
})

await check('offers a reading language menu', () => {
  const select = $('ttsLang')
  assert.equal(select.options.length, 11)
  assert.equal(select.value, 'auto')
})

await check('starts, pauses, resumes and stops reading', async () => {
  const lang = $('ttsLang')
  lang.value = 'ja'
  lang.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(storage.ttsLang, 'ja')

  assert.equal($('speakLabel').textContent, 'Read aloud')
  assert.equal($('speakStop').hidden, true)

  $('speak').click()
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(state.speech.speaking, true)
  assert.equal(state.speech.color, '#34d399')
  assert.equal(state.speech.lang, 'ja')
  assert.equal($('speakLabel').textContent, 'Pause')
  assert.equal($('speakStop').hidden, false)

  $('speak').click()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(state.speech.paused, true)
  assert.equal($('speakLabel').textContent, 'Resume')

  $('speak').click()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(state.speech.paused, false)

  $('speakStop').click()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(state.speech.speaking, false)
  assert.equal($('speakLabel').textContent, 'Read aloud')
  assert.equal($('speakStop').hidden, true)
})

await check('remembers the reading speed', async () => {
  const rate = $('rate')
  rate.value = '120'
  rate.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  rate.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(storage.ttsRate, 1.2)
  assert.equal($('rateVal').textContent, '1.2×')
})

await check('applies the dyslexia-friendly preset', async () => {
  $('textPreset').click()
  await new Promise((resolve) => setTimeout(resolve, 220))
  assert.equal(state.config.text.fontSize, 19)
  assert.equal(state.config.text.lineHeight, 1.7)
  assert.equal(state.config.text.letterSpacing, 0.05)
  assert.equal(state.config.text.wordSpacing, 0.16)
  assert.equal(state.config.text.measure, true)
  assert.equal(state.config.text.alignLeft, true)
})

await check('turns the line on before element picking when it was off', async () => {
  assert.equal(state.active, false)
  $('pick').click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const patch = calls.messages.find(
    (message) => message.type === 'fl:patch' && message.patch.active === true,
  )
  assert.deepEqual(patch.patch, { active: true })
  assert.ok(calls.messages.some((message) => message.type === 'fl:pick'))
  assert.equal(calls.closed, 1)
})

await check('records a custom shortcut and stores it', async () => {
  const up = dom.window.document.querySelector('.keyBtn[data-dir="up"]')
  assert.ok(up, 'shortcut row is rendered')
  assert.equal(up.textContent, 'Alt + ↑')

  up.click()
  assert.equal(up.textContent, '…', 'shows that it is listening')

  dom.window.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
  )
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(storage.shortcuts.up, 'Ctrl+K')
  assert.equal(up.textContent, 'Ctrl + K')
})

await check('snaps the line to text lines', async () => {
  const box = $('snap')
  assert.equal(box.checked, false)
  box.click()
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(state.config.snap, true)
})

await check('offers a colour guide menu', async () => {
  const select = $('guide')
  assert.equal(select.value, 'off')
  select.value = 'words'
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(state.config.guide, 'words')
})

await check('lets the user pick guide colours', async () => {
  const input = $('guideA')
  input.value = '#123456'
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.equal(state.config.guideColorA, '#123456')
})

console.log(`\n${passed} checks passed`)
