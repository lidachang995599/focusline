/**
 * DOM-level smoke tests for the compiled content script.
 * Run with: node test/content.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const code = readFileSync(new URL('../dist/content.js', import.meta.url), 'utf8')

function setup(initialStore = { 'site:example.com': { active: true } }, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><article><p>Hello reading</p></article></body></html>', {
    url: 'https://example.com/article',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })

  dom.window.scrollTo = () => {}
  const scrollCalls = []
  dom.window.scrollTo = (options) => {
    scrollCalls.push(options)
  }
  const scrollTopWrites = []
  const scroller = dom.window.document.scrollingElement ?? dom.window.document.documentElement
  let scrollTopValue = 0
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (value) => {
      scrollTopValue = value
      scrollTopWrites.push(value)
    },
  })
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 2000 })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 600 })
  scroller.scrollTo = (options) => {
    scrollTopValue = options.top
    scrollTopWrites.push(options.top)
  }
  dom.window.document.elementFromPoint = () => dom.window.document.body
  dom.window.Element.prototype.getClientRects = () => [
    { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 },
  ]
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 20,
    top: 300,
    left: 0,
    right: 100,
    bottom: 320,
    x: 0,
    y: 300,
  })

  const spoken = []
  class FakeUtterance {
    constructor(text) {
      this.text = text
      this.rate = 1
      this.lang = ''
      this.voice = null
    }
  }
  dom.window.SpeechSynthesisUtterance = FakeUtterance
  Object.defineProperty(dom.window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [{ voiceURI: 'local-en', lang: 'en-US', localService: true, default: true }],
      speak: (utterance) => spoken.push(utterance),
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })

  const store = { ...initialStore }
  let listener = null

  let changeListener = null
  let localeMessages = options.uiLangMessages ?? null
  if (options.uiLangMessages !== undefined) {
    dom.window.fetch = async () => ({ json: async () => localeMessages })
  }

  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const list = Array.isArray(keys) ? keys : [keys]
          const result = {}
          for (const key of list) if (key in store) result[key] = store[key]
          callback(result)
        },
        set(items, callback) {
          const changes = {}
          for (const key of Object.keys(items)) {
            changes[key] = { oldValue: store[key], newValue: items[key] }
          }
          Object.assign(store, items)
          callback?.()
          // Chrome notifies the writer too; tests should see that echo.
          queueMicrotask(() => {
            if (changeListener) changeListener(changes, 'local')
          })
        },
      },
      onChanged: {
        addListener(fn) {
          changeListener = fn
        },
      },
    },
    runtime: {
      getURL: (path) => `https://extension.invalid/${path}`,
      onMessage: {
        addListener(fn) {
          listener = fn
        },
      },
    },
    i18n: {
      getMessage: (key) => options.browserMessages?.[key] ?? '',
      getUILanguage: () => options.browserLanguage ?? 'en',
    },
  }

  dom.window.chrome = chrome
  if (options.highlightApi) {
    class FakeHighlight {
      constructor() {
        this.ranges = []
      }
      add(range) {
        this.ranges.push(range)
      }
      clear() {
        this.ranges = []
      }
    }
    dom.window.Highlight = FakeHighlight
    dom.window.CSS = dom.window.CSS ?? {}
    dom.window.CSS.highlights = new Map()
  }
  dom.window.eval(code)

  return {
    dom,
    store,
    root: () => dom.window.document.getElementById('focusline-root'),
    band: () => dom.window.document.getElementById('focusline-root')?.shadowRoot?.querySelector('.band') ?? null,
    dim: (selector) =>
      dom.window.document.getElementById('focusline-root')?.shadowRoot?.querySelector(selector) ?? null,
    hud: () => dom.window.document.getElementById('focusline-root')?.shadowRoot?.querySelector('.hud') ?? null,
    scrollCalls,
    scrollTopWrites,
    spoken,
    setScrollTop: (value) => {
      scroller.scrollTop = value
    },
    change: (items) => changeListener?.(items, 'local'),
    setLocale: (map) => {
      localeMessages = map
    },
    send: (msg) =>
      new Promise((resolve) => {
        assert.ok(listener, 'content script registered a message listener')
        listener(msg, {}, resolve)
      }),
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('content script')

{
  const ctx = setup()
  await tick()

  await check('creates the overlay root on load', () => {
    assert.ok(ctx.root(), 'root exists')
  })

  await check('renders a full-width band with the default height', () => {
    const band = ctx.band()
    assert.ok(band)
    assert.equal(band.style.height, '48px')
    assert.match(band.style.transform, /translateY\(-?\d+px\)/)
  })

  await check('dims everything outside the band', () => {
    assert.match(ctx.dim('.dim.top').style.background, /rgba\(3, 7, 18, 0\.55\)/)
    assert.match(ctx.dim('.dim.bottom').style.transform, /^scaleY\(/)
  })

  await check('reports state over the message channel', async () => {
    const state = await ctx.send({ type: 'fl:get' })
    assert.equal(state.host, 'example.com')
    assert.equal(state.active, true)
    assert.equal(state.config.height, 48)
  })

  await check('applies a patch and persists it per site', async () => {
    const state = await ctx.send({ type: 'fl:patch', patch: { height: 90, dim: 0.3 } })
    assert.equal(state.config.height, 90)
    assert.equal(ctx.band().style.height, '90px')
    assert.match(ctx.dim('.dim.top').style.background, /rgba\(3, 7, 18, 0\.3\)/)
    assert.equal(ctx.store['site:example.com'].height, 90)
  })

  await check('applies typography overrides', async () => {
    const cookie = ctx.dom.window.document.createElement('div')
    cookie.id = 'cookie-card'
    cookie.style.background = '#111827'
    cookie.style.color = '#e5e7eb'
    cookie.innerHTML = '<strong>We value your privacy</strong>'
    ctx.dom.window.document.body.appendChild(cookie)

    await ctx.send({
      type: 'fl:patch',
      patch: { text: { zoom: 1.1, lineHeight: 1.6, letterSpacing: 0.02, theme: 'paper' } },
    })
    const style = ctx.dom.window.document.getElementById('fl-text')
    assert.ok(style, 'text style element exists')
    assert.match(style.textContent, /line-height:1\.60/)
    assert.match(style.textContent, /letter-spacing:0\.020em/)
    assert.match(style.textContent, /#f7f3e9/)
    assert.match(style.textContent, /html\.fl-typography:not\(#fl-never\) \*/)
    assert.match(style.textContent, /a\{color:#0b5fa5\}/)
    assert.match(style.textContent, /body\{color:#2b2b2b !important\}/)
    assert.doesNotMatch(style.textContent, /:not\(a\)\{color/)
    assert.ok(ctx.dom.window.document.documentElement.classList.contains('fl-typography'))
    assert.doesNotMatch(style.textContent, /:not\(span\)/)

    const cardText = ctx.dom.window.getComputedStyle(cookie.querySelector('strong')).color
    assert.equal(cardText, 'rgb(229, 231, 235)', 'dark card keeps its own light text colour')
    cookie.remove()
  })

  await check('applies the dyslexia-friendly preset styles', async () => {
    await ctx.send({
      type: 'fl:patch',
      patch: {
        text: {
          zoom: 1,
          lineHeight: 1.7,
          letterSpacing: 0.05,
          wordSpacing: 0.16,
          fontSize: 19,
          measure: true,
          alignLeft: true,
          theme: 'default',
        },
      },
    })
    const style = ctx.dom.window.document.getElementById('fl-text')
    assert.match(style.textContent, /word-spacing:0\.160em/)
    assert.match(style.textContent, /font-size:19\.0px/)
    assert.match(style.textContent, /max-width:65ch/)
    assert.match(style.textContent, /text-align:left/)
  })

  await check('exposes the handle as a vertical slider with live values', async () => {
    const handle = ctx.dim('.handle')
    assert.equal(handle.getAttribute('role'), 'slider')
    assert.equal(handle.getAttribute('aria-orientation'), 'vertical')
    assert.equal(handle.getAttribute('aria-valuemin'), '0')
    assert.equal(handle.getAttribute('aria-valuemax'), '100')
    assert.equal(handle.getAttribute('aria-valuenow'), '42')

    await ctx.send({ type: 'fl:patch', patch: { y: 0.81 } })
    assert.equal(handle.getAttribute('aria-valuenow'), '81')
    assert.equal(handle.getAttribute('aria-valuetext'), '81%')

    handle.dispatchEvent(
      new ctx.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    await tick()
    assert.equal(handle.getAttribute('aria-valuenow'), '82')
  })

  await check('keeps following over elements that stop pointermove propagation', async () => {
    await ctx.send({ type: 'fl:patch', patch: { follow: true } })
    const button = ctx.dom.window.document.createElement('button')
    button.textContent = 'go'
    button.addEventListener('pointermove', (event) => event.stopPropagation())
    ctx.dom.window.document.body.appendChild(button)

    const before = ctx.band().style.transform
    button.dispatchEvent(
      new ctx.dom.window.MouseEvent('pointermove', { clientY: 300, bubbles: true }),
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.notEqual(ctx.band().style.transform, before)

    await ctx.send({ type: 'fl:patch', patch: { follow: false } })
    button.remove()
  })

  await check('toggles the overlay off and on', async () => {
    let state = await ctx.send({ type: 'fl:toggle' })
    assert.equal(state.active, false)
    assert.equal(ctx.root(), null)

    state = await ctx.send({ type: 'fl:toggle' })
    assert.equal(state.active, true)
    assert.ok(ctx.root())
  })

  await check('calm mode injects a stylesheet', async () => {
    await ctx.send({ type: 'fl:patch', patch: { calm: true } })
    assert.ok(ctx.dom.window.document.getElementById('fl-calm'), 'calm style element exists')
  })

  await check('hidden selectors inject a stylesheet', async () => {
    await ctx.send({ type: 'fl:patch', patch: { hidden: ['.cookie'] } })
    assert.ok(ctx.dom.window.document.getElementById('fl-hide'), 'hide style element exists')
  })

  await check('turning the line off cleans up page styles', async () => {
    await ctx.send({ type: 'fl:toggle' })
    assert.equal(ctx.dom.window.document.getElementById('fl-calm'), null)
    assert.equal(ctx.dom.window.document.getElementById('fl-hide'), null)
    assert.equal(ctx.dom.window.document.getElementById('fl-text'), null)
    assert.equal(
      ctx.dom.window.document.documentElement.classList.contains('fl-typography'),
      false,
    )
    assert.equal(ctx.root(), null)
  })
}

{
  const ctx = setup({ 'site:example.com': { active: false, height: 72 } })
  await tick()

  await check('respects a stored inactive config', () => {
    assert.equal(ctx.root(), null)
  })

  await check('merges stored config with defaults', async () => {
    const state = await ctx.send({ type: 'fl:get' })
    assert.equal(state.active, false)
    assert.equal(state.config.height, 72)
    assert.equal(state.config.dim, 0.55)
  })
}

{
  const ctx = setup()
  await tick()
  await ctx.send({ type: 'fl:speak', action: 'start', rate: 1.2, color: '#34d399' })
  await tick()
  const state = await ctx.send({ type: 'fl:get' })
  await check('reads the page aloud with a local voice', () => {
    assert.equal(state.speech.speaking, true)
    assert.equal(state.speech.rate, 1.2)
    assert.equal(state.speech.color, '#34d399')
    assert.ok(ctx.spoken.length > 0)
    assert.ok(Math.abs(state.config.y - 0.42) < 0.01, 'the line stayed while the sentence was visible')
  })

  const stopped = await ctx.send({ type: 'fl:speak', action: 'stop' })
  await check('stops reading on request', () => {
    assert.equal(stopped.speech.speaking, false)
  })
}

{
  const ctx = setup()
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'First word then second word.'
  doc.body.appendChild(paragraph)
  const textNode = paragraph.firstChild
  doc.caretRangeFromPoint = () => {
    const range = doc.createRange()
    range.setStart(textNode, 18)
    range.collapse(true)
    return range
  }

  await ctx.send({ type: 'fl:speak', action: 'start', rate: 1 })
  await tick()
  await check('starts reading at the word under the light', () => {
    assert.equal(ctx.spoken[0].text, 'second word.')
  })
  await ctx.send({ type: 'fl:speak', action: 'stop' })
}

{
  const ctx = setup()
  await tick()
  const paragraph = ctx.dom.window.document.createElement('p')
  paragraph.textContent = 'First word then second word.'
  ctx.dom.window.document.body.appendChild(paragraph)
  const paragraphText = paragraph.firstChild
  ctx.dom.window.Range.prototype.getBoundingClientRect = function () {
    const top = this.startContainer === paragraphText && this.startOffset >= 16 ? 300 : 200
    return { width: 100, height: 40, top, left: 0, right: 100, bottom: top + 40, x: 0, y: top }
  }

  await ctx.send({ type: 'fl:speak', action: 'start', rate: 1 })
  await tick()
  await check('falls back to the word nearest the light without a caret API', () => {
    assert.equal(ctx.spoken[0].text, 'second word.')
  })
  await ctx.send({ type: 'fl:speak', action: 'stop' })
}

{
  const ctx = setup()
  const doc = ctx.dom.window.document
  doc.body.innerHTML = '<p>これはテストです。</p>'
  ctx.dom.window.speechSynthesis.getVoices = () => [
    { voiceURI: 'ja-jp', lang: 'ja-JP', localService: true, default: true },
  ]
  await tick()
  await ctx.send({ type: 'fl:speak', action: 'start', rate: 1 })
  await tick()
  const state = await ctx.send({ type: 'fl:get' })
  await check('uses a Japanese voice for Japanese text', () => {
    assert.equal(state.speech.lang, 'ja')
    assert.equal(ctx.spoken[0].lang, 'ja-JP')
  })
  await ctx.send({ type: 'fl:speak', action: 'stop' })
}

{
  const ctx = setup()
  ctx.dom.window.scrollBy = () => {}
  ctx.dom.window.Range.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 20,
    top: 900,
    left: 0,
    right: 100,
    bottom: 920,
    x: 0,
    y: 900,
  })
  await tick()
  const beforeMove = ctx.band().style.transform
  await ctx.send({ type: 'fl:speak', action: 'start', rate: 1 })
  await tick()
  const state = await ctx.send({ type: 'fl:get' })
  await check('moves the light when the sentence has left the viewport', () => {
    assert.ok(state.config.y > 0.8)
    assert.notEqual(ctx.band().style.transform, beforeMove)
  })
  await ctx.send({ type: 'fl:speak', action: 'stop' })
}

{
  const ctx = setup({ 'site:example.com': { active: false } })
  await tick()
  await ctx.send({ type: 'fl:speak', action: 'start', rate: 1 })
  await tick()
  const state = await ctx.send({ type: 'fl:get' })
  await check('turns the line on when reading aloud while it was off', () => {
    assert.equal(state.active, true)
    assert.ok(ctx.root())
  })
  await ctx.send({ type: 'fl:speak', action: 'stop' })
}

{
  const ctx = setup({ 'site:example.com': { active: false } })
  await tick()
  const before = await ctx.send({ type: 'fl:get' })
  const after = await ctx.send({ type: 'fl:pick' })
  await check('turns the line on when picking elements while it was off', () => {
    assert.equal(before.active, false)
    assert.equal(after.active, true)
    assert.ok(ctx.root())
    assert.equal(ctx.store['site:example.com'].active, true)
  })
}

{
  const fresh = setup({})
  await tick()
  await check('stays off until the user enables it', () => {
    assert.equal(fresh.root(), null)
  })
}

{
  const ctx = setup()
  const state = await ctx.send({ type: 'fl:get' })
  await check('answers messages sent while still booting with the stored state', () => {
    assert.equal(state.active, true)
  })
}

{
  const ctx = setup()
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'A line of text'
  doc.body.appendChild(paragraph)
  paragraph.getBoundingClientRect = () => ({
    width: 200,
    height: 20,
    top: 280,
    left: 0,
    right: 200,
    bottom: 300,
    x: 0,
    y: 280,
  })
  doc.elementFromPoint = () => paragraph

  const plain = new ctx.dom.window.MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 290,
    button: 0,
  })
  doc.body.dispatchEvent(plain)

  const altClick = new ctx.dom.window.MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 290,
    altKey: true,
    button: 0,
  })
  doc.body.dispatchEvent(altClick)
  await tick()
  const state = await ctx.send({ type: 'fl:get' })

  const altRight = new ctx.dom.window.MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 290,
    altKey: true,
    button: 2,
  })
  doc.body.dispatchEvent(altRight)
  await tick()
  const released = await ctx.send({ type: 'fl:get' })

  await check('Alt + click drops the line on the text line under the pointer', () => {
    assert.equal(plain.defaultPrevented, false, 'a plain click is left alone')
    assert.equal(altClick.defaultPrevented, true, 'Alt + click is ours')
    assert.ok(Math.abs(state.config.y - 290 / ctx.dom.window.innerHeight) < 0.01)
    assert.equal(state.config.height, 48, 'the hand-tuned height is not touched')
    assert.equal(state.config.locked, true, 'dropping the line locks it')
    assert.equal(altRight.defaultPrevented, true, 'Alt + right click is ours')
    assert.equal(released.config.locked, false, 'Alt + right click releases the lock')
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true, y: 0.4, follow: true } })
  await tick()

  const pointer = (clientY) =>
    ctx.dom.window.dispatchEvent(
      new ctx.dom.window.MouseEvent('pointermove', { clientY, bubbles: true }),
    )

  const lockedState = await ctx.send({ type: 'fl:lock' })
  pointer(600)
  await tick()
  const whileLocked = await ctx.send({ type: 'fl:get' })

  const releasedState = await ctx.send({ type: 'fl:lock' })
  pointer(600)
  await tick()
  const whileReleased = await ctx.send({ type: 'fl:get' })

  await check('the lock shortcut freezes and releases the line', () => {
    assert.equal(lockedState.config.locked, true)
    assert.equal(whileLocked.config.y, 0.4, 'pointer moves are ignored while locked')
    assert.equal(releasedState.config.locked, false)
    assert.ok(whileReleased.config.y > 0.4, 'follow resumes once released')
  })
}

