/**
 * FocusLine Reader — a PDF viewer that carries the reading line.
 *
 * Chrome renders PDFs in an internal plugin page that content scripts cannot
 * touch, so the only honest way to put the line over a PDF is to render the
 * PDF ourselves. This page does that with pdf.js and reuses the same band /
 * dim-panel design as the in-page overlay.
 */
import { detectLang, normalizeLocale, splitSentences, type Sentence } from './speech.js'
import { applyDocumentLocale, initI18n, t } from '../shared/i18n.js'

interface PdfConfig {
  y: number
  height: number
  dim: number
  color: string
  locked: boolean
  snap: boolean
  guide: 'off' | 'words' | 'sentence'
  guideColorA: string
  guideColorB: string
  speechColor: string
}

interface PageEntry {
  number: number
  wrap: HTMLDivElement
  canvas: HTMLCanvasElement
  text: HTMLDivElement
  state: 'idle' | 'busy' | 'done'
  rendering: Promise<void> | null
}

interface TextSegment {
  node: Text
  start: number
  end: number
}

const CONFIG_KEY = 'pdf'
const DEFAULT_CONFIG: PdfConfig = {
  y: 0.42,
  height: 48,
  dim: 0.55,
  color: '#7dd3fc',
  locked: false,
  snap: false,
  guide: 'off',
  guideColorA: '#7dd3fc',
  guideColorB: '#fcd34d',
  speechColor: '#7dd3fc',
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

let cfg: PdfConfig = { ...DEFAULT_CONFIG }
let pdfjs: any = null
let doc: any = null
let entries: PageEntry[] = []
let observer: IntersectionObserver | null = null
let saveTimer = 0
let hudTimer = 0
let resizeTimer = 0
let dragging = false
let visible = true
let layoutToken = 0
let speaking = false
let paused = false
let speechToken = 0
let sentenceHighlight: { add(range: Range): void; clear(): void } | null = null
let guideWordA: { add(range: Range): void; clear(): void } | null = null
let guideWordB: { add(range: Range): void; clear(): void } | null = null
let guideSentence: { add(range: Range): void; clear(): void } | null = null
let guideTimer = 0
let anchorRange: Range | null = null
let pointerX = -1
let pointerY = -1
let snapRaf = 0
let ttsRate = 1

const docEl = el<HTMLElement>('doc')
const overlay = el<HTMLElement>('overlay')
const band = overlay.querySelector<HTMLElement>('.band') as HTMLElement
const topDim = overlay.querySelector<HTMLElement>('.dim.top') as HTMLElement
const bottomDim = overlay.querySelector<HTMLElement>('.dim.bottom') as HTMLElement
const handle = overlay.querySelector<HTMLElement>('.handle') as HTMLElement
const hud = el<HTMLElement>('hud')
const lockBtn = el<HTMLInputElement>('lock')
const snapInput = el<HTMLInputElement>('snap')
const collapseBtn = el<HTMLButtonElement>('collapse')
const showPanelBtn = el<HTMLButtonElement>('showPanel')
const panelEl = el<HTMLElement>('panel')
const closeBtn = el<HTMLButtonElement>('close')
const fileInput = el<HTMLInputElement>('file')
const emptyPanel = el<HTMLElement>('empty')
const errorPanel = el<HTMLElement>('error')
const errorText = el<HTMLElement>('errorText')
const titleEl = el<HTMLElement>('title')

void boot()

async function boot(): Promise<void> {
  // Follow the popup's manual language choice, not just the browser UI.
  await initI18n()
  applyDocumentLocale()
  localize()
  watchLanguage()
  await loadConfig()
  await loadSpeechPrefs()
  wire()
  applyStyle()
  renderGeometry()
  applyLock()

  const file = new URL(location.href).searchParams.get('file')
  if (file) {
    await openUrl(file)
  } else {
    showEmpty()
  }
}

/* ------------------------------------------------------------------ i18n */

function watchLanguage(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.uiLang) return
    void initI18n().then(() => {
      applyDocumentLocale()
      localize()
      updateSpeechUi()
    })
  })
}

function localize(): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = node.dataset.i18n
    if (!key) continue
    node.textContent = t(key, node.textContent ?? '')
  }
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]'))) {
    const key = node.dataset.i18nAriaLabel
    if (!key) continue
    node.setAttribute('aria-label', t(key, node.getAttribute('aria-label') ?? ''))
  }
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    const key = node.dataset.i18nTitle
    if (!key) continue
    node.setAttribute('title', t(key, node.getAttribute('title') ?? ''))
  }
}

/* ---------------------------------------------------------------- config */

async function loadConfig(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  try {
    const stored = await chrome.storage.local.get(CONFIG_KEY)
    const saved = stored?.[CONFIG_KEY] as Partial<PdfConfig> | undefined
    if (saved) cfg = { ...DEFAULT_CONFIG, ...saved }
  } catch {
    // Defaults are fine.
  }
}

