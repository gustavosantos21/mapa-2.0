import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { groupEquipmentMarkers } from '../src/equipment-map.js';
import { normalizeSearch } from '../src/search.js';

const viewport = { width: 1000, height: 800, cellSize: 52 };
const equipment = (uid, x, y, extra = {}) => ({ uid, x, y, name: `Equipamento ${uid}`, ...extra });
const membership = groups => groups.map(group => group.points.map(point => point.uid).sort()).sort((a, b) => a.join().localeCompare(b.join()));

test('nearby equipment groups without operation navigation and preserves imported equipment', () => {
  const points = [equipment('a', 22, 22, { processes: ['Montagem'] }), equipment('b', 23, 23, { processes: ['Expedição'] }), equipment('c', 80, 80, { processes: [] })];
  const before = structuredClone(points);
  const groups = groupEquipmentMarkers(points, viewport);
  assert.deepEqual(membership(groups), [['a', 'b'], ['c']]);
  const nearby = groups.find(group => group.points.length === 2);
  assert.equal(nearby.x, 22.5); assert.equal(nearby.y, 22.5);
  assert.equal(new Set(groups.map(group => group.key)).size, groups.length);
  assert.deepEqual(points, before, 'grouping never changes coordinates, identity or operation membership');
});

test('group identity and membership remain stable when inventory ordering changes', () => {
  const points = [equipment('a', 22, 22), equipment('b', 23, 23), equipment('c', 80, 80)];
  const summarize = groups => groups.map(group => [group.key, group.x, group.y, group.points.map(point => point.uid).sort()]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(summarize(groupEquipmentMarkers(points, viewport)), summarize(groupEquipmentMarkers([...points].reverse(), viewport)));
});

test('selected equipment remains directly accessible beside its collapsed neighbours', () => {
  const points = [equipment('a', 22, 22), equipment('b', 23, 23), equipment('c', 24, 24)];
  const groups = groupEquipmentMarkers(points, { ...viewport, selectedId: 'b' });
  assert.deepEqual(membership(groups), [['a', 'c'], ['b']]);
  assert.equal(groups.find(group => group.points[0]?.uid === 'b').points[0], points[1]);
  assert.equal(new Set(groups.map(group => group.key)).size, groups.length);
});

test('zoomed map separates nearby equipment and filtered inputs do not resurrect omitted equipment', () => {
  const points = [equipment('a', 22, 22), equipment('b', 25, 22)];
  assert.deepEqual(membership(groupEquipmentMarkers(points, viewport)), [['a', 'b']]);
  assert.deepEqual(membership(groupEquipmentMarkers(points, { ...viewport, width: 4000, height: 3200 })), [['a'], ['b']]);
  assert.deepEqual(membership(groupEquipmentMarkers([points[1]], viewport)), [['b']]);
  assert.deepEqual(groupEquipmentMarkers([], viewport), []);
});

test('invalid map coordinates never create misleading equipment markers', () => {
  const invalid = [equipment('nan', NaN, 20), equipment('infinity', 20, Infinity), equipment('missing', undefined, 20), equipment('null', null, 20), equipment('negative', -1, 20), equipment('outside', 101, 20)];
  const groups = groupEquipmentMarkers([equipment('edge-start', 0, 0), equipment('edge-end', 100, 100), ...invalid], viewport);
  assert.deepEqual(membership(groups), [['edge-end'], ['edge-start']]);
});

test('duplicate or missing identities do not show the same equipment twice', () => {
  const first = equipment('a', 22, 22);
  const groups = groupEquipmentMarkers([first, equipment('a', 25, 25), equipment('', 23, 23), null], viewport);
  assert.deepEqual(membership(groups), [['a']]);
  assert.equal(groups[0].points[0], first);
});

async function action(name, context) {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const match = new RegExp('^    function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, `${name} exists`);
  const end = /^    }\r?$/m.exec(source.slice(match.index));
  assert.ok(end, `${name} ends`);
  vm.runInContext(source.slice(match.index, match.index + end.index + end[0].length), context);
  return context[name];
}

function navigationContext(allowDiscard) {
  const calls = [];
  const context = vm.createContext({ selectedId: 'current', selectedCableId: null, activeTab: 'points',
    selectedProcessFilter: 'Montagem', operationSearchTerm: 'EQ005', selectedIndustrialAreaFilter: 'Produção',
    selectedDeploymentStage: 'AS IS', selectedDeviceType: 'Reader', listSearch: 'leitor',
    mapZoom: 2.5, mapPanX: 40, mapPanY: -30,
    operationSearchTimer: 12, equipmentSearchResultsOpen: true, equipmentFormDirty: true, equipmentEditMode: true, cableFormDirty: false,
    clearTimeout: id => calls.push(['clearTimeout', id]),
    confirmDiscardPendingChanges: () => { calls.push(['confirm']); return allowDiscard; },
    setInspectorCollapsed: value => calls.push(['inspector', value]),
    render: () => calls.push(['render']),
    operationSearch: { focus: options => calls.push(['focusSearch', options.preventScroll]) },
    mapStage: { focus: options => calls.push(['focusMap', options.preventScroll]) },
    document: { getElementById: () => ({ hidden: false, setAttribute() {} }) },
    closeContextMenus: () => calls.push(['closeMenus']),
    navigationSection: 'map', contextPanelOpen: false, contextUsesOverlay: () => false,
    showEquipmentLayer: false, showOperationLayer: true,
    renderContextNavigation: () => calls.push(['navigation']),
    renderMetrics() {}, renderLayerButtons() {}, renderOverviewOverview() {},
  });
  return { context, calls };
}
const preserved = context => [context.selectedProcessFilter, context.operationSearchTerm, context.selectedIndustrialAreaFilter,
  context.selectedDeploymentStage, context.selectedDeviceType, context.listSearch, context.mapZoom, context.mapPanX, context.mapPanY];

test('direct equipment selection keeps map position and filters while opening consultation once', async () => {
  const { context, calls } = navigationContext(true);
  const before = preserved(context);
  const select = await action('selectPoint', context);
  assert.equal(select('destination'), true);
  assert.equal(context.selectedId, 'destination');
  assert.equal(context.equipmentFormDirty, false);
  assert.equal(context.equipmentEditMode, false, 'selection opens consultation until Edit is explicitly requested');
  assert.equal(context.equipmentSearchResultsOpen, false, 'opening consultation dismisses suggestions without clearing the search query');
  assert.equal(context.selectedCableId, null);
  assert.equal(context.activeTab, 'points');
  assert.deepEqual(preserved(context), before);
  assert.equal(calls.filter(call => call[0] === 'render').length, 1);
  assert.ok(calls.some(call => call[0] === 'inspector' && call[1] === true), 'selection keeps the editing inspector collapsed');
});

test('consultation card exposes no editable fields and starts hidden before selection', async () => {
  const template = await readFile(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const card = template.match(/<section\b[^>]*\bid="equipmentSummary"[^>]*>[\s\S]*?<\/section>/);
  assert.ok(card, 'read-only equipment consultation card is present');
  assert.match(card[0], /\bhidden\b/);
  assert.doesNotMatch(card[0], /<(?:input|select|textarea|form)\b/);
  for (const id of ['summaryCloseEquipment', 'summaryLocateEquipment', 'summaryEditEquipment']) {
    assert.match(card[0], new RegExp('<button\\b[^>]*\\bid="' + id + '"[^>]*\\btype="button"'));
  }
});

test('closing equipment restores the map without clearing search, filters or map position', async () => {
  const { context, calls } = navigationContext(true);
  const before = preserved(context);
  const close = await action('closeEquipmentEditor', context);
  assert.equal(close(), true);
  assert.equal(context.selectedId, null);
  assert.equal(context.equipmentFormDirty, false);
  assert.deepEqual(preserved(context), before);
  assert.ok(calls.some(call => call[0] === 'inspector' && call[1] === true));
  assert.equal(calls.filter(call => call[0] === 'render').length, 1);
  assert.ok(calls.some(call => call[0] === 'focusMap' && call[1] === true), 'focus returns to the map without reopening search suggestions');
});

test('declining draft discard prevents both changing equipment and closing its editor', async () => {
  for (const name of ['selectPoint', 'closeEquipmentEditor']) {
    const { context, calls } = navigationContext(false);
    const before = preserved(context);
    const execute = await action(name, context);
    assert.equal(execute('destination'), false);
    assert.equal(context.selectedId, 'current');
    assert.equal(context.equipmentFormDirty, true);
    assert.equal(context.equipmentEditMode, true);
    assert.equal(context.equipmentSearchResultsOpen, true, 'declining discard preserves the current search state');
    assert.deepEqual(preserved(context), before);
    assert.equal(calls.some(call => ['render', 'inspector'].includes(call[0])), false);
  }
});

test('equipment group opens a direct choice and closes only when selecting equipment succeeds', async () => {
  const buttons = [], selected = [];
  let allowSelection = false;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const title = {};
  const list = { replaceChildren() { buttons.length = 0; }, append(button) { buttons.push(button); } };
  const context = vm.createContext({
    document: {
      getElementById: id => ({ equipmentGroupDialog: dialog, equipmentGroupList: list, equipmentGroupTitle: title }[id]),
      createElement: tag => ({ tag, append(...children) { this.children = children; }, addEventListener(event, callback) { this[event] = callback; } }),
    },
    processText: point => point.processes?.join(', ') || '',
    uiLabel: value => ({ Reader: 'Leitor', Printer: 'Impressora' }[value] || value),
    selectPoint: uid => { selected.push(uid); return allowSelection; },
  });
  const open = await action('openEquipmentGroup', context);
  const points = [equipment('a', 22, 22, { markerId: 'EQ005', processes: ['Montagem'] }), equipment('b', 23, 23, { markerId: 'EQ006', processes: ['Expedição'] })];
  open({ points });
  assert.equal(dialog.open, true); assert.equal(buttons.length, 2);
  assert.match(title.textContent, /2 equipamentos/);
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].children[0].textContent, 'EQ005');
  buttons[0].click();
  assert.deepEqual(selected, ['a']); assert.equal(dialog.open, true, 'declining an unsaved draft leaves the chooser available');
  allowSelection = true; buttons[1].click();
  assert.deepEqual(selected, ['a', 'b']); assert.equal(dialog.open, false);
});

