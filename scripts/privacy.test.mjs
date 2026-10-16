import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('published seed and HTML stay generic even when private storage exists locally', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'mapa-privacy-test-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const maps = JSON.parse(await readFile(path.join(root, 'data/default-maps.json'), 'utf8'));
  const inventory = JSON.parse(await readFile(path.join(root, 'data/example-inventory.json'), 'utf8'));
  assert.deepEqual(Object.keys(maps), ['unidade_1', 'unidade_2', 'unidade_3', 'unidade_4']);
  assert.deepEqual(inventory.auditLogs, []);
  assert.equal(inventory.lastUpdated, '');
  for (const [id, unit] of Object.entries(maps)) {
    assert.equal(unit.id, id);
    assert.equal(unit.label, `Unidade ${id.split('_')[1]}`);
    assert.equal(unit.image, '');
    assert.equal(inventory.maps[id].mapImage, '');
    for (const key of ['points', 'cables', 'processes', 'processNodes', 'processLinks']) {
      assert.deepEqual(inventory.maps[id][key], []);
    }
  }
  const generated = await build({ root, out: output });
  assert.equal(generated.count, 0);
  const html = await readFile(generated.outputFile, 'utf8');
  const embedded = JSON.parse(html.match(/<script id="embeddedData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, inventory);
  assert.doesNotMatch(html, /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/);
  assert.doesNotMatch(html, /(?:C:\\Users\\|C:\/Users\/|[A-Z]:\\[^<\n]+\.png)/i);
});
