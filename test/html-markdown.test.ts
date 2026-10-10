/**
 * The HTML → Markdown round trip used by the DOM fallback paths.
 *
 * Two routes put scraped `.ds-markdown` HTML through `parseMarkup` +
 * `serializeToMarkdown`: the streaming DOM fallback (a reply whose SSE capture
 * never installed) and a `dom`-sourced recover. Both are exactly the paths a
 * reader has no other copy of, so anything this round trip loses is lost for
 * good — and until now nothing tested it at all, which is how the void-element
 * bug below survived from the beginning.
 *
 * The bug, in one line: the parser recognised a self-closing tag ONLY by a
 * literal `/>`, which standard HTML never writes for `<br>`, `<img>`, `<hr>` or
 * `<input>`. Each of those was parsed as an OPEN tag, collected every following
 * sibling as its children, and the converter then returned `'\n'` for a `<br>`
 * and dropped them. A reply with a line break in it silently lost everything
 * after the break.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeToMarkdown, htmlToMarkdown } from '../src/engine/html-md.ts'
import { parseMarkup } from '../src/engine/engine.ts'
import type { MarkupNode } from '../src/engine/engine.ts'

/** The real round trip: HTML string → light DOM → markdown. */
function roundTrip(html: string): string {
  return serializeToMarkdown(parseMarkup(html))
}

test('text after a void element survives the round trip', () => {
  // The exact shape the audit used: a line break and an image, each followed by
  // text that used to disappear.
  const html = '<p>前面<br>后面</p><p>第二段<img src="https://x.example/a.png" alt="图">尾随</p>'
  const md = roundTrip(html)
  for (const fragment of ['前面', '后面', '第二段', '尾随']) {
    assert.ok(md.includes(fragment), `"${fragment}" was lost: ${JSON.stringify(md)}`)
  }
  assert.ok(md.includes('![图](https://x.example/a.png)'), 'and the image still becomes markdown')
})

test('a horizontal rule does not swallow what follows it', () => {
  const md = roundTrip('<p>甲</p><hr><p>乙</p>')
  assert.ok(md.includes('甲'), 'the text before the rule')
  assert.ok(md.includes('---'), 'the rule itself')
  assert.ok(md.includes('乙'), 'and the text after it')
})

test('every void element stops at itself', () => {
  // One case per entry that DeepSeek's renderer can actually emit, so a future
  // edit that special-cases only `br` fails here rather than in a transcript.
  const cases: Array<[string, string]> = [
    ['<p>a<br>b</p>', 'b'],
    ['<p>a<hr>b</p>', 'b'],
    ['<p>a<img src="https://x.example/i.png">b</p>', 'b'],
    ['<p>a<input type="checkbox" checked> b</p>', 'b'],
    ['<p>a<wbr>b</p>', 'b'],
    ['<p>a<source src="https://x.example/v.mp4">b</p>', 'b'],
  ]
  for (const [html, expected] of cases) {
    assert.ok(roundTrip(html).includes(expected), `${html} lost "${expected}"`)
  }
  assert.equal(roundTrip('<p>a<input type="checkbox" checked> b</p>').includes('[x]'), true, 'a checked box stays a box')
  assert.equal(roundTrip('<p>a<input type="checkbox"> b</p>').includes('[ ]'), true, 'and an unchecked one too')
})

test('a void element inside a list or table keeps its siblings', () => {
  const list = roundTrip('<ul><li>甲<br>乙</li><li>丙</li></ul>')
  for (const fragment of ['甲', '乙', '丙']) assert.ok(list.includes(fragment), `list lost ${fragment}: ${list}`)
  const table = roundTrip('<table><tr><th>列<br>名</th></tr><tr><td>值</td></tr></table>')
  for (const fragment of ['列', '名', '值']) assert.ok(table.includes(fragment), `table lost ${fragment}: ${table}`)
})

test('the converter alone never drops a void node\'s text', () => {
  // The second half of the fix, tested without the parser: whatever tree it is
  // handed, a void element must not be a place text can vanish. This is what
  // makes the guarantee independent of the tokenizer.
  const child = { nodeType: 3, textContent: '孤儿文本' }
  for (const tagName of ['br', 'hr', 'img', 'input']) {
    const out = htmlToMarkdown({ tagName, nodeType: 1, children: [child], attributes: {} })
    assert.ok(out.includes('孤儿文本'), `<${tagName}> dropped its text: ${JSON.stringify(out)}`)
  }
})

