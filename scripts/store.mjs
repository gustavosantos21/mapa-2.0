import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_BODY = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_EDGE = 16_384;
function safeDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) throw new Error('Imagem excede o limite de resolução permitido.');
  return { width, height };
}
export function rasterType(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR') throw new Error('Cabeçalho PNG inválido.');
    const dimensions = safeDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    let cursor = 8, chunks = 0, data = false, end = false;
    while (cursor + 12 <= bytes.length) {
      if (++chunks > 10000) throw new Error('Imagem possui blocos demais.');
      const length = bytes.readUInt32BE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8);
      if (cursor + 12 + length > bytes.length || (type === 'IHDR' && cursor !== 8)) throw new Error('Bloco PNG inválido.');
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('Use uma imagem estática.');
      if (type === 'IDAT') data = true;
      if (type === 'IEND') { if (length !== 0) throw new Error('Fim PNG inválido.'); end = true; break; }
      cursor += 12 + length;
    }
    if (!data || !end) throw new Error('PNG incompleto.');
    return { extension: 'png', mime: 'image/png', ...dimensions };
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let cursor = 2, dimensions;
    while (cursor < bytes.length) {
      if (bytes[cursor++] !== 255) throw new Error('Cabeçalho JPEG inválido.');
      while (bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++];
      if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(cursor);
      if (length < 2 || cursor + length > bytes.length) throw new Error('Bloco JPEG inválido.');
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) {
        if (dimensions || length < 8) throw new Error('Dimensões JPEG inválidas.');
        dimensions = safeDimensions(bytes.readUInt16BE(cursor + 5), bytes.readUInt16BE(cursor + 3));
      }
      if (marker === 0xda) {
        if (!dimensions) break;
        return { extension: 'jpg', mime: 'image/jpeg', ...dimensions };
      }
      cursor += length;
    }
    throw new Error('JPEG incompleto.');
  }
  if (bytes.length > 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Contêiner WebP inválido.');
    let cursor = 12, dimensions, canvas, chunks = 0;
    while (cursor + 8 <= bytes.length) {
      if (++chunks > 10000) throw new Error('Imagem possui blocos demais.');
      const type = bytes.toString('ascii', cursor, cursor + 4), length = bytes.readUInt32LE(cursor + 4), start = cursor + 8;
      if (start + length > bytes.length) throw new Error('Bloco WebP inválido.');
      if (type === 'ANIM' || type === 'ANMF') throw new Error('Use uma imagem estática.');
      if (type === 'VP8X') {
        if (length !== 10 || canvas || (bytes[start] & 0x02)) throw new Error('Cabeçalho WebP inválido ou animado.');
        canvas = safeDimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
      }
      if (type === 'VP8 ') {
        if (dimensions || length < 10 || bytes[start] & 1 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d,0x01,0x2a]))) throw new Error('Cabeçalho VP8 inválido.');
        dimensions = safeDimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
      }
      if (type === 'VP8L') {
        if (dimensions || length < 5 || bytes[start] !== 0x2f) throw new Error('Cabeçalho VP8L inválido.');
        const bits = bytes.readUInt32LE(start + 1);
        dimensions = safeDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      cursor = start + length + (length & 1);
    }
    if (!dimensions || cursor !== bytes.length || (canvas && (canvas.width !== dimensions.width || canvas.height !== dimensions.height))) throw new Error('WebP incompleto ou inconsistente.');
    return { extension: 'webp', mime: 'image/webp', ...dimensions };
  }
  throw new Error('Use uma imagem PNG, JPEG ou WebP válida.');
}
export function validateState(value) {
  let nodes = 0;
  function visit(item, depth = 0, key = '') {
    if (++nodes > 350000 || depth > 24) throw new Error('Dados excedem o limite permitido.');
    if (typeof item === 'string') {
      if (item.length > 8000) throw new Error('Texto excede o limite permitido.');
      if ((key === 'mapImage' || key === 'image' || key === 'photos') && item && !/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(item)) throw new Error('Imagem precisa estar no armazenamento privado.');
    } else if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Número inválido.');
    else if (Array.isArray(item)) {
      const limit = key === 'photos' ? 100 : key === 'points' ? 1500 : key === 'cables' ? 3000 : 10000;
      if (item.length > limit) throw new Error('Coleção excede o limite permitido.');
      item.forEach(child => visit(child, depth + 1, key));
    } else if (item && typeof item === 'object') {
      for (const [name, child] of Object.entries(item)) {
        if (['__proto__','constructor','prototype'].includes(name) || name.length > 120) throw new Error('Campo não permitido.');
        visit(child, depth + 1, name);
      }
    }
  }
  if (!value || !value.inventory || !value.maps || Array.isArray(value.maps) || typeof value.maps !== 'object' || !value.inventory.maps || typeof value.inventory.maps !== 'object' || Array.isArray(value.inventory.maps)) throw new Error('Inventário e mapas são obrigatórios.');
  if (Object.keys(value.maps).length > 50 || Object.keys(value.maps).length < 1) throw new Error('Quantidade de mapas inválida.');
  if (!Object.hasOwn(value.maps, value.inventory.activeMapId)) throw new Error('Planta ativa inválida.');
  if (value.inventory.auditLogs !== undefined && (!Array.isArray(value.inventory.auditLogs) || value.inventory.auditLogs.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error('Histórico inválido.');
  for (const [id, map] of Object.entries(value.maps)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !map || map.id !== id || !Object.hasOwn(value.inventory.maps, id) || !Array.isArray(value.inventory.maps[id].points)) throw new Error('Mapa inválido.');
    const state = value.inventory.maps[id];
    for (const collection of ['points','cables','processNodes','processLinks']) {
      if (!Array.isArray(state[collection]) || state[collection].some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Coleção inválida.');
    }
    if (!Array.isArray(state.processes) || state.processes.some(item => typeof item !== 'string')) throw new Error('Operações inválidas.');
    for (const point of state.points) if (point.photos !== undefined && (!Array.isArray(point.photos) || point.photos.some(photo => typeof photo !== 'string'))) throw new Error('Fotos inválidas.');
  }
  if (Object.keys(value.inventory.maps).some(id => !Object.hasOwn(value.maps, id))) throw new Error('Mapa desconhecido.');
  visit(value);
}

// The browser cannot be trusted to name the author: entries already stored keep
// their original content, and new entries are attributed to the signed-in account.
export function attributeAuditLogs(incoming, previous, author) {
  if (incoming === undefined) return undefined;
  const key = entry => typeof entry.id === 'string' && entry.id ? 'id:' + entry.id : 'json:' + JSON.stringify(entry);
  const stored = new Map((Array.isArray(previous) ? previous : []).filter(entry => entry && typeof entry === 'object').map(entry => [key(entry), entry]));
  return incoming.map(entry => stored.get(key(entry)) ?? { ...entry, user: author });
}

export function createStore({ storageDirectory, defaults, username, password }) {
  fs.mkdirSync(storageDirectory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(storageDirectory).isSymbolicLink()) throw new Error('Pasta privada não pode ser um link.');
  const assetDirectory = path.join(storageDirectory, 'assets');
  fs.mkdirSync(assetDirectory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(assetDirectory).isSymbolicLink()) throw new Error('Pasta de imagens não pode ser um link.');
  const databaseFile = path.join(storageDirectory, 'state.sqlite');
  const rejectLink = filename => { try { if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Link simbólico não permitido no armazenamento privado.'); } catch(error) { if(error.code !== 'ENOENT') throw error; } };
  for (const suffix of ['', '-wal', '-shm']) rejectLink(databaseFile+suffix);
  const db = new DatabaseSync(databaseFile);
  try {
  try { fs.chmodSync(databaseFile, 0o600); } catch {}
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, username TEXT NOT NULL, revision INTEGER NOT NULL);');
  function createUser(name, secret) {
    if (!/^[A-Za-z0-9_.@-]{3,100}$/.test(name) || typeof secret !== 'string' || secret.length < 12 || secret.length > 256) throw new Error('Usuário precisa de 3 a 100 caracteres e senha de 12 a 256 caracteres.');
    const salt = randomBytes(24).toString('hex');
    const hash = scryptSync(secret, salt, 64).toString('hex');
    db.prepare('INSERT INTO users(username,salt,hash) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(name, salt, hash);
  }
  if (!db.prepare('SELECT username FROM users LIMIT 1').get() && username && password) createUser(username, password);
  function saveAsset(bytes) {
    if (!bytes.length || bytes.length > MAX_BODY) throw new Error('Imagem excede o limite permitido.');
    const { extension } = rasterType(bytes);
    const id = createHash('sha256').update(bytes).digest('hex') + '.' + extension;
    const target = path.join(assetDirectory, id);
    rejectLink(target);
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    return '/api/assets/' + id;
  }
  function readAsset(id) {
    if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(id)) throw new Error('Imagem não encontrada.');
    const filename = path.join(assetDirectory, id);
    const file = fs.statSync(filename);
    if (fs.lstatSync(filename).isSymbolicLink() || !file.isFile() || file.size > MAX_BODY) throw new Error('Arquivo não permitido.');
    const resolved = fs.realpathSync(filename);
    if (path.dirname(resolved) !== fs.realpathSync(assetDirectory)) throw new Error('Arquivo não permitido.');
    const bytes = fs.readFileSync(filename);
    return { bytes, ...rasterType(bytes) };
  }
  function importAssets(item) {
    if (Array.isArray(item)) return item.map(importAssets);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key,value]) => [key,importAssets(value)]));
    if (typeof item !== 'string') return item;
    if (/^assets\//.test(item)) {
      const suffix = item.slice(7);
      if (suffix.includes('..') || suffix.includes('\\') || suffix.includes('%') || suffix.includes('\0') || path.isAbsolute(suffix)) throw new Error('Referência de imagem inválida.');
      const source = path.join(assetDirectory, suffix);
      const resolved = fs.realpathSync(source);
      const relative = path.relative(fs.realpathSync(assetDirectory), resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(source).isSymbolicLink()) throw new Error('Referência de imagem inválida.');
      if (fs.statSync(source).size > MAX_BODY) throw new Error('Imagem excede limite.');
      return saveAsset(fs.readFileSync(source));
    }
    if (/^data:image\/(png|jpeg|webp);base64,/.test(item)) return saveAsset(Buffer.from(item.split(',')[1], 'base64'));
    return item;
  }
  if (!db.prepare('SELECT id FROM state WHERE id=1').get()) {
    const inventoryFile = path.join(storageDirectory, 'inventory.json');
    const mapsFile = path.join(storageDirectory, 'maps.json');
    for (const filename of [inventoryFile, mapsFile]) rejectLink(filename);
    if (fs.existsSync(inventoryFile) !== fs.existsSync(mapsFile)) throw new Error('Migração precisa de inventory.json e maps.json juntos.');
    const payload = fs.existsSync(inventoryFile) ? importAssets({ inventory: JSON.parse(fs.readFileSync(inventoryFile,'utf8')), maps: JSON.parse(fs.readFileSync(mapsFile,'utf8')) }) : defaults;
    validateState(payload);
    db.prepare('INSERT INTO state(id,revision,payload) VALUES(1,0,?)').run(JSON.stringify(payload));
  }
  const dummySalt = randomBytes(24).toString('hex');
  const dummyHash = scryptSync(randomBytes(24).toString('hex'), dummySalt, 64);
  return {
    db, createUser, saveAsset, readAsset,
    verifyUser(name, secret) {
      const record = db.prepare('SELECT salt,hash FROM users WHERE username=?').get(name);
      const actual = scryptSync(secret, record?.salt || dummySalt, 64);
      const valid = timingSafeEqual(actual, record ? Buffer.from(record.hash,'hex') : dummyHash);
      return !!record && valid;
    },
    getRevision() { return db.prepare('SELECT revision FROM state WHERE id=1').get().revision; },
    getState() { const row = db.prepare('SELECT revision,payload FROM state WHERE id=1').get(); return { ...JSON.parse(row.payload), revision: row.revision }; },
    putState(value, revision, author) {
      validateState(value);
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.prepare('SELECT revision,payload FROM state WHERE id=1').get();
        if (current.revision !== revision) { db.exec('ROLLBACK'); return null; }
        value = { ...value, inventory: { ...value.inventory, auditLogs: attributeAuditLogs(value.inventory.auditLogs, JSON.parse(current.payload).inventory?.auditLogs, author) } };
        const result = db.prepare('UPDATE state SET revision=revision+1,payload=? WHERE id=1 AND revision=?').run(JSON.stringify(value), revision);
        if (!result.changes) { db.exec('ROLLBACK'); return null; }
        db.prepare('INSERT INTO events(timestamp,username,revision) VALUES(?,?,?)').run(new Date().toISOString(), author, revision + 1);
        db.exec('COMMIT'); return revision + 1;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); }
  };
  } catch (error) { db.close(); throw error; }
}
