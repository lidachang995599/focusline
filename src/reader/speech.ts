/**
 * Pure text helpers for reading a PDF aloud: script detection and sentence
 * splitting. Kept DOM-free so they can be unit-tested in Node.
 */

export interface Sentence {
  text: string
  start: number
  end: number
}

type SegmenterCtor = new (
  locale?: string,
  options?: { granularity?: string },
) => { segment(input: string): Iterable<{ segment: string; index: number }> }

/** Kana and Hangul are unambiguous; Han is treated as Chinese. */
export function detectLang(text: string): 'ja' | 'ko' | 'zh' | null {
  const sample = text.slice(0, 2000)
  if (/[\u3040-\u30ff]/.test(sample)) return 'ja'
  if (/[\uac00-\ud7af]/.test(sample)) return 'ko'
  if (/[\u3400-\u9fff]/.test(sample)) return 'zh'
  return null
}

/** `zh_CN` → `zh-CN`, which is what Intl accepts. */
export function normalizeLocale(tag: string): string {
  const clean = (tag || '').replace(/_/g, '-').trim()
  return clean || 'en'
}

export function splitSentences(text: string, lang = 'en'): Sentence[] {
  const out: Sentence[] = []
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
  const locale = normalizeLocale(lang)

  if (Segmenter) {
    try {
      const segmenter = new Segmenter(locale, { granularity: 'sentence' })
      for (const part of segmenter.segment(text)) {
        const trimmed = part.segment.trim()
        if (!trimmed) continue
        const start = part.index + part.segment.indexOf(trimmed)
        out.push({ text: trimmed, start, end: start + trimmed.length })
      }
      return out
    } catch {
      // Fall through to the regex split.
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
