import {
  applyDocumentLocale,
  currentLocale,
  initI18n,
  isSupportedLocale,
  LANGUAGES,
  localizeDom,
  t,
} from '../shared/i18n.js'
import { getLocal, injectContent, queryActiveTab, requestOrigin, sendToTab, setLocal } from '../shared/chrome.js'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS_KEY,
  comboFromEvent,
  formatCombo,
  isUsableCombo,
  normalizeShortcuts,
  type ShortcutMap,
} from '../shared/shortcuts.js'
import { AUTO_HOSTS_KEY, DEFAULT_TEXT, LINE_COLORS, type GuideMode, type Msg, type SiteConfig, type StateResponse, type TextConfig } from '../shared/types.js'

const COLOR_LABEL_KEYS = ['colourSky', 'colourAmber', 'colourViolet', 'colourGreen', 'colourRose'] as const
const COLOR_LABEL_BY_HEX: Record<string, string> = {
  '#7dd3fc': 'colourSky',
  '#fbbf24': 'colourAmber',
  '#a78bfa': 'colourViolet',
  '#34d399': 'colourGreen',
  '#fb7185': 'colourRose',
  '#f97316': 'colourOrange',
}
const HIGHLIGHT_COLORS = ['#fbbf24', '#34d399', '#38bdf8', '#fb7185', '#a78bfa', '#f97316'] as const
const TTS_RATE_KEY = 'ttsRate'
const TTS_HIGHLIGHT_KEY = 'ttsHighlight'
const TTS_LANG_KEY = 'ttsLang'

let tabId = -1
let pageUrl = ''
let host = ''
let state: StateResponse | null = null
let autoHosts: string[] = []
let patchTimer = 0
let patchSeq = 0
let pendingPatch: Partial<SiteConfig> = {}
let highlightColor = '#fbbf24'
let readingLang = 'auto'
let shortcuts: ShortcutMap = { ...DEFAULT_SHORTCUTS }
let recording: 'up' | 'down' | null = null

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

void bootstrap()