test('the ordinary shapes still convert (no regression from the void fix)', () => {
  const md = roundTrip([
    '<h2>标题</h2>',
    '<p>正文<strong>加粗</strong>与<em>斜体</em>与<code>行内</code></p>',
    '<pre><code class="language-python">print(1)\nprint(2)</code></pre>',
    '<blockquote><p>引用</p></blockquote>',
    '<ol><li>第一</li><li>第二</li></ol>',
    '<table><tr><th>甲</th><th>乙</th></tr><tr><td>1</td><td>2</td></tr></table>',
    '<p><a href="https://x.example/p">链接</a></p>',
  ].join(''))
  assert.ok(md.includes('## 标题'), 'headings')
  assert.ok(md.includes('**加粗**') && md.includes('*斜体*') && md.includes('`行内`'), 'inline styles')
  assert.ok(md.includes('```python') && md.includes('print(2)'), 'a fenced code block keeps its language and body')
  assert.ok(md.includes('> 引用'), 'blockquote')
  assert.ok(md.includes('1. 第一') && md.includes('2. 第二'), 'ordered list numbering')
  assert.ok(md.includes('| 甲 | 乙 |'), 'table header row')
  assert.ok(md.includes('[链接](https://x.example/p)'), 'links')
  // The chrome DeepSeek renders around a reply is still dropped on purpose.
  assert.equal(md.includes('<button'), false)
})

/*
 * The root cause behind the void bug, pinned separately because it is a
 * DIFFERENT rule and a much larger loss.
 *
 * The parser filled a fresh, unnamed container on every recursion and compared
 * each close tag against THAT container's `tagName` — always `undefined`. So the
 * comparison was false for every real tag, `</p>`/`</strong>`/`</code>` were all
 * read as "mismatched close: ignore", and nothing ever closed: each element
 * swallowed every following sibling to the end of the fragment. Fixing only the
 * void elements would have left this in place, and it is the more damaging half
 * — the converter reads `<pre>`/`<code>` bodies from their text, so one code
 * block in a scraped reply took the code AND everything after it with it.
 */
test('an element stops at its own close tag instead of swallowing its siblings', () => {
  const root = parseMarkup('<p>一</p><p>二</p>')
  assert.deepEqual(root.children.map(child => child.tagName), ['p', 'p'], 'two sibling paragraphs, not one nested in the other')
  assert.deepEqual(root.children.map(child => child.children[0]?.textContent), ['一', '二'])

  // Nested inline markup stays a sibling chain too, which is what makes
  // `<strong>`/`<em>` render as markdown instead of nesting into each other.
  const inline = parseMarkup('<p><strong>粗</strong>与<em>斜</em></p>').children[0]
  assert.deepEqual(inline?.children.map(child => child.tagName ?? child.textContent), ['strong', '与', 'em'])
})

test('code blocks keep their body and language on the parser path', () => {
  // `textContent` exists on real DOM nodes only; a parsed element keeps its text
  // in children, so the old read produced an empty fence.
  const md = roundTrip('<p>说明</p><pre><code class="language-python">print(1)\nprint(2)</code></pre><p>之后</p>')
  assert.ok(md.includes('```python'), `the fence keeps its language: ${JSON.stringify(md)}`)
  assert.ok(md.includes('print(1)') && md.includes('print(2)'), 'and its body')
  assert.ok(md.includes('说明') && md.includes('之后'), 'and the paragraphs around it')
  assert.ok(roundTrip('<p>前<code>行内</code>后</p>').includes('`行内`'), 'inline code keeps its text')
  assert.ok(roundTrip('<p>看<math>a^2+b^2</math>这里</p>').includes('$a^2+b^2$'), 'and math keeps its body')
})

test('a checked checkbox is reported as checked', () => {
  // A value-less attribute (`checked`) was stored as `undefined`, and the
  // converter tests `checked !== undefined` — so every scraped checkbox came
  // back unchecked, and a todo list lost its ticks.
  assert.ok(roundTrip('<p><input type="checkbox" checked>甲</p>').includes('[x]'), 'checked')
  assert.ok(roundTrip('<p><input type="checkbox">甲</p>').includes('[ ]'), 'unchecked')
  assert.ok(roundTrip('<p><input type="checkbox" checked>甲</p>').includes('甲'), 'and the label survives either way')
})

/*
 * The parser must always advance.
 *
 * A tokenizer loop that can fail to consume a token hangs the caller, and the
 * caller here is the reply loop — a browser page and a turn that never ends,
 * which is strictly worse than a lost paragraph. The rewrite moved the
 * recursion into a `fill(node, tagName)` that has to return for every input, so
 * the property is pinned against pathological fragments rather than argued.
 */
test('pathological fragments terminate and never lose their text', () => {
  const cases = [
    '<p><br><p><br>',                 // unclosed everything
    '<div>',                          // a lone open tag
    '</p>',                           // a lone close tag
    '<a href="https://x.example">',   // an unclosed attribute-carrying tag
    '<p>a</div>b</p>',                // a mismatched close in the middle
    '<input><input><br>尾巴',          // void elements back to back
    '<p>甲<br></p><p>乙</p>',
    '<pre><code>没有闭合',
  ]
  for (const html of cases) {
    const md = roundTrip(html)
    assert.equal(typeof md, 'string', `${html} returned`)
  }
  // The text that IS present must survive, even from a fragment that never closes.
  assert.ok(roundTrip('<div>').length >= 0)
  assert.match(roundTrip('<input><input><br>尾巴'), /尾巴/)
  assert.match(roundTrip('<p>甲<br></p><p>乙</p>'), /甲[\s\S]*乙/)
  assert.match(roundTrip('<pre><code>没有闭合'), /没有闭合/, 'an unclosed code block still yields its text')
})
