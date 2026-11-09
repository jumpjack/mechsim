/* =====================================================================
   types/links/graham_escapement_CS/solve.js
   Scappamento di Graham (dead-beat) fra una ruota di scappamento e un'ancora con pendolo (link "graham_escapement_CS")
   Metà "COME SI RISOLVE" del link: validazione, geometria, fisica dei contatti. Il disegno sta nei gear (escape_wheel_CS, anchor_CS).
   ---------------------------------------------------------------------
   JSON:   { "type": "graham_escapement_CS", "wheel": "<gear escape_wheel_CS>", "anchor": "<gear anchor_CS>" }
   Facoltativi (numeri o espressioni):
     "gravityDir"      direzione della gravità, [x,y,z] (default [0,0,-1]: verso Z−). Il pendolo pende lungo la gravità: l'ancora deve
                       stare SOPRA la ruota (lungo Z) e gli assi di ruota e ancora devono essere orizzontali (es. dir [0,1,0])
     "span"            denti abbracciati dall'ancora (n+½, default 7,5): fissa l'interasse ideale = R / cos(π·span/N)
     "lock"            corsa di blocco prima del rilascio, gradi (0,5)
     "lift"            angolo di impulso dell'ancora, gradi (2,5)
     "impulseFraction" quota di mezzo passo che la ruota avanza durante l'impulso (0,5)
     "arcExtra"        estensione delle facce di riposo oltre l'ampiezza, gradi (8)
     "palletDepth"     spessore delle pallette, mm (0,07·R)
     "damping"         smorzamento del pendolo, 1/s (0,05)
     "motorStiffness"  rigidezza del motore (0,04): coppia = rigidezza · (velocità comandata − velocità della ruota)
     "motorTorqueMax"  coppia massima del motore (0,08): satura l'ampiezza quando lo si accelera troppo
     "wheelInertia"    inerzia della ruota rispetto a quella del pendolo (1e-4)
     "gravity"         intensità, mm/s² (9810)
   Come funziona (niente è "finto"): la ruota è un corpo rigido con la coppia di un motore che vuole farla girare alla velocità
   comandata (clic sulla ruota + slider della velocità). Le punte dei denti non possono entrare nelle pallette; si risolve il
   contatto a ogni passo (impulsi sulla normale delle facce). Riposo, impulso e caduta vengono da soli dalla forma di denti e
   pallette; l'ampiezza del pendolo è un risultato dell'energia ricevuta e dell'attrito; la velocità media della ruota la decide
   il pendolo. Il pendolo parte da solo con una piccola spinta iniziale data dal codice (mai dall'utente).
   Il verso giusto del motore è quello positivo (rotazione positiva attorno all'asse).
   ===================================================================== */

