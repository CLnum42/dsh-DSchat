/**
 * 「选择哪些问答」 — the one picker behind both 分享 and 导出 markdown.
 *
 * Two features need the same thing and the same rules, so they get one
 * component rather than two that drift:
 *
 *   · 分享 (a PUBLIC link) can cover several turns — the web page's own 分享 is a
 *     SELECTION mode, not a one-answer action (`enterSelection(sessionId, [id])`
 *     then 全选 / per-message checkboxes, see docs/probe-2026-10-14-share-flow.md).
 *     What a reader may choose there is exactly this list.
 *   · 导出 markdown writes a file and the reader may want only part of the
 *     conversation in it. Default ALL, because "export the conversation" is the
 *     normal case.
 *
 * THE UNIT IS THE TURN, and the two halves are BOUND. The page's own model is a
 * pair (`MESSAGES_MUST_APPEAR_IN_PAIRS`, and clicking one checkbox in its
 * selection mode selects the question WITH its answer), so:
 *
 *   - a question and every answer under it are one turn;
 *   - the reader CAN press either half's checkbox — that is the affordance the
 *     request asked for — and both halves flip together, because there is one
 *     selected flag per turn and no way to express "the question without the
 *     answer". Toggling 取消 on the answer does NOT leave the question selected:
 *     it removes the turn.
 *
 * The component is pure: it renders the list and reports a press, and the panel
 * owns the state. That is what lets the binding rule be asserted directly (see
 * test/qa-picker.test.ts) instead of through a rendered transcript.
 */

import { createElement, type ReactNode } from 'react'
import type { DSchatMessage } from '../../protocol.ts'
import { CheckIcon } from '../icons.tsx'
import { firstLine, replyBody } from './reply.ts'

/** One question and the answers it received, as the pickers see them. */
export interface QaTurn {
  /** Stable id — the turn's own key, and what a selection stores. */
  readonly id: string
  /** The reader's question, when the transcript has one. */
  readonly question?: DSchatMessage
  /** Every answer under that question, oldest first. */
  readonly answers: readonly DSchatMessage[]
  /**
   * True when the WEB PAGE can share this turn.
   *
   * A share is created by the page from a question+answer pair, so a turn with
   * no question (an answer the local transcript could not attach one to) and a
   * turn whose answer is still streaming cannot be shared. In 分享 mode such a
   * turn is NOT OFFERED — see {@link selectableTurns} — rather than shown and
   * refused: a row a reader can press but that never becomes part of the
   * selection is a broken control, and the count beside it would contradict the
   * ticks on screen.
   */
  readonly shareable: boolean
  /** The question's preview line, empty when there is none to show. */
  readonly questionLine: string
  /** One preview line per answer, in `answers` order (empty when there is none). */
  readonly answerLines: readonly string[]
}

/** How much of a message a picker row shows before the stylesheet clips it. */
const PREVIEW_CHARS = 160

/**
 * One preview line for the picker.
 *
 * The FIRST non-empty line, with the markdown markers a heading or a list item
 * would open with stripped: a row that begins `## ` reads as a rendering bug in
 * a one-line list, and the marker carries nothing the reader needs there.
 */
function previewLine(text: string): string {
  const line = text.split('\n').map(part => part.trim()).find(part => part !== '') ?? ''
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    /*
     * Inline markdown is stripped too. A one-line preview of a real answer is
     * full of `**重点**` and `` `code` `` markers, and at 12.5px those read as
     * noise rather than as emphasis — the row is a label, not the document.
     */
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, PREVIEW_CHARS)
}

/**
 * Group a transcript into turns.
 *
 * A USER message opens a turn; every following ASSISTANT message belongs to it.
 * An assistant message with no question before it still gets a turn of its own
 * (with an empty `question`), because 导出 must not silently drop it — and
 * `shareable` is what says the page cannot share it.
 *
 * @param messages - the transcript, in order.
 * @returns one entry per turn, in transcript order.
 */
