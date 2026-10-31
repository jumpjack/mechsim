/* =====================================================================
   core/04-geometry.js
   Primitive geometriche CONDIVISE (le geometrie specifiche stanno in types/gears/<tipo>/create.js)
   ===================================================================== */
/* Costanti e profilo dei denti a evolvente: usati da spur, bevel (e da chiunque debba dentare una ruota) */
const PRESSURE = 20 * PI / 180;
const BACKLASH = 0.05;
const inv = a => Math.tan(a) - a;

function toothProfile(z, m, nFlank) {
  const rp = m * z / 2, rb = rp * cos(PRESSURE), ra = rp + m, rf = rp - 1.25 * m;
  const halfBase = PI / (2 * z) + inv(PRESSURE), rStart = Math.max(rb, rf), pitch = 2 * PI / z;
  const r = [], half = [];
  for (let i = 0; i < nFlank; i++) {
    const q = rStart + (ra - rStart) * i / (nFlank - 1);
    r.push(q);
    half.push(halfBase - inv(Math.acos(Math.min(1, rb / q))) - BACKLASH * m / (2 * rp));
  }
  const out = [];
  for (let i = 0; i < nFlank; i++) out.push([r[i], -half[i]]);
  out.push([ra, 0]);
  for (let i = nFlank - 1; i >= 0; i--) out.push([r[i], half[i]]);
  if (rf < rb) out.push([rf, half[0]]);
  out.push([rf, half[0] + (pitch - 2 * half[0]) / 3], [rf, half[0] + (pitch - 2 * half[0]) * 2 / 3]);
  if (rf < rb) out.push([rf, pitch - half[0]]);
  return out;
}

function loft(A, B, capA, capB) {
  const n = A.length, T = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i], [2 * n, j, i], [2 * n + 1, n + i, n + j]);
  }
  return { P: [...A, ...B, capA, capB], T };
}


/* Solido a anelli sovrapposti: usato da worm e wormwheel */
function ringsLoft(rings, capA, capB) {
  const nr = rings.length, n = rings[0].length, P = [], T = [];
  for (const r of rings) P.push(...r);
  const cA = P.length; P.push(capA);
  const cB = P.length; P.push(capB);
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n, a = i * n + j, b = i * n + j2, c = (i + 1) * n + j2, d = (i + 1) * n + j;
    T.push([a, b, c], [a, c, d]);
  }
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    T.push([cA, j2, j], [cB, (nr - 1) * n + j, (nr - 1) * n + j2]);
  }
  return { P, T };
}

/* Solidi semplici: usati dalle parti degli assi (types/parts), dal tipo "cylinder" e dalla piastra dei conici */
function cylinderSolid(r, w0, w1, n = 32, cx = 0, cy = 0) {
  const A = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * PI * i / n, x = cx + r * cos(a), y = cy + r * sin(a);
    A.push([x, y, w0]); B.push([x, y, w1]);
  }
  return loft(A, B, [cx, cy, w0], [cx, cy, w1]);
}

function boxSolid(w0, w1, cx, cy, hx, hy) {
  const q = w => [[cx - hx, cy - hy, w], [cx + hx, cy - hy, w], [cx + hx, cy + hy, w], [cx - hx, cy + hy, w]];
  return loft(q(w0), q(w1), [cx, cy, w0], [cx, cy, w1]);
}

function prismSolid(poly, y0, y1) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cw = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return loft(poly.map(([x, w]) => [x, y0, w]), poly.map(([x, w]) => [x, y1, w]), [cx, y0, cw], [cx, y1, cw]);
}


