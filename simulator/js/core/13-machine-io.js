/* =====================================================================
   core/13-machine-io.js
   Caricamento della macchina da file (JSON o file macchina), applyMachine
   ===================================================================== */
/* =====================================================================
   7b. CARICAMENTO DELLA MACCHINA DA FILE
   ===================================================================== */
/* Il file può essere JSON puro oppure il file della macchina com'è: "var MACHINE = { ... };" con commenti di riga e di blocco e virgole finali.
   Commenti, virgole finali e il "var MACHINE =" vengono sostituiti da spazi, così le posizioni degli errori restano quelle del file.
   Il testo non viene mai eseguito: è solo JSON.parse (e le espressioni nelle stringhe le valuta il parser interno, non eval). */
function cleanMachineText(src) {
  const n = src.length, out = src.split('');
  const skipString = i => {                     // i punta all'apice di apertura; ritorna l'indice dopo quello di chiusura
    const q = src[i]; i++;
    while (i < n && src[i] !== q && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
    return i + 1;
  };
  for (let i = 0; i < n;) {                      // 1) commenti
    const c = src[i];
    if (c === "'") { const b = src.slice(0, i); throw new Error(`apice singolo alla riga ${b.split('\n').length}, colonna ${i - b.lastIndexOf('\n')}: in JSON le stringhe vogliono i doppi apici`); }
    if (c === '"') i = skipString(i);
    else if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') out[i++] = ' '; }
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2), stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
    } else i++;
  }
  const t = out.join('');
  for (let i = 0; i < n;) {                      // 2) virgole finali (prima di ] o })
    const c = t[i];
    if (c === '"' || c === "'") i = skipString(i);
    else {
      if (c === ',') { let k = i + 1; while (k < n && /\s/.test(t[k])) k++; if (t[k] === ']' || t[k] === '}') out[i] = ' '; }
      i++;
    }
  }
  let text = out.join('');
  const first = text.indexOf('{'), last = text.lastIndexOf('}');   // 3) "var MACHINE =" davanti e ";" dietro
  if (first < 0 || last < first) throw new Error('nel file non c\'è nessun oggetto { … }');
  const blank = x => x.replace(/[^\n]/g, ' '), head = text.slice(0, first), tail = text.slice(last + 1);
  if (head.trim() && !/^\s*(?:(?:var|let|const)\s+)?(?:(?:window|globalThis)\.)?MACHINE\s*=\s*$/.test(head)) throw new Error(`prima dell'oggetto c'è del testo che non è "var MACHINE =": «${head.trim().slice(0, 40)}»`);
  if (tail.replace(/[;\s]/g, '')) throw new Error(`dopo l'oggetto c'è altro testo: «${tail.trim().slice(0, 40)}»`);
  return blank(head) + text.slice(first, last + 1) + blank(tail);
}

function parseMachineText(raw) {
  const text = cleanMachineText(raw.replace(/^\uFEFF/, ' '));
  try { return JSON.parse(text); }
  catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const pos = +m[1], before = text.slice(0, pos), line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
      where = ` (riga ${line}, colonna ${col}: «${(raw.split('\n')[line - 1] || '').trim().slice(0, 70)}»)`;
    }
    throw new Error('JSON non valido: ' + e.message.replace(/ in JSON at position \d+.*$/, '') + where);
  }
}

/* Completa i campi che il motore dà per scontati e controlla i tipi di base; il resto lo controlla validateMachine(). */
function normalizeMachine(m) {
  if (m && typeof m === 'object' && !Array.isArray(m) && !m.axes && m.MACHINE && typeof m.MACHINE === 'object') m = m.MACHINE;   // accetta anche { "MACHINE": {...} }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('il file non contiene un oggetto macchina');
  const out = { title: 'Macchina caricata', show: [], variants: {}, controls: [], consts: {}, axes: [], gears: [], links: [], inputs: [], groups: [], views: [], checks: [], ratios: [], notes: [], ...m };
  for (const k of ['show', 'controls', 'axes', 'gears', 'links', 'inputs', 'groups', 'views', 'checks', 'ratios', 'notes']) if (!Array.isArray(out[k])) throw new Error(`"${k}" deve essere un array`);
  for (const k of ['variants', 'consts']) if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) throw new Error(`"${k}" deve essere un oggetto`);
  if (!out.axes.length) throw new Error('"axes" è vuoto: la macchina non ha assi');
  if (!out.views.length) out.views = [{ id: 'all', label: 'Insieme', auto: true, alpha: 'pi/2-0.7', beta: 1.1, scale: 1.1 }];
  out.title = String(out.title);
  return out;
}

