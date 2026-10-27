import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './serve.mjs';

const credentials = { username: 'qa-user', password: 'QA-only-strong-passphrase-2026!' };
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const maps = { unidade_1: { id: 'unidade_1', label: 'Unidade QA', country: 'Não informado', image: '' } };
const inventory = { activeMapId: 'unidade_1', auditLogs: [], lastUpdated: '', maps: {
  unidade_1: { mapImage: '', points: [], cables: [], processes: [], processNodes: [], processLinks: [] },
} };

async function fixture(t, { migrated = false, localAccess = false, origin: publicOrigin } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'mapa-api-test-'));
  const storageDirectory = path.join(root, 'private');
  let running;
  t.after(async () => {
    if (running?.listening) await stop(running);
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['dist', 'data', 'private'].map(dir => mkdir(path.join(root, dir), { recursive: true })));
  await Promise.all([
    writeFile(path.join(root, 'dist/index.html'), '<!doctype html><title>Application shell QA</title>'),
    writeFile(path.join(root, 'data/default-maps.json'), JSON.stringify(maps)),
    writeFile(path.join(root, 'data/example-inventory.json'), JSON.stringify(inventory)),
  ]);
  if (migrated) {
    const imported = structuredClone(inventory);
    const importedMaps = structuredClone(maps);
    imported.maps.unidade_1.mapImage = 'assets/synthetic-floor.png';
    importedMaps.unidade_1.image = 'assets/synthetic-floor.png';
    imported.maps.unidade_1.points.push({ id: 'SYNTHETIC-IMPORT-1', name: 'Equipamento sintético QA', type: 'scanner', quantity: 2, x: 10, y: 20, photos: [`data:image/png;base64,${png.toString('base64')}`] });
    await mkdir(path.join(storageDirectory, 'assets'));
    await Promise.all([
      writeFile(path.join(storageDirectory, 'inventory.json'), JSON.stringify(imported)),
      writeFile(path.join(storageDirectory, 'maps.json'), JSON.stringify(importedMaps)),
      writeFile(path.join(storageDirectory, 'assets/synthetic-floor.png'), png),
    ]);
  }
  async function start() {
    running = await createAppServer({ root: path.join(root, 'dist'), storageDirectory, ...credentials, localAccess, origin: publicOrigin });
    running.listen(0, '127.0.0.1');
    await once(running, 'listening');
    const origin = `http://127.0.0.1:${running.address().port}`;
    return { server: running, origin, request: (url, options = {}) => fetch(origin + url, options) };
  }
  return { root, storageDirectory, start };
}

async function stop(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function login(app) {
  const response = await app.request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin }, body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const data = await response.json();
  assert.ok(data.csrfToken);
  return { Cookie: cookie.split(';')[0], 'X-CSRF-Token': data.csrfToken, Origin: app.origin };
}

async function state(app, headers) {
  const response = await app.request('/api/state', { headers });
  assert.equal(response.status, 200);
  return response.json();
}

async function save(app, headers, value) {
  return app.request('/api/state', {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
}

test('authentication gates data; login, session, logout and invalid credentials work', async t => {
  const fixtureData = await fixture(t);
  const app = await fixtureData.start();
  assert.equal((await app.request('/api/state')).status, 401);
  assert.equal((await app.request('/api/session')).status, 401);
  const invalid = await app.request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin },
    body: JSON.stringify({ ...credentials, password: 'incorrect' }),
  });
  assert.equal(invalid.status, 401);
  const headers = await login(app);
  const session = await app.request('/api/session', { headers });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).username, credentials.username);
  const snapshot = await state(app, headers);
  assert.deepEqual(snapshot.inventory, JSON.parse(await readFile(path.join(projectRoot, 'data/example-inventory.json'), 'utf8')));
  assert.deepEqual(snapshot.maps, JSON.parse(await readFile(path.join(projectRoot, 'data/default-maps.json'), 'utf8')));
  assert.ok(Number.isSafeInteger(snapshot.revision));
  const logout = await app.request('/api/logout', { method: 'POST', headers });
  assert.equal(logout.status, 200);
  assert.equal((await app.request('/api/state', { headers })).status, 401);
});

