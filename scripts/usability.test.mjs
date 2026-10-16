import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeSearch, equipmentMatchesSearch, operationMatchesSearchQuery, validateNewOperation, useCompactOperationLabels } from '../src/search.js';

const reader = {
  uid: 'qa-reader', markerId: 'EQ-005', name: 'Leitor de Expedição', type: 'Reader', area: 'Logística',
  processes: ['Conferência'], hostname: 'DEV-QA-005', serial: 'QA-SERIAL-123', ip: '192.0.2.20',
  mac: '02:00:00:00:00:01', vlan: '120', owner: 'Equipe QA', model: 'Modelo QA',
};
const printer = { uid: 'qa-printer', markerId: 'PR-002', name: 'Impressora QA', type: 'Printer', serial: 'OUTRA-SERIAL', hostname: 'PRINT-QA' };
const summary = { name: 'Conferência', area: 'Logística', node: { processId: 'OP-17' }, workstream: 'Fluxo QA', operationProcesses: ['Separação'], points: [reader, printer] };

test('search finds equipment identifiers and technical fields with accent, case and hyphen tolerance', () => {
  const before = structuredClone(reader);
  for (const query of ['EQ005', 'eq-005', 'LEITOR EXPEDICAO', 'DEV-QA-005', 'QA-SERIAL-123', 'IP 192.0.2.20', 'MAC 02:00:00:00:00:01', 'VLAN 120', 'equipe qa', 'modelo QA']) {
    assert.equal(equipmentMatchesSearch(reader, query), true, query);
  }
  assert.equal(equipmentMatchesSearch(reader, 'EQ-006'), false);
  assert.equal(equipmentMatchesSearch(reader, 'IP 192.0.2.21'), false);
  assert.deepEqual(reader, before, 'search does not rewrite imported identifiers or metadata');
  assert.equal(normalizeSearch('  LOGÍSTICA\t Expedição  '), 'logistica expedicao');
});

test('global operation search includes devices but every token belongs to the operation and one matching device', () => {
  const before = structuredClone(summary);
  for (const query of ['OP17', 'conferencia', 'EQ005', 'logistica EQ005', 'OP17 192.0.2.20', 'Separacao QA-SERIAL-123', 'impressora PRINT-QA']) {
    assert.equal(operationMatchesSearchQuery(summary, query), true, query);
  }
  assert.equal(operationMatchesSearchQuery(summary, 'EQ005 PRINT-QA'), false, 'unrelated devices do not combine into a false result');
  assert.equal(operationMatchesSearchQuery(summary, 'EQ006'), false);
  assert.equal(operationMatchesSearchQuery(summary, ''), true);
  assert.equal(operationMatchesSearchQuery({ name: 'Operação vazia', points: [] }, 'EQ005'), false);
  assert.deepEqual(summary, before);
});

test('operation creation rejects empty, duplicate, control and multi-name input before saving', () => {
  const existing = ['Expedição', 'Área de Montagem'];
  for (const name of ['', '  ', 'expedicao', ' ÁREA DE MONTAGEM ', 'a'.repeat(121), 'QA\u0000TEST', 'QA\u007fTEST', 'Operação A, Operação B', 'Operação A; Operação B', 'Operação A\nOperação B', '<teste>', 'QA > destino']) {
    assert.equal(validateNewOperation(name, existing).ok, false, JSON.stringify(name));
  }
  assert.deepEqual(validateNewOperation('  Nova   Operação  ', existing), { ok: true, name: 'Nova Operação' });
  assert.deepEqual(validateNewOperation('a'.repeat(120), existing), { ok: true, name: 'a'.repeat(120) });
  assert.deepEqual(existing, ['Expedição', 'Área de Montagem']);
});

test('dense map labels compact only for an overview; selected and zoomed maps stay expanded', () => {
  assert.equal(useCompactOperationLabels(39, 1.15, false), false);
  assert.equal(useCompactOperationLabels(40, 1.15, false), true);
  assert.equal(useCompactOperationLabels(215, 1.15, false), true);
  assert.equal(useCompactOperationLabels(215, 1.5, false), false);
  assert.equal(useCompactOperationLabels(215, 2, false), false);
  assert.equal(useCompactOperationLabels(215, 1.15, true), false);
});

