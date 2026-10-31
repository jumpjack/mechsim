/* =====================================================================
   types/links/geneva/solve.js
   Croce di Malta (link "geneva"): moto intermittente fra manovella con perno e croce
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
/* ---- geneva: stato geometrico corrente ---------------------------------------------------------------------------
   Tutto nel piano perpendicolare agli assi, con i riferimenti correnti (carrier compresi). Ritorna:
     engaged  perno entro R dal centro della croce (dentro una scanalatura)
     phi      angolo (attorno all'asse della croce, da ref a theta=0) della direzione centro croce → perno
     psi      idem per la direzione centro croce → centro manovella
     ratio    dφ/dθ_manovella: rapporto istantaneo tra le velocità relative di croce e manovella (con segno)                 */
function genevaState(gv) {
  const cache = new Map(), f1 = axisFrame(gv.g1.ax, cache), f2 = axisFrame(gv.g2.ax, cache);
  const k1 = V.unit(f1.dir), k2 = V.unit(f2.dir), C1 = f1.O, C2 = f2.O;
  const P = gv.pinAxis ? axisFrame(gv.pinAxis, cache).O : V.add(C1, V.mul(MAT.mulV(f1.R, gv.g1.ax.ref), gv.rPin));
  const flat = v => V.sub(v, V.mul(k2, V.dot(v, k2)));
  const v = flat(V.sub(P, C2)), u = flat(V.sub(C1, C2)), dist = V.len(v);
  const ref0 = gv.g2.ax.carrier ? MAT.mulV(axisFrame(gv.g2.ax.carrier, cache).R, gv.g2.ax.ref) : gv.g2.ax.ref;   // riferimento dell'asse senza il suo theta
  const yv0 = V.cross(k2, ref0);
  const ang = x => Math.atan2(V.dot(yv0, x), V.dot(ref0, x));
  const vel = flat(V.cross(k1, V.sub(P, C1)));                                  // dP/dθ1
  const ratio = dist > 1e-9 ? V.dot(k2, V.cross(v, vel)) / (dist * dist) : 0;
  return { engaged: dist < gv.R * (1 - 1e-12), dist, phi: ang(v), psi: ang(u), ratio };
}

/* Posizione della croce: durante l'ingaggio segue il perno (la scanalatura scelta è quella più vicina all'angolo attuale),
   fuori riposa nella posizione di blocco più vicina (un braccio verso la manovella). Si chiama dopo l'integrazione degli angoli. */
function updateGenevas(M) {
  for (const gv of M.genevas || []) {
    const st = genevaState(gv), ax = gv.g2.ax, pitch = 2 * PI / gv.N;
    const target = st.engaged ? st.phi - gv.slotAngle : st.psi + PI / gv.N - gv.slotAngle;
    ax.theta = target + pitch * Math.round((ax.theta - target) / pitch);
  }
}

const gWrap = x => Math.atan2(Math.sin(x), Math.cos(x));

/* Distanza angolare (lungo il verso della manovella) al prossimo ingresso/uscita del perno dal settore d'ingaggio */
function genevaEdgeDist(gv, alpha, dir) {
  if (!Number.isFinite(gv.thetaLine) || !Number.isFinite(gv.beta)) return Infinity;
  const u = gWrap(alpha - gv.thetaLine), b = gv.beta, eps = 1e-10;
  if (Math.abs(Math.abs(u) - b) <= eps) {
    const entrySide = (u * dir) < 0;
    if (entrySide && gv.engaged) return 2 * b;
    if (!entrySide && !gv.engaged) return 2 * PI - 2 * b;
    return 0;
  }
  let best = Infinity;
  for (const e of [gv.thetaLine - b, gv.thetaLine + b]) {
    let q = dir * gWrap(e - alpha);
    if (q <= 0) q += 2 * PI;
    best = Math.min(best, q);
  }
  return best;
}

// ---- 7c. link geneva (meccanismo Croce di Malta)
/* { "type":"geneva", "driver":<ruota con il perno>, "driven":<croce>, "pinAxis":<asse del perno> | "pinRadius":mm, "slots":N, "slotAxis":<asse> }
   Geneva corretto: raggio del perno r = a·sin(π/N) (a = interasse). Il perno entra nella scanalatura quando la sua distanza dal centro della
   croce scende sotto R = √(a²−r²); lì la velocità della croce è zero, quindi l'ingaggio è continuo. Fuori da quel settore la croce è bloccata.
   Le fasi (quale scanalatura, dove la croce riposa) si ricavano dalla geometria ogni frame (updateGenevas), non dal valore iniziale di theta. */