test('reused map markers open their current equipment instead of a stale earlier selection', async () => {
  const markers = [], selections = [], groups = [];
  let visible = [equipment('a', 22, 22)];
  const context = vm.createContext({
    state: { mapImage: '/synthetic.png' }, showEquipmentLayer: true, showLabelLayer: true, selectedId: null,
    filteredPoints: () => visible, groupEquipmentMarkers,
    mapHolder: { offsetWidth: 1000, offsetHeight: 800, querySelectorAll: () => markers, append(marker) { markers.push(marker); } },
    document: { createElement: tag => ({ tag, dataset: {}, style: { setProperty() {} },
      setAttribute(name, value) { this[name] = value; }, addEventListener(name, callback) { this[name] = callback; },
      remove() { markers.splice(markers.indexOf(this), 1); },
    }) },
    selectPoint: uid => selections.push(uid), openEquipmentGroup: group => groups.push(group), pointName: point => point.name,
  });
  const render = await action('renderEquipmentMarkers', context);
  render();
  assert.equal(markers.length, 1);
  const original = markers[0];
  original.click({ stopPropagation() {} });
  assert.deepEqual(selections, ['a']);
  visible = [equipment('b', 23, 23)]; render();
  assert.equal(markers[0], original, 'same map cell reuses its existing marker');
  original.click({ stopPropagation() {} });
  assert.deepEqual(selections, ['a', 'b'], 'click resolves the refreshed equipment rather than a captured earlier UID');
  visible = [equipment('b', 23, 23), equipment('c', 24, 24)]; render();
  original.click({ stopPropagation() {} });
  assert.deepEqual(selections, ['a', 'b']); assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].points.map(point => point.uid), ['b', 'c']);
  visible = []; render(); assert.equal(markers.length, 0, 'filtering removes stale markers');
});

