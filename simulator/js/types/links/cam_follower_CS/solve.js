/* =====================================================================
   types/links/cam_follower_CS/solve.js
   Camma e follower (link "cam_follower_CS"): il follower e un'asta uniforme che ruota attorno a un estremo, sempre soggetta alla gravita,
   con la punta oppure con un lato piatto appoggiato al profilo di una camma; molla lineare facoltativa.
   Meta "COME SI RISOLVE" del link: validazione, dinamica, contatto, molla. Il disegno della molla e in create.js.
   ---------------------------------------------------------------------
   JSON:   { "type": "cam_follower_CS", "cam": "<gear cam_CS>", "follower": "<gear follower_CS>" }
   Facoltativi:
     "gravityDir"  direzione della gravita, [x,y,z] (default [0,0,-1])      "gravity"  intensita, mm/s2 (9810)
     "damping"     attrito viscoso sul fulcro, 1/s (0,05)
     "spring"      molla LINEARE fra due assi:  { "a": "<id asse>", "b": "<id asse>", "k": rigidezza, "length": lunghezza a riposo (mm),
                   "damping": smorzamento (0) }   Almeno uno dei due assi deve essere solidale sul follower (axes[].carrier = asse del
                   follower), a distanza x dal fulcro; l'altro puo essere fisso o solidale su un altro corpo (in quel caso conta la sua
                   posizione a inizio frame). La molla lavora SOLO A TRAZIONE: sotto la lunghezza a riposo e lasca e non spinge (nemmeno smorza).
                   Unita: la forza, a molla tesa, e k*(lunghezza meno lunghezza a riposo), con le stesse unita della massa
                   ("mass" del follower, 1): per fare un confronto, il peso dell'asta e mass*gravity (mm/s2).
     "cam" si puo omettere: il follower oscilla libero sotto gravita e molla.
   Contatto (parametro del follower, vedere follower_CS):
     "contact": "tip" = punta, "side1" = lato 1 (y = +hw), "side2" = lato 2 (y = -hw). Se omesso, "tip".
     Se contact e "tip", la punta locale e tipPoint = [L - tipShift, sideOffset], NON [L, 0] e NON [L, sideOffset].
     Il becco della foto e questo: sideOffset negativo, tipShift piccolo.
     Non esistono piu beakH / beakX / beakW / beakSide.
     Se contact non e "tip", la punta del follower diventa piatta invece che a punta, e il lato utile e lungo L, non L - tip.
     Per i lati, il contatto e il lato piatto da s = 0 a s = L, spostato di width/2 dalla mezzeria.
     Tangenza del lato, versione veloce: la distanza con segno da una retta e lineare lungo ogni spigolo, quindi il minimo sulla camma
     e sempre in un vertice. Basta una passata sui vertici con due prodotti scalari, senza campionare il segmento e senza segSeg.
   Molla, asse sul follower con un solo numero:
     nell'asse con carrier = asse del follower, metti "dist": <mm>. E la distanza del punto dal fulcro, lungo l'asta, a th = 0.
     Esempio: { "id": "asse_molla_follower_CS", "dir": [0,1,0], "carrier": "asse_follower_CS", "dist": 35, "place": {"at": [0,0,0]} }
     Se c'e "dist", "place" e ignorato e puo essere un segnaposto. Se non c'e "dist", vale "place.at" come prima.
   Come funziona: il punto di contatto non puo entrare nel profilo (contatto unilaterale, risolto a sotto-passi con impulsi sulla
   normale). Se la camma si abbassa piu in fretta di quanto il follower possa cadere (gravita + molla), il follower si stacca: non ci
   sono fermi. La camma e mossa da un motore (clic + slider) e non e frenata dal follower. Follower e ruote solidali sullo stesso asse
   sono un corpo solo; la velocita di quell'asse viene imposta al solutore, cosi gli ingranaggi collegati seguono.
   Gli assi di camma, follower e molla devono essere paralleli; il piano del meccanismo e quello normale agli assi.
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

  function pointSeg(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
    let t = l2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * abx, a[1] + t * aby];
    return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), t };
  }

  /* Posizione (piano, relativa al fulcro) di un estremo della molla con il follower all'angolo th. */
  const endPos = (e, th) => e.kind === 'body' ? rot(e.rel, th) : e.pos;

  /* Coppia della molla sul fulcro. Molla SOLO A TRAZIONE: con len <= L0 e lasca e non da forza; con len > L0 la forza sull'estremo a e
     k*(len - L0)*d verso b piu lo smorzamento lungo la molla, ma non diventa mai una spinta (f >= 0). */
  function springTorque(G, th, w) {
    let tau = 0;
    for (const s of G.springs) {
      const pa = endPos(s.a, th), pb = endPos(s.b, th), dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
      if (len < 1e-9 || len <= s.L0) continue; // lasca: la molla non spinge
      const d = [dx / len, dy / len];
      const va = s.a.kind === 'body' ? [-w * pa[1], w * pa[0]] : [0, 0], vb = s.b.kind === 'body' ? [-w * pb[1], w * pb[0]] : [0, 0];
      const f = Math.max(0, s.k * (len - s.L0) + s.c * ((vb[0] - va[0]) * d[0] + (vb[1] - va[1]) * d[1])); // solo trazione
      const Fa = [f * d[0], f * d[1]];
      if (s.a.kind === 'body') tau += cross(pa, Fa);
      if (s.b.kind === 'body') tau += cross(pb, [-Fa[0], -Fa[1]]);
    }
    return tau;
  }

  /* Contatti di ogni braccio con la propria camma, all'angolo th del follower e angoli camma ths[i]. Punta oppure lato, secondo c.contact. */
  function contactsAt(G, th, ths, skin) {
    const out = [];
    G.contacts.forEach((c, i) => {
      const arm = G.arms[c.arm], ang = arm.phi + th;
      if (c.contact === 'side1' || c.contact === 'side2') {
        const dir = [Math.cos(ang), Math.sin(ang)], perp = [-dir[1], dir[0]];
        const nSide = [perp[0] * c.side, perp[1] * c.side];
        const off = [perp[0] * c.side * c.hw, perp[1] * c.side * c.hw];
        const A = off, B = [dir[0] * c.Lside + off[0], dir[1] * c.Lside + off[1]];
        const toCam = p => rot(rot([p[0] - c.Crel[0], p[1] - c.Crel[1]], -ths[i]), c.eps);
        const fromCamPoint = q => { const v = rot(rot(q, -c.eps), ths[i]); return [v[0] + c.Crel[0], v[1] + c.Crel[1]]; };
        const fromCamVec = q => rot(rot(q, -c.eps), ths[i]);
        const A_cam = toCam(A), B_cam = toCam(B);
        if (pointSeg([0, 0], A_cam, B_cam).d > c.rmax + skin + 1) return;
        const dir_cam = rot(rot(dir, -ths[i]), c.eps);
        const nSide_cam = rot(rot(nSide, -ths[i]), c.eps);
        let bestD = Infinity, bestS = 0;
        for (let k = 0; k < c.poly.length; k++) {
          const p = c.poly[k];
          const dx = p[0] - A_cam[0], dy = p[1] - A_cam[1];
          const s = dx * dir_cam[0] + dy * dir_cam[1];
          if (s < 0 || s > c.Lside) continue;
          const d = dx * nSide_cam[0] + dy * nSide_cam[1];
          if (d < bestD) { bestD = d; bestS = s; }
        }
        if (bestD <= skin) {
          let sMin = bestS, sMax = bestS;
          for (let k = 0; k < c.poly.length; k++) {
            const p = c.poly[k];
            const dx = p[0] - A_cam[0], dy = p[1] - A_cam[1];
            const s = dx * dir_cam[0] + dy * dir_cam[1];
            if (s < 0 || s > c.Lside) continue;
            const d = dx * nSide_cam[0] + dy * nSide_cam[1];
            if (d < bestD + 0.05) { if (s < sMin) sMin = s; if (s > sMax) sMax = s; }
          }
          const n = fromCamVec([-nSide_cam[0], -nSide_cam[1]]);
          const pushAt = s => {
            const pF_cam = [A_cam[0] + dir_cam[0] * s, A_cam[1] + dir_cam[1] * s];
            const pC_cam = [pF_cam[0] + nSide_cam[0] * bestD, pF_cam[1] + nSide_cam[1] * bestD];
            const pF = fromCamPoint(pF_cam), pC = fromCamPoint(pC_cam);
            const vcam = [-c.wC * (pC[1] - c.Crel[1]), c.wC * (pC[0] - c.Crel[0])];
            out.push({ i, d: bestD, tip: pF, pF, pC, n, J: cross(pF, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
          };
          if (sMax - sMin > 1) { pushAt(sMin); pushAt(sMax); } else { pushAt(bestS); }
          return;
        }
        for (const E_cam of [A_cam, B_cam]) {
          const r = sdPoly(E_cam, c.poly);
          if (r.d <= skin) {
            const n = fromCamVec(r.n);
            const pF = fromCamPoint(E_cam);
            const pC_cam = [E_cam[0] - r.n[0] * r.d, E_cam[1] - r.n[1] * r.d];
            const pC = fromCamPoint(pC_cam);
            const vcam = [-c.wC * (pC[1] - c.Crel[1]), c.wC * (pC[0] - c.Crel[0])];
            out.push({ i, d: r.d, tip: pF, pF, pC, n, J: cross(pF, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
          }
        }
      } else {
        // Punta: UNICA fonte di verita = tipPoint da solve.js (include tipShift e sideOffset)
        // Mai usare [L,0] qui, mai usare beakH/beakX: quelli erano il vecchio modello e sono stati cancellati.
        const tp = c.tipPoint || [arm.L, 0];
        const tip = [tp[0] * Math.cos(ang) - tp[1] * Math.sin(ang), tp[0] * Math.sin(ang) + tp[1] * Math.cos(ang)];
        const dx = tip[0] - c.Crel[0], dy = tip[1] - c.Crel[1];
        if (Math.hypot(dx, dy) > c.rmax + skin + 1) return;
        const q = rot(rot([dx, dy], -ths[i]), c.eps), r = sdPoly(q, c.poly);
        if (r.d > skin) return;
        const n = rot(rot(r.n, -c.eps), ths[i]), vcam = [-c.wC * (tip[1] - c.Crel[1]), c.wC * (tip[0] - c.Crel[0])];
        out.push({ i, d: r.d, tip, n, J: cross(tip, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
      }
    });
    return out;
  }

  function substep(G, st, h, ths) {
    let tau = 0;
    for (const a of G.arms) { const ux = Math.cos(a.phi + st.th), uy = Math.sin(a.phi + st.th); tau += a.m * (a.L / 2) * (ux * G.g[1] - uy * G.g[0]); }
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

  /* Avanza di dt secondi (gli angoli delle camme variano linearmente nel frame: velocita wC, angolo finale thC1). */
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

  /* Se all'inizio un punto di contatto e dentro una camma, ruota nel verso che aumenta la distanza minima finche sta fuori. Vale per punta e lati. */
  function depenetrate(G, st) {
    const ths = G.contacts.map(c => c.thC1);
    const minD = () => { const cs = contactsAt(G, st.th, ths, 1e9); return cs.length ? Math.min(...cs.map(c => c.d)) : 1e9; };
    const inside = () => contactsAt(G, st.th, ths, 0.02).some(c => c.d < 0.02);
    if (!inside()) return;
    const step = 0.1 * DEG;
    for (let i = 0; i < 3600 && inside(); i++) {
      const d0 = minD();
      st.th += step; const dP = minD(); st.th -= step;
      st.th -= step; const dM = minD(); st.th += step;
      if (dP >= dM && dP > d0) st.th += step;
      else if (dM > d0) st.th -= step;
      else break;
    }
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
    if (!gf) E(`${w}: follower "${l.follower}" non esiste o non e attivo`);
    else if ((gf.type || 'spur') !== 'follower_CS') E(`${w}: follower "${l.follower}" deve essere di tipo follower_CS`);
    if (l.cam !== undefined) {
      if (!gc) E(`${w}: cam "${l.cam}" non esiste o non e attivo`);
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
        for (const k of ['k', 'length']) if (s[k] === undefined) E(`${w}: spring.${k} e obbligatorio`);
        for (const k of ['k', 'length', 'damping']) if (s[k] !== undefined && typeof s[k] !== 'number' && typeof s[k] !== 'string') E(`${w}: spring.${k} deve essere un numero o un'espressione`);
        const A = axisBy[s.a], B = axisBy[s.b];
        if (!A) E(`${w}: spring.a "${s.a}" non esiste o non e attivo`);
        if (!B) E(`${w}: spring.b "${s.b}" non esiste o non e attivo`);
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
      if (!G) {
        const k = V.unit(axF.dir), gW = V.unit(l.gravityDir !== undefined ? vec(l.gravityDir) : [0, 0, -1]), gp = V.sub(gW, V.mul(k, V.dot(gW, k)));
        if (V.len(gp) < 0.2) throw new Error(`cam/follower: la gravita e quasi parallela all'asse del follower: gli assi devono essere orizzontali (es. dir [0,1,0] se la gravita e verso Z-)`);
        const Y = V.unit(V.mul(gp, -1)), X = V.cross(Y, k), gmag = num(l.gravity, 9810) * V.len(gp);
        G = { axF, iF: axF.idx, k, X, Y, g: [0, -gmag], damping: num(l.damping, 0.05), arms: [], contacts: [], springs: [], links: [] };
        G.plane = v => [V.dot(v, X), V.dot(v, Y)];
        for (const g of M.gears) if (g.type === 'follower_CS' && g.ax === axF) {
          const f = g.followerCS, hw = f.hw !== undefined ? f.hw : f.width / 2, tipLen = f.tip !== undefined ? f.tip : Math.min(Math.max(f.width * 3, 6), f.L * 0.35);
          const Lside = f.Lside !== undefined ? f.Lside : (f.flatTip ? f.L : f.L - tipLen), contact = f.contact || 'tip', side = f.side !== undefined ? f.side : (contact === 'side1' ? 1 : contact === 'side2' ? -1 : 0);
          G.arms.push({ gear: g, L: f.L, m: f.mass, phi: 0, angle: f.angle, hw, tip: tipLen, Lside, contact, side, flatTip: !!f.flatTip, tipPoint: f.tipPoint, sideOffset: f.sideOffset || 0, tipShift: f.tipShift || 0 });
        }
        byAxis.set(axF, G); M.camGroupsCS.push(G);
      }
      const arm = G.arms.findIndex(a => a.gear === gf);
      if (gc) {
        const Crel = G.plane(V.sub(axC.O, axF.O)), eps = Math.atan2(V.dot(G.X, axC.yv), V.dot(G.X, axC.ref));
        const phiPc = Math.atan2(Crel[1], Crel[0]);
        G.arms[arm].phi = phiPc + G.arms[arm].angle * PI / 180; G.arms[arm].hasCam = true;
        const a0 = G.arms[arm];
        G.contacts.push({ arm, Crel, eps, poly: gc.camCS.poly, rmax: gc.camCS.rmax, axC, iC: axC.idx, thC1: axC.theta, wC: 0, contact: a0.contact, side: a0.side, hw: a0.hw, Lside: a0.Lside, flatTip: a0.flatTip, tipPoint: a0.tipPoint });
      }
      if (l.spring) {
        const s = l.spring, endOf = id => {
          const ax = M.axisBy[id];
          let dist = null;
          if (ax) {
            if (typeof ax.dist === 'number') dist = ax.dist;
            else if (ax.def && typeof ax.def.dist === 'number') dist = ax.def.dist;
            else if (typeof ax.place === 'number') dist = ax.place;
            else if (ax.place && typeof ax.place.dist === 'number') dist = ax.place.dist;
            else if (ax.def && typeof ax.def.place === 'number') dist = ax.def.place;
            else if (typeof ax.dist === 'string' && !Number.isNaN(Number(ax.dist))) dist = Number(ax.dist);
            else if (ax.def && typeof ax.def.dist === 'string' && !Number.isNaN(Number(ax.def.dist))) dist = Number(ax.def.dist);
          }
          if (dist !== null && (ax === axF || ax.carrier === axF || ax.carrier === gf.axis)) {
            let phiArm = G.arms[arm] ? G.arms[arm].phi : 0;
            if (G.arms[arm] && !G.arms[arm].hasCam) phiArm = G.arms[arm].angle * PI / 180;
            const rel = [dist * Math.cos(phiArm), dist * Math.sin(phiArm)];
            let axial = 0;
            try { axial = V.dot(V.sub(ax.O, axF.O), G.k); } catch (e) { axial = 0; }
            const world = V.add(axF.O, V.add(V.add(V.mul(G.X, rel[0]), V.mul(G.Y, rel[1])), V.mul(G.k, axial)));
            ax.O = world;
            return { ax, axial, kind: 'body', rel };
          }
          const axial = V.dot(V.sub(ax.O, axF.O), G.k), p = G.plane(V.sub(ax.O, axF.O));
          if (ax === axF) return { ax, axial, kind: 'body', rel: [0, 0] };
          if (ax.carrier === axF) return { ax, axial, kind: 'body', rel: p };
          return { ax, axial, kind: 'fixed', pos: p };
        };
        G.springs.push({ a: endOf(s.a), b: endOf(s.b), k: ev(s.k), L0: ev(s.length), c: num(s.damping, 0), link: l });
      }
      G.links.push({ def: l, gf, gc });
    }
    for (const G of M.camGroupsCS) {
      for (const a of G.arms) if (!a.hasCam) a.phi = a.angle * PI / 180;
      G.I = G.arms.reduce((s, a) => s + a.m * a.L * a.L / 3, 0); G.Lmax = Math.max(...G.arms.map(a => a.L)); G.vcamMax = 0;
      for (const a of G.arms) { const eps = Math.atan2(V.dot(G.X, G.axF.yv), V.dot(G.X, G.axF.ref)); a.gear.rodLocalCS = a.phi + eps; }
      const key = G.axF.id, prev = CamStore_CS.get(key), sig = [G.arms.length, +G.I.toFixed(3), G.contacts.length, G.contacts.map(c => `${c.contact}:${c.side}:${c.hw.toFixed(2)}:${c.Lside.toFixed(1)}:${c.flatTip ? 1 : 0}:${c.tipPoint ? c.tipPoint[0].toFixed(1) + ',' + c.tipPoint[1].toFixed(1) : 'none'}`).join(',')].join('|');
      if (prev && prev.sig === sig) G.st = prev.st; else { G.st = CamCS.newState(); CamStore_CS.set(key, { sig, st: G.st }); }
      G.needSync = true;
      M.camFollowersCS.push(...G.links.map(x => ({ def: x.def, G })));
      step('cam/follower', `asse ${key}: ${G.arms.length} braccio/i (L=${G.arms.map(a => +a.L.toFixed(1)).join(', ')} mm), ${G.contacts.length} camma/e, ${G.springs.length} molla/e, inerzia ${G.I.toFixed(1)}`);
    }
  },

  /* A ricostruzione finita: allinea lo stato fisico agli angoli degli assi (che la ricostruzione conserva) e, se serve, solleva il punto di contatto. */
  settle(M) {
    for (const G of (M.camGroupsCS || [])) if (G.needSync) {
      const st = G.st, same = !st.fresh && Math.abs(G.axF.theta - st.th) < 1e-6;
      G.contacts.forEach(c => { c.thC1 = c.axC.theta; c.wC = 0; });
      if (st.fresh) { st.th = 0; st.w = 0; G.axF.theta = 0; CamCS.depenetrate(G, st); G.axF.theta = st.th; st.fresh = false; }
      else if (!same) { st.th = G.axF.theta; st.w = 0; CamCS.depenetrate(G, st); G.axF.theta = st.th; }
      st.lastTh = st.th; st.frameDone = true; G.needSync = false;
    }
  },

  /* All'inizio del frame: velocita delle camme (le da il solutore: clic + slider) e controllo di modifiche esterne all'angolo. */
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
    const dt = typeof M.dt === 'number' ? M.dt : Math.min(engine.getDeltaTime() / 1000, 0.05) * state.timeScale;
    for (const G of (M.camGroupsCS || [])) {
      const st = G.st;
      for (const c of G.contacts) c.thC1 = c.axC.theta;
      if (dt > 0) {
        const cache = new Map();
        for (const s of G.springs) for (const e of [s.a, s.b]) if (e.kind === 'moving') e.pos = G.plane(V.sub(axisFrame(e.ax, cache).O, G.axF.O));
        CamCS.advance(G, st, dt);
      }
      G.axF.theta = st.th; st.lastTh = st.th; st.frameDone = true;
    }
  },

  /* La velocita dell'asse del follower e il risultato della dinamica: si impone al solutore (priorita alta), cosi le ruote solidali
     e tutto cio che e ingranato con loro seguono il follower. */
  constraints(M, push, { unit }) {
    for (const G of (M.camGroupsCS || [])) push('cam_follower', `follower su ${G.axF.id}`, unit(G.iF), G.st.w, { axisIdx: G.iF });
  },

  linkedAxes: M => (M.camGroupsCS || []).flatMap(G => [G.axF, ...G.contacts.map(c => c.axC), ...G.springs.flatMap(s => [s.a.ax, s.b.ax])]),

  status(M) {
    const lines = [];
    for (const G of (M.camGroupsCS || [])) {
      const st = G.st, deg = (st.th * 180 / PI).toFixed(1).replace('.', ',');
      if (G.contacts.length) {
        const c0 = G.contacts[0], label = c0.contact === 'side1' ? 'lato 1' : c0.contact === 'side2' ? 'lato 2' : 'punta';
        lines.push(`Follower ${G.axF.id}: angolo ${deg}°, ${st.touch ? `appoggiato alla camma (${label})` : 'staccato dalla camma'}`);
      }
    }
    return lines;
  }
});