export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

function matchesSearchText(text, query) {
  const haystack = normalizeSearch(text);
  const compact = haystack.replace(/[-_]/g, '');
  return normalizeSearch(query).split(' ').filter(Boolean).every(term => haystack.includes(term) || compact.includes(term.replace(/[-_]/g, '')));
}

export function equipmentSearchText(point) {
  const typeAliases = { Printer: 'impressora', Reader: 'leitor', Desktop: 'computador', Laptop: 'notebook portátil', 'Mobile Tablet': 'tablet móvel', Collector: 'coletor', Other: 'outro' };
  return [point.markerId, point.name, point.type, typeAliases[point.type], point.status, point.area, point.plant, point.country,
    point.process, ...(Array.isArray(point.processes) ? point.processes : []), point.model, point.serial, point.hostname, point.owner,
    point.vendor, point.ticket, point.productionLine, point.station, point.rack, point.port,
    point.ip && 'IP ' + point.ip, point.mac && 'MAC ' + point.mac, point.vlan && 'VLAN ' + point.vlan].filter(Boolean).join(' ');
}

export function equipmentMatchesSearch(point, query) {
  return matchesSearchText(equipmentSearchText(point), query);
}

export function operationMatchesSearchQuery(summary, query) {
  const operationText = [summary.name, summary.area, summary.node?.processId, summary.workstream,
    ...(Array.isArray(summary.operationProcesses) ? summary.operationProcesses : [])].filter(Boolean).join(' ');
  if (matchesSearchText(operationText, query)) return true;
  return (summary.points || []).some(point => matchesSearchText(operationText + ' ' + equipmentSearchText(point), query));
}

export function validateNewOperation(value, existingNames = []) {
  const raw = String(value ?? '');
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: 'O nome contém caracteres não permitidos.' };
  if (/[<>]/.test(raw)) return { ok: false, error: 'Use um nome simples, sem os símbolos < e >.' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Informe o nome da operação.' };
  if (name.length > 120) return { ok: false, error: 'O nome da operação deve ter até 120 caracteres.' };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: 'O nome contém caracteres não permitidos.' };
  if (/[;,\n]/.test(name)) return { ok: false, error: 'Crie uma operação por vez, sem vírgula ou ponto e vírgula no nome.' };
  if (existingNames.some(existing => normalizeSearch(existing) === normalizeSearch(name))) return { ok: false, error: 'Já existe uma operação com esse nome nesta planta.' };
  return { ok: true, name };
}

export function useCompactOperationLabels(count, zoom, focused) {
  return count >= 40 && zoom < 1.5 && !focused;
}