test('consultation renders imported equipment as inert text and never changes stored data or editing mode', async () => {
  const ids = ['equipmentSummary', 'equipmentSummaryName', 'equipmentSummaryCode', 'equipmentSummaryStatus', 'equipmentSummaryType', 'equipmentSummaryOperation', 'summaryLocateEquipment', 'focusEquipmentDrawer'];
  const controls = Object.fromEntries(ids.map(id => [id, { hidden: true, dataset: {} }]));
  for (const control of Object.values(controls)) Object.defineProperty(control, 'innerHTML', { set() { assert.fail('Imported fields must not be parsed as markup'); } });
  const point = equipment('qa', 20, 30, { name: '<img src=x onerror=alert(1)>', markerId: 'EQ<005>', status: 'Online', type: 'Reader', processes: ['<script>unsafe()</script>'] });
  const before = structuredClone(point);
  const context = vm.createContext({ equipmentEditMode: false, equipmentFormDirty: false, state: { mapImage: '/synthetic.png' }, contextUsesOverlay: () => false,
    document: { getElementById: id => controls[id] }, selectedPoint: () => point,
    normalizeEquipmentStatus: value => value, uiLabel: value => value === 'Reader' ? 'Leitor' : value,
    processText: value => value.processes?.join(', ') || '', saveState: () => assert.fail('Consultation must not save'),
  });
  const render = await action('renderEquipmentSummary', context);
  render();
  assert.equal(controls.equipmentSummary.hidden, false);
  assert.equal(controls.equipmentSummaryName.textContent, point.name);
  assert.equal(controls.equipmentSummaryCode.textContent, point.markerId);
  assert.equal(controls.equipmentSummaryOperation.textContent, point.processes[0]);
  assert.equal(controls.equipmentSummaryType.textContent, 'Leitor');
  assert.equal(controls.summaryLocateEquipment.disabled, false);
  assert.deepEqual(point, before);
  assert.equal(context.equipmentEditMode, false); assert.equal(context.equipmentFormDirty, false);
  context.equipmentEditMode = true; render(); assert.equal(controls.equipmentSummary.hidden, true);
  render({ ...point, x: NaN }); assert.equal(controls.summaryLocateEquipment.disabled, true, 'unpositioned equipment cannot be located at a fictitious map position');
  render(null); assert.equal(controls.equipmentSummary.hidden, true);
});

