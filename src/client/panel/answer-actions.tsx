/**
 * The controls under one message — the row chat.deepseek.com puts under each of
 * its answers.
 *
 * It lives in its own module for two reasons that point the same way:
 *
 *   1. it is the most testable part of the panel. Order is the CONTRACT here
 *      (see the index note below), and an assertion about it should not need a
 *      rendered transcript, a snapshot or a browser — so the row is a pure
 *      function of its props and the tests call it directly.
 *   2. it is the one place the panel's copy of the web page's own control set is
 *      written down. Keeping that in one file, next to the note about which
 *      index the host clicks, is what stops the two halves drifting apart.
 *
 * The web page's row is 复制 · 重新生成 · 喜欢 · 不喜欢 · 朗读 · 分享, and this
 * plugin carries all of it EXCEPT 朗读 — the panel has no audio surface, and a
 * reading button that produced no sound would be worse than no button. The two
 * additions after 分享 are the panel's own (复制思考过程, 引用到输入框): the web
 * quotes by selecting text, and a reasoner's working is one click away here.
 *
 * THE ORDER IS ALSO THE WIRE PROTOCOL. The page's buttons carry no label this
 * engine can match on (`aria-label` exists only on 朗读; the names live in a
 * tooltip that appears on hover), so `DeepSeekWebEngine.reactInner` presses them
 * by index — 2 for 喜欢, 3 for 不喜欢. That is why this module renders the same
 * six controls in the same positions as the page rather than inventing a nicer
 * order, and why a control this plugin does not carry must still leave a gap
 * rather than close it up.
 *
 * WHILE THE ANSWER IS STILL ARRIVING THERE IS NO ROW AT ALL (`arriving`). The
 * page's own toolbar is part of a FINISHED answer; a reply that is still
 * streaming here used to carry a full row under text that was still being
 * written — 复制 could take half a sentence, 分享 could publish a turn that did
 * not exist yet on the page, and the row was already disclaiming 重新生成 as
 * 「正在生成，稍后再试」 for a button whose only honest state was "not yet".
 * Rendering nothing (rather than a CSS-hidden row) is deliberate: a hidden
 * button is still focusable and still announced.
 */

import { createElement, type ReactNode } from 'react'
import {
  CopyIcon, PencilIcon, QuoteIcon, RegenerateIcon, ShareIcon, ThinkIcon, ThumbIcon,
} from '../icons.tsx'

/** What one answer currently shows for 喜欢 / 点踩 (`undefined` = no rating). */
export type Reaction = 'like' | 'dislike' | undefined

/**
 * The reason a 点踩 carries.
 *
 * The web page does not rate on the click: 不喜欢 opens a 反馈 dialog with four
 * required reasons and only submits on 提交, so the panel has to ask and send
 * both. These four are the dialog's own options (see the engine's dialog note).
 */
export type FeedbackReason = 'harmful' | 'false' | 'unhelpful' | 'other'

/** One control in the row. */
export interface MessageAction {
  /** Stable React key; also what the tests read the order from. */
  key: string
  /** Tooltip and accessible name. When the control is disabled this is the WHY. */
  title: string
  icon: ReactNode
  run: () => void
  /** Rendered but not pressable (the page answers one question at a time). */
  disabled?: boolean
  /** Showing its own working state — the glyph spins. */
  busy?: boolean
  /** Chosen (点赞 / 点踩), which the stylesheet paints. */
  on?: boolean
  /** A hairline between groups, not a control. */
  separator?: true
}

/** Everything the row needs to describe one message's actions. */
export interface MessageActionsProps {
  /** True for the reader's own turn, which gets a different set. */
  isUser: boolean
  /** The answer (or the message) itself, already pasted for the clipboard. */
  reply: string
  /** The reasoning, empty when there is none to copy. */
  thinking: string
  /** The first line of the answer, empty when there is nothing to quote. */
  quoted: string
  /** The whole exchange, for 分享 (see `shareText`). */
  share: string
  /** Locale accessor, already bound to the plugin namespace. */
  tr: (key: string, values?: Record<string, string>) => string
  /** True while the page is generating — 重新生成 has to wait for it. */
  busy: boolean
  /**
   * True while THIS answer is still arriving — the stream has not stopped.
   *
   * Not the same flag as `busy`, and deliberately so: `busy` is the panel-wide
   * "a turn is in flight" (an OLD answer's 重新生成 is disabled while a new one
   * generates, but its own row is complete and stays). This one is the message's
   * own state, and it is the difference between "the controls are unavailable"
   * and "there are no controls yet".
   */
  arriving: boolean
  /** The answer currently being regenerated, if any. */
  regeneratingId: string | undefined
  /** This message's id, which is what `regeneratingId` is compared against. */
  messageId: string
  /** The rating this message currently shows. */
  reaction: Reaction
  /** The message whose rating is being sent, if any. */
  feedbackId: string | undefined
  onCopyReply: () => void
  onCopyThinking: () => void
  onQuote: () => void
  onEdit: () => void
  onShare: () => void
  onRegenerate: () => void
  onLike: () => void
  /**
   * Press 不喜欢. The panel opens its 反馈 form rather than sending immediately
   * (the web page requires a reason), so this is NOT the submit.
   */
  onDislike: () => void
}

/**
 * Build the ordered list of controls for one message.
 *
 * Exported because the ORDER is what the host's index-based click depends on:
 * the test that guards the two staying in step reads this list rather than a
 * rendered row, so it fails on a reorder even if the markup would look fine.
 *
 * @param props - the message's actions and state.
 * @returns the controls, in the order the row renders (and the page's own order).
 */
