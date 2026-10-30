/**
 * Keyboard shortcut model shared by the popup and the tests.
 *
 * `src/content.ts` is injected as a classic script, so it cannot import this
 * file — the same helpers live there in a self-contained copy. Keep the two in
 * sync when the combo format changes.
 */

export interface ShortcutMap {
  /** Combo that moves the line up. An empty string disables it. */
  up: string
  /** Combo that moves the line down. An empty string disables it. */
  down: string
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  up: 'Alt+ArrowUp',
  down: 'Alt+ArrowDown',
}

/** Storage key for the user's shortcut overrides (global, not per site). */
export const SHORTCUTS_KEY = 'shortcuts'

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Meta', 'Shift'])

const ARROW_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

/** Turns the printable part of a key event into a stable combo token. */
export function keyName(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}

/**
 * Builds a normalised combo such as `Ctrl+Shift+K`.
 * Returns an empty string for modifier-only presses so the recorder ignores them.
 */
export function comboFromEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string {
  if (!event.key || isModifierKey(event.key)) return ''
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(keyName(event.key))
  return parts.join('+')
}

/**
 * A bare letter would fire while the user types in a page, and a Shift-only
 * combo would fire on every capital letter, so require Ctrl / Alt / Meta or a
 * function key.
 */
export function isUsableCombo(combo: string): boolean {
  if (!combo) return false
  const parts = combo.split('+')
  if (parts.length === 1) return /^F\d{1,2}$/.test(parts[0])
  return parts.some((part) => part === 'Ctrl' || part === 'Alt' || part === 'Meta')
}

/** `Alt+ArrowUp` → `Alt + ↑`, for the popup chip. */
export function formatCombo(combo: string): string {
  if (!combo) return ''
  return combo
    .split('+')
    .map((part) => ARROW_LABELS[part] ?? part)
    .join(' + ')
}

/** Fills missing fields with defaults so old storage values stay usable. */
export function normalizeShortcuts(value: unknown): ShortcutMap {
  const raw = (value ?? {}) as Partial<ShortcutMap>
  return {
    up: typeof raw.up === 'string' ? raw.up : DEFAULT_SHORTCUTS.up,
    down: typeof raw.down === 'string' ? raw.down : DEFAULT_SHORTCUTS.down,
  }
}