async function operationCreationHarness({ savingSucceeds = true } = {}) {
  // Execute the real action in isolation: this does not initialize the browser app or access private storage.
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const begin = source.indexOf('    function createProcess(');
  const end = source.indexOf('\n    function ', begin + 1);
  assert.ok(begin >= 0 && end > begin);
  const context = vm.createContext({
    validateNewOperation,
    state: { activeMapId: 'qa', processes: ['Expedição'], processNodes: [{ name: 'Expedição', x: 21, y: 34, operationProcesses: [] }], auditLogs: [] },
    selectedProcessFilter: '', selectedId: 'qa-device', selectedCableId: 'qa-cable', activeTab: 'points',
    selectionHint: { textContent: '' }, calls: { save: 0, render: 0, confirm: 0 },
    normalizeDeploymentStage: (value, fallback) => ['AS IS', 'TO DO'].includes(value) ? value : fallback,
  });
  context.processNodeByName = name => context.state.processNodes.find(node => node.name === name);
  context.upsertProcessNode = (name, x, y, workstream, area) => {
    context.state.processes.push(name);
    context.state.processNodes.push({ name, x, y, workstream, area, operationProcesses: [] });
  };
  context.recordAudit = (...event) => context.state.auditLogs.push(event);
  context.saveState = () => { context.calls.save++; return savingSucceeds; };
  context.render = () => { context.calls.render++; };
  context.alert = () => {};
  context.confirm = () => { context.calls.confirm++; throw new Error('Unexpected redundant confirmation'); };
  vm.runInContext(source.slice(begin, end), context);
  return context;
}

test('create operation validates before mutation and saves a unique operation once without a redundant dialog', async () => {
  const app = await operationCreationHarness();
  const initial = JSON.stringify(app.state);
  for (const value of ['', 'EXPEDICAO', 'Operação A,Operação B']) {
    assert.equal(app.createProcess(value), false);
    assert.equal(JSON.stringify(app.state), initial);
  }
  assert.equal(app.calls.save, 0);
  assert.equal(app.calls.render, 0);
  assert.equal(app.createProcess('  Nova   operação  ', { x: -10, y: 120 }, { area: 'Logística', deploymentStage: 'TO DO' }), true);
  const node = app.state.processNodes.find(item => item.name === 'Nova operação');
  assert.deepEqual([node.x, node.y, node.area, node.deploymentStage], [0, 100, 'Logística', 'TO DO']);
  assert.equal(app.calls.save, 1);
  assert.equal(app.calls.render, 1);
  assert.equal(app.calls.confirm, 0);
  assert.equal(app.state.auditLogs.length, 1);
  assert.equal(app.selectedProcessFilter, 'Nova operação');
});

test('failed operation save restores existing operations, audit and selection', async () => {
  const app = await operationCreationHarness({ savingSucceeds: false });
  const initial = JSON.stringify(app.state);
  assert.equal(app.createProcess('Nova operação'), false);
  assert.equal(JSON.stringify(app.state), initial);
  assert.equal(app.selectedId, 'qa-device');
  assert.equal(app.selectedCableId, 'qa-cable');
  assert.equal(app.activeTab, 'points');
  assert.equal(app.calls.render, 0);
});

test('Portuguese interface changes preserve operation link and cable endpoint identifiers', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    state: { processLinks: [{ from: 'Operação A', to: 'Operação B' }], cables: [{ uid: 'qa-cable', from: 'qa-a', to: 'qa-b', cableId: 'QA-CABLE' }] },
    listSearch: '', selectedProcessFilter: '', selectedDeploymentStage: '', selectedDeviceType: '', operationSearchTerm: '', selectedIndustrialAreaFilter: '',
    filteredPoints: () => [{ uid: 'qa-a' }, { uid: 'qa-b' }],
    pointById: uid => ({ uid, name: uid === 'qa-a' ? 'Origem QA' : 'Destino QA', processes: [uid === 'qa-a' ? 'Operação A' : 'Operação B'] }),
    pointProcesses: point => point.processes,
    pointName: point => point?.name || '',
  });
  for (const name of ['areProcessesLinked', 'cablePairExists', 'filteredCables']) {
    const begin = source.indexOf(`    function ${name}(`);
    const end = source.indexOf('\n    function ', begin + 1);
    assert.ok(begin >= 0 && end > begin);
    vm.runInContext(source.slice(begin, end), context);
  }
  assert.equal(context.areProcessesLinked('Operação A', 'Operação B'), true);
  assert.equal(context.areProcessesLinked('Operação B', 'Operação A'), true);
  assert.equal(context.areProcessesLinked('Operação C', 'Operação D'), false);
  assert.equal(context.cablePairExists('qa-b', 'qa-a'), true);
  assert.equal(context.cablePairExists('qa-a', 'qa-b', 'qa-cable'), false);
  context.selectedProcessFilter = 'Operação B';
  assert.equal(context.filteredCables().length, 1, 'cables remain visible from their destination operation');
  context.selectedProcessFilter = '';
  context.listSearch = 'destino qa';
  assert.equal(context.filteredCables().length, 1, 'destination device search resolves the cable endpoint');
});

