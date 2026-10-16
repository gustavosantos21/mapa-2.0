import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_MARKER = '/*@@DEFAULT_MAPS@@*/ {}';
// HTML parsing normalizes CRLF and CR before CSP hashes are checked.
const normalizeLineEndings = text => text.replace(/\r\n?/g, '\n');

export function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function applicationCsp(applicationScript) {
  const digest = createHash('sha256').update(normalizeLineEndings(applicationScript), 'utf8').digest('base64');
  return `default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; font-src data:; object-src 'none'; base-uri 'none'; form-action 'self'`;
}

export async function build({ root = PROJECT_ROOT, demo = false, out = 'dist' } = {}) {
  root = path.resolve(root);
  // Distribution contains only the application shell. Private state is loaded
  // after authentication from the server and is never read by the builder.
  const dataDirectory = path.join(root, 'data');
  const [rawTemplate, rawCss, rawSourceScript, rawSearchHelpers, rawEquipmentHelpers, inventoryText, mapsText] = await Promise.all([
    readFile(path.join(root, 'src', 'index.template.html'), 'utf8'),
    readFile(path.join(root, 'src', 'app.css'), 'utf8'),
    readFile(path.join(root, 'src', 'app.js'), 'utf8'),
    readFile(path.join(root, 'src', 'search.js'), 'utf8'),
    readFile(path.join(root, 'src', 'equipment-map.js'), 'utf8'),
    readFile(path.join(dataDirectory, 'example-inventory.json'), 'utf8'),
    readFile(path.join(dataDirectory, 'default-maps.json'), 'utf8'),
  ]);
  const [template, css, sourceScript] = [rawTemplate, rawCss, rawSourceScript].map(normalizeLineEndings);
  const inventorySource = JSON.parse(inventoryText);
  const mapsSource = JSON.parse(mapsText);
  if (!inventorySource || typeof inventorySource !== 'object' || Array.isArray(inventorySource) || !inventorySource.maps || typeof inventorySource.maps !== 'object' || Array.isArray(inventorySource.maps)) {
    throw new Error('O inventário deve ser um objeto JSON com a coleção maps.');
  }
  for (const [mapId, map] of Object.entries(inventorySource.maps)) {
    if (!map || !Array.isArray(map.points)) throw new Error(`O mapa ${mapId} precisa conter uma lista points.`);
    if (Object.values(map).some(value => (Array.isArray(value) && value.length > 0) || (typeof value === 'string' && value))) throw new Error('O build aceita apenas mapas vazios; mantenha os dados no servidor privado.');
  }
  if (!mapsSource || typeof mapsSource !== 'object' || Array.isArray(mapsSource)) throw new Error('Os mapas devem ser um objeto JSON.');
  if (Object.values(mapsSource).some(map => map.image)) throw new Error('Plantas reais devem permanecer no armazenamento privado.');
  const inventory = inventorySource;
  const maps = mapsSource;
  if (sourceScript.split(MAPS_MARKER).length !== 2) throw new Error('O código precisa conter exatamente um marcador DEFAULT_MAPS.');
  // These pure helpers are shared by browser and tests. Only named function
  // exports are accepted; no runtime import/evaluation is needed in the shell.
  const searchHelpers = normalizeLineEndings(rawSearchHelpers).replace(/^export function /gm, 'function ');
  if (/^\s*(?:import|export)\b/m.test(searchHelpers)) throw new Error('Helper de busca contém um módulo não suportado.');
  const equipmentHelpers = normalizeLineEndings(rawEquipmentHelpers).replace(/^export function /gm, 'function ');
  if (/^\s*(?:import|export)\b/m.test(equipmentHelpers)) throw new Error('Helper do mapa contém um módulo não suportado.');
  const script = searchHelpers + '\n' + equipmentHelpers + '\n' + sourceScript.replace(MAPS_MARKER, () => safeJson(maps));
  if (/<\/script[\s>]/i.test(script)) throw new Error('O código contém um fechamento de script que impede a distribuição segura.');
  const replacements = { '@@APP_CSS@@': css, '@@APP_JS@@': script, '@@INVENTORY@@': safeJson(inventory) };
  let html = template;
  for (const [marker, replacement] of Object.entries(replacements)) {
    if (html.split(marker).length !== 2) throw new Error(`O modelo precisa conter exatamente um marcador ${marker}.`);
    html = html.replace(marker, () => replacement);
  }
  const scriptMatch = html.match(/<script\s+id=["']applicationScript["']\s*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('O modelo precisa conter o script applicationScript.');
  const csp = applicationCsp(scriptMatch[1]);
  if (html.split('@@CSP@@').length !== 2) throw new Error('O modelo precisa conter exatamente um marcador CSP.');
  html = html.replace('@@CSP@@', () => csp);
  if (/@@(?:APP_CSS|APP_JS|INVENTORY|CSP|DEFAULT_MAPS)@@/.test(html)) throw new Error('Há marcadores pendentes na página.');
  const outputDirectory = path.resolve(root, out);
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, 'index.html');
  await writeFile(outputFile, html, 'utf8');
  const count = Object.values(inventory.maps).reduce((total, map) => total + map.points.length, 0);
  return { outputFile, dataMode: 'shell', count, csp };
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--demo') options.demo = true;
    else if (args[index] === '--out' && args[index + 1] && !args[index + 1].startsWith('--')) options.out = args[++index];
    else throw new Error(`Argumento desconhecido ou incompleto: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build(parseArguments(process.argv.slice(2))).then(result => {
    console.log(`Aplicação pronta: ${result.outputFile}. Dados privados serão carregados após o login.`);
  }).catch(error => { console.error(`Falha ao montar a página: ${error.message}`); process.exitCode = 1; });
}