test('editing opens explicitly and returning to consultation preserves selected equipment and map context', async () => {
  const { context, calls } = navigationContext(true);
  context.equipmentEditMode = false; context.equipmentFormDirty = false;
  context.selectedPoint = () => ({ uid: context.selectedId });
  context.renderEditor = () => calls.push(['renderEditor']);
  context.equipmentId = { focus: options => calls.push(['focusId', options.preventScroll]) };
  const controls = { focusEquipmentDrawer: { hidden: false }, openEquipmentList: { setAttribute() {} }, summaryEditEquipment: { focus: options => calls.push(['focusEdit', options.preventScroll]) } };
  context.document = { getElementById: id => controls[id] };
  const before = preserved(context);
  const start = await action('startEquipmentEditing', context);
  const close = await action('closeEquipmentEditing', context);
  assert.equal(start(), true); assert.equal(context.equipmentEditMode, true);
  assert.equal(controls.focusEquipmentDrawer.hidden, true);
  assert.ok(calls.some(call => call[0] === 'inspector' && call[1] === false));
  context.equipmentFormDirty = true;
  assert.equal(close(), true); assert.equal(context.equipmentEditMode, false); assert.equal(context.equipmentFormDirty, false);
  assert.equal(context.selectedId, 'current'); assert.deepEqual(preserved(context), before);
  assert.ok(calls.some(call => call[0] === 'focusEdit' && call[1] === true));
});

test('editing transitions cannot discard a denied draft or begin without a selected equipment', async () => {
  for (const name of ['startEquipmentEditing', 'closeEquipmentEditing', 'toggleEquipmentList']) {
    const { context, calls } = navigationContext(false);
    context.selectedPoint = () => ({ uid: context.selectedId });
    await action('setNavigationSection', context);
    const before = preserved(context);
    const execute = await action(name, context);
    assert.equal(execute(true), false);
    assert.equal(context.equipmentEditMode, true); assert.equal(context.equipmentFormDirty, true);
    assert.equal(context.selectedId, 'current'); assert.deepEqual(preserved(context), before);
    assert.equal(calls.some(call => ['render', 'inspector'].includes(call[0])), false);
  }
  const { context, calls } = navigationContext(true);
  context.selectedPoint = () => null;
  const start = await action('startEquipmentEditing', context);
  assert.equal(start(), false); assert.equal(calls.length, 0);
});

test('rendering consultation keeps the form hidden without filling or enabling edit controls', async () => {
  const calls = [];
  const point = equipment('qa', 20, 30, { markerId: 'EQ005' });
  const context = vm.createContext({
    selectedPoint: () => point, equipmentEditMode: false, equipmentFormDirty: false,
    renderEquipmentSummary: value => { assert.equal(value, point); calls.push('summary'); },
    appShell: { classList: { toggle: (name, active) => { assert.equal(name, 'equipment-editing'); assert.equal(active, false); } } },
    document: { querySelector: () => null, getElementById: id => { assert.equal(id, 'sidebarInspector'); return { classList: { toggle() {} } }; } },
    state: { activeMapId: 'demo' }, DEFAULT_MAPS: { demo: { label: 'Demonstração' } }, panelTitle: {}, sidebarHome: {},
    editor: { classList: { add: name => { assert.equal(name, 'hidden'); calls.push('formHidden'); } }, querySelectorAll: () => assert.fail('Consultation must not enable or fill the edit form') },
    editEquipment: { classList: { add() {} } }, panelLockToggle: { classList: { add() {} } },
    saveState: () => assert.fail('Consultation must not save'),
  });
  const render = await action('renderEditor', context);
  render();
  assert.deepEqual(calls, ['summary', 'formHidden']);
  assert.equal(context.equipmentEditMode, false); assert.equal(context.equipmentFormDirty, false);
});

