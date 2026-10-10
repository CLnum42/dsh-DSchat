/**
 * Stand-ins for the harness packages the host half imports.
 *
 * The real packages resolve only inside a running harness, so the offline smoke
 * test aliases them here. Only the surface the plugin actually touches is
 * modelled: tool definition, LLM message construction, and the session
 * constants the transfer seeds with.
 *
 * Every export here must mirror a real export of the aliased package. A stub
 * that invents a name the harness does not export hides a link-time SyntaxError
 * that only shows up as "failed to import" inside the running harness.
 */

export function defineTool(spec: unknown): unknown {
  return spec
}

export const BlockAssembler = class {
  blocks: unknown[] = []
  push(block: unknown): void { this.blocks.push(block) }
  build(): unknown[] { return this.blocks }
}

export function createUserMessage(text: string): { role: string; content: string } {
  return { role: 'user', content: text }
}

export const SESSION_FORMAT_VERSION = 1

export function SessionId(value: string): string {
  return value
}

/**
 * The session-position brand.
 *
 * The real `@deepseek-ai/dsh-session` exports this as an identity function whose
 * only job is to make a plain number into an opaque `SessionSeq`; the transfer
 * path brands every seq it writes, so the stub has to provide it or the
 * smoke test cannot import the module under test at all.
 */
export function SessionSeq(value: number): number {
  return value
}

export const chromium = {
  launch: async (): Promise<never> => { throw new Error('browser launch is not exercised by the offline smoke test') },
}