function saveConfig(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void chrome.storage.local.set({ [CONFIG_KEY]: cfg })
  }, 200)
}

/* --------------------------------------------------------------- overlay */

function renderStyle(): void {
  const alpha = cfg.dim
  topDim.style.background = `rgba(3, 7, 18, ${alpha})`
  bottomDim.style.background = `rgba(3, 7, 18, ${alpha})`
  band.style.borderTopColor = rgba(cfg.color, 0.6)
  band.style.borderBottomColor = rgba(cfg.color, 0.22)
  band.style.background = rgba(cfg.color, 0.06)
}

function applyStyle(): void {
  renderStyle()
  el<HTMLInputElement>('height').value = String(Math.round(cfg.height))
  el<HTMLInputElement>('dim').value = String(Math.round(cfg.dim * 100))
  const heightValue = document.getElementById('heightVal')
  if (heightValue) heightValue.textContent = `${Math.round(cfg.height)} px`
  const dimValue = document.getElementById('dimVal')
  if (dimValue) dimValue.textContent = `${Math.round(cfg.dim * 100)}%`
  el<HTMLSelectElement>('guide').value = cfg.guide
  syncGuideColours()
  applyGuideStyle()
  const speechColor = document.getElementById('speechColor') as HTMLInputElement | null
  if (speechColor) speechColor.value = cfg.speechColor
  snapInput.checked = cfg.snap
  applyLock()
}

/** Guide colours live in a generated stylesheet so users can change them. */
function applyGuideStyle(): void {
  let style = document.getElementById('fl-guide-style') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'fl-guide-style'
    document.head.appendChild(style)
  }
  const a = /^#[0-9a-f]{6}$/i.test(cfg.guideColorA) ? cfg.guideColorA : '#7dd3fc'
  const b = /^#[0-9a-f]{6}$/i.test(cfg.guideColorB) ? cfg.guideColorB : '#fcd34d'
  const speech = /^#[0-9a-f]{6}$/i.test(cfg.speechColor) ? cfg.speechColor : '#7dd3fc'
  style.textContent =
    `::highlight(fl-pdf-word-a){background-color:${rgba(a, 0.32)};}` +
    `::highlight(fl-pdf-word-b){background-color:${rgba(b, 0.32)};}` +
    `::highlight(fl-pdf-guide-sentence){background-color:${rgba(b, 0.45)};}` +
    `::highlight(fl-pdf-sentence){background-color:${rgba(speech, 0.35)};}`
}

function syncGuideColours(): void {
  const colours = document.getElementById('guideColors')
  if (colours) colours.hidden = cfg.guide === 'off'
  const a = document.getElementById('guideA') as HTMLInputElement | null
  const b = document.getElementById('guideB') as HTMLInputElement | null
  if (a) a.value = cfg.guideColorA
  if (b) b.value = cfg.guideColorB
}

function rgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const value = Number.parseInt(full, 16)
  if (Number.isNaN(value) || full.length !== 6) return `rgba(125, 211, 252, ${alpha})`
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function renderGeometry(): void {
  if (!visible) return
  const viewport = window.innerHeight
  const height = Math.round(cfg.height)
  const top = Math.max(0, Math.min(viewport, Math.round(cfg.y * viewport - height / 2)))
  const bottom = Math.max(0, viewport - top - height)
  band.style.height = `${height}px`
  band.style.transform = `translateY(${top}px)`
  topDim.style.transform = `scaleY(${top / viewport})`
  bottomDim.style.transform = `scaleY(${bottom / viewport})`
  handle.setAttribute('aria-valuenow', String(Math.round(cfg.y * 100)))
  handle.setAttribute('aria-valuetext', `${Math.round(cfg.y * 100)}%`)
  scheduleGuide()
}

function setY(next: number): void {
  cfg.y = Math.min(0.97, Math.max(0.03, next))
  if (cfg.locked) captureAnchor()
  renderGeometry()
  saveConfig()
}

/** Text-line rect under a viewport point, used by snap mode. */
function textLineAt(x: number, y: number): { top: number; height: number } | null {
  const caret = caretAtPoint(x, y)
  if (caret) {
    try {
      const length = caret.node.nodeValue?.length ?? 0
      if (length > 0) {
        const start = Math.min(caret.offset, length - 1)
        const range = document.createRange()
        range.setStart(caret.node, start)
        range.setEnd(caret.node, Math.min(start + 1, length))
        const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : []
        const rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect()
        if (rect && rect.height > 4) return { top: rect.top, height: rect.height }
      }
    } catch {
      // Fall through to the element rect.
    }
  }
  const element = document.elementFromPoint(x, y)
  const rect = element?.getBoundingClientRect()
  if (!rect || rect.height <= 0 || rect.height > 120) return null
  return { top: rect.top, height: rect.height }
}