/* =====================================================================
   FORO CENTRALE DEGLI INGRANAGGI (per l'asse su cui girano / a cui sono fissati)
   ---------------------------------------------------------------------
   boreSolids(solids, bore) fora, lungo l'asse locale z, i solidi { P, T } costruiti dai tipi di ingranaggio: toglie i due tappi che
   chiudono il corpo alle estremità, li sostituisce con corone (bordo del corpo → bordo del foro) e aggiunge la parete del foro.
   È generico: i tipi di ingranaggio non devono sapere nulla del foro. Tappi gestiti:
     · piani (cilindro, ruote dentate, vite...);  · a ventaglio verso un vertice sull'asse, anche a quota variabile (coniche);
     · piani con sezione non "a stella" rispetto al centro (croce di Malta): ponte verso il foro + ear clipping.
   bore = { r, flat, ang, n }:  r = raggio del foro; flat = null (foro circolare) oppure un numero in (0,1) = distanza del lato piano
   dal centro, in frazione di r (foro a "D"); ang = direzione del lato piano (rad, nel riferimento dell'asse).
   Se un solido non è adatto (foro troppo grande, centro sul bordo...) resta com'è e il motivo finisce in `skipped`.
   ===================================================================== */
const BORE_SEGMENTS = 48;

/* Contorno del foro, in senso antiorario: cerchio di raggio r, con un lato piano se flat è in (0,1). `extra` = angoli in più in cui
   mettere un vertice (uno per ogni vertice del bordo del corpo: servono a triangolare la corona senza triangoli rovesciati).
   → [{ x, y, a }], a ∈ [0, 2π) ordinati */
function boreRing(r, flat, ang, n = BORE_SEGMENTS, extra = []) {
  const TAU = 2 * PI, wrap = a => ((a % TAU) + TAU) % TAU;
  const angs = [];
  for (let i = 0; i < n; i++) angs.push(TAU * i / n);
  const cut = typeof flat === 'number' && flat > 0 && flat < 1;
  if (cut) { const h = Math.acos(flat); angs.push(wrap(ang - h), wrap(ang + h)); }          // spigoli esatti del lato piano
  for (const a of extra) angs.push(wrap(a));
  angs.sort((a, b) => a - b);
  const out = [];
  for (const a of angs) {
    if (out.length && a - out[out.length - 1].a < 1e-12) continue;
    let rho = r;
    if (cut) { const c = Math.cos(a - ang); if (c > flat + 1e-12) rho = flat * r / c; }       // punti sul lato piano
    out.push({ x: rho * Math.cos(a), y: rho * Math.sin(a), a });
  }
  if (out.length > 1 && out[0].a + TAU - out[out.length - 1].a < 1e-12) out.pop();
  return out;
}

/* Anello di bordo di un tappo (insieme di triangoli): indici dei vertici in ordine di percorrenza, o null. */
function boreCapLoop(tris) {
  const has = new Set(), next = new Map();
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) has.add(u + ',' + v);
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    if (has.has(v + ',' + u)) continue;                      // spigolo interno: compare nei due versi
    if (next.has(u)) return null;                            // bordo che si tocca: non è un anello semplice
    next.set(u, v);
  }
  if (!next.size) return null;
  const start = next.keys().next().value, loop = [start];
  for (let cur = next.get(start); cur !== start; cur = next.get(cur)) {
    if (cur === undefined || loop.length > next.size) return null;
    loop.push(cur);
  }
  return loop.length === next.size ? loop : null;            // più di un anello (es. corona già forata): non gestito
}

/* Triangolazione per orecchie di un poligono semplice antiorario [[x, y], ...] → [[i, j, k], ...] */
function boreEarClip(poly) {
  const n = poly.length, idx = poly.map((_, i) => i), tris = [], eps = 1e-12;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = 0, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const cr = cross(poly[ia], poly[ib], poly[ic]);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;
      let ok = true;
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], poly[ia], poly[ib], poly[ic])) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat, ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return n >= 3 ? tris : [];
}

/* Ponte fra il bordo esterno O e il foro H (entrambi antiorari, [[x, y], ...]): poligono unico con un "taglio" → lista di [tipo, indice]
   in senso antiorario (il foro percorso in senso orario), o null se non si trova un ponte che non attraversi nulla. */
