import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../src/index.template.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

// The template contains only placeholder text in its script/style blocks. This
// scanner inspects structural contracts, not layout or the generated private data.
function elements(html) {
  const result = [], stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b([^>]*?)>/g)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      const position = stack.findLastIndex(node => node.tag === tag);
      if (position >= 0) stack.length = position;
      continue;
    }
    const attrs = {};
    for (const attribute of match[2].matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
    }
    const node = { tag, attrs, parent: stack.at(-1) };
    result.push(node);
    if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(node);
  }
  return result;
}

const nodes = elements(template);
const byId = id => nodes.find(node => node.attrs.id === id);
const classes = node => new Set((node?.attrs.class || '').split(/\s+/));
const closestClass = (node, value) => {
  for (let current = node; current; current = current.parent) if (classes(current).has(value)) return current;
  return null;
};
const within = (node, id) => {
  for (let current = node?.parent; current; current = current.parent) if (current.attrs.id === id) return true;
  return false;
};

test('template keeps unique IDs and every control looked up when the application starts', () => {
  const ids = nodes.filter(node => node.attrs.id).map(node => node.attrs.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs make event handlers address the wrong control');
  const startupIds = [...app.matchAll(/^    const \w+ = document\.getElementById\(["']([^"']+)["']/gm)].map(match => match[1]);
  assert.ok(startupIds.length > 0, 'inspect the startup control bindings rather than an empty list');
  // These legacy actions already had optional listeners and no UI before the redesign.
  const optionalLegacyIds = new Set(['importJson', 'jsonUpload', 'clearAll']);
  assert.deepEqual(startupIds.filter(id => !optionalLegacyIds.has(id) && !byId(id)), [], 'missing startup controls');
});

test('login and editing retain form semantics, field associations and safe button types', () => {
  for (const id of ['loginForm', 'editor', 'cableEditor', 'pointForm']) assert.equal(byId(id)?.tag, 'form', id);
  assert.equal(byId('loginPassword')?.attrs.type, 'password');
  assert.equal(byId('loginPassword')?.attrs.autocomplete, 'current-password');
  assert.equal(byId('loginUsername')?.attrs.autocomplete, 'username');
  assert.equal(byId('loginButton')?.attrs.type, 'submit');
  assert.ok(within(byId('loginUsername'), 'loginForm'));
  assert.ok(within(byId('loginPassword'), 'loginForm'));
  assert.ok(within(byId('loginButton'), 'loginForm'));
  assert.ok(within(byId('equipmentName'), 'editor'));
  assert.ok(within(byId('equipmentIp'), 'editor'));
  assert.ok(nodes.some(node => node.tag === 'h2' && within(node, 'pointForm')), 'creation dialog title remains inside its form');
  assert.ok(nodes.some(node => node.tag === 'button' && node.attrs.type === 'submit' && within(node, 'pointForm')), 'creation dialog keeps a submit action');
  assert.ok(nodes.some(node => node.tag === 'label' && node.attrs.for === 'newPointProcess' && within(node, 'pointForm')));
  for (const id of ['exportHtml', 'backupJson', 'logoutButton', 'overviewHome', 'overviewSearch', 'clearOperationFilters']) {
    assert.equal(byId(id)?.tag, 'button', id);
    assert.equal(byId(id)?.attrs.type, 'button', `${id} must not submit an enclosing form`);
  }
  for (const label of nodes.filter(node => node.tag === 'label' && node.attrs.for)) {
    assert.ok(byId(label.attrs.for), `label points to a missing field: ${label.attrs.for}`);
  }
});

test('required container relationships and private initial state survive the layout redesign', () => {
  const shell = nodes.find(node => classes(node).has('map-ui-shell'));
  assert.ok(shell && Object.hasOwn(shell.attrs, 'hidden'), 'inventory shell stays hidden until authentication');
  assert.ok(closestClass(byId('countrySwitch'), 'map-ui-shell'));
  assert.ok(closestClass(byId('operationSearch'), 'overview-search-field'), 'search inserts results after its existing container');
  assert.ok(closestClass(byId('processChips'), 'process-manager'), 'linked operation controls move together into the dialog');
  for (const id of ['newPointWorkstream', 'newPointOperationArea']) assert.ok(closestClass(byId(id), 'field'), `${id} requires a field container for operation/device mode switching`);
  assert.ok(closestClass(byId('mapHolder'), 'app'));
  assert.ok(closestClass(byId('mapHolder'), 'map-stage'));
  assert.equal(byId('serverSaveStatus')?.attrs.role, 'status');
  assert.equal(byId('serverSaveStatus')?.attrs['aria-live'], 'polite');
  assert.equal(byId('loginStatus')?.attrs.role, 'alert');
});
