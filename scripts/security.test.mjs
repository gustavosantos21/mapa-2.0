import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createAppServer } from './serve.mjs';
import { createStore, MAX_BODY, validateState, rasterType } from './store.mjs';

const username = 'synthetic-user';
const password = 'Synthetic-password-for-test-8271';
const empty = () => ({ inventory: { activeMapId: 'unit', auditLogs: [], maps: { unit: { mapImage: '', points: [], cables: [], processes: [], processNodes: [], processLinks: [] } } }, maps: { unit: { id: 'unit', label: 'Synthetic unit', image: '' } } });
const raster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
// Small generated synthetic pictures, with no external fixtures or company data.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooor0jgP/9k=', 'base64');
const webp = Buffer.from('UklGRjIAAABXRUJQVlA4ICYAAACQAQCdASoCAAMAAUAmJQBOl0AAhgAA/uxw37UwSRlL/r4Ap4kAAA==', 'base64');
const webpLossless = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQt0KVsf+BiOh/AAA=', 'base64');

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'map-security-'));
  const root = path.join(directory, 'public');
  await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Synthetic fixture</title>');
  const storageDirectory = path.join(directory, 'private');
  await mkdir(storageDirectory);
  await writeFile(path.join(storageDirectory, 'inventory.json'), JSON.stringify(empty().inventory));
  await writeFile(path.join(storageDirectory, 'maps.json'), JSON.stringify(empty().maps));
  const server = await createAppServer({ storageDirectory, root, username, password, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  function request(url, { method = 'GET', body, headers = {} } = {}) {
    const data = body === undefined ? undefined : Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request(origin, { path: url, method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks), text = bytes.toString();
          let json; try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, bytes, text, json });
        });
      });
      req.on('error', reject);
      req.end(data);
    });
  }
  async function login() {
    const res = await request('/api/login', { method: 'POST', body: { username, password }, headers: { origin } });
    assert.equal(res.status, 200, res.text);
    return { cookie: res.headers['set-cookie'][0].split(';')[0], csrf: res.json.csrfToken, response: res };
  }
  return { directory, root, storageDirectory, server, request, login, origin };
}