test('explicit creation enters editing only after save succeeds and failed saves restore earlier selection and mode', async () => {
  for (const operationBindings of [[], ['Montagem']]) {
  for (const savingSucceeds of [true, false]) {
    const { context, calls } = navigationContext(true);
    context.equipmentEditMode = false; context.equipmentFormDirty = false;
    context.state = { points: [equipment('current', 10, 10)], processes: ['Montagem'], auditLogs: [{ uid: 'existing-audit' }] };
    const inventoryBefore = JSON.stringify(context.state);
    context.MAX_IMPORT_POINTS = 100;
    context.TEXT_LIMITS = { short: 120, medium: 240, long: 4000 };
    context.EQUIPMENT_PRESETS = {};
    context.processListFromValue = value => value;
    context.processNodeByName = name => name === 'Montagem' ? { name } : null;
    context.createUid = () => 'created';
    context.sanitizeText = value => String(value || '');
    for (const name of ['normalizeMac', 'normalizeVlan', 'normalizeCountry', 'normalizeEquipmentStatus', 'normalizeValidationStatus', 'normalizeValidationChecklist']) context[name] = value => value;
    context.normalizeDeploymentStage = (value, fallback) => value || fallback;
    context.recordAudit = () => context.state.auditLogs.push({ uid: 'created-audit' });
    context.saveState = () => { calls.push(['save']); return savingSucceeds; };
    context.alert = () => calls.push(['alert']);
    const before = preserved(context);
    const create = await action('createPoint', context);
    assert.equal(create(30, 40, { name: 'Vínculo inválido', processes: ['Operação inexistente'] }), null);
    assert.equal(JSON.stringify(context.state), inventoryBefore, 'optional linking does not accept references to nonexistent operations');
    assert.equal(calls.filter(call => call[0] === 'save').length, 0);
    const result = create(30, 40, { name: 'Novo equipamento', markerId: 'EQ099', processes: operationBindings });
    if (savingSucceeds) {
      assert.equal(result.uid, 'created'); assert.equal(context.selectedId, 'created');
      assert.equal(context.equipmentEditMode, true);
      assert.ok(calls.some(call => call[0] === 'inspector' && call[1] === false));
      assert.equal(calls.filter(call => call[0] === 'render').length, 1);
      assert.equal(context.state.points.length, 2);
      assert.deepEqual(Array.from(result.processes), operationBindings, 'creation keeps optional operation links exactly as requested');
      assert.deepEqual([result.x, result.y], [30, 40]);
      assert.equal(context.state.points[0].uid, 'current');
      assert.deepEqual([context.state.points[0].x, context.state.points[0].y], [10, 10]);
      assert.deepEqual(Array.from(context.state.processes), ['Montagem'], 'unlinked equipment does not create or remove operations');
    } else {
      assert.equal(result, null); assert.equal(context.selectedId, 'current');
      assert.equal(context.equipmentEditMode, false); assert.equal(context.equipmentFormDirty, false);
      assert.equal(JSON.stringify(context.state), inventoryBefore);
      assert.equal(calls.some(call => ['inspector', 'render'].includes(call[0])), false);
    }
    assert.deepEqual(preserved(context), savingSucceeds ? ['', '', '', '', '', '', ...before.slice(6)] : before,
      'only a confirmed saved creation clears filters; map zoom and panning remain unchanged');
    assert.equal(calls.filter(call => call[0] === 'save').length, 1);
  }
  }
});

test('equipment list coexists with consultation on desktop and closes after selection on mobile, preserving map context', async () => {
  for (const width of [390, 1280]) {
  const { context, calls } = navigationContext(true);
  context.innerWidth = width;
  const ids = ['equipmentSummary', 'equipmentSummaryName', 'equipmentSummaryCode', 'equipmentSummaryStatus', 'equipmentSummaryType', 'equipmentSummaryOperation', 'summaryLocateEquipment', 'focusEquipmentDrawer', 'openEquipmentList', 'contextNavigationPanel', 'contextNavigationTitle', 'navigateMap', 'navigateOperations', 'contextOperationSection', 'contextOperationsManage'];
  const controls = Object.fromEntries(ids.map(id => [id, { hidden: true, dataset: {}, classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }, focus() { calls.push(['listFocus']); } }]));
  context.appShell = { classList: { toggle() {} } };
  context.document = { getElementById: id => controls[id] };
  context.state = { mapImage: '/synthetic.png' }; context.equipmentEditMode = false; context.equipmentFormDirty = false;
  context.selectedPoint = () => context.selectedId ? equipment(context.selectedId, 22, 22) : null;
  context.uiLabel = value => value; context.normalizeEquipmentStatus = value => value || 'Online'; context.processText = () => '';
  const renderSummary = await action('renderEquipmentSummary', context);
  await action('contextUsesOverlay', context); await action('renderContextNavigation', context); await action('setNavigationSection', context);
  context.renderEditor = () => renderSummary(); context.render = () => { context.renderContextNavigation(); renderSummary(); };
  context.renderTabs = () => {}; context.renderList = () => {}; context.renderMap = () => {};
  const toggle = await action('toggleEquipmentList', context);
  const select = await action('selectPoint', context);
  const before = preserved(context);
  renderSummary(); assert.equal(controls.equipmentSummary.hidden, false);
  assert.equal(toggle(true), true);
  assert.equal(controls.focusEquipmentDrawer.hidden, false); assert.equal(controls.openEquipmentList['aria-expanded'], 'true');
  assert.equal(controls.equipmentSummary.hidden, width <= 700, 'mobile overlay hides consultation; desktop keeps its separately positioned card');
  assert.equal(select('chosen'), true);
  assert.equal(controls.focusEquipmentDrawer.hidden, width <= 700); assert.equal(controls.openEquipmentList['aria-expanded'], String(width > 700));
  assert.equal(controls.equipmentSummary.hidden, false);
  assert.equal(context.selectedId, 'chosen'); assert.equal(context.equipmentEditMode, false);
  assert.deepEqual(preserved(context), before);
  }
});