export function messageActions(props: MessageActionsProps): MessageAction[] {
  const { tr, isUser } = props
  if (isUser) {
    return [
      { key: 'copy', title: tr('msg.copy'), icon: createElement(CopyIcon, {}), run: props.onCopyReply },
      { key: 'edit', title: tr('msg.edit'), icon: createElement(PencilIcon, {}), run: props.onEdit },
    ]
  }
  return [
    { key: 'copy', title: tr('msg.copy'), icon: createElement(CopyIcon, {}), run: props.onCopyReply },
    {
      key: 'regenerate',
      /*
       * The title doubles as the reason when the control is unavailable: the page
       * answers one question at a time, so 重新生成 waits for the running turn —
       * and a disabled button with no explanation is exactly the kind of thing
       * reported as "坏了".
       */
      title: props.regeneratingId === props.messageId
        ? tr('msg.regenerating')
        : (props.busy ? tr('msg.regenerate.busy') : tr('msg.regenerate')),
      icon: createElement(RegenerateIcon, {}),
      run: props.onRegenerate,
      disabled: props.busy || props.regeneratingId !== undefined,
      busy: props.regeneratingId === props.messageId,
    },
    {
      key: 'like',
      title: props.reaction === 'like' ? tr('msg.like.on') : tr('msg.like'),
      icon: createElement(ThumbIcon, { filled: props.reaction === 'like' }),
      run: props.onLike,
      disabled: props.feedbackId !== undefined,
      on: props.reaction === 'like',
    },
    {
      key: 'dislike',
      title: props.reaction === 'dislike' ? tr('msg.dislike.on') : tr('msg.dislike'),
      icon: createElement(ThumbIcon, { down: true, filled: props.reaction === 'dislike' }),
      run: props.onDislike,
      disabled: props.feedbackId !== undefined,
      on: props.reaction === 'dislike',
    },
    { key: 'share', title: tr('msg.share'), icon: createElement(ShareIcon, {}), run: props.onShare },
    /*
     * The boundary between the page's own five controls and this panel's two
     * extras. Nothing was removed for it: each of the seven acts on different
     * text (the answer, the page's turn, the account's rating, the exchange, the
     * reasoning, the composer), so the row had no true duplicate — what it lacked
     * was a way to SEE that the last two are this plugin's own. The stylesheet
     * draws it as a hairline, and it is a list item so the flex gap spaces it like
     * every other control.
     */
    { key: 'sep', title: '', icon: null, run: () => undefined, separator: true },
    ...(props.thinking === ''
      ? []
      : [{
          key: 'copy-thinking',
          title: tr('msg.copyThinking'),
          icon: createElement(ThinkIcon, {}),
          run: props.onCopyThinking,
        }]),
    ...(props.quoted === ''
      ? []
      : [{
          key: 'quote',
          title: tr('msg.quote'),
          icon: createElement(QuoteIcon, {}),
          run: props.onQuote,
        }]),
  ]
}

/**
 * The row itself.
 *
 * `data-mod` is what the stylesheet keys its two placements off: the answer's row
 * is part of the message's own flow (directly under the answer, always there),
 * while the reader's bubble keeps the hover row it has always had. `disabled`
 * and `data-busy` are real attributes rather than classes so the browser owns the
 * click rejection and the accessible state; the stylesheet only paints them.
 *
 * `overlay` is a SLOT rather than more props: it is a whole form the panel owns
 * (each has state of its own, and an effect that listens for Escape), and the only
 * thing this row has to do with it is be its positioned ancestor. Passing it in
 * keeps the row a pure function of its props while still letting the form open
 * upward from the exact row it belongs to. Only one is ever open, and which one
 * is the PANEL's decision — the row does not know what 反馈 or 分享 mean.
 *
 * @param props - see {@link MessageActionsProps}.
 */
export function MessageActions(props: MessageActionsProps & { overlay?: ReactNode }): ReactNode {
  /*
   * An answer that has not finished arriving has no controls yet — see the
   * `arriving` note at the top of this file. Returning null (rather than a row
   * the stylesheet fades out) is the whole point: 复制 on a half-written reply,
   * or a 分享 whose turn the page does not have yet, are actions that must not
   * be reachable, not actions that must merely be hard to see. A hidden button is
   * still tab-focusable and still announced.
   *
   * The gate sits HERE rather than in `messageActions` because that function is
   * the ORDER contract — what the row contains once it exists — and a caller
   * asking it for the order of a row that does not exist would only get a list it
   * must not render.
   */
  if (props.arriving) return null
  const actions = messageActions(props)
  return createElement(
    'div',
    { className: 'dsh-dschat-msg-acts', 'data-mod': props.isUser ? 'user' : 'answer' },
    actions.map(action => (action.separator === true
      ? createElement('span', { key: action.key, className: 'dsh-dschat-msg-acts-sep', 'aria-hidden': 'true' })
      : createElement(
          'button',
          {
            key: action.key,
            type: 'button',
            title: action.title,
            'aria-label': action.title,
            'data-on': action.on === true ? 'true' : undefined,
            'data-busy': action.busy === true ? 'true' : undefined,
            disabled: action.disabled === true || action.busy === true,
            onClick: action.run,
          },
          action.icon,
        ))),
    props.overlay,
  )
}
