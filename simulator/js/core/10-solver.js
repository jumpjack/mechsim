/* =====================================================================
   core/10-solver.js
   Solutore cinematico: sistema lineare dei vincoli, velocità degli assi, tabella e spiegazione
   ===================================================================== */
/* =====================================================================
   4. CINEMATICA
   ===================================================================== */
function makeSystem(n) {
  const rows = [];
  return {
    lastIndependent: false,
    add(c, b) {
      this.lastIndependent = false;
      c = c.slice();
      const s = Math.max(...c.map(Math.abs)) || 1; for (let j = 0; j < n; j++) c[j] /= s; b /= s;
      for (const r of rows) { const f = c[r.p]; if (Math.abs(f) > 1e-12) { for (let j = 0; j < n; j++) c[j] -= f * r.c[j]; b -= f * r.b; } }
      let p = -1, best = 1e-9;
      for (let j = 0; j < n; j++) if (Math.abs(c[j]) > best) { best = Math.abs(c[j]); p = j; }
      if (p < 0) return Math.abs(b) < 1e-7;
      const d = c[p]; for (let j = 0; j < n; j++) c[j] /= d; b /= d;
      for (const r of rows) { const f = r.c[p]; if (Math.abs(f) > 1e-12) { for (let j = 0; j < n; j++) r.c[j] -= f * c[j]; r.b -= f * b; } }
      rows.push({ p, c, b }); this.lastIndependent = true; return true;
    },
    solve() { const w = new Array(n).fill(0); for (const r of rows) w[r.p] = r.b; return w; },
    rows: () => rows
  };
}
const inputOmega = (ax, st) => ax.cw * st.rpm * PI / 30;

/* Elenco ordinato dei vincoli: i primi hanno la precedenza (quelli dopo, se incompatibili, vengono scartati).
   Le equazioni le forniscono i link (fase "constraints", types/links/<tipo>/solve.js) e i pezzi del nucleo qui sotto,
   fusi per "order": brake 10, presa 20, hooke 30, nottolino 40, geneva 50, pin_slot 60, ruota pilotata 70, driver 80, input 90, hold 100, rest 110. */
function buildConstraints(M, locked) {
  const n = M.axes.length, unit = i => { const r = new Array(n).fill(0); r[i] = 1; return r; };
  const L = [], push = (kind, label, row, b, extra = {}) => L.push({ kind, label, row, b, ...extra });
  Registry.run('constraints', M, push, { n, unit, locked });
  return L;
}

Registry.hook('constraints', 20, (M, push) => {
  for (const m of M.meshes) push('presa', `ingranamento ${m.g.id} ⇄ ${m.p.id}`, m.row, 0);
}, 'presa');

Registry.hook('constraints', 70, (M, push, { unit }) => {
  // data-driven: tutti i gear che dichiarano independentTuning
  for (const gear of getTunableGears(M)) {
    const st = state.wheelInputs[gear.id];
    if (!st) continue;
    push('wheelInput',
      `velocità indipendente ${getIndependentTuning(gear)} [${gear.id}] (asse ${gear.ax.id})`,
      unit(gear.ax.idx),
      gear.ax.cw * st.rpm * PI / 30,
      { axisIdx: gear.ax.idx }
    );
  }
}, 'wheelInput');

Registry.hook('constraints', 80, (M, push, { unit }) => {
  const dg = state.driver && M.gearBy[state.driver.gear];
  if (dg) push('driver', `ruota pilotata ${dg.id} (asse ${dg.ax.id})`, unit(dg.ax.idx), state.driver.w, { axisIdx: dg.ax.idx });
}, 'driver');

Registry.hook('constraints', 90, (M, push, { unit }) => {
  for (const inp of M.inputs) push('input', `input \"${inp.id}\" (asse ${M.axes[inp.idx].id})`, unit(inp.idx), inputOmega(M.axes[inp.idx], state.inputs[inp.id]), { axisIdx: inp.idx });
}, 'input');

