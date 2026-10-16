import { readFile, writeFile, mkdir, realpath, lstat, stat, mkdtemp, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rasterType as inspectRaster } from './store.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RASTER = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp' };

// Read only a small literal subset. Never evaluate scripts from an imported HTML.
export function parseMapLiteral(text, start = 0) {
  let i = start;
  const whitespace = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  function string() {
    if (text[i] !== '"') throw new Error('Somente strings JSON são aceitas nos metadados.');
    const begin = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(begin, i));
    }
    throw new Error('String de metadados incompleta.');
  }
  function value(depth = 0) {
    if (depth > 20) throw new Error('Metadados excedem a profundidade permitida.');
    whitespace();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; const result = Object.create(null); whitespace();
      while (text[i] !== '}') {
        whitespace();
        const match = text.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
        const key = text[i] === '"' ? string() : match ? (i += match[0].length, match[0]) : null;
        if (key === null || ['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) throw new Error('Chave de metadados inválida.');
        whitespace(); if (text[i++] !== ':') throw new Error('Metadados inválidos.');
        result[key] = value(depth + 1); whitespace();
        if (text[i] !== ',') break;
        i++; whitespace();
      }
      if (text[i++] !== '}') throw new Error('Objeto de metadados incompleto.');
      return result;
    }
    if (text[i] === '[') {
      i++; const result = []; whitespace();
      while (text[i] !== ']') {
        result.push(value(depth + 1)); whitespace(); if (text[i] !== ',') break;
        i++; whitespace();
      }
      if (text[i++] !== ']') throw new Error('Lista de metadados incompleta.');
      return result;
    }
    for (const [token, decoded] of [['true', true], ['false', false], ['null', null]]) {
      if (text.slice(i, i + token.length) === token) { i += token.length; return decoded; }
    }
    const number = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) { i += number[0].length; const n = Number(number[0]); if (Number.isFinite(n)) return n; }
    throw new Error('Expressões executáveis não são aceitas nos metadados.');
  }
  const result = value(); whitespace();
  if (text[i] && text[i] !== ';') throw new Error('Expressão adicional não permitida nos metadados.');
  return result;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function rasterType(bytes, ext) {
  if (inspectRaster(bytes).extension === ext) return ext;
  throw new Error('Arquivo não corresponde a uma imagem PNG, JPEG ou WebP.');
}