function snapToPointer(): void {
  // While reading aloud, the speech follower owns the line: snapping to the
  // pointer here would yank it off the sentence being spoken.
  if (!cfg.snap || cfg.locked || speaking || pointerX < 0) return
  const over = document.elementFromPoint(pointerX, pointerY)
  if (over && panelEl.contains(over)) return
  const line = textLineAt(pointerX, pointerY)
  if (!line) return
  const next = (line.top + line.height / 2) / window.innerHeight
  if (Math.abs(next - cfg.y) < 0.002) return
  setY(next)
}

function setHeight(next: number): void {
  cfg.height = Math.min(180, Math.max(20, next))
  const value = document.getElementById('heightVal')
  if (value) value.textContent = `${Math.round(cfg.height)} px`
  renderGeometry()
  saveConfig()
}

function setDim(next: number): void {
  cfg.dim = Math.min(0.85, Math.max(0, next))
  const value = document.getElementById('dimVal')
  if (value) value.textContent = `${Math.round(cfg.dim * 100)}%`
  renderStyle()
  saveConfig()
}

function applyLock(): void {
  overlay.classList.toggle('locked', cfg.locked)
  lockBtn.checked = cfg.locked
}

/** Collapses the control card to a small floating button. */
function setPanelOpen(open: boolean): void {
  panelEl.hidden = !open
  showPanelBtn.hidden = open
}

function setLocked(next: boolean): void {
  cfg.locked = next
  if (next) captureAnchor()
  else anchorRange = null
  applyLock()
  renderGeometry()
  saveConfig()
  showHud(next ? t('hudLocked', 'Line locked') : t('hudUnlocked', 'Line released'))
}

/** Remembers the character under the band so the line can stick to it. */
function captureAnchor(
  x = Math.round(window.innerWidth / 2),
  y = Math.round(cfg.y * window.innerHeight),
): void {
  anchorRange = null
  const caret = caretAtPoint(x, y)
  if (!caret) return
  try {
    // A collapsed range has no box in Chrome; anchor to one character so the
    // rect tracks the glyphs as the document scrolls.
    const length = caret.node.nodeValue?.length ?? 0
    if (length === 0) return
    const start = Math.min(caret.offset, length - 1)
    const range = document.createRange()
    range.setStart(caret.node, start)
    range.setEnd(caret.node, Math.min(start + 1, length))
    anchorRange = range
  } catch {
    anchorRange = null
  }
}

/** Keeps the band on the anchored text while the PDF scrolls. */
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
    anchorRange = null
    return
  }
  cfg.y = Math.min(0.98, Math.max(0.02, (rect.top + rect.height / 2) / window.innerHeight))
  renderGeometry()
}

function setOverlayVisible(next: boolean): void {
  visible = next
  overlay.hidden = !next
  if (next) renderGeometry()
}

function showHud(text: string): void {
  hud.textContent = text
  hud.hidden = false
  window.clearTimeout(hudTimer)
  hudTimer = window.setTimeout(() => {
    hud.hidden = true
  }, 1600)
}

/* ------------------------------------------------------------- interaction */

