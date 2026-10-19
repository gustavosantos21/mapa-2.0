import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute production functions with an isolated DOM/state. No private database or app server is opened.
const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const match = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, name);
  const begin = match.index;
  const end = /^    }\r?$/m.exec(source.slice(begin));
  assert.ok(end, name + ' end');
  return source.slice(begin, begin + end.index + end[0].length);
}
function element({ parentElement = null, hidden = false, display = '', tagName = 'DIV', open = false, classes = [] } = {}) {
  return { parentElement, hidden, style: { display }, tagName, open, classList: { contains: name => classes.includes(name) } };
}

test('closed panels skip expensive report and inventory builders; ancestor visibility is respected', () => {
  const details = element({ tagName: 'DETAILS', open: false });
  const target = element({ parentElement: details });
  const context = vm.createContext({ qaReport: target, auditLogPanel: target, inventoryDashboard: target,
    document: { getElementById: () => target }, DEFAULT_MAPS: { demo: { label: 'Demo' } },
    state: { activeMapId: 'demo' }, selectedProcessFilter: '', showEquipmentLayer: false,
    allInventoryPoints: () => { throw new Error('Hidden inventory must not be aggregated'); },
    buildDataQualityIssues: () => { throw new Error('Hidden issues must not be calculated'); },
  });
  for (const name of ['panelIsVisible', 'renderOverviewOverview', 'renderDashboard', 'renderQaReport', 'renderAuditLog']) vm.runInContext(functionSource(name), context);
  context.renderDashboard(); context.renderQaReport(); context.renderAuditLog();
  assert.equal(context.panelIsVisible(target), false);
  details.open = true;
  assert.equal(context.panelIsVisible(target), true);
  details.style.display = 'none';
  assert.equal(context.panelIsVisible(target), false);
  details.style.display = ''; details.hidden = true;
  assert.equal(context.panelIsVisible(target), false);
});

test('only the active list is built, and opening the exploration panel exposes the current list', () => {
  let visible = false;
  const details = element({ tagName: 'DETAILS' });
  const target = element({ parentElement: details });
  Object.defineProperty(target, 'innerHTML', { set() { throw new Error('Visible list reached its real DOM builder'); } });
  const context = vm.createContext({ activeTab: 'processes', equipmentList: target, cableList: target, processList: target,
    panelIsVisible: () => visible });
  for (const name of ['renderList', 'renderCableList', 'renderProcessList']) vm.runInContext(functionSource(name), context);
  context.renderList(); context.renderCableList(); context.renderProcessList();
  visible = true;
  context.renderList(); context.renderCableList();
  assert.throws(() => context.renderProcessList(), /real DOM builder/);
  context.activeTab = 'points';
  context.renderCableList(); context.renderProcessList();
  assert.throws(() => context.renderList(), /real DOM builder/);
});

test('rapid typing coalesces into one search using the final text without changing keyboard focus', () => {
  const timers = new Map(); let timerId = 0; let listener; const calls = [];
  const input = { value: '', addEventListener: (_event, fn) => { listener = fn; } };
  const context = vm.createContext({ operationSearch: input, operationSearchTimer: null, selectedIndustrialAreaFilter: '',
    clearTimeout: id => timers.delete(id),
    setTimeout: (fn, ms) => { assert.equal(ms, 120); timers.set(++timerId, fn); return timerId; },
    refreshOperationFilterResults: (text, area) => { calls.push([text, area]); return true; },
  });
  const begin = source.indexOf('    operationSearch.addEventListener("input"');
  const end = source.indexOf('    industrialAreaFilters.addEventListener', begin);
  vm.runInContext(source.slice(begin, end), context);
  for (const text of ['E', 'EQ', 'EQ005']) { input.value = text; listener(); }
  assert.equal(timers.size, 1); assert.equal(calls.length, 0);
  [...timers.values()][0]();
  assert.deepEqual(calls, [['EQ005', '']]); assert.equal(input.value, 'EQ005');
  assert.equal(context.operationSearchTimer, null);
});

test('immediate filter changes cancel delayed search and preserve a rejected unsaved draft', () => {
  const cleared = []; const controls = { deploymentFilter: {}, deviceTypeFilter: {} };
  const context = vm.createContext({ operationSearchTimer: 7, clearTimeout: id => cleared.push(id),
    operationSearchTerm: 'Original', selectedIndustrialAreaFilter: '', selectedDeploymentStage: 'AS IS', selectedDeviceType: 'Reader',
    operationSearch: { value: 'Pending query' }, document: { getElementById: id => controls[id] },
    equipmentFormDirty: true, cableFormDirty: false, confirmDiscardPendingChanges: () => false,
  });
  vm.runInContext(functionSource('refreshOperationFilterResults'), context);
  assert.equal(context.refreshOperationFilterResults('New', '', 'TO DO', ''), false);
  assert.deepEqual(cleared, [7]); assert.equal(context.operationSearchTimer, null);
  assert.equal(context.operationSearch.value, 'Original'); assert.equal(context.equipmentFormDirty, true);
  assert.equal(controls.deploymentFilter.value, 'AS IS'); assert.equal(controls.deviceTypeFilter.value, 'Reader');
});