/* Tutto in un unico oggetto per non sporcare lo spazio globale. */
const GrahamCS = (() => {
  const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
  const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

  /* Piano del meccanismo: origine nel centro W della ruota, asse Y verso il perno A dell'ancora, asse X = k × (A→W) (destra);
     la ruota gira in senso antiorario (positivo). Sistema dell'ancora: x' = da A verso W, y' = a destra, angoli antiorari. */
  function geometry(o) {
    const R = o.R, N = o.N, D = o.D, p = TAU / N;
    const gamma = Math.acos(R / D), rho = R * Math.tan(gamma), eps = PI / 2 - gamma;
    const mu = o.lock * DEG, lam = o.lift * DEG, dphi = o.impulseFraction * p / 2, arcExtra = o.arcExtra * DEG, depth = o.palletDepth;
    const TR = [R * Math.sin(gamma), R * Math.cos(gamma)], TL = [-TR[0], TR[1]];                 // punti di riposo: ingresso a destra, uscita a sinistra
    const toAnchor = (q, th) => rot([-(q[1] - D), q[0]], -th);                                    // piano → sistema ancora (ancora ruotata di th)
    const aR = eps, aL = -eps;
    const eE = toAnchor(rot(TR, dphi), mu + lam), eX = toAnchor(rot(TL, dphi), -(mu + lam));      // fine delle facce di impulso
    const arc = (r, a0, a1) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / DEG)), out = []; for (let i = 0; i <= n; i++) out.push(polar(r, a0 + (a1 - a0) * i / n)); return out; };
    const e0 = aR + arcExtra, e1 = aR - mu, x0 = aL - arcExtra, x1 = aL + mu;
    // paletta d'ingresso: materiale DENTRO l'arco di riposo (il dente arriva da fuori); paletta d'uscita: materiale FUORI (il dente arriva da dentro)
    const entry = [...arc(rho, e0, e1), eE, polar(rho - depth, e1), ...arc(rho - depth, e1, e0)];
    const exit = [...arc(rho, x0, x1), eX, polar(rho + depth, x1), ...arc(rho + depth, x1, x0)];
    const area = P => { let s = 0; for (let i = 0; i < P.length; i++) s += cross(P[i], P[(i + 1) % P.length]); return s / 2; };
    const ccw = P => area(P) > 0 ? P : P.slice().reverse();
    return { R, N, D, p, gamma, rho, eps, mu, lam, dphi, arcExtra, depth, aR, aL, entry: ccw(entry), exit: ccw(exit), toAnchor, phi0: PI / 2 - gamma };
  }

  /* Distanza con segno di un punto da un poligono antiorario (positiva fuori) e normale verso l'esterno. */
  function sdPoly(pt, poly) {
    let best = Infinity, bx = 0, by = 0, nx = 0, ny = 0, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
      let t = l2 ? ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const cx = a[0] + t * abx, cy = a[1] + t * aby, dd = Math.hypot(pt[0] - cx, pt[1] - cy);
      if (dd < best) { best = dd; bx = pt[0] - cx; by = pt[1] - cy; const l = Math.sqrt(l2) || 1; nx = aby / l; ny = -abx / l; }
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    const n = best > 1e-9 ? (inside ? [-bx / best, -by / best] : [bx / best, by / best]) : [nx, ny];
    return { d: inside ? -best : best, n };
  }

  /* Un passo di dinamica di durata h: motore sulla ruota, gravità e attrito sul pendolo, contatti punta-dente / paletta. */
  function substep(P, st, h, cmd) {
    const G = P.G, w0sq = P.g / P.L;
    const tq = Math.max(-P.tauMax, Math.min(P.tauMax, P.kappa * (cmd - st.wW)));
    st.wW += tq / P.Iw * h;
    st.wA += (-w0sq * Math.sin(st.thA - P.thEq) - P.damping * st.wA) * h;                        // thEq: angolo d'equilibrio (pendolo lungo la gravità)
    const cons = [];
    for (let k = 0; k < G.N; k++) {
      const ang = G.phi0 + k * G.p + st.thW, tip = [G.R * Math.cos(ang), G.R * Math.sin(ang)];
      if (Math.hypot(tip[0], tip[1] - G.D) > G.rho + G.depth + 4) continue;
      const qa = G.toAnchor(tip, st.thA);
      for (let pi = 0; pi < 2; pi++) {
        const r = sdPoly(qa, pi ? G.exit : G.entry); if (r.d > 0.05) continue;
        const nP = rot([r.n[1], -r.n[0]], st.thA), ra = [tip[0], tip[1] - G.D];
        cons.push({ pal: pi, d: r.d, Jw: cross(tip, nP), Ja: -cross(ra, nP), lam: 0 });
      }
    }
    for (let it = 0; it < 6; it++) for (const c of cons) {
      const kk = c.Jw * c.Jw / P.Iw + c.Ja * c.Ja, vn = c.Jw * st.wW + c.Ja * st.wA;
      let dl = -(vn + c.d / h) / kk; const nl = Math.max(0, c.lam + dl); dl = nl - c.lam; c.lam = nl;
      st.wW += c.Jw * dl / P.Iw; st.wA += c.Ja * dl;
    }
    let hold = 0, holdPal = -1; for (const c of cons) if (c.lam > hold) { hold = c.lam; holdPal = c.pal; }
    st.holding = hold > 0 ? holdPal : -1;
    st.thW += st.wW * h; st.thA += st.wA * h;
  }

  /* Avanza di dt secondi; gestisce anche la spinta iniziale e le statistiche (ampiezza, periodo). */
  function advance(P, st, dt, cmdRaw) {
    const cmd = Math.max(0, cmdRaw), n = Math.min(4000, Math.max(1, Math.ceil(dt / 2e-4))), h = dt / n;
    for (let i = 0; i < n; i++) {
      substep(P, st, h, cmd);
      st.t += h;
      // statistiche: passaggi per zero di theta_a (da negativo a positivo) → periodo; picchi → ampiezza
      st.peak = Math.max(st.peak, Math.abs(st.thA));
      if (st.prevSign <= 0 && st.thA > 0) { if (st.lastZero !== null) st.period = st.t - st.lastZero; st.lastZero = st.t; st.amp = st.peak; st.peak = 0; }
      if (st.thA !== 0) st.prevSign = Math.sign(st.thA);
      // spinta iniziale: ruota ferma contro una paletta, pendolo fermo vicino al centro, motore acceso
      const stalled = cmd > 0.05 && Math.abs(st.wA) < 0.03 && Math.abs(st.thA) < P.stallAngle;
      st.idle = stalled ? st.idle + h : 0;
      if (st.idle > 0.4 && st.t - st.lastKick > 3 && st.holding >= 0) {
        st.wA += (st.holding === 0 ? 1 : -1) * P.kick; st.lastKick = st.t; st.idle = 0; st.kicks++;
      }
    }
  }

  const newState = () => ({ thW: 0, wW: 0, thA: 0, wA: 0, t: 0, holding: -1, idle: 0, lastKick: -10, kicks: 0, peak: 0, amp: 0, period: 0, lastZero: null, prevSign: 0, frameDone: true, lastW: 0, lastA: 0, cmd: 0 });
  const resetStats = st => { st.amp = 0; st.period = 0; st.peak = 0; st.lastZero = null; st.prevSign = 0; st.idle = 0; st.lastKick = -10; st.holding = -1; };
  return { geometry, sdPoly, advance, newState, resetStats, PI, DEG };
})();