function wire(): void {
  handle.addEventListener('pointerdown', (event) => {
    if (cfg.locked) return
    event.preventDefault()
    overlay.classList.remove('following')
    dragging = true
    handle.setPointerCapture(event.pointerId)
  })

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return
    event.preventDefault()
    setY(event.clientY / window.innerHeight)
  })

  const stop = (): void => {
    dragging = false
  }
  handle.addEventListener('pointerup', stop)
  handle.addEventListener('pointercancel', stop)

  handle.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const step = event.shiftKey ? 0.05 : 0.01
    if (event.key === 'ArrowUp') setY(cfg.y - step)
    else if (event.key === 'ArrowDown') setY(cfg.y + step)
    else if (event.key === 'Home') setY(0.03)
    else if (event.key === 'End') setY(0.97)
    else return
    event.preventDefault()
  })

  // Alt + click drops the line on the text line under the pointer; Alt +
  // right-click releases it without moving the line.
  window.addEventListener(
    'mousedown',
    (event) => {
      if (!event.altKey) return
      if (event.button !== 0 && event.button !== 2) return
      if (overlay.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.button === 2) {
        if (cfg.locked) setLocked(false)
        return
      }
      placeAt(event.clientX, event.clientY)
    },
    true,
  )

  window.addEventListener(
    'contextmenu',
    (event) => {
      if (!event.altKey) return
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && speaking) {
      event.preventDefault()
      stopSpeech()
      return
    }
    if (!event.altKey) return
    if (event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      setLocked(!cfg.locked)
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' ? -1 : 1
    if (event.shiftKey) setHeight(cfg.height + direction * 12)
    else setY(cfg.y + direction * 0.01)
  })

  el<HTMLInputElement>('height').addEventListener('input', (event) => {
    setHeight(Number((event.target as HTMLInputElement).value))
  })
  el<HTMLInputElement>('dim').addEventListener('input', (event) => {
    setDim(Number((event.target as HTMLInputElement).value) / 100)
  })

  lockBtn.addEventListener('change', () => setLocked(lockBtn.checked))
  snapInput.addEventListener('change', () => {
    cfg.snap = snapInput.checked
    saveConfig()
    if (cfg.snap) snapToPointer()
  })
  collapseBtn.addEventListener('click', () => setPanelOpen(false))
  showPanelBtn.addEventListener('click', () => setPanelOpen(true))
  closeBtn.addEventListener('click', () => closeDocument())
  el<HTMLSelectElement>('guide').addEventListener('change', (event) => {
    cfg.guide = (event.target as HTMLSelectElement).value as PdfConfig['guide']
    syncGuideColours()
    saveConfig()
    scheduleGuide()
  })
  const guideA = el<HTMLInputElement>('guideA')
  const guideB = el<HTMLInputElement>('guideB')
  guideA.addEventListener('input', () => {
    cfg.guideColorA = guideA.value
    applyGuideStyle()
    saveConfig()
  })
  guideB.addEventListener('input', () => {
    cfg.guideColorB = guideB.value
    applyGuideStyle()
    saveConfig()
  })
  const speechColorInput = el<HTMLInputElement>('speechColor')
  speechColorInput.addEventListener('input', () => {
    cfg.speechColor = speechColorInput.value
    applyGuideStyle()
    saveConfig()
  })
  el<HTMLButtonElement>('speak').addEventListener('click', () => void toggleSpeech())
  el<HTMLButtonElement>('stop').addEventListener('click', () => stopSpeech())
  el<HTMLButtonElement>('open').addEventListener('click', () => fileInput.click())
  el<HTMLButtonElement>('pick').addEventListener('click', () => fileInput.click())
  el<HTMLButtonElement>('retry').addEventListener('click', () => {
    void boot()
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void openFile(file)
  })

  const urlForm = document.getElementById('urlForm') as HTMLFormElement | null
  const urlInput = document.getElementById('url') as HTMLInputElement | null
  urlForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = urlInput?.value.trim()
    if (value) void openFromUser(value)
  })

  window.addEventListener('dragover', (event) => {
    event.preventDefault()
  })
  window.addEventListener('scroll', () => {
    if (cfg.locked) syncAnchor()
    else if (cfg.snap) snapToPointer()
    scheduleGuide()
  }, { passive: true })

  window.addEventListener('pointermove', (event) => {
    pointerX = event.clientX
    pointerY = event.clientY
    if (!cfg.snap || cfg.locked || speaking) return
    if (panelEl.contains(event.target as Node)) return
    if (snapRaf) return
    snapRaf = requestAnimationFrame(() => {
      snapRaf = 0
      snapToPointer()
    })
  }, { passive: true })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (file) void openFile(file)
  })

  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      relayout()
    }, 250)
  })

  // The extension's keyboard commands cannot reach an extension page directly,
  // so the service worker relays them here.
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: { type?: string; action?: string }) => {
      if (message?.type !== 'fl:reader') return
      if (message.action === 'lock') setLocked(!cfg.locked)
      else if (message.action === 'toggle') setOverlayVisible(!visible)
    })
  }
}

function placeAt(x: number, y: number): void {
  const line = textLineAt(x, y)
  // Only the position changes; the height stays whatever the user set.
  cfg.y = line
    ? Math.min(0.97, Math.max(0.03, (line.top + line.height / 2) / window.innerHeight))
    : Math.min(0.97, Math.max(0.03, y / window.innerHeight))
  cfg.locked = true
  captureAnchor(x, y)
  renderGeometry()
  saveConfig()
  showHud(t('hudLocked', 'Line locked'))
}

/* ------------------------------------------------------------------- pdf */

async function loadPdfjs(): Promise<any> {
  if (pdfjs) return pdfjs
  const url = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href
  const module = await import(/* @vite-ignore */ url)
  module.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href
  pdfjs = module
  return pdfjs
}

async function openFromUser(url: string): Promise<void> {
  let origin: string
  try {
    origin = `${new URL(url).origin}/*`
  } catch {
    showError(t('pdfErrorTitle', 'This PDF could not be opened'))
    return
  }

  if (typeof chrome !== 'undefined' && chrome.permissions?.request) {
    try {
      // Called synchronously from the submit handler so the user gesture is
      // still valid when Chrome shows the permission prompt.
      const granted = await chrome.permissions.request({ origins: [origin] })
      if (!granted) {
        showError(t('pdfNeedPermission', 'FocusLine needs access to this site to read the PDF.'))
        return
      }
    } catch {
      // Some contexts refuse the request; openUrl will report the failure.
    }
  }

  await openUrl(url)
}