test('private endpoints never disclose inventory or assets without a valid session', async t => {
  const f = await fixture(t);
  for (const url of ['/api/state', '/api/session', '/api/assets/' + 'a'.repeat(64) + '.png']) {
    const res = await f.request(url);
    assert.equal(res.status, 401, `${url}: ${res.text}`);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal((await f.request('/api/state', { headers: { cookie: 'map_session=fabricated' } })).status, 401);
  for (const url of ['/private/state.sqlite', '/state.sqlite', '/.env', '/private/inventory.json']) {
    const res = await f.request(url);
    assert.ok([401, 404].includes(res.status), `${url}: ${res.status}`);
    assert.doesNotMatch(res.text, /SQLite format|Synthetic-password/);
  }
});

test('rejects hostile Host, login origin and CSRF requests without mutating state', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/', { headers: { host: 'evil.example' } })).status, 403);
  for (const origin of [undefined, 'null', 'https://evil.example', `${f.origin}.evil.example`]) {
    const res = await f.request('/api/login', { method: 'POST', body: { username, password }, headers: origin === undefined ? {} : { origin } });
    assert.equal(res.status, 403, res.text);
  }
  const auth = await f.login();
  const saved = (await f.request('/api/state', { headers: { cookie: auth.cookie } })).json;
  for (const headers of [
    { cookie: auth.cookie, origin: f.origin },
    { cookie: auth.cookie, origin: f.origin, 'x-csrf-token': 'wrong' },
    { cookie: auth.cookie, origin: 'https://evil.example', 'x-csrf-token': auth.csrf },
    { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
  ]) {
    const res = await f.request('/api/state', { method: 'PUT', body: saved, headers });
    assert.equal(res.status, 403, res.text);
  }
  assert.equal((await f.request('/api/state', { headers: { cookie: auth.cookie } })).json.revision, saved.revision);
  const cors = await f.request('/api/state', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(cors.headers['access-control-allow-origin'], undefined);
});

test('session cookies protect script access, expire and rotate across logins', async t => {
  const f = await fixture(t), first = await f.login(), second = await f.login();
  const cookie = first.response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /(?:Max-Age|Expires)=/i);
  assert.notEqual(first.cookie, second.cookie);
  assert.notEqual(first.csrf, second.csrf);
  const swapped = await f.request('/api/logout', { method: 'POST', headers: { origin: f.origin, cookie: second.cookie, 'x-csrf-token': first.csrf } });
  assert.equal(swapped.status, 403);
  const out = await f.request('/api/logout', { method: 'POST', headers: { origin: f.origin, cookie: first.cookie, 'x-csrf-token': first.csrf } });
  assert.equal(out.status, 200);
  assert.equal((await f.request('/api/state', { headers: { cookie: first.cookie } })).status, 401);
});

test('rejects prototype keys, external executable images, excessive nesting and collections', async t => {
  const f = await fixture(t), auth = await f.login();
  const current = (await f.request('/api/state', { headers: { cookie: auth.cookie } })).json;
  const payloads = [];
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    const item = structuredClone(current); Object.defineProperty(item.inventory.maps.unit, name, { value: { polluted: true }, enumerable: true }); payloads.push(item);
  }
  for (const image of ['https://evil.example/tracker.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload="alert(1)"/>', '/api/assets/../../private/state.sqlite']) {
    const item = structuredClone(current); item.inventory.maps.unit.mapImage = image; payloads.push(item);
  }
  const photos = structuredClone(current); photos.inventory.maps.unit.points = [{ photos: ['data:image/svg+xml,<svg/>'] }]; payloads.push(photos);
  const huge = structuredClone(current); huge.inventory.maps.unit.points = Array.from({ length: 1501 }, () => ({})); payloads.push(huge);
  const long = structuredClone(current); long.inventory.maps.unit.points = [{ name: 'x'.repeat(8001) }]; payloads.push(long);
  const deep = structuredClone(current); deep.inventory.deep = {}; let at = deep.inventory.deep; for (let i = 0; i < 30; i++) at = at.child = {}; payloads.push(deep);
  for (const field of ['cables', 'processes', 'processNodes', 'processLinks']) {
    const wrongType = structuredClone(current); wrongType.inventory.maps.unit[field] = {}; payloads.push(wrongType);
  }
  const nullPoint = structuredClone(current); nullPoint.inventory.maps.unit.points = [null]; payloads.push(nullPoint);
  const wrongPhotos = structuredClone(current); wrongPhotos.inventory.maps.unit.points = [{ photos: {} }]; payloads.push(wrongPhotos);
  for (const activeMapId of ['__proto__', 'constructor', 'prototype']) { const inherited = structuredClone(current); inherited.inventory.activeMapId = activeMapId; payloads.push(inherited); }
  for (const body of payloads) {
    const res = await f.request('/api/state', { method: 'PUT', body, headers: { origin: f.origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf } });
    assert.equal(res.status, 400, res.text);
  }
  assert.equal({}.polluted, undefined);
  assert.equal((await f.request('/api/state', { headers: { cookie: auth.cookie } })).json.revision, current.revision);
});

test('upload rejects SVG, HTML and incorrect magic; raster response cannot execute as HTML', async t => {
  const f = await fixture(t), auth = await f.login();
  const headers = { origin: f.origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf };
  for (const [type, body] of [['image/svg+xml', '<svg onload="alert(1)"></svg>'], ['text/html', '<script>alert(1)</script>'], ['image/png', '<!doctype html><script>alert(1)</script>']]) {
    const res = await f.request('/api/assets', { method: 'POST', body, headers: { ...headers, 'content-type': type } });
    assert.ok([400, 415].includes(res.status), res.text);
  }
  const uploaded = await f.request('/api/assets', { method: 'POST', body: raster, headers: { ...headers, 'content-type': 'image/png' } });
  assert.equal(uploaded.status, 201, uploaded.text);
  assert.match(uploaded.json.url, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
  const res = await f.request(uploaded.json.url, { headers: { cookie: auth.cookie } });
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.bytes, raster);
});

test('raw traversal and double-encoded paths cannot escape static or private storage', async t => {
  const f = await fixture(t), auth = await f.login();
  await writeFile(path.join(f.directory, 'outside.txt'), 'SYNTHETIC_OUTSIDE_SECRET');
  for (const url of ['/../outside.txt', '/%2e%2e/outside.txt', '/%252e%252e/outside.txt', '/..%5coutside.txt', '/%00', '/api/assets/../state.sqlite', '/api/assets/%2e%2e%2fstate.sqlite', '/api/assets/%252e%252e%252fstate.sqlite']) {
    const res = await f.request(url, { headers: { cookie: auth.cookie } });
    assert.ok([400, 403, 404].includes(res.status), `${url}: ${res.status}`);
    assert.doesNotMatch(res.text, /SYNTHETIC_OUTSIDE_SECRET|SQLite format/);
  }
});

