/* =====================================================================
   types/links/cam_follower_CS/solve.js
   Camma e follower (link "cam_follower_CS"): il follower è un corpo a elle (braccio lungo + naso) che ruota attorno a un estremo, sempre
   soggetto alla gravità, con l'estremo del naso appoggiato al profilo di una camma; molla lineare facoltativa.
   Metà "COME SI RISOLVE" del link: validazione, dinamica, contatto, molla. Il disegno della molla è in create.js.
   ---------------------------------------------------------------------
   JSON:   { "type": "cam_follower_CS", "cam": "<gear cam_CS>", "follower": "<gear follower_CS>" }
   Facoltativi:
     "gravityDir"  direzione della gravità, [x,y,z] (default [0,0,-1])      "gravity"  intensità, mm/s² (9810)
     "damping"     attrito viscoso sul fulcro, 1/s (0,05)
     "spring"      molla LINEARE fra due assi:  { "a": "<id asse>", "b": "<id asse>", "k": rigidezza, "length": lunghezza a riposo (mm),
                   "damping": smorzamento (0) }   Almeno uno dei due assi deve essere solidale sul follower (axes[].carrier = asse del
                   follower), a distanza x dal fulcro; l'altro può essere fisso o solidale su un altro corpo (in quel caso conta la sua
                   posizione a inizio frame). Unità: la forza è k·(lunghezza - lunghezza a riposo), con le stesse unità della massa
                   ("mass" del follower, 1): per fare un confronto, il peso dell'asta è mass·gravity (mm/s²).
     "cam" si può omettere: il follower oscilla libero sotto gravità e molla.
   Come funziona: il contatto è l'estremo del naso (un punto, fisso nel corpo del follower); non può entrare nel profilo (contatto
   unilaterale, risolto a sotto-passi con impulsi sulla normale). Massa uniforme sui due bracci: baricentro e inerzia sono quelli del corpo a elle. Se la camma si abbassa più in fretta di quanto il follower possa cadere (gravità + molla), il follower si stacca: non ci
   sono fermi. La camma è mossa da un motore (clic + slider) e non è frenata dal follower. Follower e ruote solidali sullo stesso asse
   sono un corpo solo; la velocità di quell'asse viene imposta al solutore, così gli ingranaggi collegati seguono.
   Gli assi di camma, follower e molla devono essere paralleli; il piano del meccanismo è quello normale agli assi.
   ===================================================================== */

