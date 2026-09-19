import { strToU8, zipSync } from 'fflate';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseBackup } from '../lib/storage/backup.ts';
import { importCompatiblePetPack, type PetCrop } from '../lib/pets/codex.ts';
import { frameIndex, petLimits } from '../lib/pets/contracts.ts';
import { normalizePetPreferences } from '../lib/pets/package.ts';
import { readPetZip } from '../lib/pets/zip.ts';
import { createEmptyHubState } from '../lib/state/empty.ts';
const read = (p: string) =>
  new Uint8Array(readFileSync(new URL(p, import.meta.url)));
const frame = read('./fixtures/codex-frame.png');
const v2 = read('../public/pets/codex-template.zip');
const v1 = read('./fixtures/codex-v1.zip');
const crop = async (_bytes: Uint8Array, rectangles: PetCrop[]) =>
  rectangles.map(() => frame);
function repack(zip: Uint8Array, patch: Record<string, unknown>) {
  const files = readPetZip(zip, { ...petLimits, imageBytes: 20 * 1024 * 1024 });
  const config = JSON.parse(new TextDecoder().decode(files.get('pet.json')));
  files.set('pet.json', strToU8(JSON.stringify({ ...config, ...patch })));
  return zipSync(Object.fromEntries(files));
}

test('Codex v1/v2 layouts map idle, running and waving with original frame durations', async () => {
  for (const [version, zip] of [
    [1, v1],
    [2, v2],
  ] as const) {
    let crops: PetCrop[] = [];
    const pack = await importCompatiblePetPack(
      zip,
      async (bytes, rectangles) => {
        crops = rectangles;
        return crop(bytes, rectangles);
      },
    );
    assert.equal(pack.source, 'codex-v' + version);
    assert.equal(pack.name, '邮差小猫');
    assert.equal(crops.length, 16);
    assert.deepEqual(crops[0], { x: 0, y: 0, width: 192, height: 208 });
    assert.equal(crops[6].y, 7 * 208);
    assert.equal(crops[12].y, 3 * 208);
    assert.equal(crops[15].x, 3 * 192);
    assert.equal(pack.animations.idle.frames.length, 6);
    assert.equal(pack.animations.drag?.frames.length, 6);
    assert.equal(pack.animations.mail?.frames.length, 4);
    assert.equal(frameIndex(pack.animations.idle, 1679), 0);
    assert.equal(frameIndex(pack.animations.idle, 1680), 1);
    assert.equal(frameIndex(pack.animations.idle, 6600), 0);
    assert.equal(frameIndex(pack.animations.drag!, 600), 5);
    assert.equal(frameIndex(pack.animations.drag!, 820), 0);
    const saved = { schemaVersion: 1, active: 'custom', custom: pack };
    assert.strictEqual(normalizePetPreferences(saved), saved);
    const backup = parseBackup(
      JSON.stringify({
        format: 'context-hub-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        entries: [
          { key: 'hub-state-v1', value: createEmptyHubState() },
          { key: 'pet-preferences-v1', value: saved },
        ],
      }),
    );
    assert.deepEqual(backup.entries[1].value, saved);
  }
});

test('Codex defaults and wrapped directories work, while unsupported versions and unsafe paths fail before cropping', async () => {
  const files = readPetZip(v1, { ...petLimits, imageBytes: 20 * 1024 * 1024 });
  const config = { id: 'test-cat', spritesheetPath: 'spritesheet.png' };
  files.set('pet.json', strToU8(JSON.stringify(config)));
  const wrapped = zipSync(
    Object.fromEntries([...files].map(([k, v]) => ['cat/' + k, v])),
  );
  assert.equal((await importCompatiblePetPack(wrapped, crop)).name, 'test-cat');
  let called = false;
  const unexpected = async () => {
    called = true;
    return [];
  };
  for (const patch of [
    { spriteVersionNumber: 3 },
    { spriteVersionNumber: 1 },
    { spritesheetPath: 'https://example.com/pet.png' },
    { spritesheetPath: '../pet.png' },
    { spritesheetPath: 'missing.png' },
  ])
    await assert.rejects(
      importCompatiblePetPack(repack(v2, patch), unexpected),
    );
  assert.equal(called, false);
  await assert.rejects(
    importCompatiblePetPack(v2, async () => []),
    /拆帧/,
  );
  const directory = zipSync({
    'pet.json': strToU8(
      JSON.stringify({
        schemaVersion: 1,
        name: 'old',
        animations: { idle: { directory: 'idle', fps: 6, loop: true } },
      }),
    ),
    'idle/001.png': frame,
  });
  await assert.rejects(
    importCompatiblePetPack(directory, unexpected),
    /Codex 图集模板/,
  );
  assert.equal(called, false);
});

test('saved timing is bounded and must match image count', async () => {
  const pack = await importCompatiblePetPack(v2, crop);
  for (const durations of [[-1], [], [Infinity], [10001], Array(6).fill(0)]) {
    const bad = structuredClone(pack);
    bad.animations.idle.durationsMs = durations;
    assert.throws(() =>
      normalizePetPreferences({
        schemaVersion: 1,
        active: 'custom',
        custom: bad,
      }),
    );
  }
  const once = { ...pack.animations.mail!, loop: false };
  assert.equal(frameIndex(once, 10000), 3);
});