test('Portuguese workstream labels preserve stored values during normalization', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const declaration = source.match(/const WORKSTREAMS = (\[[^;]+\]);/);
  assert.ok(declaration);
  const context = vm.createContext({ WORKSTREAMS: JSON.parse(declaration[1]) });
  const begin = source.indexOf('    function normalizeWorkstream(');
  const end = source.indexOf('\n    function ', begin + 1);
  vm.runInContext(source.slice(begin, end), context);
  assert.equal(context.normalizeWorkstream('Design to Operate'), 'Design to Operate');
  assert.equal(context.normalizeWorkstream('Plant Maintenance'), 'Plant Maintenance');
  assert.equal(context.normalizeWorkstream('Unknown QA'), '');
});

test('opening an existing inventory preserves photo keys, cable endpoints, links and coordinates', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const image = '/api/assets/' + 'a'.repeat(64) + '.png';
  const unit = {
    mapImage: image,
    points: [
      { uid: 'qa-a', markerId: 'EQ-005', name: 'Leitor QA', x: 20, y: 30, type: 'Reader', processes: ['Expedição'], photos: [image] },
      { uid: 'qa-b', markerId: 'PR-002', name: 'Impressora QA', x: 40, y: 50, type: 'Printer', processes: ['Montagem'], photos: [] },
    ],
    cables: [{ uid: 'qa-cable', from: 'qa-a', to: 'qa-b' }],
    processes: ['Expedição', 'Montagem'],
    processNodes: [
      { uid: 'qa-op-a', name: 'Expedição', processId: 'OP-01', x: 10, y: 15, area: 'Logística', workstream: 'Design to Operate' },
      { uid: 'qa-op-b', name: 'Montagem', processId: 'OP-02', x: 60, y: 70, area: 'Montagem' },
    ],
    processLinks: [{ uid: 'qa-link', from: 'Expedição', to: 'Montagem' }],
  };
  const context = vm.createContext({
    state: { activeMapId: 'qa', maps: { qa: structuredClone(unit) }, auditLogs: [] },
    DEFAULT_MAPS: { qa: { id: 'qa', image } }, FIRST_MAP_ID: 'qa', DEFAULT_MAP_ASSET: image,
    TEXT_LIMITS: { short: 120, medium: 240, long: 4000 },
    MAX_IMPORT_PROCESSES: 1000, MAX_IMPORT_PROCESS_NODES: 1000, MAX_IMPORT_PROCESS_LINKS: 1000,
    EQUIPMENT_PRESETS: { Reader: { color: '#7c3aed', shape: 'diamond' }, Printer: { color: '#123456', shape: 'square' } },
    operationsLocked: false,
    isPlainRecord: value => !!value && typeof value === 'object' && !Array.isArray(value),
    isSafeUid: uid => typeof uid === 'string' && uid.startsWith('qa-'),
    createUid: () => { throw new Error('Existing stable identifiers must survive'); },
    sanitizeText: value => String(value ?? ''), normalizeCategory: value => value,
    normalizeMac: value => value ?? '', normalizeVlan: value => value ?? '',
    normalizeDeploymentStage: value => value || 'AS IS', normalizeCountry: value => value || 'Não informado',
    normalizeEquipmentStatus: value => value || 'Online', normalizeValidationStatus: value => value,
    normalizeValidationChecklist: value => value || {}, clampIconSize: value => value, sizeNameToPixels: () => 18,
    isSafeImageDataUrl: value => value === image, pointProcesses: point => point.processes || [],
    processListFromValue: value => Array.isArray(value) ? value : [], normalizeWorkstream: value => value,
    operationColor: () => '#7c3aed', industrialAreaDefinition: () => null,
  });
  context.pointById = uid => context.state.points.find(point => point.uid === uid);
  context.saveActiveMap = () => {
    const active = context.state.maps.qa;
    for (const key of ['points', 'cables', 'processes', 'processNodes', 'processLinks']) active[key] = context.state[key];
  };
  const begin = source.indexOf('    function normalizeState(');
  const end = source.indexOf('\n    function ', begin + 1);
  vm.runInContext(source.slice(begin, end), context);
  context.normalizeState();
  const restored = structuredClone(context.state.maps.qa);
  assert.deepEqual(restored.points[0].photos, [image]);
  assert.equal(Object.hasOwn(restored.points[0], 'fotos'), false);
  assert.deepEqual(restored.points.map(point => [point.uid, point.x, point.y]), [['qa-a', 20, 30], ['qa-b', 40, 50]]);
  assert.deepEqual([restored.cables[0].from, restored.cables[0].to], ['qa-a', 'qa-b']);
  assert.deepEqual([restored.processLinks[0].from, restored.processLinks[0].to], ['Expedição', 'Montagem']);
  assert.equal(restored.processNodes[0].workstream, 'Design to Operate');
});

