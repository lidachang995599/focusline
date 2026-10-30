/**
 * Unit tests for the reader's pure text helpers (sentence splitting and script
 * detection). The speech synthesis itself needs a browser; these cover the
 * parts that decide what gets spoken and which language voice is used.
 *
 * Run with: node test/reader-speech.test.mjs
 */
import assert from 'node:assert/strict'

const { detectLang, normalizeLocale, splitSentences } = await import(
  new URL('../dist/reader/speech.js', import.meta.url).href
)

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('reader speech')

check('detects Japanese, Korean and Chinese scripts', () => {
  assert.equal(detectLang('これはテストです。'), 'ja')
  assert.equal(detectLang('이것은 테스트입니다.'), 'ko')
  assert.equal(detectLang('这是一个测试。'), 'zh')
  assert.equal(detectLang('This is a test.'), null)
})

check('normalises menu locales for Intl', () => {
  assert.equal(normalizeLocale('zh_CN'), 'zh-CN')
  assert.equal(normalizeLocale(''), 'en')
  assert.equal(normalizeLocale('en-US'), 'en-US')
})

check('splits English prose on sentence punctuation', () => {
  const text = 'First sentence. Second one! Third?'
  const sentences = splitSentences(text, 'en')
  assert.equal(sentences.length, 3)
  assert.equal(sentences[0].text, 'First sentence.')
  assert.equal(sentences[2].text, 'Third?')
  for (const sentence of sentences) {
    assert.equal(text.slice(sentence.start, sentence.end), sentence.text)
  }
})

check('splits Chinese prose without spaces', () => {
  const text = '这是第一句。这是第二句！'
  const sentences = splitSentences(text, 'zh-CN')
  assert.equal(sentences.length, 2)
  assert.equal(sentences[0].text, '这是第一句。')
  assert.equal(sentences[1].start, 6)
})

check('keeps offsets usable for highlighting', () => {
  const text = 'Alpha beta. Gamma delta.'
  const sentences = splitSentences(text, 'en')
  assert.equal(sentences.length, 2)
  const [first, second] = sentences
  assert.ok(first.end <= second.start)
  assert.equal(text.slice(second.start, second.end), 'Gamma delta.')
})

console.log(`\n${passed} checks passed`)
