import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migratePortable, parseMapLiteral } from './migrate-portable.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const image = `data:image/png;base64,${png.toString('base64')}`;
const seed = () => ({ activeMapId: 'qa_unit', lastUpdated: '2026-10-09', auditLogs: [{ action: 'create', entityId: 'qa-1' }], maps: {
  qa_unit: { mapImage: 'assets/floor.png', points: [{ uid: 'qa-1', markerId: 'QA-01', name: 'Dispositivo sintético', x: 12.75, y: 85.5, model: 'QA model', ip: '192.0.2.20', processes: ['Operação QA'], photos: [image, image] }],
    processes: ['Operação QA'], processNodes: [{ uid: 'qa-op-1', name: 'Operação QA', x: 30, y: 70 }], cables: [], processLinks: [] },
} });

async function fixture(t, inventory = seed()) {
  const root = await mkdtemp(path.join(tmpdir(), 'mapa-import-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source/panel.html');
  const destination = path.join(root, 'private');
  await mkdir(path.join(root, 'source/assets'), { recursive: true });
  const text = `<html><script id="embeddedData" type="application/json">${JSON.stringify(inventory)}</script><script>const DEFAULT_MAPS = { qa_unit: { id: "qa_unit", name: "Unidade QA", label: "Unidade QA", image: "assets/floor.png", }, }; throw new Error("MUST-NOT-EXECUTE");</script></html>`;
  await writeFile(source, text);
  await writeFile(path.join(root, 'source/assets/floor.png'), png);
  return { root, source, destination, text };
}

test('map literal parser permits inert metadata and rejects executable expressions and unsafe keys', () => {
  const parsed = parseMapLiteral('{ qa: {id:"qa", list:[true,false,null,2.5],}, }; trailing program');
  assert.equal(parsed.qa.id, 'qa');
  assert.deepEqual(parsed.qa.list, [true, false, null, 2.5]);
  for (const text of [
    '{qa: {id: (() => "qa")()}};',
    '{qa: new Object()};',
    '{qa: {...other}};',
    '{qa: {id: globalThis.secret}};',
    '{__proto__: {polluted: true}};',
    '{qa: {constructor: "x"}};',
    '{qa: {prototype: "x"}};',
    '{qa: {}, qa: {}};',
    '{} + doSomething();',
  ]) assert.throws(() => parseMapLiteral(text), undefined, text);
  assert.equal({}.polluted, undefined);
});

test('migration preserves coordinates, metadata, audit and photos and deduplicates raster bytes without executing scripts', async t => {
  const { source, destination, text } = await fixture(t);
  const summary = await migratePortable({ source, destination });
  assert.deepEqual(summary, { units: 1, equipment: 1, operations: 1, history: 1, assets: 1 });
  assert.equal(await readFile(source, 'utf8'), text);
  const imported = JSON.parse(await readFile(path.join(destination, 'inventory.json'), 'utf8'));
  const maps = JSON.parse(await readFile(path.join(destination, 'maps.json'), 'utf8'));
  const actualAsset = imported.maps.qa_unit.mapImage;
  assert.match(actualAsset, /^assets\/[a-f0-9]{64}\.png$/);
  const expected = seed();
  expected.maps.qa_unit.mapImage = actualAsset;
  expected.maps.qa_unit.points[0].photos = [actualAsset, actualAsset];
  assert.deepEqual(imported, expected);
  assert.equal(maps.qa_unit.image, actualAsset);
  assert.deepEqual(await readdir(path.join(destination, 'assets')), [actualAsset.slice(7)]);
  assert.deepEqual(await readFile(path.join(destination, actualAsset)), png);
});

test('existing data or database is never overwritten by a repeated migration', async t => {
  for (const filename of ['inventory.json', 'maps.json', 'state.sqlite']) {
    const fixtureData = await fixture(t);
    await mkdir(fixtureData.destination);
    const existing = path.join(fixtureData.destination, filename);
    await writeFile(existing, 'EXISTING-QA-DATA');
    await assert.rejects(migratePortable(fixtureData), /destino|dados|sobrescrito/i);
    assert.equal(await readFile(existing, 'utf8'), 'EXISTING-QA-DATA');
    assert.deepEqual(await readdir(fixtureData.destination), [filename]);
    assert.equal(await readFile(fixtureData.source, 'utf8'), fixtureData.text);
  }
});

test('traversal and malformed images fail before creating inventory output', async t => {
  for (const reference of ['assets/../secret.png', 'assets/%2e%2e/secret.png', 'assets/%252e%252e/secret.png', 'assets/..\\secret.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA']) {
    const inventory = seed();
    inventory.maps.qa_unit.mapImage = reference;
    const fixtureData = await fixture(t, inventory);
    await writeFile(path.join(fixtureData.root, 'source/secret.png'), png);
    await assert.rejects(migratePortable(fixtureData));
    await assert.rejects(access(path.join(fixtureData.destination, 'inventory.json')), { code: 'ENOENT' });
    assert.equal(await readFile(fixtureData.source, 'utf8'), fixtureData.text);
  }
});

test('asset directory junctions cannot import files outside the allowed source assets', async t => {
  const inventory = seed();
  inventory.maps.qa_unit.mapImage = 'assets/escape/secret.png';
  const fixtureData = await fixture(t, inventory);
  const outside = path.join(fixtureData.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.png'), png);
  await symlink(outside, path.join(fixtureData.root, 'source/assets/escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(migratePortable(fixtureData), /fora|inválid|autorizad/i);
  await assert.rejects(access(path.join(fixtureData.destination, 'inventory.json')), { code: 'ENOENT' });
});