async function openUrl(url: string): Promise<void> {  if (!/^https?:\/\//i.test(url)) {
    showError(t('pdfNeedPermission', 'Only http(s) PDF links can be opened here.'))
    return
  }

  const origin = `${new URL(url).origin}/*`
  if (typeof chrome !== 'undefined' && chrome.permissions?.contains) {
    const granted = await chrome.permissions.contains({ origins: [origin] })
    if (!granted) {
      showError(t('pdfNeedPermission', 'FocusLine needs access to this site to read the PDF. Open the link from the FocusLine popup so it can ask for permission.'))
      return
    }
  }

  try {
    const lib = await loadPdfjs()
    doc = await lib.getDocument({
      url,
      cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    }).promise
    titleEl.textContent = decodeURIComponent(url.split('/').pop() ?? 'PDF')
    await buildPages()
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  }
}

async function openFile(file: File): Promise<void> {
  if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showError(t('pdfErrorTitle', 'This PDF could not be opened'))
    return
  }
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    const lib = await loadPdfjs()
    doc = await lib.getDocument({
      data,
      cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    }).promise
    titleEl.textContent = file.name
    await buildPages()
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  }
}

async function buildPages(): Promise<void> {
  if (!doc) return
  stopSpeech()
  setPanel(null)
  closeBtn.hidden = false
  observer?.disconnect()
  entries = []
  docEl.replaceChildren()

  const first = await doc.getPage(1)
  const base = first.getViewport({ scale: 1 })
  const width = Math.max(320, docEl.clientWidth - 48)
  const estimated = Math.round((width * base.height) / base.width)

  for (let number = 1; number <= doc.numPages; number += 1) {
    const wrap = document.createElement('div')
    wrap.className = 'page'
    wrap.style.width = `${width}px`
    wrap.style.height = `${estimated}px`

    const canvas = document.createElement('canvas')
    const text = document.createElement('div')
    text.className = 'textLayer'
    wrap.append(canvas, text)
    docEl.appendChild(wrap)

    const entry: PageEntry = { number, wrap, canvas, text, state: 'idle', rendering: null }
    entries.push(entry)
  }

  observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue
        const entry = entries.find((item) => item.wrap === record.target)
        if (entry && entry.state === 'idle') void ensureRendered(entry)
      }
    },
    { rootMargin: '800px 0px' },
  )
  for (const entry of entries) observer.observe(entry.wrap)

  await ensureRendered(entries[0])
}

async function renderEntry(entry: PageEntry, token: number): Promise<void> {
  if (!doc || entry.state === 'busy') return
  entry.state = 'busy'
  try {
    const page = await doc.getPage(entry.number)
    if (token !== layoutToken) {
      entry.state = 'idle'
      return
    }

    const unscaled = page.getViewport({ scale: 1 })
    const width = Math.max(320, docEl.clientWidth - 48)
    const scale = width / unscaled.width
    const viewport = page.getViewport({ scale })
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    entry.wrap.style.width = `${viewport.width}px`
    entry.wrap.style.height = `${viewport.height}px`
    entry.canvas.width = Math.floor(viewport.width * dpr)
    entry.canvas.height = Math.floor(viewport.height * dpr)
    entry.canvas.style.width = `${viewport.width}px`
    entry.canvas.style.height = `${viewport.height}px`

    const context = entry.canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.setTransform(1, 0, 0, 1, 0, 0)

    await page.render({
      canvasContext: context,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise

    entry.text.replaceChildren()
    pdfjs.setLayerDimensions(entry.text, viewport)
    entry.text.style.setProperty('--scale-factor', String(scale))
    const layer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: entry.text,
      viewport,
    })
    await layer.render()
    entry.state = 'done'
    scheduleGuide()
  } catch (error) {
    entry.state = 'idle'
    console.warn('[FocusLine] page render failed', error)
  }
}

function relayout(): void {
  if (!doc) return
  layoutToken += 1
  const width = Math.max(320, docEl.clientWidth - 48)
  for (const entry of entries) {
    entry.state = 'idle'
    entry.wrap.style.width = `${width}px`
  }
  for (const entry of entries) {
    const rect = entry.wrap.getBoundingClientRect()
    if (rect.bottom > -400 && rect.top < window.innerHeight + 400) void ensureRendered(entry)
  }
}

/* ---------------------------------------------------------------- panels */

function showEmpty(): void {
  setPanel('empty')
}

function showError(message: string): void {
  errorText.textContent = message
  setPanel('error')
  // A failed open should still leave a way back to the file picker.
  closeBtn.hidden = false
}

/** Drops the document and returns to the file picker. */
function closeDocument(): void {
  stopSpeech()
  layoutToken += 1
  observer?.disconnect()
  observer = null
  doc = null
  entries = []
  docEl.replaceChildren()
  clearGuide()
  anchorRange = null
  titleEl.textContent = 'Reader'
  closeBtn.hidden = true
  showEmpty()

  // Drop ?file=… so a refresh does not reopen the document that was closed.
  const url = new URL(location.href)
  url.searchParams.delete('file')
  history.replaceState(null, '', `${url.pathname}${url.search}`)
}

function setPanel(next: 'empty' | 'error' | null): void {
  emptyPanel.hidden = next !== 'empty'
  errorPanel.hidden = next !== 'error'
  overlay.hidden = next !== null
}