/* Stato fisico che sopravvive alle ricostruzioni del modello (slider, varianti), per chiave ruota|ancora. */
const GrahamStore_CS = new Map();

Registry.link('graham_escapement_CS', {
  collection: 'grahams',
  order: { afterIntegrate: 100 },

  validate(l, w, { E, W, axisBy, gearBy, isVec }) {
    const gw = gearBy[l.wheel], ga = gearBy[l.anchor];
    if (!gw) E(`${w}: wheel "${l.wheel}" non esiste o non è attivo`);
    else if ((gw.type || 'spur') !== 'escape_wheel_CS') E(`${w}: wheel "${l.wheel}" deve essere di tipo escape_wheel_CS`);
    if (!ga) E(`${w}: anchor "${l.anchor}" non esiste o non è attivo`);
    else if ((ga.type || 'spur') !== 'anchor_CS') E(`${w}: anchor "${l.anchor}" deve essere di tipo anchor_CS`);
    if (gw && ga) {
      const a1 = axisBy[gw.axis], a2 = axisBy[ga.axis];
      if (a1 && a2 && (a1 === a2 || V.dot(V.unit(a1.dir), V.unit(a2.dir)) < 0.9999)) E(`${w}: gli assi di ruota e ancora devono essere paralleli, distinti e con lo stesso verso`);
    }
    if (l.gravityDir !== undefined && !isVec(l.gravityDir, 3)) E(`${w}: "gravityDir" deve avere 3 elementi [x, y, z]`);
    for (const k of ['span', 'lock', 'lift', 'impulseFraction', 'arcExtra', 'palletDepth', 'damping', 'motorStiffness', 'motorTorqueMax', 'wheelInertia', 'gravity'])
      if (l[k] !== undefined && typeof l[k] !== 'number' && typeof l[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
  },

  resolve(M, { ev, vec }) {
    for (const l of activeLinks('graham_escapement_CS')) {
      CTX.where = `link graham_escapement_CS ${l.wheel} / ${l.anchor}`;
      const gw = M.gearBy[l.wheel], ga = M.gearBy[l.anchor], axW = gw.ax, axA = ga.ax, k = V.unit(axW.dir);
      const num = (v, d) => v !== undefined ? ev(v) : d;
      const R = gw.r, N = gw.z, rel = V.sub(axW.O, axA.O), D = V.len(V.perp(rel, k));
      if (!(R > 0) || !(N >= 8)) throw new Error(`${l.wheel}: servono "r" (raggio delle punte) e almeno 8 "teeth"`);
      if (!(D > R * 1.0001)) throw new Error(`scappamento: l'interasse (${D.toFixed(2)} mm) deve essere maggiore del raggio della ruota (${R} mm)`);
      const span = num(l.span, 7.5), Dideal = R / Math.cos(PI * span / N);
      if (Math.abs(D - Dideal) > 0.01 * Dideal) {
        const teeth = N * Math.acos(R / D) / PI;
        warn('scappamento', `${l.wheel}/${l.anchor}: interasse ${D.toFixed(2)} mm, ma per ${span} denti abbracciati serve ${Dideal.toFixed(2)} mm (con questo interasse l'ancora ne abbraccia ${teeth.toFixed(2)}): le due semi-battute risultano disuguali`);
      }
      const uDown = V.unit(V.perp(rel, k)), vX = V.cross(k, uDown);
      // gravità: il pendolo ha l'equilibrio quando l'asta (lungo A→W) è parallela alla gravità proiettata sul piano del meccanismo
      const gW = V.unit(l.gravityDir !== undefined ? vec(l.gravityDir) : [0, 0, -1]), gp = V.sub(gW, V.mul(k, V.dot(gW, k)));
      if (V.len(gp) < 0.2) throw new Error(`scappamento: la gravità è quasi parallela all'asse della ruota: gli assi devono essere orizzontali (es. dir [0,1,0] se la gravità è verso Z−)`);
      const thEq = Math.atan2(V.dot(vX, gp), V.dot(uDown, gp));
      if (Math.abs(thEq) > PI / 180) warn('scappamento', `${l.wheel}/${l.anchor}: la retta fra i centri non è parallela alla gravità (scarto ${(thEq * 180 / PI).toFixed(1)}°): il pendolo non pende lungo A→W e il meccanismo non è simmetrico. Con gravità verso Z− l'ancora deve stare sopra la ruota (stessa x e y, z maggiore) e gli assi devono essere orizzontali`);
      const epsW = Math.atan2(V.dot(vX, axW.yv), V.dot(vX, axW.ref));               // angolo locale (ruota) dell'asse X del piano
      const deltaA = Math.atan2(V.dot(uDown, axA.yv), V.dot(uDown, axA.ref));       // angolo locale (ancora) della direzione A→W
      const geoOpt = { R, N, D, lock: num(l.lock, 0.5), lift: num(l.lift, 2.5), impulseFraction: num(l.impulseFraction, 0.5), arcExtra: num(l.arcExtra, 8), palletDepth: num(l.palletDepth, 0.07 * R) };
      const G = GrahamCS.geometry(geoOpt);
      const L = ga.pendLen;
      if (!(L > 0)) throw new Error(`${l.anchor}: manca la lunghezza del pendolo ("pendulumLength")`);
      // dati per il disegno dei due gear (angoli locali: piano → locale)
      gw.graham = { N, R, phi0Local: G.phi0 + epsW, epsW };
      ga.graham = { entry: G.entry, exit: G.exit, rho: G.rho, depth: G.depth, arcExtra: G.arcExtra, aR: G.aR, aL: G.aL, deltaA, L, D };
      const P = { G, L, g: num(l.gravity, 9810), thEq, damping: num(l.damping, 0.05), kappa: num(l.motorStiffness, 0.04), tauMax: num(l.motorTorqueMax, 0.08),
                  Iw: num(l.wheelInertia, 1e-4), stallAngle: (G.mu + G.lam) * 0.8 };
      P.kick = Math.sqrt(P.g / L) * (G.mu + G.lam) * 1.8;                           // velocità angolare per superare l'impulso di ~1,8 volte
      const key = `${l.wheel}|${l.anchor}`, prev = GrahamStore_CS.get(key);
      const sig = [R, N, +D.toFixed(4)].join('|');
      let st; if (prev && prev.sig === sig) st = prev.st; else { st = GrahamCS.newState(); GrahamStore_CS.set(key, { sig, st }); st.fresh = true; }
      M.grahams.push({ def: l, gw, ga, axW, axA, iW: axW.idx, iA: axA.idx, P, G, st, key, needSync: true });
      step('scappamento', `Graham ${l.wheel}/${l.anchor}: R=${R} mm, ${N} denti, interasse ${D.toFixed(2)} mm, ρ=${G.rho.toFixed(2)} mm, pendolo ${L} mm (T≈${(2 * PI * Math.sqrt(L / P.g)).toFixed(2)} s), scarto dalla gravità ${(thEq * 180 / PI).toFixed(2)}°`);
    }
  },

  /* A ricostruzione finita: riallinea lo stato fisico agli angoli degli assi (che la ricostruzione conserva). */
  settle(M) {
    for (const gv of M.grahams) if (gv.needSync) {
      const st = gv.st, same = !st.fresh && Math.abs(gv.axW.theta - st.thW) < 1e-6 && Math.abs(gv.axA.theta - st.thA) < 1e-6;
      if (st.fresh) { st.thW = 0; st.thA = 0; st.wW = 0; st.wA = 0; gv.axW.theta = 0; gv.axA.theta = 0; st.fresh = false; GrahamCS.resetStats(st); }
      else if (!same) { st.thW = gv.axW.theta; st.thA = gv.axA.theta; st.wW = 0; st.wA = 0; GrahamCS.resetStats(st); }
      st.lastW = st.thW; st.lastA = st.thA; st.frameDone = true; gv.needSync = false;
    }
  },

  /* All'inizio di ogni frame: velocità comandata alla ruota (il risultato del solutore: clic sulla ruota + slider) e controllo
     di modifiche esterne agli angoli. Non produce eventi. */
  events(M, s, w) {
    for (const gv of M.grahams) {
      const st = gv.st; st.cmd = w[gv.iW];
      if (st.frameDone) {
        st.frameDone = false;
        if (Math.abs(gv.axW.theta - st.lastW) > 1e-9) { st.thW = gv.axW.theta; st.wW = 0; }
        if (Math.abs(gv.axA.theta - st.lastA) > 1e-9) { st.thA = gv.axA.theta; st.wA = 0; }
      }
    }
    return [];
  },

  /* Una volta per frame, dopo l'integrazione degli assi: la dinamica del meccanismo sostituisce gli angoli di ruota e ancora. */
  afterIntegrate(M) {
    const dt = typeof M.dt === 'number' ? M.dt : Math.min(engine.getDeltaTime() / 1000, 0.05) * state.timeScale;     // come nel ciclo di animazione
    for (const gv of M.grahams) {
      const st = gv.st; if (dt > 0) GrahamCS.advance(gv.P, st, dt, st.cmd);
      gv.axW.theta = st.thW; gv.axA.theta = st.thA; st.lastW = st.thW; st.lastA = st.thA; st.frameDone = true;
    }
  },

  linkedAxes: M => M.grahams.flatMap(g => [g.axW, g.axA]),

  status(M) {
    const lines = [];
    for (const gv of M.grahams) {
      const st = gv.st, deg = x => (x * 180 / PI).toFixed(1).replace('.', ',');
      if (st.cmd < -1e-9) lines.push(`Scappamento ${gv.def.anchor}: il motore gira nel verso sbagliato (serve velocità positiva)`);
      else if (st.cmd > 1e-9 || st.amp > 0.002) lines.push(`Scappamento Graham: ampiezza ±${deg(st.amp)}°, periodo ${st.period ? st.period.toFixed(2).replace('.', ',') : '–'} s, ruota ${st.period ? deg(2 * PI / gv.G.N / st.period) : '–'}°/s`);
    }
    return lines;
  }
});