{
  const ctx = setup({
    'site:example.com': { active: true, y: 0.5 },
    shortcuts: { up: 'Ctrl+ArrowUp', down: 'Ctrl+ArrowDown' },
  })
  await tick()

  const key = (init) =>
    ctx.dom.window.dispatchEvent(
      new ctx.dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    )

  key({ key: 'ArrowDown', altKey: true })
  const afterDefault = await ctx.send({ type: 'fl:get' })

  key({ key: 'ArrowDown', ctrlKey: true })
  const afterCustom = await ctx.send({ type: 'fl:get' })

  key({ key: 'ArrowDown', altKey: true, shiftKey: true })
  const afterResize = await ctx.send({ type: 'fl:get' })

  await check('honours custom movement shortcuts from storage', () => {
    assert.ok(Math.abs(afterDefault.config.y - 0.5) < 1e-9, 'the default combo is inert once remapped')
    assert.ok(afterCustom.config.y > 0.5, 'the recorded combo moves the line')
    assert.equal(afterResize.config.height, 60, 'Alt + Shift + ↓ still resizes the band')
  })
}

{
  const ctx = setup(
    { 'site:example.com': { active: true }, uiLang: 'en' },
    {
      uiLangMessages: { hudDrag: { message: 'Drag the handle' } },
      browserMessages: { hudLocked: '阅读线已固定' },
      browserLanguage: 'zh-CN',
    },
  )
  await tick()

  ctx.dom.window.document.body.dispatchEvent(
    new ctx.dom.window.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 400,
      altKey: true,
      button: 0,
    }),
  )
  await tick()

  await check('an explicit language never falls back to the browser language', () => {
    assert.equal(ctx.hud().textContent, 'Line locked')
  })
}