/* ------------------------------------------------------------------ speech */

async function loadSpeechPrefs(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('ttsRate')
    const rate = Number(stored?.ttsRate)
    if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) ttsRate = rate
  } catch {
    // Keep the default rate.
  }
}

async function toggleSpeech(): Promise<void> {
  if (speaking) {
    if (paused) resumeSpeech()
    else pauseSpeech()
    return
  }
  await startSpeech()
}

function pauseSpeech(): void {
  if (!speaking || paused) return
  paused = true
  try {
    window.speechSynthesis.pause()
  } catch {
    // Ignore speech API errors.
  }
  updateSpeechUi()
  showHud(t('hudPaused', 'Reading paused'))
}

function resumeSpeech(): void {
  if (!speaking || !paused) return
  paused = false
  try {
    window.speechSynthesis.resume()
  } catch {
    // Ignore speech API errors.
  }
  updateSpeechUi()
  showHud(t('hudSpeaking', 'Reading aloud · Esc to stop'))
}

function stopSpeech(): void {
  const wasSpeaking = speaking
  speechToken += 1
  speaking = false
  paused = false
  overlay.classList.remove('following')
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Ignore speech API errors.
  }
  clearSentenceHighlight()
  updateSpeechUi()
  if (wasSpeaking) {
    // Persist wherever the narration left the line.
    saveConfig()
    hud.hidden = true
  }
}

function updateSpeechUi(): void {
  const button = document.getElementById('speak') as HTMLButtonElement | null
  const label = button?.querySelector('span')
  if (label) {
    label.textContent = speaking
      ? t(paused ? 'readResume' : 'readPause', paused ? 'Resume' : 'Pause')
      : t('readAloud', 'Read aloud')
  }
  button?.setAttribute('aria-pressed', String(speaking))
  const stop = document.getElementById('stop') as HTMLButtonElement | null
  if (stop) stop.hidden = !speaking
}

async function startSpeech(): Promise<void> {
  if (!doc || entries.length === 0) return
  const token = (speechToken += 1)
  speaking = true
  paused = false
  overlay.classList.add('following')
  updateSpeechUi()
  showHud(t('hudSpeaking', 'Reading aloud · Esc to stop'))

  await voicesReady()
  if (token !== speechToken) return

  const start = pageUnderLine()
  let spoke = false

  for (let index = start; index < entries.length; index += 1) {
    if (token !== speechToken) return
    const entry = entries[index]
    await ensureRendered(entry)
    if (token !== speechToken) return

    const { text, segments } = collectPageText(entry.text)
    if (!text.trim()) continue

    const lang = detectLang(text) ?? normalizeLocale(document.documentElement.lang || 'en')
    const voice = pickVoice(lang)
    if (!voice) {
      showHud(t('readNoVoice', 'No local voice available'))
      break
    }

    const sentences = splitSentences(text, lang)
    if (sentences.length === 0) continue
    const from = index === start ? sentenceAtLine(sentences, segments) : 0

    for (let i = from; i < sentences.length; i += 1) {
      if (token !== speechToken) return
      await speakSentence(sentences[i], segments, voice, token)
      spoke = true
    }

    const next = entries[index + 1]
    if (next && token === speechToken) next.wrap.scrollIntoView({ block: 'start' })
  }

  if (token !== speechToken) return
  speaking = false
  overlay.classList.remove('following')
  updateSpeechUi()
  saveConfig()
  if (!spoke) showHud(t('readNoText', 'No readable text found'))
}

function speakSentence(
  sentence: Sentence,
  segments: TextSegment[],
  voice: SpeechSynthesisVoice,
  token: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (token !== speechToken) {
      resolve()
      return
    }
    const range = rangeIn(segments, sentence.start, sentence.end)
    if (range) {
      highlightSentence(range)
      followSpeechRange(range)
    }

    const utter = new SpeechSynthesisUtterance(sentence.text)
    utter.voice = voice
    utter.lang = voice.lang
    utter.rate = ttsRate
    // Track the word being spoken, so the line stays on the right line of a
    // sentence that wraps. Voices that never emit boundaries fall back to the
    // sentence's first line (see followSpeechRange).
    utter.onboundary = (event) => {
      if (token !== speechToken || !speaking || paused) return
      if (event.name && event.name !== 'word') return
      const charLength = (event as SpeechSynthesisEvent & { charLength?: number }).charLength
      const start = sentence.start + event.charIndex
      let end = start + (charLength && charLength > 0 ? charLength : 1)
      if (!charLength) {
        const rest = sentence.text.slice(event.charIndex).match(/^\S+/)
        if (rest) end = start + rest[0].length
      }
      const wordRange = rangeIn(segments, start, end)
      if (wordRange) followSpeechRange(wordRange)
    }
    const done = (): void => {
      clearSentenceHighlight()
      resolve()
    }
    utter.onend = done
    utter.onerror = done
      try {
      window.speechSynthesis.speak(utter)
    } catch {
      done()
    }
  })
}