test('selection and home cancel queued search even when a dirty form prevents navigation', () => {
  for (const name of ['selectPoint', 'selectCable', 'selectProcess', 'returnToOperationsHome']) {
    const cancelled = [];
    const context = vm.createContext({ operationSearchTimer: 17, clearTimeout: id => cancelled.push(id),
      confirmDiscardPendingChanges: () => false, selectedId: 'draft-equipment', equipmentFormDirty: true });
    vm.runInContext(functionSource(name), context);
    assert.equal(context[name]('new-selection'), false);
    assert.deepEqual(cancelled, [17]); assert.equal(context.operationSearchTimer, null);
    assert.equal(context.selectedId, 'draft-equipment'); assert.equal(context.equipmentFormDirty, true);
  }
});

test('filter refresh updates affected views without rebuilding selector or unrelated dashboards', () => {
  const calls = [];
  const controls = { deploymentFilter: {}, deviceTypeFilter: {} };
  const context = vm.createContext({ operationSearchTimer: 17, clearTimeout() {}, operationSearchTerm: 'Old',
    selectedIndustrialAreaFilter: '', selectedDeploymentStage: '', selectedDeviceType: '',
    operationSearch: { value: 'EQ005' }, document: { getElementById: id => controls[id] },
    EQUIPMENT_PRESETS: { Reader: {} }, confirmDiscardPendingChanges: () => true,
  });
  for (const name of ['renderMetrics', 'renderOperationSidebar', 'renderMap', 'renderEditor', 'renderCableEditor',
    'renderTabs', 'renderQaReport', 'renderList', 'renderCableList', 'renderProcessList']) context[name] = () => calls.push(name);
  for (const name of ['render', 'renderCountrySwitch', 'renderDashboard', 'renderAuditLog']) context[name] = () => assert.fail('Unrelated view rebuilt: ' + name);
  vm.runInContext(functionSource('refreshOperationFilterResults'), context);
  assert.equal(context.refreshOperationFilterResults('EQ005', 'Logística', 'AS IS', 'Reader'), true);
  assert.equal(context.operationSearchTimer, null);
  assert.equal(context.operationSearchTerm, 'EQ005'); assert.equal(context.selectedIndustrialAreaFilter, 'Logística');
  assert.equal(context.selectedDeploymentStage, 'AS IS'); assert.equal(context.selectedDeviceType, 'Reader');
  assert.equal(context.selectedId, null); assert.ok(calls.includes('renderMap')); assert.ok(calls.includes('renderTabs'));
});

function pollHarness(api) {
  const calls = [];
  const context = vm.createContext({ api: url => { calls.push(url); return api(url, context); },
    remotePollInFlight: false, operationSearchTimer: null, memoryOnlyChanges: false, equipmentFormDirty: false,
    cableFormDirty: false, savePromise: null, saveConflict: false, serverRevision: 3,
    document: { hidden: false, getElementById: () => ({ hidden: true }) },
    DEFAULT_MAPS: { old: {} }, MAP_ORDER: ['old'], state: { inventory: 'local' }, structuredClone,
    normalizeState: () => calls.push('normalize'), render: () => calls.push('render'), saveStatus: text => calls.push(text),
    selectedId: 'local-selection', selectedCableId: null,
  });
  vm.runInContext(functionSource('canApplyRemoteState'), context);
  vm.runInContext(functionSource('pollRemoteState'), context);
  return { context, calls };
}

test('unchanged revision downloads no inventory and changed revision refreshes only once', async () => {
  let revision = 3;
  const { context, calls } = pollHarness(async url => url === '/api/revision' ? { revision } :
    { revision, maps: { demo: {} }, inventory: { maps: { demo: {} } } });
  await context.pollRemoteState(); assert.deepEqual(calls, ['/api/revision']);
  revision = 4; calls.length = 0;
  await context.pollRemoteState();
  assert.deepEqual(calls.slice(0, 4), ['/api/revision', '/api/state', 'normalize', 'render']);
  assert.equal(context.serverRevision, 4); assert.equal(context.selectedId, null);
  assert.equal(context.remotePollInFlight, false);
});

test('poll preserves drafts and conflicts that begin during either request', async () => {
  for (const at of ['/api/revision', '/api/state']) {
    for (const field of ['equipmentFormDirty', 'cableFormDirty', 'memoryOnlyChanges', 'saveConflict']) {
      const { context, calls } = pollHarness(async (url, ctx) => {
        if (url === at) ctx[field] = true;
        return { revision: 4, maps: { demo: {} }, inventory: { maps: { demo: {} } } };
      });
      const original = context.state;
      await context.pollRemoteState();
      assert.equal(context.state, original, `${at}: ${field}`);
      assert.equal(context.serverRevision, 3); assert.equal(context.selectedId, 'local-selection');
      assert.equal(calls.includes('render'), false); assert.equal(context.remotePollInFlight, false);
      if (at === '/api/revision') assert.deepEqual(calls, ['/api/revision']);
    }
  }
});

test('poll avoids overlap, skips hidden pages and pending searches, and unlocks after a network failure', async () => {
  let release;
  const { context, calls } = pollHarness(() => new Promise(resolve => { release = resolve; }));
  context.document.hidden = true; await context.pollRemoteState();
  context.document.hidden = false; context.operationSearchTimer = 12; await context.pollRemoteState();
  assert.equal(calls.length, 0);
  context.operationSearchTimer = null;
  const first = context.pollRemoteState(); await context.pollRemoteState();
  assert.deepEqual(calls, ['/api/revision']);
  release({ revision: 3 }); await first; assert.equal(context.remotePollInFlight, false);
  context.api = async () => { throw new Error('Disconnected'); };
  await context.pollRemoteState(); assert.equal(context.remotePollInFlight, false);
  assert.equal(calls.at(-1), 'Sem conexão com o servidor.');
});
