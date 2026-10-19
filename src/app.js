(async () => {
    if (!['http:', 'https:'].includes(location.protocol)) {
      document.querySelector('.map-ui-shell').hidden = true;
      document.getElementById('loginPanel').hidden = false;
      document.getElementById('loginStatus').textContent = 'Abra pelo servidor com npm start; o HTML não contém seus dados.';
      return;
    }
    let authSession, initialLoginResolve;
    async function api(url, options = {}) {
      const response = await fetch(url, {credentials:'same-origin', cache:'no-store', ...options,
        headers:{...(options.body && typeof options.body === 'string' ? {'Content-Type':'application/json'} : {}),
          ...(authSession ? {'X-CSRF-Token':authSession.csrfToken} : {}), ...(options.headers || {})}});
      const result = await response.json();
      if (!response.ok) { const error = new Error(result.error || 'Falha na comunicação.'); error.status=response.status;throw error; }
      return result;
    }
    document.getElementById('loginForm').addEventListener('submit', async event => {
          event.preventDefault();const button=document.getElementById('loginButton');button.disabled=true;
          try { const session=await api('/api/login',{method:'POST',body:JSON.stringify({username:document.getElementById('loginUsername').value,password:document.getElementById('loginPassword').value})});document.getElementById('loginPassword').value='';
            authSession=session;
            if(initialLoginResolve){initialLoginResolve(session);initialLoginResolve=null;}else{
              document.getElementById('loginPanel').hidden=true;document.querySelector('.map-ui-shell').hidden=false;
              document.getElementById('reauthButton').hidden=true;document.getElementById('sessionUser').textContent=session.username;
              saveStatus('Sessão renovada.');await flushServerSave();
            }
          }
          catch(error){ document.getElementById('loginStatus').textContent=error.message; } finally { button.disabled=false; }
    });
    try { authSession=await api('/api/session'); } catch {
      document.getElementById('loginPanel').hidden=false;
      authSession=await new Promise(resolve => {initialLoginResolve=resolve;});
    }
    const initialServerState=await api('/api/state');
    document.getElementById('loginPanel').hidden=true;
    document.querySelector('.map-ui-shell').hidden=false;
    document.getElementById('sessionUser').textContent=authSession.username;
    let serverRevision=initialServerState.revision;
    let savePromise=null, saveTimer=null, saveConflict=false;
    function saveStatus(message, error=false) { const element=document.getElementById('serverSaveStatus');element.textContent=message;element.classList.toggle('error',error); }
    function scheduleServerSave() { clearTimeout(saveTimer);saveStatus('Alterações pendentes…');saveTimer=setTimeout(()=>flushServerSave(),700); }
    async function flushServerSave() {
      clearTimeout(saveTimer);
      if (savePromise) { await savePromise;if(memoryOnlyChanges && !saveConflict)return flushServerSave();return; }
      if (!memoryOnlyChanges || saveConflict) return;
      const localRevision=stateRevision;
      const inventory=structuredClone(persistableState());
      saveStatus('Salvando no servidor…');
      savePromise=(async()=>{
        try { const result=await api('/api/state',{method:'PUT',body:JSON.stringify({inventory,maps:DEFAULT_MAPS,revision:serverRevision})});serverRevision=result.revision;memoryOnlyChanges=stateRevision!==localRevision;saveStatus(memoryOnlyChanges?'Alterações pendentes…':'Salvo no servidor'); }
        catch(error){ if(error.status===409){saveConflict=true;document.getElementById('conflictActions').hidden=false;}if(error.status===401)document.getElementById('reauthButton').hidden=false;saveStatus(error.message+' Suas edições continuam abertas.',true); }
      })();
      await savePromise;savePromise=null;
      if(memoryOnlyChanges && !saveConflict && stateRevision!==localRevision)scheduleServerSave();
    }
    document.getElementById('logoutButton').addEventListener('click',async()=>{
      if(equipmentFormDirty || cableFormDirty || memoryOnlyChanges){alert('Salve suas edições ou faça um backup antes de sair.');return;}
      await api('/api/logout',{method:'POST'});location.reload();
    });
    document.getElementById('backupJson').addEventListener('click',()=>{
      createPrivateBackup();
    });
    document.getElementById('reloadServer').addEventListener('click',()=>{
      if(confirm('Isso descarta suas edições pendentes. Faça um backup primeiro, se precisar. Carregar versão do servidor?'))location.reload();
    });
    document.getElementById('reauthButton').addEventListener('click',()=>{
      document.querySelector('.map-ui-shell').hidden=true;document.getElementById('loginPanel').hidden=false;
      document.getElementById('loginUsername').value=authSession.username;document.getElementById('loginUsername').readOnly=true;
      document.getElementById('loginStatus').textContent='Suas edições continuam guardadas nesta sessão. Entre novamente para salvar.';
      document.getElementById('loginPassword').focus();
    });
    async function transformImages(value, transform, depth=0, counter={count:0}) {
      if(depth>24 || ++counter.count>350000)throw new Error('Backup excede limite de estrutura.');
      if(Array.isArray(value)) { const result=[];for(const item of value)result.push(await transformImages(item,transform,depth+1,counter));return result; }
      if(value && typeof value==='object'){const result={};for(const [key,item]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('Campo não permitido.');result[key]=await transformImages(item,transform,depth+1,counter);}return result;}
      return typeof value==='string' ? transform(value) : value;
    }
    async function createPrivateBackup() {
      if(!savePendingEditsBeforeAction())return;
      if(!confirm('O backup contém equipamentos, informações e fotos privadas. Salvar neste computador?'))return;
      const button=document.getElementById('backupJson');button.disabled=true;
      const cache=new Map();
      try {
        const payload=await transformImages(structuredClone({format:'mapa-privado-v2',inventory:persistableState(),maps:DEFAULT_MAPS,revision:serverRevision}),async value=>{
          if(!/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value))return value;
          if(!cache.has(value)) {
            const response=await fetch(value,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('Não foi possível incluir todas as imagens no backup.');
            const blob=await response.blob();const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});cache.set(value,encoded);
          }
          return cache.get(value);
        });
        downloadFile('Backup_Mapa_Privado.json',JSON.stringify(payload,null,2),'application/json');
      }catch(error){alert(error.message || 'Backup não concluído.');}finally{button.disabled=false;}
    }
    const STORAGE_KEY_BASE = "mapa-logistica-interativo-v1";
    const storageScope = (() => {
      try {
        const currentUrl = new URL(globalThis.location?.href || "http://local/");
        currentUrl.search = "";
        currentUrl.hash = "";
        return currentUrl.protocol + "//" + currentUrl.host + currentUrl.pathname;
      } catch {
        return "default";
      }
    })();
    // Each saved copy gets its own browser cache. A global key made a newer
    // cache from one HTML file override the embedded data of another copy.
    const storageScopeSuffix = ":" + encodeURIComponent(storageScope);
    const storageKeyForDocument = (key) => key + storageScopeSuffix;
    const STORAGE_KEY = storageKeyForDocument(STORAGE_KEY_BASE);
    const LEGACY_STORAGE_DECISION_KEY = STORAGE_KEY + ":legacy-decision";
    let storageFailureReported = false;

    function reportStorageFailure(action, error) {
      if (storageFailureReported) return;
      storageFailureReported = true;
      console.warn("Browser storage is unavailable for " + action + ".", error);
    }

    function storageGet(key) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) throw new Error("localStorage is not available.");
        return storage.getItem(key) ?? null;
      } catch (error) {
        reportStorageFailure("reading", error);
        return null;
      }
    }

    function storageSet(key, value) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) throw new Error("localStorage is not available.");
        storage.setItem(key, value);
        return true;
      } catch (error) {
        reportStorageFailure("writing", error);
        return false;
      }
    }

    function storageRemove(key) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) throw new Error("localStorage is not available.");
        storage.removeItem(key);
        return true;
      } catch (error) {
        reportStorageFailure("removing", error);
        return false;
      }
    }
    const GENERIC_MAPS = /*@@DEFAULT_MAPS@@*/ {};
    const DEFAULT_MAPS = initialServerState.maps || GENERIC_MAPS;
    const FIRST_MAP_ID = Object.keys(DEFAULT_MAPS)[0];
    const MAP_ORDER = Object.keys(DEFAULT_MAPS);
    const EQUIPMENT_PRESETS = {
      "Printer": { color: "#2563eb", shape: "square" },
      "Reader": { color: "#7c3aed", shape: "diamond" },
      "Desktop": { color: "#475569", shape: "square" },
      "Laptop": { color: "#0891b2", shape: "circle" },
      "Mobile Tablet": { color: "#16a34a", shape: "circle" },
      "EloTouch": { color: "#ea580c", shape: "diamond" },
      "Collector": { color: "#dc2626", shape: "pin" },
      "LTS": { color: "#ca8a04", shape: "square" },
      "Other": { color: "#64748b", shape: "pin" }
    };
    const CABLE_PRESETS = {
      "Ethernet": "#2563eb",
      "Fiber": "#a855f7",
      "Power": "#f59e0b",
      "Control": "#16a34a",
      "Coax": "#64748b",
      "Other": "#111827"
    };
    const CATEGORY_HINTS = {
      "Printer": "Recomendado: nome ou fila da impressora, IP, MAC, modelo, número de série, área, responsável e chamado.",
      "Reader": "Recomendado: código do leitor, IP/MAC, porta ou linha conectada, fabricante e observações de acesso.",
      "Desktop": "Recomendado: nome na rede, usuário ou área, IP, MAC, patrimônio, modelo, número de série e responsável.",
      "Laptop": "Recomendado: nome na rede, usuário ou equipe, patrimônio, rede, modelo, número de série e chamado.",
      "Mobile Tablet": "Recomendado: nome do equipamento, usuário ou área, Wi-Fi, MAC, número de série/IMEI e responsável.",
      "EloTouch": "Recomendado: nome do terminal, operação ou linha, IP, MAC, modelo, número de série e equipamentos conectados.",
      "Collector": "Recomendado: código do coletor, Wi-Fi/MAC, operação, área de recarga, número de série e responsável.",
      "LTS": "Recomendado: nome na rede, função, IP, rack ou área, porta, fabricante, modelo e observações de suporte.",
      "Other": "Recomendado: operação, responsável, IP e porta de rede, modelo, número de série e observações de suporte."
    };
    const UI_LABELS = { Printer: "Impressora", Reader: "Leitor", Desktop: "Computador", Laptop: "Notebook", "Mobile Tablet": "Tablet", Collector: "Coletor", Other: "Outro", Equipment: "Equipamento",
      Low: "Baixa", Medium: "Média", High: "Alta", Critical: "Crítica", pin: "Marcador", circle: "Círculo", square: "Quadrado", diamond: "Losango", Unspecified: "Não informado",
      "Plant Maintenance": "Manutenção industrial", "Supply Chain": "Cadeia de suprimentos", "Design to Operate": "Projeto e operação", Quality: "Qualidade",
      Discovered: "Identificado", "Pending Validation": "Validação pendente", Validated: "Validado", "Ready for Deployment": "Pronto para implantação", "In Deployment": "Em implantação", Active: "Ativo", Maintenance: "Manutenção", Replaced: "Substituído", Decommissioned: "Desativado" };
    function uiLabel(value) { return Object.hasOwn(UI_LABELS, value) ? UI_LABELS[value] : String(value || ""); }
    const WORKSTREAMS = ["Plant Maintenance", "Supply Chain", "Design to Operate", "Quality"];
    const COUNTRIES = [...new Set(Object.values(DEFAULT_MAPS).map(map => map.country || "Não informado"))];
    const OPERATION_COLORS = [
      "#0f766e", "#2563eb", "#7c3aed", "#c2410c", "#be123c",
      "#0369a1", "#4d7c0f", "#a21caf", "#b45309", "#334155"
    ];
    const INDUSTRIAL_AREAS = [
      {
        id: "assembly",
        name: "Montagem",
        shortName: "Montagem",
        color: "#15803d",
        keywords: ["montagem", "assembly", "linha de montagem"]
      },
      {
        id: "injection",
        name: "Injeção",
        shortName: "Injeção",
        color: "#dc2626",
        keywords: ["injecao", "injection", "injetora", "moldagem por injecao"]
      },
      {
        id: "logistics",
        name: "Logística",
        shortName: "Logística",
        color: "#0891b2",
        keywords: ["logistica", "armazenagem", "warehouse", "abastecimento", "expedicao", "recebimento", "estoque", "stock", "porta paletes"]
      },
      {
        id: "machining",
        name: "Usinagem",
        shortName: "Usinagem",
        color: "#2563eb",
        keywords: ["usinagem", "machining", "cnc", "cabecote", "bloco motor", "virabrequim", "crankshaft"]
      }
    ];
    const ADMINISTRATIVE_AREA_TERMS = [
      "rh", "recursos humanos", "administrativo", "administrativa", "financeiro", "financeira",
      "juridico", "compras", "comercial", "escritorio", "bureau", "office"
    ];
    const DEFAULT_MAP_ASSET = DEFAULT_MAPS[FIRST_MAP_ID].image;
    const VALIDATION_STATUSES = ["Discovered", "Pending Validation", "Validated", "Ready for Deployment", "In Deployment", "Active", "Maintenance", "Replaced", "Decommissioned"];
    const ACTIVE_EQUIPMENT_STATUSES = ["Online", "Offline"];
    const VALIDATION_CHECKLIST_KEYS = ["found", "hostname", "ip", "mac", "serial", "port", "photo", "responsible", "deploymentReady"];
    const MAX_IMPORT_POINTS = 1500;
    const MAX_IMPORT_CABLES = 3000;
    const MAX_IMPORT_PROCESSES = 5000;
    const MAX_IMPORT_PROCESS_NODES = 5000;
    const MAX_IMPORT_PROCESS_LINKS = 10000;
    const MAX_IMPORT_JSON_BYTES = 80 * 1024 * 1024;
    const MAX_MAP_FILE_BYTES = 20 * 1024 * 1024;
    const MAX_PHOTO_FILE_BYTES = 12 * 1024 * 1024;
    const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
    const MAX_MAP_DATA_LENGTH = 28 * 1024 * 1024;
    const MAX_PHOTO_DATA_LENGTH = 900000;
    const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
    const TEXT_LIMITS = { short: 120, medium: 260, long: 4000 };
    const dataNode = document.getElementById("embeddedData");
    const appShell = document.querySelector(".app");
    const countrySwitch = document.getElementById("countrySwitch");
    countrySwitch.addEventListener("change", (event) => {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      if (switchCountry(event.target.value) !== true) countrySwitch.value = state.activeMapId;
    });
    const mapStage = document.querySelector(".map-stage");
    const mapHolder = document.getElementById("mapHolder");
    const mapImage = document.getElementById("mapImage");
    const emptyMap = document.getElementById("emptyMap");
    const chooseMap = document.getElementById("chooseMap");
    const mapUpload = document.getElementById("mapUpload");
    const importJson = document.getElementById("importJson");
    const jsonUpload = document.getElementById("jsonUpload");
    const addCableMode = document.getElementById("addCableMode");
    const clearAll = document.getElementById("clearAll");
    const exportHtml = document.getElementById("exportHtml");
    const resizeHandle = document.getElementById("resizeHandle");
    const toggleInspector = document.getElementById("toggleInspector");
    const sidebarInspector = document.getElementById("sidebarInspector");
    const sidebarHome = document.getElementById("sidebarHome");
    const createOperation = document.getElementById("createOperation");
    const editEquipment = document.getElementById("editEquipment");
    const editor = document.getElementById("editor");
    const cableEditor = document.getElementById("cableEditor");
    const panelTitle = document.getElementById("panelTitle");
    const selectionHint = document.getElementById("selectionHint");
    const panelLockToggle = document.getElementById("panelLockToggle");
    const kpiPoints = document.getElementById("kpiPoints");
    const kpiCables = document.getElementById("kpiCables");
    const kpiIssues = document.getElementById("kpiIssues");
    const mapPointCount = document.getElementById("mapPointCount");
    const mapOperationCount = document.getElementById("mapOperationCount");
    const mapCableCount = document.getElementById("mapCableCount");
    const showPoints = document.getElementById("showPoints");
    const showCables = document.getElementById("showCables");
    const showProcesses = document.getElementById("showProcesses");
    const operationSearch = document.getElementById("operationSearch");
    const clearOperationFilters = document.getElementById("clearOperationFilters");
    const industrialAreaFilters = document.getElementById("industrialAreaFilters");
    const mapLegend = document.getElementById("mapLegend");
    const toggleLegend = document.getElementById("toggleLegend");
    const equipmentLegend = document.getElementById("equipmentLegend");
    const operationLegend = document.getElementById("operationLegend");
    const cableLegend = document.getElementById("cableLegend");
    const equipmentId = document.getElementById("equipmentId");
    const equipmentName = document.getElementById("equipmentName");
    const processNameInput = document.getElementById("processNameInput");
    const addProcess = document.getElementById("addProcess");
    const processChips = document.getElementById("processChips");
    const openLinkedOperations = document.getElementById("openLinkedOperations");
    const linkedOperationsCount = document.getElementById("linkedOperationsCount");
    const linkedOperationsDialog = document.getElementById("linkedOperationsDialog");
    const closeLinkedOperations = document.getElementById("closeLinkedOperations");
    const linkedOperationsManagerHost = document.getElementById("linkedOperationsManagerHost");
    const linkedOperationsManager = processChips.closest(".process-manager");
    linkedOperationsManagerHost.appendChild(linkedOperationsManager);
    const equipmentCriticality = document.getElementById("equipmentCriticality");
    const equipmentType = document.getElementById("equipmentType");
    const categoryHint = document.getElementById("categoryHint");
    const equipmentStatus = document.getElementById("equipmentStatus");
    const equipmentCountry = document.getElementById("equipmentCountry");
    const equipmentPlant = document.getElementById("equipmentPlant");
    const equipmentArea = document.getElementById("equipmentArea");
    const equipmentLine = document.getElementById("equipmentLine");
    const equipmentStation = document.getElementById("equipmentStation");
    const equipmentIp = document.getElementById("equipmentIp");
    const equipmentModel = document.getElementById("equipmentModel");
    const equipmentSerial = document.getElementById("equipmentSerial");
    const equipmentMac = document.getElementById("equipmentMac");
    const equipmentVlan = document.getElementById("equipmentVlan");
    const equipmentHostname = document.getElementById("equipmentHostname");
    const equipmentVendor = document.getElementById("equipmentVendor");
    const equipmentOwner = document.getElementById("equipmentOwner");
    const equipmentTicket = document.getElementById("equipmentTicket");
    const equipmentRack = document.getElementById("equipmentRack");
    const equipmentPort = document.getElementById("equipmentPort");
    const markerColor = document.getElementById("markerColor");
    const markerShape = document.getElementById("markerShape");
    const markerLabelMode = document.getElementById("markerLabelMode");
    const markerSize = document.getElementById("markerSize");
    const markerSizeValue = document.getElementById("markerSizeValue");
    const markerPosition = document.getElementById("markerPosition");
    const quickLtsTarget = document.getElementById("quickLtsTarget");
    const quickLtsCable = document.getElementById("quickLtsCable");
    const quickCableType = document.getElementById("quickCableType");
    const quickCableWidth = document.getElementById("quickCableWidth");
    const quickCableId = document.getElementById("quickCableId");
    const equipmentInfo = document.getElementById("equipmentInfo");
    const validationFound = document.getElementById("validationFound");
    const validationHostname = document.getElementById("validationHostname");
    const validationIp = document.getElementById("validationIp");
    const validationMac = document.getElementById("validationMac");
    const validationSerial = document.getElementById("validationSerial");
    const validationPort = document.getElementById("validationPort");
    const validationPhoto = document.getElementById("validationPhoto");
    const validationResponsible = document.getElementById("validationResponsible");
    const validationDeploymentReady = document.getElementById("validationDeploymentReady");
    const validationStatus = document.getElementById("validationStatus");
    const lastValidationDate = document.getElementById("lastValidationDate");
    const validatedBy = document.getElementById("validatedBy");
    const equipmentLink = document.getElementById("equipmentLink");
    const copyEquipmentLink = document.getElementById("copyEquipmentLink");
    const equipmentFormStatus = document.getElementById("equipmentFormStatus");
    const photoUpload = document.getElementById("photoUpload");
    const addPhoto = document.getElementById("addPhoto");
    const photoStatus = document.getElementById("photoStatus");
    const photos = document.getElementById("photos");
    const deletePoint = document.getElementById("deletePoint");
    const equipmentList = document.getElementById("equipmentList");
    const cableList = document.getElementById("cableList");
    const processList = document.getElementById("processList");
    const cableLayer = document.getElementById("cableLayer");
    const mapTools = document.querySelector(".map-tools");
    const toggleMapTools = document.getElementById("toggleMapTools");
    const addPointHint = document.getElementById("addPointHint");
    const addDeviceHint = document.getElementById("addDeviceHint");
    const anchorOperations = document.getElementById("anchorOperations");
    const anchorMap = document.getElementById("anchorMap");
    const menuAddOperation = document.getElementById("menuAddOperation");
    const menuAddEquipment = document.getElementById("menuAddEquipment");
    const menuAddCable = document.getElementById("menuAddCable");
    const menuFitMap = document.getElementById("menuFitMap");
    const menuToggleDevices = document.getElementById("menuToggleDevices");
    const menuToggleCables = document.getElementById("menuToggleCables");
    const fitMap = document.getElementById("fitMap");
    const fullscreenMap = document.getElementById("fullscreenMap");
    const zoomOut = document.getElementById("zoomOut");
    const zoomIn = document.getElementById("zoomIn");
    const zoomReset = document.getElementById("zoomReset");
    const zoomLevel = document.getElementById("zoomLevel");
    const toggleEquipmentLayer = document.getElementById("toggleEquipmentLayer");
    const toggleCableLayer = document.getElementById("toggleCableLayer");
    const toggleLabelLayer = document.getElementById("toggleLabelLayer");
    const cableId = document.getElementById("cableId");
    const cableFrom = document.getElementById("cableFrom");
    const cableTo = document.getElementById("cableTo");
    const cableFromPort = document.getElementById("cableFromPort");
    const cableToPort = document.getElementById("cableToPort");
    const cableType = document.getElementById("cableType");
    const cableStatus = document.getElementById("cableStatus");
    const cableColor = document.getElementById("cableColor");
    const cableWidth = document.getElementById("cableWidth");
    const cableVlan = document.getElementById("cableVlan");
    const cableRack = document.getElementById("cableRack");
    const cableNotes = document.getElementById("cableNotes");
    const deleteCable = document.getElementById("deleteCable");
    const inventoryDashboard = document.getElementById("inventoryDashboard");
    const toggleQaReport = document.getElementById("toggleQaReport");
    const toggleAuditLog = document.getElementById("toggleAuditLog");
    const qaReport = document.getElementById("qaReport");
    const auditLogPanel = document.getElementById("auditLogPanel");
    const pointDialog = document.getElementById("pointDialog");
    const pointForm = document.getElementById("pointForm");
    const pointDialogTitle = pointForm.querySelector("h2");
    const pointSubmit = pointForm.querySelector('button[type="submit"]');
    const newPointId = document.getElementById("newPointId");
    const newPointName = document.getElementById("newPointName");
    const newPointProcess = document.getElementById("newPointProcess");
    const newPointWorkstream = document.getElementById("newPointWorkstream");
    const newPointOperationArea = document.getElementById("newPointOperationArea");
    const processOptions = document.getElementById("processOptions");
    const newPointType = document.getElementById("newPointType");
    const newPointStatus = document.getElementById("newPointStatus");
    const newPointCriticality = document.getElementById("newPointCriticality");
    const newPointCountry = document.getElementById("newPointCountry");
    const newPointPlant = document.getElementById("newPointPlant");
    const newPointArea = document.getElementById("newPointArea");
    const newPointLine = document.getElementById("newPointLine");
    const newPointStation = document.getElementById("newPointStation");
    const newPointModel = document.getElementById("newPointModel");
    const newPointSerial = document.getElementById("newPointSerial");
    const newPointMac = document.getElementById("newPointMac");
    const newPointVlan = document.getElementById("newPointVlan");
    const newPointHostname = document.getElementById("newPointHostname");
    const newPointVendor = document.getElementById("newPointVendor");
    const newPointOwner = document.getElementById("newPointOwner");
    const newPointTicket = document.getElementById("newPointTicket");
    const newPointRack = document.getElementById("newPointRack");
    const newPointPortExtra = document.getElementById("newPointPortExtra");
    const newPointColor = document.getElementById("newPointColor");
    const newPointShape = document.getElementById("newPointShape");
    const newPointInfo = document.getElementById("newPointInfo");
    const newPointHasNetwork = document.getElementById("newPointHasNetwork");
    const newPointNetworkFields = document.getElementById("newPointNetworkFields");
    const newPointIp = document.getElementById("newPointIp");
    const newPointPort = document.getElementById("newPointPort");
    const newPointLtsTarget = document.getElementById("newPointLtsTarget");
    const cancelPoint = document.getElementById("cancelPoint");
    const photoDialog = document.getElementById("photoDialog");
    const largePhoto = document.getElementById("largePhoto");
    const closePhoto = document.getElementById("closePhoto");
    const operationDialog = document.getElementById("operationDialog");
    const operationDialogId = document.getElementById("operationDialogId");
    const operationDialogTitle = document.getElementById("operationDialogTitle");
    const operationDialogSummary = document.getElementById("operationDialogSummary");
    const operationDialogContent = document.getElementById("operationDialogContent");
    const closeOperation = document.getElementById("closeOperation");

    let state = loadInitialState();
    let memoryOnlyChanges = false;
    let stateRevision = 0;
    let selectedId = null;
    let selectedCableId = null;
    let pendingPoint = null;
    let pointDialogMode = "process";
    let pendingProcessName = "";
    let mapCreateMode = "browse";
    let equipmentPlacementSelection = null;
    let navigationSection = "map";
    let contextPanelOpen = !(Number(globalThis.innerWidth) <= 700);
    let contextOperationSearchTerm = "";
    let cableMode = false;
    let cableStartId = null;
    let activeTab = "points";
    let listSearch = "";
    let selectedProcessFilter = "";
    let operationSearchTerm = "";
    let operationSearchTimer = null;
    let selectedIndustrialAreaFilter = "";
    let selectedDeploymentStage = "";
    let selectedDeviceType = "";
    let equipmentSearchResultsOpen = false;
    let showEquipmentLayer = false;
    let showOperationLayer = true;
    let showCableLayer = false;
    let showLabelLayer = true;
    const mapViewStorageKey = (mapId, value) => storageKeyForDocument("interactive-map-generic-v1-map-view:" + mapId + ":" + value);
    const readMapView = (mapId) => {
      const legacyFallback = mapId === FIRST_MAP_ID;
      const zoom = Number(storageGet(mapViewStorageKey(mapId, "zoom")) || (legacyFallback ? storageGet(storageKeyForDocument("interactive-map-generic-v1-map-zoom")) : ""));
      const panX = Number(storageGet(mapViewStorageKey(mapId, "pan-x")) || (legacyFallback ? storageGet(storageKeyForDocument("interactive-map-generic-v1-map-pan-x")) : ""));
      const panY = Number(storageGet(mapViewStorageKey(mapId, "pan-y")) || (legacyFallback ? storageGet(storageKeyForDocument("interactive-map-generic-v1-map-pan-y")) : ""));
      return {
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
        panX: Number.isFinite(panX) ? panX : 0,
        panY: Number.isFinite(panY) ? panY : 0
      };
    };
    const initialMapView = readMapView(state.activeMapId);
    let mapZoom = initialMapView.zoom;
    let mapPanX = initialMapView.panX;
    let mapPanY = initialMapView.panY;
    let mapLocked = storageGet(storageKeyForDocument("interactive-map-generic-v1-map-locked")) === "true";
    let operationsLocked = storageGet(storageKeyForDocument("interactive-map-generic-v1-operations-locked")) === "true";
    let mapPanDrag = null;
    let suppressNextMapClick = false;
    let suppressNextProcessClick = false;
    let processDragState = null;
    let inspectorDrag = null;
    let equipmentFormDirty = false;
    let equipmentEditMode = false;
    let cableFormDirty = false;
    let isRenderingForm = false;
    normalizeState();

    const savedInspectorWidthText = storageGet("interactive-map-generic-v1-inspector-width");
    const savedInspectorWidth = Number(savedInspectorWidthText);
    if (savedInspectorWidthText && Number.isFinite(savedInspectorWidth)) {
      document.documentElement.style.setProperty("--sidebar-width", clampInspectorWidth(savedInspectorWidth) + "px");
    }
    setInspectorCollapsed(true, {
      persist: false,
      refreshMap: false
    });

    function loadInitialState() { return structuredClone(initialServerState.inventory); }

    function parseJson(value, fallback) {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }

    function createUid() {
      return window.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);
    }

    function isSafeUid(value) {
      return /^[A-Za-z0-9_-]{6,80}$/.test(String(value || ""));
    }

    function sanitizeText(value, maxLength = TEXT_LIMITS.medium) {
      return String(value ?? "")
        .replace(/[<>]/g, "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
    }

    function isPlainRecord(value) {
      return !!value && typeof value === "object" && !Array.isArray(value);
    }

    function isSafeImageDataUrl(value, maxLength = MAX_PHOTO_DATA_LENGTH) {
      const text = String(value || "");
      if (!text || text.length > maxLength) return false;
      if (/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(text)) return true;
      return [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,"
      ].some((prefix) => text.startsWith(prefix));
    }

    function countryNameForMap(mapId = state?.activeMapId) {
      return DEFAULT_MAPS[mapId]?.country || "Não informado";
    }

    function normalizeCountry(value, mapId = state?.activeMapId) {
      const clean = sanitizeText(value, TEXT_LIMITS.short);
      const found = COUNTRIES.find((country) => country.toLowerCase() === clean.toLowerCase());
      return found || countryNameForMap(mapId);
    }

    function normalizeValidationStatus(value) {
      const clean = sanitizeText(value, TEXT_LIMITS.short);
      return VALIDATION_STATUSES.includes(clean) ? clean : "Pending Validation";
    }

    function normalizeEquipmentStatus(value) {
      const clean = sanitizeText(value, TEXT_LIMITS.short);
      if (clean === "Active") return "Online";
      if (clean === "Decommissioned") return "Offline";
      return ACTIVE_EQUIPMENT_STATUSES.includes(clean) ? clean : "Online";
    }

    function defaultValidationChecklist() {
      return VALIDATION_CHECKLIST_KEYS.reduce((memo, key) => {
        memo[key] = false;
        return memo;
      }, {});
    }

    function normalizeValidationChecklist(value = {}) {
      const source = value && typeof value === "object" ? value : {};
      const checklist = defaultValidationChecklist();
      VALIDATION_CHECKLIST_KEYS.forEach((key) => {
        checklist[key] = !!source[key];
      });
      return checklist;
    }

    function normalizeMac(value) {
      const compact = String(value || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
      if (!compact) return "";
      if (compact.length !== 12) return null;
      return compact.match(/.{1,2}/g).join(":");
    }

    function normalizeVlan(value) {
      const clean = String(value || "").trim();
      if (!clean) return "";
      const match = clean.match(/^vlan\s*(\d{1,4})$/i) || clean.match(/^(\d{1,4})$/);
      if (!match) return null;
      const number = Number(match[1]);
      if (!Number.isInteger(number) || number < 1 || number > 4094) return null;
      return String(number);
    }

    function isValidIPv4(value) {
      const parts = String(value || "").trim().split(".");
      return parts.length === 4 && parts.every((part) => {
        if (!/^\d{1,3}$/.test(part)) return false;
        const number = Number(part);
        return number >= 0 && number <= 255 && String(number) === String(Number(part));
      });
    }

    function isValidHostname(value) {
      const clean = String(value || "").trim();
      if (!clean) return true;
      if (clean.length > 253 || clean.includes("..")) return false;
      return clean.split(".").every((label) =>
        /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
      );
    }

    function isActiveEquipment(point) {
      return ACTIVE_EQUIPMENT_STATUSES.includes(normalizeEquipmentStatus(point.status)) && point.validationStatus !== "Decommissioned";
    }

    function normalizeDeploymentStage(value, fallback = "AS IS") {
      return value === "TO DO" || value === "AS IS" ? value : fallback;
    }
    function matchesDeviceType(point) {
      return !selectedDeviceType || normalizeCategory(point.type) === selectedDeviceType;
    }
    function matchesDeploymentStage(item) {
      return !selectedDeploymentStage || normalizeDeploymentStage(item?.deploymentStage) === selectedDeploymentStage;
    }
    function deploymentOptions(value = "TO DO") {
      return ["TO DO", "AS IS"].map((stage) => '<option value="' + stage + '"' + (stage === value ? ' selected' : '') + '>' + stage + '</option>').join("");
    }
    function deploymentBadge(item) {
      const badge = document.createElement("span");
      badge.className = "deployment-badge " + (normalizeDeploymentStage(item?.deploymentStage) === "TO DO" ? "todo" : "asis");
      badge.textContent = normalizeDeploymentStage(item?.deploymentStage);
      return badge;
    }
    function updateOperationDeploymentStage(node, value) {
      if (!savePendingEditsBeforeAction()) return false;
      const previous = normalizeDeploymentStage(node.deploymentStage);
      const auditBefore = [...state.auditLogs];
      node.deploymentStage = normalizeDeploymentStage(value);
      recordAudit("operation", node.name, "deploymentStage", previous, node.deploymentStage);
      if (!saveState()) { node.deploymentStage = previous; state.auditLogs = auditBefore; return false; }
      render();
      return true;
    }

    function normalizeCategory(category) {
      return EQUIPMENT_PRESETS[category] ? category : "Other";
    }

    function normalizeWorkstream(workstream) {
      return WORKSTREAMS.includes(workstream) ? workstream : "";
    }

    function workstreamOptionsHtml(selected = "") {
      return '<option value="">Selecione a frente de trabalho</option>' + WORKSTREAMS
        .map((workstream) => '<option value="' + escapeHtml(workstream) + '"' + (workstream === selected ? " selected" : "") + ">" + escapeHtml(uiLabel(workstream)) + "</option>")
        .join("");
    }

    function sizeNameToPixels(size) {
      const sizes = { micro: 12, tiny: 18, small: 26, medium: 36, large: 52 };
      return sizes[size] || 18;
    }

    function clampIconSize(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 18;
      return Math.max(8, Math.min(72, Math.round(number)));
    }

    function processListFromValue(value) {
      if (Array.isArray(value)) {
        return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
      }
      return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
    }

    function pointProcesses(point) {
      return processListFromValue(point.processes?.length ? point.processes : point.process);
    }

    function processText(point) {
      return pointProcesses(point).join(", ");
    }

    function mapViewportFrame(width, height, insets = {}) {
      const fullWidth = Number.isFinite(width) && width > 0 ? width : 1;
      const fullHeight = Number.isFinite(height) && height > 0 ? height : 1;
      const finite = value => Number.isFinite(value) ? Math.max(0, value) : 0;
      const left = Math.min(finite(insets.left), fullWidth - 1);
      const right = Math.min(finite(insets.right), fullWidth - left - 1);
      const top = Math.min(finite(insets.top), fullHeight - 1);
      const bottom = Math.min(finite(insets.bottom), fullHeight - top - 1);
      const visibleWidth = fullWidth - left - right;
      const visibleHeight = fullHeight - top - bottom;
      return { width: visibleWidth, height: visibleHeight,
        centerX: left + visibleWidth / 2, centerY: top + visibleHeight / 2,
        offsetX: (left - right) / 2, offsetY: (top - bottom) / 2 };
    }

    function mapVisibleFrame() {
      const stage = mapStage.getBoundingClientRect();
      const toolbar = document.querySelector(".focus-map-toolbar").getBoundingClientRect();
      const controls = document.querySelector(".compact-map-controls").getBoundingClientRect();
      const summary = document.getElementById("equipmentSummary");
      const clearance = 24; // The full 44px marker hit target remains above overlays.
      const top = Math.max(12, toolbar.bottom - stage.top + clearance);
      let bottom = Math.max(12, stage.bottom - controls.top + clearance);
      if (!summary.hidden && mapStage.clientWidth <= 1100) {
        bottom = Math.max(bottom, stage.bottom - summary.getBoundingClientRect().top + clearance);
      }
      return mapViewportFrame(mapStage.clientWidth, mapStage.clientHeight, { left: 24, right: 24, top, bottom });
    }

    function fittedMapSize() {
      if (!state.mapImage || !mapImage.complete || !mapImage.naturalWidth || !mapImage.naturalHeight) return null;
      const frame = mapVisibleFrame();
      const availableWidth = frame.width;
      const availableHeight = frame.height;
      const fitScale = Math.min(
        availableWidth / mapImage.naturalWidth,
        availableHeight / mapImage.naturalHeight,
        1
      );
      return {
        width: mapImage.naturalWidth * fitScale,
        height: mapImage.naturalHeight * fitScale
      };
    }

    function maximumMapZoom() {
      // Small floorplans still need magnification; fitting keeps native quality by default.
      return 4;
    }

    function clampZoom(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 1;
      return Math.max(0.5, Math.min(maximumMapZoom(), Math.round(number * 20) / 20));
    }

    function mapCanPan() {
      if (!state.mapImage || mapZoom <= 1) return false;
      const frame = mapVisibleFrame();
      return mapHolder.offsetWidth > frame.width || mapHolder.offsetHeight > frame.height;
    }

    function clampMapPan() {
      if (!mapCanPan() || mapImage.classList.contains("hidden") || !mapImage.complete || !mapImage.naturalWidth) return { x: 0, y: 0 };
      const frame = mapVisibleFrame();
      const maxX = Math.max(0, (mapHolder.offsetWidth - frame.width) / 2);
      const maxY = Math.max(0, (mapHolder.offsetHeight - frame.height) / 2);
      return { x: Math.max(-maxX, Math.min(maxX, mapPanX)), y: Math.max(-maxY, Math.min(maxY, mapPanY)) };
    }

    function applyMapZoom(nextZoom = mapZoom, anchorEvent = null) {
      const previousZoom = mapZoom;
      const next = clampZoom(nextZoom);
      if (anchorEvent || next !== previousZoom) {
        const visiblePan = clampMapPan();
        mapPanX = visiblePan.x; mapPanY = visiblePan.y;
      }
      if (anchorEvent && previousZoom > 0 && next > 1) {
        const stageRect = mapStage.getBoundingClientRect();
        const frame = mapVisibleFrame();
        const anchorX = anchorEvent.clientX - stageRect.left - frame.centerX;
        const anchorY = anchorEvent.clientY - stageRect.top - frame.centerY;
        const ratio = next / previousZoom;
        mapPanX = anchorX - (anchorX - mapPanX) * ratio;
        mapPanY = anchorY - (anchorY - mapPanY) * ratio;
      }
      mapZoom = next;
      if (mapZoom <= 1) {
        mapPanX = 0;
        mapPanY = 0;
      }
      zoomLevel.textContent = Math.round(mapZoom * 100) + "%";
      applyMapTransform();
      storageSet(mapViewStorageKey(state.activeMapId, "zoom"), String(mapZoom));
      renderEquipmentMarkers();
    }

    function applyMapTransform() {
      const fitted = fittedMapSize();
      if (fitted) {
        mapHolder.style.width = Math.max(1, Math.round(fitted.width * mapZoom)) + "px";
        mapHolder.style.height = Math.max(1, Math.round(fitted.height * mapZoom)) + "px";
      }
      const frame = mapVisibleFrame();
      const toolbarBottom = document.querySelector(".focus-map-toolbar").getBoundingClientRect().bottom;
      const stageTop = mapStage.getBoundingClientRect().top;
      const appBounds = appShell.getBoundingClientRect();
      const appTop = appBounds.top;
      appShell.style.setProperty("--map-region-left", Math.max(0, mapStage.getBoundingClientRect().left - appBounds.left) + "px");
      appShell.style.setProperty("--map-toolbar-bottom", Math.max(0, toolbarBottom - appTop) + "px");
      mapStage.closest(".map-shell").style.setProperty("--map-toolbar-bottom", Math.max(0, toolbarBottom - stageTop) + "px");
      const visualPan = clampMapPan();
      const devicePixelRatio = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
      const visualX = Math.round(visualPan.x * devicePixelRatio) / devicePixelRatio;
      const visualY = Math.round(visualPan.y * devicePixelRatio) / devicePixelRatio;
      mapHolder.style.setProperty("--map-frame-offset-x", frame.offsetX + "px");
      mapHolder.style.setProperty("--map-frame-offset-y", frame.offsetY + "px");
      const processMarkerScale = mapZoom < 1
        ? Math.max(0.72, 0.82 * mapZoom)
        : Math.min(1.65, 0.82 + (mapZoom - 1) * 0.3);
      mapHolder.style.setProperty("--process-marker-scale", processMarkerScale.toFixed(3));
      mapHolder.classList.toggle("operation-detail-zoom", mapZoom >= 1.5);
      mapHolder.classList.toggle("compact-operation-labels", useCompactOperationLabels((state.processNodes || []).length, mapZoom, !!selectedProcessFilter));
      mapHolder.classList.toggle("operation-closeup-zoom", mapZoom >= 2.5);
      mapHolder.style.setProperty("--map-pan-x", visualX + "px");
      mapHolder.style.setProperty("--map-pan-y", visualY + "px");
      mapHolder.classList.toggle("pannable", mapCanPan());
      mapHolder.classList.toggle("map-locked", mapLocked);
      storageSet(mapViewStorageKey(state.activeMapId, "zoom"), String(mapZoom));
      storageSet(mapViewStorageKey(state.activeMapId, "pan-x"), String(mapPanX));
      storageSet(mapViewStorageKey(state.activeMapId, "pan-y"), String(mapPanY));
    }

    function normalizeState() {
      state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs.slice(-1000) : [];
      state.lastUpdated = state.lastUpdated || "";
      const hadMapCollection = !!state.maps && Object.keys(state.maps).length > 0;
      const previousSingleMap = {
        mapImage: state.mapImage || "",
        points: Array.isArray(state.points) ? state.points : [],
        cables: Array.isArray(state.cables) ? state.cables : [],
        processes: Array.isArray(state.processes) ? state.processes : [],
        processNodes: Array.isArray(state.processNodes) ? state.processNodes : [],
        processLinks: Array.isArray(state.processLinks) ? state.processLinks : []
      };
      state.activeMapId = DEFAULT_MAPS[state.activeMapId] ? state.activeMapId : FIRST_MAP_ID;
      state.maps = state.maps || {};
      if (state.maps[FIRST_MAP_ID]?.mapImage === DEFAULT_MAPS[FIRST_MAP_ID].image) {
        state.maps[FIRST_MAP_ID].mapImage = DEFAULT_MAP_ASSET;
      }


      Object.values(DEFAULT_MAPS).forEach((map) => {
        state.maps[map.id] = state.maps[map.id] || {};
        state.maps[map.id].mapImage = state.maps[map.id].mapImage || (map.id === FIRST_MAP_ID ? DEFAULT_MAP_ASSET : map.image);
        state.maps[map.id].points = Array.isArray(state.maps[map.id].points) ? state.maps[map.id].points : [];
        state.maps[map.id].cables = Array.isArray(state.maps[map.id].cables) ? state.maps[map.id].cables : [];
        state.maps[map.id].processes = Array.isArray(state.maps[map.id].processes) ? state.maps[map.id].processes : [];
        state.maps[map.id].processNodes = Array.isArray(state.maps[map.id].processNodes) ? state.maps[map.id].processNodes : [];
        state.maps[map.id].processLinks = Array.isArray(state.maps[map.id].processLinks) ? state.maps[map.id].processLinks : [];
      });
      if (!hadMapCollection && (previousSingleMap.mapImage || previousSingleMap.points.length || previousSingleMap.cables.length || previousSingleMap.processes.length || previousSingleMap.processNodes.length || previousSingleMap.processLinks.length)) {
        state.maps[state.activeMapId] = previousSingleMap;
      }
      const activeMap = state.maps[state.activeMapId];
      state.mapImage = activeMap.mapImage || DEFAULT_MAPS[state.activeMapId].image;
      state.points = activeMap.points || [];
      state.cables = activeMap.cables || [];
      state.processes = activeMap.processes || [];
      state.processNodes = Array.isArray(activeMap.processNodes) ? activeMap.processNodes : [];
      state.processLinks = Array.isArray(activeMap.processLinks) ? activeMap.processLinks : [];
      state.points = (state.points || []).filter(isPlainRecord).map((point, index) => {
        const category = normalizeCategory(point.type);
        const normalizedMac = normalizeMac(point.mac);
        const normalizedVlan = normalizeVlan(point.vlan);
        return {
          uid: isSafeUid(point.uid) ? String(point.uid) : createUid(),
          markerId: sanitizeText(point.markerId || "PR-" + String(index + 1).padStart(2, "0"), TEXT_LIMITS.short),
          name: sanitizeText(point.name, TEXT_LIMITS.medium),
          deploymentStage: normalizeDeploymentStage(point.deploymentStage),
          info: sanitizeText(point.info, TEXT_LIMITS.long),
          x: Number.isFinite(point.x) ? Math.max(0, Math.min(100, point.x)) : 50,
          y: Number.isFinite(point.y) ? Math.max(0, Math.min(100, point.y)) : 50,
          country: normalizeCountry(point.country, state.activeMapId),
          plant: sanitizeText(point.plant || point.site || "", TEXT_LIMITS.short),
          area: sanitizeText(point.area || "", TEXT_LIMITS.short),
          productionLine: sanitizeText(point.productionLine || point.line || "", TEXT_LIMITS.short),
          station: sanitizeText(point.station || "", TEXT_LIMITS.short),
          process: sanitizeText(point.process || "", TEXT_LIMITS.medium),
          processes: pointProcesses(point).map((name) => sanitizeText(name, TEXT_LIMITS.short)).filter(Boolean),
          type: category,
          criticality: sanitizeText(point.criticality || "Medium", TEXT_LIMITS.short),
          status: normalizeEquipmentStatus(point.status),
          validationStatus: normalizeValidationStatus(point.validationStatus || (point.status === "Decommissioned" ? "Decommissioned" : normalizeEquipmentStatus(point.status) === "Online" ? "Active" : "Pending Validation")),
          validationChecklist: normalizeValidationChecklist(point.validationChecklist),
          lastValidationDate: sanitizeText(point.lastValidationDate || "", TEXT_LIMITS.short),
          validatedBy: sanitizeText(point.validatedBy || "", TEXT_LIMITS.short),
          ip: sanitizeText(point.ip || "", TEXT_LIMITS.short),
          model: sanitizeText(point.model || "", TEXT_LIMITS.short),
          serial: sanitizeText(point.serial || "", TEXT_LIMITS.short),
          mac: normalizedMac === null ? sanitizeText(point.mac || "", TEXT_LIMITS.short) : normalizedMac,
          vlan: normalizedVlan === null ? sanitizeText(point.vlan || "", TEXT_LIMITS.short) : normalizedVlan,
          hostname: sanitizeText(point.hostname || "", TEXT_LIMITS.short),
          vendor: sanitizeText(point.vendor || "", TEXT_LIMITS.short),
          owner: sanitizeText(point.owner || "", TEXT_LIMITS.short),
          ticket: sanitizeText(point.ticket || "", TEXT_LIMITS.short),
          rack: sanitizeText(point.rack || point.panel || "", TEXT_LIMITS.short),
          port: sanitizeText(point.port || "", TEXT_LIMITS.short),
          color: /^#[0-9a-fA-F]{6}$/.test(point.color || "") ? point.color : EQUIPMENT_PRESETS[category].color,
          shape: ["pin", "circle", "square", "diamond"].includes(point.shape) ? point.shape : EQUIPMENT_PRESETS[category].shape,
          labelMode: ["id", "name", "both"].includes(point.labelMode) ? point.labelMode : "id",
          size: point.size || "tiny",
          iconSize: clampIconSize(point.iconSize || sizeNameToPixels(point.size || "tiny")),
          locked: !!point.locked,
          photos: Array.isArray(point.photos)
            ? point.photos.filter((photo) => isSafeImageDataUrl(photo))
            : []
        };
      });
      state.processes = [...new Set([
        ...(state.processes || []).slice(0, MAX_IMPORT_PROCESSES),
        ...state.points.flatMap((point) => point.processes || []),
        ...(state.processNodes || []).filter(isPlainRecord).slice(0, MAX_IMPORT_PROCESS_NODES).map((node) => node.name)
      ].map((item) => sanitizeText(item, TEXT_LIMITS.short)).filter(Boolean))].sort().slice(0, MAX_IMPORT_PROCESSES);
      state.processNodes = (state.processNodes || []).filter(isPlainRecord).slice(0, MAX_IMPORT_PROCESS_NODES).map((node, index) => ({
        uid: isSafeUid(node.uid) ? String(node.uid) : createUid(),
        name: sanitizeText(node.name || "", TEXT_LIMITS.short),
        deploymentStage: normalizeDeploymentStage(node.deploymentStage),
        processId: sanitizeText(node.processId || "", TEXT_LIMITS.short),
        area: sanitizeText(node.area || "", TEXT_LIMITS.short),
        workstream: normalizeWorkstream(node.workstream || ""),
        color: /^#[0-9a-fA-F]{6}$/.test(node.color || "") ? node.color : operationColor(node),
        operationProcesses: processListFromValue(node.operationProcesses || node.steps || node.childProcesses || []),
        permanentPinned: !!(node.permanentPinned || node.permanentFixed),
        pinned: !!(node.pinned || node.fixed || node.locked || node.permanentPinned || node.permanentFixed),
        x: Number.isFinite(node.x) ? Math.max(0, Math.min(100, node.x)) : 50,
        y: Number.isFinite(node.y) ? Math.max(0, Math.min(100, node.y)) : 50
      })).filter((node) => node.name);
      state.processes.forEach((name, index) => {
        if (!state.processNodes.some((node) => node.name === name)) {
          state.processNodes.push({
            uid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + index + 3000),
            name,
            deploymentStage: "AS IS",
            processId: "OP-" + String(index + 1).padStart(2, "0"),
            color: operationColor(name),
            area: "",
            workstream: "",
            operationProcesses: [],
            permanentPinned: false,
            pinned: false,
            x: 50 + ((index % 5) - 2) * 5,
            y: 50 + (Math.floor(index / 5) % 5 - 2) * 5
          });
        }
      });
      const usedProcessIds = new Set();
      state.processNodes.forEach((node) => {
        if (!node.processId || usedProcessIds.has(node.processId)) {
          node.processId = nextProcessId(usedProcessIds);
        }
        usedProcessIds.add(node.processId);
        if (!node.area) {
          const inferredIndustrialArea = industrialAreaDefinition(node.name);
          if (inferredIndustrialArea) node.area = inferredIndustrialArea.name;
        }
        node.operationProcesses = processListFromValue(node.operationProcesses || []);
        node.permanentPinned = !!node.permanentPinned;
        node.pinned = node.permanentPinned || operationsLocked || !!node.pinned;
      });
      state.processLinks = (state.processLinks || []).filter(isPlainRecord).slice(0, MAX_IMPORT_PROCESS_LINKS).map((link, index) => ({
        uid: isSafeUid(link.uid) ? String(link.uid) : createUid(),
        from: sanitizeText(link.from || "", TEXT_LIMITS.short),
        to: sanitizeText(link.to || "", TEXT_LIMITS.short)
      })).filter((link) => link.from && link.to && link.from !== link.to && state.processes.includes(link.from) && state.processes.includes(link.to));
      state.cables = (state.cables || []).filter(isPlainRecord).map((cable, index) => {
        const normalizedVlan = normalizeVlan(cable.vlan);
        return {
          uid: isSafeUid(cable.uid) ? String(cable.uid) : createUid(),
          cableId: sanitizeText(cable.cableId || "CBL-" + String(index + 1).padStart(3, "0"), TEXT_LIMITS.short),
          from: sanitizeText(cable.from || "", TEXT_LIMITS.short),
          to: sanitizeText(cable.to || "", TEXT_LIMITS.short),
          fromPort: sanitizeText(cable.fromPort || "", TEXT_LIMITS.short),
          toPort: sanitizeText(cable.toPort || "", TEXT_LIMITS.short),
          type: sanitizeText(cable.type || "Ethernet", TEXT_LIMITS.short),
          status: sanitizeText(cable.status || "Active", TEXT_LIMITS.short),
          color: /^#[0-9a-fA-F]{6}$/.test(cable.color || "") ? cable.color : "#2563eb",
          width: ["0.5", "1", "2", "4", "7", "10"].includes(String(cable.width)) ? String(cable.width) : "4",
          vlan: normalizedVlan === null ? sanitizeText(cable.vlan || "", TEXT_LIMITS.short) : normalizedVlan,
          rackSwitch: sanitizeText(cable.rackSwitch || cable.rack || cable.switch || "", TEXT_LIMITS.short),
          notes: sanitizeText(cable.notes || "", TEXT_LIMITS.long)
        };
      }).filter((cable) => pointById(cable.from) && pointById(cable.to));
      // Legacy devices without operation links remain in the inventory. They
      // can be reviewed and linked instead of disappearing during migration.
      state.cables = state.cables.filter((cable) => pointById(cable.from) && pointById(cable.to));
      saveActiveMap();
    }

    function saveState() {
      stateRevision += 1;
      state.lastUpdated = new Date().toISOString();
      saveActiveMap();
      memoryOnlyChanges = true;
      scheduleServerSave();
      return true;
    }

    function currentAuditUser() {
      return sanitizeText(authSession.username, TEXT_LIMITS.short);
    }

    function recordAudit(entity, entityId, field, oldValue, newValue, action = "update") {
      const before = typeof oldValue === "string" ? oldValue : JSON.stringify(oldValue ?? "");
      const after = typeof newValue === "string" ? newValue : JSON.stringify(newValue ?? "");
      if (action === "update" && before === after) return;
      if (action === "export") return;
      state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
      state.auditLogs.push({
        id: createUid(),
        timestamp: new Date().toISOString(),
        entity,
        entityId: String(entityId || ""),
        field: String(field || ""),
        mapId: state.activeMapId || "",
        oldValue: "",
        newValue: "",
        action,
        user: currentAuditUser()
      });
      if (state.auditLogs.length > 1000) {
        state.auditLogs = state.auditLogs.slice(-1000);
      }
    }

    function saveActiveMap() {
      if (!state.maps || !state.activeMapId) return;
      state.maps[state.activeMapId] = {
        mapImage: state.mapImage || DEFAULT_MAPS[state.activeMapId]?.image || "",
        points: state.points || [],
        cables: state.cables || [],
        processes: state.processes || [],
        processNodes: state.processNodes || [],
        processLinks: state.processLinks || []
      };
    }

    function persistableState(options = {}) {
      const embedDefaultMaps = !!options.embedDefaultMaps;
      saveActiveMap();
      const maps = {};
      Object.keys(state.maps || {}).forEach((mapId) => {
        const map = state.maps[mapId];
        maps[mapId] = {
          mapImage: !embedDefaultMaps && map.mapImage === DEFAULT_MAPS[mapId]?.image ? "" : map.mapImage,
          points: map.points || [],
          cables: map.cables || [],
          processes: map.processes || [],
          processNodes: map.processNodes || [],
          processLinks: map.processLinks || []
        };
      });
      return {
        activeMapId: state.activeMapId,
        auditLogs: state.auditLogs || [],
        lastUpdated: state.lastUpdated || "",
        maps,
        mapImage: "",
        points: [],
        cables: []
      };
    }

    function sanitizeImportPayload(imported) {
      const summary = { importedPoints: 0, importedCables: 0, ignoredPoints: 0, ignoredCables: 0, repairedUids: 0 };
      const importActiveMapId = DEFAULT_MAPS[imported.activeMapId] ? imported.activeMapId : state.activeMapId;
      const next = {
        activeMapId: importActiveMapId,
        auditLogs: Array.isArray(imported.auditLogs) ? imported.auditLogs.filter(isPlainRecord).slice(-1000).map((log) => ({
          id: isSafeUid(log.id) ? String(log.id) : createUid(),
          timestamp: sanitizeText(log.timestamp || new Date().toISOString(), TEXT_LIMITS.short),
          entity: sanitizeText(log.entity || "", TEXT_LIMITS.short),
          entityId: sanitizeText(log.entityId || "", TEXT_LIMITS.short),
          field: sanitizeText(log.field || "", TEXT_LIMITS.short),
          mapId: DEFAULT_MAPS[log.mapId] ? log.mapId : importActiveMapId,
          oldValue: sanitizeText(log.oldValue || "", 500),
          newValue: sanitizeText(log.newValue || "", 500),
          action: sanitizeText(log.action || "", TEXT_LIMITS.short),
          user: sanitizeText(log.user || "local-user", TEXT_LIMITS.short)
        })) : [],
        lastUpdated: sanitizeText(imported.lastUpdated || "", TEXT_LIMITS.short),
        maps: {}
      };
      const sourceMaps = isPlainRecord(imported.maps) ? imported.maps : {
        [next.activeMapId]: {
          mapImage: imported.mapImage || "",
          points: imported.points || [],
          cables: imported.cables || [],
          processes: imported.processes || [],
          processNodes: imported.processNodes || [],
          processLinks: imported.processLinks || []
        }
      };
      Object.keys(DEFAULT_MAPS).forEach((mapId) => {
        const source = isPlainRecord(sourceMaps[mapId]) ? sourceMaps[mapId] : {};
        if ((Array.isArray(source.points) && source.points.length > MAX_IMPORT_POINTS) ||
            (Array.isArray(source.cables) && source.cables.length > MAX_IMPORT_CABLES)) {
          throw new Error("Importação cancelada: a planta " + mapId + " excede o limite de " + MAX_IMPORT_POINTS + " equipamentos ou " + MAX_IMPORT_CABLES + " cabos. Os dados atuais foram preservados.");
        }
        const sourcePoints = Array.isArray(source.points) ? source.points : [];
        const sourceCables = Array.isArray(source.cables) ? source.cables : [];
        const rawPoints = sourcePoints.filter(isPlainRecord);
        const rawCables = sourceCables.filter(isPlainRecord);
        summary.ignoredPoints += Math.max(0, sourcePoints.length - MAX_IMPORT_POINTS) + (sourcePoints.length - rawPoints.length);
        summary.ignoredCables += Math.max(0, sourceCables.length - MAX_IMPORT_CABLES) + (sourceCables.length - rawCables.length);
        next.maps[mapId] = {
          mapImage: isSafeImageDataUrl(source.mapImage, MAX_MAP_DATA_LENGTH) ? String(source.mapImage) : "",
          points: rawPoints.slice(0, MAX_IMPORT_POINTS).map((point) => {
            if (point.uid && !isSafeUid(point.uid)) summary.repairedUids += 1;
            summary.importedPoints += 1;
            const normalizedMac = normalizeMac(point.mac);
            const normalizedVlan = normalizeVlan(point.vlan);
            return {
              ...point,
              uid: isSafeUid(point.uid) ? String(point.uid) : "",
              markerId: sanitizeText(point.markerId, TEXT_LIMITS.short),
              name: sanitizeText(point.name, TEXT_LIMITS.medium),
              deploymentStage: normalizeDeploymentStage(point.deploymentStage),
              info: sanitizeText(point.info, TEXT_LIMITS.long),
              country: normalizeCountry(point.country, mapId),
              plant: sanitizeText(point.plant || point.site || "", TEXT_LIMITS.short),
              area: sanitizeText(point.area, TEXT_LIMITS.short),
              productionLine: sanitizeText(point.productionLine || point.line || "", TEXT_LIMITS.short),
              station: sanitizeText(point.station, TEXT_LIMITS.short),
              process: sanitizeText(point.process, TEXT_LIMITS.medium),
              processes: processListFromValue(point.processes || point.process).map((name) => sanitizeText(name, TEXT_LIMITS.short)).filter(Boolean),
              ip: sanitizeText(point.ip, TEXT_LIMITS.short),
              mac: normalizedMac === null ? sanitizeText(point.mac, TEXT_LIMITS.short) : normalizedMac,
              vlan: normalizedVlan === null ? sanitizeText(point.vlan, TEXT_LIMITS.short) : normalizedVlan,
              hostname: sanitizeText(point.hostname, TEXT_LIMITS.short),
              serial: sanitizeText(point.serial, TEXT_LIMITS.short),
              model: sanitizeText(point.model, TEXT_LIMITS.short),
              vendor: sanitizeText(point.vendor, TEXT_LIMITS.short),
              owner: sanitizeText(point.owner, TEXT_LIMITS.short),
              ticket: sanitizeText(point.ticket, TEXT_LIMITS.short),
              rack: sanitizeText(point.rack, TEXT_LIMITS.short),
              port: sanitizeText(point.port, TEXT_LIMITS.short),
              status: normalizeEquipmentStatus(point.status),
              validationChecklist: normalizeValidationChecklist(point.validationChecklist),
              validationStatus: normalizeValidationStatus(point.validationStatus || (point.status === "Decommissioned" ? "Decommissioned" : "Pending Validation")),
              lastValidationDate: sanitizeText(point.lastValidationDate, TEXT_LIMITS.short),
              validatedBy: sanitizeText(point.validatedBy, TEXT_LIMITS.short),
              photos: Array.isArray(point.photos)
                ? point.photos.filter((photo) => isSafeImageDataUrl(photo))
                : []
            };
          }),
          cables: rawCables.slice(0, MAX_IMPORT_CABLES).map((cable) => {
            summary.importedCables += 1;
            const normalizedVlan = normalizeVlan(cable.vlan);
            return {
              ...cable,
              uid: isSafeUid(cable.uid) ? String(cable.uid) : "",
              cableId: sanitizeText(cable.cableId, TEXT_LIMITS.short),
              from: sanitizeText(cable.from, TEXT_LIMITS.short),
              to: sanitizeText(cable.to, TEXT_LIMITS.short),
              fromPort: sanitizeText(cable.fromPort, TEXT_LIMITS.short),
              toPort: sanitizeText(cable.toPort, TEXT_LIMITS.short),
              type: sanitizeText(cable.type || "Ethernet", TEXT_LIMITS.short),
              status: sanitizeText(cable.status || "Active", TEXT_LIMITS.short),
              vlan: normalizedVlan === null ? sanitizeText(cable.vlan, TEXT_LIMITS.short) : normalizedVlan,
              rackSwitch: sanitizeText(cable.rackSwitch || cable.rack || cable.switch || "", TEXT_LIMITS.short),
              notes: sanitizeText(cable.notes, TEXT_LIMITS.long)
            };
          }),
          processes: processListFromValue(Array.isArray(source.processes) ? source.processes.slice(0, MAX_IMPORT_PROCESSES) : [])
            .map((name) => sanitizeText(name, TEXT_LIMITS.short)).filter(Boolean),
          processNodes: Array.isArray(source.processNodes) ? source.processNodes.filter(isPlainRecord).slice(0, MAX_IMPORT_PROCESS_NODES).map((node) => ({
            ...node,
            uid: isSafeUid(node.uid) ? String(node.uid) : "",
            name: sanitizeText(node.name, TEXT_LIMITS.short),
            deploymentStage: normalizeDeploymentStage(node.deploymentStage),
            processId: sanitizeText(node.processId, TEXT_LIMITS.short),
            area: sanitizeText(node.area, TEXT_LIMITS.short),
            workstream: normalizeWorkstream(node.workstream || ""),
            operationProcesses: processListFromValue(node.operationProcesses || node.steps || node.childProcesses || [])
              .slice(0, MAX_IMPORT_PROCESSES).map((name) => sanitizeText(name, TEXT_LIMITS.short)).filter(Boolean),
            permanentPinned: !!(node.permanentPinned || node.permanentFixed),
            pinned: !!(node.pinned || node.fixed || node.locked || node.permanentPinned || node.permanentFixed)
          })) : [],
          processLinks: Array.isArray(source.processLinks) ? source.processLinks.filter(isPlainRecord).slice(0, MAX_IMPORT_PROCESS_LINKS).map((link) => ({
            ...link,
            uid: isSafeUid(link.uid) ? String(link.uid) : "",
            from: sanitizeText(link.from, TEXT_LIMITS.short),
            to: sanitizeText(link.to, TEXT_LIMITS.short)
          })) : []
        };
      });
      return { nextState: next, summary };
    }

    function switchCountry(mapId) {
      if (!DEFAULT_MAPS[mapId] || mapId === state.activeMapId) return false;
      if (!confirmDiscardPendingChanges()) return false;
      // Changing plants is navigation, not an inventory mutation. Persist the
      // active map when possible, but never block navigation on a full or
      // unavailable browser storage.
      saveActiveMap();
      state.activeMapId = mapId;
      const activeMap = state.maps[mapId] || { mapImage: mapId === FIRST_MAP_ID ? DEFAULT_MAP_ASSET : DEFAULT_MAPS[mapId].image, points: [], cables: [], processes: [], processNodes: [], processLinks: [] };
      state.mapImage = activeMap.mapImage || (mapId === FIRST_MAP_ID ? DEFAULT_MAP_ASSET : DEFAULT_MAPS[mapId].image);
      state.points = activeMap.points || [];
      state.cables = activeMap.cables || [];
      state.processes = activeMap.processes || [];
      state.processNodes = activeMap.processNodes || [];
      state.processLinks = activeMap.processLinks || [];
      selectedId = null;
      selectedCableId = null;
      selectedProcessFilter = "";
      operationSearchTerm = "";
      selectedIndustrialAreaFilter = "";
      equipmentFormDirty = false;
      equipmentEditMode = false;
      cableFormDirty = false;
      cableMode = false;
      cableStartId = null;
      photoStatus.textContent = "";
      photoStatus.classList.remove("error");
      photoStatus.classList.add("hidden");
      const nextMapView = readMapView(mapId);
      mapZoom = nextMapView.zoom;
      mapPanX = nextMapView.panX;
      mapPanY = nextMapView.panY;
      const browserSaved = saveState();
      render();
      if (!browserSaved) {
        selectionHint.textContent = "Planta alterada somente nesta sessão. O armazenamento do navegador está indisponível; clique em Salvar no servidor antes de fechar ou recarregar.";
      }
      return true;
    }

    async function uploadAsset(blob) {
      const result=await api('/api/assets',{method:'POST',body:blob,headers:{'Content-Type':blob.type}});return result.url;
    }
    async function fileToDataUrl(file) { return uploadAsset(file); }

    async function validateImageFile(file, options = {}) {
      const maxBytes = options.maxBytes || MAX_PHOTO_FILE_BYTES;
      const maxPixels = options.maxPixels || MAX_IMAGE_PIXELS;
      const mime = String(file?.type || "").toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(mime)) {
        throw new Error("Formato de imagem não permitido. Use PNG, JPG ou WebP.");
      }
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
        throw new Error("O arquivo excede o limite permitido de " + Math.round(maxBytes / 1024 / 1024) + " MB.");
      }
      const sourceUrl = URL.createObjectURL(file);
      try {
        const image = await loadImage(sourceUrl);
        const pixelCount = image.naturalWidth * image.naturalHeight;
        if (!image.naturalWidth || !image.naturalHeight || pixelCount > maxPixels) {
          throw new Error("A imagem excede o limite seguro de resolução.");
        }
        return { width: image.naturalWidth, height: image.naturalHeight };
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    }

    async function imageFileToCompressedDataUrl(file, options = {}) {
      const maxDimension = options.maxDimension || 1400;
      const quality = options.quality || 0.72;
      const sourceUrl = URL.createObjectURL(file);
      try {
        const image = await loadImage(sourceUrl);
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
        if(!blob)throw new Error("Não foi possível processar imagem.");
        return uploadAsset(blob);
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    }

    function showPhotoStatus(message, isError = false) {
      photoStatus.textContent = message;
      photoStatus.classList.toggle("error", isError);
      photoStatus.classList.remove("hidden");
    }

    function downloadFile(filename, contents, type) {
      const blob = new Blob([contents], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      // Revoke only after the browser has consumed the download URL. Revoking
      // it in the same task can make the fallback download fail in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function csvValue(value) {
      const raw = String(value ?? "");
      const safe = /^\s*[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
      return '"' + safe.replace(/"/g, '""') + '"';
    }

    function buildCsv() {
      const active = DEFAULT_MAPS[state.activeMapId];
      const activeCountry = active.country || countryNameForMap(state.activeMapId);
      const pointRows = [
        ["COUNTRY", "RECORD", "OPERATION", "CLASSIFICATION", "ID", "NAME", "CATEGORY", "CRITICALITY", "STATUS", "PLANT", "AREA", "LINE", "STATION", "HOSTNAME", "IP", "MAC", "VLAN", "VENDOR", "MODEL", "SERIAL", "OWNER", "TICKET", "RACK", "PORT", "VALIDATION STATUS", "X", "Y", "NOTES"],
        ...filteredPoints().map((point) => [
          point.country || activeCountry, "POINT", processText(point), normalizeDeploymentStage(point.deploymentStage), point.markerId, point.name, point.type, point.criticality, point.status,
          point.plant, point.area, point.productionLine, point.station, point.hostname, point.ip, point.mac, point.vlan, point.vendor, point.model, point.serial,
          point.owner, point.ticket, point.rack, point.port, point.validationStatus, point.x.toFixed(2), point.y.toFixed(2), point.info
        ])
      ];
      const cableRows = [
        [],
        ["COUNTRY", "RECORD", "OPERATION", "CABLE ID", "FROM", "FROM CATEGORY", "FROM PORT", "TO", "TO CATEGORY", "TO PORT", "TYPE", "STATUS", "VLAN", "RACK/SWITCH", "COLOR", "WIDTH", "NOTES"],
        ...filteredCables().map((cable) => [
          activeCountry, "CABLE", processText(pointById(cable.from) || {}) || processText(pointById(cable.to) || {}),
          cable.cableId, pointName(pointById(cable.from)), pointById(cable.from)?.type || "", cable.fromPort,
          pointName(pointById(cable.to)), pointById(cable.to)?.type || "", cable.toPort,
          cable.type, cable.status, cable.vlan, cable.rackSwitch, cable.color, cable.width, cable.notes
        ])
      ];
      return [...pointRows, ...cableRows].map((row) => row.map(csvValue).join(",")).join("\n");
    }

    function buildEquipmentCsv(points = filteredPoints()) {
      const rows = [
        ["COUNTRY", "PLANT", "AREA", "LINE", "STATION", "OPERATION", "CLASSIFICATION", "MARKER ID", "NAME", "TYPE", "STATUS", "VALIDATION STATUS", "HOSTNAME", "IP", "MAC", "VLAN", "MODEL", "SERIAL", "OWNER", "RACK", "PORT", "X", "Y"],
        ...points.map((point) => [
          point.country, point.plant, point.area, point.productionLine, point.station, processText(point), normalizeDeploymentStage(point.deploymentStage), point.markerId, point.name, point.type, point.status,
          point.validationStatus, point.hostname, point.ip, point.mac, point.vlan, point.model, point.serial, point.owner, point.rack, point.port,
          point.x?.toFixed ? point.x.toFixed(2) : point.x, point.y?.toFixed ? point.y.toFixed(2) : point.y
        ])
      ];
      return rows.map((row) => row.map(csvValue).join(",")).join("\n");
    }

    function buildCableCsv(cables = filteredCables()) {
      const rows = [
        ["CABLE ID", "FROM", "FROM PORT", "TO", "TO PORT", "TYPE", "STATUS", "VLAN", "RACK/SWITCH", "COLOR", "WIDTH", "NOTES"],
        ...cables.map((cable) => [
          cable.cableId, pointName(pointById(cable.from)), cable.fromPort, pointName(pointById(cable.to)), cable.toPort,
          cable.type, cable.status, cable.vlan, cable.rackSwitch, cable.color, cable.width, cable.notes
        ])
      ];
      return rows.map((row) => row.map(csvValue).join(",")).join("\n");
    }

    function buildIssuesCsv() {
      const rows = [
        ["SEVERITY", "ENTITY", "ENTITY ID", "TITLE", "DETAIL"],
        ...buildDataQualityIssues().map((issue) => [issue.severity, issue.entity, issue.id, issue.title, issue.detail])
      ];
      return rows.map((row) => row.map(csvValue).join(",")).join("\n");
    }

    function buildSummaryCsv() {
      const points = allInventoryPoints();
      const rows = [
        ["METRIC", "VALUE"],
        ["Total de equipamentos", points.length],
        ["Total de cabos", allInventoryCables().length],
        ["Validação pendente", points.filter((point) => point.validationStatus === "Pending Validation" || point.status === "Pending Validation").length],
        ["Current inconsistencies", buildDataQualityIssues().length],
        ["By country", countsText(countBy(points, (point) => normalizeCountry(point.country, point.mapId)))],
        ["By type", countsText(countBy(points, (point) => point.type || "Equipment"))],
        ["By status", countsText(countBy(points, (point) => normalizeEquipmentStatus(point.status)))],
        ["Last update", state.lastUpdated || ""]
      ];
      return rows.map((row) => row.map(csvValue).join(",")).join("\n");
    }

    function pointById(uid) {
      return state.points.find((point) => point.uid === uid) || null;
    }

    function cableById(uid) {
      return state.cables.find((cable) => cable.uid === uid) || null;
    }

    function pointName(point) {
      if (!point) return "Unknown";
      return [point.markerId, point.name].filter(Boolean).join(" - ") || "Unnamed";
    }

    function processNodeByName(name) {
      const target = String(name || "").trim().toLowerCase();
      return (state.processNodes || []).find((node) => String(node.name || "").trim().toLowerCase() === target) || null;
    }

    function processDisplayId(processNameOrNode) {
      const node = typeof processNameOrNode === "string" ? processNodeByName(processNameOrNode) : processNameOrNode;
      return node?.processId || "OP";
    }

    function normalizeIndustrialAreaText(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    function industrialAreaDefinition(value) {
      const normalizedArea = normalizeIndustrialAreaText(value);
      if (!normalizedArea) return null;
      const administrativeArea = ADMINISTRATIVE_AREA_TERMS.some((term) => {
        const normalizedTerm = normalizeIndustrialAreaText(term);
        return normalizedArea === normalizedTerm || (" " + normalizedArea + " ").includes(" " + normalizedTerm + " ");
      });
      if (administrativeArea) return null;
      return INDUSTRIAL_AREAS.find((area) =>
        [area.name, ...(area.keywords || [])].some((keyword) => {
          const normalizedKeyword = normalizeIndustrialAreaText(keyword);
          return normalizedArea === normalizedKeyword || normalizedArea.includes(normalizedKeyword);
        })
      ) || null;
    }

    function operationColor(processNameOrNode) {
      const node = typeof processNameOrNode === "string" ? processNodeByName(processNameOrNode) : processNameOrNode;
      const industrialArea = industrialAreaDefinition(node?.area || "");
      if (industrialArea) return industrialArea.color;
      if (/^#[0-9a-fA-F]{6}$/.test(node?.color || "")) return node.color;
      const name = String(node?.name || processNameOrNode || "operation");
      const names = [...new Set([
        ...(state.processNodes || []).map((item) => String(item.name || "").trim()),
        name
      ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const index = Math.max(0, names.indexOf(name));
      return OPERATION_COLORS[index % OPERATION_COLORS.length];
    }

    function operationSummariesWithEquipment() {
      return processSummaries().filter((summary) =>
        operationMatchesFilters(summary)
      );
    }

    function operationMatchesSearch(summary, searchTerm = operationSearchTerm) {
      return operationMatchesSearchQuery({ ...summary, node: { ...summary.node, processId: processDisplayId(summary.node) } }, searchTerm);
    }

    function pointMatchesGlobalSearch(point) {
      if (equipmentMatchesSearch(point, operationSearchTerm)) return true;
      return pointProcesses(point).some(name => {
        const node = processNodeByName(name);
        return operationMatchesSearch({ name, node, area: node?.area || "", points: [point] });
      });
    }

    function operationMatchesFilters(summary) {
      if (selectedDeviceType && !summary.points.length) return false;
      if (selectedIndustrialAreaFilter && summary.industrialArea?.id !== selectedIndustrialAreaFilter) return false;
      if (selectedDeploymentStage && !matchesDeploymentStage(summary.node) && !summary.points.length) return false;
      return operationMatchesSearch(summary);
    }

    function industrialAreaFilterButtonsHtml() {
      const allActive = !selectedIndustrialAreaFilter;
      return '<button class="industrial-area-filter-button all-industrial-areas' + (allActive ? ' active' : '') + '" type="button" data-industrial-area-filter="" aria-pressed="' + String(allActive) + '" title="Mostrar todas as áreas">' +
        '<i aria-hidden="true"></i><span>Todas</span></button>' +
        INDUSTRIAL_AREAS.map((area) => {
          const active = selectedIndustrialAreaFilter === area.id;
          return '<button class="industrial-area-filter-button' + (active ? ' active' : '') + '" type="button" data-industrial-area-filter="' + escapeHtml(area.id) + '" aria-pressed="' + String(active) + '" title="Filtrar por ' + escapeHtml(area.name) + '" style="--area-color:' + area.color + '">' +
            '<i aria-hidden="true"></i><span>' + escapeHtml(area.shortName) + '</span></button>';
        }).join("");
    }

    function operationProcessList(operationNameOrNode) {
      const node = typeof operationNameOrNode === "string" ? processNodeByName(operationNameOrNode) : operationNameOrNode;
      return processListFromValue(node?.operationProcesses || []);
    }

    function areProcessesLinked(from, to) {
      return (state.processLinks || []).some((link) =>
        (link.from === from && link.to === to) || (link.from === to && link.to === from)
      );
    }

    function linkedProcessNames(processName) {
      return (state.processLinks || [])
        .filter((link) => link.from === processName || link.to === processName)
        .map((link) => link.from === processName ? link.to : link.from)
        .sort();
    }

    function linkProcesses(from, to) {
      if (!from || !to || from === to) return;
      if (areProcessesLinked(from, to)) {
        alert("Estas operações já estão vinculadas.");
        return;
      }
      if (!confirm("Vincular a operação " + processDisplayId(from) + " para " + processDisplayId(to) + "? Isso cria uma linha entre elas. Os equipamentos serão preservados.")) return;
      const previousProcessLinks = [...(state.processLinks || [])];
      const previousAuditLogs = [...(state.auditLogs || [])];
      state.processLinks = [...(state.processLinks || []), {
        uid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        from,
        to
      }];
      recordAudit("operation", from, "operation link", "", to, "update");
      if (!saveState()) {
        state.processLinks = previousProcessLinks;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar o vínculo entre as operações.");
        return false;
      }
      render();
      return true;
    }

    function unlinkProcesses(from, to) {
      if (!confirm("Remover o vínculo entre as operações " + processDisplayId(from) + " and " + processDisplayId(to) + "? Os equipamentos continuarão vinculados às operações.")) return;
      const previousProcessLinks = [...(state.processLinks || [])];
      const previousAuditLogs = [...(state.auditLogs || [])];
      state.processLinks = (state.processLinks || []).filter((link) =>
        !((link.from === from && link.to === to) || (link.from === to && link.to === from))
      );
      recordAudit("operation", from, "operation link", to, "", "update");
      if (!saveState()) {
        state.processLinks = previousProcessLinks;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível remover o vínculo entre as operações.");
        return false;
      }
      render();
      return true;
    }

    function nextProcessId(reservedIds = new Set()) {
      const used = new Set([
        ...(state.processNodes || []).map((node) => String(node.processId || "")),
        ...reservedIds
      ]);
      let number = 1;
      while (used.has("OP-" + String(number).padStart(2, "0"))) number += 1;
      return "OP-" + String(number).padStart(2, "0");
    }

    function upsertProcessNode(name, x = 50, y = 50, workstream = "", area = "") {
      const cleanName = processListFromValue(name)[0] || "";
      if (!cleanName) return null;
      state.processNodes = Array.isArray(state.processNodes) ? state.processNodes : [];
      let node = processNodeByName(cleanName);
      const cleanWorkstream = normalizeWorkstream(workstream);
      const cleanArea = sanitizeText(area, TEXT_LIMITS.short);
      if (!node) {
        const operationX = Number(x);
        const operationY = Number(y);
        node = {
          uid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          name: cleanName,
          deploymentStage: "TO DO",
          processId: nextProcessId(),
          color: operationColor(cleanName),
          area: cleanArea,
          workstream: cleanWorkstream,
          operationProcesses: [],
          permanentPinned: false,
          pinned: operationsLocked,
          x: Math.max(0, Math.min(100, Number.isFinite(operationX) ? operationX : 50)),
          y: Math.max(0, Math.min(100, Number.isFinite(operationY) ? operationY : 50))
        };
        state.processNodes.push(node);
      } else {
        if (cleanWorkstream) node.workstream = cleanWorkstream;
        if (cleanArea) node.area = cleanArea;
      }
      const canonicalName = node.name;
      state.processes = [...new Set([
        ...(state.processes || []).filter((item) => String(item).toLowerCase() !== canonicalName.toLowerCase()),
        canonicalName
      ])].sort();
      return node;
    }

    function devicePositionForProcess(processName) {
      const node = processNodeByName(processName);
      const count = state.points.filter((point) => pointProcesses(point).includes(processName)).length;
      const baseX = node?.x ?? 50;
      const baseY = node?.y ?? 50;
      return {
        x: Math.max(0, Math.min(100, baseX + 3 + (count % 3) * 2)),
        y: Math.max(0, Math.min(100, baseY + 3 + Math.floor(count / 3) * 2))
      };
    }

    function nextOperationPosition() {
      const index = (state.processNodes || []).length;
      const columns = 5;
      const row = Math.floor(index / columns) % 5;
      const column = index % columns;
      return {
        x: 14 + column * 18,
        y: 18 + row * 16
      };
    }

    function createPoint(x, y, details = {}) {
      if (state.points.length >= MAX_IMPORT_POINTS) {
        alert("Limite de " + MAX_IMPORT_POINTS + " equipamentos por planta atingido. Nenhum registro foi alterado.");
        return null;
      }
      const linkedProcesses = processListFromValue(details.processes || details.process);
      if (linkedProcesses.some((name) => !processNodeByName(name))) {
        alert("Selecione apenas operações existentes ou deixe o vínculo em branco.");
        return null;
      }
      const previousProcesses = [...(state.processes || [])];
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousSelectedId = selectedId;
      const previousSelectedCableId = selectedCableId;
      const previousActiveTab = activeTab;
      const count = state.points.length + 1;
      const normalizedMac = normalizeMac(details.mac);
      const normalizedVlan = normalizeVlan(details.vlan);
      const point = {
        uid: createUid(),
        markerId: sanitizeText(details.markerId || "PR-" + String(count).padStart(2, "0"), TEXT_LIMITS.short),
        name: sanitizeText(details.name || "", TEXT_LIMITS.medium),
        deploymentStage: normalizeDeploymentStage(details.deploymentStage, "TO DO"),
        info: sanitizeText(details.info || "", TEXT_LIMITS.long),
        x,
        y,
        country: normalizeCountry(details.country),
        plant: sanitizeText(details.plant || "", TEXT_LIMITS.short),
        area: sanitizeText(details.area || "", TEXT_LIMITS.short),
        productionLine: sanitizeText(details.productionLine || details.line || "", TEXT_LIMITS.short),
        station: sanitizeText(details.station || "", TEXT_LIMITS.short),
        process: sanitizeText(details.process || "", TEXT_LIMITS.medium),
        processes: linkedProcesses,
        type: details.type || "Other",
        criticality: details.criticality || "Medium",
        status: normalizeEquipmentStatus(details.status),
        validationStatus: normalizeValidationStatus(details.validationStatus || "Pending Validation"),
        validationChecklist: normalizeValidationChecklist(details.validationChecklist),
        lastValidationDate: sanitizeText(details.lastValidationDate || "", TEXT_LIMITS.short),
        validatedBy: sanitizeText(details.validatedBy || "", TEXT_LIMITS.short),
        ip: sanitizeText(details.ip || "", TEXT_LIMITS.short),
        model: sanitizeText(details.model || "", TEXT_LIMITS.short),
        serial: sanitizeText(details.serial || "", TEXT_LIMITS.short),
        mac: normalizedMac === null ? sanitizeText(details.mac || "", TEXT_LIMITS.short) : normalizedMac,
        vlan: normalizedVlan === null ? sanitizeText(details.vlan || "", TEXT_LIMITS.short) : normalizedVlan,
        hostname: sanitizeText(details.hostname || "", TEXT_LIMITS.short),
        vendor: sanitizeText(details.vendor || "", TEXT_LIMITS.short),
        owner: sanitizeText(details.owner || "", TEXT_LIMITS.short),
        ticket: sanitizeText(details.ticket || "", TEXT_LIMITS.short),
        rack: sanitizeText(details.rack || "", TEXT_LIMITS.short),
        port: sanitizeText(details.port || "", TEXT_LIMITS.short),
        color: details.color || EQUIPMENT_PRESETS[details.type]?.color || "#64748b",
        shape: details.shape || EQUIPMENT_PRESETS[details.type]?.shape || "pin",
        labelMode: details.labelMode || "id",
        size: "tiny",
        iconSize: 18,
        locked: !!details.locked,
        photos: []
      };
      state.processes = [...new Set([...(state.processes || []), ...point.processes])].sort();
      state.points.push(point);
      recordAudit("equipment", point.uid, "equipment", "", point.markerId, "create");
      selectedId = point.uid;
      selectedCableId = null;
      activeTab = point.processes.length ? "processes" : "points";
      if (!saveState()) {
        state.points = state.points.filter((item) => item.uid !== point.uid);
        state.processes = previousProcesses;
        state.auditLogs = previousAuditLogs;
        selectedId = previousSelectedId;
        selectedCableId = previousSelectedCableId;
        activeTab = previousActiveTab;
        alert("Não foi possível salvar o device. Confira a conexão com o servidor e tente novamente.");
        return null;
      }
      const clearedFilters = !!(operationSearchTerm || selectedProcessFilter || selectedIndustrialAreaFilter || selectedDeploymentStage || selectedDeviceType || listSearch);
      operationSearchTerm = ""; selectedProcessFilter = ""; selectedIndustrialAreaFilter = ""; selectedDeploymentStage = ""; selectedDeviceType = ""; listSearch = "";
      equipmentSearchResultsOpen = false;
      operationSearch.value = "";
      ["deploymentFilter", "deviceTypeFilter"].forEach(id => { const input = document.getElementById(id); if (input) input.value = ""; });
      equipmentPlacementSelection = null;
      contextPanelOpen = false;
      showEquipmentLayer = true;
      showOperationLayer = false;
      equipmentEditMode = true;
      setInspectorCollapsed(false);
      mapCreateMode = "browse";
      document.getElementById("focusEquipmentDrawer").hidden = true;
      document.getElementById("openEquipmentList").setAttribute("aria-expanded", "false");
      render();
      if (clearedFilters) {
        const notice = document.getElementById("equipmentFormStatus");
        if (notice) { notice.textContent = "Equipamento criado. Os filtros foram limpos para mostrar a nova posição no mapa."; notice.classList?.remove("hidden"); }
      }
      return point;
    }

    function selectedPoint() {
      return state.points.find((point) => point.uid === selectedId) || null;
    }

    function selectedCable() {
      return state.cables.find((cable) => cable.uid === selectedCableId) || null;
    }

    function render() {
      renderContextNavigation();
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      renderCountrySwitch();
      renderMetrics();
      renderOperationSidebar();
      renderEditor();
      renderMap();
      renderCableEditor();
      renderDashboard();
      renderQaReport();
      renderAuditLog();
      renderTabs();
      renderList();
      renderCableList();
      renderProcessList();
    }

    function panelIsVisible(element) {
      for (let node = element; node; node = node.parentElement) {
        if (node.hidden || node.classList.contains("hidden") || node.style.display === "none") return false;
        if (node.tagName === "DETAILS" && !node.open) return false;
      }
      return true;
    }

    function renderLegend() {
      // A legenda foi removida da interface; a cor segue visível nos marcadores do mapa.
    }

    function renderOperationSidebar() {
      if (document.activeElement !== operationSearch) operationSearch.value = operationSearchTerm;
      industrialAreaFilters.innerHTML = industrialAreaFilterButtonsHtml();
      const operationFilter = document.getElementById("operationFilter");
      const choices = [new Option("Todas as operações", ""), ...state.processNodes.map(node => new Option(node.name, node.name))];
      operationFilter.replaceChildren(...choices);
      operationFilter.value = selectedProcessFilter;
      document.getElementById("operationContextFilter").hidden = !selectedProcessFilter;
      const contextName = document.getElementById("operationContextFilterName");
      contextName.textContent = selectedProcessFilter ? "Operação: " + selectedProcessFilter : "";
      contextName.title = selectedProcessFilter;
      const filterCount = [selectedProcessFilter, selectedIndustrialAreaFilter, selectedDeploymentStage, selectedDeviceType].filter(Boolean).length;
      const filterSummary = document.querySelector(".advanced-filters > summary");
      filterSummary.replaceChildren(document.createTextNode(filterCount ? "Filtros · " + filterCount + " ⌄" : "Filtros ⌄"));
      const optionsSummary = document.querySelector(".focus-options > summary");
      optionsSummary.textContent = "Mais";
      let results = document.getElementById("equipmentSearchResults");
      if (!results) {
        results = document.createElement("section");
        results.id = "equipmentSearchResults";
        results.setAttribute("aria-label", "Equipamentos encontrados");
        operationSearch.closest(".overview-search-field").append(results);
      }
      results.replaceChildren();
      results.hidden = !operationSearchTerm.trim() || !equipmentSearchResultsOpen;
      if (results.hidden) return;
      const operationMatches = operationSummariesWithEquipment();
      const visibleOperations = new Set(operationMatches.map(summary => summary.name));
      const points = state.points.filter(point => matchesDeploymentStage(point) && matchesDeviceType(point) &&
        (!selectedIndustrialAreaFilter || pointProcesses(point).some(name => visibleOperations.has(name))) &&
        (!selectedProcessFilter || pointProcesses(point).includes(selectedProcessFilter)) && pointMatchesGlobalSearch(point));
      const summary = document.createElement("p");
      summary.className = "equipment-search-summary";
      summary.setAttribute("role", "status");
      summary.textContent = points.length + " equipamento(s) encontrado(s) nesta planta.";
      results.appendChild(summary);
      points.slice(0, 25).forEach(point => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "equipment-search-result";
        const title = document.createElement("strong");
        title.textContent = point.markerId || "Sem ID";
        const details = document.createElement("small");
        details.textContent = [point.name, point.ip, processText(point)].filter(Boolean).join(" · ");
        button.append(title, details);
        button.addEventListener("click", () => {
          if (!confirmDiscardPendingChanges()) return;
          if (selectPoint(point.uid)) {
            results.hidden = true;
            if (panelIsVisible(editor)) equipmentName.focus({ preventScroll: true });
          }
        });
        results.appendChild(button);
      });
      if (points.length > 25) {
        const more = document.createElement("p");
        more.textContent = "Exibindo os primeiros 25 equipamentos. Refine a busca para localizar outros.";
        results.appendChild(more);
      }
    }

    function applyEquipmentPreset(category, colorInput = markerColor, shapeInput = markerShape) {
      const preset = EQUIPMENT_PRESETS[category] || EQUIPMENT_PRESETS.Other;
      colorInput.value = preset.color;
      shapeInput.value = preset.shape;
    }

    function updateCategoryHint() {
      categoryHint.textContent = CATEGORY_HINTS[equipmentType.value] || CATEGORY_HINTS.Other;
    }

    function renderCountrySwitch() {
      countrySwitch.replaceChildren();
      const orderedMaps = MAP_ORDER.map((mapId) => DEFAULT_MAPS[mapId]).filter(Boolean);
      orderedMaps.forEach((map) => {
        const option = document.createElement("option");
        option.value = map.id;
        option.textContent = (map.flag || "◇") + " " + (map.label || map.name || map.id);
        countrySwitch.appendChild(option);
      });
      countrySwitch.value = state.activeMapId;
      const active = DEFAULT_MAPS[state.activeMapId];
      mapStage.removeAttribute("aria-labelledby");
      mapStage.setAttribute("aria-label", "Mapa de " + (active.label || active.name));
      panelTitle.textContent = (active.flag || "◇") + " Operações · " + (active.label || active.name || active.id);
    }

    function renderMetrics() {
      kpiPoints.textContent = state.points.length;
      kpiCables.textContent = state.cables.length;
      const visibleOperationNames = new Set(operationSummariesWithEquipment().map(summary => summary.name));
      mapOperationCount.textContent = (state.processNodes || []).filter(node => visibleOperationNames.has(node.name)).length;
      mapPointCount.textContent = filteredPoints().length;
      mapOperationCount.parentElement.hidden = !showOperationLayer;
      mapPointCount.parentElement.hidden = !showEquipmentLayer;
      mapCableCount.textContent = filteredCables().length;
      if (panelIsVisible(kpiIssues)) kpiIssues.textContent = buildDataQualityIssues().length;
    }

    function allInventoryPoints() {
      return Object.entries(state.maps || {}).flatMap(([mapId, map]) =>
        (map.points || []).map((point) => ({
          ...point,
          status: normalizeEquipmentStatus(point.status),
          mapId,
          country: point.country || countryNameForMap(mapId)
        }))
      );
    }

    function allInventoryCables() {
      return Object.entries(state.maps || {}).flatMap(([mapId, map]) =>
        (map.cables || []).map((cable) => ({ ...cable, mapId }))
      );
    }

    function countBy(items, getter) {
      return items.reduce((memo, item) => {
        const key = getter(item) || "Unspecified";
        memo[key] = (memo[key] || 0) + 1;
        return memo;
      }, Object.create(null));
    }

    function countsText(counts) {
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([name, count]) => uiLabel(name) + ": " + count)
        .join(" / ") || "Sem dados";
    }

    function renderOverviewOverview() {
      document.getElementById("overviewMapContext").textContent = (DEFAULT_MAPS[state.activeMapId]?.label || "Planta") + " · " + (selectedProcessFilter ? "Operação: " + selectedProcessFilter : showEquipmentLayer ? "Equipamentos · Clique para consultar ou pesquise" : "Operações · Cada pino representa uma operação");
      if (!panelIsVisible(document.getElementById("overviewTotal"))) return;
      const inventory = allInventoryPoints();
      const pending = inventory.filter((point) => point.validationStatus === "Pending Validation" || point.status === "Pending Validation").length;
      document.getElementById("overviewTotal").textContent = inventory.length;
      document.getElementById("overviewOperations").textContent = state.processNodes.length;
      document.getElementById("overviewPending").textContent = pending;
      document.getElementById("overviewPending").classList.toggle("overview-positive", pending === 0);
      document.getElementById("overviewPlants").textContent = Object.keys(DEFAULT_MAPS).length;
      document.getElementById("overviewPlantLabel").textContent = DEFAULT_MAPS[state.activeMapId]?.label || "Planta selecionada";
    }

    function renderDashboard() {
      renderOverviewOverview();
      if (!panelIsVisible(inventoryDashboard)) return;
      const allPoints = allInventoryPoints();
      const allCables = allInventoryCables();
      const currentIssues = buildDataQualityIssues();
      const pending = allPoints.filter((point) => point.validationStatus === "Pending Validation" || point.status === "Pending Validation").length;
      inventoryDashboard.innerHTML =
        '<h3>Resumo do inventário</h3>' +
        '<div class="dashboard-grid">' +
          '<div class="dashboard-item"><strong data-kpi="total"></strong><span>Total de equipamentos</span></div>' +
          '<div class="dashboard-item"><strong data-kpi="cables"></strong><span>Total de cabos</span></div>' +
          '<div class="dashboard-item"><strong data-kpi="pending"></strong><span>Validação pendente</span></div>' +
          '<div class="dashboard-item"><strong data-kpi="issues"></strong><span>Pendências da planta ou filtro atual</span></div>' +
        '</div>' +
        '<div class="dashboard-list" data-role="countries"></div>' +
        '<div class="dashboard-list" data-role="types"></div>' +
        '<div class="dashboard-list" data-role="statuses"></div>' +
        '<div class="dashboard-list" data-role="updated"></div>';
      inventoryDashboard.querySelector('[data-kpi="total"]').textContent = allPoints.length;
      inventoryDashboard.querySelector('[data-kpi="cables"]').textContent = allCables.length;
      inventoryDashboard.querySelector('[data-kpi="pending"]').textContent = pending;
      inventoryDashboard.querySelector('[data-kpi="issues"]').textContent = currentIssues.length;
      inventoryDashboard.querySelector('[data-role="countries"]').textContent = "Países: " + countsText(countBy(allPoints, (point) => normalizeCountry(point.country, point.mapId)));
      inventoryDashboard.querySelector('[data-role="types"]').textContent = "Tipos: " + countsText(countBy(allPoints, (point) => point.type || "Equipment"));
      inventoryDashboard.querySelector('[data-role="statuses"]').textContent = "Estados: " + countsText(countBy(allPoints, (point) => normalizeEquipmentStatus(point.status)));
      inventoryDashboard.querySelector('[data-role="updated"]').textContent = "Última atualização: " + (state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : "Ainda não salvo") + " / As pendências consideram os filtros da planta atual.";
    }

    function buildDataQualityIssues(points = filteredPoints(), cables = filteredCables()) {
      const issues = [];
      const visibleIds = new Set(points.map((point) => point.uid));
      const cableLinks = new Set();
      cables.forEach((cable) => {
        if (cable.from) cableLinks.add(cable.from);
        if (cable.to) cableLinks.add(cable.to);
      });
      function add(severity, entity, id, title, detail) {
        issues.push({ severity, entity, id, title, detail });
      }
      points.forEach((point) => {
        const name = pointName(point);
        if (!point.ip) add("warning", "equipment", point.uid, "Equipamento sem IP", name);
        if (!point.mac) add("warning", "equipment", point.uid, "Equipamento sem MAC", name);
        if (!point.hostname) add("warning", "equipment", point.uid, "Equipamento sem nome na rede", name);
        if (!point.serial) add("warning", "equipment", point.uid, "Equipamento sem número de série", name);
        if (!point.country || !point.plant || !point.area) add("warning", "equipment", point.uid, "Equipamento sem localização completa", name);
        if (!point.photos?.length) add("info", "equipment", point.uid, "Equipamento sem foto", name);
        if (isActiveEquipment(point) && !cableLinks.has(point.uid)) add("warning", "equipment", point.uid, "Equipamento ativo sem conexão", name);
        const checklist = normalizeValidationChecklist(point.validationChecklist);
        const checklistComplete = VALIDATION_CHECKLIST_KEYS.every((key) => !!checklist[key]);
        if (point.validationStatus === "Pending Validation" || !checklistComplete) add("warning", "equipment", point.uid, "Equipamento com validação pendente", name);
      });
      [
        ["markerId", "Códigos", (value) => String(value || "").trim().toLowerCase()],
        ["ip", "IPs", (value) => String(value || "").trim()],
        ["mac", "MACs", (value) => String(value || "").trim().toUpperCase()],
        ["hostname", "Nomes na rede", (value) => String(value || "").trim().toLowerCase()],
        ["serial", "Números de série", (value) => String(value || "").trim().toLowerCase()]
      ].forEach(([field, label, normalizer]) => {
        const groups = points.reduce((memo, point) => {
          const key = normalizer(point[field]);
          if (!key) return memo;
          memo[key] = memo[key] || [];
          memo[key].push(point);
          return memo;
        }, Object.create(null));
        Object.values(groups).filter((group) => group.length > 1).forEach((group) => {
          group.forEach((point) => add("error", "equipment", point.uid, "Duplicado: " + label, group.map(pointName).join(" / ")));
        });
      });
      cables.forEach((cable) => {
        if (!cable.from) add("error", "cable", cable.uid, "Cabo sem origem", cable.cableId || cable.uid);
        if (!cable.to) add("error", "cable", cable.uid, "Cabo sem destino", cable.cableId || cable.uid);
        if (cable.from && !pointById(cable.from)) add("error", "cable", cable.uid, "A origem do cabo não existe", cable.cableId || cable.uid);
        if (cable.to && !pointById(cable.to)) add("error", "cable", cable.uid, "O destino do cabo não existe", cable.cableId || cable.uid);
        if (cable.from && cable.to && (!visibleIds.has(cable.from) && !visibleIds.has(cable.to))) add("info", "cable", cable.uid, "Cabo fora do filtro atual de equipamentos", cable.cableId || cable.uid);
      });
      return issues;
    }

    function renderQaReport() {
      if (!panelIsVisible(qaReport)) return;
      const issues = buildDataQualityIssues();
      qaReport.innerHTML = "";
      const title = document.createElement("h3");
      title.textContent = "Data Quality";
      qaReport.appendChild(title);
      const intro = document.createElement("p");
      intro.textContent = issues.length ? issues.length + " pendências na planta ou filtro atual." : "Nenhuma pendência na planta ou filtro atual.";
      qaReport.appendChild(intro);
      const list = document.createElement("div");
      list.className = "qa-list";
      issues.forEach((issue) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "qa-item " + issue.severity;
        item.innerHTML = "<strong></strong><span></span>";
        item.querySelector("strong").textContent = issue.title;
        item.querySelector("span").textContent = issue.detail;
        item.addEventListener("click", () => {
          if (issue.entity === "equipment") selectPoint(issue.id);
          if (issue.entity === "cable") selectCable(issue.id);
        });
        list.appendChild(item);
      });
      qaReport.appendChild(list);
    }

    function renderAuditLog() {
      if (!panelIsVisible(auditLogPanel)) return;
      auditLogPanel.innerHTML = "";
      const title = document.createElement("h3");
      title.textContent = "Histórico de alterações";
      auditLogPanel.appendChild(title);
      const identity = document.createElement("label");
      identity.className = "audit-identity";
      identity.innerHTML = '<span>Usuário responsável</span><input type="text" maxlength="80" aria-label="Usuário responsável pelas alterações">';
      const identityInput = identity.querySelector("input");
      identityInput.value = currentAuditUser();
      identityInput.readOnly = true;
      auditLogPanel.appendChild(identity);
      const logs = [...(state.auditLogs || [])]
        .filter((log) => log.action !== "export")
        .reverse()
        .slice(0, 80);
      const intro = document.createElement("p");
      intro.textContent = logs.length ? "Registro de quem alterou, quando e onde." : "Nenhuma alteração registrada.";
      auditLogPanel.appendChild(intro);
      const machineNote = document.createElement("p");
      machineNote.className = "audit-machine-note";
      machineNote.textContent = "Cada salvamento é registrado no servidor com a conta autenticada e a versão dos dados.";
      auditLogPanel.appendChild(machineNote);
      const list = document.createElement("div");
      list.className = "qa-list";
      logs.forEach((log) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "qa-item info";
        item.innerHTML = "<strong></strong><span></span>";
        item.querySelector("strong").textContent = (log.user || "Usuário local") + " · " + (log.entity || "item");
        item.querySelector("span").textContent =
          "Quando: " + new Date(log.timestamp).toLocaleString("pt-BR") +
          " · Onde: " + (DEFAULT_MAPS[log.mapId]?.name || log.mapId || DEFAULT_MAPS[state.activeMapId]?.name || state.activeMapId || "mapa") +
          " / " + (log.entityId || "mapa");
        item.addEventListener("click", () => {
          if (log.entity === "equipment" && pointById(log.entityId)) selectPoint(log.entityId);
          if (log.entity === "cable" && cableById(log.entityId)) selectCable(log.entityId);
          if (log.entity === "operation" && processNodeByName(log.entityId)) selectProcess(log.entityId);
        });
        list.appendChild(item);
      });
      auditLogPanel.appendChild(list);
    }

    function renderLayerButtons() {
      const operationLayerButton = document.getElementById("toggleOperationLayer");
      operationLayerButton.classList.toggle("active", showOperationLayer);
      operationLayerButton.setAttribute("aria-pressed", String(showOperationLayer));
      toggleEquipmentLayer.classList.toggle("active", showEquipmentLayer);
      toggleCableLayer.classList.toggle("active", showCableLayer);
      toggleLabelLayer.classList.toggle("active", showLabelLayer);
      toggleEquipmentLayer.setAttribute("aria-pressed", String(showEquipmentLayer));
      toggleLabelLayer.setAttribute("aria-pressed", String(showLabelLayer));
    }

    function renderMapToolButtons() {
      const createButton = document.getElementById("createEquipmentPrimary");
      createButton.textContent = mapCreateMode === "device" ? "Cancelar criação" : "Novo equipamento";
      createButton.setAttribute("aria-pressed", String(mapCreateMode === "device"));
      mapStage.classList.toggle("placing-equipment", mapCreateMode === "device");
      const hint = document.getElementById("mapActionHint");
      hint.hidden = mapCreateMode !== "device";
      hint.textContent = mapCreateMode === "device" ? mapCreateHint() : "";
      document.getElementById("releaseMapMovement").hidden = !mapLocked && !operationsLocked &&
        !state.processNodes.some((node) => node.pinned && !node.permanentPinned);
      addPointHint.classList.toggle("active", !cableMode && mapCreateMode === "process");
      addDeviceHint.classList.toggle("active", !cableMode && mapCreateMode === "device");
      addCableMode.classList.toggle("active", cableMode);
      anchorOperations.classList.toggle("active", operationsLocked);
      anchorOperations.textContent = operationsLocked ? "Operações ancoradas" : "Ancorar operações";
      anchorOperations.setAttribute("aria-pressed", String(operationsLocked));
      anchorMap.classList.toggle("active", mapLocked);
      anchorMap.textContent = mapLocked ? "Mapa ancorado" : "Ancorar mapa";
      anchorMap.setAttribute("aria-pressed", String(mapLocked));
      addPointHint.setAttribute("aria-pressed", String(!cableMode && mapCreateMode === "process"));
      addDeviceHint.setAttribute("aria-pressed", String(!cableMode && mapCreateMode === "device"));
      toggleEquipmentLayer.setAttribute("aria-pressed", String(showEquipmentLayer));
      toggleLabelLayer.setAttribute("aria-pressed", String(showLabelLayer));
    }

    function mapCreateHint() {
      if (!state.mapImage) return "Carregue o mapa da planta primeiro.";
      if (mapCreateMode === "browse") return "Clique em um equipamento para consultar ou editar. Use a busca para localizar pelo código, nome, IP ou série.";
      if (mapCreateMode === "device") return "Clique no mapa para posicionar o novo equipamento. A operação é opcional.";
      if (!selectedProcessFilter) return "Clique dentro da planta para criar uma operação.";
      const selectedNode = processNodeByName(selectedProcessFilter);
      return selectedNode?.pinned
        ? "Operação selecionada: " + selectedProcessFilter + ". A posição está ancorada."
        : "Operação selecionada: " + selectedProcessFilter + ". Arraste o marcador para reposicionar.";
    }

    function setMapCreateMode(mode) {
      if (!confirmDiscardPendingChanges()) return;
      if (mode === "device" && mapCreateMode !== "device") {
        equipmentPlacementSelection = { navigation: navigationSection, panelOpen: contextPanelOpen, equipmentLayer: showEquipmentLayer, operationLayer: showOperationLayer, point: selectedId, cable: selectedCableId, tab: activeTab, drawerOpen: !document.getElementById("focusEquipmentDrawer").hidden };
      } else if (mode !== "device") equipmentPlacementSelection = null;
      closeContextMenus();
      contextPanelOpen = false;
      renderContextNavigation();
      document.getElementById("focusEquipmentDrawer").hidden = true;
      document.getElementById("openEquipmentList").setAttribute("aria-expanded", "false");
      mapCreateMode = mode === "device" ? "device" : "process";
      setInspectorCollapsed(mapCreateMode === "device");
      showOperationLayer = mapCreateMode === "process";
      showEquipmentLayer = mapCreateMode === "device";
      cableMode = false;
      cableStartId = null;
      selectedId = null;
      selectedCableId = null;
      activeTab = mapCreateMode === "device"
        ? (selectedProcessFilter ? "points" : "processes")
        : "processes";
      selectionHint.textContent = mapCreateHint();
      render();
    }

    function cancelEquipmentPlacement() {
      if (!confirmDiscardPendingChanges()) return false;
      mapCreateMode = "browse";
      if (equipmentPlacementSelection) {
        navigationSection = equipmentPlacementSelection.navigation || navigationSection;
        contextPanelOpen = equipmentPlacementSelection.panelOpen ?? contextPanelOpen;
        showEquipmentLayer = equipmentPlacementSelection.equipmentLayer ?? showEquipmentLayer;
        showOperationLayer = equipmentPlacementSelection.operationLayer ?? showOperationLayer;
        selectedId = equipmentPlacementSelection.point;
        selectedCableId = equipmentPlacementSelection.cable;
        activeTab = equipmentPlacementSelection.tab;
        document.getElementById("focusEquipmentDrawer").hidden = !equipmentPlacementSelection.drawerOpen;
        document.getElementById("openEquipmentList").setAttribute("aria-expanded", String(equipmentPlacementSelection.drawerOpen));
      }
      equipmentPlacementSelection = null;
      equipmentEditMode = false;
      equipmentFormDirty = false;
      setInspectorCollapsed(true);
      render();
      document.getElementById("createEquipmentPrimary").focus({ preventScroll: true });
      return true;
    }

    function openEquipmentGroup(group) {
      const dialog = document.getElementById("equipmentGroupDialog");
      const list = document.getElementById("equipmentGroupList");
      document.getElementById("equipmentGroupTitle").textContent = group.points.length + " equipamentos neste ponto";
      list.replaceChildren();
      group.points.forEach(point => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "equipment-group-item";
        const code = document.createElement("strong"); code.textContent = point.markerId || "Sem ID";
        const detail = document.createElement("span"); detail.textContent = [point.name, uiLabel(point.type), processText(point)].filter(Boolean).join(" · ");
        button.append(code, detail);
        button.addEventListener("click", () => { if (selectPoint(point.uid)) dialog.close(); });
        list.append(button);
      });
      if (!dialog.open) dialog.showModal();
    }

    function renderEquipmentMarkers() {
      const existing = new Map([...mapHolder.querySelectorAll(".equipment-map-marker")].map(marker => [marker.dataset.groupKey, marker]));
      const groups = state.mapImage && showEquipmentLayer ? groupEquipmentMarkers(filteredPoints(), {
        width: mapHolder.offsetWidth, height: mapHolder.offsetHeight, cellSize: showLabelLayer ? 66 : 46, selectedId
      }) : [];
      groups.forEach(group => {
        let marker = existing.get(group.key);
        if (!marker) {
          marker = document.createElement("button"); marker.type = "button";
          marker.addEventListener("pointerdown", event => event.stopPropagation());
          marker.addEventListener("click", event => {
            event.stopPropagation();
            const current = marker.equipmentGroup;
            if (current.points.length > 1) openEquipmentGroup(current);
            else selectPoint(current.points[0].uid);
          });
          mapHolder.append(marker);
        }
        existing.delete(group.key);
        marker.equipmentGroup = group;
        marker.dataset.markerLabel = group.points[0].markerId || "Equipamento";
        marker.dataset.groupKey = group.key;
        marker.className = "equipment-map-marker" + (group.points.length > 1 ? " equipment-map-group" : "") +
          (group.points.some(point => point.uid === selectedId) ? " active" : "") + (!showLabelLayer ? " label-hidden" : "");
        marker.style.setProperty("--x", group.x); marker.style.setProperty("--y", group.y);
        const point = group.points[0];
        marker.style.setProperty("--equipment-color", point.color || "#4f21ff");
        marker.textContent = group.points.length > 1 ? String(group.points.length) : (showLabelLayer ? point.markerId || "Equip." : "●");
        marker.title = group.points.length > 1 ? group.points.length + " equipamentos · Clique para escolher" : pointName(point);
        marker.setAttribute("aria-label", group.points.length > 1 ? "Abrir grupo com " + group.points.length + " equipamentos" : "Abrir equipamento " + pointName(point));
      });
      existing.forEach(marker => marker.remove());
    }

    function closeEquipmentEditor() {
      if (!confirmDiscardPendingChanges()) return false;
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      selectedId = null;
      selectedCableId = null;
      equipmentFormDirty = false;
      equipmentEditMode = false;
      cableFormDirty = false;
      activeTab = "points";
      mapCreateMode = "browse";
      if (globalThis.location?.hash && globalThis.history?.replaceState) {
        const params = new URLSearchParams(location.hash.slice(1));
        params.delete("equipment"); params.delete("cable");
        const remaining = params.toString();
        history.replaceState(null, "", location.pathname + location.search + (remaining ? "#" + remaining : ""));
      }
      setInspectorCollapsed(true);
      render();
      mapStage.focus({ preventScroll: true });
      return true;
    }

    function renderMap() {
      mapHolder.querySelectorAll(".process-marker").forEach((node) => node.remove());
      cableLayer.innerHTML = "";

      if (!state.mapImage) {
        mapHolder.classList.add("empty");
        mapHolder.style.removeProperty("width");
        mapHolder.style.removeProperty("height");
        emptyMap.classList.remove("hidden");
        mapImage.classList.add("hidden");
        cableLayer.classList.add("hidden");
        mapImage.removeAttribute("src");
        mapHolder.querySelectorAll(".equipment-map-marker").forEach(marker => marker.remove());
        return;
      }

      mapHolder.classList.remove("empty");
      emptyMap.classList.add("hidden");
      mapImage.classList.remove("hidden");
      cableLayer.classList.remove("hidden");
      const mapSourceChanged = mapImage.getAttribute("src") !== state.mapImage;
      if (mapSourceChanged) {
        mapImage.decoding = "async";
        mapImage.fetchPriority = "high";
        mapImage.src = state.mapImage;
      } else {
        applyMapZoom();
      }

      const visibleOperationNames = new Set(operationSummariesWithEquipment().map((summary) => summary.name));
      const visibleProcessNodes = [...(state.processNodes || [])]
        .filter((processNode) => visibleOperationNames.has(processNode.name))
        .sort((a, b) => String(a.processId || a.name).localeCompare(String(b.processId || b.name)));
      if (showOperationLayer) visibleProcessNodes.forEach((processNode) => {
        const processPoints = state.points.filter((point) => pointProcesses(point).includes(processNode.name) && matchesDeploymentStage(point) && matchesDeviceType(point));
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = "process-marker" +
          (processNode.name === selectedProcessFilter ? " active" : "") +
          (processNode.pinned ? " pinned" : "") +
          (processNode.permanentPinned ? " permanent-pinned" : "");
        marker.style.setProperty("--x", processNode.x);
        marker.style.setProperty("--y", processNode.y);
        marker.style.setProperty("--operation-color", operationColor(processNode));
        marker.dataset.processName = processNode.name;
        marker.dataset.deploymentStage = normalizeDeploymentStage(processNode.deploymentStage);
        marker.innerHTML = "<span></span><em></em><small></small>";
        marker.querySelector("span").textContent = processDisplayId(processNode);
        marker.querySelector("em").textContent = processNode.name;
        marker.title = processDisplayId(processNode) + " - " + processNode.name + " · " + normalizeDeploymentStage(processNode.deploymentStage) +
          (processNode.area ? " - Área: " + processNode.area : "") +
          (processNode.permanentPinned ? " - posição fixada permanentemente" : processNode.pinned ? " - posição ancorada" : " - arraste para mover");
        marker.querySelector("small").textContent = String(processPoints.length);
        marker.setAttribute("aria-label", processDisplayId(processNode) + " — " + processNode.name + ", " + processPoints.length + " equipamentos");
        if (processPoints.length) {
          marker.title += " - Equipamentos vinculados: " + processPoints.map((point) => pointName(point)).join(", ");
        }
        if (!processNode.pinned && !processNode.permanentPinned) {
          marker.addEventListener("pointerdown", (event) => startProcessDrag(event, processNode.name));
        }
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          if (suppressNextProcessClick) return;
          selectionHint.textContent = processNode.permanentPinned
            ? "Operação selecionada: " + processNode.name + ". A posição está fixada permanentemente."
            : processNode.pinned
              ? "Operação selecionada: " + processNode.name + ". A posição está ancorada."
              : "Operação selecionada: " + processNode.name + ". Arraste o marcador para reposicionar.";
          if (!confirmDiscardPendingChanges()) return;
          selectedProcessFilter = processNode.name;
          selectedId = null; selectedCableId = null; equipmentFormDirty = false; cableFormDirty = false; equipmentEditMode = false;
          activeTab = "points";
          render();
        });
        mapHolder.appendChild(marker);
      });

      renderEquipmentMarkers();

      if (showCableLayer) filteredCables().forEach((cable) => {
        const from = pointById(cable.from);
        const to = pointById(cable.to);
        if (!from || !to) return;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.classList.add("cable-line");
        if (cable.uid === selectedCableId) line.classList.add("active");
        line.setAttribute("x1", from.x + "%");
        line.setAttribute("y1", from.y + "%");
        line.setAttribute("x2", to.x + "%");
        line.setAttribute("y2", to.y + "%");
        line.setAttribute("stroke", cable.color || "#2563eb");
        line.setAttribute("stroke-width", cable.width || "4");
        line.addEventListener("click", (event) => {
          event.stopPropagation();
          selectCable(cable.uid);
        });
        cableLayer.appendChild(line);

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.classList.add("cable-label");
        label.setAttribute("x", ((from.x + to.x) / 2) + "%");
        label.setAttribute("y", ((from.y + to.y) / 2) + "%");
        label.setAttribute("text-anchor", "middle");
        label.textContent = showLabelLayer ? cable.cableId || "" : "";
        cableLayer.appendChild(label);
      });

    }

    function applyEquipmentEditorMode(point) {
      // Consultation is separate from the explicit editing action.
      editor.classList.toggle("view-mode", !equipmentEditMode);
      editEquipment.classList.add("hidden");
      equipmentLink.disabled = false;
      equipmentLink.readOnly = true;
      copyEquipmentLink.disabled = false;
      markerPosition.disabled = false;
      markerPosition.readOnly = true;
      selectionHint.textContent = equipmentEditMode
        ? "Editando " + (point.markerId || "equipamento selecionado") + "."
        : "Informações de " + (point.markerId || "equipamento selecionado") + ". Clique em Editar para modificar.";
    }

    function contextUsesOverlay() {
      return Number(globalThis.innerWidth) <= 700;
    }

    function renderContextNavigation() {
      const panel = document.getElementById("contextNavigationPanel");
      panel.hidden = !contextPanelOpen;
      panel.inert = !contextPanelOpen;
      panel.setAttribute("aria-hidden", String(!contextPanelOpen));
      appShell.classList.toggle("context-panel-collapsed", !contextPanelOpen);
      appShell.classList.toggle("context-overlay-open", contextPanelOpen && contextUsesOverlay());
      const names = { map: "Explorar planta", equipment: "Equipamentos", operations: "Operações" };
      document.getElementById("contextNavigationTitle").textContent = names[navigationSection];
      for (const [id, section] of [["navigateMap", "map"], ["openEquipmentList", "equipment"], ["navigateOperations", "operations"]]) {
        const button = document.getElementById(id);
        const active = navigationSection === section;
        button.classList.toggle("active", active);
        button.setAttribute("aria-expanded", String(active && contextPanelOpen));
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
      const equipmentSection = navigationSection === "equipment";
      document.getElementById("focusEquipmentDrawer").hidden = !contextPanelOpen || !equipmentSection;
      document.getElementById("contextOperationSection").hidden = equipmentSection;
      document.getElementById("contextOperationsManage").hidden = navigationSection !== "operations";
      if (contextPanelOpen && !equipmentSection) renderContextOperations();
    }

    function renderContextOperations() {
      const list = document.getElementById("contextOperationList");
      list.replaceChildren();
      const query = normalizeSearch(contextOperationSearchTerm);
      const counts = new Map();
      state.points.forEach(point => pointProcesses(point).forEach(name => counts.set(name, (counts.get(name) || 0) + 1)));
      const operations = [...(state.processNodes || [])].filter(node => normalizeSearch([node.name, node.processId, node.area].filter(Boolean).join(" ")).includes(query));
      if (!operations.length) {
        const empty = document.createElement("p"); empty.className = "context-empty";
        empty.textContent = query ? "Nenhuma operação encontrada." : "Sua planta ainda não tem operações. Você pode cadastrar equipamentos diretamente no mapa.";
        list.append(empty); return;
      }
      operations.forEach(operation => {
        const button = document.createElement("button"); button.type = "button";
        button.className = "context-operation-item" + (operation.name === selectedProcessFilter ? " active" : "");
        button.setAttribute("aria-pressed", String(operation.name === selectedProcessFilter));
        const name = document.createElement("strong"); name.textContent = operation.name;
        const count = document.createElement("small"); const total = counts.get(operation.name) || 0;
        count.textContent = total + " equipamento" + (total === 1 ? "" : "s");
        button.append(name, count);
        button.addEventListener("click", () => {
          if (!confirmDiscardPendingChanges()) return;
          selectedProcessFilter = operation.name;
          selectedId = null; selectedCableId = null;
          equipmentFormDirty = false; cableFormDirty = false; equipmentEditMode = false;
          if (contextUsesOverlay()) contextPanelOpen = false;
          setInspectorCollapsed(true);
          render();
        });
        list.append(button);
      });
    }

    function setNavigationSection(section, open = true) {
      if (!["map", "equipment", "operations"].includes(section) || !confirmDiscardPendingChanges()) return false;
      closeContextMenus();
      navigationSection = section;
      showEquipmentLayer = section === "equipment";
      showOperationLayer = section !== "equipment";
      contextPanelOpen = !!open;
      equipmentFormDirty = false; cableFormDirty = false; equipmentEditMode = false;
      setInspectorCollapsed(true);
      if (section === "equipment") activeTab = "points";
      renderContextNavigation();
      renderTabs(); renderList(); renderEditor(); renderMap(); renderMetrics(); renderLayerButtons(); renderOverviewOverview();
      if (!open) document.getElementById(section === "equipment" ? "openEquipmentList" : section === "operations" ? "navigateOperations" : "navigateMap").focus({ preventScroll: true });
      return true;
    }

    function closeContextMenus(except = null) {
      document.querySelectorAll(".session-menu[open], .focus-options[open], .focus-options-content details[open]").forEach(menu => {
        if (menu !== except && !menu.contains(except)) menu.open = false;
      });
    }

    function renderEquipmentSummary(point = selectedPoint()) {
      const summary = document.getElementById("equipmentSummary");
      if (globalThis.requestAnimationFrame) requestAnimationFrame(() => applyMapZoom(mapZoom));
      summary.hidden = !point || equipmentEditMode || (contextUsesOverlay() && contextPanelOpen);
      if (!point) return;
      document.getElementById("equipmentSummaryName").textContent = point.name || "Equipamento sem nome";
      document.getElementById("equipmentSummaryCode").textContent = point.markerId || "Sem código";
      const status = normalizeEquipmentStatus(point.status);
      document.getElementById("equipmentSummaryStatus").textContent = uiLabel(status);
      document.getElementById("equipmentSummaryStatus").dataset.status = status;
      const positioned = !!state.mapImage && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
      const locate = document.getElementById("summaryLocateEquipment");
      locate.disabled = !positioned;
      locate.title = positioned ? "Destacar a posição no mapa" : "Equipamento sem posição válida neste mapa";
      document.getElementById("equipmentSummaryType").textContent = uiLabel(point.type || "Other");
      document.getElementById("equipmentSummaryOperation").textContent = processText(point) || "Sem vínculo";
    }

    function startEquipmentEditing() {
      if (!selectedPoint() || !confirmDiscardPendingChanges()) return false;
      closeContextMenus();
      contextPanelOpen = false;
      renderContextNavigation();
      equipmentEditMode = true;
      equipmentFormDirty = false;
      document.getElementById("focusEquipmentDrawer").hidden = true;
      document.getElementById("openEquipmentList").setAttribute("aria-expanded", "false");
      setInspectorCollapsed(false);
      renderEditor();
      equipmentId.focus({ preventScroll: true });
      return true;
    }

    function closeEquipmentEditing() {
      if (!confirmDiscardPendingChanges()) return false;
      equipmentEditMode = false;
      equipmentFormDirty = false;
      setInspectorCollapsed(true);
      renderEditor();
      document.getElementById("summaryEditEquipment").focus({ preventScroll: true });
      return true;
    }

    function toggleEquipmentList(open) {
      return setNavigationSection("equipment", open);
    }

    function locateSelectedEquipment() {
      const point = selectedPoint();
      if (!point || !state.mapImage || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) return false;
      if (contextUsesOverlay() && contextPanelOpen) {
        contextPanelOpen = false; renderContextNavigation(); renderEditor(); applyMapZoom(mapZoom);
      }
      mapPanX = (50 - point.x) / 100 * mapHolder.offsetWidth;
      mapPanY = (50 - point.y) / 100 * mapHolder.offsetHeight;
      applyMapTransform();
      const marker = [...mapHolder.querySelectorAll(".equipment-map-marker")].find(item => item.equipmentGroup?.points.some(member => member.uid === point.uid));
      marker?.focus({ preventScroll: true });
      return true;
    }

    function renderEditor() {
      const point = selectedPoint();
      renderEquipmentSummary(point);
      appShell.classList.toggle("equipment-editing", !!point && equipmentEditMode);
      sidebarHome.textContent = point && equipmentEditMode ? "Voltar à consulta" : "Fechar painel";
      const inspectorSecondary = document.querySelector(".inspector-secondary");
      const inspectorMode = point ? "equipment" : "operations";
      if (inspectorSecondary && inspectorSecondary.dataset.mode !== inspectorMode) {
        inspectorSecondary.open = !point;
        inspectorSecondary.dataset.mode = inspectorMode;
      }
      document.getElementById("sidebarInspector").classList.toggle("equipment-selected", !!point);
      const activeMap = DEFAULT_MAPS[state.activeMapId];
      panelTitle.textContent = point
        ? "Equipamento · " + (point.markerId || "Selecionado")
        : "Equipamentos · " + (activeMap.label || activeMap.name || activeMap.id);
      if (!point) {
        editEquipment.classList.add("hidden");
        panelLockToggle.classList.add("hidden");
        panelLockToggle.disabled = true;
        editor.classList.add("hidden");
        equipmentFormDirty = false;
        setFormStatus(equipmentFormStatus, "", false);
        if (cableMode) {
          selectionHint.textContent = cableStartId
            ? "Origem selecionada. Selecione o equipamento de destino."
            : "Modo Cabo: selecione o equipamento de origem e depois o destino.";
          return;
        }
        selectionHint.textContent = mapCreateHint();
        return;
      }

      if (!equipmentEditMode) {
        editor.classList.add("hidden");
        editEquipment.classList.add("hidden");
        panelLockToggle.classList.add("hidden");
        return;
      }
      editor.classList.remove("hidden");
      document.getElementById("equipmentOperationContext").textContent = "Operações vinculadas: " + (processText(point) || "Sem vínculo — opcional");
      editor.querySelectorAll("[data-edit-availability]").forEach((control) => {
        control.disabled = control.dataset.editAvailability === "disabled";
        delete control.dataset.editAvailability;
      });
      panelLockToggle.classList.remove("hidden");
      panelLockToggle.disabled = false;
      panelLockToggle.textContent = point.locked ? "Desafixar" : "Fixar";
      panelLockToggle.title = point.locked ? "Liberar a posição deste device" : "Fixar permanentemente a posição deste device";
      isRenderingForm = true;
      equipmentId.value = point.markerId || "";
      equipmentName.value = point.name || "";
      document.getElementById("equipmentDeploymentStage").value = normalizeDeploymentStage(point.deploymentStage);
      processNameInput.value = "";
      renderProcessChips(point);
      equipmentCriticality.value = point.criticality || "Medium";
      equipmentType.value = point.type || "Other";
      updateCategoryHint();
      equipmentStatus.value = normalizeEquipmentStatus(point.status);
      equipmentCountry.value = normalizeCountry(point.country);
      equipmentPlant.value = point.plant || "";
      equipmentArea.value = point.area || "";
      equipmentLine.value = point.productionLine || "";
      equipmentStation.value = point.station || "";
      equipmentIp.value = point.ip || "";
      equipmentModel.value = point.model || "";
      equipmentSerial.value = point.serial || "";
      equipmentMac.value = point.mac || "";
      equipmentVlan.value = point.vlan || "";
      equipmentHostname.value = point.hostname || "";
      equipmentVendor.value = point.vendor || "";
      equipmentOwner.value = point.owner || "";
      equipmentTicket.value = point.ticket || "";
      equipmentRack.value = point.rack || "";
      equipmentPort.value = point.port || "";
      markerColor.value = point.color || "#ef4444";
      markerShape.value = point.shape || "pin";
      markerLabelMode.value = point.labelMode || "id";
      markerSize.value = clampIconSize(point.iconSize);
      markerSizeValue.value = clampIconSize(point.iconSize);
      markerPosition.value = "X " + point.x.toFixed(1) + "% / Y " + point.y.toFixed(1) + "%";
      populateQuickLtsTargets(point);
      equipmentInfo.value = point.info || "";
      validationFound.checked = !!point.validationChecklist?.found;
      validationHostname.checked = !!point.validationChecklist?.hostname;
      validationIp.checked = !!point.validationChecklist?.ip;
      validationMac.checked = !!point.validationChecklist?.mac;
      validationSerial.checked = !!point.validationChecklist?.serial;
      validationPort.checked = !!point.validationChecklist?.port;
      validationPhoto.checked = !!point.validationChecklist?.photo;
      validationResponsible.checked = !!point.validationChecklist?.responsible;
      validationDeploymentReady.checked = !!point.validationChecklist?.deploymentReady;
      validationStatus.value = normalizeValidationStatus(point.validationStatus);
      lastValidationDate.value = point.lastValidationDate || "";
      validatedBy.value = point.validatedBy || "";
      const equipmentHash = "#equipment=" + encodeURIComponent(point.uid);
      equipmentLink.value = location.protocol === "file:"
        ? equipmentHash
        : location.origin + location.pathname + equipmentHash;
      renderPhotos(point);
      equipmentFormDirty = false;
      setFormStatus(equipmentFormStatus, "", false);
      applyEquipmentEditorMode(point);
      isRenderingForm = false;
    }

    function renderPhotos(point = selectedPoint()) {
      if (!point || selectedPoint() !== point) return;
      photos.innerHTML = "";

      point.photos.forEach((photo, index) => {
        const item = document.createElement("div");
        item.className = "photo";
        item.innerHTML = '<img alt="Foto do equipamento" loading="lazy" decoding="async"><button type="button" title="Remover foto">x</button>';
        item.querySelector("img").src = photo;
        item.querySelector("img").addEventListener("click", () => openPhoto(photo));
        item.querySelector("button").addEventListener("click", () => {
          if (selectedPoint() !== point) return;
          const removedPhoto = point.photos.splice(index, 1)[0];
          if (!saveState()) {
            point.photos.splice(index, 0, removedPhoto);
            alert("Não foi possível remover a foto do device.");
            return;
          }
          renderPhotos(point);
        });
        photos.appendChild(item);
      });
    }

    function renderCableEditor() {
      populateCablePointSelects();
      const cable = selectedCable();
      if (!cable) {
        cableEditor.classList.add("hidden");
        cableFormDirty = false;
        return;
      }

      cableEditor.classList.remove("hidden");
      editor.classList.add("hidden");
      selectionHint.textContent = "Editando o cabo " + (cable.cableId || "cabo selecionado") + ".";
      isRenderingForm = true;
      cableId.value = cable.cableId || "";
      cableFrom.value = cable.from || "";
      cableTo.value = cable.to || "";
      cableFromPort.value = cable.fromPort || "";
      cableToPort.value = cable.toPort || "";
      cableType.value = cable.type || "Ethernet";
      cableStatus.value = cable.status || "Active";
      cableColor.value = cable.color || "#2563eb";
      cableWidth.value = String(cable.width || "4");
      cableVlan.value = cable.vlan || "";
      cableRack.value = cable.rackSwitch || "";
      cableNotes.value = cable.notes || "";
      cableFormDirty = false;
      isRenderingForm = false;
    }

    function renderProcessChips(point) {
      processChips.innerHTML = "";
      const selected = new Set(pointProcesses(point));
      const linkedCount = selected.size;
      linkedOperationsCount.textContent = String(linkedCount);
      openLinkedOperations.setAttribute(
        "aria-label",
        "Gerenciar " + linkedCount + " " + (linkedCount === 1 ? "operação vinculada" : "operações vinculadas")
      );
      if (!state.processes.length) {
        processChips.innerHTML = '<span class="empty-state">Nenhuma operação cadastrada. Crie uma no mapa ou na aba Operações.</span>';
        return;
      }
      state.processes.forEach((processName) => {
        const chip = document.createElement("button");
        chip.type = "button";
        const isLinked = selected.has(processName);
        chip.className = "process-chip" + (isLinked ? " active" : "");
        chip.setAttribute("aria-pressed", String(isLinked));
        chip.textContent = processName;
        chip.addEventListener("click", () => {
          const point = selectedPoint();
          if (!point) return;
          const current = new Set(pointProcesses(point));
           if (current.has(processName)) {
              if (!confirm("Remover este equipamento da operação " + processName + "?")) return;
              current.delete(processName);
          } else {
             if (!confirm("Vincular este equipamento à operação " + processName + "?")) return;
             current.add(processName);
           }
           const previousProcesses = [...pointProcesses(point)];
           const previousAuditLogs = [...(state.auditLogs || [])];
           point.processes = [...current].sort();
           point.process = point.processes.join(", ");
           recordAudit("equipment", point.uid, "operation", previousProcesses.join(", "), point.process, "update");
           if (!saveState()) {
             point.processes = previousProcesses;
             point.process = previousProcesses.join(", ");
             state.auditLogs = previousAuditLogs;
             alert("Não foi possível salvar o vínculo do device.");
             return;
           }
          renderEditor();
          renderMap();
          renderList();
          renderCableList();
          renderProcessList();
        });
        processChips.appendChild(chip);
      });
    }

    function populateCablePointSelects() {
      const options = state.points
        .map((point) => '<option value="' + escapeHtml(point.uid) + '">' + escapeHtml(pointName(point)) + "</option>")
        .join("");
      cableFrom.innerHTML = options;
      cableTo.innerHTML = options;
    }

    function pointSelectOptions(points = state.points, placeholder = "Selecione um equipamento") {
      return '<option value="">' + escapeHtml(placeholder) + '</option>' + points
        .map((point) => '<option value="' + escapeHtml(point.uid) + '">' + escapeHtml(pointName(point)) + '</option>')
        .join("");
    }

    function ltsPoints() {
      return state.points.filter((point) => point.type === "LTS");
    }

    function renderManualCableCreator(container) {
      const box = document.createElement("div");
      box.className = "process-card";
      const selectedPointId = selectedPoint()?.uid || "";
      box.innerHTML =
        '<label>Create cable manually</label>' +
        '<div class="field-row">' +
          '<div class="field"><label>From</label><select data-role="manual-from"></select></div>' +
          '<div class="field"><label>To</label><select data-role="manual-to"></select></div>' +
        '</div>' +
        '<div class="process-add">' +
          '<select data-role="manual-lts"></select>' +
          '<button class="secondary" type="button" data-action="use-lts">Use LTS as destination</button>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Cable type</label><select data-role="manual-type"><option value="Ethernet">Ethernet</option><option value="Fiber">Fiber</option><option value="Power">Power</option><option value="Control">Control</option><option value="Coax">Coax</option><option value="Other">Other</option></select></div>' +
          '<div class="field"><label>Espessura do cabo</label><select data-role="manual-width"><option value="0.5">Ultrafino</option><option value="1">Muito fino</option><option value="2">Fino</option><option value="4">Médio</option><option value="7">Grosso</option><option value="10">Muito grosso</option></select></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>From port</label><input data-role="manual-from-port" type="text" placeholder="EX: SW1-05"></div>' +
          '<div class="field"><label>To port</label><input data-role="manual-to-port" type="text" placeholder="EX: ETH-1"></div>' +
        '</div>' +
        '<div class="process-add">' +
          '<input data-role="manual-cable-id" type="text" placeholder="Cable ID auto if empty">' +
          '<button type="button" data-action="create-manual-cable">Create cable</button>' +
        '</div>';
      const fromSelect = box.querySelector('[data-role="manual-from"]');
      const toSelect = box.querySelector('[data-role="manual-to"]');
      const ltsSelect = box.querySelector('[data-role="manual-lts"]');
      fromSelect.innerHTML = pointSelectOptions(state.points, "Selecione a origem");
      toSelect.innerHTML = pointSelectOptions(state.points, "Selecione o destino");
      ltsSelect.innerHTML = pointSelectOptions(ltsPoints(), "Selecione o LTS");
      fromSelect.value = selectedPointId;
      ltsSelect.disabled = !ltsPoints().length;
      box.querySelector('[data-action="use-lts"]').disabled = !ltsPoints().length;
      box.querySelector('[data-action="use-lts"]').addEventListener("click", () => {
        if (!ltsSelect.value) return;
        toSelect.value = ltsSelect.value;
        const target = pointById(ltsSelect.value);
        box.querySelector('[data-role="manual-to-port"]').value = target?.port || "";
      });
      fromSelect.addEventListener("change", () => {
        const point = pointById(fromSelect.value);
        box.querySelector('[data-role="manual-from-port"]').value = point?.port || "";
      });
      toSelect.addEventListener("change", () => {
        const point = pointById(toSelect.value);
        box.querySelector('[data-role="manual-to-port"]').value = point?.port || "";
      });
      box.querySelector('[data-action="create-manual-cable"]').addEventListener("click", () => {
        createManualCableFromBox(box);
      });
      if (selectedPointId) {
        box.querySelector('[data-role="manual-from-port"]').value = selectedPoint()?.port || "";
      }
      container.appendChild(box);
    }

    function populateQuickLtsTargets(point) {
      const targets = state.points.filter((candidate) => candidate.uid !== point.uid && candidate.type === "LTS");
      quickLtsTarget.innerHTML = targets.length
        ? targets.map((target) => '<option value="' + escapeHtml(target.uid) + '">' + escapeHtml(pointName(target)) + "</option>").join("")
        : '<option value="">No LTS available</option>';
      quickLtsTarget.disabled = !targets.length;
      quickLtsCable.disabled = !targets.length;
      quickCableId.value = "";
      quickCableType.value = "Ethernet";
      quickCableWidth.value = "1";
    }

    function renderList() {
      if (activeTab !== "points" || !panelIsVisible(equipmentList.parentElement)) return;
      equipmentList.innerHTML = "";
      const title = document.createElement("div");
      title.className = "list-title";
      title.innerHTML = "<h3></h3><span></span>";
      title.querySelector("h3").textContent = filteredPoints().length + " de " + state.points.length + " equipamentos";
      title.querySelector("span").hidden = true;
      equipmentList.appendChild(title);

      if (!state.points.length) {
        equipmentList.insertAdjacentHTML("beforeend", '<p class="empty-state">Nenhum equipamento cadastrado.</p>');
        return;
      }

      filteredPoints().forEach((point) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "equipment-card" + (point.uid === selectedId ? " active" : "");
        card.innerHTML = '<div class="card-top"><strong></strong></div><span class="equipment-list-name"></span><p class="equipment-list-operation"></p><div class="card-meta"><span class="equipment-list-type"></span><span class="equipment-list-status"></span></div>';
        card.querySelector("strong").textContent = point.markerId || "Sem código";
        card.querySelector(".equipment-list-name").textContent = point.name || "Equipamento sem nome";
        card.querySelector(".equipment-list-operation").textContent = processText(point) || "Sem operação vinculada";
        card.querySelector(".equipment-list-type").textContent = uiLabel(point.type || "Other");
        const status = normalizeEquipmentStatus(point.status);
        card.querySelector(".equipment-list-status").textContent = uiLabel(status);
        card.querySelector(".equipment-list-status").dataset.status = status;
        card.setAttribute("aria-label", "Consultar equipamento " + pointName(point));
        card.addEventListener("click", () => selectPoint(point.uid));
        equipmentList.appendChild(card);
      });
    }

    function renderCableList() {
      if (activeTab !== "cables" || !panelIsVisible(cableList.parentElement)) return;
      cableList.innerHTML = "";
      const title = document.createElement("div");
      title.className = "list-title";
      title.innerHTML = "<h3></h3><span></span>";
      title.querySelector("h3").textContent = selectedProcessFilter ? "Cabos vinculados à operação " + selectedProcessFilter : "Todos os cabos";
      title.querySelector("span").textContent = filteredCables().length + " exibidos / " + state.cables.length + " total";
      cableList.appendChild(title);
      renderManualCableCreator(cableList);

      if (!state.cables.length) {
        cableList.insertAdjacentHTML("beforeend", '<p class="empty-state">Nenhum cabo cadastrado. Crie um acima ou use o modo Cabo e selecione dois equipamentos no mapa.</p>');
        return;
      }

      filteredCables().forEach((cable) => {
        const from = pointById(cable.from);
        const to = pointById(cable.to);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "cable-card" + (cable.uid === selectedCableId ? " active" : "");
        card.innerHTML = '<div class="card-top"><strong></strong><i class="card-dot"></i></div><span></span><div class="card-meta"></div>';
        card.querySelector("strong").textContent = cable.cableId || "Cabo sem código";
        card.querySelector(".card-dot").style.background = cable.color || "#2563eb";
        card.querySelector("span").textContent = pointName(from) + " -> " + pointName(to);
        card.querySelector(".card-meta").innerHTML =
          "<span>" + escapeHtml(cable.type || "Cable") + "</span>" +
          "<span>" + escapeHtml(cable.status || "Active") + "</span>" +
          (cable.fromPort ? "<span>From " + escapeHtml(cable.fromPort) + "</span>" : "") +
          (cable.toPort ? "<span>To " + escapeHtml(cable.toPort) + "</span>" : "");
        card.addEventListener("click", () => {
          selectCable(cable.uid);
        });
        cableList.appendChild(card);
      });
    }

    function processSummaries() {
      const names = [...new Set([
        ...(state.processes || []),
        ...state.points.flatMap((point) => pointProcesses(point))
      ].map((name) => String(name).trim()).filter(Boolean))].sort();

      return names.map((name) => {
        const node = processNodeByName(name);
        const industrialArea = industrialAreaDefinition(node?.area || "");
        const allPoints = state.points.filter((point) => pointProcesses(point).includes(name));
        const points = allPoints.filter((point) => matchesDeploymentStage(point) && matchesDeviceType(point));
        const statuses = [...new Set(points.map((point) => normalizeEquipmentStatus(point.status)))].sort();
        const types = [...new Set(points.map((point) => point.type || "Equipment"))].sort();
        const linkedPointIds = new Set(points.map((point) => point.uid));
        const cables = state.cables.filter((cable) => linkedPointIds.has(cable.from) || linkedPointIds.has(cable.to));
        return {
          name,
          node,
          area: node?.area || "",
          industrialArea,
          workstream: node?.workstream || "",
          operationProcesses: operationProcessList(node),
          permanentPinned: !!node?.permanentPinned,
          pinned: !!node?.pinned,
          points,
          allPoints,
          cables,
          statuses,
          types,
          links: linkedProcessNames(name)
        };
      });
    }

    function openOperationDialog(operationName) {
      const summary = processSummaries().find((item) => item.name === operationName);
      if (!summary) return false;
      const color = operationColor(summary.node || summary.name);
      operationDialog.style.setProperty("--operation-color", color);
      operationDialogId.textContent = processDisplayId(summary.node || summary.name);
      operationDialogTitle.textContent = summary.name;
      operationDialogSummary.innerHTML =
        '<span><strong>' + summary.points.length + '</strong> equipamento' + (summary.points.length === 1 ? '' : 's') + '</span>' +
        '<span><strong>' + summary.cables.length + '</strong> cabo' + (summary.cables.length === 1 ? '' : 's') + '</span>' +
        '<span><strong>' + escapeHtml(summary.workstream || 'Sem workstream') + '</strong></span>';
      const typeText = summary.types.length ? summary.types.join(", ") : "Não informado";
      const statusText = summary.statuses.length ? summary.statuses.join(", ") : "Não informado";
      const processRows = summary.operationProcesses.length
        ? '<div class="operation-dialog-chip-list">' + summary.operationProcesses.map((name) => '<span>' + escapeHtml(name) + '</span>').join("") + '</div>'
        : '<p class="operation-dialog-muted">Nenhum processo interno cadastrado.</p>';
      operationDialogContent.innerHTML =
        '<section class="operation-dialog-section operation-overview">' +
          '<div><span>Área da operação</span><strong>' + escapeHtml(summary.area || "Não informada") + '</strong></div>' +
          '<div><span>Categoria dos equipamentos</span><strong>' + escapeHtml(typeText) + '</strong></div>' +
          '<div><span>Status</span><strong>' + escapeHtml(statusText) + '</strong></div>' +
          '<div><span>Posição</span><strong>' + escapeHtml(Math.round(summary.node?.x || 0) + "% · " + Math.round(summary.node?.y || 0) + "%") + '</strong></div>' +
        '</section>' +
        '<section class="operation-dialog-section"><h3>Processos da operação</h3>' + processRows + '</section>' +
        '<section class="operation-dialog-section"><h3>Equipamentos na operação</h3>' +
          '<div class="operation-device-grid">' + summary.points.map((point) =>
            '<button class="operation-device-card" type="button" data-operation-device="' + escapeHtml(point.uid) + '">' +
              '<i style="background:' + (point.color || '#2563eb') + '"></i>' +
              '<span><strong>' + escapeHtml(pointName(point)) + '</strong><small>' + escapeHtml([uiLabel(point.type || 'Equipment'), uiLabel(point.status || '')].filter(Boolean).join(' · ')) + '</small></span>' +
            '</button>'
          ).join("") + '</div>' +
        '</section>';
      operationDialogContent.querySelectorAll("[data-operation-device]").forEach((button) => {
        button.addEventListener("click", () => {
          operationDialog.close();
          selectPoint(button.dataset.operationDevice);
        });
      });
      if (!operationDialog.open) operationDialog.showModal();
      return true;
    }

    function renderProcessList() {
      if (activeTab !== "processes" || !panelIsVisible(processList.parentElement)) return;
      processList.innerHTML = "";
      const allSummaries = processSummaries();
      let summaries = allSummaries;
      const focusedSummary = selectedProcessFilter ? allSummaries.find((summary) => summary.name === selectedProcessFilter) : null;
      if (selectedProcessFilter && !focusedSummary && !processNodeByName(selectedProcessFilter)) {
        selectedProcessFilter = "";
      }
      if (focusedSummary) summaries = [focusedSummary];
      if (!focusedSummary && (operationSearchTerm.trim() || selectedIndustrialAreaFilter || selectedDeploymentStage || selectedDeviceType)) {
        summaries = summaries.filter((summary) => operationMatchesFilters(summary));
      }
      const title = document.createElement("div");
      title.className = "list-title";
      title.innerHTML = "<h3></h3><span></span>";
      title.querySelector("h3").textContent = focusedSummary ? "Detalhes da operação" : "Operações";
      title.querySelector("span").textContent = focusedSummary
        ? processDisplayId(focusedSummary.node || focusedSummary.name)
        : ((operationSearchTerm.trim() || selectedIndustrialAreaFilter || selectedDeploymentStage || selectedDeviceType) ? summaries.length + "/" : "") + allSummaries.length + " operações";
      processList.appendChild(title);

      if (focusedSummary) {
        const focusHeader = document.createElement("div");
        focusHeader.className = "process-focus-header";
        focusHeader.innerHTML = '<button class="secondary" type="button">Voltar para operações</button><span></span>';
        focusHeader.querySelector("span").textContent = focusedSummary.name;
        focusHeader.querySelector("button").addEventListener("click", returnToOperationsHome);
        processList.appendChild(focusHeader);
      } else if (selectedProcessFilter && processNodeByName(selectedProcessFilter)) {
        const emptyFocus = document.createElement("div");
        emptyFocus.className = "process-filter-note";
        emptyFocus.innerHTML = '<span></span><button class="secondary" type="button">+ Equipamento</button>';
        emptyFocus.querySelector("span").textContent = selectedProcessFilter + " ainda não possui equipamentos e não aparece no mapa.";
        emptyFocus.querySelector("button").addEventListener("click", () => openDeviceDialog(selectedProcessFilter));
        processList.appendChild(emptyFocus);
      } else {
        const createBox = document.createElement("div");
        createBox.className = "process-card";
        createBox.innerHTML =
          '<div class="field-row">' +
            '<div class="field"><label for="newGlobalProcess">Nome da nova operação</label><input id="newGlobalProcess" type="text" maxlength="120" placeholder="Ex.: Expedição"></div>' +
            '<div class="field"><label for="newGlobalArea">Área da operação</label><input id="newGlobalArea" type="text" list="manufacturingAreaOptions" maxlength="120" placeholder="Selecione ou digite uma área industrial"></div>' +
          '</div>' +
          '<div class="process-add">' +
            '<select id="newGlobalWorkstream" aria-label="Workstream">' + workstreamOptionsHtml() + '</select>' +
            '<button type="button" data-action="create-process">Criar operação</button>' +
          '</div>';
        const creationStatus = document.createElement("p");
        creationStatus.id = "newOperationStatus";
        creationStatus.className = "form-status hidden";
        creationStatus.setAttribute("role", "alert");
        createBox.appendChild(creationStatus);
        const stageField = document.createElement("label");
        stageField.className = "deployment-field";
        stageField.innerHTML = 'Classificação<select id="newGlobalDeploymentStage">' + deploymentOptions() + '</select>';
        createBox.querySelector(".process-add").before(stageField);
        createBox.querySelector('[data-action="create-process"]').addEventListener("click", () => {
          const input = createBox.querySelector("#newGlobalProcess");
          const area = createBox.querySelector("#newGlobalArea").value;
          const workstream = createBox.querySelector("#newGlobalWorkstream").value;
          if (createProcess(input.value, nextOperationPosition(), { workstream, area, deploymentStage: createBox.querySelector("#newGlobalDeploymentStage").value, onValidationError: message => { setFormStatus(creationStatus, message, true); input.focus(); } })) {
            input.value = "";
            createBox.querySelector("#newGlobalArea").value = "";
          }
        });
        createBox.querySelectorAll("#newGlobalProcess, #newGlobalArea").forEach((input) => {
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              createBox.querySelector('[data-action="create-process"]').click();
            }
          });
        });
        processList.appendChild(createBox);
      }


      if (!allSummaries.length) {
        processList.insertAdjacentHTML("beforeend", '<p class="empty-state">Nenhuma operação com device. Crie uma operação e adicione o primeiro device pela planta.</p>');
        return;
      }

      if (!summaries.length) {
        processList.insertAdjacentHTML("beforeend", '<p class="empty-state">Nenhuma operação encontrada para este filtro.</p>');
        return;
      }

      summaries.forEach((summary) => {
        const card = document.createElement("div");
        const available = state.points.filter((point) => !pointProcesses(point).includes(summary.name));
        const isActiveProcess = summary.name === selectedProcessFilter;
        card.className = "process-card" +
          (isActiveProcess ? " active" : "") +
          (summary.pinned ? " pinned" : "") +
          (summary.permanentPinned ? " permanent-pinned" : "");
        card.style.setProperty("--operation-color", operationColor(summary.node || summary.name));
        card.innerHTML =
          '<button class="card-top" type="button"><strong></strong><span></span></button>' +
          '<div class="process-actions"></div>' +
          '<div class="card-meta"></div>' +
          '<div class="operation-area-editor">' +
            '<label>Área da operação</label>' +
            '<div class="process-add"><input data-role="operation-area-input" type="text" list="manufacturingAreaOptions" maxlength="120" placeholder="Selecione ou digite uma área industrial" aria-label="Área da operação"><button class="secondary" type="button" data-action="save-operation-area">Salvar área</button></div>' +
          '</div>' +
          '<div class="process-add operation-process-add">' +
            '<input data-role="operation-process-input" type="text" placeholder="EX: Picking / Packing / Loading">' +
            '<button class="secondary" type="button" data-action="add-operation-process">Add process</button>' +
          '</div>' +
          '<div class="operation-processes"></div>' +
          '<div class="process-add process-device-add">' +
            '<button type="button" data-action="create-device">+ Equipamento</button>' +
            '<select data-role="device-select"></select>' +
            '<button class="secondary" type="button" data-action="add-device">Vincular existente</button>' +
          '</div>' +
          '<div class="process-devices"></div>' +
          '<div class="process-add process-workstream-add">' +
            '<select data-role="workstream-select"></select>' +
            '<button class="secondary" type="button" data-action="save-workstream">Save workstream</button>' +
          '</div>' +
          '<div class="process-add process-link-add">' +
            '<select data-role="process-link-select"></select>' +
            '<button class="secondary" type="button" data-action="link-process">Link operations</button>' +
          '</div>' +
          '<div class="process-links"></div>';
        card.querySelector("strong").textContent = processDisplayId(summary.node || summary.name) + " - " + summary.name;
        card.querySelector(".card-top span").textContent =
          summary.points.length + (summary.points.length === 1 ? " equipamento" : " equipamentos") +
          " · " + (summary.area ? "Área: " + summary.area : "Sem área") +
          (summary.permanentPinned ? " · fixada permanentemente" : summary.pinned ? " · posição ancorada" : " · posição livre");
        card.querySelector(".card-top").addEventListener("click", () => {
          if (selectProcess(summary.name)) openOperationDialog(summary.name);
        });
        const actions = card.querySelector(".process-actions");
        if (isActiveProcess) {
          const lockButton = summary.permanentPinned
            ? '<button class="secondary operation-lock-status" type="button" data-action="permanent-pin" disabled aria-disabled="true">Operação fixada</button>'
            : '<button class="operation-lock-button" type="button" data-action="permanent-pin">Fixar permanentemente</button>';
          actions.innerHTML =
            '<button type="button" data-action="create-device-top">+ Equipamento</button>' +
            lockButton +
            '<button class="secondary" type="button" data-action="rename">Renomear</button>' +
            '<button class="danger" type="button" data-action="remove">Excluir</button>';
          actions.querySelector('[data-action="create-device-top"]').addEventListener("click", () => openDeviceDialog(summary.name));
          if (!summary.permanentPinned) {
            actions.querySelector('[data-action="permanent-pin"]').addEventListener("click", () => permanentlyPinOperation(summary.name));
          }
          actions.querySelector('[data-action="rename"]').addEventListener("click", () => renameProcess(summary.name));
          actions.querySelector('[data-action="remove"]').addEventListener("click", () => removeProcess(summary.name));
        } else {
          actions.innerHTML = '<button class="secondary" type="button" data-action="filter">Abrir operação</button>';
          actions.querySelector('[data-action="filter"]').addEventListener("click", () => {
            if (selectProcess(summary.name)) openOperationDialog(summary.name);
          });
        }
        card.querySelector(".operation-process-add").classList.toggle("hidden", !isActiveProcess);
        card.querySelector(".operation-area-editor").classList.toggle("hidden", !isActiveProcess);
        card.querySelector(".process-device-add").classList.toggle("hidden", !isActiveProcess);
        card.querySelector(".process-link-add").classList.toggle("hidden", !isActiveProcess);
        card.querySelector(".process-workstream-add").classList.toggle("hidden", !isActiveProcess);
        const operationProcessInput = card.querySelector('[data-role="operation-process-input"]');
        const operationAreaInput = card.querySelector('[data-role="operation-area-input"]');
        operationAreaInput.value = summary.area;
        card.querySelector('[data-action="save-operation-area"]').addEventListener("click", () => {
          updateProcessArea(summary.name, operationAreaInput.value);
        });
        operationAreaInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            card.querySelector('[data-action="save-operation-area"]').click();
          }
        });
        card.querySelector('[data-action="add-operation-process"]').addEventListener("click", () => {
          addProcessToOperation(summary.name, operationProcessInput.value);
          operationProcessInput.value = "";
        });
        operationProcessInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            card.querySelector('[data-action="add-operation-process"]').click();
          }
        });
        card.querySelector('[data-action="create-device"]').addEventListener("click", () => openDeviceDialog(summary.name));
        const workstreamSelect = card.querySelector('[data-role="workstream-select"]');
        workstreamSelect.innerHTML = workstreamOptionsHtml(summary.workstream);
        card.querySelector('[data-action="save-workstream"]').addEventListener("click", () => updateProcessWorkstream(summary.name, workstreamSelect.value));
        const processLinkSelect = card.querySelector('[data-role="process-link-select"]');
        const linkableProcesses = allSummaries
          .map((item) => item.name)
          .filter((name) => name !== summary.name && !areProcessesLinked(summary.name, name));
        processLinkSelect.innerHTML = linkableProcesses.length
          ? linkableProcesses.map((name) => '<option value="' + escapeHtml(name) + '">' + escapeHtml(processDisplayId(name) + " - " + name) + '</option>').join("")
          : '<option value="">No operation available</option>';
        processLinkSelect.disabled = !linkableProcesses.length;
        card.querySelector('[data-action="link-process"]').disabled = !linkableProcesses.length;
        card.querySelector('[data-action="link-process"]').addEventListener("click", () => linkProcesses(summary.name, processLinkSelect.value));
        const meta = card.querySelector(".card-meta");
        meta.classList.toggle("hidden", !isActiveProcess);
        meta.innerHTML =
          (summary.types.length ? "<span>" + escapeHtml(summary.types.join(", ")) + "</span>" : "") +
          (summary.statuses.length ? "<span>" + escapeHtml(summary.statuses.join(", ")) + "</span>" : "");

        const select = card.querySelector('[data-role="device-select"]');
        select.innerHTML = available.length
          ? available.map((point) => '<option value="' + escapeHtml(point.uid) + '">' + escapeHtml(pointName(point)) + "</option>").join("")
          : '<option value="">Nenhum equipamento disponível</option>';
        select.disabled = !available.length;
        card.querySelector('[data-action="add-device"]').disabled = !available.length;
        card.querySelector('[data-action="add-device"]').addEventListener("click", () => {
          addEquipmentToProcess(select.value, summary.name);
        });

        const operationProcessesBox = card.querySelector(".operation-processes");
        operationProcessesBox.classList.toggle("hidden", !isActiveProcess);
        if (!summary.operationProcesses.length) {
          operationProcessesBox.innerHTML = '<p class="empty-state">No processes inside this operation yet.</p>';
        } else {
          operationProcessesBox.innerHTML = summary.operationProcesses.map((name) =>
            '<div class="operation-process-row"><span>' + escapeHtml(name) + '</span><button class="secondary" type="button" data-operation-process="' + escapeHtml(name) + '">Remove</button></div>'
          ).join("");
          operationProcessesBox.querySelectorAll("[data-operation-process]").forEach((button) => {
            button.addEventListener("click", () => removeProcessFromOperation(summary.name, button.dataset.operationProcess));
          });
        }

        const processLinksBox = card.querySelector(".process-links");
        processLinksBox.classList.toggle("hidden", !isActiveProcess || !summary.links.length);
        processLinksBox.innerHTML = summary.links.map((name) =>
          '<div class="process-link-row"><span>Operation line to ' + escapeHtml(processDisplayId(name) + " - " + name) + '</span><button class="secondary" type="button" data-process-link="' + escapeHtml(name) + '">Remove link</button></div>'
        ).join("");
        processLinksBox.querySelectorAll("[data-process-link]").forEach((button) => {
          button.addEventListener("click", () => unlinkProcesses(summary.name, button.dataset.processLink));
        });

        const deviceList = card.querySelector(".process-devices");
        deviceList.classList.toggle("hidden", !isActiveProcess);
        if (!summary.points.length) {
          deviceList.innerHTML = '<p class="empty-state">Nenhum equipamento vinculado. Adicione um novo ou vincule um equipamento existente.</p>';
        } else {
          summary.points.forEach((point) => {
            const row = document.createElement("div");
            row.className = "process-device-row";
            row.innerHTML = '<button class="secondary" type="button" data-action="select"><strong></strong><span></span></button><button class="danger" type="button" data-action="unlink">Remover</button>';
            row.querySelector("strong").textContent = pointName(point);
            row.querySelector("strong").appendChild(deploymentBadge(point));
            row.querySelector("span").textContent = [uiLabel(point.type || "Equipment"), point.ip ? "IP " + point.ip : "", point.port ? "Porta " + point.port : ""].filter(Boolean).join(" / ");
            row.querySelector('[data-action="select"]').addEventListener("click", () => {
              selectPoint(point.uid);
            });
            row.querySelector('[data-action="unlink"]').addEventListener("click", () => removeEquipmentFromProcess(point.uid, summary.name));
            deviceList.appendChild(row);
          });
        }
        const stageEditor = document.createElement("label");
        stageEditor.className = "deployment-field operation-deployment";
        stageEditor.innerHTML = 'Classificação da operação<select aria-label="Classificação da operação">' + deploymentOptions(normalizeDeploymentStage(summary.node?.deploymentStage)) + '</select>';
        stageEditor.querySelector("select").addEventListener("change", (event) => {
          if (!updateOperationDeploymentStage(summary.node, event.target.value)) event.target.value = normalizeDeploymentStage(summary.node.deploymentStage);
        });
        card.querySelector(".card-top").after(stageEditor);
        processList.appendChild(card);
      });
    }
    function createProcess(value, position = { x: 50, y: 50 }, options = {}) {
      const validation = validateNewOperation(value, (state.processNodes || []).map(node => node.name));
      if (!validation.ok) {
        if (options.onValidationError) options.onValidationError(validation.error);
        else selectionHint.textContent = validation.error;
        return false;
      }
      const names = [validation.name];
      const previousProcesses = [...(state.processes || [])];
      const previousProcessNodes = (state.processNodes || []).map((node) => ({ ...node, operationProcesses: [...(node.operationProcesses || [])] }));
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousSelection = {
        process: selectedProcessFilter,
        point: selectedId,
        cable: selectedCableId,
        tab: activeTab
      };
      names.forEach((name, index) => {
        const existed = !!processNodeByName(name);
        const requestedPosition = {
          x: Math.max(0, Math.min(100, (position.x ?? 50) + index * 3)),
          y: Math.max(0, Math.min(100, (position.y ?? 50) + index * 3))
        };
        upsertProcessNode(
          name,
          requestedPosition.x,
          requestedPosition.y,
          options.workstream || "",
          options.area || ""
        );
        if (!existed) {
          processNodeByName(name).deploymentStage = normalizeDeploymentStage(options.deploymentStage, "TO DO");
          recordAudit("operation", name, "operation", "", state.activeMapId, "create");
        }
      });
      selectedProcessFilter = processNodeByName(names[0])?.name || names[0];
      selectedId = null;
      selectedCableId = null;
      activeTab = "processes";
      if (!saveState()) {
        state.processes = previousProcesses;
        state.processNodes = previousProcessNodes;
        state.auditLogs = previousAuditLogs;
        selectedProcessFilter = previousSelection.process;
        selectedId = previousSelection.point;
        selectedCableId = previousSelection.cable;
        activeTab = previousSelection.tab;
        alert("Não foi possível salvar a operação. Confira a conexão com o servidor e tente novamente.");
        return false;
      }
      render();
      return true;
    }

    function permanentlyPinOperation(operationName) {
      const node = processNodeByName(operationName);
      if (!node || node.permanentPinned) return;
      if (!confirm(
        'Fixar permanentemente a operação "' + operationName + '" nesta posição?\n\n' +
        "Depois de confirmar, a posição não poderá mais ser liberada pela interface."
      )) return;
      const previousPinned = !!node.pinned;
      const previousPermanentPinned = !!node.permanentPinned;
      const previousAuditLogs = [...(state.auditLogs || [])];
      node.permanentPinned = true;
      node.pinned = true;
      recordAudit("operation", operationName, "permanent position lock", "free", "fixed", "update");
      if (!saveState()) {
        node.pinned = previousPinned;
        node.permanentPinned = previousPermanentPinned;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar a fixação permanente da operação.");
        return;
      }
      selectionHint.textContent = "Operação fixada permanentemente: " + operationName + ". A posição não poderá mais ser alterada.";
      render();
    }

    function addProcessToOperation(operationName, processName) {
      const node = processNodeByName(operationName);
      const cleanNames = processListFromValue(processName);
      if (!node || !cleanNames.length) return;
      if (!confirm("Adicionar processo " + cleanNames.join(", ") + " à operação " + operationName + "?")) return;
      const previousOperationProcesses = operationProcessList(node);
      const previousAuditLogs = [...(state.auditLogs || [])];
      node.operationProcesses = [...new Set([...operationProcessList(node), ...cleanNames])].sort();
      recordAudit("operation", operationName, "operation processes", previousOperationProcesses.join(", "), node.operationProcesses.join(", "), "update");
      if (!saveState()) {
        node.operationProcesses = previousOperationProcesses;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar os processos da operação.");
        return false;
      }
      renderProcessList();
      renderDashboard();
      renderQaReport();
      return true;
    }

    function removeProcessFromOperation(operationName, processName) {
      const node = processNodeByName(operationName);
      if (!node || !processName) return;
      if (!confirm("Remover processo " + processName + " da operação " + operationName + "?")) return;
      const previousOperationProcesses = operationProcessList(node);
      const previousAuditLogs = [...(state.auditLogs || [])];
      node.operationProcesses = operationProcessList(node).filter((name) => name !== processName);
      recordAudit("operation", operationName, "operation processes", previousOperationProcesses.join(", "), node.operationProcesses.join(", "), "update");
      if (!saveState()) {
        node.operationProcesses = previousOperationProcesses;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar os processos da operação.");
        return false;
      }
      renderProcessList();
      renderDashboard();
      renderQaReport();
      return true;
    }

    function addEquipmentToProcess(pointId, processName) {
      const point = pointById(pointId);
      if (!point || !processName) return;
      if (!confirm("Vincular " + pointName(point) + " à operação " + processName + "?")) return;
      const previousProcesses = [...pointProcesses(point)];
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousFilter = selectedProcessFilter;
      point.processes = [...new Set([...previousProcesses, processName])].sort();
      point.process = point.processes.join(", ");
      state.processes = [...new Set([...(state.processes || []), processName])].sort();
      selectedProcessFilter = processName;
      recordAudit("equipment", point.uid, "operation", "", processName, "update");
      if (!saveState()) {
        point.processes = previousProcesses;
        point.process = previousProcesses.join(", ");
        state.auditLogs = previousAuditLogs;
        selectedProcessFilter = previousFilter;
        alert("Não foi possível salvar o vínculo do device.");
        return false;
      }
      render();
      return true;
    }

    function removeEquipmentFromProcess(pointId, processName) {
      const point = pointById(pointId);
      if (!point || !processName) return;
      const previousProcesses = [...pointProcesses(point)];
      if (!confirm("Remover " + pointName(point) + " da operação " + processName + "?")) return;
      const previousAuditLogs = [...(state.auditLogs || [])];
      point.processes = previousProcesses.filter((name) => name !== processName);
      point.process = point.processes.join(", ");
      recordAudit("equipment", point.uid, "operation", processName, "", "update");
      if (!saveState()) {
        point.processes = previousProcesses;
        point.process = previousProcesses.join(", ");
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível remover o vínculo do device.");
        return false;
      }
      render();
      return true;
    }

    function updateProcessWorkstream(processName, workstream) {
      const node = processNodeByName(processName);
      if (!node) return;
      const cleanWorkstream = normalizeWorkstream(workstream);
      const label = cleanWorkstream || "No workstream";
      if ((node.workstream || "") === cleanWorkstream) return;
      if (!confirm("Definir frente de trabalho da operação " + processDisplayId(node) + " - " + processName + " para " + label + "?")) return;
      const previousWorkstream = node.workstream || "";
      const previousAuditLogs = [...(state.auditLogs || [])];
      node.workstream = cleanWorkstream;
      recordAudit("operation", processName, "workstream", previousWorkstream, cleanWorkstream, "update");
      if (!saveState()) {
        node.workstream = previousWorkstream;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar o workstream da operação.");
        return false;
      }
      render();
      return true;
    }

    function updateProcessArea(processName, area) {
      const node = processNodeByName(processName);
      if (!node) return false;
      const cleanArea = sanitizeText(area, TEXT_LIMITS.short);
      const previousArea = node.area || "";
      if (previousArea === cleanArea) return true;
      const label = cleanArea || "Sem área";
      if (!confirm("Definir a área da operação " + processDisplayId(node) + " - " + processName + " como " + label + "?")) return false;
      const previousAuditLogs = [...(state.auditLogs || [])];
      node.area = cleanArea;
      recordAudit("operation", processName, "area", previousArea, cleanArea, "update");
      if (!saveState()) {
        node.area = previousArea;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar a área da operação.");
        return false;
      }
      render();
      return true;
    }

    function renameProcess(currentName) {
      const nextName = prompt("Rename operation", currentName);
      const cleanName = processListFromValue(nextName)[0] || "";
      if (!cleanName || cleanName === currentName) return;
      const duplicate = (state.processes || []).find((name) =>
        name !== currentName && name.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        alert('Já existe uma operação chamada "' + duplicate + '".');
        return;
      }
      if (!confirm("Renomear operação " + currentName + " para " + cleanName + "?")) return;
      const previous = {
        processes: [...(state.processes || [])],
        processNodes: JSON.parse(JSON.stringify(state.processNodes || [])),
        processLinks: JSON.parse(JSON.stringify(state.processLinks || [])),
        pointProcesses: state.points.map((point) => ({ uid: point.uid, process: point.process, processes: [...pointProcesses(point)] })),
        auditLogs: [...(state.auditLogs || [])],
        selectedProcessFilter
      };
      state.processes = [...new Set((state.processes || []).map((name) => name === currentName ? cleanName : name))].sort();
      state.processNodes = (state.processNodes || []).map((node) => node.name === currentName ? { ...node, name: cleanName } : node);
      state.processLinks = (state.processLinks || []).map((link) => ({
        ...link,
        from: link.from === currentName ? cleanName : link.from,
        to: link.to === currentName ? cleanName : link.to
      }));
      state.points.forEach((point) => {
        point.processes = [...new Set(pointProcesses(point).map((name) => name === currentName ? cleanName : name))].sort();
        point.process = point.processes.join(", ");
      });
      if (selectedProcessFilter === currentName) selectedProcessFilter = cleanName;
      recordAudit("operation", cleanName, "name", currentName, cleanName, "update");
      if (!saveState()) {
        state.processes = previous.processes;
        state.processNodes = previous.processNodes;
        state.processLinks = previous.processLinks;
        previous.pointProcesses.forEach((savedPoint) => {
          const point = pointById(savedPoint.uid);
          if (point) {
            point.process = savedPoint.process;
            point.processes = savedPoint.processes;
          }
        });
        state.auditLogs = previous.auditLogs;
        selectedProcessFilter = previous.selectedProcessFilter;
        alert("Não foi possível renomear a operação.");
        return false;
      }
      render();
      return true;
    }

    function removeProcess(processName) {
      const linkedDevices = state.points.filter((point) => pointProcesses(point).includes(processName));
      if (linkedDevices.length) {
        alert("Não é possível excluir esta operação enquanto houver equipamentos vinculados. Mova ou exclua os equipamentos primeiro.");
        return false;
        /*
        alert("Não é possível excluir esta operação enquanto houver equipamentos vinculados. Mova ou exclua os equipamentos primeiro.");
        return false;
        */
      }
      if (!confirm('Remover a operação "' + processName + '" e seus vínculos? Os equipamentos serão preservados.')) return;
      const previous = {
        processes: [...(state.processes || [])],
        processNodes: JSON.parse(JSON.stringify(state.processNodes || [])),
        processLinks: JSON.parse(JSON.stringify(state.processLinks || [])),
        pointProcesses: state.points.map((point) => ({ uid: point.uid, process: point.process, processes: [...pointProcesses(point)] })),
        auditLogs: [...(state.auditLogs || [])],
        selectedProcessFilter
      };
      recordAudit("operation", processName, "operation", processName, "", "delete");
      state.processes = (state.processes || []).filter((name) => name !== processName);
      state.processNodes = (state.processNodes || []).filter((node) => node.name !== processName);
      state.processLinks = (state.processLinks || []).filter((link) => link.from !== processName && link.to !== processName);
      state.points.forEach((point) => {
        point.processes = pointProcesses(point).filter((name) => name !== processName);
        point.process = point.processes.join(", ");
      });
      if (selectedProcessFilter === processName) selectedProcessFilter = "";
      if (!saveState()) {
        state.processes = previous.processes;
        state.processNodes = previous.processNodes;
        state.processLinks = previous.processLinks;
        previous.pointProcesses.forEach((savedPoint) => {
          const point = pointById(savedPoint.uid);
          if (point) {
            point.process = savedPoint.process;
            point.processes = savedPoint.processes;
          }
        });
        state.auditLogs = previous.auditLogs;
        selectedProcessFilter = previous.selectedProcessFilter;
        alert("Não foi possível excluir a operação.");
        return false;
      }
      render();
      return true;
    }

    function renderTabs() {
      showPoints.classList.toggle("active", activeTab === "points");
      showCables.classList.toggle("active", activeTab === "cables");
      showProcesses.classList.toggle("active", activeTab === "processes");
      equipmentList.classList.toggle("hidden", activeTab !== "points");
      cableList.classList.toggle("hidden", activeTab !== "cables");
      processList.classList.toggle("hidden", activeTab !== "processes");
      const atOperationsHome = activeTab === "processes" &&
        !selectedProcessFilter && !selectedId && !selectedCableId &&
        !operationSearchTerm && !selectedIndustrialAreaFilter;
      sidebarHome.disabled = !selectedId && !selectedCableId;
      if (atOperationsHome) {
        sidebarHome.setAttribute("aria-current", "page");
      } else {
        sidebarHome.removeAttribute("aria-current");
      }
      renderMapToolButtons();
      renderLayerButtons();
    }

    function filteredPoints() {
      const visibleOperationNames = selectedIndustrialAreaFilter
        ? new Set(operationSummariesWithEquipment().map((summary) => summary.name))
        : null;
      return state.points.filter((point) => {
        if (visibleOperationNames && !pointProcesses(point).some((name) => visibleOperationNames.has(name))) return false;
        if (operationSearchTerm.trim() && !pointMatchesGlobalSearch(point)) return false;
        if (!matchesDeploymentStage(point) || !matchesDeviceType(point)) return false;
        if (selectedProcessFilter && !pointProcesses(point).includes(selectedProcessFilter)) return false;
        if (!listSearch) return true;
        return [
          point.markerId, point.name, point.type, point.status, point.area, point.ip,
          processText(point), point.criticality, point.model, point.serial, point.mac, point.vlan,
          point.hostname, point.vendor, point.owner, point.ticket, point.country, point.plant, point.productionLine, point.station,
          point.rack, point.port, point.info
        ].join(" ").toLowerCase().includes(listSearch);
      });
    }

    function filteredCables() {
      const visiblePointIds = new Set(filteredPoints().map((point) => point.uid));
      return state.cables.filter((cable) => {
        const from = pointById(cable.from);
        const to = pointById(cable.to);
        if ((listSearch || selectedProcessFilter || selectedDeploymentStage || selectedDeviceType || operationSearchTerm.trim() || selectedIndustrialAreaFilter) && !visiblePointIds.has(cable.from) && !visiblePointIds.has(cable.to)) return false;
        if (selectedProcessFilter) {
          const fromMatches = from && pointProcesses(from).includes(selectedProcessFilter);
          const toMatches = to && pointProcesses(to).includes(selectedProcessFilter);
          if (!fromMatches && !toMatches) return false;
        }
        if (!listSearch) return true;
        return [
          cable.cableId, cable.type, cable.status, cable.fromPort, cable.toPort, cable.notes,
          pointName(from), pointName(to)
        ].join(" ").toLowerCase().includes(listSearch);
      });
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    function setFormStatus(target, message, isError = false) {
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("error", isError);
      target.classList.toggle("hidden", !message);
    }

    function markEquipmentDirty() {
      if (isRenderingForm) return;
      equipmentFormDirty = true;
      setFormStatus(equipmentFormStatus, "Alterações pendentes. Clique em Salvar para registrar o equipamento.", false);
    }

    function markCableDirty() {
      if (isRenderingForm) return;
      cableFormDirty = true;
    }

    function confirmDiscardPendingChanges() {
      if (!equipmentFormDirty && !cableFormDirty) return true;
      return confirm("Há alterações no formulário que ainda não foram salvas. Descartá-las e continuar?");
    }

    function savePendingEditsBeforeAction() {
      if (equipmentFormDirty && !updateSelectedFromForm()) return false;
      if (cableFormDirty && !updateSelectedCableFromForm()) return false;
      return true;
    }

    function selectPoint(pointId) {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      if (!confirmDiscardPendingChanges()) return false;
      closeContextMenus();
      equipmentSearchResultsOpen = false;
      showEquipmentLayer = true;
      showOperationLayer = false;
      selectedId = pointId;
      selectedCableId = null;
      activeTab = "points";
      equipmentFormDirty = false;
      equipmentEditMode = false;
      cableFormDirty = false;
      if (contextUsesOverlay()) contextPanelOpen = false;
      setInspectorCollapsed(true);
      render();
      return true;
    }

    function selectCable(cableUid) {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      if (!confirmDiscardPendingChanges()) return false;
      selectedCableId = cableUid;
      selectedId = null;
      activeTab = "cables";
      equipmentFormDirty = false;
      equipmentEditMode = false;
      cableFormDirty = false;
      render();
      return true;
    }

    function selectProcess(processName) {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      if (!confirmDiscardPendingChanges()) return false;
      selectedProcessFilter = processName;
      selectedId = null;
      selectedCableId = null;
      activeTab = "processes";
      equipmentFormDirty = false;
      equipmentEditMode = false;
      cableFormDirty = false;
      setInspectorCollapsed(false);
      render();
      return true;
    }

    function duplicatePoint(field, value, currentUid, normalizer = (item) => String(item || "").trim().toLowerCase()) {
      const clean = normalizer(value);
      if (!clean) return null;
      return state.points.find((point) => point.uid !== currentUid && isActiveEquipment(point) && normalizer(point[field]) === clean) || null;
    }

    function cablePairExists(from, to, currentUid = "") {
      return state.cables.some((cable) =>
        cable.uid !== currentUid &&
        ((cable.from === from && cable.to === to) || (cable.from === to && cable.to === from))
      );
    }

    function buildPointDraftFromForm(point = {}) {
      const checklist = {
        found: validationFound.checked,
        hostname: validationHostname.checked,
        ip: validationIp.checked,
        mac: validationMac.checked,
        serial: validationSerial.checked,
        port: validationPort.checked,
        photo: validationPhoto.checked,
        responsible: validationResponsible.checked,
        deploymentReady: validationDeploymentReady.checked
      };
      const normalizedMac = normalizeMac(equipmentMac.value);
      const normalizedVlan = normalizeVlan(equipmentVlan.value);
      return {
        markerId: sanitizeText(equipmentId.value, TEXT_LIMITS.short),
        name: sanitizeText(equipmentName.value, TEXT_LIMITS.medium),
        deploymentStage: normalizeDeploymentStage(document.getElementById("equipmentDeploymentStage").value),
        processes: pointProcesses(point),
        process: pointProcesses(point).join(", "),
        criticality: sanitizeText(equipmentCriticality.value || "Medium", TEXT_LIMITS.short),
        type: normalizeCategory(equipmentType.value),
        status: normalizeEquipmentStatus(equipmentStatus.value),
        country: normalizeCountry(equipmentCountry.value),
        plant: sanitizeText(equipmentPlant.value, TEXT_LIMITS.short),
        area: sanitizeText(equipmentArea.value, TEXT_LIMITS.short),
        productionLine: sanitizeText(equipmentLine.value, TEXT_LIMITS.short),
        station: sanitizeText(equipmentStation.value, TEXT_LIMITS.short),
        ip: sanitizeText(equipmentIp.value, TEXT_LIMITS.short),
        model: sanitizeText(equipmentModel.value, TEXT_LIMITS.short),
        serial: sanitizeText(equipmentSerial.value, TEXT_LIMITS.short),
        mac: normalizedMac === null ? sanitizeText(equipmentMac.value, TEXT_LIMITS.short) : normalizedMac,
        vlan: normalizedVlan === null ? sanitizeText(equipmentVlan.value, TEXT_LIMITS.short) : normalizedVlan,
        hostname: sanitizeText(equipmentHostname.value, TEXT_LIMITS.short),
        vendor: sanitizeText(equipmentVendor.value, TEXT_LIMITS.short),
        owner: sanitizeText(equipmentOwner.value, TEXT_LIMITS.short),
        ticket: sanitizeText(equipmentTicket.value, TEXT_LIMITS.short),
        rack: sanitizeText(equipmentRack.value, TEXT_LIMITS.short),
        port: sanitizeText(equipmentPort.value, TEXT_LIMITS.short),
        color: markerColor.value || "#ef4444",
        shape: markerShape.value || "pin",
        labelMode: markerLabelMode.value || "id",
        iconSize: clampIconSize(markerSize.value),
        size: "custom",
        info: sanitizeText(equipmentInfo.value, TEXT_LIMITS.long),
        validationChecklist: checklist,
        validationStatus: normalizeValidationStatus(validationStatus.value),
        lastValidationDate: sanitizeText(lastValidationDate.value, TEXT_LIMITS.short),
        validatedBy: sanitizeText(validatedBy.value || "local-user", TEXT_LIMITS.short)
      };
    }

    function validatePointDraft(draft, currentUid = "") {
      const errors = [];
      const warnings = [];
      const currentPoint = currentUid ? pointById(currentUid) : null;
      if (!draft.markerId) errors.push("O código do equipamento é obrigatório.");
      if (equipmentIp.value.trim() && !isValidIPv4(equipmentIp.value.trim())) errors.push("Informe um endereço IPv4 válido.");
      if (equipmentMac.value.trim() && normalizeMac(equipmentMac.value) === null) errors.push("O endereço MAC precisa ter 12 caracteres hexadecimais.");
      if (equipmentVlan.value.trim() && normalizeVlan(equipmentVlan.value) === null) errors.push("A VLAN deve ser um número entre 1 e 4094.");
      if (draft.hostname && !isValidHostname(draft.hostname)) errors.push("O nome na rede contém caracteres inválidos.");
      if (!draft.serial) warnings.push("Recomendamos informar o número de série, que está vazio.");
      [
        ["markerId", "Marker ID", (value) => String(value || "").trim().toLowerCase()],
        ["ip", "IP", (value) => String(value || "").trim()],
        ["mac", "MAC", (value) => normalizeMac(value) || String(value || "").trim().toUpperCase()],
        ["hostname", "Hostname", (value) => String(value || "").trim().toLowerCase()],
        ["serial", "Número de série", (value) => String(value || "").trim().toLowerCase()]
      ].forEach(([field, label, normalizer]) => {
        const value = draft[field];
        if (currentPoint && normalizer(value) === normalizer(currentPoint[field])) return;
        const duplicate = duplicatePoint(field, value, currentUid, normalizer);
        if (duplicate) errors.push(label + " já está cadastrado em " + pointName(duplicate) + ".");
      });
      return { errors, warnings };
    }

    function validatePointData(draft, currentUid = "", raw = {}) {
      const errors = [];
      const warnings = [];
      const rawIp = raw.ip ?? draft.ip;
      const rawMac = raw.mac ?? draft.mac;
      const rawVlan = raw.vlan ?? draft.vlan;
      if (!draft.markerId) errors.push("O código do equipamento é obrigatório.");
      if (String(rawIp || "").trim() && !isValidIPv4(rawIp)) errors.push("Informe um endereço IPv4 válido.");
      if (String(rawMac || "").trim() && normalizeMac(rawMac) === null) errors.push("O endereço MAC precisa ter 12 caracteres hexadecimais.");
      if (String(rawVlan || "").trim() && normalizeVlan(rawVlan) === null) errors.push("A VLAN deve ser um número entre 1 e 4094.");
      if (draft.hostname && !isValidHostname(draft.hostname)) errors.push("O nome na rede contém caracteres inválidos.");
      if (!draft.serial) warnings.push("Recomendamos informar o número de série, que está vazio.");
      [
        ["markerId", "Marker ID", draft.markerId, (value) => String(value || "").trim().toLowerCase()],
        ["ip", "IP", draft.ip, (value) => String(value || "").trim()],
        ["mac", "MAC", draft.mac, (value) => String(value || "").trim().toUpperCase()],
        ["hostname", "Hostname", draft.hostname, (value) => String(value || "").trim().toLowerCase()],
        ["serial", "Número de série", draft.serial, (value) => String(value || "").trim().toLowerCase()]
      ].forEach(([field, label, value, normalizer]) => {
        const duplicate = duplicatePoint(field, value, currentUid, normalizer);
        if (duplicate) errors.push(label + " já está cadastrado em " + pointName(duplicate) + ".");
      });
      return { errors, warnings };
    }

    function buildCableDraftFromForm() {
      const normalizedVlan = normalizeVlan(cableVlan.value);
      return {
        cableId: sanitizeText(cableId.value || "CBL", TEXT_LIMITS.short),
        from: cableFrom.value,
        to: cableTo.value,
        fromPort: sanitizeText(cableFromPort.value, TEXT_LIMITS.short),
        toPort: sanitizeText(cableToPort.value, TEXT_LIMITS.short),
        type: sanitizeText(cableType.value || "Ethernet", TEXT_LIMITS.short),
        status: sanitizeText(cableStatus.value || "Active", TEXT_LIMITS.short),
        color: /^#[0-9a-fA-F]{6}$/.test(cableColor.value) ? cableColor.value : "#2563eb",
        width: cableWidth.value || "4",
        vlan: normalizedVlan === null ? sanitizeText(cableVlan.value, TEXT_LIMITS.short) : normalizedVlan,
        rackSwitch: sanitizeText(cableRack.value, TEXT_LIMITS.short),
        notes: sanitizeText(cableNotes.value, TEXT_LIMITS.long)
      };
    }

    function validateCableDraft(draft, currentUid = "") {
      const errors = [];
      if (!draft.from || !draft.to) errors.push("Informe a origem e o destino do cabo.");
      if (draft.from && draft.to && draft.from === draft.to) errors.push("A origem e o destino do cabo precisam ser diferentes.");
      if (draft.from && !pointById(draft.from)) errors.push("O equipamento de origem não existe.");
      if (draft.to && !pointById(draft.to)) errors.push("O equipamento de destino não existe.");
      if (cableVlan.value.trim() && normalizeVlan(cableVlan.value) === null) errors.push("A VLAN do cabo deve ser um número entre 1 e 4094.");
      if (draft.from && draft.to && cablePairExists(draft.from, draft.to, currentUid)) errors.push("Já existe um cabo entre estes equipamentos.");
      return { errors };
    }

    function applyDraft(entity, draft, target, entityType) {
      Object.keys(draft).forEach((field) => {
        const oldValue = target[field];
        const newValue = draft[field];
        if (JSON.stringify(oldValue ?? "") !== JSON.stringify(newValue ?? "")) {
          recordAudit(entityType, target.uid, field, oldValue, newValue, "update");
          target[field] = newValue;
        }
      });
    }

    function updateSelectedFromForm() {
      const point = selectedPoint();
      if (!point) return false;
      const draft = buildPointDraftFromForm(point);
      const validation = validatePointDraft(draft, point.uid);
      if (validation.errors.length) {
        alert("Não foi possível salvar o equipamento:\n\n" + validation.errors.join("\n"));
        setFormStatus(equipmentFormStatus, validation.errors.join(" "), true);
        return false;
      }
      const previousPoint = JSON.parse(JSON.stringify(point));
      const previousAuditLogs = [...(state.auditLogs || [])];
      applyDraft("equipment", draft, point, "equipment");
      if (!saveState()) {
        Object.keys(point).forEach((key) => delete point[key]);
        Object.assign(point, previousPoint);
        state.auditLogs = previousAuditLogs;
        setFormStatus(equipmentFormStatus, "Não foi possível salvar. Confira a conexão com o servidor e tente novamente.", true);
        return false;
      }
      equipmentFormDirty = false;
      setFormStatus(equipmentFormStatus, validation.warnings.length ? validation.warnings.join(" ") : "Alteração registrada; confira o salvamento no servidor.", !!validation.warnings.length);
      renderMetrics();
      renderMap();
      renderList();
      renderCableList();
      renderProcessList();
      renderDashboard();
      renderQaReport();
      renderAuditLog();
      return true;
    }

    function updateSelectedCableFromForm() {
      const cable = selectedCable();
      if (!cable) return false;
      const draft = buildCableDraftFromForm();
      const validation = validateCableDraft(draft, cable.uid);
      if (validation.errors.length) {
        alert("Não foi possível salvar o cabo:\n\n" + validation.errors.join("\n"));
        return false;
      }
      const previousCable = JSON.parse(JSON.stringify(cable));
      const previousAuditLogs = [...(state.auditLogs || [])];
      applyDraft("cable", draft, cable, "cable");
      if (!saveState()) {
        Object.keys(cable).forEach((key) => delete cable[key]);
        Object.assign(cable, previousCable);
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar as alterações do cabo.");
        return false;
      }
      cableFormDirty = false;
      renderMap();
      renderCableList();
      renderDashboard();
      renderQaReport();
      renderAuditLog();
      return true;
    }

    function setPointDialogMode(mode) {
      pointDialogMode = mode;
      const processOnly = mode === "process";
      const linkedDevice = mode === "device-linked";
      const processLabel = pointForm.querySelector('label[for="newPointProcess"]');
      document.getElementById(processOnly ? "pointOperationFields" : "pointEquipmentOperation").append(newPointProcess.closest(".field"));
      document.getElementById(processOnly ? "pointOperationClassification" : "pointAdvancedClassification").append(document.getElementById("newPointDeploymentStage").closest(".field"));
      document.getElementById("equipmentCreationMore").open = false;
      pointDialog.classList.toggle("device-dialog", !processOnly);
      pointForm.classList.toggle("device-modal", !processOnly);
      pointDialogTitle.textContent = processOnly ? "Criar operação" : (linkedDevice ? "Adicionar equipamento à operação" : "Criar equipamento");
      pointSubmit.textContent = processOnly ? "Criar operação" : "Criar equipamento";
      processLabel.textContent = processOnly ? "Operação" : (linkedDevice ? "Operação" : "Operação (opcional)");
      newPointProcess.readOnly = linkedDevice;
      newPointProcess.required = processOnly;
      const creationStatus = document.getElementById("newPointOperationStatus");
      if (creationStatus) setFormStatus(creationStatus, "", false);
      newPointProcess.placeholder = processOnly
        ? "Digite o nome da nova operação"
        : (linkedDevice ? "Operação vinculada" : "Opcional: selecione uma operação existente");
      newPointWorkstream.disabled = !processOnly;
      newPointOperationArea.disabled = !processOnly;
      [
        newPointId, newPointName, newPointType, newPointStatus, newPointCriticality, newPointArea,
        newPointCountry, newPointPlant, newPointLine, newPointStation,
        newPointHasNetwork, newPointIp, newPointPort, newPointLtsTarget,
        newPointModel, newPointSerial, newPointMac, newPointVlan, newPointHostname, newPointVendor,
        newPointOwner, newPointTicket, newPointRack, newPointPortExtra,
        newPointColor, newPointShape, newPointInfo
      ].forEach((input) => {
        input.disabled = processOnly;
      });
      newPointId.required = !processOnly;
      newPointWorkstream.closest(".field").classList.toggle("hidden", !processOnly);
      newPointOperationArea.closest(".field").classList.toggle("hidden", !processOnly);
      pointForm.querySelectorAll(".device-create-section").forEach((section) => {
        section.classList.toggle("hidden", processOnly);
      });
      updateNewPointNetworkFields();
      if (!processOnly && !state.points.some((point) => point.type === "LTS")) {
        newPointLtsTarget.disabled = true;
      }
    }

    function populateProcessOptions() {
      processOptions.innerHTML = (state.processes || [])
        .map((processName) => '<option value="' + escapeHtml(processName) + '"></option>')
        .join("");
    }

    function populateNewPointLtsTargets() {
      const ltsPoints = state.points.filter((point) => point.type === "LTS");
      newPointLtsTarget.innerHTML =
        '<option value="">Não conectar agora</option>' +
        ltsPoints.map((point) => '<option value="' + escapeHtml(point.uid) + '">' + escapeHtml(pointName(point)) + '</option>').join("");
      newPointLtsTarget.disabled = !ltsPoints.length;
    }

    function updateNewPointNetworkFields() {
      const hasNetwork = newPointHasNetwork.checked;
      newPointNetworkFields.classList.toggle("hidden", !hasNetwork);
      if (!hasNetwork) {
        newPointIp.value = "";
        newPointPort.value = "";
        newPointLtsTarget.value = "";
      }
    }
    function openPointDialog(x, y) {
      pendingPoint = { x, y };
      pendingProcessName = "";
      pointForm.reset();
      populateProcessOptions();
      newPointProcess.value = "";
      newPointWorkstream.value = "";
      newPointOperationArea.value = "";
      newPointId.value = "";
      newPointStatus.value = "Online";
      newPointCriticality.value = "Medium";
      newPointCountry.value = countryNameForMap(state.activeMapId);
      newPointPlant.value = DEFAULT_MAPS[state.activeMapId]?.plant || "";
      newPointArea.value = "";
      newPointLine.value = "";
      newPointStation.value = "";
      newPointModel.value = "";
      newPointSerial.value = "";
      newPointMac.value = "";
      newPointVlan.value = "";
      newPointHostname.value = "";
      newPointVendor.value = "";
      newPointOwner.value = "";
      newPointTicket.value = "";
      newPointRack.value = "";
      newPointPortExtra.value = "";
      newPointHasNetwork.checked = false;
      newPointIp.value = "";
      newPointPort.value = "";
      populateNewPointLtsTargets();
      setPointDialogMode("process");
      if (pointDialog.showModal) {
        pointDialog.showModal();
      } else {
        pointDialog.setAttribute("open", "");
      }
      newPointProcess.focus();
    }

    function openDeviceDialog(processName = "", position = null) {
      const cleanProcessName = processListFromValue(processName)[0] || "";
      const operation = cleanProcessName ? processNodeByName(cleanProcessName) : null;
      if (!confirmDiscardPendingChanges()) return false;
      if (cleanProcessName && !operation) return false;
      if (!position && !operation) { setMapCreateMode("device"); return false; }
      const targetPosition = position || devicePositionForProcess(cleanProcessName);
      closeContextMenus();
      const count = state.points.length + 1;
      pendingPoint = targetPosition;
      pendingProcessName = cleanProcessName;
      pointForm.reset();
      populateProcessOptions();
      newPointProcess.value = cleanProcessName;
      newPointWorkstream.value = "";
      newPointOperationArea.value = "";
      newPointId.value = "DEV-" + String(count).padStart(2, "0");
      newPointType.value = "Printer";
      newPointStatus.value = "Online";
      newPointCriticality.value = "Medium";
      newPointCountry.value = countryNameForMap(state.activeMapId);
      newPointPlant.value = DEFAULT_MAPS[state.activeMapId]?.plant || "";
      newPointArea.value = "";
      newPointLine.value = "";
      newPointStation.value = "";
      newPointModel.value = "";
      newPointSerial.value = "";
      newPointMac.value = "";
      newPointVlan.value = "";
      newPointHostname.value = "";
      newPointVendor.value = "";
      newPointOwner.value = "";
      newPointTicket.value = "";
      newPointRack.value = "";
      newPointPortExtra.value = "";
      newPointHasNetwork.checked = false;
      newPointIp.value = "";
      newPointPort.value = "";
      populateNewPointLtsTargets();
      applyEquipmentPreset(newPointType.value, newPointColor, newPointShape);
      setPointDialogMode(cleanProcessName ? "device-linked" : "device");
      if (pointDialog.showModal) {
        pointDialog.showModal();
      } else {
        pointDialog.setAttribute("open", "");
      }
      newPointId.focus();
      newPointId.select();
      return true;
    }

    function closePointDialog() {
      pendingPoint = null;
      pendingProcessName = "";
      pointDialog.close();
      if (equipmentPlacementSelection) cancelEquipmentPlacement();
      else { mapCreateMode = "browse"; renderMapToolButtons(); }
    }

    function openPhoto(photo) {
      largePhoto.src = photo;
      if (photoDialog.showModal) {
        photoDialog.showModal();
      } else {
        photoDialog.setAttribute("open", "");
      }
    }

    function createCable(from, to, options = {}) {
      if (state.cables.length >= MAX_IMPORT_CABLES) {
        alert("Limite de " + MAX_IMPORT_CABLES + " cabos por planta atingido. Nenhum registro foi alterado.");
        return null;
      }
      if (!from || !to) return;
      if (from === to) {
        alert("A origem e o destino precisam ser diferentes.");
        return;
      }
      const count = state.cables.length + 1;
      const fromPoint = pointById(from);
      const toPoint = pointById(to);
      if (!fromPoint || !toPoint) {
        alert("O equipamento de origem ou destino não existe mais.");
        return;
      }
      if (cablePairExists(from, to)) {
        alert("Já existe um cabo entre estes equipamentos.");
        return;
      }
      const cableTypeValue = options.type || "Ethernet";
      if (options.confirm !== false && !confirm("Criar um cabo de " + pointName(fromPoint) + " para " + pointName(toPoint) + "?")) return;
      const cable = {
        uid: createUid(),
        cableId: sanitizeText(options.cableId || "CBL-" + String(count).padStart(3, "0"), TEXT_LIMITS.short),
        from,
        to,
        fromPort: sanitizeText(options.fromPort ?? fromPoint?.port ?? "", TEXT_LIMITS.short),
        toPort: sanitizeText(options.toPort ?? toPoint?.port ?? "", TEXT_LIMITS.short),
        type: cableTypeValue,
        status: options.status || "Active",
        color: options.color || CABLE_PRESETS[cableTypeValue] || CABLE_PRESETS.Other,
        width: options.width || "1",
        vlan: normalizeVlan(options.vlan || "") || "",
        rackSwitch: sanitizeText(options.rackSwitch || "", TEXT_LIMITS.short),
        notes: sanitizeText(options.notes || "", TEXT_LIMITS.long)
      };
      const previousCables = JSON.parse(JSON.stringify(state.cables || []));
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousSelectedCableId = selectedCableId;
      const previousSelectedId = selectedId;
      const previousActiveTab = activeTab;
      const previousShowCableLayer = showCableLayer;
      const previousCableMode = cableMode;
      const previousCableStartId = cableStartId;
      state.cables.push(cable);
      recordAudit("cable", cable.uid, "cable", "", cable.cableId, "create");
      showCableLayer = true;
      selectedCableId = cable.uid;
      selectedId = null;
      activeTab = options.activeTab || "cables";
      cableMode = false;
      cableStartId = null;
      if (!saveState()) {
        state.cables = previousCables;
        state.auditLogs = previousAuditLogs;
        selectedCableId = previousSelectedCableId;
        selectedId = previousSelectedId;
        activeTab = previousActiveTab;
        showCableLayer = previousShowCableLayer;
        cableMode = previousCableMode;
        cableStartId = previousCableStartId;
        alert("Não foi possível salvar o cabo.");
        return null;
      }
      render();
      if (options.focusEditor !== false) {
        cableId.focus();
        cableId.select();
      }
      return cable;
    }

    function createManualCableFromBox(box) {
      const from = box.querySelector('[data-role="manual-from"]').value;
      const to = box.querySelector('[data-role="manual-to"]').value;
      if (!from || !to) {
        alert("Selecione primeiro os equipamentos de origem e destino.");
        return;
      }
      if (from === to) {
        alert("A origem e o destino precisam ser diferentes.");
        return;
      }
      createCable(from, to, {
        cableId: box.querySelector('[data-role="manual-cable-id"]').value.trim(),
        type: box.querySelector('[data-role="manual-type"]').value,
        width: box.querySelector('[data-role="manual-width"]').value,
        fromPort: box.querySelector('[data-role="manual-from-port"]').value.trim(),
        toPort: box.querySelector('[data-role="manual-to-port"]').value.trim()
      });
    }

    function setActiveTab(tab) {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      activeTab = tab;
      renderTabs();
      renderList();
      renderCableList();
      renderProcessList();
    }

    function returnToOperationsHome() {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      if (!confirmDiscardPendingChanges()) return false;
      selectedProcessFilter = "";
      selectedId = null;
      selectedCableId = null;
      operationSearchTerm = "";
      selectedIndustrialAreaFilter = "";
      listSearch = "";
      mapCreateMode = "browse";
      cableMode = false;
      cableStartId = null;
      activeTab = "processes";
      equipmentFormDirty = false;
      equipmentEditMode = false;
      cableFormDirty = false;
      if (operationDialog.open) operationDialog.close();
      if (location.hash) {
        try {
          history.replaceState(null, "", location.href.split("#")[0]);
        } catch (error) {
          // Some browsers restrict history changes for local files. The
          // navigation still works even when the hash cannot be removed.
        }
      }
      render();
      operationSearch.focus({ preventScroll: true });
      return true;
    }

    function mapPointFromEvent(event) {
      const rect = mapImage.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
      };
    }

    function startProcessDrag(event, processName) {
      if (event.button !== undefined && event.button !== 0) return;
      const processNode = processNodeByName(processName);
      if (!processNode) return;
      if (processNode.permanentPinned || processNode.pinned) {
        selectionHint.textContent = processNode.permanentPinned
          ? "Operação selecionada: " + processName + ". A posição está fixada permanentemente."
          : "Operação selecionada: " + processName + ". A posição está ancorada.";
        return;
      }
      if (!confirmDiscardPendingChanges()) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextProcessClick = true;
        setTimeout(() => {
          suppressNextProcessClick = false;
        }, 0);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectedProcessFilter = processName;
      selectedId = null;
      selectedCableId = null;
      activeTab = "processes";
      equipmentFormDirty = false;
      cableFormDirty = false;
      processDragState = {
        processName,
        startX: event.clientX,
        startY: event.clientY,
        startProcessX: processNode.x,
        startProcessY: processNode.y,
        moved: false
      };
      selectionHint.textContent = "Operação selecionada: " + processName + ". Arraste para mudar sua posição no mapa.";
      render();
      document.addEventListener("pointermove", moveProcessMarker);
      document.addEventListener("pointerup", stopProcessDrag, { once: true });
    }

    function moveProcessMarker(event) {
      if (!processDragState) return;
      const processNode = processNodeByName(processDragState.processName);
      if (!processNode) return;
      if (processNode.permanentPinned || processNode.pinned) return;
      if (Math.abs(event.clientX - processDragState.startX) > 8 || Math.abs(event.clientY - processDragState.startY) > 8) {
        processDragState.moved = true;
      }
      if (!processDragState.moved) return;
      const next = mapPointFromEvent(event);
      processNode.x = next.x;
      processNode.y = next.y;
      const marker = [...mapHolder.querySelectorAll(".process-marker")].find((item) => item.dataset.processName === processNode.name);
      if (marker) {
        marker.style.setProperty("--x", processNode.x);
        marker.style.setProperty("--y", processNode.y);
      }
    }

    function stopProcessDrag() {
      document.removeEventListener("pointermove", moveProcessMarker);
      if (processDragState?.moved) {
        const processNode = processNodeByName(processDragState.processName);
        if (processNode) {
          const previousAuditLogs = [...(state.auditLogs || [])];
          recordAudit(
            "operation",
            processNode.name,
            "position",
            { x: processDragState.startProcessX, y: processDragState.startProcessY },
            { x: processNode.x, y: processNode.y },
            "update"
          );
          const positionSaved = saveState();
          if (!positionSaved) {
            processNode.x = processDragState.startProcessX;
            processNode.y = processDragState.startProcessY;
            state.auditLogs = previousAuditLogs;
            alert("Não foi possível salvar a nova posição da operação.");
          }
          if (positionSaved) {
            selectionHint.textContent = "Posição da operação atualizada.";
          }
          renderMap();
          renderProcessList();
        }
        suppressNextProcessClick = true;
        setTimeout(() => {
          suppressNextProcessClick = false;
        }, 0);
      }
      processDragState = null;
    }

    function startMapPan(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (mapLocked) return;
      if (!mapCanPan() || event.target !== mapImage) return;
      const visiblePan = clampMapPan();
      mapPanDrag = {
        startX: event.clientX,
        startY: event.clientY,
        startPanX: visiblePan.x,
        startPanY: visiblePan.y,
        moved: false
      };
      mapHolder.classList.add("panning");
      document.addEventListener("pointermove", moveMapPan);
      document.addEventListener("pointerup", stopMapPan, { once: true });
    }

    function eventIsInsideMapImage(event) {
      if (!state.mapImage || mapImage.classList.contains("hidden")) return false;
      const rect = mapImage.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    }

    function moveMapPan(event) {
      if (!mapPanDrag) return;
      const dx = event.clientX - mapPanDrag.startX;
      const dy = event.clientY - mapPanDrag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        mapPanDrag.moved = true;
      }
      mapPanX = mapPanDrag.startPanX + dx;
      mapPanY = mapPanDrag.startPanY + dy;
      applyMapTransform();
    }

    function stopMapPan() {
      document.removeEventListener("pointermove", moveMapPan);
      mapHolder.classList.remove("panning");
      if (mapPanDrag?.moved) {
        const visiblePan = clampMapPan();
        mapPanX = visiblePan.x; mapPanY = visiblePan.y;
        applyMapTransform();
        suppressNextMapClick = true;
        setTimeout(() => {
          suppressNextMapClick = false;
        }, 200);
      }
      mapPanDrag = null;
    }

    function clampInspectorWidth(value) {
      return Math.max(320, Math.min(680, Math.round(value)));
    }

    function setInspectorWidth(width) {
      const nextWidth = clampInspectorWidth(width);
      document.documentElement.style.setProperty("--sidebar-width", nextWidth + "px");
      storageSet("interactive-map-generic-v1-inspector-width", String(nextWidth));
      requestAnimationFrame(() => renderMap());
    }

    function setInspectorCollapsed(collapsed, options = {}) {
      const isCollapsed = !!collapsed;
      const persist = options.persist !== false;
      const refreshMap = options.refreshMap !== false;
      appShell.classList.toggle("inspector-collapsed", isCollapsed);
      sidebarInspector.inert = isCollapsed;
      sidebarInspector.setAttribute("aria-hidden", String(isCollapsed));
      toggleInspector.setAttribute("aria-expanded", String(!isCollapsed));
      toggleInspector.title = isCollapsed ? "Abrir barra lateral" : "Minimizar barra lateral";
      toggleInspector.setAttribute("aria-label", toggleInspector.title);
      if (persist) {
      storageSet("interactive-map-generic-v1-inspector-collapsed", String(isCollapsed));
      }
      if (refreshMap) {
        window.setTimeout(() => renderMap(), 190);
      }
    }

    function moveInspector(event) {
      if (!inspectorDrag) return;
      const width = inspectorDrag.startWidth - (event.clientX - inspectorDrag.startX);
      setInspectorWidth(width);
    }

    function stopInspectorResize() {
      document.removeEventListener("pointermove", moveInspector);
      inspectorDrag = null;
    }

    chooseMap?.addEventListener("click", () => mapUpload?.click());
    importJson?.addEventListener("click", () => jsonUpload?.click());

    mapUpload?.addEventListener("change", async () => {
      const file = mapUpload.files[0];
      if (!file) return;
      try {
        await validateImageFile(file, { maxBytes: MAX_MAP_FILE_BYTES, maxPixels: MAX_IMAGE_PIXELS });
      } catch (error) {
        alert(error.message || "O mapa selecionado não é uma imagem válida.");
        mapUpload.value = "";
        return;
      }
      if (!confirmDiscardPendingChanges()) {
        mapUpload.value = "";
        return;
      }
      const activeMapHasInventory = state.points.length || state.cables.length || state.processNodes.length || state.processLinks.length;
      if (activeMapHasInventory && !confirm("Substituir apenas a imagem da planta? Equipamentos, operações e vínculos serão preservados nas posições atuais.")) {
        mapUpload.value = "";
        return;
      }
      const previousState = JSON.parse(JSON.stringify(state));
      const previousMapZoom = mapZoom;
      const previousMapPanX = mapPanX;
      const previousMapPanY = mapPanY;
      const encodedMap = await fileToDataUrl(file);
      if (!isSafeImageDataUrl(encodedMap, MAX_MAP_DATA_LENGTH)) {
        alert("O mapa não pôde ser carregado com segurança.");
        mapUpload.value = "";
        return;
      }
      state.mapImage = encodedMap;
      selectedId = null;
      selectedCableId = null;
      selectedProcessFilter = "";
      operationSearchTerm = "";
      selectedIndustrialAreaFilter = "";
      equipmentFormDirty = false;
      cableFormDirty = false;
      recordAudit("map", state.activeMapId, "mapImage", "", file.name, "update");
      mapUpload.value = "";
      if (!saveState()) {
        state = previousState;
        mapZoom = previousMapZoom;
        mapPanX = previousMapPanX;
        mapPanY = previousMapPanY;
        normalizeState();
        alert("Não foi possível salvar a nova planta. A planta anterior foi restaurada.");
        render();
        return;
      }
      render();
    });

    jsonUpload?.addEventListener("change", async () => {
      const file = jsonUpload.files[0];
      if (!file) return;
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMPORT_JSON_BYTES) {
        alert("O JSON excede o limite seguro de " + Math.round(MAX_IMPORT_JSON_BYTES / 1024 / 1024) + " MB.");
        jsonUpload.value = "";
        return;
      }
      if (!confirmDiscardPendingChanges()) {
        jsonUpload.value = "";
        return;
      }
      let imported = null;
      try {
        imported = parseJson(await file.text(), null);
        if(imported?.format==='mapa-privado-v2') imported=imported.inventory;
      } catch {
        imported = null;
      }
      if (!isPlainRecord(imported) || (!Array.isArray(imported.points) && !isPlainRecord(imported.maps))) {
        alert("Este JSON não contém dados válidos do painel.");
        jsonUpload.value = "";
        return;
      }
      let sanitized;
      try {
        const cache=new Map();
        imported=await transformImages(imported,async value=>{
          if(!/^data:image\/(png|jpeg|webp);base64,/.test(value))return value;
          if(!cache.has(value)) {const [prefix,encoded]=value.split(',');const binary=atob(encoded);const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));const mime=prefix.slice(5,-7);cache.set(value,await uploadAsset(new Blob([bytes],{type:mime})));}return cache.get(value);
        });
        sanitized = sanitizeImportPayload(imported);
      } catch (error) {
        alert(error.message || "Não foi possível validar a importação. Os dados atuais foram preservados.");
        jsonUpload.value = "";
        return;
      }
      const previousState = JSON.parse(JSON.stringify(state));
      const previousSelectedId = selectedId;
      const previousSelectedCableId = selectedCableId;
      const previousSelectedProcessFilter = selectedProcessFilter;
      const previousOperationSearchTerm = operationSearchTerm;
      const previousIndustrialAreaFilter = selectedIndustrialAreaFilter;
      state = sanitized.nextState;
      normalizeState();
      selectedId = null;
      selectedCableId = null;
      selectedProcessFilter = "";
      operationSearchTerm = "";
      selectedIndustrialAreaFilter = "";
      equipmentFormDirty = false;
      cableFormDirty = false;
      recordAudit("inventory", state.activeMapId, "import", "", file.name, "import");
      jsonUpload.value = "";
      if (!saveState()) {
        state = previousState;
        selectedId = previousSelectedId;
        selectedCableId = previousSelectedCableId;
        selectedProcessFilter = previousSelectedProcessFilter;
        operationSearchTerm = previousOperationSearchTerm;
        selectedIndustrialAreaFilter = previousIndustrialAreaFilter;
        normalizeState();
        alert("Não foi possível salvar a importação. O estado anterior foi restaurado.");
        render();
        return;
      }
      render();
      alert(
        "Import finished.\n\n" +
        "Equipamentos importados: " + sanitized.summary.importedPoints + "\n" +
        "Cabos importados: " + sanitized.summary.importedCables + "\n" +
        "Ignored devices: " + sanitized.summary.ignoredPoints + "\n" +
        "Ignored cables: " + sanitized.summary.ignoredCables + "\n" +
        "Repaired UIDs: " + sanitized.summary.repairedUids + "\n" +
        "Current inconsistencies: " + buildDataQualityIssues().length
      );
    });

    mapHolder.addEventListener("click", (event) => {
      if (suppressNextMapClick) {
        suppressNextMapClick = false;
        return;
      }
      if (!state.mapImage || event.target !== mapImage || mapCreateMode === "browse") return;
      if (!confirmDiscardPendingChanges()) return;
      const rect = mapImage.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      const nextPoint = {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y))
      };
      if (mapCreateMode === "device") {
        openDeviceDialog("", nextPoint);
        return;
      }
      openPointDialog(nextPoint.x, nextPoint.y);
    });

    mapHolder.addEventListener("pointerdown", startMapPan);
    mapImage.addEventListener("load", () => {
      requestAnimationFrame(() => {
        applyMapZoom(mapZoom);
        renderEquipmentMarkers();
      });
    });

    document.getElementById("equipmentDeploymentStage").addEventListener("change", markEquipmentDirty);
    editor.addEventListener("submit", (event) => {
      event.preventDefault();
      updateSelectedFromForm();
    });

    equipmentType.addEventListener("change", () => {
      applyEquipmentPreset(equipmentType.value);
      updateCategoryHint();
      markEquipmentDirty();
    });

    newPointType.addEventListener("change", () => {
      applyEquipmentPreset(newPointType.value, newPointColor, newPointShape);
    });

    cableType.addEventListener("change", () => {
      cableColor.value = CABLE_PRESETS[cableType.value] || CABLE_PRESETS.Other;
      markCableDirty();
    });

    markerSize.addEventListener("input", () => {
      markerSizeValue.value = markerSize.value;
      markEquipmentDirty();
    });

    markerSizeValue.addEventListener("input", () => {
      markerSizeValue.value = clampIconSize(markerSizeValue.value);
      markerSize.value = markerSizeValue.value;
      markEquipmentDirty();
    });

    addPhoto.addEventListener("click", () => {
      if (selectedPoint()) photoUpload.click();
    });

    toggleLegend.addEventListener("click", () => {
      mapLegend.classList.toggle("collapsed");
      toggleLegend.textContent = mapLegend.classList.contains("collapsed") ? "Mostrar" : "Ocultar";
    });

    editEquipment.addEventListener("click", () => {
      const point = selectedPoint();
      if (!point) return;
      if (equipmentEditMode && !confirmDiscardPendingChanges()) return;
      equipmentEditMode = !equipmentEditMode;
      equipmentFormDirty = false;
      renderEditor();
      if (equipmentEditMode) equipmentId.focus();
    });

    panelLockToggle.addEventListener("click", () => {
      const point = selectedPoint();
      if (!point) return;
      const previous = !!point.locked;
      const previousAuditLogs = [...(state.auditLogs || [])];
      point.locked = !point.locked;
      recordAudit("equipment", point.uid, "anchor", previous ? "fixed" : "free", point.locked ? "fixed" : "free", "update");
      if (!saveState()) {
        point.locked = previous;
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar a ancoragem do device.");
        return;
      }
      render();
    });
    quickLtsCable.addEventListener("click", () => {
      const point = selectedPoint();
      const targetId = quickLtsTarget.value;
      if (!point || !targetId) return;
      createCable(point.uid, targetId, {
        cableId: quickCableId.value.trim(),
        type: quickCableType.value,
        width: quickCableWidth.value,
        fromPort: point.port || "",
        toPort: pointById(targetId)?.port || ""
      });
    });
    addProcess.addEventListener("click", () => {
      const point = selectedPoint();
      const names = processListFromValue(processNameInput.value);
      if (!point || !names.length) return;
      if (!confirm("Vincular uma operação a este equipamento?")) return;
      const previousProcesses = [...(state.processes || [])];
      const previousProcessNodes = JSON.parse(JSON.stringify(state.processNodes || []));
      const previousPointProcesses = pointProcesses(point);
      const previousPointProcessText = point.process;
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousFilter = selectedProcessFilter;
      const previousInputValue = processNameInput.value;
      names.forEach((name, index) => {
        const existed = !!processNodeByName(name);
        upsertProcessNode(
          name,
          Math.max(0, Math.min(100, point.x - 3 + index * 3)),
          Math.max(0, Math.min(100, point.y - 3 + index * 3))
        );
        if (!existed) recordAudit("operation", name, "operation", "", state.activeMapId, "create");
      });
      point.processes = [...new Set([...pointProcesses(point), ...names])].sort();
      point.process = point.processes.join(", ");
      recordAudit("equipment", point.uid, "operation", "", names.join(", "), "update");
      processNameInput.value = "";
      if (!saveState()) {
        state.processes = previousProcesses;
        state.processNodes = previousProcessNodes;
        point.processes = previousPointProcesses;
        point.process = previousPointProcessText;
        state.auditLogs = previousAuditLogs;
        selectedProcessFilter = previousFilter;
        processNameInput.value = previousInputValue;
        alert("Não foi possível salvar o vínculo da operação.");
        return;
      }
      renderEditor();
      renderMap();
      renderList();
      renderCableList();
      renderProcessList();
    });

    processNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addProcess.click();
      }
    });

    [equipmentId, equipmentName, equipmentCriticality, equipmentStatus, equipmentCountry, equipmentPlant, equipmentArea, equipmentLine, equipmentStation, equipmentIp, equipmentModel, equipmentSerial, equipmentMac, equipmentVlan, equipmentHostname, equipmentVendor, equipmentOwner, equipmentTicket, equipmentRack, equipmentPort, markerColor, markerShape, markerLabelMode, equipmentInfo, validationFound, validationHostname, validationIp, validationMac, validationSerial, validationPort, validationPhoto, validationResponsible, validationDeploymentReady, validationStatus, lastValidationDate, validatedBy].forEach((input) => {
      input.addEventListener("input", markEquipmentDirty);
      input.addEventListener("change", markEquipmentDirty);
    });

    cableEditor.addEventListener("submit", (event) => {
      event.preventDefault();
      updateSelectedCableFromForm();
    });

    [cableId, cableFrom, cableTo, cableFromPort, cableToPort, cableType, cableStatus, cableColor, cableWidth, cableVlan, cableRack, cableNotes].forEach((input) => {
      input.addEventListener("input", markCableDirty);
      input.addEventListener("change", markCableDirty);
    });

    showPoints.addEventListener("click", () => setActiveTab("points"));
    showCables.addEventListener("click", () => setActiveTab("cables"));
    showProcesses.addEventListener("click", () => setActiveTab("processes"));
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest(".focus-options, .session-menu")) closeContextMenus();
    }, true);
    document.querySelectorAll(".focus-options, .session-menu, .focus-options-content details").forEach(menu => {
      menu.addEventListener("toggle", () => { if (menu.open) closeContextMenus(menu); });
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (mapCreateMode === "device") { if (cancelEquipmentPlacement()) event.preventDefault(); return; }
      const suggestions = document.getElementById("equipmentSearchResults");
      if (suggestions && !suggestions.hidden) { equipmentSearchResultsOpen = false; suggestions.hidden = true; event.preventDefault(); return; }
      if (equipmentEditMode) { if (closeEquipmentEditing()) event.preventDefault(); }
      else if (!document.getElementById("focusEquipmentDrawer").hidden) { if (toggleEquipmentList(false)) event.preventDefault(); }
      else if (selectedId) { if (closeEquipmentEditor()) event.preventDefault(); }
    });
    sidebarHome.addEventListener("click", () => equipmentEditMode ? closeEquipmentEditing() : closeEquipmentEditor());
    document.getElementById("summaryCloseEquipment").addEventListener("click", closeEquipmentEditor);
    document.getElementById("summaryEditEquipment").addEventListener("click", startEquipmentEditing);
    document.getElementById("summaryLocateEquipment").addEventListener("click", locateSelectedEquipment);
    document.getElementById("openEquipmentList").addEventListener("click", () => toggleEquipmentList(document.getElementById("focusEquipmentDrawer").hidden));
    document.getElementById("contextPanelBackdrop").addEventListener("click", () => setNavigationSection(navigationSection, false));
    document.getElementById("closeEquipmentList").addEventListener("click", () => setNavigationSection(navigationSection, false));
    document.getElementById("navigateMap").addEventListener("click", () => setNavigationSection("map", !(navigationSection === "map" && contextPanelOpen)));
    document.getElementById("navigateOperations").addEventListener("click", () => setNavigationSection("operations", !(navigationSection === "operations" && contextPanelOpen)));
    document.getElementById("contextOperationSearch").addEventListener("input", event => { contextOperationSearchTerm = event.target.value; renderContextOperations(); });
    document.getElementById("focusEquipmentList").append(equipmentList);
    document.getElementById("manageOperations").addEventListener("click", () => {
      if (!confirmDiscardPendingChanges()) return;
      showOperationLayer = true;
      showEquipmentLayer = false;
      mapCreateMode = "browse";
      selectedId = null; selectedCableId = null; equipmentEditMode = false; equipmentFormDirty = false; cableFormDirty = false;
      setInspectorCollapsed(false);
      activeTab = "processes";
      render();
    });
    document.getElementById("toggleOperationLayer").addEventListener("click", () => {
      if (!confirmDiscardPendingChanges()) return;
      showOperationLayer = !showOperationLayer;
      showEquipmentLayer = !showOperationLayer;
      mapCreateMode = "browse";
      renderMap(); renderLayerButtons(); renderMapToolButtons(); renderMetrics(); renderOverviewOverview();
    });
    document.getElementById("clearContextOperationFilter").addEventListener("click", () => {
      if (!confirmDiscardPendingChanges()) return;
      selectedProcessFilter = "";
      equipmentFormDirty = false; cableFormDirty = false; equipmentEditMode = false;
      setInspectorCollapsed(true);
      render();
    });
    document.getElementById("operationFilter").addEventListener("change", event => {
      if (!confirmDiscardPendingChanges()) { event.target.value = selectedProcessFilter; return; }
      selectedProcessFilter = event.target.value;
      selectedId = null; selectedCableId = null; equipmentFormDirty = false; cableFormDirty = false; equipmentEditMode = false;
      render();
    });
    createOperation.addEventListener("click", () => setMapCreateMode("process"));

    function refreshOperationFilterResults(nextSearch = operationSearchTerm, nextArea = selectedIndustrialAreaFilter, nextStage = selectedDeploymentStage, nextType = selectedDeviceType) {
      clearTimeout(operationSearchTimer);
      operationSearchTimer = null;
      if (!confirmDiscardPendingChanges()) {
        operationSearch.value = operationSearchTerm;
        document.getElementById("deploymentFilter").value = selectedDeploymentStage;
        document.getElementById("deviceTypeFilter").value = selectedDeviceType;
        return false;
      }
      selectedDeviceType = Object.hasOwn(EQUIPMENT_PRESETS, nextType) ? nextType : "";
      document.getElementById("deviceTypeFilter").value = selectedDeviceType;
      selectedDeploymentStage = ["AS IS", "TO DO"].includes(nextStage) ? nextStage : "";
      document.getElementById("deploymentFilter").value = selectedDeploymentStage;
      operationSearchTerm = nextSearch;
      selectedIndustrialAreaFilter = nextArea;
      operationSearch.value = operationSearchTerm;
      selectedId = null;
      selectedCableId = null;
      equipmentFormDirty = false;
      cableFormDirty = false;
      equipmentEditMode = false;
      activeTab = "points";
      // Filtering changes the map and selection, not the plant selector or inventory totals.
      renderMetrics();
      renderOperationSidebar();
      renderMap();
      renderEditor();
      renderCableEditor();
      renderTabs();
      renderQaReport();
      renderList();
      renderCableList();
      renderProcessList();
      return true;
    }

    operationSearch.addEventListener("focus", () => {
      equipmentSearchResultsOpen = true;
      renderOperationSidebar();
    });
    operationSearch.addEventListener("input", () => {
      equipmentSearchResultsOpen = true;
      clearTimeout(operationSearchTimer);
      const inputValue = operationSearch.value;
      operationSearchTimer = setTimeout(() => {
        operationSearchTimer = null;
        if (refreshOperationFilterResults(inputValue.trim(), selectedIndustrialAreaFilter)) operationSearch.value = inputValue;
      }, 120);
    });

    industrialAreaFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-industrial-area-filter]");
      if (!button) return;
      refreshOperationFilterResults(operationSearch.value.trim(), button.dataset.industrialAreaFilter || "");
      requestAnimationFrame(() => industrialAreaFilters.querySelector('[data-industrial-area-filter="' + selectedIndustrialAreaFilter + '"]')?.focus());
    });

    document.getElementById("deploymentFilter").addEventListener("change", (event) => {
      refreshOperationFilterResults(operationSearch.value.trim(), selectedIndustrialAreaFilter, event.target.value);
    });
    document.getElementById("deviceTypeFilter").addEventListener("change", (event) => {
      refreshOperationFilterResults(operationSearch.value.trim(), selectedIndustrialAreaFilter, selectedDeploymentStage, event.target.value);
    });
    clearOperationFilters.addEventListener("click", () => {
      if (!confirmDiscardPendingChanges()) return;
      selectedProcessFilter = "";
      refreshOperationFilterResults("", "", "", "");
      requestAnimationFrame(() => operationSearch.focus());
    });

    document.getElementById("createEquipmentPrimary").addEventListener("click", () => {
      if (mapCreateMode === "device") { cancelEquipmentPlacement(); return; }
      setMapCreateMode("device");
    });
    addPointHint.addEventListener("click", () => setMapCreateMode("process"));
    addDeviceHint.addEventListener("click", () => setMapCreateMode("device"));
    anchorOperations.addEventListener("click", () => {
      const nodes = state.processNodes || [];
      const nextPinned = !operationsLocked;
      const previousPinned = nodes.map((node) => ({
        pinned: !!node.pinned,
        permanentPinned: !!node.permanentPinned
      }));
      const previousAuditLogs = [...(state.auditLogs || [])];
      operationsLocked = nextPinned;
      storageSet(storageKeyForDocument("interactive-map-generic-v1-operations-locked"), String(operationsLocked));
      nodes.forEach((node) => {
        node.pinned = !!node.permanentPinned || nextPinned;
      });
      recordAudit("operation", state.activeMapId, "all positions", nextPinned ? "free" : "fixed", nextPinned ? "fixed" : "free", "update");
      if (!saveState()) {
        operationsLocked = !nextPinned;
        storageSet(storageKeyForDocument("interactive-map-generic-v1-operations-locked"), String(operationsLocked));
        nodes.forEach((node, index) => {
          node.pinned = previousPinned[index].pinned;
          node.permanentPinned = previousPinned[index].permanentPinned;
        });
        state.auditLogs = previousAuditLogs;
        alert("Não foi possível salvar o modo de ancoragem.");
        return;
      }
      selectionHint.textContent = nextPinned
        ? "Todas as operações estão ancoradas. Novas operações também serão fixadas."
        : "As operações estão livres para reposicionamento; as fixadas permanentemente continuam bloqueadas.";
      render();
    });
    anchorMap.addEventListener("click", () => {
      const previousMapLocked = mapLocked;
      const previousAuditLogs = [...(state.auditLogs || [])];
      mapLocked = !mapLocked;
      storageSet(storageKeyForDocument("interactive-map-generic-v1-map-locked"), String(mapLocked));
      recordAudit("map", state.activeMapId, "anchor", mapLocked ? "free" : "fixed", mapLocked ? "fixed" : "free", "update");
      if (!saveState()) {
        mapLocked = previousMapLocked;
        state.auditLogs = previousAuditLogs;
        storageSet(storageKeyForDocument("interactive-map-generic-v1-map-locked"), String(mapLocked));
        alert("Não foi possível salvar a ancoragem do mapa.");
        return;
      }
      selectionHint.textContent = mapLocked
        ? "Mapa ancorado. O arraste está bloqueado; o zoom continua disponível dentro da imagem."
        : "Mapa livre. Arraste a imagem quando estiver com zoom.";
      renderMapToolButtons();
      applyMapTransform();
    });
    menuAddOperation.addEventListener("click", () => setMapCreateMode("process"));
    menuAddEquipment.addEventListener("click", () => setMapCreateMode("device"));
    menuAddCable.addEventListener("click", () => addCableMode.click());
    menuFitMap.addEventListener("click", () => fitMap.click());
    menuToggleDevices.addEventListener("click", () => toggleEquipmentLayer.click());
    menuToggleCables.addEventListener("click", () => toggleCableLayer.click());

    fitMap.addEventListener("click", () => {
      if (!state.mapImage) return;
      applyMapZoom(1);
    });

    fullscreenMap.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === mapStage.parentElement) {
          await document.exitFullscreen();
        } else {
          await mapStage.parentElement.requestFullscreen();
        }
      } catch (error) {
        selectionHint.textContent = "A tela cheia não está disponível neste navegador.";
      }
    });

    document.addEventListener("fullscreenchange", () => {
      const active = document.fullscreenElement === mapStage.parentElement;
      fullscreenMap.textContent = active ? "Sair da tela cheia" : "Tela cheia";
      fullscreenMap.classList.toggle("active", active);
      requestAnimationFrame(() => applyMapZoom(active ? 1 : mapZoom));
    });

    zoomOut.addEventListener("click", () => {
      applyMapZoom(mapZoom - 0.25);
    });

    zoomIn.addEventListener("click", () => {
      applyMapZoom(mapZoom + 0.25);
    });

    zoomReset.addEventListener("click", () => {
      applyMapZoom(1);
      fitMap.click();
    });

    mapStage.addEventListener("wheel", (event) => {
      if (!event.ctrlKey || !eventIsInsideMapImage(event)) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -0.25 : 0.25;
      applyMapZoom(mapZoom + direction, event);
    }, { passive: false });

    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        applyMapZoom(mapZoom);
      });
    });

    toggleEquipmentLayer.addEventListener("click", () => {
      if (!confirmDiscardPendingChanges()) return;
      showEquipmentLayer = !showEquipmentLayer;
      showOperationLayer = !showEquipmentLayer;
      renderMap();
      renderLayerButtons();
      renderMetrics(); renderOverviewOverview();
    });

    toggleCableLayer.addEventListener("click", () => {
      showCableLayer = !showCableLayer;
      renderMap();
      renderLayerButtons();
    });

    toggleLabelLayer.addEventListener("click", () => {
      showLabelLayer = !showLabelLayer;
      renderMap();
      renderLayerButtons();
    });

    toggleMapTools.addEventListener("click", () => {
      mapTools.classList.toggle("collapsed");
      const collapsed = mapTools.classList.contains("collapsed");
      toggleMapTools.textContent = collapsed ? "›" : "‹";
      toggleMapTools.title = collapsed ? "Expandir ferramentas" : "Recolher ferramentas";
      toggleMapTools.setAttribute("aria-label", toggleMapTools.title);
    });

    resizeHandle.addEventListener("pointerdown", (event) => {
      if (appShell.classList.contains("inspector-collapsed")) return;
      event.preventDefault();
      const currentWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"), 10) || 420;
      inspectorDrag = {
        startX: event.clientX,
        startWidth: currentWidth
      };
      document.addEventListener("pointermove", moveInspector);
      document.addEventListener("pointerup", stopInspectorResize, { once: true });
    });

    toggleInspector.addEventListener("click", () => {
      setInspectorCollapsed(!appShell.classList.contains("inspector-collapsed"));
    });

    addCableMode.addEventListener("click", () => {
      if (state.points.length < 2) {
        alert("Cadastre pelo menos dois equipamentos antes de adicionar um cabo.");
        return;
      }
      cableMode = !cableMode;
      cableStartId = null;
      selectedId = null;
      selectedCableId = null;
      activeTab = "cables";
      selectionHint.textContent = cableMode
        ? "Modo Cabo: selecione o equipamento de origem e depois o destino."
        : "Modo Cabo cancelado.";
      render();
    });

    pointForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!pendingPoint) return;
      const processNames = processListFromValue(newPointProcess.value);

      if (pointDialogMode === "process") {
        const workstream = normalizeWorkstream(newPointWorkstream.value);
        const area = sanitizeText(newPointOperationArea.value, TEXT_LIMITS.short);
        let creationStatus = document.getElementById("newPointOperationStatus");
        if (!creationStatus) { creationStatus = document.createElement("p"); creationStatus.id = "newPointOperationStatus";creationStatus.className = "form-status hidden";creationStatus.setAttribute("role", "alert");newPointProcess.after(creationStatus); }
        if (createProcess(newPointProcess.value, pendingPoint, { workstream, area, deploymentStage: document.getElementById("newPointDeploymentStage").value, onValidationError: message => { setFormStatus(creationStatus, message, true);newPointProcess.focus(); } })) {
          closePointDialog();
        }
        return;
      }

      const linkedProcessNames = pointDialogMode === "device-linked" ? [pendingProcessName] : processNames;
      if (linkedProcessNames.some(name => !processNodeByName(name))) {
        setFormStatus(document.getElementById("newPointOperationStatus"), "Selecione uma operação existente ou deixe em branco.", true);
        newPointProcess.focus();
        return;
      }
      const processName = linkedProcessNames[0] || "";
      const normalizedMac = normalizeMac(newPointMac.value);
      const normalizedVlan = normalizeVlan(newPointVlan.value);
      const pointDetails = {
        deploymentStage: document.getElementById("newPointDeploymentStage").value,
        markerId: sanitizeText(newPointId.value, TEXT_LIMITS.short),
        name: sanitizeText(newPointName.value, TEXT_LIMITS.medium),
        processes: linkedProcessNames,
        type: newPointType.value,
        status: newPointStatus.value,
        criticality: newPointCriticality.value,
        country: newPointCountry.value,
        plant: sanitizeText(newPointPlant.value, TEXT_LIMITS.short),
        area: sanitizeText(newPointArea.value, TEXT_LIMITS.short),
        productionLine: sanitizeText(newPointLine.value, TEXT_LIMITS.short),
        station: sanitizeText(newPointStation.value, TEXT_LIMITS.short),
        info: sanitizeText(newPointInfo.value, TEXT_LIMITS.long),
        ip: newPointHasNetwork.checked ? sanitizeText(newPointIp.value, TEXT_LIMITS.short) : "",
        model: sanitizeText(newPointModel.value, TEXT_LIMITS.short),
        serial: sanitizeText(newPointSerial.value, TEXT_LIMITS.short),
        mac: normalizedMac === null ? sanitizeText(newPointMac.value, TEXT_LIMITS.short) : normalizedMac,
        vlan: normalizedVlan === null ? sanitizeText(newPointVlan.value, TEXT_LIMITS.short) : normalizedVlan,
        hostname: sanitizeText(newPointHostname.value, TEXT_LIMITS.short),
        vendor: sanitizeText(newPointVendor.value, TEXT_LIMITS.short),
        owner: sanitizeText(newPointOwner.value, TEXT_LIMITS.short),
        ticket: sanitizeText(newPointTicket.value, TEXT_LIMITS.short),
        rack: sanitizeText(newPointRack.value, TEXT_LIMITS.short),
        port: (newPointHasNetwork.checked ? sanitizeText(newPointPort.value, TEXT_LIMITS.short) : "") || sanitizeText(newPointPortExtra.value, TEXT_LIMITS.short),
        color: newPointColor.value,
        shape: newPointShape.value,
        labelMode: "id",
        validationStatus: newPointStatus.value === "Online" ? "Active" : "Pending Validation",
        validationChecklist: defaultValidationChecklist()
      };
      const validation = validatePointData(pointDetails, "", {
        ip: newPointHasNetwork.checked ? newPointIp.value : "",
        mac: newPointMac.value,
        vlan: newPointVlan.value
      });
      if (validation.errors.length) {
        alert("Não foi possível criar o equipamento:\n\n" + validation.errors.join("\n"));
        return;
      }
      if (validation.warnings.length && !confirm(validation.warnings.join("\n") + "\n\nCriar o equipamento mesmo assim?")) return;
      if (processName && !confirm("Vincular este equipamento à operação " + processName + "?")) return;
      const createdPoint = createPoint(pendingPoint.x, pendingPoint.y, pointDetails);
      if (!createdPoint) return;
      if (createdPoint && newPointHasNetwork.checked && newPointLtsTarget.value) {
        createCable(createdPoint.uid, newPointLtsTarget.value, {
          type: "Ethernet",
          width: "1",
          fromPort: createdPoint.port || "",
          toPort: pointById(newPointLtsTarget.value)?.port || "",
          confirm: false,
          activeTab: processName ? "processes" : "points",
          focusEditor: false
        });
      }
      closePointDialog();
    });

    newPointHasNetwork.addEventListener("change", updateNewPointNetworkFields);
    cancelPoint.addEventListener("click", closePointDialog);
    pointDialog.addEventListener("cancel", event => { event.preventDefault(); closePointDialog(); });

    photoUpload.addEventListener("change", async () => {
      const point = selectedPoint();
      if (!point) return;
      const photoMapId = state.activeMapId;
      const files = Array.from(photoUpload.files);
      if (!files.length) return;
      showPhotoStatus("Processando " + files.length + " foto(s) antes de salvar…");
      const encoded = [];
      const reportPhotoStatus = (message, isError = false) => {
        if (state.activeMapId === photoMapId && selectedId === point.uid) showPhotoStatus(message, isError);
      };
      try {
        for (let index = 0; index < files.length; index += 1) {
          reportPhotoStatus("Processando foto " + (index + 1) + " de " + files.length + "...");
          await validateImageFile(files[index], { maxBytes: MAX_PHOTO_FILE_BYTES, maxPixels: MAX_IMAGE_PIXELS });
          const compressedPhoto = await imageFileToCompressedDataUrl(files[index]);
          if (!isSafeImageDataUrl(compressedPhoto)) throw new Error("Compressed photo exceeded the safe size limit.");
          encoded.push(compressedPhoto);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (error) {
        reportPhotoStatus("Não foi possível processar uma das imagens. Tente um arquivo JPG ou PNG menor.", true);
        photoUpload.value = "";
        return;
      }
      const targetPoints = state.activeMapId === photoMapId ? state.points : state.maps[photoMapId]?.points;
      const targetPoint = targetPoints?.find((item) => item.uid === point.uid);
      if (!targetPoint) {
        reportPhotoStatus("O equipamento não existe mais. Nenhuma foto foi adicionada.", true);
        photoUpload.value = "";
        return;
      }
      targetPoint.photos.push(...encoded);
      photoUpload.value = "";
      const saved = saveState();
      if (!saved) {
        // Keep the compressed photo in memory as a recoverable fallback. The
        // user must export the HTML before closing/reloading the page.
        memoryOnlyChanges = true;
        reportPhotoStatus("Foto adicionada somente nesta sessão. Clique em “Salvar no servidor” antes de fechar ou recarregar; depois remova fotos antigas para liberar espaço.", true);
        renderPhotos(targetPoint);
        return;
      }
      reportPhotoStatus("Salvas " + encoded.length + " foto(s).");
      renderPhotos(targetPoint);
    });

    deletePoint.addEventListener("click", () => {
      if (!selectedId) return;
      if (!confirm("Excluir este equipamento e todos os cabos conectados a ele?")) return;
      const previousPoints = state.points;
      const previousCables = state.cables;
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousSelectedId = selectedId;
      const deletedPoint = pointById(selectedId);
      const deletedCables = state.cables.filter((cable) => cable.from === selectedId || cable.to === selectedId);
      if (deletedPoint) recordAudit("equipment", deletedPoint.uid, "equipment", deletedPoint.markerId, "", "delete");
      deletedCables.forEach((cable) => recordAudit("cable", cable.uid, "cable", cable.cableId, "", "delete"));
      state.points = state.points.filter((point) => point.uid !== selectedId);
      state.cables = state.cables.filter((cable) => cable.from !== selectedId && cable.to !== selectedId);
      selectedId = null;
      if (!saveState()) {
        state.points = previousPoints;
        state.cables = previousCables;
        state.auditLogs = previousAuditLogs;
        selectedId = previousSelectedId;
        alert("Não foi possível excluir o device.");
        return;
      }
      render();
    });

    deleteCable.addEventListener("click", () => {
      if (!selectedCableId) return;
      if (!confirm("Excluir este cabo?")) return;
      const previousCables = JSON.parse(JSON.stringify(state.cables || []));
      const previousAuditLogs = [...(state.auditLogs || [])];
      const previousSelectedCableId = selectedCableId;
      const deletedCable = cableById(selectedCableId);
      if (deletedCable) recordAudit("cable", deletedCable.uid, "cable", deletedCable.cableId, "", "delete");
      state.cables = state.cables.filter((cable) => cable.uid !== selectedCableId);
      selectedCableId = null;
      if (!saveState()) {
        state.cables = previousCables;
        state.auditLogs = previousAuditLogs;
        selectedCableId = previousSelectedCableId;
        alert("Não foi possível excluir o cabo.");
        return;
      }
      render();
    });

    clearAll?.addEventListener("click", () => {
      if (!confirm("Limpar todos os mapas, devices e históricos locais deste navegador?")) return;
      const previousState = state;
      state = {
        activeMapId: FIRST_MAP_ID,
        auditLogs: [],
        lastUpdated: new Date().toISOString(),
        maps: {},
        mapImage: "",
        points: [],
        cables: [],
        processes: [],
        processNodes: [],
        processLinks: []
      };
      normalizeState();
      selectedId = null;
      selectedCableId = null;
      selectedProcessFilter = "";
      operationSearchTerm = "";
      selectedIndustrialAreaFilter = "";
      mapZoom = 1;
      mapPanX = 0;
      mapPanY = 0;
      Object.keys(DEFAULT_MAPS).forEach((mapId) => {
        ["zoom", "pan-x", "pan-y"].forEach((value) => storageRemove(mapViewStorageKey(mapId, value)));
      });
      if (!saveState()) {
        state = previousState;
        normalizeState();
        scheduleServerSave();
        alert("Não foi possível concluir a limpeza; os dados anteriores foram restaurados.");
        render();
        return;
      }
      selectionHint.textContent = "Dados removidos do estado local deste navegador.";
      render();
    });

    closePhoto.addEventListener("click", () => photoDialog.close());

    openLinkedOperations.addEventListener("click", () => {
      const point = selectedPoint();
      if (!point || !savePendingEditsBeforeAction()) return;
      renderProcessChips(point);
      if (!linkedOperationsDialog.open) linkedOperationsDialog.showModal();
      processNameInput.focus();
    });

    closeLinkedOperations.addEventListener("click", () => linkedOperationsDialog.close());

    linkedOperationsDialog.addEventListener("click", (event) => {
      if (event.target === linkedOperationsDialog) linkedOperationsDialog.close();
    });

    closeOperation.addEventListener("click", () => operationDialog.close());

    operationDialog.addEventListener("click", (event) => {
      if (event.target === operationDialog) operationDialog.close();
    });

    photoDialog.addEventListener("click", (event) => {
      if (event.target === photoDialog) photoDialog.close();
    });

    photoDialog.addEventListener("close", () => largePhoto.removeAttribute("src"));

    exportHtml.addEventListener("click", async () => {
      if (!savePendingEditsBeforeAction()) return;
      await flushServerSave();
    });

    copyEquipmentLink.addEventListener("click", async () => {
      if (!equipmentLink.value) return;
      try {
        await navigator.clipboard.writeText(equipmentLink.value);
        setFormStatus(equipmentFormStatus, "Link do equipamento copiado.", false);
      } catch {
        equipmentLink.select();
        document.execCommand("copy");
        setFormStatus(equipmentFormStatus, "Link do equipamento copiado.", false);
      }
    });

    toggleQaReport.addEventListener("click", () => {
      qaReport.classList.toggle("hidden");
      renderQaReport();
    });

    toggleAuditLog.addEventListener("click", () => {
      auditLogPanel.classList.toggle("hidden");
      toggleAuditLog.setAttribute("aria-expanded", String(!auditLogPanel.classList.contains("hidden")));
      renderAuditLog();
    });

    document.querySelectorAll(".inventory-summary, .inspector-secondary").forEach(panel => {
      panel.addEventListener("toggle", () => {
        if (!panel.open) return;
        renderDashboard();
        renderQaReport();
        renderAuditLog();
        renderTabs();
        renderList();
        renderCableList();
        renderProcessList();
      });
    });

    function applyHashSelection() {
      const params = new URLSearchParams(location.hash.replace(/^#/, ""));
      const equipmentUid = params.get("equipment");
      const cableUid = params.get("cable");
      if (!equipmentUid && !cableUid) return false;
      if (!confirmDiscardPendingChanges()) return false;
      if (equipmentUid && pointById(equipmentUid)) {
        showEquipmentLayer = true;
        showOperationLayer = false;
        selectedId = equipmentUid;
        selectedCableId = null;
        activeTab = "points";
        return true;
      }
      if (cableUid && cableById(cableUid)) {
        selectedCableId = cableUid;
        selectedId = null;
        activeTab = "cables";
        return true;
      }
      const targetMap = Object.entries(state.maps || {}).find(([, map]) =>
        equipmentUid ? (map.points || []).some((point) => point.uid === equipmentUid) : (map.cables || []).some((cable) => cable.uid === cableUid)
      );
      if (!targetMap) return false;
      saveActiveMap();
      state.activeMapId = targetMap[0];
      normalizeState();
      if (equipmentUid) { showEquipmentLayer = true; showOperationLayer = false; }
      selectedId = equipmentUid || null;
      selectedCableId = cableUid || null;
      activeTab = equipmentUid ? "points" : "cables";
      return true;
    }

    let mapFrameResizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(mapFrameResizeTimer);
      mapFrameResizeTimer = setTimeout(() => { renderContextNavigation(); renderEquipmentSummary(); applyMapZoom(mapZoom); }, 80);
    });

    window.addEventListener("hashchange", () => {
      if (applyHashSelection()) {
        equipmentFormDirty = false;
        cableFormDirty = false;
        render();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!memoryOnlyChanges && !equipmentFormDirty && !cableFormDirty) return;
      event.preventDefault();
      event.returnValue = "Há dados mantidos somente nesta sessão. Salve no servidor ou faça um backup antes de sair.";
    });

    document.getElementById("releaseMapMovement").addEventListener("click", () => {
      const previousMapLocked = mapLocked;
      const previousOperationsLocked = operationsLocked;
      const previousPins = state.processNodes.map((node) => node.pinned);
      mapLocked = false;
      operationsLocked = false;
      state.processNodes.forEach((node) => { node.pinned = !!node.permanentPinned; });
      if (!saveState()) {
        mapLocked = previousMapLocked;
        operationsLocked = previousOperationsLocked;
        state.processNodes.forEach((node, index) => { node.pinned = previousPins[index]; });
        alert("Não foi possível liberar o movimento. Tente novamente.");
        return;
      }
      storageSet(storageKeyForDocument("interactive-map-generic-v1-map-locked"), "false");
      storageSet(storageKeyForDocument("interactive-map-generic-v1-operations-locked"), "false");
      renderMap();
      renderMapToolButtons();
      renderProcessList();
      selectionHint.textContent = "Movimento liberado nesta planta. As fixações permanentes foram mantidas.";
    });

    document.getElementById("overviewHome").addEventListener("click", returnToOperationsHome);
    document.getElementById("overviewSearch").addEventListener("click", () => {
      operationSearch.scrollIntoView({ block: "center", behavior: "smooth" });
      operationSearch.focus();
    });
    document.getElementById("overviewHelp").addEventListener("click", () => document.getElementById("overviewHelpDialog").showModal());
    applyHashSelection();
    render();
    saveStatus("Conectado");

    let remotePollInFlight = false;
    function canApplyRemoteState() {
      return !memoryOnlyChanges && !equipmentFormDirty && !cableFormDirty && !savePromise && !saveConflict && !document.hidden && operationSearchTimer === null;
    }
    async function pollRemoteState() {
      if (remotePollInFlight || !canApplyRemoteState()) return;
      remotePollInFlight = true;
      try{
        const revision = await api('/api/revision');
        if (revision.revision <= serverRevision || !canApplyRemoteState()) return;
        const remote = await api('/api/state');
        // An edit or save may have begun during either network request.
        if (remote.revision <= serverRevision || !canApplyRemoteState()) return;
        Object.keys(DEFAULT_MAPS).forEach(id=>delete DEFAULT_MAPS[id]);Object.assign(DEFAULT_MAPS,remote.maps);
        MAP_ORDER.splice(0,MAP_ORDER.length,...Object.keys(DEFAULT_MAPS));state=structuredClone(remote.inventory);serverRevision=remote.revision;
        normalizeState();selectedId=null;selectedCableId=null;render();saveStatus('Atualizado por outro usuário');
      }catch(error){if(error.status===401)document.getElementById('reauthButton').hidden=false;saveStatus(error.status===401?'Sessão expirada. Entre novamente para continuar.':'Sem conexão com o servidor.',true);}
      finally { remotePollInFlight = false; }
    }
    setInterval(pollRemoteState,15000);
})().catch(error=>{
  document.querySelector('.map-ui-shell').hidden=true;document.getElementById('loginPanel').hidden=false;
  document.getElementById('loginStatus').textContent=error.message || 'Não foi possível carregar o painel.';
});