export function qaTurns(messages: readonly DSchatMessage[]): QaTurn[] {
  const turns: Array<{ id: string; question?: DSchatMessage; answers: DSchatMessage[] }> = []
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ id: message.id, question: message, answers: [] })
      continue
    }
    const last = turns[turns.length - 1]
    if (last === undefined) turns.push({ id: `answer-${message.id}`, answers: [message] })
    else last.answers.push(message)
  }
  return turns.map(turn => ({
    id: turn.id,
    ...(turn.question === undefined ? {} : { question: turn.question }),
    answers: turn.answers,
    shareable: turn.question !== undefined
      && turn.answers.some(answer => answer.streaming !== true && replyBody(answer.content).trim() !== ''),
    questionLine: turn.question === undefined ? '' : previewLine(firstLine(turn.question.content)),
    answerLines: turn.answers.map(answer => previewLine(firstLine(answer.content))),
  }))
}

/**
 * The turns a selection may cover, in a mode.
 *
 * 分享 can only offer shareable turns; 导出 offers every turn with content. Used
 * for 全选 and for the count, so "已选择 3 组对话" never counts something the
 * reader cannot have chosen.
 */
export function selectableTurns(turns: readonly QaTurn[], mode: 'share' | 'export'): QaTurn[] {
  return turns.filter(turn => (mode === 'share' ? turn.shareable : turn.question !== undefined || turn.answers.length > 0))
}

/** The turns of `turns` a selection covers, in transcript order. */
export function selectedTurns(turns: readonly QaTurn[], selected: ReadonlySet<string>, mode: 'share' | 'export'): QaTurn[] {
  return selectableTurns(turns, mode).filter(turn => selected.has(turn.id))
}

/**
 * The message ids a selection stands for.
 *
 * For 导出 this is every message in the chosen turns (question and answers) —
 * the file is a record of what was asked and answered.
 *
 * For 分享 it is ONE ANSWER PER TURN, the newest one that has text. The page's
 * share endpoint pairs each answer with its question by itself
 * (`MESSAGES_MUST_APPEAR_IN_PAIRS` is enforced server-side), and the page's own
 * selection mode counts PAIRS: handing it two answers of one turn would ask for
 * the same question twice, which `toggleMessageSelection` cannot express (the
 * second click would clear the pair rather than add anything). "Share this turn"
 * therefore means the exchange as it now stands, which is the answer the reader
 * is looking at.
 */
export function selectedMessageIds(turns: readonly QaTurn[], selected: ReadonlySet<string>, mode: 'share' | 'export'): string[] {
  const ids: string[] = []
  for (const turn of selectedTurns(turns, selected, mode)) {
    if (mode === 'share') {
      const answer = [...turn.answers].reverse()
        .find(candidate => candidate.streaming !== true && replyBody(candidate.content).trim() !== '')
      if (answer !== undefined) ids.push(answer.id)
      continue
    }
    if (turn.question !== undefined) ids.push(turn.question.id)
    for (const answer of turn.answers) ids.push(answer.id)
  }
  return ids
}

/**
 * The plain-markdown text of a share selection.
 *
 * What the failure toast offers as 「改为复制文本」 when the page cannot be
 * driven: the same turns the reader chose, as text, so the click that did not
 * publish still hands them something they can send. The reasoning is dropped,
 * exactly as 复制 and the markdown export drop it.
 */
export function selectionShareText(title: string, turns: readonly QaTurn[], selected: ReadonlySet<string>): string {
  const lines = [`# ${title}`, '']
  const chosen = selectedTurns(turns, selected, 'share')
  chosen.forEach((turn, index) => {
    if (index > 0) lines.push('---', '')
    const question = turn.question?.content.trim() ?? ''
    if (question !== '') lines.push(`> ${question.replace(/\n+/g, ' ')}`, '')
    const answers = turn.answers
      .map(answer => replyBody(answer.content).trim())
      .filter(text => text !== '')
    if (answers.length > 0) lines.push(answers.join('\n\n'), '')
  })
  lines.push('— DeepSeek')
  return lines.join('\n')
}

/** The panel's locale accessor, already bound to the plugin namespace. */
export type PickerTr = (key: string, values?: Record<string, string>) => string

export interface QaPickerProps {
  /** Every turn of the conversation, in order. */
  turns: readonly QaTurn[]
  /** The turn ids currently selected. */
  selected: ReadonlySet<string>
  /** Press either half of one turn: the whole turn follows (see the module note). */
  onToggle: (turnId: string) => void
  /** 全选. */
  onAll: () => void
  /** 全不选. */
  onNone: () => void
  /** Which feature is asking — 分享 refuses a turn the page cannot share. */
  mode: 'share' | 'export'
  /** How an answer row is labelled (the panel's own model label). */
  answerLabel: string
  /** Locale accessor. */
  tr: PickerTr
}

