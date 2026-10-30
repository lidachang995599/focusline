/**
 * i18n checks: message key parity, every data-i18n attribute resolving, manifest
 * placeholders, and runtime localisation against the Chinese bundle.
 *
 * Run with: node test/i18n.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const locales = ['en', 'zh_CN', 'zh_TW', 'es', 'ja', 'ko', 'fr', 'ru', 'de', 'pt_BR']
const messages = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(new URL(`../public/_locales/${locale}/messages.json`, import.meta.url), 'utf8')),
  ]),
)

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('i18n')

await check('all locales expose the same keys', () => {
  const expected = Object.keys(messages.en).sort()
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), expected, `${locale} key set differs`)
  }
})

const usedKeys = new Set()
for (const file of ['popup.html', 'welcome.html']) {
  const html = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')
  for (const match of html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label)?="([^"]+)"/g)) {
    usedKeys.add(match[1])
  }
}

await check('every data-i18n attribute has a message in every locale', () => {
  assert.ok(usedKeys.size > 20, `expected many localised nodes, found ${usedKeys.size}`)
  for (const locale of locales) {
    for (const key of usedKeys) {
      assert.ok(messages[locale][key], `${locale} is missing "${key}"`)
    }
  }
})

await check('manifest uses localised name and description placeholders', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.default_locale, 'en')
  const placeholders = [...manifest.name.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((match) => match[1])
  const descriptionPlaceholders = [...manifest.description.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(
    (match) => match[1],
  )
  for (const key of [...placeholders, ...descriptionPlaceholders]) {
    assert.ok(messages.en[key], `manifest placeholder ${key} is missing`)
  }
})

await check('runtime localisation uses the active locale bundle', async () => {
  const dom = new JSDOM(
    '<span id="label" data-i18n="lineHeight"></span><span id="support" data-i18n="pdfHint"></span>',
  )
  globalThis.document = dom.window.document
  globalThis.chrome = {
    i18n: {
      getMessage: (key) => messages.zh_CN[key]?.message ?? '',
    },
  }

  const { localizeDom, t } = await import(new URL('../dist/shared/i18n.js', import.meta.url).href)
  localizeDom()

  assert.equal(dom.window.document.getElementById('label').textContent, '线高')
  assert.equal(
    dom.window.document.getElementById('support').textContent,
    messages.zh_CN.pdfHint.message,
  )
  assert.equal(t('lineHeight'), '线高')
})

await check('recognises every shipped locale', async () => {
  const { isSupportedLocale } = await import(new URL('../dist/shared/i18n.js', import.meta.url).href)
  const tags = {
    en: 'en-US',
    zh_CN: 'zh-CN',
    zh_TW: 'zh-TW',
    es: 'es-ES',
    ja: 'ja-JP',
    ko: 'ko-KR',
    fr: 'fr-FR',
    ru: 'ru-RU',
    de: 'de-DE',
    pt_BR: 'pt-BR',
  }
  for (const [locale, tag] of Object.entries(tags)) {
    assert.ok(isSupportedLocale(tag), `${locale} should be supported for ${tag}`)
  }
  assert.equal(isSupportedLocale('bg-BG'), false, 'Bulgarian has no bundle yet')
  assert.equal(isSupportedLocale('hr-HR'), false, 'Croatian has no bundle yet')
  assert.equal(isSupportedLocale('nl-NL'), false, 'Dutch was dropped from the bundle')
  assert.equal(isSupportedLocale('ar-EG'), false, 'Arabic was dropped from the bundle')
  assert.equal(isSupportedLocale('sk-SK'), false, 'Slovak has no bundle yet')
  assert.equal(isSupportedLocale('pt-PT'), false, 'European Portuguese has no bundle yet')
  assert.equal(isSupportedLocale('zh-HK'), false, 'Hong Kong Chinese has no bundle yet')
})

await check('sets RTL direction for Arabic, Persian and Hebrew', async () => {
  const { applyDocumentLocale } = await import(new URL('../dist/shared/i18n.js', import.meta.url).href)
  for (const tag of ['ar-EG', 'fa-IR', 'he-IL']) {
    applyDocumentLocale(tag)
    assert.equal(globalThis.document.documentElement.dir, 'rtl', `${tag} should be rtl`)
  }
  applyDocumentLocale('ja-JP')
  assert.equal(globalThis.document.documentElement.dir, 'ltr')
})

await check('ships a language menu entry for every bundle', async () => {
  const { LANGUAGES } = await import(new URL('../dist/shared/i18n.js', import.meta.url).href)
  assert.equal(LANGUAGES.length, locales.length + 1, 'auto plus one entry per locale')
  const codes = new Set(LANGUAGES.map((option) => option.code))
  for (const locale of locales) assert.ok(codes.has(locale), `menu is missing ${locale}`)
})

console.log(`\n${passed} checks passed`)