test('equipment edits persist to SQLite across server restart and do not leak into static HTML', async t => {
  const fixtureData = await fixture(t);
  let app = await fixtureData.start();
  const headers = await login(app);
  const snapshot = await state(app, headers);
  snapshot.inventory.maps.unidade_1.points.push({ id: 'SYNTHETIC-PERSIST-1', name: 'Persistência QA', quantity: 3, type: 'scanner', x: 12, y: 24, history: [] });
  snapshot.inventory.auditLogs.push({ id: 'QA-AUDIT-1', action: 'edit', entityId: 'SYNTHETIC-PERSIST-1' });
  const saved = await save(app, headers, snapshot);
  assert.equal(saved.status, 200);
  const savedData = await saved.json();
  assert.equal(savedData.revision, snapshot.revision + 1);
  await stop(app.server);
  app = await fixtureData.start();
  assert.equal((await app.request('/api/state', { headers })).status, 401, 'old sessions are invalid after restart');
  const newHeaders = await login(app);
  const restored = await state(app, newHeaders);
  assert.equal(restored.revision, savedData.revision);
  // The server attributes new history entries to the authenticated account.
  snapshot.inventory.auditLogs.at(-1).user = credentials.username;
  assert.deepEqual(restored.inventory, snapshot.inventory);
  assert.equal((await readFile(path.join(fixtureData.root, 'dist/index.html'), 'utf8')).includes('SYNTHETIC-PERSIST-1'), false);
});

test('two simultaneous users cannot silently overwrite each other', async t => {
  const fixtureData = await fixture(t);
  const app = await fixtureData.start();
  const firstHeaders = await login(app);
  const secondHeaders = await login(app);
  const first = await state(app, firstHeaders);
  const second = await state(app, secondHeaders);
  first.inventory.maps.unidade_1.points.push({ id: 'USER-A', name: 'Primeira edição QA', quantity: 1 });
  second.inventory.maps.unidade_1.points.push({ id: 'USER-B', name: 'Edição concorrente QA', quantity: 1 });
  assert.equal((await save(app, firstHeaders, first)).status, 200);
  const conflict = await save(app, secondHeaders, second);
  assert.equal(conflict.status, 409);
  assert.deepEqual((await state(app, secondHeaders)).inventory.maps.unidade_1.points.map(point => point.id), ['USER-A']);
});

test('one-time private migration preserves equipment and later SQLite edits remain authoritative', async t => {
  const fixtureData = await fixture(t, { migrated: true });
  let app = await fixtureData.start();
  const headers = await login(app);
  const snapshot = await state(app, headers);
  assert.equal(snapshot.inventory.maps.unidade_1.points[0].id, 'SYNTHETIC-IMPORT-1');
  const privateImage = snapshot.inventory.maps.unidade_1.mapImage;
  assert.match(privateImage, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
  assert.equal(snapshot.maps.unidade_1.image, privateImage);
  assert.deepEqual(snapshot.inventory.maps.unidade_1.points[0].photos, [privateImage]);
  assert.deepEqual(Buffer.from(await (await app.request(privateImage, { headers })).arrayBuffer()), png);
  snapshot.inventory.maps.unidade_1.points[0].quantity = 9;
  assert.equal((await save(app, headers, snapshot)).status, 200);
  await stop(app.server);
  app = await fixtureData.start();
  const restored = await state(app, await login(app));
  assert.equal(restored.inventory.maps.unidade_1.points[0].quantity, 9);
});

test('uploaded images survive restart and require authentication to read', async t => {
  const fixtureData = await fixture(t);
  let app = await fixtureData.start();
  const headers = await login(app);
  const response = await app.request('/api/assets', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: png });
  assert.equal(response.status, 201);
  const { url } = await response.json();
  assert.match(url, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
  assert.equal((await app.request(url)).status, 401);
  const image = await app.request(url, { headers });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  await stop(app.server);
  app = await fixtureData.start();
  const restoredImage = await app.request(url, { headers: await login(app) });
  assert.equal(restoredImage.status, 200);
  assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()), png);
});

test('local access creates a cookie session and preserves CSRF checks for saves', async t => {
  const app = await (await fixture(t, { localAccess: true })).start();
  assert.equal((await app.request('/api/state')).status, 401);
  const response = await app.request('/api/session');
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.username, 'local');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const state = await (await app.request('/api/state', { headers: { Cookie: cookie } })).json();
  const headers = { Cookie: cookie, Origin: app.origin, 'Content-Type': 'application/json' };
  assert.equal((await app.request('/api/state', { method: 'PUT', headers, body: JSON.stringify(state) })).status, 403);
  assert.equal((await app.request('/api/state', { method: 'PUT', headers: { ...headers, 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify(state) })).status, 200);
  assert.equal((await app.request('/api/session', { headers: { Host: 'untrusted.example', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('public origin requires login even when local access is enabled', async t => {
  const app = await (await fixture(t, { localAccess: true, origin: 'https://panel.example' })).start();
  const response = await new Promise((resolve, reject) => {
    const request = http.get(app.origin + '/api/session', { headers: { Host: 'panel.example' } }, response => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    request.on('error', reject);
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['set-cookie'], undefined);
});
