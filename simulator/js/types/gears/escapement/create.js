/* types/gears/escapement/create.js
   Ruota di scappamento Graham-like: denti uniti al corpo,
   faccia di blocco quasi radiale + faccia di impulso inclinata.
*/
function earClip(poly) {
  const idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const eps = 1e-9;
  const inside = (p, a, b, c) =>
    cross(a,b,p) > eps && cross(b,c,p) > eps && cross(c,a,p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = -1, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length];
      const ib = idx[k];
      const ic = idx[(k + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      const cr = cross(a, b, c);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;
      let ok = true;
      for (const j of idx)
        if (j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c)) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat;
    const ia = idx[(k + idx.length - 1) % idx.length];
    const ib = idx[k];
    const ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function extrudePolygon(poly, w0, w1) {
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i]);
  }
  for (const [a, b, c] of earClip(poly)) {
    T.push([n + a, n + b, n + c], [a, c, b]);
  }
  return { P, T };
}

function discPoly(R, segs = 48) {
  const p = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2 * Math.PI / segs;
    p.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return p;
}

/**
 * Profilo continuo della ruota di scappamento.
 * Ogni dente:
 *  - base (root)
 *  - faccia di blocco quasi radiale
 *  - punta
 *  - faccia di impulso inclinata che torna al root
 * I denti sono uniti al corpo → nessun pezzo staccato.
 */
function escapementProfile(N, R) {
  const pts = [];
  const Rroot = R * 0.68;
  const Rtip  = R;
  const pitch = 2 * Math.PI / N;

  // Larghezza angolare del dente alla base (circa 30-35% del passo)
  const baseHalf = pitch * 0.18;
  // Quanto la faccia di blocco è “radiale” (piccolo offset angolare)
  const lockOffset = pitch * 0.04;
  // Quanto la faccia di impulso è inclinata
  const impulseOffset = pitch * 0.22;

  for (let i = 0; i < N; i++) {
    const a = i * pitch;

    // 1. Punto di root a sinistra del dente
    pts.push([
      Rroot * Math.cos(a - baseHalf),
      Rroot * Math.sin(a - baseHalf)
    ]);

    // 2. Faccia di blocco (quasi radiale, leggermente sotto-taglio)
    pts.push([
      Rtip * 0.92 * Math.cos(a - lockOffset),
      Rtip * 0.92 * Math.sin(a - lockOffset)
    ]);

    // 3. Punta del dente
    pts.push([
      Rtip * Math.cos(a),
      Rtip * Math.sin(a)
    ]);

    // 4. Faccia di impulso (inclinata) che scende verso il root
    pts.push([
      Rroot * Math.cos(a + impulseOffset),
      Rroot * Math.sin(a + impulseOffset)
    ]);
  }

  // Chiudiamo il poligono (torna al primo punto)
  return pts;
}

function escapementSolids(N, w0, w1, R) {
  const solids = [];

  // Corpo centrale leggermente più piccolo del root
  const Rhub = R * 0.55;
  solids.push(extrudePolygon(discPoly(Rhub, 40), w0, w1));

  // Profilo esterno continuo (denti + root uniti)
  const profile = escapementProfile(N, R);
  solids.push(extrudePolygon(profile, w0, w1));

  return solids;
}

Registry.gear('escapement', {
  noRadiusCheck: true,
  radius: g => (g && g.r) || 30,
  solids: g => {
    const N  = (g.def && (g.def.teeth || g.def.slots)) || 30;
    const R  = (g && g.r) || 30;
    const w0 = (g.w && g.w[0] !== undefined) ? g.w[0] : -2;
    const w1 = (g.w && g.w[1] !== undefined) ? g.w[1] :  2;
    return escapementSolids(N, w0, w1, R);
  },
  cacheKey: g => [g.def && g.def.teeth, g.w, g.r],
  sigKey:   g => [g.def && g.def.teeth, g.w, g.r]
});
