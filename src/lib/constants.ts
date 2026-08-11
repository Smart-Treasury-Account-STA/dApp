/**
 * Approximate Stellar ledger close time, in seconds. Used to convert
 * wall-clock durations into ledger-count offsets for schedule windows.
 *
 * Deliberately has no dependency on `@/config` (and therefore no env
 * validation) so pure modules like `@/features/treasury/drafts` can import it
 * without dragging `NEXT_PUBLIC_*` validation into their test suite.
 */
export const LEDGER_CLOSE_SECONDS = 5;