function boreBridge(O, H) {
  const nO = O.length, nH = H.length;
  const segX = (a, b, c, d) => {                                                 // intersezione propria dei segmenti ab e cd
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
  };
  const ord = O.map((_, i) => i).sort((i, j) => Math.hypot(O[i][0], O[i][1]) - Math.hypot(O[j][0], O[j][1]));
  for (const v of ord.slice(0, 40)) {
    const hs = H.map((_, j) => j).sort((i, j) => Math.hypot(H[i][0] - O[v][0], H[i][1] - O[v][1]) - Math.hypot(H[j][0] - O[v][0], H[j][1] - O[v][1]));
    for (const h of hs.slice(0, 4)) {
      let ok = true;
      for (let k = 0; k < nO && ok; k++) if (k !== v && (k + 1) % nO !== v && segX(O[v], H[h], O[k], O[(k + 1) % nO])) ok = false;
      for (let k = 0; k < nH && ok; k++) if (k !== h && (k + 1) % nH !== h && segX(O[v], H[h], H[k], H[(k + 1) % nH])) ok = false;
      if (!ok) continue;
      const out = [];
      for (let k = 0; k <= v; k++) out.push(['O', k]);
      for (let m = 0; m <= nH; m++) out.push(['H', (h - m + 2 * nH) % nH]);       // il foro in senso orario, tornando a h
      for (let k = v; k < nO; k++) out.push(['O', k]);                            // ... e di nuovo il vertice del ponte, poi il resto
      return out;
    }
  }
  return null;
}

