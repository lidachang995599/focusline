/**
 * FocusLine content script.
 *
 * Content scripts are injected as classic scripts, so this file is deliberately
 * self-contained: no imports, no bundler. The handful of shared constants and
 * types are duplicated from src/shared/types.ts — keep them in sync.
 */

;(() => {
  const w = window as Window & { __focuslineLoaded?: boolean }
  if (w.__focuslineLoaded) return
  w.__focuslineLoaded = true

  interface TextConfig {
    zoom: number
    lineHeight: number
    letterSpacing: number
    wordSpacing: number
    fontSize: number
    measure: boolean
    alignLeft: boolean
    theme: string
  }

  interface SiteConfig {
    active: boolean
    y: number
    height: number
    dim: number
    color: string
    follow: boolean
    snap: boolean
    locked: boolean
    calm: boolean
    guide: 'off' | 'words' | 'sentence'
    guideColorA: string
    guideColorB: string
    hidden: string[]
    text: TextConfig
  }

  type Msg =
    | { type: 'fl:get' }
    | { type: 'fl:toggle' }
    | { type: 'fl:patch'; patch: Partial<SiteConfig> }
    | { type: 'fl:lock' }
    | { type: 'fl:pick' }
    | { type: 'fl:speak'; action: 'start' | 'pause' | 'resume' | 'stop' | 'rate' | 'color' | 'lang'; rate?: number; color?: string; lang?: string }

  interface SpeechState {
    speaking: boolean
    paused: boolean
    rate: number
    voiceURI: string
    color: string
    lang: string
  }

  interface TextSegment {
    node: Text
    start: number
    end: number
  }

  interface ReadSentence {
    text: string
    start: number
    end: number
  }

  interface StartPosition {
    index: number
    offset: number
  }

  interface HighlightLike {
    add(range: Range): void
    clear(): void
  }

  type HighlightCtor = new () => HighlightLike

  interface StateResponse {
    host: string
    active: boolean
    config: SiteConfig
    speech: SpeechState
  }

  const DEFAULT_CONFIG: SiteConfig = {
    active: false,
    y: 0.42,
    height: 48,
    dim: 0.55,
    color: '#7dd3fc',
    follow: false,
    snap: false,
    locked: false,
    calm: false,
    guide: 'off',
    guideColorA: '#7dd3fc',
    guideColorB: '#fcd34d',
    hidden: [],
    text: {
      zoom: 1,
      lineHeight: 0,
      letterSpacing: 0,
      wordSpacing: 0,
      fontSize: 0,
      measure: false,
      alignLeft: false,
      theme: 'default',
    },
  }

  interface ShortcutMap {
    up: string
    down: string
  }

  const DEFAULT_SHORTCUTS: ShortcutMap = {
    up: 'Alt+ArrowUp',
    down: 'Alt+ArrowDown',
  }

  const SHORTCUTS_KEY = 'shortcuts'
  const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Meta', 'Shift'])

  const HOST = location.hostname
  const ROOT_ID = 'focusline-root'
  const SITE_KEY = `site:${HOST}`

  const TEXT_EXCLUDE =
    ':not(i):not(svg):not(code):not(pre):not(kbd):not(samp):not(button):not(input):not(textarea):not(select):not([class*="icon"]):not([class*="Icon"]):not([class*="fa-"])'
  const TYPO_CLASS = 'fl-typography'
  // The :not(#…) raises specificity above page ID rules that use !important.
  const TYPO_ROOT = `html.${TYPO_CLASS}:not(#fl-never)`
  const TEXT_ALL = `${TYPO_ROOT}, ${TYPO_ROOT} *${TEXT_EXCLUDE}`
  const TEXT_BLOCK = `${TYPO_ROOT} body, ${TYPO_ROOT} p, ${TYPO_ROOT} li, ${TYPO_ROOT} blockquote, ${TYPO_ROOT} dd, ${TYPO_ROOT} dt, ${TYPO_ROOT} td, ${TYPO_ROOT} th, ${TYPO_ROOT} h1, ${TYPO_ROOT} h2, ${TYPO_ROOT} h3, ${TYPO_ROOT} h4, ${TYPO_ROOT} h5, ${TYPO_ROOT} h6`
  const TEXT_PROSE = `${TYPO_ROOT} p, ${TYPO_ROOT} li, ${TYPO_ROOT} blockquote, ${TYPO_ROOT} dd, ${TYPO_ROOT} dt, ${TYPO_ROOT} td, ${TYPO_ROOT} th`
  const TEXT_THEMES: Record<string, { bg: string; fg: string; link: string }> = {
    paper: { bg: '#f7f3e9', fg: '#2b2b2b', link: '#0b5fa5' },
    dark: { bg: '#101418', fg: '#e6e6e6', link: '#7dd3fc' },
    contrast: { bg: '#000000', fg: '#ffffff', link: '#ffff00' },
  }

  const CALM_CSS = `
*, *::before, *::after {
  animation-duration: 0.001ms !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`

  const SHADOW_CSS = `
:host { all: initial; }
.dim {
  position: fixed;
  left: 0;
  right: 0;
  height: 100vh;
  background: rgba(3, 7, 18, 0.55);
  pointer-events: none;
  will-change: transform;
}
.dim.top {
  top: 0;
  transform-origin: top center;
}
.dim.bottom {
  bottom: 0;
  transform-origin: bottom center;
}
.band {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 48px;
  border-top: 2px solid rgba(125, 211, 252, 0.6);
  border-bottom: 1px solid rgba(125, 211, 252, 0.22);
  background: rgba(125, 211, 252, 0.06);
  will-change: transform;
  pointer-events: none;
}
.handle {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.55);
  color: #e2e8f0;
  display: grid;
  place-items: center;
  font: 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  cursor: ns-resize;
  pointer-events: auto;
  touch-action: none;
  opacity: 0.7;
  transition: opacity 0.12s ease;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  user-select: none;
}
.handle:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
.handle:hover, .handle:focus-visible { opacity: 1; }
.hud {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.95);
  color: #e2e8f0;
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  white-space: nowrap;
  pointer-events: none;
  max-width: 80vw;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hl {
  position: fixed;
  pointer-events: none;
  outline: 2px solid #38bdf8;
  background: rgba(56, 189, 248, 0.12);
  border-radius: 3px;
}`

  let cfg: SiteConfig = { ...DEFAULT_CONFIG }
  let keys: ShortcutMap = { ...DEFAULT_SHORTCUTS }

  let root: HTMLDivElement | null = null
  let shadow: ShadowRoot | null = null
  let band: HTMLDivElement | null = null
  let topDim: HTMLDivElement | null = null
  let bottomDim: HTMLDivElement | null = null
  let handle: HTMLDivElement | null = null
  let hud: HTMLDivElement | null = null
  let highlight: HTMLDivElement | null = null

  let hudTimer = 0
  let saveTimer = 0
  let rafId = 0
  let picking = false
  let dragging = false
  let wired = false
  let scrollRaf = 0
  let anchorRange: Range | null = null
  let pointerX = -1
  let pointerY = -1

  let calmSheet: CSSStyleSheet | null = null
  let calmFallback: HTMLStyleElement | null = null
  let hideSheet: CSSStyleSheet | null = null
  let hideFallback: HTMLStyleElement | null = null
  let textSheet: CSSStyleSheet | null = null
  let textFallback: HTMLStyleElement | null = null

  let speech: SpeechState = {
    speaking: false,
    paused: false,
    rate: 1,
    voiceURI: '',
    color: '#fbbf24',
    lang: '',
  }
  let ttsText = ''
  let ttsSegments: TextSegment[] = []
  let ttsSentences: ReadSentence[] = []
  let ttsIndex = 0
  let ttsToken = 0
  let ttsVoice: SpeechSynthesisVoice | null = null
  let ttsStyle: HTMLStyleElement | null = null
  let ttsSentenceHighlight: HighlightLike | null = null
  let ttsWordHighlight: HighlightLike | null = null

  let guideStyle: HTMLStyleElement | null = null
  let guideSheet: CSSStyleSheet | null = null
  let guideA: HighlightLike | null = null
  let guideB: HighlightLike | null = null
  let guideSentence: HighlightLike | null = null
  let guideTimer = 0

  let messages: Record<string, string> | null = null
  let contentLocale = ''

  // Messages may arrive while boot() is still reading storage; handlers wait
  // for this promise so they never report the default config by mistake.
  const ready = boot()
  window.addEventListener('pagehide', () => stopSpeech(false))

  async function boot(): Promise<void> {
    await loadMessages()
    const stored = await getLocal<SiteConfig>(SITE_KEY)
    cfg = mergeConfig(stored[SITE_KEY])
    const storedKeys = await getLocal<ShortcutMap>(SHORTCUTS_KEY)
    keys = normalizeShortcuts(storedKeys[SHORTCUTS_KEY])

    watchStorage()
    if (cfg.active) enable()
  }

  function mergeConfig(stored?: Partial<SiteConfig> | null): SiteConfig {
    return {
      ...DEFAULT_CONFIG,
      ...(stored ?? {}),
      text: { ...DEFAULT_CONFIG.text, ...(stored?.text ?? {}) },
    }
  }

  /** Honours the manual language chosen in the popup, if any. */
  async function loadMessages(): Promise<void> {
    messages = null
    try {
      if (!hasStorage() || !chrome.runtime?.getURL) {
        contentLocale = browserLang()
        return
      }
      const stored = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get('uiLang', (items) => resolve(items as Record<string, unknown>))
      })
      const choice = typeof stored.uiLang === 'string' && stored.uiLang ? stored.uiLang : 'auto'
      if (choice === 'auto') {
        contentLocale = browserLang()
        return
      }

      const response = await fetch(chrome.runtime.getURL(`_locales/${choice}/messages.json`))
      const data = (await response.json()) as Record<string, { message?: string }>
      const map: Record<string, string> = {}
      for (const [key, value] of Object.entries(data)) {
        if (value?.message) map[key] = value.message
      }
      if (Object.keys(map).length === 0) throw new Error('empty locale bundle')
      messages = map
      contentLocale = choice
    } catch {
      // Falling back to the browser language is better than an empty UI, but
      // only when the chosen bundle could not be loaded at all.
      messages = null
      contentLocale = browserLang()
    }
  }

  /** Re-reads the language and refreshes the strings that were baked into the DOM. */
  async function applyLocale(): Promise<void> {
    await loadMessages()
    const rtl = /^(ar|fa|he|ur)/i.test(contentLocale)
    if (hud) hud.dir = rtl ? 'rtl' : 'ltr'
    if (handle) handle.setAttribute('aria-label', t('moveLine', 'Move the reading line'))
  }

  function browserLang(): string {
    try {
      return chrome.i18n?.getUILanguage?.() ?? 'en'
    } catch {
      return 'en'
    }
  }

  function t(key: string, fallback: string): string {
    // An explicit language must never fall back to the browser UI language:
    // that is exactly how a Chinese string leaks into an English interface.
    if (messages) return messages[key] ?? fallback
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n) {
        const value = chrome.i18n.getMessage(key)
        if (value) return value
      }
    } catch {
      // Fall through to the English fallback.
    }
    return fallback
  }

  function hasStorage(): boolean {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
  }

  function getLocal<T>(keys: string | string[]): Promise<Record<string, T>> {
    return new Promise((resolve) => {
      if (!hasStorage()) return resolve({} as Record<string, T>)
      chrome.storage.local.get(keys, (items) => resolve(items as Record<string, T>))
    })
  }

  function setLocal(items: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      if (!hasStorage()) return resolve()
      chrome.storage.local.set(items, () => resolve())
    })
  }

  function enable(): void {
    if (root) return
    root = document.createElement('div')
    root.id = ROOT_ID
    const s = root.style
    s.position = 'fixed'
    s.inset = '0'
    s.zIndex = '2147483647'
    s.pointerEvents = 'none'
    s.display = 'block'
    s.margin = '0'
    s.padding = '0'
    s.border = '0'
    s.background = 'transparent'

    shadow = root.attachShadow({ mode: 'open' })
    applyShadowStyles(shadow)

    topDim = document.createElement('div')
    topDim.className = 'dim top'
    bottomDim = document.createElement('div')
    bottomDim.className = 'dim bottom'

    band = document.createElement('div')
    band.className = 'band'

    handle = document.createElement('div')
    handle.className = 'handle'
    handle.setAttribute('role', 'slider')
    handle.setAttribute('aria-label', t('moveLine', 'Move the reading line'))
    handle.setAttribute('aria-orientation', 'vertical')
    handle.setAttribute('aria-valuemin', '0')
    handle.setAttribute('aria-valuemax', '100')
    handle.setAttribute('aria-valuenow', String(Math.round(cfg.y * 100)))
    handle.setAttribute('aria-valuetext', `${Math.round(cfg.y * 100)}%`)
    handle.tabIndex = 0
    handle.textContent = '\u2195'
    band.appendChild(handle)

    hud = document.createElement('div')
    hud.className = 'hud'
    hud.hidden = true
    try {
      hud.dir = /^(ar|fa|he|ur)/i.test(contentLocale) ? 'rtl' : 'ltr'
    } catch {
      // Direction is cosmetic; ignore environments without chrome.i18n.
    }

    highlight = document.createElement('div')
    highlight.className = 'hl'
    highlight.hidden = true

    shadow.append(topDim, bottomDim, band, hud, highlight)
    document.documentElement.appendChild(root)

    wire()
    render()
    setCalm(cfg.calm)
    applyHidden()
    applyText()
    showHud(
      cfg.snap
        ? t('hudSnap', 'Reading line on \u00b7 snapping to text lines')
        : cfg.follow
          ? t('hudFollow', 'Reading line on \u00b7 following the cursor')
          : t('hudDrag', 'Drag the handle, or press Alt + \u2191 / \u2193'),
      3000,
    )
    if (cfg.locked) {
      requestAnimationFrame(() => {
        if (cfg.locked) {
          captureAnchor(Math.round(window.innerWidth / 2), Math.round(cfg.y * window.innerHeight))
        }
      })
    }
    scheduleGuide()
  }

  function disable(): void {
    stopPick()
    stopSpeech()
    clearGuide()
    setCalm(false)
    clearHiddenStyles()
    clearTextStyles()
    if (wired) {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', stopDrag, true)
      window.removeEventListener('pointercancel', stopDrag, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onAltMouseDown, true)
      window.removeEventListener('contextmenu', onAltContextMenu, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('scroll', onScroll, true)
      wired = false
    }
    root?.remove()
    root = null
    shadow = null
    band = null
    topDim = null
    bottomDim = null
    handle = null
    hud = null
    highlight = null
    dragging = false
    anchorRange = null
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = 0
    }
  }

  function applyShadowStyles(sh: ShadowRoot): void {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(SHADOW_CSS)
      sh.adoptedStyleSheets = [...sh.adoptedStyleSheets, sheet]
    } catch {
      const style = document.createElement('style')
      style.textContent = SHADOW_CSS
      sh.appendChild(style)
    }
  }

  function render(): void {
    renderGeometry()
    renderStyle()
  }

  /** Only the cheap, per-frame part: position, height and the two dim panels. */
  function renderGeometry(): void {
    if (!band) return
    const viewport = window.innerHeight
    const height = Math.round(cfg.height)
    const top = Math.max(0, Math.min(viewport, Math.round(cfg.y * viewport - height / 2)))
    const bottom = Math.max(0, viewport - top - height)
    band.style.height = `${height}px`
    band.style.transform = `translateY(${top}px)`
    if (handle) {
      const percent = String(Math.round(cfg.y * 100))
      if (handle.getAttribute('aria-valuenow') !== percent) {
        handle.setAttribute('aria-valuenow', percent)
        handle.setAttribute('aria-valuetext', `${percent}%`)
      }
    }
    if (topDim) topDim.style.transform = `scaleY(${top / viewport})`
    if (bottomDim) bottomDim.style.transform = `scaleY(${bottom / viewport})`
    scheduleGuide()
  }

  /** Colours and dimming only change when settings change. */
  function renderStyle(): void {
    if (!band) return
    const color = cfg.color
    band.style.borderTopColor = rgba(color, 0.6)
    band.style.borderBottomColor = rgba(color, 0.22)
    band.style.background = rgba(color, 0.06)
    const dimColor = `rgba(3, 7, 18, ${cfg.dim})`
    if (topDim) topDim.style.background = dimColor
    if (bottomDim) bottomDim.style.background = dimColor
    if (handle) handle.hidden = picking
  }

  function rgba(hex: string, alpha: number): string {
    const raw = hex.replace('#', '')
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
    const value = Number.parseInt(full, 16)
    if (Number.isNaN(value) || full.length !== 6) return `rgba(125, 211, 252, ${alpha})`
    const r = (value >> 16) & 255
    const g = (value >> 8) & 255
    const b = value & 255
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  function setY(next: number): void {
    cfg.y = clamp(next, 0.03, 0.97)
    // A locked line is anchored to its text: nudging it re-anchors to the line
    // it lands on, so the next scroll keeps tracking the right words.
    if (cfg.locked) captureAnchor(Math.round(window.innerWidth / 2), Math.round(cfg.y * window.innerHeight))
    renderGeometry()
    saveSoon()
  }

  /** Remembers the character under the band so the line can stick to it. */
  function captureAnchor(x: number, y: number): void {
    anchorRange = null
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    if (typeof doc.caretRangeFromPoint !== 'function') return
    try {
      const range = doc.caretRangeFromPoint(x, y)
      const node = range?.startContainer
      if (!range || !node || node.nodeType !== Node.TEXT_NODE) return
      // A collapsed range reports a zero-size box in Chrome, so store the
      // character itself: its rect scrolls with the text.
      const text = node as Text
      const length = text.nodeValue?.length ?? 0
      if (length === 0) return
      const start = Math.min(range.startOffset, length - 1)
      const anchored = document.createRange()
      anchored.setStart(text, start)
      anchored.setEnd(text, Math.min(start + 1, length))
      anchorRange = anchored
    } catch {
      anchorRange = null
    }
  }

  /** Moves the band with the anchored line as the page scrolls under it. */
  function syncAnchor(): void {
    if (!cfg.locked || !anchorRange) return
    let rect: DOMRect | null = null
    try {
      const rects = typeof anchorRange.getClientRects === 'function' ? anchorRange.getClientRects() : []
      rect = rects && rects.length > 0 ? rects[0] : anchorRange.getBoundingClientRect()
    } catch {
      rect = null
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      // The anchored text is gone (SPA re-render, navigation). Fall back to a
      // viewport-fixed line instead of jumping to the top.
      anchorRange = null
      return
    }
    cfg.y = clamp((rect.top + rect.height / 2) / window.innerHeight, 0.02, 0.98)
    renderGeometry()
    saveSoon()
  }

  function setLocked(next: boolean): void {
    cfg.locked = next
    if (next) captureAnchor(Math.round(window.innerWidth / 2), Math.round(cfg.y * window.innerHeight))
    else anchorRange = null
    renderGeometry()
    void setLocal({ [SITE_KEY]: cfg })
    showHud(next ? t('hudLocked', 'Line locked') : t('hudUnlocked', 'Line released'), 1800)
  }

  function setHeight(next: number): void {
    cfg.height = clamp(next, 20, 180)
    renderGeometry()
    saveSoon()
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }

  function saveSoon(): void {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void setLocal({ [SITE_KEY]: cfg })
    }, 250)
  }

  function showHud(text: string, ms: number): void {
    if (!hud) return
    hud.textContent = text
    hud.hidden = false
    window.clearTimeout(hudTimer)
    if (ms > 0) {
      hudTimer = window.setTimeout(() => {
        if (!picking && hud) hud.hidden = true
      }, ms)
    }
  }

  // ---------------------------------------------------------------- read aloud

  function collectReadable(): { text: string; segments: TextSegment[] } {
    // Prefer the article around the line itself, so text under the light is
    // always part of the spoken document (even if it is outside <main>).
    const x = Math.round(window.innerWidth / 2)
    const line = Math.round(cfg.y * window.innerHeight)
    const target = document.elementFromPoint(x, line)
    const main = target?.closest('main, article, [role="main"]') ?? null
    const scope = main && (main.textContent?.trim().length ?? 0) > 200 ? main : document.body
    return collectText(scope)
  }

  /** Flattens the readable text under `scope` and keeps a node/offset map. */
  function collectText(scope: Node): { text: string; segments: TextSegment[] } {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (
          parent.closest(
            '#focusline-root,script,style,noscript,textarea,input,select,option,button,code,pre,kbd,samp,svg,[contenteditable="true"],[aria-hidden="true"],[hidden]',
          )
        ) {
          return NodeFilter.FILTER_REJECT
        }
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        const style = getComputedStyle(parent)
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT
        if (!parent.getClientRects().length) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    let text = ''
    const segments: TextSegment[] = []
    let node = walker.nextNode() as Text | null
    while (node) {
      const value = node.nodeValue ?? ''
      const start = text.length
      text += value
      segments.push({ node, start, end: start + value.length })
      text += ' '
      node = walker.nextNode() as Text | null
    }
    return { text, segments }
  }

  function normalizeSpeechLang(lang: string): string {
    return lang.replace(/_/g, '-').trim()
  }

  function speechLangBase(lang: string): string {
    return normalizeSpeechLang(lang).toLowerCase().split('-')[0] || 'en'
  }

  /** Kanji-only text is ambiguous, but kana/Hangul are strong signals. */
  function detectScriptLanguage(text: string): string | null {
    const sample = text.slice(0, 2000)
    const kana = (sample.match(/[\u3040-\u30ff]/g) ?? []).length
    if (kana > 0) return 'ja'
    const hangul = (sample.match(/[\uac00-\ud7af]/g) ?? []).length
    if (hangul > 0) return 'ko'
    const han = (sample.match(/[\u3400-\u9fff]/g) ?? []).length
    if (han > 0) return 'zh'
    return null
  }

  function resolveSpeechLanguage(text: string, requested?: string): string {
    const explicit = normalizeSpeechLang(requested ?? '')
    if (explicit && explicit !== 'auto') return explicit

    const script = detectScriptLanguage(text)
    if (script === 'ja' || script === 'ko') return script

    const page = normalizeSpeechLang(document.documentElement.lang || '')
    const ui = normalizeSpeechLang(contentLocale || '')
    if (script === 'zh') {
      if (['zh', 'ja', 'ko'].includes(speechLangBase(page))) return page
      if (['zh', 'ja', 'ko'].includes(speechLangBase(ui))) return ui
      return 'zh'
    }
    return page || ui || normalizeSpeechLang(navigator.language || '') || 'en'
  }

  /** Our menus store locales as `zh_CN`; Intl wants BCP-47 (`zh-CN`). */
  function safeLocale(tag: string): string {
    const clean = (tag || '').replace(/_/g, '-').trim()
    return clean || document.documentElement.lang || 'en'
  }

  function splitSentences(text: string, lang = ''): ReadSentence[] {
    const out: ReadSentence[] = []
    const SegmenterCtor = (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: { granularity?: string },
        ) => { segment(input: string): Iterable<{ segment: string; index: number }> }
      }
    ).Segmenter
    const locale = safeLocale(normalizeSpeechLang(lang) || document.documentElement.lang || 'en')

    if (SegmenterCtor) {
      try {
        const segmenter = new SegmenterCtor(locale, { granularity: 'sentence' })
        for (const part of segmenter.segment(text)) {
          const trimmed = part.segment.trim()
          if (!trimmed) continue
          const leading = part.segment.indexOf(trimmed)
          const start = part.index + leading
          out.push({ text: trimmed, start, end: start + trimmed.length })
        }
        return out
      } catch {
        // Fall through to the regex split below.
      }
    }

    const pattern = /[^.!?。！？\n]+[.!?。！？]?/g
    let match = pattern.exec(text)
    while (match) {
      const trimmed = match[0].trim()
      if (trimmed) {
        const start = match.index + match[0].indexOf(trimmed)
        out.push({ text: trimmed, start, end: start + trimmed.length })
      }
      match = pattern.exec(text)
    }
    return out
  }

  function locateChar(index: number): { node: Text; offset: number } | null {
    for (const segment of ttsSegments) {
      if (index >= segment.start && index < segment.end) {
        return { node: segment.node, offset: index - segment.start }
      }
    }
    return null
  }

  function rangeFor(start: number, end: number): Range | null {
    const first = locateChar(start)
    const last = locateChar(Math.max(start, end - 1))
    if (!first || !last) return null
    const range = document.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset + 1)
    return range
  }

  function highlightStyle(): string {
    const base = /^#[0-9a-f]{6}$/i.test(speech.color) ? speech.color : '#fbbf24'
    return (
      `::highlight(fl-sentence){background-color:${rgba(base, 0.22)};}` +
      `::highlight(fl-word){background-color:${rgba(base, 0.58)};}`
    )
  }

  function ensureHighlightRegistry(): boolean {
    const ctor = (window as unknown as { Highlight?: HighlightCtor }).Highlight
    if (!ctor) return false
    if (typeof CSS === 'undefined') return false
    const registry = (CSS as unknown as { highlights?: Map<string, HighlightLike> }).highlights
    if (!registry) return false

    if (!ttsStyle) {
      ttsStyle = document.createElement('style')
      ttsStyle.id = 'fl-tts-style'
      document.documentElement.appendChild(ttsStyle)
    }
    ttsStyle.textContent = highlightStyle()
    if (!ttsSentenceHighlight) {
      ttsSentenceHighlight = new ctor()
      registry.set('fl-sentence', ttsSentenceHighlight)
    }
    if (!ttsWordHighlight) {
      ttsWordHighlight = new ctor()
      registry.set('fl-word', ttsWordHighlight)
    }
    return true
  }

  function clearHighlights(): void {
    ttsSentenceHighlight?.clear()
    ttsWordHighlight?.clear()
  }

  // ------------------------------------------------------------- colour guide

  const WORD_HIGHLIGHT_A = 'fl-word-a'
  const WORD_HIGHLIGHT_B = 'fl-word-b'
  const SENTENCE_HIGHLIGHT = 'fl-guide-sentence'
  const GUIDE_BLOCK_SELECTOR = 'p,li,td,th,blockquote,dd,dt,h1,h2,h3,h4,h5,h6,figcaption'

  function guideColour(value: string, fallback: string): string {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
  }

  function guideCss(): string {
    const a = guideColour(cfg.guideColorA, '#7dd3fc')
    const b = guideColour(cfg.guideColorB, '#fcd34d')
    // The sentence highlight uses the second guide colour, not the line colour:
    // a light line colour would otherwise make the highlight invisible.
    // Solid highlighter colours: an opaque background needs an explicit text
    // colour, otherwise dark pages end up with dark-on-dark text.
    return (
      `::highlight(${WORD_HIGHLIGHT_A}){background-color:${a};color:${readableOn(a)};}` +
      `::highlight(${WORD_HIGHLIGHT_B}){background-color:${b};color:${readableOn(b)};}` +
      `::highlight(${SENTENCE_HIGHLIGHT}){background-color:${b};color:${readableOn(b)};}`
    )
  }

  /** Picks black or white text for a solid background. */
  function readableOn(hex: string): string {
    const raw = hex.replace('#', '')
    const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw
    const value = Number.parseInt(full, 16)
    if (Number.isNaN(value) || full.length !== 6) return '#0b1020'
    const channel = (shift: number): number => {
      const c = ((value >> shift) & 255) / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    return luminance > 0.42 ? '#0b1020' : '#ffffff'
  }

  /**
   * `::highlight()` rules have to live in a stylesheet that applies to the page
   * document. A constructed sheet keeps working under a strict `style-src` CSP,
   * and the `<style>` element covers engines without constructable sheets.
   */
  function ensureGuideStyle(css: string): void {
    if (!guideStyle) {
      guideStyle = document.createElement('style')
      guideStyle.id = 'fl-guide-style'
      document.documentElement.appendChild(guideStyle)
    }
    guideStyle.textContent = css

    if (!canAdopt()) return
    try {
      if (!guideSheet) guideSheet = new CSSStyleSheet()
      guideSheet.replaceSync(css)
      if (!document.adoptedStyleSheets.includes(guideSheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, guideSheet]
      }
    } catch {
      guideSheet = null
    }
  }

  function highlightRegistry(): Map<string, HighlightLike> | null {
    if (typeof CSS === 'undefined') return null
    const registry = (CSS as unknown as { highlights?: Map<string, HighlightLike> }).highlights
    return registry ?? null
  }

  /** Registers the guide highlights; false when the browser lacks the API. */
  function ensureGuide(): boolean {
    const ctor = (window as unknown as { Highlight?: HighlightCtor }).Highlight
    const registry = highlightRegistry()
    if (!ctor || !registry) return false

    ensureGuideStyle(guideCss())

    if (!guideA) {
      guideA = new ctor()
      registry.set(WORD_HIGHLIGHT_A, guideA)
    }
    if (!guideB) {
      guideB = new ctor()
      registry.set(WORD_HIGHLIGHT_B, guideB)
    }
    if (!guideSentence) {
      guideSentence = new ctor()
      registry.set(SENTENCE_HIGHLIGHT, guideSentence)
    }
    return true
  }

  function clearGuide(): void {
    const registry = highlightRegistry()
    if (registry) {
      registry.delete(WORD_HIGHLIGHT_A)
      registry.delete(WORD_HIGHLIGHT_B)
      registry.delete(SENTENCE_HIGHLIGHT)
    }
    guideA = null
    guideB = null
    guideSentence = null
    if (guideSheet && canAdopt()) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== guideSheet)
    }
    guideSheet = null
    if (guideStyle) {
      guideStyle.remove()
      guideStyle = null
    }
    window.clearTimeout(guideTimer)
    guideTimer = 0
  }

  /** The text block the line is resting on — the unit that gets coloured. */
  function guideBlockAt(x: number, y: number): Element | null {
    // The line often sits on the gap between two paragraphs, where a single
    // hit test lands on the container instead of the text. Probe around it.
    const probes: Array<[number, number]> = [
      [x, y],
      [x, y - 10],
      [x, y + 10],
      [x, y - 20],
      [x, y + 20],
      [Math.round(window.innerWidth * 0.3), y],
      [Math.round(window.innerWidth * 0.7), y],
    ]

    for (const [probeX, probeY] of probes) {
      const element = document.elementFromPoint(probeX, probeY)
      if (!element) continue
      if (root && (element === root || root.contains(element))) continue
      const semantic = element.closest(GUIDE_BLOCK_SELECTOR)
      if (semantic) return semantic
    }

    // `caretRangeFromPoint` snaps to the nearest character, which handles the
    // paragraph-gap case even when the hit test only finds a wrapper.
    const caret = caretAt(x, y)
    const fromCaret = caret?.node.parentElement?.closest(GUIDE_BLOCK_SELECTOR)
    if (fromCaret) return fromCaret

    let node: Element | null = document.elementFromPoint(x, y)
    let depth = 0
    while (node && node !== document.body && depth < 6) {
      const length = node.textContent?.trim().length ?? 0
      if (length > 0 && length <= 1200) return node
      node = node.parentElement
      depth += 1
    }
    return null
  }

  function caretAt(x: number, y: number): { node: Text; offset: number } | null {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    if (typeof doc.caretRangeFromPoint !== 'function') return null
    try {
      const range = doc.caretRangeFromPoint(x, y)
      const node = range?.startContainer
      if (node && node.nodeType === Node.TEXT_NODE) {
        return { node: node as Text, offset: range?.startOffset ?? 0 }
      }
    } catch {
      // Ignore.
    }
    return null
  }

  function locateIn(segments: TextSegment[], index: number): { node: Text; offset: number } | null {
    for (const segment of segments) {
      if (index >= segment.start && index < segment.end) {
        return { node: segment.node, offset: index - segment.start }
      }
    }
    return null
  }

  function rangeIn(segments: TextSegment[], start: number, end: number): Range | null {
    const first = locateIn(segments, start)
    const last = locateIn(segments, Math.max(start, end - 1))
    if (!first || !last) return null
    const range = document.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset + 1)
    return range
  }

  function wordRangesIn(text: string, segments: TextSegment[]): Range[] {
    const out: Range[] = []
    const SegmenterCtor = (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: { granularity?: string },
        ) => {
          segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>
        }
      }
    ).Segmenter

    if (SegmenterCtor) {
      try {
        const segmenter = new SegmenterCtor(safeLocale(contentLocale), { granularity: 'word' })
        for (const part of segmenter.segment(text)) {
          if (!part.isWordLike) continue
          const range = rangeIn(segments, part.index, part.index + part.segment.length)
          if (range) out.push(range)
          if (out.length >= 800) break
        }
        return out
      } catch {
        // Fall through to the whitespace split below.
      }
    }

    const pattern = /\S+/g
    let match = pattern.exec(text)
    while (match && out.length < 800) {
      const range = rangeIn(segments, match.index, match.index + match[0].length)
      if (range) out.push(range)
      match = pattern.exec(text)
    }
    return out
  }

  function scheduleGuide(): void {
    if (cfg.guide === 'off') {
      if (guideStyle) clearGuide()
      return
    }
    if (guideTimer) return
    guideTimer = window.setTimeout(() => {
      guideTimer = 0
      refreshGuide()
    }, 90)
  }

  function refreshGuide(): void {
    if (!cfg.active || cfg.guide === 'off' || !root) return
    if (!ensureGuide()) return

    guideA?.clear()
    guideB?.clear()
    guideSentence?.clear()

    const x = Math.round(window.innerWidth / 2)
    const y = Math.round(cfg.y * window.innerHeight)
    const block = guideBlockAt(x, y)
    if (!block) return

    const { text, segments } = collectText(block)
    if (!text.trim()) return

    if (cfg.guide === 'sentence') {
      // Sentence mode mirrors word mode at sentence granularity: alternate the
      // two guide colours so the paragraph clearly reads as a guide, and so a
      // light line colour cannot make the highlight disappear.
      const sentences = splitSentences(text, contentLocale)
      sentences.forEach((sentence, index) => {
        const range = rangeIn(segments, sentence.start, sentence.end)
        if (!range) return
        if (index % 2 === 0) guideA?.add(range)
        else guideB?.add(range)
      })
      return
    }

    const ranges = wordRangesIn(text, segments)
    ranges.forEach((range, index) => {
      if (index % 2 === 0) guideA?.add(range)
      else guideB?.add(range)
    })
  }

  function rangeRect(range: Range): DOMRect | null {
    if (typeof range.getBoundingClientRect !== 'function') return null
    return range.getBoundingClientRect()
  }

  function followSpeechRange(range: Range): void {
    let rect = rangeRect(range)
    if (!rect) return

    const viewport = window.innerHeight
    // Scroll the sentence back in when it has left the viewport.
    if (rect.bottom <= 0 || rect.top >= viewport) {
      window.scrollBy({
        top: rect.top - viewport * 0.35,
        behavior: 'instant' as unknown as ScrollBehavior,
      })
      rect = rangeRect(range) ?? rect
    }

    // Stay put while the band already covers the sentence; otherwise move to
    // it, so the line visibly follows the voice sentence by sentence.
    const lineTop = cfg.y * viewport - cfg.height / 2
    const covered = rect.top >= lineTop - 6 && rect.bottom <= lineTop + cfg.height + 6
    if (covered) return

    const center = (rect.top + rect.height / 2) / viewport
    setY(clamp(center, 0.08, 0.92))
  }

  function highlightSentence(sentence: ReadSentence): void {
    const range = rangeFor(sentence.start, sentence.end)
    if (!range) return
    followSpeechRange(range)
    if (!ensureHighlightRegistry()) return
    ttsSentenceHighlight?.clear()
    ttsWordHighlight?.clear()
    ttsSentenceHighlight?.add(range)
  }

  function highlightWord(sentence: ReadSentence, charIndex: number, charLength?: number): void {
    if (!ensureHighlightRegistry()) return
    const start = sentence.start + charIndex
    let end = start + (charLength && charLength > 0 ? charLength : 1)
    if (!charLength) {
      const rest = ttsText.slice(start).match(/^\S+/)
      if (rest) end = start + rest[0].length
    }
    const range = rangeFor(start, end)
    if (!range) return
    ttsWordHighlight?.clear()
    ttsWordHighlight?.add(range)
    // Follow the word being spoken, not just the sentence box: a sentence that
    // wraps over several lines would otherwise centre the band between lines.
    followSpeechRange(range)
  }

  function localVoices(): SpeechSynthesisVoice[] {
    if (typeof window.speechSynthesis === 'undefined') return []
    return window.speechSynthesis.getVoices().filter((voice) => voice.localService)
  }

  function waitForLocalVoices(): Promise<SpeechSynthesisVoice[]> {
    const now = localVoices()
    if (now.length) return Promise.resolve(now)
    return new Promise((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        window.speechSynthesis.removeEventListener('voiceschanged', done)
        resolve(localVoices())
      }
      window.speechSynthesis.addEventListener('voiceschanged', done)
      window.setTimeout(done, 1200)
    })
  }

  function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
    const target = normalizeSpeechLang(lang).toLowerCase()
    const base = speechLangBase(lang)
    const same = voices.filter(
      (voice) => speechLangBase(voice.lang) === base,
    )
    if (!same.length) return null
    return (
      same.find((voice) => voice.voiceURI === speech.voiceURI) ??
      same.find((voice) => normalizeSpeechLang(voice.lang).toLowerCase() === target) ??
      same.find((voice) => voice.default) ??
      same[0] ??
      null
    )
  }

  function wordStartOffset(text: string, offset: number): number {
    const clamped = Math.max(0, Math.min(text.length, offset))
    const SegmenterCtor = (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: { granularity?: string },
        ) => { segment(input: string): Iterable<{ segment: string; index: number }> }
      }
    ).Segmenter
    if (SegmenterCtor) {
      const segmenter = new SegmenterCtor(
        normalizeSpeechLang(speech.lang) || document.documentElement.lang || 'en',
        { granularity: 'word' },
      )
      let fallback = 0
      for (const part of segmenter.segment(text)) {
        const end = part.index + part.segment.length
        if (clamped >= part.index && clamped < end) {
          return /^\s+$/.test(part.segment) ? end : part.index
        }
        if (part.index <= clamped) fallback = part.index
      }
      return fallback
    }
    const before = text.slice(0, clamped)
    const match = before.match(/\S*$/)
    return match ? clamped - match[0].length : clamped
  }

  function caretIndexAtPoint(x: number, y: number): number | null {
    const doc = document as Document & {
      caretRangeFromPoint?: (px: number, py: number) => Range | null
      caretPositionFromPoint?: (px: number, py: number) => { offsetNode: Node; offset: number } | null
    }
    let node: Node | null = null
    let offset = 0

    if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y)
      if (range) {
        node = range.startContainer
        offset = range.startOffset
      }
    } else if (typeof doc.caretPositionFromPoint === 'function') {
      const position = doc.caretPositionFromPoint(x, y)
      if (position) {
        node = position.offsetNode
        offset = position.offset
      }
    }

    if (!node || node.nodeType !== Node.TEXT_NODE) return null
    const segment = ttsSegments.find((item) => item.node === node)
    return segment ? segment.start + offset : null
  }

  function caretIndexAtLine(line: number): number | null {
    // The exact centre can land in a column gutter or a line gap; probe a few
    // points across the band before giving up and falling back to rect math.
    const xs = [0.5, 0.35, 0.65, 0.2, 0.8].map((ratio) =>
      Math.round(window.innerWidth * ratio),
    )
    const ys = [line, line - 8, line + 8]
    for (const x of xs) {
      for (const y of ys) {
        const index = caretIndexAtPoint(x, y)
        if (index !== null) return index
      }
    }
    return null
  }

  function wordOffsetNearLine(sentence: ReadSentence, line: number): number {
    const SegmenterCtor = (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: { granularity?: string },
        ) => { segment(input: string): Iterable<{ segment: string; index: number }> }
      }
    ).Segmenter
    if (!SegmenterCtor) return 0

    const segmenter = new SegmenterCtor(
      normalizeSpeechLang(speech.lang) || document.documentElement.lang || 'en',
      { granularity: 'word' },
    )
    let bestOffset = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (const part of segmenter.segment(sentence.text)) {
      if (!part.segment.trim()) continue
      const start = sentence.start + part.index
      const range = rangeFor(start, start + part.segment.length)
      if (!range) continue
      const rect = rangeRect(range)
      if (!rect) continue
      if (rect.top <= line && rect.bottom >= line) return part.index
      const distance = Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line))
      if (distance < bestDistance) {
        bestOffset = part.index
        bestDistance = distance
      }
    }
    return bestOffset
  }

  function pickStartSentence(sentences: ReadSentence[]): StartPosition {
    const line = cfg.y * window.innerHeight
    const caret = caretIndexAtLine(line)
    if (caret !== null) {
      const index = sentences.findIndex(
        (sentence) => caret >= sentence.start && caret < sentence.end,
      )
      if (index >= 0) {
        return {
          index,
          offset: wordStartOffset(sentences[index].text, caret - sentences[index].start),
        }
      }
    }

    // The caret API is not available everywhere: fall back to the sentence
    // whose vertical span is closest to the light, then the closest word.
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < sentences.length; index += 1) {
      const range = rangeFor(sentences[index].start, sentences[index].end)
      if (!range) continue
      const rect = rangeRect(range)
      if (!rect) continue
      if (rect.top <= line && rect.bottom >= line) {
        return { index, offset: wordOffsetNearLine(sentences[index], line) }
      }
      const distance = Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line))
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    }
    return { index: best, offset: wordOffsetNearLine(sentences[best], line) }
  }

  function normalizeSpeechColor(color: string | undefined): string | null {
    return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null
  }

  function setSpeechColor(color: string | undefined): void {
    const next = normalizeSpeechColor(color)
    if (!next) return
    speech.color = next
    if (ttsStyle) ttsStyle.textContent = highlightStyle()
  }

  async function startSpeech(rate?: number, color?: string, lang?: string): Promise<void> {
    if (
      typeof window.speechSynthesis === 'undefined' ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      showHud(t('readUnsupported', 'This browser cannot read aloud'), 2600)
      return
    }

    stopSpeech(false)
    if (typeof rate === 'number' && Number.isFinite(rate)) speech.rate = clamp(rate, 0.5, 2)
    setSpeechColor(color)

    // Read-aloud needs the band on screen for the follow-the-sentence effect.
    if (!root) {
      cfg.active = true
      enable()
      if (root) void setLocal({ [SITE_KEY]: cfg })
    }

    const data = collectReadable()
    if (!data.text.trim()) {
      showHud(t('readNoText', 'No readable text found'), 2400)
      return
    }
    ttsText = data.text
    ttsSegments = data.segments
    speech.lang = resolveSpeechLanguage(data.text, lang)
    ttsSentences = splitSentences(data.text, speech.lang)
    if (!ttsSentences.length) {
      showHud(t('readNoText', 'No readable text found'), 2400)
      return
    }

    const token = ++ttsToken
    const voices = await waitForLocalVoices()
    if (token !== ttsToken) return

    const voice = pickVoice(voices, speech.lang)
    if (!voice) {
      showHud(`${t('readNoVoice', 'No local voice available')} (${speech.lang})`, 3000)
      return
    }

    ttsVoice = voice
    speech.voiceURI = voice.voiceURI
    speech.speaking = true
    speech.paused = false
    const start = pickStartSentence(ttsSentences)
    ttsIndex = start.index
    if (start.offset > 0) {
      const sentence = ttsSentences[ttsIndex]
      ttsSentences[ttsIndex] = {
        text: sentence.text.slice(start.offset),
        start: sentence.start + start.offset,
        end: sentence.end,
      }
    }
    ensureHighlightRegistry()
    showHud(t('hudSpeaking', 'Reading aloud · Esc to stop'), 2600)
    speakSentence(ttsIndex)
  }

  function speakSentence(index: number): void {
    if (!speech.speaking) return
    if (index >= ttsSentences.length) {
      finishSpeech()
      return
    }

    const sentence = ttsSentences[index]
    ttsIndex = index
    highlightSentence(sentence)

    const utterance = new SpeechSynthesisUtterance(sentence.text)
    utterance.lang =
      normalizeSpeechLang(ttsVoice?.lang || speech.lang) || document.documentElement.lang || 'en'
    utterance.rate = speech.rate
    if (ttsVoice) utterance.voice = ttsVoice

    const token = ++ttsToken
    utterance.onboundary = (event) => {
      if (token !== ttsToken || !speech.speaking || speech.paused) return
      if (event.name && event.name !== 'word') return
      const length = (event as SpeechSynthesisEvent & { charLength?: number }).charLength
      highlightWord(sentence, event.charIndex, length)
    }
    utterance.onend = () => {
      if (token !== ttsToken || !speech.speaking || speech.paused) return
      speakSentence(index + 1)
    }
    utterance.onerror = (event) => {
      if (token !== ttsToken) return
      if (event.error === 'interrupted' || event.error === 'canceled') return
      stopSpeech()
      showHud(t('readUnsupported', 'This browser cannot read aloud'), 2600)
    }

    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      stopSpeech()
      showHud(t('readUnsupported', 'This browser cannot read aloud'), 2600)
    }
  }

  function finishSpeech(): void {
    speech.speaking = false
    speech.paused = false
    ttsToken += 1
    clearHighlights()
    if (hud && !picking) hud.hidden = true
  }

  function stopSpeech(clearHud = true): void {
    speech.speaking = false
    speech.paused = false
    ttsToken += 1
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // Ignore speech API errors.
    }
    clearHighlights()
    if (clearHud && hud && !picking) hud.hidden = true
  }

  function pauseSpeech(): void {
    if (!speech.speaking || speech.paused) return
    speech.paused = true
    try {
      window.speechSynthesis.pause()
    } catch {
      // Ignore.
    }
    showHud(t('hudPaused', 'Reading paused'), 1800)
  }

  function resumeSpeech(): void {
    if (!speech.speaking || !speech.paused) return
    speech.paused = false
    try {
      window.speechSynthesis.resume()
    } catch {
      // Ignore.
    }
    showHud(t('hudSpeaking', 'Reading aloud · Esc to stop'), 1800)
  }

  function setSpeechRate(rate: number): void {
    speech.rate = clamp(rate, 0.5, 2)
    if (speech.speaking && !speech.paused) {
      ttsToken += 1
      try {
        window.speechSynthesis.cancel()
      } catch {
        // Ignore.
      }
      speakSentence(ttsIndex)
    }
  }

  async function setSpeechLang(lang: string): Promise<void> {
    if (speech.speaking) {
      await startSpeech(speech.rate, speech.color, lang)
    } else {
      speech.lang = lang && lang !== 'auto' ? normalizeSpeechLang(lang) : ''
    }
  }

  function speechState(): SpeechState {
    return { ...speech }
  }

  function wire(): void {
    if (!handle || wired) return
    wired = true
    const handleEl = handle

    handleEl.addEventListener('pointerdown', (event: PointerEvent) => {
      if (cfg.locked) return
      event.preventDefault()
      event.stopPropagation()
      dragging = true
      handleEl.setPointerCapture(event.pointerId)
    })

    handleEl.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return
      event.preventDefault()
      setY(event.clientY / window.innerHeight)
    })

    handleEl.addEventListener('pointerup', stopDrag)
    handleEl.addEventListener('pointercancel', stopDrag)

    handleEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const step = event.shiftKey ? 0.05 : 0.01
      let next: number | null = null
      if (event.key === 'ArrowUp') next = cfg.y - step
      else if (event.key === 'ArrowDown') next = cfg.y + step
      else if (event.key === 'PageUp') next = cfg.y - 0.1
      else if (event.key === 'PageDown') next = cfg.y + 0.1
      else if (event.key === 'Home') next = 0.03
      else if (event.key === 'End') next = 0.97
      if (next === null) return
      event.preventDefault()
      event.stopPropagation()
      setY(next)
    })

    // Capture phase: some sites stop pointermove propagation over buttons and
    // other interactive elements, which used to freeze follow-cursor mode.
    window.addEventListener('pointerup', stopDrag, true)
    window.addEventListener('pointercancel', stopDrag, true)
    window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true })
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onAltMouseDown, true)
    window.addEventListener('contextmenu', onAltContextMenu, true)
    window.addEventListener('resize', onResize)
    // Capture phase so inner scroll containers (app shells, code panes) are
    // covered too — scroll does not bubble, but it can be captured.
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
  }

  function onScroll(): void {
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      if (cfg.locked) syncAnchor()
      // With snap on, scrolling changes which text sits under the pointer, so
      // the line has to re-snap without waiting for the pointer to move.
      else if (cfg.snap && !speech.speaking && pointerX >= 0) snapToPointer()
      scheduleGuide()
    })
  }

  function onResize(): void {
    if (cfg.locked) syncAnchor()
    render()
  }

  const stopDrag = (): void => {
    dragging = false
  }

  function onPointerMove(event: PointerEvent): void {
    pointerX = event.clientX
    pointerY = event.clientY
    if (dragging && event.buttons === 0) dragging = false
    if ((!cfg.follow && !cfg.snap) || cfg.locked || dragging || picking || speech.speaking) return
    if (rafId) return
    const clientY = event.clientY
    rafId = requestAnimationFrame(() => {
      rafId = 0
      if (cfg.snap) {
        snapToPointer()
        return
      }
      setY(clientY / window.innerHeight)
    })
  }

  /**
   * Snap mode: park on the centre of the text line under the pointer. Over
   * images or margins there is nothing to snap to, so the line stays put.
   */
  function snapToPointer(): void {
    // Reading aloud takes priority: the speech follower moves the line from
    // sentence to sentence, so snapping here would fight it.
    if (!cfg.snap || speech.speaking) return
    const line = textLineAt(pointerX, pointerY)
    if (!line) return
    const next = (line.top + line.height / 2) / window.innerHeight
    if (Math.abs(next - cfg.y) < 0.002) return
    setY(next)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (picking) return
    if (event.key === 'Escape' && speech.speaking) {
      event.preventDefault()
      stopSpeech()
      return
    }
    // Shortcuts always keep a modifier, so plain typing in the page is safe.
    if (!event.altKey && !event.ctrlKey && !event.metaKey) return

    const combo = comboFromEvent(event)
    if (combo && (combo === keys.up || combo === keys.down)) {
      event.preventDefault()
      setY(cfg.y + (combo === keys.up ? -0.01 : 0.01))
      return
    }

    // Alt + Shift + ↑ / ↓ stays a fixed resize gesture: it is the one action
    // that needs a second modifier, and keeping it out of the recorded map
    // avoids stealing the user's chosen movement keys.
    if (!event.altKey || !event.shiftKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setHeight(cfg.height + (event.key === 'ArrowUp' ? -12 : 12))
  }

  function isModifierKey(key: string): boolean {
    return MODIFIER_KEYS.has(key)
  }

  function keyName(key: string): string {
    if (key === ' ') return 'Space'
    if (key.length === 1) return key.toUpperCase()
    return key
  }

  function comboFromEvent(event: KeyboardEvent): string {
    if (!event.key || isModifierKey(event.key)) return ''
    const parts: string[] = []
    if (event.ctrlKey) parts.push('Ctrl')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    if (event.metaKey) parts.push('Meta')
    parts.push(keyName(event.key))
    return parts.join('+')
  }

  function normalizeShortcuts(value: unknown): ShortcutMap {
    const raw = (value ?? {}) as Partial<ShortcutMap>
    return {
      up: typeof raw.up === 'string' ? raw.up : DEFAULT_SHORTCUTS.up,
      down: typeof raw.down === 'string' ? raw.down : DEFAULT_SHORTCUTS.down,
    }
  }

  /**
   * Alt + click places the line exactly under the pointer instead of dragging
   * it there. Without this, follow-cursor users have no way to "drop" the line
   * and keep it still.
   */
  function onAltMouseDown(event: MouseEvent): void {
    if (picking || !event.altKey) return
    if (event.button !== 0 && event.button !== 2) return

    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    if (root && path.includes(root)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.button === 2) {
      // Alt + right click releases the lock and leaves the line where it is.
      if (cfg.locked) setLocked(false)
      return
    }

    placeAt(event.clientX, event.clientY)
  }

  /** Alt + right click should not open the page context menu. */
  function onAltContextMenu(event: MouseEvent): void {
    if (!event.altKey) return
    event.preventDefault()
    event.stopPropagation()
  }

  function placeAt(x: number, y: number): void {
    const line = textLineAt(x, y)
    // Positioning must not touch the height: a hand-tuned band would otherwise
    // snap back to the line height on the next Alt + click.
    cfg.y = line
      ? clamp((line.top + line.height / 2) / window.innerHeight, 0.03, 0.97)
      : clamp(y / window.innerHeight, 0.03, 0.97)
    cfg.locked = true
    captureAnchor(x, y)
    render()
    saveSoon()
    showHud(t('hudLocked', 'Line locked'), 2000)
  }

  /** Returns the client rect of the text line under the point, if any. */
  function textLineAt(x: number, y: number): { top: number; height: number } | null {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }

    if (typeof doc.caretRangeFromPoint === 'function') {
      try {
        const range = doc.caretRangeFromPoint(x, y)
        const rects = range?.getClientRects?.()
        const rect = rects && rects.length > 0 ? rects[0] : null
        if (rect && rect.height > 4) return { top: rect.top, height: rect.height }
      } catch {
        // Fall through to the element rect.
      }
    }

    const element = document.elementFromPoint(x, y)
    const rect = element?.getBoundingClientRect()
    // A full-page wrapper would produce a 600px "line"; only trust text-sized
    // boxes.
    if (!rect || rect.height <= 0 || rect.height > 120) return null
    return { top: rect.top, height: rect.height }
  }

  function canAdopt(): boolean {
    return Array.isArray(document.adoptedStyleSheets)
  }

  function setCalm(on: boolean): void {
    if (!on) {
      if (calmSheet && canAdopt()) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== calmSheet)
      }
      calmSheet = null
      calmFallback?.remove()
      calmFallback = null
      return
    }

    if (canAdopt()) {
      try {
        if (!calmSheet) {
          calmSheet = new CSSStyleSheet()
          calmSheet.replaceSync(CALM_CSS)
        }
        if (!document.adoptedStyleSheets.includes(calmSheet)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, calmSheet]
        }
        return
      } catch {
        calmSheet = null
      }
    }

    if (!calmFallback) {
      calmFallback = document.createElement('style')
      calmFallback.id = 'fl-calm'
      document.documentElement.appendChild(calmFallback)
    }
    calmFallback.textContent = CALM_CSS
  }

  function applyHidden(): void {
    const selectors = cfg.hidden.filter(isValidSelector)
    if (selectors.length === 0) {
      clearHiddenStyles()
      return
    }
    const css = selectors.map((selector) => `${selector} { display: none !important; }`).join('\n')

    if (canAdopt()) {
      try {
        if (!hideSheet) hideSheet = new CSSStyleSheet()
        hideSheet.replaceSync(css)
        if (!document.adoptedStyleSheets.includes(hideSheet)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, hideSheet]
        }
        return
      } catch {
        hideSheet = null
      }
    }

    if (!hideFallback) {
      hideFallback = document.createElement('style')
      hideFallback.id = 'fl-hide'
      document.documentElement.appendChild(hideFallback)
    }
    hideFallback.textContent = css
  }

  function clearHiddenStyles(): void {
    if (hideSheet && canAdopt()) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== hideSheet)
    }
    hideSheet = null
    hideFallback?.remove()
    hideFallback = null
  }

  /** Applies the optional typography overrides (line height, spacing, theme). */
  function applyText(): void {
    const text = cfg.text
    const spacingDeclarations: string[] = []

    if (text.letterSpacing > 0) {
      spacingDeclarations.push(`letter-spacing:${text.letterSpacing.toFixed(3)}em !important`)
    }
    if (text.wordSpacing > 0) {
      spacingDeclarations.push(`word-spacing:${text.wordSpacing.toFixed(3)}em !important`)
    }

    let css = ''
    if (spacingDeclarations.length > 0) {
      css += `${TEXT_ALL}{${spacingDeclarations.join(';')}}`
    }
    if (text.lineHeight > 0) {
      css += `${TEXT_BLOCK}{line-height:${text.lineHeight.toFixed(2)} !important}`
    }
    if (text.fontSize > 0) {
      css += `${TEXT_PROSE}{font-size:${text.fontSize.toFixed(1)}px !important}`
    }
    if (text.measure) {
      css += `${TEXT_PROSE}{max-width:65ch !important}`
    }
    if (text.alignLeft) {
      css += `${TEXT_BLOCK}{text-align:left !important;text-align-last:left !important}`
    }

    const theme = TEXT_THEMES[text.theme]
    if (theme) {
      css += `${TYPO_ROOT}, ${TYPO_ROOT} body{background-color:${theme.bg} !important}`
      // Colour the page through inheritance instead of forcing every
      // descendant: cards/banners that set their own colour (dark cookie
      // banners, alerts) keep it, which preserves contrast.
      css += `${TYPO_ROOT} body{color:${theme.fg} !important}`
      // Keep this selector weak (no !important, no ID): links that the site
      // colours itself (e.g. inside a dark card) keep their original colour.
      css += `a{color:${theme.link}}`
    }

    if (!css) {
      clearTextStyles()
      return
    }

    document.documentElement.classList.add(TYPO_CLASS)

    if (canAdopt()) {
      try {
        if (!textSheet) textSheet = new CSSStyleSheet()
        textSheet.replaceSync(css)
        if (!document.adoptedStyleSheets.includes(textSheet)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, textSheet]
        }
        return
      } catch {
        textSheet = null
      }
    }

    if (!textFallback) {
      textFallback = document.createElement('style')
      textFallback.id = 'fl-text'
      document.documentElement.appendChild(textFallback)
    }
    textFallback.textContent = css
  }

  function clearTextStyles(): void {
    if (textSheet && canAdopt()) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== textSheet)
    }
    textSheet = null
    textFallback?.remove()
    textFallback = null
    document.documentElement.classList.remove(TYPO_CLASS)
  }

  function isValidSelector(selector: string): boolean {
    try {
      document.querySelector(selector)
      return true
    } catch {
      return false
    }
  }

  function startPick(): void {
    if (picking) return
    if (!root) {
      // Picking needs the overlay for the highlight/HUD; turn the line on
      // instead of silently doing nothing when it was off.
      cfg.active = true
      enable()
      if (root) void setLocal({ [SITE_KEY]: cfg })
    }
    if (!root) return
    picking = true
    document.addEventListener('click', onPickClick, true)
    document.addEventListener('pointermove', onPickHover, true)
    document.addEventListener('keydown', onPickKey, true)
    render()
    showHud(t('hudPick', 'Click the element to hide \u00b7 Esc to cancel'), 0)
  }

  function stopPick(): void {
    if (!picking && !highlight) {
      document.removeEventListener('click', onPickClick, true)
      document.removeEventListener('pointermove', onPickHover, true)
      document.removeEventListener('keydown', onPickKey, true)
      return
    }
    picking = false
    document.removeEventListener('click', onPickClick, true)
    document.removeEventListener('pointermove', onPickHover, true)
    document.removeEventListener('keydown', onPickKey, true)
    if (highlight) {
      highlight.hidden = true
      highlight.style.width = '0px'
      highlight.style.height = '0px'
    }
    if (hud) hud.hidden = true
    render()
  }

  function onPickKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    stopPick()
  }

  function onPickHover(event: PointerEvent): void {
    if (!highlight) return
    const target = event.target as Element | null
    if (!target || target === root) return
    const rect = target.getBoundingClientRect()
    highlight.hidden = false
    highlight.style.left = `${rect.left}px`
    highlight.style.top = `${rect.top}px`
    highlight.style.width = `${rect.width}px`
    highlight.style.height = `${rect.height}px`
  }

  function onPickClick(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    const target = event.target as Element | null
    if (!target || target === root) return
    const selector = cssPath(target)
    if (selector && isValidSelector(selector) && !cfg.hidden.includes(selector)) {
      cfg.hidden.push(selector)
      applyHidden()
      void setLocal({ [SITE_KEY]: cfg })
      showHud(t('hudHidden', 'Hidden. Undo it from the FocusLine menu.'), 2400)
    }
    stopPick()
  }

  function cssPath(element: Element): string {
    if (element.id) {
      const selector = `#${CSS.escape(element.id)}`
      if (document.querySelectorAll(selector).length === 1) return selector
    }
    const parts: string[] = []
    let current: Element | null = element
    let depth = 0
    while (current && current !== document.documentElement && depth < 5) {
      const node: Element = current
      let part = node.tagName.toLowerCase()
      const classes = Array.from(node.classList)
        .filter((name) => /^[A-Za-z_][\w-]*$/.test(name))
        .slice(0, 2)
      if (classes.length > 0) {
        part += `.${classes.map((name) => CSS.escape(name)).join('.')}`
      }
      const parent: Element | null = node.parentElement
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName)
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`
        }
      }
      parts.unshift(part)
      current = parent
      depth += 1
    }
    return parts.join(' > ')
  }

  function applyPatch(patch: Partial<SiteConfig>): void {
    const wasActive = cfg.active
    Object.assign(cfg, patch)
    if (cfg.active) {
      enable()
      render()
      if (patch.calm !== undefined) setCalm(cfg.calm)
      if (patch.hidden !== undefined) applyHidden()
      if (patch.text !== undefined) applyText()
    } else if (wasActive) {
      disable()
    }
  }

  function state(): StateResponse {
    return { host: HOST, active: Boolean(root), config: { ...cfg }, speech: speechState() }
  }

  async function handleMessage(msg: Msg): Promise<StateResponse> {
    await ready
    switch (msg.type) {
      case 'fl:get':
        break
      case 'fl:toggle':
        cfg.active = !cfg.active
        if (cfg.active) enable()
        else disable()
        void setLocal({ [SITE_KEY]: cfg })
        break
      case 'fl:patch':
        applyPatch(msg.patch)
        void setLocal({ [SITE_KEY]: cfg })
        break
      case 'fl:pick':
        startPick()
        break
      case 'fl:lock':
        // Locking a line that is not on screen makes no sense; show it first.
        if (!cfg.active) {
          cfg.active = true
          enable()
        }
        setLocked(!cfg.locked)
        break
      case 'fl:speak':
        if (msg.action === 'start') await startSpeech(msg.rate, msg.color, msg.lang)
        else if (msg.action === 'pause') pauseSpeech()
        else if (msg.action === 'resume') resumeSpeech()
        else if (msg.action === 'rate') setSpeechRate(msg.rate ?? speech.rate)
        else if (msg.action === 'color') setSpeechColor(msg.color)
        else if (msg.action === 'lang') await setSpeechLang(msg.lang ?? 'auto')
        else stopSpeech()
        break
    }
    return state()
  }

  function watchStorage(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return

      const siteChange = changes[SITE_KEY]
      if (changes[SHORTCUTS_KEY]) {
        keys = normalizeShortcuts(changes[SHORTCUTS_KEY].newValue)
      }
      if (changes.uiLang) void applyLocale()
      if (siteChange?.newValue) {
        const next = mergeConfig(siteChange.newValue as Partial<SiteConfig>)
        if (JSON.stringify(next) === JSON.stringify(cfg)) return
        cfg = next
        if (cfg.active && !root) enable()
        else if (!cfg.active && root) disable()
        else if (root) {
          render()
          setCalm(cfg.calm)
          applyHidden()
          applyText()
        }
      }
    })
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
      void handleMessage(msg).then((response) => sendResponse(response))
      return true
    })
  }
})()