test('oversized writes and malformed JSON preserve the previous revision', async t => {
  const f = await fixture(t), auth = await f.login();
  const headers = { origin: f.origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf };
  const before = (await f.request('/api/state', { headers: { cookie: auth.cookie } })).json.revision;
  assert.equal((await f.request('/api/state', { method: 'PUT', body: '{', headers })).status, 400);
  const res = await f.request('/api/state', { method: 'PUT', body: 'x'.repeat(MAX_BODY + 1), headers });
  assert.equal(res.status, 413, res.text);
  assert.equal((await f.request('/api/state', { headers: { cookie: auth.cookie } })).json.revision, before);
});

test('login guessing is bounded and unknown usernames do not disclose account existence', async t => {
  const f = await fixture(t);
  const attempt = name => f.request('/api/login', { method: 'POST', body: { username: name, password: 'Synthetic-wrong-password' }, headers: { origin: f.origin } });
  const known = await attempt(username), unknown = await attempt('missing-synthetic-user');
  assert.equal(known.status, 401); assert.equal(unknown.status, 401);
  assert.equal(known.text, unknown.text);
  let limited = false;
  for (let i = 0; i < 20; i++) { if ((await attempt(username)).status === 429) { limited = true; break; } }
  assert.equal(limited, true, 'Login attempts must be rate limited');
});