function boreSolid(S, bore) {
  const { P, T } = S, TAU = 2 * PI, fail = why => ({ S, why });
  if (S.noBore) return { S, why: null };                 // solido marcato dal tipo (es. un perno fuori asse): non si fora, senza avvisi
  const used = new Set(); for (const t of T) for (const i of t) used.add(i);
  let zmin = Infinity, zmax = -Infinity;
  for (const i of used) { const z = P[i][2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  if (!(zmax > zmin)) return fail('solido senza spessore');
  const eps = 1e-6 * Math.max(1, zmax - zmin);

  // 1) i due tappi. Prima caso: facce piane alle quote estreme. Altrimenti: ventagli attorno a due vertici sull'asse.
  let lo = [], hi = [], keep = [], hubLo = null, hubHi = null;
  for (const t of T) {
    const z0 = P[t[0]][2];
    if (Math.abs(P[t[1]][2] - z0) < eps && Math.abs(P[t[2]][2] - z0) < eps) {
      if (Math.abs(z0 - zmin) < eps) { lo.push(t); continue; }
      if (Math.abs(z0 - zmax) < eps) { hi.push(t); continue; }
    }
    keep.push(t);
  }
  if (!lo.length || !hi.length) {
    const sc = Math.max(1, zmax - zmin), hubs = [...used].filter(i => Math.abs(P[i][0]) < 1e-9 * sc && Math.abs(P[i][1]) < 1e-9 * sc);
    if (hubs.length !== 2) return fail('non ha due facce che lo chiudono alle estremità');
    hubs.sort((a, b) => P[a][2] - P[b][2]); [hubLo, hubHi] = hubs; lo = []; hi = []; keep = [];
    for (const t of T) {
      const a = t.includes(hubLo), b = t.includes(hubHi);
      if (a && b) return fail('le due facce si toccano');
      (a ? lo : b ? hi : keep).push(t);
    }
  }

  // 2) descrizione di ciascun tappo: anello di bordo antiorario, quota z(x, y) della sua superficie, "a stella" o no
  const wrapPi = d => Math.atan2(Math.sin(d), Math.cos(d));
  const describe = (tris, hub) => {
    const loop = boreCapLoop(tris);
    if (!loop) return { why: 'il bordo di una faccia non è un anello semplice' };
    let area = 0, rmin = Infinity;
    for (let k = 0; k < loop.length; k++) {
      const p = P[loop[k]], q = P[loop[(k + 1) % loop.length]];
      area += p[0] * q[1] - q[0] * p[1]; rmin = Math.min(rmin, Math.hypot(p[0], p[1]));
    }
    if (rmin < 1e-9) return { why: 'il centro sta sul bordo (es. settore dentato)' };
    const s = area > 0 ? 1 : -1, ring = s > 0 ? loop : loop.slice().reverse(), n = ring.length;          // ring: antiorario
    const ang = ring.map(i => Math.atan2(P[i][1], P[i][0]));
    let sweep = 0, star = true; const un = [ang[0]];
    for (let k = 1; k <= n; k++) {
      const d = wrapPi(ang[k % n] - ang[k - 1]); sweep += d;
      if (d < -1e-9) star = false;
      if (k < n) un.push(un[k - 1] + d);
    }
    if (Math.abs(sweep - TAU) > 1e-6) return { why: 'il centro non sta dentro il bordo della faccia' };
    const zs = ring.map(i => P[i][2]), planar = zs.every(z => Math.abs(z - zs[0]) < eps);
    let zAt;
    if (planar) zAt = () => zs[0];
    else if (hub !== null && star) {                                         // ventaglio: interpolazione baricentrica nel triangolo (centro, Ok, Ok+1)
      const zh = P[hub][2];
      zAt = (x, y) => {
        let u = ((Math.atan2(y, x) - un[0]) % TAU + TAU) % TAU + un[0], l = 0, h = n - 1;
        while (l < h) { const m = (l + h + 1) >> 1; if (un[m] <= u) l = m; else h = m - 1; }
        const A = P[ring[l]], B = P[ring[(l + 1) % n]], det = A[0] * B[1] - B[0] * A[1];
        if (Math.abs(det) < 1e-12) return A[2];
        const al = (x * B[1] - B[0] * y) / det, be = (A[0] * y - x * A[1]) / det;
        return zh + al * (A[2] - zh) + be * (B[2] - zh);
      };
    } else return { why: 'una faccia non è piana e non è a ventaglio' };
    return { s, ring, un: star ? un : null, rmin, zAt };
  };
  const cLo = describe(lo, hubLo), cHi = describe(hi, hubHi);
  if (cLo.why || cHi.why) return fail(cLo.why || cHi.why);
  const rmin = Math.min(cLo.rmin, cHi.rmin);
  if (bore.r > 0.85 * rmin) return fail(`foro di raggio ${+bore.r.toFixed(2)} troppo grande per il corpo (raggio minimo ${+rmin.toFixed(2)})`);

  // 3) anello del foro, con un punto per ogni vertice di un bordo "a stella", allo stesso angolo (spostato di poco se più vertici stanno
  //    sullo stesso raggio): fra due raggi consecutivi la fascia si divide in triangoli che non possono risultare rovesciati, perché il
  //    centro sta a sinistra di ogni lato di una sezione a stella.
  const spokes = c => { if (!c.un) return []; const out = []; let prev = -Infinity; for (const a of c.un) { prev = Math.max(a, prev + 2e-6); out.push(prev); } return out; };
  const sLo = spokes(cLo), sHi = spokes(cHi);
  const hr = boreRing(bore.r, bore.flat, bore.ang || 0, bore.n || BORE_SEGMENTS, sLo.concat(sHi)), nH = hr.length;
  const P2 = P.slice(), addHole = c => hr.map(h => P2.push([h.x, h.y, c.zAt(h.x, h.y)]) - 1);
  const Hlo = addHole(cLo), Hhi = addHole(cHi);
  const idxOf = a => {                                                  // indice del punto del foro all'angolo a (ricerca binaria)
    const w = ((a % TAU) + TAU) % TAU; let l = 0, h = nH - 1;
    while (l < h) { const m = (l + h) >> 1; if (hr[m].a < w - 1e-9) l = m + 1; else h = m; }
    return l;
  };

  const annulus = (c, sp, H) => {
    const { ring: O, s } = c, nO = O.length; let out = [];
    if (c.un) {
      const ix = sp.map(idxOf);
      for (let k = 0; k < nO; k++) {
        const k1 = (k + 1) % nO;
        out.push([O[k], O[k1], H[ix[k1]]]);                              // lato del corpo + punto del foro sul raggio successivo
        for (let m = ix[k]; m !== ix[k1]; m = (m + 1) % nH) out.push([O[k], H[(m + 1) % nH], H[m]]);   // ventaglio sul bordo del foro
      }
    } else {                                                             // sezione non a stella: ponte + orecchie
      const bridge = boreBridge(O.map(i => [P[i][0], P[i][1]]), hr.map(h => [h.x, h.y]));
      if (!bridge) return 'non si trova un ponte fra il bordo e il foro';
      const poly = bridge.map(([t, k]) => t === 'O' ? [P[O[k]][0], P[O[k]][1]] : [hr[k].x, hr[k].y]);
      out = boreEarClip(poly).map(t => t.map(q => bridge[q][0] === 'O' ? O[bridge[q][1]] : H[bridge[q][1]]));
    }
    // controllo: triangoli tutti antiorari (in pianta) e area totale = area del corpo − area del foro; altrimenti non si fora
    let tot = 0, aO = 0, aH = 0;
    for (let k = 0; k < nO; k++) { const p = P[O[k]], q = P[O[(k + 1) % nO]]; aO += (p[0] * q[1] - q[0] * p[1]) / 2; }
    for (let k = 0; k < nH; k++) aH += (hr[k].x * hr[(k + 1) % nH].y - hr[(k + 1) % nH].x * hr[k].y) / 2;
    for (const t of out) {
      const [A, B, C] = t.map(x => P2[x]), ar = ((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
      if (ar < -1e-6 * Math.max(1, aO)) return 'triangolo rovesciato (' + (+ar.toFixed(4)) + ')';
      tot += ar;
    }
    if (Math.abs(tot - (aO - aH)) > 1e-6 * Math.max(1, aO)) return 'area ' + (+tot.toFixed(3)) + ' invece di ' + (+(aO - aH).toFixed(3));
    return s > 0 ? out : out.map(([a, b, c2]) => [a, c2, b]);           // stesso verso del tappo originale
  };
  const aLo = annulus(cLo, sLo, Hlo), aHi = annulus(cHi, sHi, Hhi);
  if (typeof aLo === 'string' || typeof aHi === 'string') return fail('triangolazione della corona non valida: ' + (typeof aLo === 'string' ? aLo : aHi));

  // 4) parete del foro: la sua normale deve guardare verso l'asse (fuori dal materiale), nel verso di orientamento del solido
  const ori = cHi.s, wall = [];
  const orient = ([a, b, c]) => {
    const A = P2[a], B = P2[b], C = P2[c], u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
    return (-(n[0] * cx + n[1] * cy)) * ori > 0 ? [a, b, c] : [a, c, b];
  };
  for (let m = 0; m < nH; m++) {
    const m2 = (m + 1) % nH, a = Hlo[m], b = Hlo[m2], c = Hhi[m2], d = Hhi[m];
    wall.push(orient([a, b, c]), orient([a, c, d]));
  }
  return { S: { P: P2, T: keep.concat(aLo, aHi, wall) }, why: null };
}

/* Fora tutti i solidi di un ingranaggio. → { solids, skipped: [motivi per cui qualche solido non è stato forato] } */
function boreSolids(solids, bore) {
  const skipped = [];
  const out = solids.map(S => { const r = boreSolid(S, bore); if (r.why) skipped.push(r.why); return r.S; });
  return { solids: out, skipped };
}
