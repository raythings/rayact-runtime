/**
 * @rayact/crypto — `crypto.getRandomValues` + `crypto.randomUUID` polyfill.
 *
 * React 19's reconciler calls `crypto.getRandomValues` for fiber IDs / hook
 * bookkeeping, and the web API `crypto.randomUUID` is referenced by lots of
 * user code. QuickJS doesn't expose a crypto global, so we install one at
 * import time. The entropy is stdlib `rand()` — fine for non-cryptographic
 * IDs; NOT a CSPRNG, do not use for security-sensitive purposes.
 *
 * Importing this module for its side effect is enough — no exports.
 */

declare const globalThis: {
  crypto?: Crypto;
} & Record<string, unknown>;

interface Crypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?(): string;
}

const existing = (globalThis.crypto as Crypto | undefined) ?? null;
if (!existing || typeof existing.getRandomValues !== 'function') {
  const crypto: Crypto = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < view.length; i++) {
        view[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
    randomUUID(): string {
      const b = new Uint8Array(16);
      this.getRandomValues(b);
      // RFC 4122 v4 marker bits.
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex: string[] = [];
      for (let i = 0; i < 16; i++) hex.push(b[i].toString(16).padStart(2, '0'));
      return (
        hex.slice(0, 4).join('') + '-' +
        hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' +
        hex.slice(8, 10).join('') + '-' +
        hex.slice(10, 16).join('')
      );
    }
  };
  globalThis.crypto = crypto;
}

export {};