export async function migratePortable({ source, destination = path.join(PROJECT, 'private') }) {
  if (!source) throw new Error('Informe o caminho do HTML portátil original.');
  const sourceFile = await realpath(path.resolve(source));
  const sourceRoot = path.dirname(sourceFile);
  destination = path.resolve(destination);
  if (inside(destination, sourceFile)) throw new Error('A origem precisa estar fora do destino.');
  try { await lstat(destination); throw new Error('O destino já existe. Use uma pasta privada nova; não será sobrescrito.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = path.dirname(destination);
  for (let ancestor = parent; ; ancestor = path.dirname(ancestor)) {
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('O destino não pode estar dentro de um link.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(ancestor) === ancestor) break;
  }
  const sourceStat = await stat(sourceFile);
  if (!sourceStat.isFile() || sourceStat.size > 64 * 1024 * 1024) throw new Error('HTML inválido ou maior que 64 MB.');
  const html = await readFile(sourceFile, 'utf8');
  const embedded = html.match(/<script\b[^>]*\bid=["']embeddedData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!embedded) throw new Error('Não foi encontrado inventário JSON no HTML.');
  const inventory = JSON.parse(embedded[1]);
  if (!inventory || !inventory.maps || typeof inventory.maps !== 'object' || Array.isArray(inventory.maps)) throw new Error('Inventário de mapas inválido.');
  const declaration = html.match(/\bconst\s+DEFAULT_MAPS\s*=\s*/);
  if (!declaration) throw new Error('Não foram encontrados metadados dos mapas.');
  const maps = parseMapLiteral(html, declaration.index + declaration[0].length);
  if (Object.keys(inventory.maps).some(id => !Object.hasOwn(maps, id))) throw new Error('Inventário e metadados possuem mapas diferentes.');
  const assets = new Map();
  async function convert(value, depth = 0) {
    if (depth > 40) throw new Error('Inventário excede a profundidade permitida.');
    if (Array.isArray(value)) return Promise.all(value.map(item => convert(item, depth + 1)));
    if (value && typeof value === 'object') {
      const entries = [];
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Chave de inventário inválida.');
        entries.push([key, await convert(item, depth + 1)]);
      }
      return Object.fromEntries(entries);
    }
    if (typeof value !== 'string') return value;
    let bytes, ext;
    if (/^data:image\//i.test(value)) {
      const match = value.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
      if (!match) throw new Error('Imagem embutida não suportada.');
      bytes = Buffer.from(match[2], 'base64'); ext = RASTER[match[1].toLowerCase()];
      if (bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) throw new Error('Imagem base64 inválida.');
    } else if (/^assets\//i.test(value)) {
      let decoded = value;
      for (let pass = 0; pass < 5; pass++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
      if (decoded.includes('%') || decoded.includes('\\') || decoded.includes('\0')) throw new Error('Referência de imagem inválida.');
      const assetsRoot = await realpath(path.join(sourceRoot, 'assets'));
      const file = await realpath(path.resolve(sourceRoot, decoded));
      if (!inside(assetsRoot, file)) throw new Error('Imagem fora da pasta autorizada.');
      ext = RASTER[path.extname(file).slice(1).toLowerCase()];
      if (!ext) throw new Error('Formato de imagem não suportado.');
      const imageStat = await stat(file);
      if (!imageStat.isFile() || imageStat.size > 12 * 1024 * 1024) throw new Error('Imagem inválida ou maior que 12 MB.');
      bytes = await readFile(file);
    } else return value;
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('Imagem vazia ou maior que 12 MB.');
    rasterType(bytes, ext);
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    if (!assets.has(name)) assets.set(name, bytes);
    return `assets/${name}`;
  }
  const restoredInventory = await convert(inventory);
  const restoredMaps = await convert(maps);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, '.mapa-migration-'));
  let published = false;
  try {
    await mkdir(path.join(staging, 'assets'), { mode: 0o700 });
    for (const [name, bytes] of assets) {
      await writeFile(path.join(staging, 'assets', name), bytes, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(path.join(staging, 'inventory.json'), JSON.stringify(restoredInventory, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(staging, 'maps.json'), JSON.stringify(restoredMaps, null, 2), { flag: 'wx', mode: 0o600 });
    try { await lstat(destination); throw new Error('O destino foi criado por outro processo.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, destination);
    published = true;
  } finally {
    if (!published) {
      const resolvedStaging = await realpath(staging);
      const resolvedParent = await realpath(parent);
      if (path.dirname(resolvedStaging) !== resolvedParent || !path.basename(resolvedStaging).startsWith('.mapa-migration-')) throw new Error('Limpeza de migração fora do destino esperado.');
      await rm(resolvedStaging, { recursive: true, force: true });
    }
  }
  const summary = {
    units: Object.keys(inventory.maps).length,
    equipment: Object.values(inventory.maps).reduce((total, map) => total + (map.points?.length || 0), 0),
    operations: Object.values(inventory.maps).reduce((total, map) => total + (map.processes?.length || 0), 0),
    history: inventory.auditLogs?.length || 0,
    assets: assets.size,
  };
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , source, destination] = process.argv;
  migratePortable({ source, destination }).then(summary => {
    console.log('Migração privada concluída:', JSON.stringify(summary));
  }).catch(() => { console.error('Migração interrompida. Confira se a origem é um HTML portátil válido e se o destino é uma pasta privada nova. Nenhum script da origem é executado.'); process.exitCode = 1; });
}