test('visible map frame reserves control and consultation space without changing user pan or zoom', async () => {
  const { context } = navigationContext(true);
  const before = preserved(context);
  const frame = await action('mapViewportFrame', context);
  const available = frame(801, 600, { top: 90, bottom: 200, left: 20, right: 20 });
  assert.equal(available.width, 761); assert.equal(available.height, 310);
  assert.equal(available.centerX, 400.5); assert.equal(available.centerY, 245);
  assert.equal(available.offsetX, 0); assert.equal(available.offsetY, -55);
  assert.deepEqual(preserved(context), before, 'visual centering must not become persisted user panning');
  const crowded = frame(1, 1, { top: 500, bottom: 500, left: 500, right: 500 });
  assert.ok(Number.isFinite(crowded.width) && crowded.width >= 1);
  assert.ok(Number.isFinite(crowded.height) && crowded.height >= 1);
});

async function geometryContext() {
  const properties = {}, stored = {}, calls = [], toolbarOffsets = { app: {}, map: {} };
  const point = equipment('bottom', 50, 100);
  const summary = { hidden: false, getBoundingClientRect: () => ({ top: 500, bottom: 640 }) };
  const style = { setProperty: (name, value) => { properties[name] = value; } };
  const marker = { equipmentGroup: { points: [point] }, focus: options => calls.push(['focus', options.preventScroll]) };
  const holder = { style, classList: { toggle() {} }, get offsetWidth() { return parseFloat(style.width) || 1200; }, get offsetHeight() { return parseFloat(style.height) || 800; }, querySelectorAll: () => [marker] };
  const context = vm.createContext({ state: { activeMapId: 'demo', mapImage: '/synthetic.png', processNodes: [] },
    appShell: { getBoundingClientRect: () => ({ top: 70 }), style: { setProperty: (name, value) => { toolbarOffsets.app[name] = value; } } },
    mapStage: { clientWidth: 801, clientHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 100, width: 801, height: 600, bottom: 700 }),
      closest: selector => { assert.equal(selector, '.map-shell'); return { style: { setProperty: (name, value) => { toolbarOffsets.map[name] = value; } } }; } },
    mapImage: { complete: true, naturalWidth: 1200, naturalHeight: 800, classList: { contains: () => false } }, mapHolder: holder,
    document: { getElementById: () => summary, querySelector: selector => ({ getBoundingClientRect: () => selector === '.focus-map-toolbar' ? { top: 108, bottom: 160 } : { top: 650, bottom: 690 } }) },
    mapZoom: 1, mapPanX: 0, mapPanY: 0, mapLocked: false, selectedProcessFilter: '',
    useCompactOperationLabels: () => false, storageSet: (key, value) => { stored[key] = value; }, mapViewStorageKey: (_map, key) => key,
    selectedPoint: () => point, contextUsesOverlay: () => false,
  });
  for (const name of ['mapViewportFrame', 'mapVisibleFrame', 'fittedMapSize', 'mapCanPan', 'clampMapPan', 'applyMapTransform', 'locateSelectedEquipment']) await action(name, context);
  return { context, properties, stored, calls, point, summary, holder, toolbarOffsets };
}

test('fit and locate keep the bottom equipment hit target above the compact consultation sheet at 100% zoom', async () => {
  const { context, properties, calls, point, holder, toolbarOffsets } = await geometryContext();
  context.applyMapTransform();
  const before = structuredClone(point);
  assert.equal(context.locateSelectedEquipment(), true);
  const frame = context.mapVisibleFrame();
  const centerY = 100 + 600 / 2 + parseFloat(properties['--map-frame-offset-y']) + parseFloat(properties['--map-pan-y']);
  const pointBottom = centerY + holder.offsetHeight / 2 + 22;
  const pointTop = centerY - holder.offsetHeight / 2 - 22;
  assert.ok(pointBottom <= 500, 'the complete 44px hit target is above the consultation sheet');
  assert.ok(pointTop >= 160, 'the fitted map stays below its toolbar');
  assert.ok(holder.offsetWidth <= frame.width && holder.offsetHeight <= frame.height);
  assert.equal(toolbarOffsets.app['--map-toolbar-bottom'], '90px');
  assert.equal(toolbarOffsets.map['--map-toolbar-bottom'], '60px', 'overlay offsets are relative to each container rather than a fixed toolbar height');
  assert.equal(context.mapZoom, 1); assert.deepEqual(point, before);
  assert.deepEqual(calls, [['focus', true]]);
  context.document.querySelector = selector => ({ getBoundingClientRect: () => selector === '.focus-map-toolbar' ? { top: 108, bottom: 294.6 } : { top: 650, bottom: 690 } });
  context.applyMapTransform();
  assert.ok(Math.abs(parseFloat(toolbarOffsets.app['--map-toolbar-bottom']) - 224.6) < 0.001);
  assert.ok(Math.abs(parseFloat(toolbarOffsets.map['--map-toolbar-bottom']) - 194.6) < 0.001, 'a wrapped toolbar updates overlay offsets on the next layout pass');
});

