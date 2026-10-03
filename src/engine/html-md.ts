/**
 * Minimal HTML → Markdown converter used to scrape DeepSeek's rendered
 * `.ds-markdown` replies. Covers the shapes DeepSeek renders (headings,
 * paragraphs, code blocks with syntax classes, inline code, bold/italic,
 * links, images, lists, tables, blockquotes, math placeholders). Anything
 * unrecognized falls back to its text content — fidelity loss degrades
 * gracefully instead of dropping text.
 */

/** Escape text that could be parsed as markdown markup. */
function escapeText(text: string): string {
  return text
    .replace(/([\\`*_[\]<>])/g, '\\$1')
    .replace(/\n{3,}/g, '\n\n')
}

interface NodeLike {
  readonly tagName?: string
  readonly nodeType?: number
  readonly textContent?: string | null
  readonly children?: readonly NodeLike[]
  readonly attributes?: Record<string, string | undefined>
  readonly innerHTML?: string
  readonly className?: string
  readonly parent?: NodeLike
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** Convert one DOM subtree (element or text) to markdown. */
export function htmlToMarkdown(root: NodeLike): string {
  if (root === null || root === undefined) return ''
  if (root.nodeType === TEXT_NODE) return escapeText(root.textContent ?? '')
  const tag = (root.tagName ?? '').toLowerCase()
  const text = (children: readonly NodeLike[] | undefined): string =>
    (children ?? []).map(htmlToMarkdown).join('')

  switch (tag) {
    case 'br': return '\n'
    case 'hr': return '\n---\n'
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = Number(tag[1])
      return `\n${'#'.repeat(level)} ${text(root.children).trim()}\n`
    }
    case 'p': return `\n${text(root.children).trim()}\n`
    case 'strong': case 'b': return `**${text(root.children).trim()}**`
    case 'em': case 'i': return `*${text(root.children).trim()}*`
    case 'code': {
      // Code block vs inline: <pre><code> is a block; bare <code> is inline.
      const parentPre = root.parent?.tagName?.toLowerCase() === 'pre'
      if (parentPre) return text(root.children)
      return `\`${(root.textContent ?? '').replace(/`/g, '\\`')}\``
    }
    case 'pre': {
      const code = root.children?.find(child => (child.tagName ?? '').toLowerCase() === 'code') ?? root
      const raw = code.textContent ?? ''
      const className = code.className ?? ''
      const language = /language-([a-zA-Z0-9_+-]+)/.exec(className)?.[1] ?? ''
      const fence = '```'
      return `\n${fence}${language}\n${raw.replace(/\n$/, '')}\n${fence}\n`
    }
    case 'a': {
      const href = root.attributes?.href
      const label = text(root.children).trim()
      if (href === undefined || href === '' || href.startsWith('javascript:')) return label
      return `[${label || href}](${href})`
    }
    case 'img': {
      const src = root.attributes?.src
      const alt = root.attributes?.alt ?? ''
      return src === undefined ? '' : `![${alt}](${src})`
    }
    case 'ul': return `\n${(root.children ?? []).map(child => {
      if ((child.tagName ?? '').toLowerCase() === 'li') return `- ${text(child.children).trim()}`
      return htmlToMarkdown(child)
    }).join('\n')}\n`
    case 'ol': {
      let index = 1
      return `\n${(root.children ?? []).map(child => {
        if ((child.tagName ?? '').toLowerCase() === 'li') return `${index++}. ${text(child.children).trim()}`
        return htmlToMarkdown(child)
      }).join('\n')}\n`
    }
    case 'li': return text(root.children).trim()
    case 'blockquote': return `\n> ${text(root.children).trim().replace(/\n/g, '\n> ')}\n`
    case 'table': {
      const rows = (root.children ?? []).filter(child => (child.tagName ?? '').toLowerCase() === 'tr')
      if (rows.length === 0) return text(root.children).trim()
      const cellsOf = (row: NodeLike): string[] => (row.children ?? [])
        .filter(child => ['th', 'td'].includes((child.tagName ?? '').toLowerCase()))
        .map(cell => text(cell.children).trim().replace(/\|/g, '\\|'))
      const header = cellsOf(rows[0])
      const body = rows.slice(1).map(cellsOf)
      const width = Math.max(header.length, ...body.map(row => row.length))
      const pad = (cells: string[]): string => {
        const filled = [...cells]
        while (filled.length < width) filled.push('')
        return `| ${filled.join(' | ')} |`
      }
      const lines = [pad(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(pad)]
      return `\n${lines.join('\n')}\n`
    }
    case 'tr': case 'td': case 'th': case 'thead': case 'tbody': case 'tfoot':
      return text(root.children)
    case 'details': return `\n<details>\n${text(root.children)}\n</details>\n`
    case 'summary': return `**${text(root.children).trim()}**`
    case 'input': {
      const checked = root.attributes?.checked !== undefined
      return checked ? '[x] ' : '[ ] '
    }
    case 'math': return `$${root.textContent ?? ''}$`
    case 'svg': case 'button': case 'script': case 'style': return ''
    case 'div': case 'span': case 'section': case 'article': case 'main':
      return text(root.children)
    default: {
      const direct = text(root.children)
      return direct
    }
  }
}

/** Convert serialized DOM (from the in-page scraper) to markdown. */
export function serializeToMarkdown(root: NodeLike): string {
  return htmlToMarkdown(root).replace(/\n{3,}/g, '\n\n').trim()
}