Registry.hook('constraints', 100, (M, push, { unit }) => {
  for (const a of M.axes) if (a.def.hold) push('hold', `asse ${a.id} fermo (\"hold\")`, unit(a.idx), 0, { axisIdx: a.idx });
}, 'hold');

Registry.hook('constraints', 110, (M, push) => {
  for (const a of M.axes) if (a.soft) push('rest', a.def.rest === 'world' ? `${a.id} a riposo nel mondo` : `${a.id} a riposo, solidale a ${a.carrier.id}`, a.soft, 0, { axisIdx: a.idx });
}, 'rest');

/* Risolve in ordine; bvals (opzionale) sostituisce i termini noti: serve a calcolare il contributo di ogni ingresso. */
function solveConstraints(M, L, bvals) {
  const sys = makeSystem(M.axes.length);
  L.forEach((c, i) => {
    const ok = sys.add(c.row, bvals ? bvals[i] : c.b);
    c.independent = sys.lastIndependent;
    if (!bvals) c.conflict = !ok;
  });
  return { w: sys.solve(), sys };
}


function solveSpeeds(M) {
  const locked = new Set();
  let L = buildConstraints(M, locked), r = solveConstraints(M, L), w = r.w;
  const limit = Registry.sum('lockable', M);                  // quanti vincoli unilaterali (nottolini) possono bloccarsi
  for (let i = 0; i <= limit; i++) {
    let changed = false;
    for (const e of Registry.entries('lock')) if (e.fn(M, w, locked)) changed = true;
    if (!changed) break;
    L = buildConstraints(M, locked); r = solveConstraints(M, L); w = r.w;
  }
  for (const c of L) if (c.conflict && ['freno', 'driver', 'wheelInput', 'input', 'hold'].includes(c.kind)) warn('cinematica', `vincoli in conflitto: ${c.label} contraddice gli altri vincoli`);
  return { w, locked, cons: L, sys: r.sys };
}

function relationCoeffs(M, outId, insIds) {
  if (!M.axisBy[outId]) throw new Error(`asse di uscita "${outId}" non esiste o non è attivo`);
  return insIds.map((_, k) => {
    const n = M.axes.length, sys = makeSystem(n);
    for (const m of M.meshes) sys.add(m.row, 0);
    insIds.forEach((id, j) => {
      if (!M.axisBy[id]) throw new Error(`asse di ingresso "${id}" non esiste o non è attivo`);
      const r = new Array(n).fill(0); r[M.axisBy[id].idx] = 1; sys.add(r, j === k ? 1 : 0);
    });
    return sys.solve()[M.axisBy[outId].idx];
  });
}

/* ---------- velocità di una ruota rispetto a mondo e a tutti i parent ---------- */
const axName = a => a.id.replace(/^axis_/, '');
const rpmOfW = (a, v) => v * a.cw * 30 / PI;
const fmtRpm = v => { const x = Math.abs(v); return x < 1e-6 ? '0' : (v > 0 ? '↻ ' : '↺ ') + fmt(x, x < 10 ? 4 : x < 1000 ? 2 : 0); };
const chainOf = a => { const o = []; for (let x = a.carrier; x; x = x.carrier) o.push(x); return o; };   // antenati stretti
function commonFrame(a, b) { const cb = new Set(chainOf(b)); for (const x of chainOf(a)) if (cb.has(x)) return x; return null; }   // null = mondo

/* rotazione del corpo di a rispetto al corpo ref (null = mondo): componente lungo l'asse di a e parte ortogonale */
function relToFrame(a, ref, w) {
  const rel = V.sub(omegaOf(a, w), ref ? omegaOf(ref, w) : [0, 0, 0]), raw = V.dot(rel, a.dir);
  return { raw, along: rpmOfW(a, raw), perp: V.len(V.sub(rel, V.mul(a.dir, raw))) * 30 / PI };
}

   function velocityLines(a, w) {
     const out = [{ ref: null, label: 'mondo', ...relToFrame(a, null, w) }], seen = new Set();
     for (const c of chainOf(a)) { seen.add(c); out.push({ ref: c, label: 'vs ' + axName(c), ...relToFrame(a, c, w) }); }
     for (const id of a.def.compare || []) { const c = M.axisBy[id]; if (c && c !== a && !seen.has(c)) out.push({ ref: c, label: 'vs ' + axName(c) + ' (confronto)', ...relToFrame(a, c, w) }); }
     return out;
   }

