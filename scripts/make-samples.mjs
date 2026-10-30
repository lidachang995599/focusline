/**
 * Generates sample PDFs for manually testing FocusLine Reader.
 *
 * GitHub (and the pdf.js test corpus) is not reachable from this machine, so
 * the samples are built locally with pdf-lib instead: an embedded TrueType
 * font, multi-column text, headings and page numbers — enough to exercise the
 * renderer, the text layer and the reading line.
 *
 * Run: node scripts/make-samples.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const GAP = 24
const COL_W = (PAGE_W - MARGIN * 2 - GAP) / 2
const CONTENT_W = PAGE_W - MARGIN * 2
const FS = 10.5
const LEADING = 15.5

const TITLE = 'Reading on Screen: A Field Guide for Focused Readers'
const AUTHORS = 'A. Researcher, B. Collaborator, C. Reader'
const ABSTRACT =
  'Reading long documents on a screen is harder than reading them on paper: banners move, sidebars compete for attention, and the eye loses the line it was on. This note collects the practical advice we give to students and colleagues who read papers, reports and contracts on a laptop, and it doubles as a sample document for testing a reading ruler. The text is intentionally ordinary: paragraphs of different lengths, a few headings, two columns and a figure, so that a reader can check line placement, scrolling and text selection.'

const SECTIONS = [
  {
    heading: '1. Why the line gets lost',
    paragraphs: [
      'The eye does not travel smoothly along a line of text. It jumps in short movements and pauses to take in a few characters at a time. When a page offers several competing targets, those pauses land in the wrong place and the reader has to search backwards for the last word that made sense. A ruler, whether a physical card or a dimmed band on screen, removes that search by making the current line the only high-contrast thing in view.',
      'The effect is strongest on dense material: contracts, academic papers, source code review notes. It is weakest on short social posts, where the whole text fits in one glance. That is why reading aids are usually evaluated on long-form text, and why the same tool can feel useless on one page and indispensable on another.',
    ],
  },
  {
    heading: '2. A practical setup',
    paragraphs: [
      'Start with a line that is slightly taller than the text itself. If the band is exactly the height of the glyphs, ascenders and descenders are clipped by the dim edges and the line looks cramped; a little padding reads better. The dimming should be strong enough to suppress the rest of the page but not so strong that the next line disappears entirely, because readers do use a little parafoveal information to plan the next jump.',
      'Keyboard control matters more than it seems. Reaching for the mouse breaks the reading rhythm, and a line that can only be dragged is a line that is always in the wrong place. A shortcut that locks the line, plus arrow keys for fine adjustment, keeps the hands where they were.',
    ],
  },
  {
    heading: '3. What we measured',
    paragraphs: [
      'We asked a small group of volunteers to read three documents of increasing density with and without a reading ruler. The sample is too small to support a strong claim, and we report it mainly to show the shape of the data: the ruler helped most on the densest document, helped slightly on the medium one, and made no measurable difference on the short one. Nobody asked to keep the ruler on a page that fit on a single screen.',
      'The qualitative feedback was more useful than the timings. Readers described the ruler as a way to stop re-reading the same sentence, and several said they used it only after lunch, when attention is lowest. A tool does not have to be used all day to be worth installing; it has to be there when the difficult document arrives.',
    ],
  },
  {
    heading: '4. Notes for implementers',
    paragraphs: [
      'A reading ruler is a small piece of software with an unusually large surface: every website lays out text differently, and the tool has to survive pages that reflow, animate or replace their content while the reader is looking at it. The least fragile approach is to draw the band in a fixed overlay and never touch the page layout, which is what the tool used for these notes does.',
      'PDF is the awkward case. Browsers render PDFs in a viewer that extensions cannot reach into, so a reading aid either gives up on PDFs or ships its own renderer. Shipping a renderer is more work, but it also means the line, the text layer and the keyboard shortcuts behave exactly the same way as they do on a web page.',
    ],
  },
]

const FOOTNOTES = [
  'This sample document was generated for testing FocusLine Reader. It is not a real paper; the citations are deliberately absent.',
]

class Writer {
  constructor(doc, regular, bold) {
    this.doc = doc
    this.regular = regular
    this.bold = bold
    this.page = null
    this.pageNo = 0
    this.col = 0
    this.y = 0
    this.top = 0
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.pageNo += 1
    this.col = 0
    this.top = PAGE_H - MARGIN
    this.y = this.top
    this.page.drawText(String(this.pageNo), {
      x: PAGE_W / 2 - 3,
      y: 30,
      size: 9,
      font: this.regular,
      color: rgb(0.45, 0.45, 0.45),
    })
  }

  x() {
    return MARGIN + this.col * (COL_W + GAP)
  }

  ensure(height) {
    if (this.y - height >= MARGIN) return
    if (this.col === 0) {
      this.col = 1
      // Column two starts below the title block on page one, and at the top
      // margin everywhere else. Starting at PAGE_H - MARGIN would overlap the
      // title on the first page.
      this.y = this.top
      return
    }
    this.newPage()
  }

  wrap(text, size, width, font) {
    const words = text.split(/\s+/)
    const lines = []
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next
      } else {
        if (line) lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
    return lines
  }

  paragraph(text, options = {}) {
    const size = options.size ?? FS
    const leading = options.leading ?? LEADING
    const width = options.width ?? COL_W
    const font = options.font ?? this.regular
    const color = options.color ?? rgb(0.12, 0.12, 0.14)
    for (const line of this.wrap(text, size, width, font)) {
      this.ensure(leading)
      // Recompute x after ensure(): a column or page break changes the column.
      const x = options.x ?? this.x()
      this.page.drawText(line, { x, y: this.y - size, size, font, color })
      this.y -= leading
    }
    this.y -= options.gap ?? 8
  }

  heading(text) {
    this.ensure(26)
    this.page.drawText(text, {
      x: this.x(),
      y: this.y - 12,
      size: 13,
      font: this.bold,
      color: rgb(0.08, 0.1, 0.16),
    })
    this.y -= 22
  }
}

async function buildSample({ pages, file }) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(await readFile('C:/Windows/Fonts/arial.ttf'), { subset: true })
  const bold = await doc.embedFont(await readFile('C:/Windows/Fonts/arialbd.ttf'), { subset: true })
  doc.setTitle('Reading on Screen — sample')
  doc.setAuthor('FocusLine sample generator')

  const writer = new Writer(doc, regular, bold)
  writer.newPage()

  // Title block, full width.
  for (const line of writer.wrap(TITLE, 20, CONTENT_W, bold)) {
    writer.page.drawText(line, {
      x: MARGIN,
      y: writer.y - 20,
      size: 20,
      font: bold,
      color: rgb(0.06, 0.08, 0.14),
    })
    writer.y -= 26
  }
  writer.y -= 12
  writer.page.drawText(AUTHORS, { x: MARGIN, y: writer.y, size: 10, font: regular, color: rgb(0.35, 0.35, 0.4) })
  writer.y -= 26
  writer.paragraph(ABSTRACT, { width: CONTENT_W, size: 10, leading: 15, gap: 16 })
  // Both columns start below the title block from here on.
  writer.top = writer.y - 4
  writer.y = writer.top

  let sectionIndex = 0
  while (writer.pageNo <= pages) {
    const section = SECTIONS[sectionIndex % SECTIONS.length]
    writer.heading(section.heading)
    for (const paragraph of section.paragraphs) {
      writer.paragraph(paragraph)
    }

    // A figure on the first pass, to exercise non-text drawing.
    if (sectionIndex === 2) {
      writer.ensure(150)
      const x = writer.x()
      writer.page.drawRectangle({
        x,
        y: writer.y - 110,
        width: COL_W,
        height: 110,
        color: rgb(0.9, 0.95, 1),
        borderColor: rgb(0.6, 0.72, 0.85),
        borderWidth: 1,
      })
      writer.page.drawText('Figure 1. A box where a figure would be.', {
        x: x + 10,
        y: writer.y - 60,
        size: 9,
        font: regular,
        color: rgb(0.3, 0.4, 0.55),
      })
      writer.y -= 124
      writer.paragraph(FOOTNOTES[0], { size: 9, leading: 13 })
    }

    sectionIndex += 1
    if (writer.pageNo >= pages) break
  }

  const bytes = await doc.save()
  await writeFile(file, bytes)
  console.log(`${file} — ${doc.getPageCount()} pages, ${(bytes.length / 1024).toFixed(0)} KB`)
}

const outDir = new URL('../samples/', import.meta.url)
await mkdir(outDir, { recursive: true })
if (!existsSync('C:/Windows/Fonts/arial.ttf')) {
  throw new Error('Arial is required to build the samples')
}
await buildSample({ pages: 4, file: new URL('reading-guide.pdf', outDir) })
await buildSample({ pages: 24, file: new URL('long-24-pages.pdf', outDir) })
