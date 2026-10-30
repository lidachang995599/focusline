/**
 * Language handling with an optional manual override.
 *
 * By default the UI follows chrome.i18n (the browser UI language). If the user
 * picks a language in the popup we load that locale's messages.json directly
 * and use it instead.
 */

export interface LanguageOption {
  code: string
  label: string
}

/** Locales that ship with a `_locales/<code>/messages.json` folder. */
export const LANGUAGES: LanguageOption[] = [
  { code: 'auto', label: 'Auto' },
  { code: 'en', label: 'English' },
  { code: 'zh_CN', label: '简体中文' },
  { code: 'zh_TW', label: '繁體中文' },
  { code: 'es', label: 'Español' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'ru', label: 'Русский' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt_BR', label: 'Português (BR)' },
]

const SUPPORTED_BASES = new Set(['en', 'es', 'ja', 'ko', 'fr', 'ru', 'de'])

let overrideMessages: Record<string, string> | null = null
let currentLang = ''

export function uiLanguage(): string {
  try {
    return chrome.i18n?.getUILanguage?.() ?? 'en'
  } catch {
    return 'en'
  }
}

export function currentLocale(): string {
  return currentLang || uiLanguage()
}

/**
 * Reads the saved preference and, when it is not "auto", loads that locale's
 * messages from the extension package. Returns the saved choice.
 */
export async function initI18n(): Promise<string> {
  let choice = 'auto'
  try {
    const stored = await new Promise<Record<string, unknown>>((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve({})
      chrome.storage.local.get('uiLang', (items) => resolve(items as Record<string, unknown>))
    })
    if (typeof stored.uiLang === 'string' && stored.uiLang) choice = stored.uiLang
  } catch {
    choice = 'auto'
  }

  currentLang = choice === 'auto' ? uiLanguage() : choice

  if (choice === 'auto') {
    overrideMessages = null
    return choice
  }

  try {
    const url = chrome.runtime.getURL(`_locales/${choice}/messages.json`)
    const response = await fetch(url)
    const data = (await response.json()) as Record<string, { message?: string }>
    const map: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value?.message) map[key] = value.message
    }
    overrideMessages = map
  } catch {
    overrideMessages = null
  }
  return choice
}

/**
 * Whether a browser UI language matches a bundle we ship. Used to show the
 * "don't see your language?" note.
 */
export function isSupportedLocale(language: string = uiLanguage()): boolean {
  const lang = language.toLowerCase()
  if (lang.startsWith('zh')) {
    return lang.includes('cn') || lang.includes('sg') || lang.includes('tw')
  }
  if (lang.startsWith('pt')) {
    return lang.includes('br')
  }
  const base = lang.split('-')[0]
  if (base === 'nb' || base === 'nn') return SUPPORTED_BASES.has('no')
  return SUPPORTED_BASES.has(base)
}

/** Sets `lang` and `dir` on the document root, including RTL. */
export function applyDocumentLocale(language: string = currentLocale()): void {
  const lang = language.toLowerCase()
  const rtl = /^(ar|fa|he|ur)(-|$)/.test(lang)
  document.documentElement.lang = language
  document.documentElement.dir = rtl ? 'rtl' : 'ltr'
}

export function t(key: string, fallback = ''): string {
  // With an explicit choice, missing keys fall back to English — never to
  // chrome.i18n, which follows the browser UI and would mix two languages.
  if (overrideMessages) return overrideMessages[key] ?? fallback
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n) {
      const value = chrome.i18n.getMessage(key)
      if (value) return value
    }
  } catch {
    // Fall through to the fallback string.
  }
  return fallback
}

export function localizeDom(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.dataset.i18n
    if (!key) continue
    const value = t(key)
    if (value) el.textContent = value
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-html]'))) {
    const key = el.dataset.i18nHtml
    if (!key) continue
    const value = t(key)
    if (value) el.innerHTML = value
  }

  for (const el of Array.from(root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]'))) {
    const key = el.dataset.i18nPlaceholder
    if (!key) continue
    const value = t(key)
    if (value) el.placeholder = value
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    const key = el.dataset.i18nTitle
    if (!key) continue
    const value = t(key)
    if (value) el.title = value
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]'))) {
    const key = el.dataset.i18nAriaLabel
    if (!key) continue
    const value = t(key) || el.getAttribute('aria-label') || el.title
    if (value) el.setAttribute('aria-label', value)
  }
}
