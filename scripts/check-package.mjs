import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const errors = []

if (!existsSync(join(dist, 'manifest.json'))) {
  errors.push('dist/manifest.json is missing — run npm run build')
} else {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  if (manifest.default_locale) {
    const localeDir = join(dist, '_locales', manifest.default_locale)
    if (!existsSync(join(localeDir, 'messages.json'))) {
      errors.push(`_locales/${manifest.default_locale}/messages.json is missing`)
    }
  }
  if (existsSync(join(dist, '_locales'))) {
    const locales = readdirSync(join(dist, '_locales')).filter((name) =>
      statSync(join(dist, '_locales', name)).isDirectory(),
    )
    for (const locale of locales) {
      if (!existsSync(join(dist, '_locales', locale, 'messages.json'))) {
        errors.push(`_locales/${locale}/messages.json is missing`)
      }
    }
    if (locales.length === 0) errors.push('_locales is empty')
  } else {
    errors.push('_locales subtree is missing')
  }

  for (const file of ['background.js', 'content.js', 'popup.html', 'reader.html']) {
    if (!existsSync(join(dist, file))) errors.push(`${file} is missing`)
  }
}

if (errors.length > 0) {
  console.error('[check] package is not loadable:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('[check] dist looks good — load unpacked from the dist/ folder')
