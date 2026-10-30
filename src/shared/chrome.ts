/** Small promise wrappers so the same helpers work in every extension context. */

export const hasChrome = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome?.storage?.local)

export function getLocal<T>(keys: string | string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    if (!hasChrome()) return resolve({} as Record<string, T>)
    chrome.storage.local.get(keys, (items) => resolve(items as Record<string, T>))
  })
}

export function setLocal(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!hasChrome()) return resolve()
    chrome.storage.local.set(items, () => resolve())
  })
}

export function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
  })
}

export function sendToTab<T>(tabId: number, msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response: T) => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve(response)
    })
  })
}

export function injectContent(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

export function requestOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [origin] }, (granted) => resolve(Boolean(granted)))
  })
}

export function hasOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [origin] }, (granted) => resolve(Boolean(granted)))
  })
}