/* Inquadra il modello e ridisegna gli assi X/Y/Z (usata all'avvio e dopo ogni caricamento). */
function fitCameraToModel() {
  const b = modelBounds(), diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  if (!Number.isFinite(diag) || diag <= 0 || diag > 1e7) throw new Error(`Dimensioni del modello non valide (diagonale = ${diag}): controlla i messaggi [mesh]/[verifica]/[ingombro] qui sopra`);
  camera.upperRadiusLimit = diag * 5; camera.maxZ = diag * 20;
  engine.resize();
  goView(MACHINE.views[0]);
  drawAxes(.4 * diag);
  return diag;
}

/* Sostituisce la macchina corrente con `data` (oggetto già letto). Se qualcosa fallisce, rimette la macchina precedente e rilancia l'errore. */
async function applyMachine(data) {
  const next = normalizeMachine(data);
  await Registry.loadFor(next);      // carica i file dei tipi che la nuova macchina usa e che non sono ancora presenti (types/...)
  const old = { machine: MACHINE, state: { ...state }, M };
  try {
    MACHINE = next;
    initStateFromMachine();
    buildStaticPanel();
    rebuild(true, true);
    buildPanel();
    afterRebuild();
    fitCameraToModel();
  } catch (e) {
    MACHINE = old.machine; Object.assign(state, old.state);
    try {
      buildStaticPanel();
      if (M !== old.M) rebuild(true, true);       // il nuovo modello era già stato costruito: si ricostruisce il vecchio
      buildPanel(); afterRebuild();
    } catch (e2) { console.error('[caricamento] impossibile ripristinare la macchina precedente', e2); }
    throw e;
  }
}

function setMachineMsg(text, isError) {
  const m = $('machineMsg'); if (!m) return;
  m.textContent = text; m.style.color = isError ? 'var(--bad)' : 'var(--muted)';
}

async function loadMachineFile(file) {
  setMachineMsg(`Caricamento di «${file.name}»…`);
  try {
    if (file.size > 8e6) throw new Error(`file troppo grande (${(file.size / 1e6).toFixed(1)} MB)`);
    await applyMachine(parseMachineText(await file.text()));
    setMachineMsg(`Caricata «${file.name}»: ${MACHINE.axes.length} assi, ${MACHINE.gears.length} ingranaggi, ${MACHINE.links.length} link.`);
  } catch (e) {
    console.error('[caricamento]', e);
    setMachineMsg(`«${file.name}» non caricato: ${e.message}. La macchina precedente è rimasta attiva (dettagli nel pannello errori / console).`, true);
  }
}

function setupMachineLoader() {
  if (!$('machineLoader')) {                   // se la pagina non ha già i controlli, li crea sotto il titolo
    const box = el('div', { id: 'machineLoader' },
      el('button', { type: 'button', id: 'loadMachineBtn', className: 'sidereal-button', textContent: 'Carica macchina da file…', title: 'Sostituisce la macchina precaricata con quella di un file .json o .js (anche trascinandolo sulla pagina).' }),
      el('button', { type: 'button', id: 'resetMachineBtn', className: 'sidereal-button', textContent: 'Macchina predefinita', title: 'Ricarica la macchina con cui si è aperta la pagina.' }),
      el('input', { type: 'file', id: 'machineFile', accept: '.json,.js,.txt,application/json,text/plain', hidden: true }),
      el('div', { id: 'machineMsg', className: 'small' }));
    box.querySelector('#machineMsg').setAttribute('aria-live', 'polite');
    $('title').insertAdjacentElement('afterend', box);
  }
  const input = $('machineFile');
  $('loadMachineBtn').onclick = () => input.click();
  input.onchange = () => { const f = input.files[0]; input.value = ''; if (f) loadMachineFile(f); };
  $('resetMachineBtn').onclick = async () => {
    try { await applyMachine(JSON.parse(JSON.stringify(DEFAULT_MACHINE))); setMachineMsg('Macchina predefinita ripristinata.'); }
    catch (e) { console.error('[caricamento]', e); setMachineMsg(`Macchina predefinita non ripristinata: ${e.message}`, true); }
  };
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer.files[0]) loadMachineFile(e.dataTransfer.files[0]); });
}
