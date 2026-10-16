import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { build, parseArguments, safeJson } from './build.mjs';

const template = '<!doctype html><meta http-equiv="Content-Security-Policy" content="@@CSP@@"><style>@@APP_CSS@@</style><script id="embeddedData" type="application/json">@@INVENTORY@@</script><script id="applicationScript">@@APP_JS@@</script>';
const inventory = { activeMapId: 'unidade_1', auditLogs: [], maps: { unidade_1: { points: [], cables: [] } } };
const maps = { unidade_1: { id: 'unidade_1', label: 'Unidade 1', image: '' } };

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'mapa-build-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(['src', 'private/assets', 'data'].map(dir => mkdir(path.join(root, dir), { recursive: true })));
  await Promise.all([
    writeFile(path.join(root, 'src/index.template.html'), template),
    writeFile(path.join(root, 'src/app.css'), 'body { color: #123; }'),
    writeFile(path.join(root, 'src/app.js'), 'const DEFAULT_MAPS = /*@@DEFAULT_MAPS@@*/ {};\nglobalThis.maps = DEFAULT_MAPS; globalThis.qaSearchResult = qaSearch(" eq-005 ");'),
    writeFile(path.join(root, 'src/search.js'), 'export function qaSearch(value) { return String(value).trim(); }'),
    writeFile(path.join(root, 'src/equipment-map.js'), 'export function qaEquipment(value) { return value; }'),
    writeFile(path.join(root, 'private/inventory.json'), '{broken private data PRIVATE-ONLY-QA-SENTINEL'),
    writeFile(path.join(root, 'private/maps.json'), '{broken private maps PRIVATE-ONLY-QA-SENTINEL'),
    writeFile(path.join(root, 'private/assets/device.png'), 'PRIVATE-ONLY-QA-SENTINEL'),
    writeFile(path.join(root, 'data/example-inventory.json'), JSON.stringify(inventory)),
    writeFile(path.join(root, 'data/default-maps.json'), JSON.stringify(maps)),
  ]);
  return root;
}

test('build generates only the application shell and never reads private inventory or photos', async t => {
  const root = await fixture(t);
  const result = await build({ root });
  const html = await readFile(result.outputFile, 'utf8');
  assert.equal(html.includes('PRIVATE-ONLY-QA-SENTINEL'), false);
  assert.equal(html.includes('assets/device.png'), false);
  assert.equal(html.includes('@@'), false);
  const embedded = JSON.parse(html.match(/<script id="embeddedData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, inventory);
  assert.equal(result.count, 0);
  assert.ok(html.includes("connect-src 'self'"));
  assert.ok(html.includes("form-action 'self'"));
  const application = html.match(/<script id="applicationScript">([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(application, 'utf8').digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  const context = {};
  vm.runInNewContext(application, context);
  assert.equal(context.qaSearchResult, 'eq-005', 'shared search helpers are executable in the inline browser script');
});

test('Windows line endings are normalized before hashing without modifying source', async t => {
  const root = await fixture(t);
  const script = 'const DEFAULT_MAPS = /*@@DEFAULT_MAPS@@*/ {};\r\nglobalThis.maps = DEFAULT_MAPS;\r';
  await Promise.all([
    writeFile(path.join(root, 'src/index.template.html'), template.replace(/></g, '>\r\n<').replace('@@APP_JS@@', '\r\n@@APP_JS@@\r')),
    writeFile(path.join(root, 'src/app.css'), 'body {\r\n  color: #123;\r}\r\n'),
    writeFile(path.join(root, 'src/app.js'), script),
  ]);
  const result = await build({ root });
  const html = await readFile(result.outputFile, 'utf8');
  assert.equal(html.includes('\r'), false);
  const application = html.match(/<script id="applicationScript">([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(application, 'utf8').digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.equal(await readFile(path.join(root, 'src/app.js'), 'utf8'), script);
});

test('build works without any private directory', async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'private'), { recursive: true });
  const result = await build({ root, out: 'preview' });
  assert.equal(result.outputFile, path.join(root, 'preview/index.html'));
  assert.equal(result.count, 0);
});

test('JSON escaping is round-trip safe and CLI rejects missing output argument', () => {
  const input = { text: '</script><tag>\u2028\u2029', value: null, bool: false };
  assert.deepEqual(JSON.parse(safeJson(input)), input);
  assert.ok(!safeJson(input).includes('<'));
  assert.throws(() => parseArguments(['--out']), /incompleto/);
});