function sentenceAtLine(sentences: Sentence[], segments: TextSegment[]): number {
  const caret = caretAtPoint(
    Math.round(window.innerWidth / 2),
    Math.round(cfg.y * window.innerHeight),
  )
  if (!caret) return 0
  const segment = segments.find((item) => item.node === caret.node)
  if (!segment) return 0
  const index = segment.start + caret.offset
  const found = sentences.findIndex((sentence) => index >= sentence.start && index < sentence.end)
  return found >= 0 ? found : 0
}

function pageUnderLine(): number {
  const y = cfg.y * window.innerHeight
  for (let index = 0; index < entries.length; index += 1) {
    const rect = entries[index].wrap.getBoundingClientRect()
    if (y >= rect.top && y <= rect.bottom) return index
  }
  return 0
}

/** The text layer is already in reading order, so a tree walk is enough. */
function collectPageText(root: HTMLElement): { text: string; segments: TextSegment[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  const segments: TextSegment[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.nodeValue ?? ''
    if (!value.trim()) continue
    const start = text.length
    text += value
    segments.push({ node, start, end: start + value.length })
    text += ' '
  }
  return { text, segments }
}

function rangeIn(segments: TextSegment[], start: number, end: number): Range | null {
  const first = segments.find((segment) => start >= segment.start && start < segment.end)
  const last = segments.find((segment) => Math.max(start, end - 1) >= segment.start && Math.max(start, end - 1) < segment.end)
  if (!first || !last) return null
  const range = document.createRange()
  range.setStart(first.node, start - first.start)
  range.setEnd(last.node, Math.max(start, end - 1) - last.start + 1)
  return range
}

function caretAtPoint(x: number, y: number): { node: Text; offset: number } | null {
  const withCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof withCaret.caretRangeFromPoint !== 'function') return null
  try {
    const range = withCaret.caretRangeFromPoint(x, y)
    const node = range?.startContainer
    if (node && node.nodeType === Node.TEXT_NODE) {
      return { node: node as Text, offset: range?.startOffset ?? 0 }
    }
  } catch {
    // Ignore.
  }
  return null
}

function ensureRendered(entry: PageEntry): Promise<void> {
  if (entry.state === 'done') return Promise.resolve()
  if (entry.rendering) return entry.rendering
  entry.rendering = renderEntry(entry, layoutToken).finally(() => {
    entry.rendering = null
  })
  return entry.rendering
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const base = lang.toLowerCase().split('-')[0]
  let voices: SpeechSynthesisVoice[] = []
  try {
    voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService)
  } catch {
    return null
  }
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(base)) ??
    null
  )
}

function voicesReady(): Promise<void> {
  try {
    if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve()
  } catch {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const done = (): void => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve()
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    window.setTimeout(done, 1500)
  })
}

function highlightSentence(range: Range): void {
  const ctor = (window as unknown as { Highlight?: new () => { add(range: Range): void; clear(): void } }).Highlight
  const registry = (CSS as unknown as { highlights?: Map<string, { add(range: Range): void; clear(): void }> }).highlights
  if (!ctor || !registry) return
  if (!sentenceHighlight) {
    sentenceHighlight = new ctor()
    registry.set('fl-pdf-sentence', sentenceHighlight)
  }
  sentenceHighlight.clear()
  sentenceHighlight.add(range)
}

function clearSentenceHighlight(): void {
  sentenceHighlight?.clear()
}

/**
 * Keeps the line on the sentence being spoken. Reading aloud is an explicit
 * "follow the text" action, so it takes priority over the lock: the line moves
 * with the voice and the lock anchor is refreshed to the spoken line.
 */
function followSpeechRange(range: Range): void {
  overlay.classList.add('following')
  // Use the first line box, not the union of a wrapped sentence: the voice
  // starts at the first line, and the union's centre can fall on a blank gap.
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : []
  let rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect()
  if (!rect || rect.height <= 0) return

  const viewport = window.innerHeight
  const margin = 64
  if (rect.top < margin || rect.bottom > viewport - margin) {
    window.scrollBy({ top: rect.top - viewport * 0.35, behavior: 'instant' as ScrollBehavior })
    const again = typeof range.getClientRects === 'function' ? range.getClientRects() : []
    rect = again && again.length > 0 ? again[0] : range.getBoundingClientRect()
  }

  // Stay put while the band already covers the spoken line.
  const lineTop = cfg.y * viewport - cfg.height / 2
  if (rect.top >= lineTop - 6 && rect.bottom <= lineTop + cfg.height + 6) return

  const center = (rect.top + rect.height / 2) / viewport
  const next = Math.min(0.94, Math.max(0.06, center))
  if (Math.abs(next - cfg.y) < 0.004) return
  cfg.y = next
  if (cfg.locked) captureAnchor()
  renderGeometry()
}