/**
 * The list itself: a 全选 row, then one block per turn.
 *
 * The all/none control is a checkbox in the reader's sense — a button with
 * `role="checkbox"` and `aria-checked` — and both faces of a turn are too, so a
 * screen reader hears the same binding the pointer sees.
 *
 * @param props - see {@link QaPickerProps}.
 */
export function QaPicker(props: QaPickerProps): ReactNode {
  const { turns, selected, onToggle, tr, mode } = props
  const offered = selectableTurns(turns, mode)
  const chosen = offered.filter(turn => selected.has(turn.id))
  const allOn = offered.length > 0 && chosen.length === offered.length
  return createElement(
    'div',
    { className: 'dsh-dschat-qa' },
    createElement(
      'div',
      { className: 'dsh-dschat-qa-head' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-qa-all',
          role: 'checkbox',
          'aria-checked': allOn,
          'data-on': allOn ? 'true' : undefined,
          disabled: offered.length === 0,
          onClick: () => { (allOn ? props.onNone : props.onAll)() },
        },
        createElement('span', { className: 'dsh-dschat-qa-box', 'aria-hidden': 'true' },
          allOn ? createElement(CheckIcon, { size: 9 }) : null),
        tr('qa.all'),
      ),
      createElement(
        'span',
        { className: 'dsh-dschat-qa-count' },
        tr('qa.count', { count: String(chosen.length) }),
      ),
    ),
    offered.length === 0
      ? createElement('p', { className: 'dsh-dschat-qa-empty' }, tr(mode === 'share' ? 'qa.empty.share' : 'qa.empty.export'))
      : createElement(
          'div',
          { className: 'dsh-dschat-qa-list dsh-dschat-scroll' },
          offered.map((turn, index) => {
            const on = selected.has(turn.id)
            return createElement(
              'div',
              {
                key: turn.id,
                className: 'dsh-dschat-qa-turn',
                'data-on': on ? 'true' : undefined,
              },
              createElement(
                'span',
                { className: 'dsh-dschat-qa-index', 'aria-hidden': 'true' },
                String(index + 1),
              ),
              createElement(
                'div',
                { className: 'dsh-dschat-qa-rows' },
                turn.question !== undefined && createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-dschat-qa-row',
                    role: 'checkbox',
                    'aria-checked': on,
                    'data-on': on ? 'true' : undefined,
                    onClick: () => onToggle(turn.id),
                  },
                  createElement('span', { className: 'dsh-dschat-qa-box', 'aria-hidden': 'true' },
                    on ? createElement(CheckIcon, { size: 9 }) : null),
                  createElement('span', { className: 'dsh-dschat-qa-who' }, tr('msg.you')),
                  createElement('span', { className: 'dsh-dschat-qa-text' },
                    turn.questionLine === '' ? tr('qa.blank') : turn.questionLine),
                ),
                /*
                 * Every answer of the turn, each its own row and each bound to
                 * the same flag: a regenerated turn (two answers on disk, see
                 * the store's merge) is one turn to the reader, and export must
                 * not lose the older text silently.
                 */
                turn.answers.map((answer, answerIndex) => createElement(
                  'button',
                  {
                    key: answer.id,
                    type: 'button',
                    className: 'dsh-dschat-qa-row dsh-dschat-qa-row-answer',
                    role: 'checkbox',
                    'aria-checked': on,
                    'data-on': on ? 'true' : undefined,
                    'data-unfinished': answer.streaming === true ? 'true' : undefined,
                    onClick: () => onToggle(turn.id),
                  },
                  createElement('span', { className: 'dsh-dschat-qa-box', 'aria-hidden': 'true' },
                    on ? createElement(CheckIcon, { size: 9 }) : null),
                  createElement('span', { className: 'dsh-dschat-qa-who' }, props.answerLabel),
                  createElement('span', { className: 'dsh-dschat-qa-text' },
                    answer.streaming === true && answerIndex === turn.answers.length - 1
                      ? tr('qa.streaming')
                      : (turn.answerLines[answerIndex] === '' || turn.answerLines[answerIndex] === undefined
                          ? tr('qa.blank')
                          : turn.answerLines[answerIndex])),
                )),
              ),
            )
          }),
        ),
  )
}