const CamCS = (() => {
  const PI = Math.PI, DEG = PI / 180;
  const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

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

  /* Posizione (piano, relativa al fulcro) di un estremo della molla con il follower all'angolo th. */
  const endPos = (e, th) => e.kind === 'body' ? rot(e.rel, th) : e.pos;

  /* Coppia della molla sul fulcro. Forza sull'estremo a: k·(len - L0)·d^ verso b; smorzamento lungo la molla. */
  function springTorque(G, th, w) {
    let tau = 0;
    for (const s of G.springs) {
      const pa = endPos(s.a, th), pb = endPos(s.b, th), dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const d = [dx / len, dy / len];
      const va = s.a.kind === 'body' ? [-w * pa[1], w * pa[0]] : [0, 0], vb = s.b.kind === 'body' ? [-w * pb[1], w * pb[0]] : [0, 0];
      const f = s.k * (len - s.L0) + s.c * ((vb[0] - va[0]) * d[0] + (vb[1] - va[1]) * d[1]);
      const Fa = [f * d[0], f * d[1]];
      if (s.a.kind === 'body') tau += cross(pa, Fa);
      if (s.b.kind === 'body') tau += cross(pb, [-Fa[0], -Fa[1]]);
    }
    return tau;
  }

  /* Contatti della punta di ogni braccio con la propria camma, all'angolo th del follower e angoli camma ths[i]. */
  function contactsAt(G, th, ths, skin) {
    const out = [];
    G.contacts.forEach((c, i) => {
      const arm = G.arms[c.arm], tip = rot(arm.n, th);                                                  // naso del follower
      const q = rot(rot([tip[0] - c.Crel[0], tip[1] - c.Crel[1]], -ths[i]), c.eps), r = sdPoly(q, c.poly);
      if (r.d > skin) return;
      const n = rot(rot(r.n, -c.eps), ths[i]), vcam = [-c.wC * (tip[1] - c.Crel[1]), c.wC * (tip[0] - c.Crel[0])];
      out.push({ i, d: r.d, tip, n, J: cross(tip, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
    });
    return out;
  }

  function substep(G, st, h, ths) {
    let tau = 0;
    for (const a of G.arms) for (const leg of a.legs) { const c = rot(leg.c, st.th); tau += leg.m * (c[0] * G.g[1] - c[1] * G.g[0]); }   // gravità sui baricentri dei due bracci
    tau += springTorque(G, st.th, st.w) - G.damping * G.I * st.w;
    st.w += tau / G.I * h;
    const skin = 0.05 + 1.5 * (Math.abs(st.w) * G.Lmax + G.vcamMax) * h, cons = contactsAt(G, st.th, ths, skin);
    for (let it = 0; it < 4; it++) for (const c of cons) {
      const vn = c.J * st.w - c.vcamN;
      let dl = -(vn + c.d / h) / (c.J * c.J / G.I); const nl = Math.max(0, c.lam + dl); dl = nl - c.lam; c.lam = nl;
      st.w += c.J * dl / G.I;
    }
    st.th += st.w * h;
  }

  /* Avanza di dt secondi (gli angoli delle camme variano linearmente nel frame: velocità wC, angolo finale thC1). */
  function advance(G, st, dt) {
    const n = Math.min(4000, Math.max(1, Math.ceil(dt / 2e-4))), h = dt / n, ths = G.contacts.map(() => 0);
    G.vcamMax = Math.max(0, ...G.contacts.map(c => Math.abs(c.wC) * c.rmax));
    for (let i = 0; i < n; i++) {
      G.contacts.forEach((c, k) => { ths[k] = c.thC1 - c.wC * (dt - (i + 0.5) * h); });
      substep(G, st, h, ths); st.t += h;
    }
    const fin = contactsAt(G, st.th, G.contacts.map(c => c.thC1), 0.05);
    st.touch = fin.some(c => c.d < 0.02);
  }

  /* Se all'inizio una punta è dentro una camma, solleva il follower (nel verso che alza la punta) finché sta fuori. */
  function depenetrate(G, st) {
    const ths = G.contacts.map(c => c.thC1), inside = () => contactsAt(G, st.th, ths, 0.02).some(c => c.d < 0.02);
    if (!inside()) return;
    let s = 0; for (const a of G.arms) s += rot(a.n, st.th)[0] > 0 ? 1 : -1;                              // il naso sale se d(altezza)/d? > 0
    s = s >= 0 ? 1 : -1;
    for (let i = 0; i < 3600 && inside(); i++) st.th += s * 0.1 * DEG;
    st.w = 0;
  }

  const newState = () => ({ th: 0, w: 0, t: 0, touch: false, frameDone: true, lastTh: 0, fresh: true });
  return { advance, depenetrate, newState, sdPoly, rot, cross, contactsAt, springTorque, endPos, PI, DEG };
})();

/* Stato fisico che sopravvive alle ricostruzioni del modello (slider, varianti), per asse del follower. */
const CamStore_CS = new Map();

Registry.link('cam_follower_CS', {
  collection: 'camFollowersCS',
  order: { constraints: 5, afterIntegrate: 100 },

  validate(l, w, { E, axisBy, gearBy, isVec }) {
    const gf = gearBy[l.follower], gc = l.cam !== undefined ? gearBy[l.cam] : null;
    if (!gf) E(`${w}: follower "${l.follower}" non esiste o non è attivo`);
    else if ((gf.type || 'spur') !== 'follower_CS') E(`${w}: follower "${l.follower}" deve essere di tipo follower_CS`);
    if (l.cam !== undefined) {
      if (!gc) E(`${w}: cam "${l.cam}" non esiste o non è attivo`);
      else if ((gc.type || 'spur') !== 'cam_CS') E(`${w}: cam "${l.cam}" deve essere di tipo cam_CS`);
    }
    const par = (a, b, what) => { if (a && b && V.dot(V.unit(a.dir), V.unit(b.dir)) < 0.9999) E(`${w}: ${what} deve avere asse parallelo e con lo stesso verso dell'asse del follower`); };
    const axF = gf && axisBy[gf.axis];
    if (gc && axF) { const axC = axisBy[gc.axis]; if (axC === axF) E(`${w}: camma e follower devono stare su assi diversi`); par(axC, axF, `la camma "${l.cam}"`); }
    if (l.gravityDir !== undefined && !isVec(l.gravityDir, 3)) E(`${w}: "gravityDir" deve avere 3 elementi [x, y, z]`);
    for (const k of ['gravity', 'damping']) if (l[k] !== undefined && typeof l[k] !== 'number' && typeof l[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
    if (l.spring !== undefined) {
      const s = l.spring;
      if (typeof s !== 'object' || s === null) E(`${w}: "spring" deve essere un oggetto { a, b, k, length }`);
      else {
        for (const k of ['k', 'length']) if (s[k] === undefined) E(`${w}: spring.${k} è obbligatorio`);
        for (const k of ['k', 'length', 'damping']) if (s[k] !== undefined && typeof s[k] !== 'number' && typeof s[k] !== 'string') E(`${w}: spring.${k} deve essere un numero o un'espressione`);
        const A = axisBy[s.a], B = axisBy[s.b];
        if (!A) E(`${w}: spring.a "${s.a}" non esiste o non è attivo`);
        if (!B) E(`${w}: spring.b "${s.b}" non esiste o non è attivo`);
        if (A && B && gf) {
          par(A, axF, `l'asse della molla "${s.a}"`); par(B, axF, `l'asse della molla "${s.b}"`);
          const onF = ax => ax && (ax === axF || ax.carrier === gf.axis);
          if (!onF(A) && !onF(B)) E(`${w}: almeno uno dei due assi della molla deve essere solidale sul follower (axes[].carrier = "${gf.axis}"), a distanza dal fulcro`);
          if (onF(A) && onF(B)) E(`${w}: i due assi della molla sono entrambi sul follower: la molla non farebbe nulla`);
        }
      }
    }
  },

  resolve(M, { ev, vec }) {
    M.camGroupsCS = [];
    const byAxis = new Map();
    for (const l of activeLinks('cam_follower_CS')) {
      CTX.where = `link cam_follower_CS ${l.cam || '-'} / ${l.follower}`;
      const num = (v, d) => v !== undefined ? ev(v) : d;
      const gf = M.gearBy[l.follower], axF = gf.ax, gc = l.cam !== undefined ? M.gearBy[l.cam] : null, axC = gc ? gc.ax : null;
      let G = byAxis.get(axF);
      if (!G) {                                                                                         // un gruppo per asse di follower: è un corpo solo
        const k = V.unit(axF.dir), gW = V.unit(l.gravityDir !== undefined ? vec(l.gravityDir) : [0, 0, -1]), gp = V.sub(gW, V.mul(k, V.dot(gW, k)));
        if (V.len(gp) < 0.2) throw new Error(`cam/follower: la gravità è quasi parallela all'asse del follower: gli assi devono essere orizzontali (es. dir [0,1,0] se la gravità è verso Z-)`);
        const Y = V.unit(V.mul(gp, -1)), X = V.cross(Y, k), gmag = num(l.gravity, 9810) * V.len(gp);
        G = { axF, iF: axF.idx, k, X, Y, g: [0, -gmag], damping: num(l.damping, 0.05), arms: [], contacts: [], springs: [], links: [] };
        G.plane = v => [V.dot(v, X), V.dot(v, Y)];
        for (const g of M.gears) if (g.type === 'follower_CS' && g.ax === axF) G.arms.push({ gear: g, L1: g.followerCS.L, L2: g.followerCS.L2, m: g.followerCS.mass, phi: 0, angle: g.followerCS.angle, bendDef: g.followerCS.bend });
        byAxis.set(axF, G); M.camGroupsCS.push(G);
      }
      const arm = G.arms.findIndex(a => a.gear === gf);
      if (gc) {                                                                                         // contatto punta del braccio ? profilo della camma
        const Crel = G.plane(V.sub(axC.O, axF.O)), eps = Math.atan2(V.dot(G.X, axC.yv), V.dot(G.X, axC.ref));
        const phiPc = Math.atan2(Crel[1], Crel[0]);                                                      // direzione fulcro ? centro della camma
        G.arms[arm].phi = phiPc + G.arms[arm].angle * PI / 180; G.arms[arm].hasCam = true; G.arms[arm].camRel = Crel;
        G.contacts.push({ arm, Crel, eps, poly: gc.camCS.poly, rmax: gc.camCS.rmax, axC, iC: axC.idx, thC1: axC.theta, wC: 0 });
      }
      if (l.spring) {
        const s = l.spring, endOf = id => {
          const ax = M.axisBy[id], axial = V.dot(V.sub(ax.O, axF.O), G.k), p = G.plane(V.sub(ax.O, axF.O));
          if (ax === axF) return { ax, axial, kind: 'body', rel: [0, 0] };
          if (ax.carrier === axF) return { ax, axial, kind: 'body', rel: p };                           // solidale sul follower: posizione a riposo relativa al fulcro
          return { ax, axial, kind: 'fixed', pos: p };
        };
        G.springs.push({ a: endOf(s.a), b: endOf(s.b), k: ev(s.k), L0: ev(s.length), c: num(s.damping, 0), link: l });
      }
      G.links.push({ def: l, gf, gc });
    }
    for (const G of M.camGroupsCS) {
      for (const a of G.arms) if (!a.hasCam) a.phi = a.angle * PI / 180;                                  // senza camma: angolo nel piano
      for (const a of G.arms) {                                                                           // corpo a elle: gomito, naso, baricentri, inerzia rispetto al fulcro
        const mag = a.bendDef !== null ? Math.abs(a.bendDef) : PI / 2, e = [a.L1 * Math.cos(a.phi), a.L1 * Math.sin(a.phi)];
        const noseAt = sg => [e[0] + a.L2 * Math.cos(a.phi + sg * mag), e[1] + a.L2 * Math.sin(a.phi + sg * mag)];
        let sg = a.bendDef !== null ? (Math.sign(a.bendDef) || 1) : 1;
        if (a.bendDef === null && a.camRel) { const p = noseAt(1), q = noseAt(-1); sg = Math.hypot(p[0] - a.camRel[0], p[1] - a.camRel[1]) <= Math.hypot(q[0] - a.camRel[0], q[1] - a.camRel[1]) ? 1 : -1; }   // naso verso la camma
        a.bend = sg * mag; a.e = e; a.n = noseAt(sg);
        const m1 = a.m * a.L1 / (a.L1 + a.L2), m2 = a.m - m1, c2 = [(e[0] + a.n[0]) / 2, (e[1] + a.n[1]) / 2];
        a.legs = [{ m: m1, c: [e[0] / 2, e[1] / 2] }, { m: m2, c: c2 }];
        a.I = m1 * a.L1 * a.L1 / 3 + m2 * (a.L2 * a.L2 / 12 + c2[0] * c2[0] + c2[1] * c2[1]);
        a.reach = Math.max(Math.hypot(a.n[0], a.n[1]), a.L1);
      }
      G.I = G.arms.reduce((s, a) => s + a.I, 0); G.Lmax = Math.max(...G.arms.map(a => a.reach)); G.vcamMax = 0;
      // dati per il disegno: direzione locale dell'asta di ogni braccio (angolo nel piano ? angolo locale del gear)
      for (const a of G.arms) { const eps = Math.atan2(V.dot(G.X, G.axF.yv), V.dot(G.X, G.axF.ref)); a.gear.rodLocalCS = a.phi + eps; a.gear.bendCS = a.bend; }
      const key = G.axF.id, prev = CamStore_CS.get(key), sig = [G.arms.length, +G.I.toFixed(3), G.contacts.length].join('|');
      if (prev && prev.sig === sig) G.st = prev.st; else { G.st = CamCS.newState(); CamStore_CS.set(key, { sig, st: G.st }); }
      G.needSync = true;
      M.camFollowersCS.push(...G.links.map(x => ({ def: x.def, G })));
      step('cam/follower', `asse ${key}: ${G.arms.length} braccio/i (${G.arms.map(a => `${+a.L1.toFixed(1)}+${+a.L2.toFixed(1)}`).join(', ')} mm), ${G.contacts.length} camma/e, ${G.springs.length} molla/e, inerzia ${G.I.toFixed(1)}`);
    }
  },

  /* A ricostruzione finita: allinea lo stato fisico agli angoli degli assi (che la ricostruzione conserva) e, se serve, solleva la punta. */
  settle(M) {
    for (const G of (M.camGroupsCS || [])) if (G.needSync) {
      const st = G.st, same = !st.fresh && Math.abs(G.axF.theta - st.th) < 1e-6;
      G.contacts.forEach(c => { c.thC1 = c.axC.theta; c.wC = 0; });
      if (st.fresh) { st.th = 0; st.w = 0; G.axF.theta = 0; CamCS.depenetrate(G, st); G.axF.theta = st.th; st.fresh = false; }
      else if (!same) { st.th = G.axF.theta; st.w = 0; CamCS.depenetrate(G, st); G.axF.theta = st.th; }
      st.lastTh = st.th; st.frameDone = true; G.needSync = false;
    }
  },

  /* All'inizio del frame: velocità delle camme (le dà il solutore: clic + slider) e controllo di modifiche esterne all'angolo. */
  events(M, s, w) {
    for (const G of (M.camGroupsCS || [])) {
      for (const c of G.contacts) c.wC = w[c.iC];
      const st = G.st;
      if (st.frameDone) { st.frameDone = false; if (Math.abs(G.axF.theta - st.lastTh) > 1e-9) { st.th = G.axF.theta; st.w = 0; } }
    }
    return [];
  },

  /* Una volta per frame, dopo l'integrazione degli assi: la dinamica del follower sostituisce l'angolo dell'asse. */
  afterIntegrate(M) {
    const dt = typeof M.dt === 'number' ? M.dt : Math.min(engine.getDeltaTime() / 1000, 0.05) * state.timeScale;     // come nel ciclo di animazione
    for (const G of (M.camGroupsCS || [])) {
      const st = G.st;
      for (const c of G.contacts) c.thC1 = c.axC.theta;
      if (dt > 0) {
        const cache = new Map();                                                                       // estremi di molla su corpi che si muovono: posizione a inizio frame
        for (const s of G.springs) for (const e of [s.a, s.b]) if (e.kind === 'moving') e.pos = G.plane(V.sub(axisFrame(e.ax, cache).O, G.axF.O));
        CamCS.advance(G, st, dt);
      }
      G.axF.theta = st.th; st.lastTh = st.th; st.frameDone = true;
    }
  },

  /* La velocità dell'asse del follower è il risultato della dinamica: si impone al solutore (priorità alta), così le ruote solidali
     e tutto ciò che è ingranato con loro seguono il follower. */
  constraints(M, push, { unit }) {
    for (const G of (M.camGroupsCS || [])) push('cam_follower', `follower su ${G.axF.id}`, unit(G.iF), G.st.w, { axisIdx: G.iF });
  },

  linkedAxes: M => (M.camGroupsCS || []).flatMap(G => [G.axF, ...G.contacts.map(c => c.axC), ...G.springs.flatMap(s => [s.a.ax, s.b.ax])]),

  status(M) {
    const lines = [];
    for (const G of (M.camGroupsCS || [])) {
      const st = G.st, deg = (st.th * 180 / PI).toFixed(1).replace('.', ',');
      if (G.contacts.length) lines.push(`Follower ${G.axF.id}: angolo ${deg}°, ${st.touch ? 'appoggiato alla camma' : 'staccato dalla camma'}`);
    }
    return lines;
  }
});
