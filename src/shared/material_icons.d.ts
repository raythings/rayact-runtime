/** Side-effect module: sets `globalThis.Icons` (Material Symbols name → codepoint). */
export {};

declare global {
  // eslint-disable-next-line no-var
  var Icons: Record<string, number>;
}
