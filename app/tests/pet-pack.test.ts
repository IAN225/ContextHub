import { createBackup, parseBackup, restoreBackup } from '../lib/backup.ts';
import { createEmptyHubState } from '../lib/hub-state.ts';
import { createEntityRepository } from '../lib/storage/repository.ts';
import type { DataRepository, StorageEntry } from '../lib/repository.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { normalizePetPreferences } from '../lib/pets/package.ts';
import { imageDataUrl, imageInfo } from '../lib/pets/images.ts';
import {
  petAnimation,
  petState,
  frameIndex,
  defaultPetPreferences,
  PET_PREFERENCES_KEY,
  type PetPreferences,
  type PetPack,
} from '../lib/pets/contracts.ts';
import { readPetZip } from '../lib/pets/zip.ts';
import { createPersistentSession } from '../lib/persistent-session.ts';
import type { Repository } from '../lib/repository.ts';
const asset = (path: string) =>
  new Uint8Array(
    readFileSync(new URL('../public/pets/' + path, import.meta.url)),
  );
const png = asset('post-cat/idle/001.png'),
  png2 = asset('post-cat/idle/003.png');
const options = { fps: 6, loop: true };
function storedPack(): PetPack {
  return {
    schemaVersion: 1,
    name: '测试猫',
    animations: {
      idle: {
        ...options,
        frames: [png, png2].map((bytes) => ({
          src: imageDataUrl(bytes, 'image/png'),
          width: 96,
          height: 96,
        })),
      },
    },
  };
}
const manifest = {
  schemaVersion: 1,
  name: '测试猫',
  animations: { idle: options },
};
function archive(
  config: unknown = manifest,
  images: Record<string, Uint8Array> = { 'idle/001.png': png },
  prefix = '',
) {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        'pet.json': strToU8(JSON.stringify(config)),
        ...images,
      }).map(([k, v]) => [prefix + k, v]),
    ),
  );
}
function central(bytes: Uint8Array) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(bytes.length - 6, true);
}

test('previously saved frames remain readable without rewriting, and absent states fall back to idle', () => {
  const pack = storedPack();
  const saved = JSON.parse(
    JSON.stringify({ schemaVersion: 1, active: 'custom', custom: pack }),
  );
  assert.strictEqual(normalizePetPreferences(saved), saved);
  assert.strictEqual(petAnimation(pack, 'drag'), pack.animations.idle);
  assert.strictEqual(petAnimation(pack, 'mail'), pack.animations.idle);
  assert.equal(
    frameIndex(
      {
        ...pack.animations.idle,
        frames: pack.animations.idle.frames.slice(0, 1),
      },
      100000,
    ),
    0,
  );
});

test('press/drag wins over mail, release resumes mail, and animation timing respects fps and loop', () => {
  assert.equal(petState(false, false, 0), 'idle');
  assert.equal(petState(false, false, 2), 'mail');
  assert.equal(petState(true, false, 2), 'drag');
  assert.equal(petState(false, true, 2), 'drag');
  assert.equal(petState(false, false, 2), 'mail');
  const animation = storedPack().animations.idle;
  assert.equal(frameIndex(animation, 160), 0);
  assert.equal(frameIndex(animation, 170), 1);
  assert.equal(frameIndex(animation, 340), 0);
  assert.equal(frameIndex({ ...animation, loop: false }, 10000), 1);
});

test('stored schemas, options, frame dimensions and remote image URLs are validated', () => {
  const valid = { schemaVersion: 1, active: 'custom', custom: storedPack() };
  for (const mutate of [
    (v: typeof valid) => {
      v.schemaVersion = 2;
    },
    (v: typeof valid) => {
      v.custom.name = '';
    },
    (v: typeof valid) => {
      v.custom.animations.idle.fps = 31;
    },
    (v: typeof valid) => {
      v.custom.animations.idle.frames = [];
    },
    (v: typeof valid) => {
      v.custom.animations.idle.frames[0].src = 'https://example.com/pet.png';
    },
  ]) {
    const bad = structuredClone(valid);
    mutate(bad);
    assert.throws(() => normalizePetPreferences(bad));
  }
  const huge = png.slice();
  new DataView(huge.buffer).setUint32(16, 513);
  assert.throws(() => imageInfo(huge), /512/);
});

test('ZIP paths, duplicate names, damaged CRC, encryption and oversized expansion are rejected before image decoding', () => {
  for (const path of [
    '../escape.png',
    '/absolute.png',
    'idle/../escape.png',
    'idle\\escape.png',
    '__proto__/x.png',
  ])
    assert.throws(() => readPetZip(zipSync({ [path]: png })));
  assert.throws(
    () => readPetZip(zipSync({ 'idle/A.png': png, 'idle/a.png': png })),
    /重名/,
  );
  const damaged = archive(),
    d = new DataView(damaged.buffer);
  d.setUint32(central(damaged) + 16, 0, true);
  assert.throws(() => readPetZip(damaged), /校验/);
  const encrypted = archive(),
    e = new DataView(encrypted.buffer);
  e.setUint16(central(encrypted) + 8, 1, true);
  assert.throws(() => readPetZip(encrypted), /条目/);
  const oversized = archive(),
    o = new DataView(oversized.buffer);
  o.setUint32(central(oversized) + 24, 32 * 1024 * 1024, true);
  assert.throws(() => readPetZip(oversized), /过大/);
  assert.throws(() => readPetZip(archive().subarray(0, 50)));
});