async function bootstrap(): Promise<void> {
  const choice = await initI18n()
  buildSwatches()
  buildHighlightSwatches()
  buildReadingLangSelect()
  buildShortcutRows()
  buildLanguageSelect(choice)
  bindReaderLinks()
  window.addEventListener('pagehide', flushPendingPatch)
  applyDocumentLocale()
  localizeDom()
  document.title = t('popupTitle', 'FocusLine')
  const versionEl = document.getElementById('version')
  if (versionEl && chrome.runtime?.getManifest) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`
  }
  if (!isSupportedLocale(currentLocale())) el('langNotice').hidden = false
  await init()
}

async function init(): Promise<void> {
  const tab = await queryActiveTab()
  if (!tab?.id) return unsupported('noActiveTab')

  tabId = tab.id
  pageUrl = tab.url ?? ''
  if (!/^https?:\/\//i.test(pageUrl)) {
    return unsupported('unsupportedPage')
  }

  if (isPdfUrl(pageUrl)) {
    showPdfPanel()
    return
  }

  host = new URL(pageUrl).hostname
  el('site').textContent = host

  try {
    await ensureInjected()
    state = await sendToTab<StateResponse>(tabId, { type: 'fl:get' } as Msg)
  } catch {
    return unsupported('reloadHint')
  }

  const storedHosts = await getLocal<string[]>(AUTO_HOSTS_KEY)
  autoHosts = storedHosts[AUTO_HOSTS_KEY] ?? []

  const storedRate = await getLocal<number>(TTS_RATE_KEY)
  const rate = Math.min(2, Math.max(0.5, storedRate[TTS_RATE_KEY] ?? 1))
  el<HTMLInputElement>('rate').value = String(Math.round(rate * 100))
  el('rateVal').textContent = `${rate.toFixed(1)}×`

  const storedHighlight = await getLocal<string>(TTS_HIGHLIGHT_KEY)
  const savedHighlight = storedHighlight[TTS_HIGHLIGHT_KEY]
  if (savedHighlight && /^#[0-9a-f]{6}$/i.test(savedHighlight)) highlightColor = savedHighlight
  if (state.speech?.color) highlightColor = state.speech.color

  const storedLang = await getLocal<string>(TTS_LANG_KEY)
  readingLang = storedLang[TTS_LANG_KEY] || 'auto'
  el<HTMLSelectElement>('ttsLang').value = readingLang

  const storedShortcuts = await getLocal<ShortcutMap>(SHORTCUTS_KEY)
  shortcuts = normalizeShortcuts(storedShortcuts[SHORTCUTS_KEY])

  el('controls').hidden = false
  bind()
  paint()
  readZoom()
}

function readZoom(): void {
  if (tabId < 0) return
  chrome.tabs.getZoom(tabId, (zoom) => {
    if (chrome.runtime.lastError || !state) return
    state.config.text = { ...(state.config.text ?? DEFAULT_TEXT), zoom }
    paint()
  })
}

async function ensureInjected(): Promise<void> {
  try {
    await sendToTab(tabId, { type: 'fl:get' })
  } catch {
    await injectContent(tabId)
  }
}

function unsupported(key: string): void {
  el('unsupported').hidden = false
  el('unsupportedText').textContent = t(key, el('unsupportedText').textContent ?? '')
  el('controls').hidden = true
  el('toggle').setAttribute('disabled', 'true')
}

const isPdfUrl = (url: string): boolean => /\.pdf([?#]|$)/i.test(url)

function showPdfPanel(): void {
  let name = 'PDF'
  try {
    name = decodeURIComponent(new URL(pageUrl).pathname.split('/').pop() || 'PDF')
  } catch {
    // Keep the fallback name.
  }
  el('site').textContent = name
  el('unsupported').hidden = true
  el('controls').hidden = true
  el('pdfPanel').hidden = false
  el<HTMLButtonElement>('toggle').setAttribute('disabled', 'true')
}

function bindReaderLinks(): void {
  el<HTMLButtonElement>('openPdf').addEventListener('click', () => void openPdf())
  el<HTMLButtonElement>('readerLink').addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') })
    window.close()
  })
}

async function openPdf(): Promise<void> {
  try {
    const origin = `${new URL(pageUrl).origin}/*`
    const granted = await requestOrigin(origin)
    if (!granted) return
    void chrome.tabs.create({
      url: chrome.runtime.getURL(`reader.html?file=${encodeURIComponent(pageUrl)}`),
    })
    window.close()
  } catch {
    // The popup is transient; nothing to report.
  }
}

function bind(): void {
  el<HTMLButtonElement>('toggle').addEventListener('click', () => void toggle())
  el<HTMLInputElement>('height').addEventListener('input', onHeightInput)
  el<HTMLInputElement>('dim').addEventListener('input', onDimInput)
  el<HTMLInputElement>('follow').addEventListener('change', (event) =>
    queuePatch({ follow: (event.target as HTMLInputElement).checked }),
  )
  el<HTMLInputElement>('snap').addEventListener('change', (event) => {
    const snap = (event.target as HTMLInputElement).checked
    // Snapping is a smarter follow; keep the two switches coherent.
    queuePatch(snap ? { snap, follow: true } : { snap })
  })
  el<HTMLInputElement>('lock').addEventListener('change', (event) =>
    queuePatch({ locked: (event.target as HTMLInputElement).checked }),
  )
  el<HTMLInputElement>('calm').addEventListener('change', (event) =>
    queuePatch({ calm: (event.target as HTMLInputElement).checked }),
  )
  el<HTMLSelectElement>('guide').addEventListener('change', (event) => {
    queuePatch({ guide: (event.target as HTMLSelectElement).value as GuideMode })
  })
  el<HTMLInputElement>('guideA').addEventListener('input', (event) => {
    queuePatch({ guideColorA: (event.target as HTMLInputElement).value })
  })
  el<HTMLInputElement>('guideB').addEventListener('input', (event) => {
    queuePatch({ guideColorB: (event.target as HTMLInputElement).value })
  })
  el<HTMLButtonElement>('pick').addEventListener('click', () => void startPick())
  el<HTMLButtonElement>('clearHidden').addEventListener('click', () => queuePatch({ hidden: [] }))
  el<HTMLButtonElement>('speak').addEventListener('click', onSpeakClick)
  el<HTMLButtonElement>('speakStop').addEventListener('click', () => void speakAction('stop'))
  el<HTMLInputElement>('rate').addEventListener('input', () => {
    el('rateVal').textContent = `${currentRate().toFixed(1)}×`
  })
  el<HTMLInputElement>('rate').addEventListener('change', onRateChange)
  el<HTMLSelectElement>('ttsLang').addEventListener('change', onReadingLangChange)
  el<HTMLButtonElement>('textPreset').addEventListener('click', applyReadingPreset)
  el<HTMLInputElement>('auto').addEventListener('change', (event) =>
    void onAutoChange((event.target as HTMLInputElement).checked),
  )

  el<HTMLInputElement>('zoom').addEventListener('input', onZoomInput)
  el<HTMLInputElement>('lineHeight').addEventListener('input', onLineHeightInput)
  el<HTMLInputElement>('spacing').addEventListener('input', onSpacingInput)
  el<HTMLButtonElement>('textReset').addEventListener('click', resetText)
  for (const dot of Array.from(document.querySelectorAll<HTMLButtonElement>('.themeDot'))) {
    dot.addEventListener('click', () => {
      const theme = dot.dataset.theme as TextConfig['theme'] | undefined
      if (theme) patchText({ theme })
    })
  }

  for (const swatch of Array.from(document.querySelectorAll<HTMLButtonElement>('#lineSwatches .swatch'))) {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color
      if (color) queuePatch({ color })
    })
  }

  for (const swatch of Array.from(document.querySelectorAll<HTMLButtonElement>('.ttsSwatch'))) {
    swatch.addEventListener('click', () => selectHighlight(swatch.dataset.color))
  }

  const custom = document.getElementById('ttsCustom') as HTMLInputElement | null
  custom?.addEventListener('input', () => selectHighlight(custom.value))
}

async function toggle(): Promise<void> {
  try {
    state = await sendToTab<StateResponse>(tabId, { type: 'fl:toggle' } as Msg)
    paint()
  } catch {
    // The tab probably navigated; the next popup open will recover.
  }
}

function onHeightInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  el('heightVal').textContent = `${value} px`
  queuePatch({ height: value })
}

function onDimInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  el('dimVal').textContent = `${Math.round(value)}%`
  queuePatch({ dim: value / 100 })
}

function queuePatch(patch: Partial<SiteConfig>): void {
  // Merge with anything still waiting: two quick changes (height, then lock)
  // must both reach the page, not just the last one.
  pendingPatch = { ...pendingPatch, ...patch }
  window.clearTimeout(patchTimer)
  patchTimer = window.setTimeout(() => {
    const merged = pendingPatch
    pendingPatch = {}
    void applyPatch(merged)
  }, 80)
}

/** Send whatever is still queued when the popup closes. */
function flushPendingPatch(): void {
  if (Object.keys(pendingPatch).length === 0) return
  const merged = pendingPatch
  pendingPatch = {}
  window.clearTimeout(patchTimer)
  void applyPatch(merged)
}

async function applyPatch(patch: Partial<SiteConfig>): Promise<void> {
  const seq = ++patchSeq
  try {
    const next = await sendToTab<StateResponse>(tabId, { type: 'fl:patch', patch } as Msg)
    // Ignore a slower, older response: it must not repaint the controls with
    // values that a newer patch already replaced.
    if (seq !== patchSeq) return
    state = next
    paint()
  } catch {
    // Ignore transient messaging failures.
  }
}

async function startPick(): Promise<void> {
  try {
    if (!state?.active) {
      state = await sendToTab<StateResponse>(tabId, {
        type: 'fl:patch',
        patch: { active: true },
      } as Msg)
    }
    await sendToTab(tabId, { type: 'fl:pick' } as Msg)
    window.close()
  } catch {
    // Ignore.
  }
}

function currentRate(): number {
  return Number(el<HTMLInputElement>('rate').value) / 100
}

async function speakAction(action: 'start' | 'pause' | 'resume' | 'stop' | 'rate'): Promise<void> {
  try {
    state = await sendToTab<StateResponse>(tabId, {
      type: 'fl:speak',
      action,
      rate: currentRate(),
      color: highlightColor,
      lang: readingLang,
    } as Msg)
    paint()
  } catch {
    // Ignore.
  }
}

function onSpeakClick(): void {
  const speech = state?.speech
  if (!speech?.speaking) void speakAction('start')
  else if (speech.paused) void speakAction('resume')
  else void speakAction('pause')
}

function onRateChange(): void {
  const rate = currentRate()
  void setLocal({ [TTS_RATE_KEY]: rate })
  if (state?.speech.speaking) void speakAction('rate')
}

function selectHighlight(color: string | undefined): void {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return
  highlightColor = color
  void setLocal({ [TTS_HIGHLIGHT_KEY]: color })
  if (state?.speech.speaking) void sendSpeechColor(color)
  paint()
}

async function sendSpeechColor(color: string): Promise<void> {
  try {
    state = await sendToTab<StateResponse>(tabId, {
      type: 'fl:speak',
      action: 'color',
      color,
    } as Msg)
    paint()
  } catch {
    // Ignore.
  }
}

function onReadingLangChange(): void {
  readingLang = el<HTMLSelectElement>('ttsLang').value || 'auto'
  void setLocal({ [TTS_LANG_KEY]: readingLang })
  if (state?.speech.speaking) void sendSpeechLang(readingLang)
}

async function sendSpeechLang(lang: string): Promise<void> {
  try {
    state = await sendToTab<StateResponse>(tabId, {
      type: 'fl:speak',
      action: 'lang',
      lang,
    } as Msg)
    paint()
  } catch {
    // Ignore.
  }
}

function applyReadingPreset(): void {
  applyZoom(1)
  patchText({
    zoom: 1,
    lineHeight: 1.7,
    letterSpacing: 0.05,
    wordSpacing: 0.16,
    fontSize: 19,
    measure: true,
    alignLeft: true,
  })
}

async function onAutoChange(checked: boolean): Promise<void> {
  const input = el<HTMLInputElement>('auto')
  const origin = `${new URL(pageUrl).origin}/*`

  if (checked) {
    const granted = await requestOrigin(origin)
    if (!granted) {
      input.checked = false
      return
    }
    autoHosts = [...new Set([...autoHosts, host])]
    await setLocal({ [AUTO_HOSTS_KEY]: autoHosts })
    if (state && !state.active) await applyPatch({ active: true })
  } else {
    autoHosts = autoHosts.filter((item) => item !== host)
    await setLocal({ [AUTO_HOSTS_KEY]: autoHosts })
    chrome.permissions.remove({ origins: [origin] }, () => {
      void chrome.runtime.lastError
    })
  }
  paint()
}

function textConfig(): TextConfig {
  return state?.config.text ?? { ...DEFAULT_TEXT }
}

function patchText(patch: Partial<TextConfig>): void {
  queuePatch({ text: { ...textConfig(), ...patch } })
}

function applyZoom(zoom: number): void {
  if (tabId < 0) return
  chrome.tabs.setZoom(tabId, zoom, () => {
    void chrome.runtime.lastError
  })
}

function onZoomInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  el('zoomVal').textContent = `${value}%`
  applyZoom(value / 100)
  patchText({ zoom: value / 100 })
}

function onLineHeightInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  const lineHeight = value === 0 ? 0 : 1 + value / 10
  el('lineVal').textContent = value === 0 ? '—' : lineHeight.toFixed(1)
  patchText({ lineHeight })
}

function onSpacingInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  el('spacingVal').textContent = `${(value / 100).toFixed(2)}em`
  patchText({ letterSpacing: value / 100 })
}

function resetText(): void {
  applyZoom(1)
  queuePatch({ text: { ...DEFAULT_TEXT } })
}

function paint(): void {
  if (!state) return
  const cfg = state.config
  const dimPercent = Math.round(cfg.dim * 100)

  const toggleEl = el<HTMLButtonElement>('toggle')
  toggleEl.classList.toggle('on', state.active)
  toggleEl.setAttribute('aria-checked', String(state.active))

  el<HTMLInputElement>('height').value = String(Math.round(cfg.height))
  el('heightVal').textContent = `${Math.round(cfg.height)} px`
  el<HTMLInputElement>('dim').value = String(dimPercent)
  el('dimVal').textContent = `${dimPercent}%`
  el<HTMLInputElement>('follow').checked = cfg.follow
  el<HTMLInputElement>('snap').checked = cfg.snap
  el<HTMLInputElement>('lock').checked = cfg.locked
  el<HTMLInputElement>('calm').checked = cfg.calm
  el<HTMLSelectElement>('guide').value = cfg.guide ?? 'off'
  el('guideColors').hidden = (cfg.guide ?? 'off') === 'off'
  el<HTMLInputElement>('guideA').value = cfg.guideColorA ?? '#7dd3fc'
  el<HTMLInputElement>('guideB').value = cfg.guideColorB ?? '#fcd34d'
  el('guideA').setAttribute('aria-label', `${t('guideColours', 'Guide colours')} 1`)
  el('guideB').setAttribute('aria-label', `${t('guideColours', 'Guide colours')} 2`)

  el('clearHidden').hidden = cfg.hidden.length === 0
  el('hiddenCount').textContent = String(cfg.hidden.length)

  el<HTMLInputElement>('auto').checked = autoHosts.includes(host)

  const speech = state.speech
  const speaking = Boolean(speech?.speaking)
  const paused = Boolean(speech?.paused)
  el('speakStop').hidden = !speaking
  el('speak').classList.toggle('on', speaking)
  el('speakLabel').textContent = speaking
    ? t(paused ? 'readResume' : 'readPause', paused ? 'Resume' : 'Pause')
    : t('readAloud', 'Read aloud')

  for (const swatch of Array.from(document.querySelectorAll<HTMLButtonElement>('.ttsSwatch'))) {
    swatch.classList.toggle('selected', swatch.dataset.color === highlightColor)
  }
  const customHighlight = document.getElementById('ttsCustom') as HTMLInputElement | null
  if (customHighlight) customHighlight.value = highlightColor

  for (const swatch of Array.from(
    document.querySelectorAll<HTMLButtonElement>('#lineSwatches .swatch'),
  )) {
    swatch.classList.toggle('selected', swatch.dataset.color === cfg.color)
  }

  const text = cfg.text ?? DEFAULT_TEXT
  const zoomPercent = Math.round(text.zoom * 100)
  el<HTMLInputElement>('zoom').value = String(zoomPercent)
  el('zoomVal').textContent = `${zoomPercent}%`

  const lineStep = text.lineHeight > 0 ? Math.round((text.lineHeight - 1) * 10) : 0
  el<HTMLInputElement>('lineHeight').value = String(lineStep)
  el('lineVal').textContent = lineStep === 0 ? '—' : (1 + lineStep / 10).toFixed(1)

  const spacingStep = Math.round(text.letterSpacing * 100)
  el<HTMLInputElement>('spacing').value = String(spacingStep)
  el('spacingVal').textContent = `${(spacingStep / 100).toFixed(2)}em`

  paintShortcuts()

  for (const dot of Array.from(document.querySelectorAll<HTMLButtonElement>('.themeDot'))) {
    dot.classList.toggle('selected', dot.dataset.theme === text.theme)
  }
}