async function realAction(name, context) {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const begin = source.indexOf(`    function ${name}(`);
  const end = source.indexOf('\n    function ', begin + 1);
  assert.ok(begin >= 0 && end > begin);
  vm.runInContext(source.slice(begin, end), context);
  return context[name];
}

test('switching plants preserves both inventories and completes navigation even if saving is unavailable', async () => {
  for (const savingSucceeds of [true, false]) {
    const first = { mapImage: '/api/assets/' + 'a'.repeat(64) + '.png', points: [{ uid: 'qa-a', x: 20, y: 30, photos: ['qa-photo'] }], cables: [], processes: ['Origem'], processNodes: [{ name: 'Origem', x: 10, y: 15 }], processLinks: [] };
    const second = { mapImage: '/api/assets/' + 'b'.repeat(64) + '.png', points: [{ uid: 'qa-b', x: 40, y: 50, photos: [] }], cables: [], processes: ['Destino'], processNodes: [{ name: 'Destino', x: 60, y: 70 }], processLinks: [] };
    const before = JSON.stringify({ first, second });
    const context = vm.createContext({
      state: { activeMapId: 'qa_a', maps: { qa_a: first, qa_b: second }, ...first },
      DEFAULT_MAPS: { qa_a: { image: first.mapImage }, qa_b: { image: second.mapImage } }, FIRST_MAP_ID: 'qa_a', DEFAULT_MAP_ASSET: first.mapImage,
      selectedId: 'qa-a', selectedCableId: '', selectedProcessFilter: 'Origem', operationSearchTerm: 'qa-a', selectedIndustrialAreaFilter: '',
      equipmentFormDirty: false, equipmentEditMode: true, cableFormDirty: false, cableMode: false, cableStartId: null,
      photoStatus: { textContent: '', classList: { remove() {}, add() {} } }, selectionHint: { textContent: '' },
      mapZoom: 1, mapPanX: 0, mapPanY: 0, calls: { save: 0, render: 0 },
      confirmDiscardPendingChanges: () => true, saveActiveMap: () => {}, readMapView: () => ({ zoom: 1.2, panX: 15, panY: -6 }),
    });
    context.saveState = () => { context.calls.save++; return savingSucceeds; };
    context.render = () => context.calls.render++;
    const switchPlant = await realAction('switchCountry', context);
    assert.equal(switchPlant('qa_a'), false);
    assert.equal(switchPlant('unknown'), false);
    assert.equal(switchPlant('qa_b'), true);
    assert.equal(context.state.activeMapId, 'qa_b');
    assert.equal(context.state.mapImage, second.mapImage);
    assert.deepEqual(context.state.points, second.points);
    assert.equal(JSON.stringify({ first, second }), before);
    assert.deepEqual([context.mapZoom, context.mapPanX, context.mapPanY], [1.2, 15, -6]);
    assert.deepEqual([context.calls.save, context.calls.render], [1, 1]);
    if (!savingSucceeds) assert.match(context.selectionHint.textContent, /somente nesta sessão/);
  }
});

test('operation dragging saves position or restores coordinates and audit on failure', async () => {
  for (const savingSucceeds of [true, false]) {
    const node = { name: 'Operação QA', x: 40, y: 50 };
    const context = vm.createContext({
      state: { auditLogs: [{ id: 'qa-existing-audit' }] },
      processDragState: { moved: true, processName: node.name, startProcessX: 10, startProcessY: 20 },
      processNodeByName: name => name === node.name ? node : null,
      selectionHint: { textContent: 'Antes do arraste' }, suppressNextProcessClick: false,
      document: { removeEventListener() {} }, moveProcessMarker: () => {},
      setTimeout: callback => callback(), calls: { save: 0, renderMap: 0, renderList: 0, alert: 0 },
    });
    context.recordAudit = (...event) => context.state.auditLogs.push({ event });
    context.saveState = () => { context.calls.save++; return savingSucceeds; };
    context.renderMap = () => context.calls.renderMap++;
    context.renderProcessList = () => context.calls.renderList++;
    context.alert = () => context.calls.alert++;
    const stopDrag = await realAction('stopProcessDrag', context);
    stopDrag();
    assert.deepEqual([node.x, node.y], savingSucceeds ? [40, 50] : [10, 20]);
    assert.equal(context.state.auditLogs.length, savingSucceeds ? 2 : 1);
    assert.equal(context.processDragState, null);
    assert.deepEqual([context.calls.save, context.calls.renderMap, context.calls.renderList], [1, 1, 1]);
    assert.equal(context.calls.alert, savingSucceeds ? 0 : 1);
  }
});
