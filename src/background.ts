import { getLocal, hasOrigin, injectContent, queryActiveTab, sendToTab } from './shared/chrome.js'
import { AUTO_HOSTS_KEY, type Msg, type StateResponse } from './shared/types.js'

const isHttp = (url: string | undefined): url is string => Boolean(url && /^https?:\/\//i.test(url))
const readerUrl = chrome.runtime.getURL('reader.html')
const isReader = (url: string | undefined): boolean => Boolean(url && url.startsWith(readerUrl))

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') })
  }
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-overlay') void toggleOnActiveTab()
  else if (command === 'toggle-lock') void lockOnActiveTab()
})

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') void maybeAutoInject(tabId, tab.url)
})

/**
 * The keyboard shortcut has no popup to grant activeTab, so we inject first and
 * then decide whether a toggle is still needed. Injecting a page whose stored
 * config is already `active: true` shows the line on its own.
 */
async function toggleOnActiveTab(): Promise<void> {
  const tab = await queryActiveTab()
  if (!tab?.id) return

  // The reader is an extension page, so commands have to be relayed to it
  // instead of injected as a content script.
  if (isReader(tab.url)) {
    try {
      await chrome.runtime.sendMessage({ type: 'fl:reader', action: 'toggle' })
    } catch {
      // No reader listening.
    }
    return
  }

  if (!isHttp(tab.url)) return

  try {
    await sendToTab<StateResponse>(tab.id, { type: 'fl:toggle' } as Msg)
    return
  } catch {
    // No content script yet — inject and check what state it booted into.
  }

  try {
    await injectContent(tab.id)
    const state = await sendToTab<StateResponse>(tab.id, { type: 'fl:get' } as Msg)
    if (!state.active) await sendToTab(tab.id, { type: 'fl:toggle' } as Msg)
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer) — nothing to do.
  }
}

/**
 * Lock is a plain toggle. If no content script is running yet we inject one
 * first, which also restores the line when the site was already enabled.
 */
async function lockOnActiveTab(): Promise<void> {
  const tab = await queryActiveTab()
  if (!tab?.id) return

  if (isReader(tab.url)) {
    try {
      await chrome.runtime.sendMessage({ type: 'fl:reader', action: 'lock' })
    } catch {
      // No reader listening.
    }
    return
  }

  if (!isHttp(tab.url)) return

  try {
    await sendToTab(tab.id, { type: 'fl:lock' } as Msg)
    return
  } catch {
    // No content script yet.
  }

  try {
    await injectContent(tab.id)
    await sendToTab(tab.id, { type: 'fl:lock' } as Msg)
  } catch {
    // Restricted page — nothing to do.
  }
}

async function maybeAutoInject(tabId: number, url: string | undefined): Promise<void> {
  if (!isHttp(url)) return

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }

  const stored = await getLocal<string[]>(AUTO_HOSTS_KEY)
  const autoHosts = stored[AUTO_HOSTS_KEY] ?? []
  if (!autoHosts.includes(parsed.hostname)) return
  if (!(await hasOrigin(`${parsed.origin}/*`))) return

  try {
    await injectContent(tabId)
  } catch {
    // Ignore — the tab may have navigated away while we were checking.
  }
}
