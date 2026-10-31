/* =====================================================================
   core/05-state.js
   Stato dell'interfaccia, inizializzazione dallo stato della macchina, varianti
   ===================================================================== */
const state = {
  variants: {}, params: {}, ctrl: {}, inputs: {},
  brakes: {}, groups: {}, driver: null, direction: 1, current: null, timeScale: 1,
  wheelInputs: {  }, wheelOffsets: { }
};

function getIndependentTuning(g){ return g?.def?.independentTuning ?? g?.independentTuning; }
function getTunableGears(M){ return (M.gears?? Object.values(M.gearBy)).filter(g => getIndependentTuning(g)); }
function ensureWheelState(M) {
  for (const g of getTunableGears(M)) {
console.log("Azzero input di ", g);
    state.wheelInputs[g.id]??= { rpm: 0 };
    state.wheelOffsets[g.id]??= 0;
  }
  // pulizia se togli independentTuning dal JSON
  for (const id of Object.keys(state.wheelInputs)) {
    if (!getIndependentTuning(M.gearBy[id])) {
      delete state.wheelInputs[id];
      delete state.wheelOffsets[id];
    }
  }

console.log(M);
}



/* Azzera tutto ciò che dipende dalla macchina (varianti, cursori, input, freni, gruppi visibili, ruota pilotata, selezione).
   Non tocca direzione e velocità del tempo. Gli oggetti vecchi vengono sostituiti, non modificati: chi li ha salvati può ripristinarli. */
function initStateFromMachine() {
  state.variants = {}; state.params = {}; state.ctrl = {}; state.inputs = {}; state.brakes = {}; state.groups = {};
  state.wheelInputs = {}; state.wheelOffsets = {}; state.driver = null; state.current = null;
  for (const k in MACHINE.variants) state.variants[k] = MACHINE.variants[k].active;
  for (const c of MACHINE.controls) {
    state.ctrl[c.id] = {};
    for (const v in c.ranges) state.ctrl[c.id][v] = c.ranges[v].value;
  }
  for (const inp of MACHINE.inputs) state.inputs[inp.id] = { rpm: 0 };
  state.keyOffset = 0;
  state.declination = 0;
  for (const g of MACHINE.groups) state.groups[g.id] = g.visible !== false;
  syncParams();
}

function syncParams() {
  for (const c of MACHINE.controls) state.params[c.id] = state.ctrl[c.id][c.variantKey ? state.variants[c.variantKey] : 'all'];
}
initStateFromMachine();

function isActive(el) {
  return !el.variant || Object.keys(el.variant).every(k => state.variants[k] === el.variant[k]);
}

/* id dell'ingranaggio a cui punta un meshWith (stringa oppure {id:...}) */
const meshId = g => g.meshWith && typeof g.meshWith === 'object' ? g.meshWith.id : g.meshWith;

/* Link ATTIVI (nella variante corrente) di un dato tipo: i tipi di link la usano nel loro resolve() */
function activeLinks(type) { return (MACHINE.links || []).filter(l => l.type === type && isActive(l)); }