function buildSwatches(): void {
  const container = document.getElementById('lineSwatches')
  if (!container) return
  for (const [index, color] of LINE_COLORS.entries()) {
    const button = document.createElement('button')
    button.className = 'swatch'
    button.type = 'button'
    button.dataset.color = color
    button.style.background = color
    const label = t(COLOR_LABEL_KEYS[index] ?? 'lineColour', color)
    button.title = label
    button.setAttribute('aria-label', label)
    container.appendChild(button)
  }
}

function buildHighlightSwatches(): void {
  const container = document.getElementById('ttsSwatches')
  if (!container) return
  for (const color of HIGHLIGHT_COLORS) {
    const button = document.createElement('button')
    button.className = 'swatch ttsSwatch'
    button.type = 'button'
    button.dataset.color = color
    button.style.background = color
    const label = t(COLOR_LABEL_BY_HEX[color] ?? 'readHighlight', color)
    button.title = label
    button.setAttribute('aria-label', label)
    container.appendChild(button)
  }
}

function buildReadingLangSelect(): void {
  const select = el<HTMLSelectElement>('ttsLang')
  for (const option of LANGUAGES) {
    const node = document.createElement('option')
    node.value = option.code
    node.textContent =
      option.code === 'auto' ? t('readLangAuto', 'Auto (page / interface)') : option.label
    select.appendChild(node)
  }
}