test('layout and sheet changes clamp only visual pan while retaining the user map position in storage', async () => {
  const { context, stored, properties, summary } = await geometryContext();
  context.mapZoom = 3; context.mapPanX = 999; context.mapPanY = -999;
  context.applyMapTransform();
  assert.deepEqual([context.mapZoom, context.mapPanX, context.mapPanY], [3, 999, -999]);
  assert.deepEqual([stored.zoom, stored['pan-x'], stored['pan-y']], ['3', '999', '-999']);
  assert.ok(Math.abs(parseFloat(properties['--map-pan-x'])) < 999);
  assert.ok(Math.abs(parseFloat(properties['--map-pan-y'])) < 999);
  summary.hidden = true; context.applyMapTransform();
  assert.deepEqual([context.mapZoom, context.mapPanX, context.mapPanY], [3, 999, -999], 'closing a sheet must not overwrite saved panning');
});

test('cancelling equipment placement restores the earlier selection and list without clearing search or map position', async () => {
  for (const closeDialog of [false, true]) {
    const { context, calls } = navigationContext(true);
    context.mapCreateMode = 'device'; context.selectedId = null; context.selectedCableId = null;
    context.equipmentPlacementSelection = { point: 'earlier', cable: null, tab: 'points', drawerOpen: true, equipmentLayer: false, operationLayer: true };
    context.showEquipmentLayer = true; context.showOperationLayer = false;
    context.equipmentFormDirty = false;
    const controls = { focusEquipmentDrawer: { hidden: true }, openEquipmentList: { setAttribute(name, value) { this[name] = value; } }, createEquipmentPrimary: { focus: options => calls.push(['focusNew', options.preventScroll]) } };
    context.document = { getElementById: id => controls[id] };
    context.pendingPoint = { x: 80, y: 90 }; context.pendingProcessName = 'Montagem';
    context.pointDialog = { close: () => calls.push(['closeDialog']) };
    const before = preserved(context);
    const cancel = await action('cancelEquipmentPlacement', context);
    if (closeDialog) { const close = await action('closePointDialog', context); close(); assert.equal(context.pendingPoint, null); assert.equal(context.pendingProcessName, ''); }
    else assert.equal(cancel(), true);
    assert.equal(context.selectedId, 'earlier'); assert.equal(context.selectedCableId, null); assert.equal(context.activeTab, 'points');
    assert.equal(controls.focusEquipmentDrawer.hidden, false); assert.equal(controls.openEquipmentList['aria-expanded'], 'true');
    assert.equal(context.equipmentPlacementSelection, null); assert.equal(context.mapCreateMode, 'browse');
    assert.equal(context.showEquipmentLayer, false); assert.equal(context.showOperationLayer, true, 'cancelling creation restores the previous operation overview');
    assert.deepEqual(preserved(context), before);
    assert.ok(calls.some(call => call[0] === 'focusNew' && call[1] === true));
  }
});

test('declining discard while cancelling placement keeps selection, pending placement and filters intact', async () => {
  const { context, calls } = navigationContext(false);
  context.equipmentPlacementSelection = { point: 'earlier', cable: null, tab: 'points', drawerOpen: false };
  context.mapCreateMode = 'device';
  const selection = context.equipmentPlacementSelection;
  const before = preserved(context);
  const cancel = await action('cancelEquipmentPlacement', context);
  assert.equal(cancel(), false); assert.equal(context.mapCreateMode, 'device');
  assert.equal(context.equipmentPlacementSelection, selection); assert.equal(context.selectedId, 'current');
  assert.deepEqual(preserved(context), before); assert.equal(calls.some(call => call[0] === 'render'), false);
});

test('removing the operation context changes its filter only, while declining keeps drafts and actual bindings', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const begin = source.indexOf('    document.getElementById("clearContextOperationFilter").addEventListener');
  const end = source.indexOf('\n    document.getElementById("operationFilter")', begin);
  assert.ok(begin >= 0 && end > begin);
  for (const allowed of [false, true]) {
    const { context, calls } = navigationContext(allowed);
    context.state = { points: [equipment('current', 20, 30, { processes: ['Montagem', 'Expedição'] })] };
    const inventory = JSON.stringify(context.state), before = preserved(context);
    let listener;
    context.document = { getElementById: id => { assert.equal(id, 'clearContextOperationFilter'); return { addEventListener: (_event, fn) => { listener = fn; } }; } };
    vm.runInContext(source.slice(begin, end), context); listener();
    assert.equal(context.selectedProcessFilter, allowed ? '' : 'Montagem');
    assert.deepEqual(preserved(context).slice(1), before.slice(1), 'other search, filters and map position remain unchanged');
    assert.equal(JSON.stringify(context.state), inventory, 'filtering never rewrites equipment operation bindings');
    if (!allowed) { assert.equal(context.equipmentFormDirty, true); assert.equal(context.equipmentEditMode, true); assert.equal(calls.some(call => call[0] === 'render'), false); }
  }
});