/* ---------- colonna della tabella ---------- */
function updateTable(w, cons) {
  const direct = {};
  for (const c of cons) if (c.axisIdx !== undefined && c.independent && !direct[c.axisIdx]) direct[c.axisIdx] = c.kind;
  const kindText = { driver: 'imposta (ruota pilotata)', input: 'imposta (input)', hold: 'imposta (hold: ferma)', freno: 'imposta (freno: ferma)', rest: 'a riposo: solidale al carrier' };
  for (const g of M.gears) {
    const row = rowOf[g.id];
    if (!row || row.cells.length < 6) continue;
    let markRef = null, markText = '';
    const k = direct[g.ax.idx];
       if (k) { const rc = k === 'rest' && g.ax.def.rest === 'carrier'; markRef = (rc || (k === 'driver' && g.ax.carrier)) ? g.ax.carrier : null; markText = k === 'rest' ? (rc ? kindText.rest : 'a riposo nel mondo') : kindText[k]; }
    else {
      const src = g.meshInfo ? g : M.gears.find(x => x.ax === g.ax && x.meshInfo);
      if (src) { markRef = src.meshInfo.frame; markText = `rapporto denti con ${src.meshInfo.partner.id}` + (src === g ? '' : ` (via ${src.id}, stesso asse)`); }
    }
    row.cells[5].innerHTML = velocityLines(g.ax, w).map(l => {
      const mk = markText && l.ref === markRef;
      return `<div class="${mk ? 'mk' : ''}">${esc(l.label)}: ${fmtRpm(l.along)}` +
             (l.perp > 1e-6 ? ` <span style="color:var(--bad)">(+⟂ ${fmt(l.perp, 3)})</span>` : '') + (mk ? ' ◀ ' + esc(markText) : '') + '</div>';
    }).join('');
  }
}

/* ---------- spiegazione in console ---------- */
const EXPL = { timer: null };
function explainSoon() { clearTimeout(EXPL.timer); EXPL.timer = setTimeout(explainSpeeds, 150); }