Registry.link('geneva', {
  collection: 'genevas',
  order: { resolve: 20, constraints: 50, afterIntegrate: 10 },

  validate(l, w, { E, W, axisBy, gearBy }) {
    const dGear = gearBy[l.driver], sGear = gearBy[l.driven];
    if (!dGear) E(`${w}: driver "${l.driver}" non esiste o non è attivo`);
    else if (!sGear) E(`${w}: driven "${l.driven}" non esiste o non è attivo`);
    else if (dGear === sGear) E(`${w}: driver e driven devono essere diversi`);
    if (l.pinAxis && !axisBy[l.pinAxis]) E(`${w}: pinAxis "${l.pinAxis}" non esiste o non è attivo`);
    if (l.slots === undefined) W(`${w}: manca "slots", uso 4 (default)`);
  },

  resolve(M, { ev }) {
  for (const l of activeLinks('geneva')) {
    CTX.where = `link geneva ${l.driver} → ${l.driven}`;
    const g1 = M.gearBy[l.driver], g2 = M.gearBy[l.driven];
    if (!g1) throw new Error(`geneva: driver "${l.driver}" non esiste`);
    if (!g2) throw new Error(`geneva: driven "${l.driven}" non esiste`);
    const k1 = V.unit(g1.ax.dir), k2 = V.unit(g2.ax.dir);
    if (V.len(V.cross(k1, k2)) > 1e-6) throw new Error(`geneva: gli assi di ${g1.ax.id} e ${g2.ax.id} devono essere paralleli`);

const pinAxis = l.pinAxis ? M.axisBy[l.pinAxis] : null;
if (l.pinAxis && !pinAxis) throw new Error(`geneva: pinAxis "${l.pinAxis}" non esiste`);

const N = l.slots || g2.def.slots || 4;
const d = V.len(V.perp(V.sub(g2.ax.O, g1.ax.O), k1));

// Calcolo automatico del raggio del pin se non specificato
let rPin;
if (pinAxis) {
    rPin = V.len(V.perp(V.sub(pinAxis.O, g1.ax.O), k1));
} else if (l.pinRadius !== undefined) {
    rPin = ev(l.pinRadius);
} else {
    rPin = d * Math.sin(PI / N); // Calcolo automatico obbligato
}

if (!(rPin > 1e-6)) throw new Error(`geneva: raggio del perno nullo`);
if (!(rPin < d)) throw new Error(`geneva: il perno deve stare più vicino all'asse della manovella dell'interasse`);

// Imposta i parametri cinematici su entrambi i gear
g2.geneva = { a: +d.toFixed(6), r: +rPin.toFixed(6), N, s0: 0 };
g2.r = Math.sqrt(d * d - rPin * rPin);
g1.geneva = { a: +d.toFixed(6), r: +rPin.toFixed(6), N }; // Parametri per il driver

M.genevas.push({ def: l, g1, g2, pinAxis, rPin, d, R: g2.r, N, slotAngle: 0, initialPinAngle: 0, thetaLine: 0, beta: Math.acos(rPin / d), engaged: false });

    const rho = typeof malteseOutline === 'function' ? malteseOutline(N, d, rPin, 1e-3).rho : NaN;   // malteseOutline: types/gears/maltese/create.js
    step('geneva', `${g1.id} → ${g2.id}: perno a ${rPin.toFixed(3)} mm, interasse ${d.toFixed(3)} mm, ${N} scanalature, ingaggio entro ${g2.r.toFixed(3)} mm dal centro della croce (±${((PI / 2 - PI / N) * 180 / PI).toFixed(1)}° di manovella)${Number.isFinite(rho) ? `; disco di blocco ρ ≈ ${rho.toFixed(2)} mm` : ''}`);
  }
  },

  /* Ingaggiato: s_croce = (dφ/dθ)·s_manovella. Fuori dal settore la croce è bloccata (velocità relativa al suo carrier nulla).
     Sta prima di ruota pilotata, input, hold e rest: è un accoppiamento meccanico, deve battere un "input" a 0 giri/min sulla manovella. */
  constraints(M, push, { unit }) {
    for (const gv of M.genevas) {
      const st = genevaState(gv);
      const rel = a => { const r = unit(a.idx); if (a.carrier) for (const k in a.carrier.Om) r[k] -= V.dot(a.carrier.Om[k], a.dir); return r; };
      const r1 = rel(gv.g1.ax), r2 = rel(gv.g2.ax);
      if (st.engaged) push('geneva', `geneva ${gv.g1.id} → ${gv.g2.id} (perno nella scanalatura, rapporto ${st.ratio.toFixed(4)})`, r2.map((x, i) => x - st.ratio * r1[i]), 0);
      else push('geneva', `geneva ${gv.g2.id} bloccata (perno fuori dalle scanalature)`, r2, 0, { axisIdx: gv.g2.ax.idx });
    }
  },

  /* Sotto-passi di integrazione: l'ingresso/uscita del perno dal settore è un evento che spezza il passo */
  events(M, s) {
    const out = [];
    for (const gv of M.genevas) {
      const rate = s[gv.g1.ax.idx];
      if (Math.abs(rate) < 1e-12) continue;
      if (!Number.isFinite(gv.initialPinAngle)) continue;
      const alpha = gv.g1.ax.theta + gv.initialPinAngle;
      const dist = genevaEdgeDist(gv, alpha, Math.sign(rate));
      out.push({ te: dist / Math.abs(rate), hit: () => { gv.engaged = !gv.engaged; } });
    }
    return out;
  },

  // riallineamento esatto della croce alla geometria (dopo l'integrazione e dopo ogni ricostruzione)
  afterIntegrate: M => updateGenevas(M),
  settle: M => updateGenevas(M)
});
