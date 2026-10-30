import { applyDocumentLocale, initI18n, localizeDom, t } from './shared/i18n.js'

void (async () => {
  await initI18n()
  applyDocumentLocale()
  document.title = t('welcomeTitle', document.title)
  localizeDom()
})()
