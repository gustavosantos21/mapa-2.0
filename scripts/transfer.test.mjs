import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createAppServer, selectHtmlEncoding } from './serve.mjs';

const html = '<!doctype html><meta content="default-src &#39;none&#39;" http-equiv="Content-Security-Policy"><title>QA</title>' + '<p>Generic equipment</p>'.repeat(300);
const credentials = { username: 'qa-transfer', password: 'Synthetic-only-test-password-2026!' };
const defaults = { maps: { qa: { id: 'qa', label: 'QA', image: '' } }, inventory: { activeMapId: 'qa', maps: { qa: { mapImage: '', points: [], cables: [], processes: [], processNodes: [], processLinks: [] } }, auditLogs: [], lastUpdated: '' } };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'map-transfer-'));
  const root = path.join(directory, 'dist');
  await mkdir(root);
  await writeFile(path.join(root, 'index.html'), html);
  const server = createAppServer({root, storageDirectory: path.join(directory, 'private'), defaults, ...credentials});
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true}); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  function request(url, {method = 'GET', headers = {}, body} = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(origin + url, {method, headers}, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks)}));
      });
      req.on('error', reject); req.end(body);
    });
  }
  return {server, origin, root, request};
}

test('HTML negotiation respects quality, disabled encodings and identity', () => {
  for (const [header, expected] of [
    [undefined, 'identity'], ['', 'identity'], ['gzip, br', 'br'],
    ['br;q=0.2, gzip;q=0.8', 'gzip'], ['br;q=0,gzip;q=0', 'identity'],
    ['*;q=0', null], ['*;q=0, identity;q=1', 'identity'],
    ['*;q=0.4,br;q=0', 'gzip'], ['gzip;q=0.7, identity;q=1', 'identity'],
    ['gzip;q=invalid', 'identity'], ['BR;Q=1, gzip;q=0.5', 'br'],
    ['br;q=0,br;q=1,gzip;q=0.5', 'gzip'],
  ]) assert.equal(selectHtmlEncoding(header), expected, String(header));
});

test('public HTML compressed GET and HEAD preserve CSP and exact body; cache follows rebuild', async t => {
  const app = await fixture(t);
  let policy;
  for (const encoding of ['identity', 'gzip', 'br']) {
    const headers = {'Accept-Encoding': encoding};
    const response = await app.request('/', {headers});
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], encoding === 'identity' ? undefined : encoding);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers.vary, 'Accept-Encoding');
    assert.equal(Number(response.headers['content-length']), response.bytes.length);
    const decoded = encoding === 'gzip' ? gunzipSync(response.bytes) : encoding === 'br' ? brotliDecompressSync(response.bytes) : response.bytes;
    assert.equal(decoded.toString(), html);
    policy ??= response.headers['content-security-policy'];
    assert.ok(policy.endsWith("; frame-ancestors 'none'"));
    assert.equal(response.headers['content-security-policy'], policy);
    const head = await app.request('/index.html', {method: 'HEAD', headers});
    assert.equal(head.status, 200);
    assert.equal(head.bytes.length, 0);
    for (const key of ['content-length', 'content-encoding', 'content-security-policy', 'vary', 'cache-control']) assert.equal(head.headers[key], response.headers[key]);
  }
  assert.equal((await app.request('/', {headers: {'Accept-Encoding': '*;q=0'}})).status, 406);
  const disabled = await app.request('/', {headers: {'Accept-Encoding': 'gzip;q=0,br;q=0'}});
  assert.equal(disabled.bytes.toString(), html);
  assert.equal(disabled.headers['content-encoding'], undefined);
  const updated = html + '<footer>New build</footer>';
  await writeFile(path.join(app.root, 'index.html'), updated);
  const rebuilt = await app.request('/', {headers: {'Accept-Encoding': 'gzip'}});
  assert.equal(gunzipSync(rebuilt.bytes).toString(), updated);
});

test('revision API is authenticated, skips payload reads and tracks saves without changing conflicts', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/revision')).status, 401);
  const login = await app.request('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: app.origin}, body: JSON.stringify(credentials)});
  assert.equal(login.status, 200);
  const session = JSON.parse(login.bytes);
  const headers = {Cookie: login.headers['set-cookie'][0].split(';')[0], 'Accept-Encoding': 'br,gzip'};
  const originalGetState = app.server.store.getState;
  app.server.store.getState = () => { throw new Error('Full state must not be read for a revision'); };
  const initial = await app.request('/api/revision', {headers});
  assert.equal(initial.status, 200);
  assert.deepEqual(JSON.parse(initial.bytes), {revision: 0});
  assert.equal(initial.headers['content-encoding'], undefined);
  assert.equal(initial.headers['cache-control'], 'no-store');
  const writeHeaders = {...headers, Origin: app.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken};
  const save = () => app.request('/api/state', {method: 'PUT', headers: writeHeaders, body: JSON.stringify({...defaults, revision: 0})});
  assert.equal((await save()).status, 200);
  assert.deepEqual(JSON.parse((await app.request('/api/revision', {headers})).bytes), {revision: 1});
  const conflict = await save();
  assert.equal(conflict.status, 409);
  assert.equal(JSON.parse(conflict.bytes).revision, 1);
  app.server.store.getState = originalGetState;
  const full = await app.request('/api/state', {headers});
  assert.equal(full.status, 200);
  assert.equal(full.headers['content-encoding'], undefined);
  assert.equal(JSON.parse(full.bytes).revision, 1);
  assert.equal((await app.request('/api/state', {method: 'PUT', headers: {...writeHeaders, 'X-CSRF-Token': 'wrong'}, body: JSON.stringify({...defaults, revision: 1})})).status, 403);
  assert.deepEqual(JSON.parse((await app.request('/api/revision', {headers})).bytes), {revision: 1});
});
