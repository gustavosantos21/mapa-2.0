import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
function load(name, context) {
  const match = new RegExp('^    function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, name);
  const end = /^    }\r?$/m.exec(source.slice(match.index));
  assert.ok(end);
  vm.runInContext(source.slice(match.index, match.index + end.index + end[0].length), context);
  return context[name];
}

test('initial map opens operation markers without equipment clusters', () => {
  const declarations = [...source.matchAll(/^    let (showEquipmentLayer|showOperationLayer) = (true|false);/gm)];
  assert.equal(declarations.length, 2);
  const context = vm.createContext({});
  vm.runInContext(declarations.map(match => `globalThis.${match[1]} = ${match[2]};`).join('\n'), context);
  assert.equal(context.showOperationLayer, true);
  assert.equal(context.showEquipmentLayer, false);
});

test('changing navigation selects the corresponding marker layer only after draft approval', () => {
  for (const approved of [false, true]) {
    const context = vm.createContext({
      navigationSection: 'equipment', contextPanelOpen: true, showOperationLayer: false, showEquipmentLayer: true,
      equipmentFormDirty: true, equipmentEditMode: true, cableFormDirty: false, activeTab: 'points',
      selectedProcessFilter: 'Operação QA', operationSearchTerm: 'QA007', mapZoom: 2.5, mapPanX: 40, mapPanY: -30,
      confirmDiscardPendingChanges: () => approved, closeContextMenus() {}, setInspectorCollapsed() {},
      renderContextNavigation() {}, renderTabs() {}, renderList() {}, renderEditor() {}, renderMap() {}, renderLayerButtons() {}, renderMapToolButtons() {}, renderMetrics() {}, renderOverviewOverview() {},
    });
    const navigate = load('setNavigationSection', context);
    for (const section of ['map', 'operations', 'equipment']) {
      assert.equal(navigate(section), approved);
      assert.equal(context.showOperationLayer, approved ? section !== 'equipment' : false);
      assert.equal(context.showEquipmentLayer, approved ? section === 'equipment' : true);
      assert.deepEqual([context.selectedProcessFilter, context.operationSearchTerm, context.mapZoom, context.mapPanX, context.mapPanY], ['Operação QA', 'QA007', 2.5, 40, -30]);
      if (!approved) { assert.equal(context.equipmentFormDirty, true); assert.equal(context.navigationSection, 'equipment'); }
    }
  }
});

test('operation overview renders all eight original nodes at their exact coordinates without grouping or rewriting equipment', () => {
  const nodes = Array.from({ length: 8 }, (_, index) => ({ uid: `qa-operation-${index}`, name: `Operação QA ${index}`, processId: `OP${index}`, x: 20 + index * 0.2, y: 30 + index * 0.1, pinned: true }));
  const points = Array.from({ length: 22 }, (_, index) => ({ uid: `qa-equipment-${index}`, x: 80 - index, y: 70 - index, processes: [nodes[index % 8].name] }));
  const state = { mapImage: '/synthetic.png', processNodes: nodes, points };
  const before = JSON.stringify(state), markers = [];
  const classList = { add() {}, remove() {}, contains: () => false };
  const context = vm.createContext({ state, showOperationLayer: true, showEquipmentLayer: false, showCableLayer: false,
    selectedProcessFilter: '', selectedId: null, showLabelLayer: true,
    mapHolder: { classList, querySelectorAll: selector => selector === '.process-marker' ? markers : [], appendChild: marker => markers.push(marker) },
    mapImage: { classList, getAttribute: () => state.mapImage }, emptyMap: { classList }, cableLayer: { classList, innerHTML: '' },
    applyMapZoom() {}, operationSummariesWithEquipment: () => nodes.map(node => ({ name: node.name })),
    pointProcesses: point => point.processes, matchesDeploymentStage: () => true, matchesDeviceType: () => true,
    operationColor: () => '#4f21ff', normalizeDeploymentStage: () => 'AS IS', processDisplayId: node => node.processId,
    pointName: point => point.uid,
    groupEquipmentMarkers: () => assert.fail('Operation overview must not group equipment into cluster markers'),
    document: { createElement: () => {
      const children = new Map();
      return { dataset: {}, properties: {}, style: { setProperty(name, value) { this.owner[name] = value; }, owner: {} }, setAttribute() {}, addEventListener() {},
        querySelector(selector) { if (!children.has(selector)) children.set(selector, {}); return children.get(selector); } };
    } },
  });
  load('renderEquipmentMarkers', context); const renderMap = load('renderMap', context);
  renderMap();
  assert.equal(markers.length, 8);
  for (const node of nodes) {
    const marker = markers.find(item => item.dataset.processName === node.name);
    assert.ok(marker, node.name);
    assert.equal(marker.style.owner['--x'], node.x); assert.equal(marker.style.owner['--y'], node.y);
    assert.equal(marker.querySelector('span').textContent, node.processId);
    assert.equal(marker.querySelector('small').textContent, String(points.filter(point => point.processes.includes(node.name)).length));
  }
  assert.equal(JSON.stringify(state), before, 'rendering cannot relocate or relink imported inventory');
});
