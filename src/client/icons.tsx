/**
 * Inline icon set for the DSchat panel.
 *
 * The host does not expose its own icon package to plugins (and importing one
 * is explicitly unsupported), so every glyph is a self-contained 16px stroke
 * SVG drawn with `currentColor` to inherit the surrounding token colour.
 */

import type { ReactNode } from 'react'

/** Shared props: size defaults to the 16px host control rhythm. */
export interface IconProps {
  /** Rendered square edge in pixels. */
  size?: number
}

/**
 * Default stroke for the panel's outline glyphs.
 *
 * 1.25 on the 16-box these paths are drawn in. The host's own icon set
 * (`@deepseek-ai/dsh-client-ui-primitives`) uses exactly two weights on that
 * box — `ICON_REGULAR_STROKE = 1` for glyphs that sit inside text, and
 * `ICON_MEDIUM_STROKE = 1.3` for standalone controls — so the panel's 1.4 read
 * as a heavier hand than the sidebar and header icons next to it. 1.25 keeps
 * DSchat on the host's medium grid (at 16px it lands on whole pixels the same
 * way 1.3 does) without going as light as the in-text regular weight.
 *
 * Glyphs that deliberately KEEP their own weight say so where they are set: a
 * plus, a tick, a caret and a close cross are markers rather than pictures, and
 * stay legible at 10–14px only because they are drawn heavier.
 */
const STROKE = 1.25

function svg(size: number, children: ReactNode, extra?: Record<string, unknown>): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...extra}
    >
      {children}
    </svg>
  )
}

/**
 * DSchat mark: the sidebar panel glyph (also the panel's empty-state mark).
 *
 * Geometry is the one `icon.svg` ships in the package manifest, scaled from
 * that file's 36-box onto this 16-box — the sidebar row and the plugin list
 * must show the same mark, or the entry looks like two different plugins. The
 * whole glyph is {@link STROKE} on this box, which is the host's own weight for
 * standalone controls (`ICON_MEDIUM_STROKE = 1.3`), so it sits with the
 * pinwheel, the folder and the search glyph in the same column.
 */
export function ChatIcon({ size = 16 }: IconProps): ReactNode {
  return svg(size, <>
    <path d="M3.1 3.6h9.8a1.3 1.3 0 0 1 1.3 1.3v5.3a1.3 1.3 0 0 1-1.3 1.3H7.5l-3.1 2.6v-2.6H3.1a1.3 1.3 0 0 1-1.3-1.3V4.9a1.3 1.3 0 0 1 1.3-1.3Z" />
    <path d="M5.5 6.6h5.4M5.5 9h3.2" />
  </>)
}

/**
 * The DeepSeek whale mark — the header's product mark and its state lamp.
 *
 * THIS IS THE HOUSE ARTWORK, not an imitation of it: the path and the viewBox
 * are copied verbatim from `FishLogo` in the shell's own
 * `@deepseek-ai/dsh-client-ui-primitives` (`FISH_LOGO_PATH` /
 * `FISH_LOGO_VIEWBOX`). A plugin may not import that package, so the
 * geometry is reproduced here — an approximation would sit next to the shell's
 * real logo in the same window and read as a knock-off.
 *
 * Filled, not stroked: the header's other three controls are outlines on a 1.4
 * stroke grid, and the whale drawn that way looked like a fourth control. The
 * interior details (the flipper, the eye) are part of the one path, so a single
 * `currentColor` fill leaves them as holes — which is what lets the mark be
 * recoloured to carry the engine state without a second shape. NO added eye dot:
 * it would paint over the artwork's own.
 *
 * The viewBox is none of the 16-box grid the other icons share — it is the
 * artwork's native 23.16x17.04, so the fish is never distorted.
 */
export const WHALE_PATH =
  'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

/** Native viewBox of {@link WHALE_PATH}; the height follows the artwork's ratio. */
const WHALE_VIEWBOX = { width: 23.16, height: 17.04 }

/**
 * Rendered height for a requested width, rounded to two decimals.
 *
 * The raw ratio produces strings like `13.979274611398964`, which is noise in
 * the DOM and in every snapshot of it; a hundredth of a pixel is far below
 * anything a display can show.
 *
 * @param width - the requested mark width in px.
 */
function whaleHeight(width: number): number {
  return Math.round((width * WHALE_VIEWBOX.height / WHALE_VIEWBOX.width) * 100) / 100
}

