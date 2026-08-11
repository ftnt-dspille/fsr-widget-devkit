// Types for lib/chatCapture.js. The recorder stays plain JS because the live
// specs and matrix rows that use it are plain JS; this declaration is what lets
// the TypeScript drivers import it without going implicit-any.

export interface ChatPayload {
  op: string;
  params: unknown | null;
  response: unknown;
}

export interface ChatCaptureOpts {
  /** Which requests to watch. Default: /integration\/execute/ */
  urlPattern?: RegExp;
  /** Which operations to record. Default: /^chat_/ */
  opPattern?: RegExp;
  /** How long settle() waits for in-flight response bodies. Default 15000ms. */
  timeoutMs?: number;
}

export interface ChatCapture {
  payloads: ChatPayload[];
  /** Drain in-flight response handlers, then return everything recorded. */
  settle(ms?: number): Promise<ChatPayload[]>;
  /** How many response bodies are still resolving. */
  pending(): number;
}

export declare const DEFAULT_SETTLE_MS: number;

/**
 * `page` is anything with `.on` -- a real Playwright Page, or the minimal fake
 * the unit tests drive it with. Typed loosely on purpose: Playwright's `on` is
 * a heavily overloaded signature that no structural subtype can satisfy, and
 * pinning it here would only force a cast at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function createChatCapture(
  page: { on: (...args: any[]) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  opts?: ChatCaptureOpts,
): ChatCapture;