function explainSpeeds() {
  if (!M) return;
  const { w, cons, sys } = solveSpeeds(M);
  updateShowSpeeds();
  const rows = sys.rows(), pivot = new Map(rows.map(r => [r.p, r]));
  const free = M.axes.filter(a => !pivot.has(a.idx) && !a.aimed);
  const L = (...a) => console.log(...a);
  // contributo di ogni ingresso imposto (velocità ≠ 0): il sistema è lineare, quindi w = somma dei contributi
  const contrib = [];
  cons.forEach((c, i) => {
    if (c.b !== 0 && (c.kind === 'driver' || c.kind === 'input')) {
      const bv = cons.map(() => 0); bv[i] = c.b;
      contrib.push({ c, w: solveConstraints(M, cons, bv).w });
    }
  });
  const why = a => {
    const i = a.idx;
    const dir = cons.find(c => c.axisIdx === i && c.independent && c.kind !== 'rest');
    if (dir) return `imposta direttamente: ${dir.label}`;
    const r = pivot.get(i);
    if (!r) return '⚠ GRADO DI LIBERTÀ LIBERO: nessun vincolo la determina, quindi la velocità assoluta è posta a 0';
    const parts = contrib.filter(k => Math.abs(k.w[i]) > 1e-12).map(k => `${k.c.label}: ${fmtRpm(rpmOfW(a, k.w[i]))}`);
    let s = 'ricavata dai vincoli (ingranamenti, ecc.) — ' + (parts.length ? `contributi: ${parts.join(' + ')}` : 'nessun ingresso imposto la muove');
    const fr = free.filter(f => Math.abs(r.c[f.idx]) > 1e-9);
    if (fr.length) s += ` — ⚠ dipende da assi liberi posti a 0: ${fr.map(f => `${f.id} (coeff ${(-r.c[f.idx]).toFixed(3)})`).join(', ')}`; // `
    const rest = cons.find(c => c.axisIdx === i && c.kind === 'rest' && c.independent);
    if (rest) s += ` — fissata per default: ${rest.label}`;
    return s;
  };

  console.groupCollapsed('%c[velocità]%c come si ottiene la velocità di ogni ruota (clic per aprire)', 'color:#d9b45a;font-weight:bold', 'color:inherit');
  L('Vincoli attivi, nell\'ordine in cui vengono applicati (i primi hanno la precedenza):');
  cons.forEach((c, i) => {
    const ax = c.axisIdx !== undefined ? M.axes[c.axisIdx] : null;
    L(`  ${i + 1}. [${c.kind}] ${c.label}` + (ax && c.b !== 0 ? ` = ${fmtRpm(rpmOfW(ax, c.b))} giri/min` : '') +
      (c.independent ? '' : '  → già implicito nei precedenti (nessun effetto)') + (c.conflict ? '  ⚠ IN CONFLITTO con i precedenti' : ''));
  });
  L(free.length ? `⚠ Assi non determinati da nessun vincolo (velocità assoluta posta a 0): ${free.map(a => a.id).join(', ')}. Se uno di questi dovrebbe muoversi, manca un vincolo o un "rest".`
                : 'Tutti gli assi sono determinati dai vincoli.'); // `
  for (const g of M.gears) {
    const a = g.ax, vl = velocityLines(a, w);
    L(`%c${g.id}%c "${g.def.name}" · ${g.type}, z=${g.z}, su ${a.id}` + (a.carrier ? ` (portato da ${chainOf(a).map(c => c.id).join(' → ')})` : ' (asse senza carrier: fisso nel mondo)'),
      'color:#d9b45a;font-weight:bold', 'color:inherit');
    L('    velocità lungo l\'asse: ' + vl.map(l => `${l.label} ${fmtRpm(l.along)}` + (l.perp > 1e-6 ? ` [+⟂ ${fmt(l.perp, 3)}]` : '')).join(' · '));
    L('    asse: ' + why(a));
    if (g.meshInfo) {
      const p = g.meshInfo.partner, f = g.meshInfo.frame, fn = f ? axName(f) : 'mondo';
      const m = M.meshes.find(x => (x.g === g && x.p === p) || (x.g === p && x.p === g));
      const res = m ? m.row.reduce((s, c, k) => s + c * w[k], 0) : NaN;
      L(`    ingranamento con ${p.id} (z ${g.z}:${p.z}): le due velocità sono legate dal rapporto denti, misurate RISPETTO A «${fn}» (il corpo che porta entrambi gli assi). Residuo dell'equazione di presa: ${res.toExponential(2)}`);
      if ((g.ax.carrier || null) === f && (p.ax.carrier || null) === f) {
        const sg = relToFrame(g.ax, f, w), sp = relToFrame(p.ax, f, w), exp = p.z / g.z;
        const got = Math.abs(sp.raw) > 1e-12 ? Math.abs(sg.raw / sp.raw) : null;
        const ok = got === null ? Math.abs(sg.raw) < 1e-12 : Math.abs(got - exp) < 1e-6 * Math.max(1, exp);
        L(`    verifica rispetto a ${fn}: ω_${g.id} = ${fmtRpm(sg.along)}, ω_${p.id} = ${fmtRpm(sp.along)}; |ω_${g.id}/ω_${p.id}| atteso ${p.z}/${g.z} = ${exp.toFixed(5)}, ottenuto ${got === null ? 'n/d (ferme)' : got.toFixed(5)}  ${ok ? '✓' : '✗ ERRORE'}`);
      } else L('    (gli assi non sono portati direttamente dallo stesso corpo: il rapporto va letto sul punto di contatto, vedi il residuo)'); //`
    }
  }
  console.groupEnd();
}