{
  const ctx = setup(
    { 'site:example.com': { active: true }, uiLang: 'en' },
    { uiLangMessages: { hudLocked: { message: 'Line locked' } } },
  )
  await tick()

  const altClick = () =>
    ctx.dom.window.document.body.dispatchEvent(
      new ctx.dom.window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 400,
        altKey: true,
        button: 0,
      }),
    )

  ctx.store.uiLang = 'zh_CN'
  ctx.setLocale({ hudLocked: { message: '阅读线已固定' } })
  ctx.change({ uiLang: { oldValue: 'en', newValue: 'zh_CN' } })
  await tick()
  altClick()
  await tick()
  const chinese = ctx.hud().textContent

  ctx.store.uiLang = 'zh_TW'
  ctx.setLocale({ hudLocked: { message: '閱讀線已固定' } })
  ctx.change({ uiLang: { oldValue: 'zh_CN', newValue: 'zh_TW' } })
  await tick()
  altClick()
  await tick()

  await check('switching the language updates open tabs without a reload', () => {
    assert.equal(chinese, '阅读线已固定')
    assert.equal(ctx.hud().textContent, '閱讀線已固定')
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true } }, { highlightApi: true })
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'Alpha beta gamma delta'
  doc.body.appendChild(paragraph)
  doc.elementFromPoint = () => paragraph
  doc.caretRangeFromPoint = () => {
    const range = doc.createRange()
    range.setStart(paragraph.firstChild, 6)
    range.collapse(true)
    return range
  }

  const registry = () => ctx.dom.window.CSS.highlights
  const count = (name) => registry().get(name)?.ranges.length ?? 0
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  await ctx.send({ type: 'fl:patch', patch: { guide: 'words' } })
  await wait(240)
  const wordsA = count('fl-word-a')
  const wordsB = count('fl-word-b')

  await ctx.send({ type: 'fl:patch', patch: { guide: 'sentence' } })
  paragraph.textContent = 'One sentence here. Another sentence there.'
  await wait(240)
  const sentenceA = count('fl-word-a')
  const sentenceB = count('fl-word-b')
  const guideStyle = ctx.dom.window.document.getElementById('fl-guide-style')?.textContent ?? ''

  await ctx.send({ type: 'fl:patch', patch: { guide: 'off' } })
  await wait(240)
  const leftOver = ['fl-word-a', 'fl-word-b', 'fl-guide-sentence'].filter((name) => registry().has(name))

  await check('alternates word and sentence colours', () => {
    assert.equal(wordsA + wordsB, 4, 'every word in the block gets a colour')
    assert.equal(wordsA, 2, 'word colours alternate')
    assert.equal(wordsB, 2, 'word colours alternate')
    assert.equal(sentenceA, 1, 'first sentence uses the first guide colour')
    assert.equal(sentenceB, 1, 'second sentence uses the second guide colour')
    assert.deepEqual(leftOver, [], 'turning the guide off clears the registry')
  })

  await check('uses solid highlight colours instead of alpha tints', () => {
    assert.match(guideStyle, /background-color:#7dd3fc/)
    assert.match(guideStyle, /background-color:#fcd34d/)
    assert.doesNotMatch(guideStyle, /rgba\(/, 'no translucent highlight backgrounds')
    assert.match(guideStyle, /color:#0b1020/, 'text colour is set for contrast')
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true, guide: 'words' } }, { highlightApi: true })
  await tick()
  const doc = ctx.dom.window.document
  const container = doc.createElement('div')
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'Margin gap paragraph'
  container.appendChild(paragraph)
  doc.body.appendChild(container)
  // The line sits on the gap between blocks: the hit test only finds the
  // wrapper, so the paragraph has to come from the caret position.
  doc.elementFromPoint = () => container
  doc.caretRangeFromPoint = () => {
    const range = doc.createRange()
    range.setStart(paragraph.firstChild, 2)
    range.collapse(true)
    return range
  }

  await new Promise((resolve) => setTimeout(resolve, 240))
  const registry = ctx.dom.window.CSS.highlights
  const total =
    (registry.get('fl-word-a')?.ranges.length ?? 0) + (registry.get('fl-word-b')?.ranges.length ?? 0)

  await check('finds the paragraph when the line rests on the gap between blocks', () => {
    assert.equal(total, 3)
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true, follow: true, snap: true } })
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'Snap target line'
  doc.body.appendChild(paragraph)
  let lineTop = 400
  paragraph.getBoundingClientRect = () => ({
    width: 300,
    height: 20,
    top: lineTop,
    left: 0,
    right: 300,
    bottom: lineTop + 20,
    x: 0,
    y: lineTop,
  })
  doc.elementFromPoint = () => paragraph
  doc.caretRangeFromPoint = undefined

  doc.dispatchEvent(
    new ctx.dom.window.MouseEvent('pointermove', { clientX: 50, clientY: 600, bubbles: true }),
  )
  await tick()
  const state = await ctx.send({ type: 'fl:get' })

  // Scrolling moves the text under a stationary pointer; snap has to follow.
  lineTop = 200
  doc.dispatchEvent(new ctx.dom.window.Event('scroll'))
  await tick()
  const scrolled = await ctx.send({ type: 'fl:get' })

  await check('snaps the line to the text line under the pointer', () => {
    assert.ok(
      Math.abs(state.config.y - 410 / ctx.dom.window.innerHeight) < 0.01,
      `expected the line centre, got ${state.config.y}`,
    )
    assert.ok(state.config.y < 0.6, 'the raw pointer position is not used')
    assert.ok(
      Math.abs(scrolled.config.y - 210 / ctx.dom.window.innerHeight) < 0.01,
      `snap followed the text while scrolling, got ${scrolled.config.y}`,
    )
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true, guide: 'words' } }, { highlightApi: true })
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'Custom colour words'
  doc.body.appendChild(paragraph)
  doc.elementFromPoint = () => paragraph
  doc.caretRangeFromPoint = () => {
    const range = doc.createRange()
    range.setStart(paragraph.firstChild, 3)
    range.collapse(true)
    return range
  }
  await new Promise((resolve) => setTimeout(resolve, 240))

  await ctx.send({ type: 'fl:patch', patch: { guideColorA: '#ff0000', guideColorB: '#00ff00' } })
  await new Promise((resolve) => setTimeout(resolve, 240))
  const css = doc.getElementById('fl-guide-style')?.textContent ?? ''

  await check('uses the configured guide colours', () => {
    assert.match(css, /background-color:#ff0000/)
    assert.match(css, /background-color:#00ff00/)
    assert.match(css, /background-color:#ff0000;color:#ffffff/, 'dark guide colours get white text')
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true, y: 0.5 } })
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'Anchored text line'
  doc.body.appendChild(paragraph)

  let top = 500
  doc.caretRangeFromPoint = () => {
    const range = doc.createRange()
    range.setStart(paragraph.firstChild, 3)
    range.collapse(true)
    return range
  }
  ctx.dom.window.Range.prototype.getBoundingClientRect = () => ({
    width: 120,
    height: 20,
    top,
    left: 0,
    right: 120,
    bottom: top + 20,
    x: 0,
    y: top,
  })

  const locked = await ctx.send({ type: 'fl:lock' })
  top = 200
  ctx.dom.window.document.dispatchEvent(new ctx.dom.window.Event('scroll'))
  await tick()
  const scrolled = await ctx.send({ type: 'fl:get' })

  await ctx.send({ type: 'fl:lock' })
  top = 600
  ctx.dom.window.document.dispatchEvent(new ctx.dom.window.Event('scroll'))
  await tick()
  const released = await ctx.send({ type: 'fl:get' })

  await check('a locked line stays on its text while the page scrolls', () => {
    assert.equal(locked.config.locked, true)
    assert.ok(
      Math.abs(scrolled.config.y - 210 / ctx.dom.window.innerHeight) < 0.01,
      `the band followed the anchored line, got ${scrolled.config.y}`,
    )
    assert.equal(released.config.y, scrolled.config.y, 'unlocking stops the anchor')
  })
}

{
  const ctx = setup({ 'site:example.com': { active: true, y: 0.4 } })
  await tick()
  const doc = ctx.dom.window.document
  const paragraph = doc.createElement('p')
  paragraph.textContent = 'Height keeps while locked'
  doc.body.appendChild(paragraph)

  let top = 300
  doc.caretRangeFromPoint = () => {
    const range = doc.createRange()
    range.setStart(paragraph.firstChild, 2)
    range.collapse(true)
    return range
  }
  doc.elementFromPoint = () => paragraph
  paragraph.getBoundingClientRect = () => ({
    width: 200,
    height: 20,
    top,
    left: 0,
    right: 200,
    bottom: top + 20,
    x: 0,
    y: top,
  })
  ctx.dom.window.Range.prototype.getBoundingClientRect = () => ({
    width: 10,
    height: 20,
    top,
    left: 0,
    right: 10,
    bottom: top + 20,
    x: 0,
    y: top,
  })

  await ctx.send({ type: 'fl:lock' })
  await ctx.send({ type: 'fl:patch', patch: { height: 100 } })
  top = 150
  doc.dispatchEvent(new ctx.dom.window.Event('scroll'))
  await tick()
  const state = await ctx.send({ type: 'fl:get' })

  await check('keeps a custom height while the locked line follows its text', () => {
    assert.equal(state.config.height, 100, 'height was not reset to the default')
    assert.ok(Math.abs(state.config.y - 160 / ctx.dom.window.innerHeight) < 0.01)
  })
}

console.log(`\n${passed} checks passed`)

