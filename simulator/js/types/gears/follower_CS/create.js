/* =====================================================================
   types/gears/follower_CS/create.js
   Follower (type "follower_CS")
   Meta "COME SI CREA" del tipo: geometria e mesh. La meta "COME SI RISOLVE"
   (validazione, parametri) e in solve.js.
   Pezzi: mozzo sul fulcro e asta.
   FORMA: dipende solo da g.followerCS.tipPoint, calcolato in solve.js.
   - contact "side1" / "side2": punta piatta, rettangolo
       [0,-hw] - [L,-hw] - [L,hw] - [0,hw]
   - contact "tip": becco. Vertice ESATTAMENTE in tipPoint = [L - tipShift, sideOffset].
       Se sideOffset < 0 il becco sta sotto (foto), se > 0 sta sopra.
       La spezzata e:
         becco sotto (sideOffset < 0):
           [0,-hw] - [L-tip,-hw] - tipPoint - [L,hw] - [0,hw]
         becco sopra (sideOffset > 0):
           [0,hw] - [L-tip,hw] - tipPoint - [L,-hw] - [0,-hw]
       Perche asimmetrica? Perche nella foto il bordo opposto al becco
       arriva fino a L, mentre il bordo dal lato del becco si ferma a L-tip.
       Il vertice della mesh e il punto di contatto: non spostarlo mai qui,
       si sposta solo in solve.js con sideOffset e tipShift.
   La direzione dell'asta (angolo locale) la fissa il link (g.rodLocalCS);
   senza link vale "angle" nel riferimento locale dell'asse.
   Il foro per l'asse (a D, se solidale) lo fa il simulatore sul solo mozzo:
   l'asta e marcata noBore.
   ===================================================================== */

function earClip_fCS(poly) {
  const n = poly.length, idx = poly.map((_, i) => i), tris = [], eps = 1e-9;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) > eps && cr(b, c, p) > eps && cr(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = 0, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], c = cr(poly[ia], poly[ib], poly[ic]);
      if (Math.abs(c) < flatV) { flatV = Math.abs(c); flat = k; }
      if (c <= eps) continue;
      let ok = true; for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], poly[ia], poly[ib], poly[ic])) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat, ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return n >= 3 ? tris : [];
}

function extrude_fCS(poly, w0, w1) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip_fCS(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T, noBore: true };
}

Registry.gear('follower_CS', {
  solids(g) {
    const c = g.followerCS, [w0, w1] = g.w;
    if (!c) return [cylinderSolid(5, w0, w1, 32)];
    const a = g.rodLocalCS !== undefined ? g.rodLocalCS : c.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), L = c.L, hw = c.width / 2;
    const tip = c.tip !== undefined ? c.tip : Math.min(Math.max(c.width * 3, 6), L * 0.35);
    const loc = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
    const flat = !!c.flatTip;
    let rod;
    if (flat) {
      rod = [[0, -hw], [L, -hw], [L, hw], [0, hw]].map(loc);
    } else {
      // UNICA fonte di verita: tipPoint da solve.js. Mai usare [L,0] o beakH qui.
      const tp = c.tipPoint || [L, c.sideOffset || 0];
      const tx = tp[0], ty = tp[1];
      const baseX = Math.max(0, L - tip);
      if (ty < 0) {
        // Becco sotto, come in foto: bordo sotto si ferma a baseX, bordo sopra arriva a L
        rod = [[0, -hw], [baseX, -hw], [tx, ty], [L, hw], [0, hw]].map(loc);
      } else {
        // Becco sopra, speculare
        rod = [[0, hw], [baseX, hw], [tx, ty], [L, -hw], [0, -hw]].map(loc);
      }
    }
    return [extrude_fCS(rod, w0, w1), cylinderSolid(c.hubR, w0, w1, 40)];
  },
  cacheKey: g => [g.followerCS, g.rodLocalCS],
  sigKey: g => []
});