function buildShortcutRows(): void {
  const container = document.getElementById('shortcutRows')
  if (!container) return

  for (const direction of ['up', 'down'] as const) {
    const row = document.createElement('div')
    row.className = 'keyRow'

    const glyph = document.createElement('span')
    glyph.className = 'glyph'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = direction === 'up' ? '↑' : '↓'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ghost keyBtn'
    button.dataset.dir = direction
    button.addEventListener('click', () => startRecording(direction))

    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'ghost subtle iconBtn'
    reset.textContent = '↺'
    const resetLabel = t('shortcutReset', 'Reset')
    reset.title = resetLabel
    reset.setAttribute('aria-label', resetLabel)
    reset.addEventListener('click', () => {
      shortcuts = { ...shortcuts, [direction]: DEFAULT_SHORTCUTS[direction] }
      void setLocal({ [SHORTCUTS_KEY]: shortcuts })
      paintShortcuts()
    })

    row.append(glyph, button, reset)
    container.appendChild(row)
  }

  window.addEventListener('blur', stopRecording)
}

function paintShortcuts(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.keyBtn'))) {
    const direction = button.dataset.dir as 'up' | 'down' | undefined
    if (!direction) continue
    const active = recording === direction
    button.classList.toggle('recording', active)
    button.textContent = active ? '…' : formatCombo(shortcuts[direction]) || '—'
    const label = `${t('moveLine', 'Move the reading line')} ${direction === 'up' ? '↑' : '↓'}`
    button.setAttribute('aria-label', label)
    if (active) button.setAttribute('aria-pressed', 'true')
    else button.removeAttribute('aria-pressed')
  }

  const moveKeys = document.getElementById('scMoveKeys')
  if (moveKeys) {
    moveKeys.textContent = `${formatCombo(shortcuts.up)} / ${formatCombo(shortcuts.down)}`
  }
}

function startRecording(direction: 'up' | 'down'): void {
  recording = direction
  paintShortcuts()
  window.addEventListener('keydown', onRecordKey, true)
}

function stopRecording(): void {
  if (!recording) return
  recording = null
  window.removeEventListener('keydown', onRecordKey, true)
  paintShortcuts()
}

/**
 * Captures the next key press. Only modifier combos and function keys are
 * accepted: a bare letter would fire while the user types on the page.
 */
function onRecordKey(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    stopRecording()
    return
  }
  const combo = comboFromEvent(event)
  if (!combo || !isUsableCombo(combo) || !recording) return
  shortcuts = { ...shortcuts, [recording]: combo }
  void setLocal({ [SHORTCUTS_KEY]: shortcuts })
  stopRecording()
}

function buildLanguageSelect(choice: string): void {
  const select = el<HTMLSelectElement>('lang')
  for (const option of LANGUAGES) {
    const node = document.createElement('option')
    node.value = option.code
    node.textContent = option.code === 'auto' ? t('languageAuto', 'Auto (browser)') : option.label
    select.appendChild(node)
  }
  select.value = choice
  select.addEventListener('change', () => {
    void setLocal({ uiLang: select.value }).then(() => window.location.reload())
  })
}
