export type TextTheme = 'default' | 'paper' | 'dark' | 'contrast'

/** Optional colour aid painted on the text around the reading line. */
export type GuideMode = 'off' | 'words' | 'sentence'

export interface TextConfig {
  /** Browser zoom level for this site, 1 = 100%. */
  zoom: number
  /** Line height for body text. 0 means "leave the page alone". */
  lineHeight: number
  /** Letter spacing in em. 0 means "leave the page alone". */
  letterSpacing: number
  /** Word spacing in em. 0 means "leave the page alone". */
  wordSpacing: number
  /** Body font size in px. 0 means "leave the page alone". */
  fontSize: number
  /** Limit text blocks to a comfortable measure (~65ch). */
  measure: boolean
  /** Force left alignment on text blocks. */
  alignLeft: boolean
  theme: TextTheme
}

export interface SiteConfig {
  /** Whether the reading line is switched on for this site. */
  active: boolean
  /** Vertical position of the band centre, 0..1 of the viewport height. */
  y: number
  /** Band height in CSS pixels. */
  height: number
  /** Dim opacity outside the band, 0..1. */
  dim: number
  /** Accent colour of the band. */
  color: string
  /** Follow the mouse pointer instead of staying put. */
  follow: boolean
  /** While following, snap the band to the text line under the pointer. */
  snap: boolean
  /** Ignore the pointer entirely: no follow, no drag. Keyboard nudges still work. */
  locked: boolean
  /** Stop CSS animations / transitions on the page. */
  calm: boolean
  /** Colour aid inside the block the line is resting on. */
  guide: GuideMode
  /** Alternating word colours for the colour guide. */
  guideColorA: string
  guideColorB: string
  /** CSS selectors of page elements the user chose to hide. */
  hidden: string[]
  /** Optional text-formatting overrides. */
  text: TextConfig
}

export const DEFAULT_TEXT: TextConfig = {
  zoom: 1,
  lineHeight: 0,
  letterSpacing: 0,
  wordSpacing: 0,
  fontSize: 0,
  measure: false,
  alignLeft: false,
  theme: 'default',
}

export const DEFAULT_CONFIG: SiteConfig = {
  active: false,
  y: 0.42,
  height: 48,
  dim: 0.55,
  color: '#7dd3fc',
  follow: false,
  snap: false,
  locked: false,
  calm: false,
  guide: 'off',
  guideColorA: '#7dd3fc',
  guideColorB: '#fcd34d',
  hidden: [],
  text: DEFAULT_TEXT,
}

/** Preset accent colours offered in the popup. */
export const LINE_COLORS = ['#7dd3fc', '#fbbf24', '#a78bfa', '#34d399', '#fb7185'] as const

export type Msg =
  | { type: 'fl:get' }
  | { type: 'fl:toggle' }
  | { type: 'fl:patch'; patch: Partial<SiteConfig> }
  | { type: 'fl:lock' }
  | { type: 'fl:pick' }
  | { type: 'fl:speak'; action: 'start' | 'pause' | 'resume' | 'stop' | 'rate' | 'color' | 'lang'; rate?: number; color?: string; lang?: string }

export interface SpeechState {
  speaking: boolean
  paused: boolean
  rate: number
  voiceURI: string
  color: string
  lang: string
}

export interface StateResponse {
  host: string
  active: boolean
  config: SiteConfig
  speech: SpeechState
}

export const siteKey = (host: string): string => `site:${host}`
export const AUTO_HOSTS_KEY = 'autoHosts'

