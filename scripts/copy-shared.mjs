// Copy the non-TS shared assets into dist. Runs after tsc (even when tsc
// reported transient type errors — it still emits), and fails loudly if the
// assets are missing so a broken pack can't ship silently.
import fs from 'node:fs';
fs.mkdirSync('dist/shared', { recursive: true });
for (const f of ['material_icons.js', 'material_icons.d.ts']) {
  fs.copyFileSync(`src/shared/${f}`, `dist/shared/${f}`);
}
console.log('copied shared assets into dist/shared');
