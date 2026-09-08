import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as floating from '../lib/floating-position.ts';

void test('dragging beyond a screen edge keeps the whole pet reachable', () => {
  assert.deepEqual(
    floating.fitPetPosition({ x: 999, y: -60 }, { width: 320, height: 600 }),
    { x: 244, y: 12 },
  );
});
void test('keyboard viewport and zoom offsets keep the pet inside the visible area', () => {
  assert.deepEqual(
    floating.fitPetPosition(
      { x: 900, y: 800 },
      { width: 320, height: 300, left: 20, top: 100 },
    ),
    { x: 264, y: 324 },
  );
});
void test('a saved position stays unchanged when it is already on screen', () => {
  assert.deepEqual(
    floating.fitPetPosition({ x: 120, y: 210 }, { width: 800, height: 600 }),
    { x: 120, y: 210 },
  );
});