/* ------------------------------------------------------------------- guide */

function scheduleGuide(): void {
  if (cfg.guide === 'off') {
    clearGuide()
    return
  }
  if (guideTimer) return
  guideTimer = window.setTimeout(() => {
    guideTimer = 0
    refreshGuide()
  }, 90)
}

function ensureGuide(): boolean {
  const ctor = (window as unknown as { Highlight?: new () => { add(range: Range): void; clear(): void } }).Highlight
  const registry = (CSS as unknown as { highlights?: Map<string, { add(range: Range): void; clear(): void }> })
    .highlights
  if (!ctor || !registry) return false
  if (!guideWordA) {
    guideWordA = new ctor()
    registry.set('fl-pdf-word-a', guideWordA)
  }
  if (!guideWordB) {
    guideWordB = new ctor()
    registry.set('fl-pdf-word-b', guideWordB)
  }
  if (!guideSentence) {
    guideSentence = new ctor()
    registry.set('fl-pdf-guide-sentence', guideSentence)
  }
  return true
}

function clearGuide(): void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  if (registry) {
    registry.delete('fl-pdf-word-a')
    registry.delete('fl-pdf-word-b')
    registry.delete('fl-pdf-guide-sentence')
  }
  guideWordA = null
  guideWordB = null
  guideSentence = null
  window.clearTimeout(guideTimer)
  guideTimer = 0
}

function refreshGuide(): void {
  if (cfg.guide === 'off' || entries.length === 0) return
  const entry = entries[pageUnderLine()]
  if (!entry) return
  if (entry.state !== 'done') {
    void ensureRendered(entry).then(() => {
      // Only retry when the page actually rendered; a broken page must not
      // spin the 90ms timer forever.
      if (entry.state === 'done') scheduleGuide()
    })
    return
  }
  if (!ensureGuide()) return

  guideWordA?.clear()
  guideWordB?.clear()
  guideSentence?.clear()

  const { text, segments } = collectPageText(entry.text)
  if (!text.trim()) return

  const lang = detectLang(text) ?? normalizeLocale(document.documentElement.lang || 'en')
  const sentences = splitSentences(text, lang)
  const under = sentencesUnderBand(sentences, segments)
  if (under.length === 0) return

  if (cfg.guide === 'sentence') {
    // Alternate the two guide colours sentence by sentence, mirroring word mode.
    under.forEach((sentence, index) => {
      const range = rangeIn(segments, sentence.start, sentence.end)
      if (!range) return
      if (index % 2 === 0) guideWordA?.add(range)
      else guideWordB?.add(range)
    })
    return
  }

  for (const sentence of under) {
    const words = wordsIn(sentence, segments, lang)
    words.forEach((range, index) => {
      if (index % 2 === 0) guideWordA?.add(range)
      else guideWordB?.add(range)
    })
  }
}

/**
 * Returns every sentence the band covers. A single centre probe misses the
 * right column of a two-column PDF (the centre often lands in the gutter), so
 * sample across the width and at the top/middle/bottom of the band.
 */
function sentencesUnderBand(sentences: Sentence[], segments: TextSegment[]): Sentence[] {
  const viewport = window.innerHeight
  const half = cfg.height / 2
  const centre = cfg.y * viewport
  const xs = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88].map((fraction) =>
    Math.round(window.innerWidth * fraction),
  )
  const ys = [centre - half + 8, centre, centre + half - 8]

  const seen = new Set<number>()
  const out: Sentence[] = []
  for (const y of ys) {
    for (const x of xs) {
      const caret = caretAtPoint(x, y)
      if (!caret) continue
      const segment = segments.find((item) => item.node === caret.node)
      if (!segment) continue
      const offset = segment.start + caret.offset
      const sentence = sentences.find((item) => offset >= item.start && offset < item.end)
      if (!sentence || seen.has(sentence.start)) continue
      seen.add(sentence.start)
      out.push(sentence)
    }
  }
  return out
}

function wordsIn(sentence: Sentence, segments: TextSegment[], lang: string): Range[] {
  const out: Range[] = []
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity?: string },
      ) => {
        segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>
      }
    }
  ).Segmenter

  if (Segmenter) {
    try {
      const segmenter = new Segmenter(normalizeLocale(lang), { granularity: 'word' })
      for (const part of segmenter.segment(sentence.text)) {
        if (!part.isWordLike) continue
        const start = sentence.start + part.index
        const range = rangeIn(segments, start, start + part.segment.length)
        if (range) out.push(range)
        if (out.length >= 400) break
      }
      return out
    } catch {
      // Fall through to the whitespace split.
    }
  }

  const pattern = /\S+/g
  let match = pattern.exec(sentence.text)
  while (match && out.length < 400) {
    const start = sentence.start + match.index
    const range = rangeIn(segments, start, start + match[0].length)
    if (range) out.push(range)
    match = pattern.exec(sentence.text)
  }
  return out
}