test('account session saves selection and frames, restores builtin without deleting custom, and preserves active pet on failed writes', async () => {
  let storage: unknown;
  let fail = false;
  let writes = 0;
  const repository: Repository = {
    read: async (key) => {
      assert.equal(key, PET_PREFERENCES_KEY);
      return storage;
    },
    write: async (entries) => {
      if (fail) throw Error('offline');
      writes++;
      storage = structuredClone(entries[0].value);
    },
  };
  const session = () =>
    createPersistentSession<PetPreferences>(
      PET_PREFERENCES_KEY,
      defaultPetPreferences,
      repository,
      normalizePetPreferences,
    );
  const current = session();
  await current.load();
  const pack = storedPack();
  assert.equal(
    await current.commit({ schemaVersion: 1, active: 'custom', custom: pack }),
    true,
  );
  const anotherBrowser = session();
  const before = writes;
  await anotherBrowser.load();
  assert.equal(writes, before);
  assert.deepEqual(anotherBrowser.getSnapshot().value.custom, pack);
  fail = true;
  assert.equal(
    await anotherBrowser.commit({
      ...anotherBrowser.getSnapshot().value,
      active: 'builtin',
    }),
    false,
  );
  assert.equal(anotherBrowser.getSnapshot().value.active, 'custom');
  fail = false;
  assert.equal(
    await anotherBrowser.commit({
      ...anotherBrowser.getSnapshot().value,
      active: 'builtin',
    }),
    true,
  );
  const restored = session();
  await restored.load();
  assert.equal(restored.getSnapshot().value.active, 'builtin');
  assert.deepEqual(restored.getSnapshot().value.custom, pack);
  const otherAccount = createPersistentSession(
    PET_PREFERENCES_KEY,
    defaultPetPreferences,
    { read: async () => undefined, write: async () => {} },
    normalizePetPreferences,
  );
  await otherAccount.load();
  assert.equal(otherAccount.getSnapshot().value.custom, null);
});

test('personal JSON export and restore preserve pet assets through the production entity adapter', async () => {
  let entries: StorageEntry[] = [];
  const physical: DataRepository = {
    read: async (key) => entries.find((e) => e.key === key)?.value,
    entries: async () => structuredClone(entries),
    write: async (next) => {
      for (const entry of next)
        entries = [
          ...entries.filter((e) => e.key !== entry.key),
          structuredClone(entry),
        ];
    },
    replace: async (transform) => {
      entries = structuredClone(transform(entries));
    },
  };
  const repository = createEntityRepository(physical);
  const pet = {
    schemaVersion: 1,
    active: 'custom',
    custom: storedPack(),
  };
  await repository.write([
    { key: 'hub-state-v1', value: createEmptyHubState() },
    { key: PET_PREFERENCES_KEY, value: pet },
  ]);
  const exported = parseBackup(JSON.stringify(await createBackup(repository)));
  assert.deepEqual(
    exported.entries.find((e) => e.key === PET_PREFERENCES_KEY)?.value,
    pet,
  );
  await repository.write([
    { key: PET_PREFERENCES_KEY, value: defaultPetPreferences },
  ]);
  await restoreBackup(repository, exported);
  assert.deepEqual(await repository.read(PET_PREFERENCES_KEY), pet);
  const invalid = structuredClone(exported);
  (
    invalid.entries.find((e) => e.key === PET_PREFERENCES_KEY)!
      .value as PetPreferences
  ).custom!.animations.idle.frames[0].src = 'https://example.com/external.png';
  assert.throws(() => parseBackup(JSON.stringify(invalid)));
});

test('static lossy and lossless WebP frames import with their original bytes', () => {
  for (const base64 of [
    'UklGRrYAAABXRUJQVlA4WAoAAAAQAAAABwAABwAAQUxQSEEAAAAAAAkOAAAOCQAAoPQTE/SgAACn/+7u/6YAAKT//Pz/pAAZyP/7+v+lAF2j6v///EMAHIDu8fTkDQAAFBENDg4DAABWUDggTgAAANABAJ0BKggACAABQCYlAE6AxQCkHCRgAPulrhjcIMgQIudsWZ1CQ+3G2ZDY8L/fs9nfL4lIKTn+fFlGpm/azvHh25sfZVIYRGWTLvAAAA==',
    'UklGRuoAAABXRUJQVlA4TN0AAAAvB8ABEDfBoJEkRXOo8qSfBX7+JRsMGklSdIwSzr82fmYcBW0kKbv35+L9W3hbzMgqtm0lzxUvREqGIATQDg4J+HKXAIEJAlijGw0PrJaB/A+8x3gM/O+5Uvnf29eAaTqDvNfj9xwgeFv2EX0bAYT48DkG3/AV0cvc9S/PpAmcwXuemK93mD9reDWkY2IF+91izswUOLhez6Zk5iffevOsfwl2UzCQJMnQ2bZ91///7fRNRP8D80mKkkt78RewjDplAeZBKEocvev5ToVhjS072TFuTZbWLzjdhvl8AAA=',
  ]) {
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    const info = imageInfo(bytes);
    const pack = normalizePetPreferences({
      schemaVersion: 1,
      active: 'custom',
      custom: {
        schemaVersion: 1,
        name: 'WebP',
        animations: {
          idle: {
            ...options,
            frames: [
              {
                src: imageDataUrl(bytes, info.mime),
                width: info.width,
                height: info.height,
              },
            ],
          },
        },
      },
    }).custom!;
    assert.equal(
      pack.animations.idle.frames[0].src,
      imageDataUrl(bytes, 'image/webp'),
    );
    assert.equal(pack.animations.idle.frames[0].width, 8);
    assert.equal(pack.animations.idle.frames[0].height, 8);
  }
});