export function WhaleMark({ size = 19 }: IconProps): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${WHALE_VIEWBOX.width} ${WHALE_VIEWBOX.height}`}
      width={size}
      height={whaleHeight(size)}
      fill="none"
      stroke="none"
      aria-hidden="true"
    >
      <path d={WHALE_PATH} fill="currentColor" />
    </svg>
  )
}

export function SearchIcon({ size = 13 }: IconProps): ReactNode {
  return svg(size, <><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L13.5 13.5" /></>)
}

/**
 * 会话列表: three rules, the universal "open the list" glyph.
 *
 * It replaced a panel-with-gutter (`HistoryIcon`), and the reason is the change
 * the icon is reporting rather than a matter of taste: that glyph draws a SIDE
 * COLUMN, so it promised a sidebar — and pressing it produced a dialog that
 * covers the transcript. A glyph that draws the wrong half of the screen is
 * worse than no glyph, because the reader has already decided what the click
 * will do before making it. Three rules make no such promise: they say "there
 * is a list behind this", which is exactly what is there (and what every chat
 * app from the web app to the platforms draws for the same control).
 *
 * The three strokes are 11px wide on a 16-box with 3.5px of air between them —
 * measured against {@link SearchIcon} (7px circle) and {@link MoreIcon} (three
 * dots) in the same header, so the strip keeps one optical weight.
 */
export function MenuIcon({ size = 16 }: IconProps): ReactNode {
  return svg(size, <path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8" />)
}

/** Heavier than {@link STROKE} on purpose: a 14px plus is a marker, not a picture. */
export function PlusIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <path d="M8 3.2v9.6M3.2 8h9.6" />, { strokeWidth: 1.5 })
}

export function RefreshIcon({ size = 13 }: IconProps): ReactNode {
  return svg(size, <><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" /><path d="M13.4 2.2v3.1h-3.1" /></>)
}

export function PencilIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <path d="M11.3 2.4l2.3 2.3L5.4 12.9H3.1v-2.3z" />)
}

export function TrashIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <><path d="M2.8 4.2h10.4M6.6 4.2V2.8h2.8v1.4M4.2 4.2l.6 9h6.4l.6-9" /></>)
}

/**
 * The tick that marks a settings row's state, at 10px.
 *
 * Heavier than {@link STROKE} because at 10px a 1.25 stroke renders as a
 * hairline that reads as "nothing here" rather than as a state.
 */
export function CheckIcon({ size = 10 }: IconProps): ReactNode {
  return svg(size, <path d="M3 8.6L6.3 12 13 4.6" />, { strokeWidth: 1.8 })
}

export function WarnIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <><path d="M8 2.6l5.6 10.2H2.4z" /><path d="M8 6.4v3.1M8 11.4v.1" /></>)
}

/** Same reasoning as {@link CheckIcon}: a 10px cross has to stay a cross. */
export function CloseIcon({ size = 10 }: IconProps): ReactNode {
  return svg(size, <path d="M4 4l8 8M12 4l-8 8" />, { strokeWidth: 1.7 })
}

export function CopyIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <><rect x="5.6" y="2.6" width="7.8" height="9.2" rx="1.4" /><path d="M10.4 13.4H4.2a1.6 1.6 0 0 1-1.6-1.6V5.2" /></>)
}

export function QuoteIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <><path d="M4 3.5v9M8.5 5.2h4.5M8.5 8h4.5M8.5 10.8h3" /><path d="M6.2 6.6L4 4.4 6.2 2.2" /></>)
}

/**
 * Reasoning glyph, for the "copy the thinking process" action.
 *
 * A speech bubble with a curl inside: distinct at 14px from both CopyIcon
 * (a page) and QuoteIcon (lines with an arrow), which sit in the same row.
 */
export function ThinkIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <><path d="M13.4 9.6a1.4 1.4 0 0 1-1.4 1.4H6.2L3 13.4V3.4A1.4 1.4 0 0 1 4.4 2h7.6a1.4 1.4 0 0 1 1.4 1.4z" /><path d="M6.4 7.6c1.1-1.9 2.1-1.9 3.2 0" /></>)
}

/**
 * 深度思考 — the web app's own toggle glyph: a nucleus with two orbits.
 *
 * Lifted verbatim from chat.deepseek.com's composer (same 16-box geometry, same
 * 1.4 stroke), so the panel's switch is recognisably the same control as the
 * page's. It replaced a lightning bolt, which said "fast" where the web says
 * "reason".
 */
export function DeepThinkIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <>
    <circle cx="8" cy="8" r="1.23" fill="currentColor" stroke="none" />
    <path d="M10.51 10.51C7.3 13.71 3.58 15.19 2.2 13.8 0.81 12.42 2.29 8.7 5.49 5.49 8.7 2.29 12.42 0.81 13.8 2.2 15.19 3.58 13.71 7.3 10.51 10.51Z" />
    <path d="M10.73 5.27C13.94 8.47 15.31 12.29 13.8 13.8 12.29 15.31 8.48 13.94 5.27 10.73 2.07 7.53 0.69 3.71 2.2 2.2 3.71 0.69 7.53 2.06 10.73 5.27Z" />
  </>)
}

/** 智能搜索 — the web app's globe, verbatim (same geometry and stroke). */
export function WebSearchIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <>
    <path d="M8 14.85C9.6 14.85 10.89 11.78 10.89 8 10.89 4.22 9.6 1.15 8 1.15" />
    <path d="M8 14.85C6.4 14.85 5.11 11.78 5.11 8 5.11 4.22 6.4 1.15 8 1.15" />
    <circle cx="8" cy="8" r="6.85" />
    <path d="M1.64 8h12.72" />
  </>)
}

/**
 * ClipIcon — the paperclip on the composer's attach control.
 *
 * The web app draws its attach glyph as a filled path (two nested strokes), and
 * at 16px next to the 34px send circle an outline version reads as a different
 * weight of ink. So this is that path, taken as-is; the single-stroke paperclip
 * that used to live here is gone with the text-labelled button it sat in.
 */
export function ClipIcon({ size = 15 }: IconProps): ReactNode {
  return svg(size, <path
    fill="currentColor"
    stroke="none"
    d="M5.55 9.75V5h1.4v4.75a1.05 1.05 0 0 0 2.1 0V4.5a2.8 2.8 0 1 0-5.6 0v5.25a4.55 4.55 0 0 0 9.1 0V4h1.4v5.75a5.95 5.95 0 0 1-11.9 0V4.5a4.2 4.2 0 1 1 8.4 0v5.25a2.45 2.45 0 0 1-4.9 0Z"
  />)
}

/**
 * SendIcon — the web app's submit arrow, verbatim.
 *
 * Filled, not stroked: the arrow is the only solid glyph left in the composer
 * once the pills are pills, and a stroke version at 16px came out visibly
 * lighter than the attach clip beside it.
 */
export function SendIcon({ size = 16 }: IconProps): ReactNode {
  return svg(size, <path
    fill="currentColor"
    stroke="none"
    d="M8.31 0.98a2.5 2.5 0 0 1 0.95 0.45c0.22 0.18 0.47 0.43 0.72 0.68l4.73 4.72-1.42 1.42L9 3.96v11.08H7V3.96L2.71 8.25 1.29 6.83l4.73-4.72c0.25-0.25 0.5-0.5 0.72-0.68a2.5 2.5 0 0 1 0.95-0.45 2.3 2.3 0 0 1 0.62 0Z"
  />, { fill: 'currentColor' })
}

/** A disclosure marker at 11px: slightly heavier than {@link STROKE} to stay readable. */
export function CaretIcon({ size = 11 }: IconProps): ReactNode {
  return svg(size, <path d="M3 4.8L6 7.8l3-3" />, { strokeWidth: 1.5 })
}

export function MoreIcon({ size = 16 }: IconProps): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <circle cx="3.6" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12.4" cy="8" r="1.15" />
    </svg>
  )
}

/**
 * Two arrows crossing: the 「DSH 迁移」 mark.
 *
 * A swap, not a cloud or a rocket: both migration modes take the conversation
 * OUT of this panel and put it somewhere else (a distilled brief, or a verbatim
 * replay), and two opposed arrows is the one shape that says "this goes over
 * there" without a longer word than the row can hold. Drawn on the same 16-box
 * stroke grid as the glyphs beside it, so the action row keeps one rhythm.
 */
export function SwapIcon({ size = 14 }: IconProps): ReactNode {
  return svg(size, <>
    <path d="M2.6 5.4h9.1" />
    <path d="M9.4 3.1l2.3 2.3-2.3 2.3" />
    <path d="M13.4 10.6H4.3" />
    <path d="M6.6 8.3l-2.3 2.3 2.3 2.3" />
  </>)
}

