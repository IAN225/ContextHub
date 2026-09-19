import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  workspacePalette,
  workspaceThemeClass,
} from '../lib/workspaces/theme.ts';
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}
test('all workspace themes keep readable text, clear actions and low-chroma large surfaces', () => {
  for (const [tone, p] of Object.entries(workspacePalette)) {
    for (const ink of [p.text, p.muted, p.heading, p.accent])
      for (const surface of [p.surface, p.subtle, p.soft])
        assert.ok(
          contrast(ink, surface) >= 4.5,
          tone + ' ' + ink + ' on ' + surface,
        );
    assert.ok(contrast('#fffefa', p.accent) >= 4.5, tone + ' primary button');
    for (const surface of [p.surface, p.subtle, p.canvas]) {
      const channels = rgb(surface);
      assert.ok(
        Math.max(...channels) - Math.min(...channels) < 0.07,
        tone + ' neutral surfaces',
      );
      assert.ok(luminance(surface) > 0.85, tone + ' light surfaces');
    }
  }
  assert.equal(workspaceThemeClass(), '');
  assert.equal(workspaceThemeClass('rose'), 'workspace-theme tone-rose');
});
test('CSS palette stays synchronized with the tested semantic colors', () => {
  const css = readFileSync(
    new URL('../components/theme/workspace-theme.css', import.meta.url),
    'utf8',
  );
  for (const [tone, p] of Object.entries(workspacePalette)) {
    const block = css.match(
      new RegExp('\\.workspace-theme\\.tone-' + tone + ' \\{([^}]+)\\}'),
    )?.[1];
    assert.ok(block);
    for (const [key, value] of Object.entries(p))
      assert.ok(
        block.includes(
          '--ui-' +
            key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) +
            ': ' +
            value,
        ),
      );
  }
});