test('private asset directory symlink or junction is rejected before import/write', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'map-security-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storageDirectory = path.join(directory, 'private'), outside = path.join(directory, 'outside');
  await mkdir(storageDirectory); await mkdir(outside);
  try { await symlink(outside, path.join(storageDirectory, 'assets'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS does not allow synthetic symlink creation'); return; } throw error; }
  assert.throws(() => createStore({ storageDirectory, defaults: empty(), username, password }), /permitid|simb[oó]lic|segur|symlink|link/i);
});

test('schema refuses unknown maps and nested image arrays rather than persisting unsafe values', () => {
  const payload = empty(); payload.inventory.maps.other = { points: [] };
  assert.throws(() => validateState(payload));
  const malformed = empty(); malformed.inventory.maps.unit.points = [{ photos: [['https://evil.example/a.png']] }];
  assert.throws(() => validateState(malformed));
});

test('HTTPS public origin adds Secure cookies and ignores spoofed forwarding headers', async t => {
  const publicOrigin = 'https://synthetic-map.example';
  const f = await fixture(t, { origin: publicOrigin });
  const allowed = { origin: publicOrigin, host: 'synthetic-map.example' };
  const res = await f.request('/api/login', { method: 'POST', body: { username, password }, headers: allowed });
  assert.equal(res.status, 200, res.text);
  assert.match(res.headers['set-cookie'][0], /; Secure(?:;|$)/);
  const bypass = await f.request('/api/login', { method: 'POST', body: { username, password }, headers: { ...allowed, origin: 'http://evil.example', 'x-forwarded-host': 'synthetic-map.example', 'x-forwarded-proto': 'https' } });
  assert.equal(bypass.status, 403);
  assert.equal((await f.request('/api/session', { headers: { ...allowed, host: 'evil.example', 'x-forwarded-host': 'synthetic-map.example' } })).status, 403);
});

test('server enforces session expiration independent of the browser cookie lifetime', async t => {
  const f = await fixture(t), auth = await f.login();
  const originalNow = Date.now;
  Date.now = () => originalNow() + 8 * 60 * 60 * 1000 + 1;
  try { assert.equal((await f.request('/api/state', { headers: { cookie: auth.cookie } })).status, 401); }
  finally { Date.now = originalNow; }
});

test('dangling database links cannot create a database outside the private folder', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'map-security-db-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storageDirectory = path.join(directory, 'private');
  await mkdir(storageDirectory);
  try { await symlink(path.join(directory, 'outside.sqlite'), path.join(storageDirectory, 'state.sqlite'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS does not allow synthetic file symlinks'); return; } throw error; }
  assert.throws(() => createStore({ storageDirectory, defaults: empty(), username, password }), /permitid|simb[oó]lic|segur|symlink|link/i);
});

test('image headers limit decoded resolution for PNG, JPEG and lossy/lossless WebP', () => {
  for (const [bytes, extension] of [[raster, 'png'], [jpeg, 'jpg'], [webp, 'webp'], [webpLossless, 'webp']]) {
    const type = rasterType(bytes);
    assert.equal(type.extension, extension);
    assert.ok(type.width > 0 && type.height > 0);
    if (extension !== 'png') assert.deepEqual([type.width, type.height], [2, 3]);
  }
  const pngBomb = Buffer.from(raster); pngBomb.writeUInt32BE(9000, 16); pngBomb.writeUInt32BE(9000, 20);
  assert.throws(() => rasterType(pngBomb), /resolução/);
  const jpegBomb = Buffer.from(jpeg); const sof = jpegBomb.indexOf(Buffer.from([255, 192]));
  assert.ok(sof > 0); jpegBomb.writeUInt16BE(65000, sof + 5);
  assert.throws(() => rasterType(jpegBomb), /resolução/);
  const webpBomb = Buffer.from(webp); webpBomb.writeUInt16LE(11000, 26); webpBomb.writeUInt16LE(4000, 28);
  assert.throws(() => rasterType(webpBomb), /resolução/);
  const losslessBomb = Buffer.from(webpLossless); losslessBomb.writeUInt32LE(16383 | (16383 << 14), 21);
  assert.throws(() => rasterType(losslessBomb), /resolução/);
  const duplicateHeader = Buffer.concat([raster.subarray(0,33), raster.subarray(8,33), raster.subarray(33)]);
  assert.throws(() => rasterType(duplicateHeader));
  for (const bytes of [raster.subarray(0,24), jpeg.subarray(0,25), webp.subarray(0,22), webpLossless.subarray(0,24)]) assert.throws(() => rasterType(bytes));
});

test('extended WebP canvas cannot conceal excessive frame dimensions or enable animation', () => {
  const chunk = Buffer.alloc(18); chunk.write('VP8X'); chunk.writeUInt32LE(10,4); chunk.writeUIntLE(1,12,3); chunk.writeUIntLE(2,15,3);
  const extended = Buffer.concat([webp.subarray(0,12),chunk,webp.subarray(12)]); extended.writeUInt32LE(extended.length-8,4);
  assert.deepEqual([rasterType(extended).width,rasterType(extended).height],[2,3]);
  const inconsistent = Buffer.from(extended); inconsistent.writeUIntLE(0,24,3);
  assert.throws(() => rasterType(inconsistent));
  const animated = Buffer.from(extended); animated[20] = 2;
  assert.throws(() => rasterType(animated), /animado/);
});

test('private interface branding does not add remote resources, inline event handlers or frames', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../src/index.template.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(html, /<(?:script|link|img|iframe|video|audio|source)\b[^>]*\b(?:src|href|srcset|poster)\s*=\s*["']\s*(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /<iframe\b|\bsrcdoc\s*=|\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<form\b[^>]*\baction\s*=\s*["']\s*(?:https?:)?\/\//i);
  assert.doesNotMatch(css, /@import\b|url\s*\(\s*["']?\s*(?:https?:)?\/\//i);
});

test('equipment identifiers cannot break out of generated select option attributes', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const helper = source.match(/function escapeHtml\(value\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(helper, 'HTML escaping helper must be present');
  // Evaluate each actual option-producing callback, with hostile imported data.
  const callbacks = [...source.matchAll(/\.map\(\((point|target)\) => (.*?<\/option>['"])(?:\))?/g)];
  assert.equal(callbacks.length, 5, 'Review every equipment option producer when adding another');
  const hostile = '"><img src=x onerror=alert(1)><option value="';
  for (const [, variable, expression] of callbacks) {
    const rendered = vm.runInNewContext(helper + '\n' + expression, {
      [variable]: { uid: hostile, name: 'Synthetic equipment' },
      pointName: () => 'Synthetic equipment',
    }, { timeout: 1000 });
    assert.equal(rendered, '<option value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&lt;option value=&quot;">Synthetic equipment</option>');
    assert.doesNotMatch(rendered, /<img/i);
  }
});