test('rail navigation and collapse preserve inventory, selection and map context while respecting draft guards', async () => {
  const { context, calls } = navigationContext(true);
  const controls = new Map();
  context.document = { getElementById: id => {
    if (!controls.has(id)) controls.set(id, { hidden: false, classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }, focus: options => calls.push(['focusRail', options.preventScroll]) });
    return controls.get(id);
  } };
  context.appShell = { classList: { toggle() {} } }; context.innerWidth = 390;
  context.renderContextOperations = () => calls.push(['operations']);
  for (const name of ['renderTabs', 'renderList', 'renderEditor', 'renderMap']) context[name] = () => calls.push([name]);
  context.state = { points: [equipment('current', 20, 30, { processes: ['Montagem'] })] };
  const inventory = JSON.stringify(context.state), before = preserved(context);
  await action('contextUsesOverlay', context); await action('renderContextNavigation', context);
  const navigate = await action('setNavigationSection', context);
  for (const section of ['map', 'equipment', 'operations']) {
    assert.equal(navigate(section), true);
    assert.equal(context.navigationSection, section);
    assert.equal(controls.get('contextNavigationPanel').hidden, false); assert.equal(controls.get('contextNavigationPanel').inert, false);
    const active = controls.get(section === 'map' ? 'navigateMap' : section === 'equipment' ? 'openEquipmentList' : 'navigateOperations');
    assert.equal(active['aria-expanded'], 'true'); assert.equal(active['aria-current'], 'page');
    assert.equal(navigate(section, false), true);
    assert.equal(controls.get('contextNavigationPanel').hidden, true); assert.equal(controls.get('contextNavigationPanel').inert, true);
    assert.equal(active['aria-expanded'], 'false');
    assert.equal(context.selectedId, 'current'); assert.deepEqual(preserved(context), before); assert.equal(JSON.stringify(context.state), inventory);
  }
  context.equipmentFormDirty = true; context.equipmentEditMode = true; context.confirmDiscardPendingChanges = () => false;
  const previousSection = context.navigationSection, previousOpen = context.contextPanelOpen;
  assert.equal(navigate('equipment'), false);
  assert.equal(context.navigationSection, previousSection); assert.equal(context.contextPanelOpen, previousOpen);
  assert.equal(context.equipmentFormDirty, true); assert.equal(context.equipmentEditMode, true);
  assert.equal(navigate('unknown'), false); assert.deepEqual(preserved(context), before);
});

test('responsive resize updates layout without repopulating or discarding an unsaved equipment form', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const begin = source.indexOf('    let mapFrameResizeTimer = null;');
  const end = source.indexOf('\n    window.addEventListener("hashchange"', begin);
  assert.ok(begin >= 0 && end > begin);
  let listener, queued;
  const draft = { value: 'Nome ainda não salvo' };
  const context = vm.createContext({
    window: { addEventListener: (name, fn) => { assert.equal(name, 'resize'); listener = fn; } },
    clearTimeout() {}, setTimeout: fn => { queued = fn; return 1; }, mapZoom: 2,
    equipmentFormDirty: true, cableFormDirty: false, equipmentEditMode: true, equipmentName: draft,
    renderContextNavigation() {}, renderEquipmentSummary() {},
    renderEditor: () => assert.fail('Resizing must not reload persisted fields into a dirty editing form'),
    applyMapZoom: value => assert.equal(value, 2),
  });
  vm.runInContext(source.slice(begin, end), context); listener(); queued();
  assert.equal(draft.value, 'Nome ainda não salvo');
  assert.equal(context.equipmentFormDirty, true); assert.equal(context.equipmentEditMode, true);
});

test('explicit operation selection filters equipment without changing bindings and blocks declined draft loss', async () => {
  for (const allowed of [false, true]) {
    const { context } = navigationContext(allowed);
    const buttons = [];
    const list = { replaceChildren: () => { buttons.length = 0; }, append: element => buttons.push(element) };
    context.document = { getElementById: () => list, createElement: tag => ({ tag, setAttribute() {}, append(...children) { this.children = children; }, addEventListener(_name, fn) { this.click = fn; } }) };
    context.contextOperationSearchTerm = ''; context.normalizeSearch = normalizeSearch;
    context.state = { points: [equipment('current', 20, 30, { processes: ['Operação destino'] })], processNodes: [{ name: 'Operação destino' }] };
    context.pointProcesses = point => point.processes;
    context.contextUsesOverlay = () => true; context.contextPanelOpen = true;
    const inventory = JSON.stringify(context.state), before = preserved(context);
    const renderOperations = await action('renderContextOperations', context);
    renderOperations(); assert.equal(buttons.length, 1); assert.equal(buttons[0].children[1].textContent, '1 equipamento');
    buttons[0].click();
    assert.equal(context.selectedProcessFilter, allowed ? 'Operação destino' : 'Montagem');
    assert.equal(context.selectedId, allowed ? null : 'current');
    assert.equal(context.contextPanelOpen, !allowed);
    assert.equal(context.equipmentFormDirty, !allowed);
    assert.deepEqual(preserved(context).slice(1), before.slice(1));
    assert.equal(JSON.stringify(context.state), inventory);
  }
});
