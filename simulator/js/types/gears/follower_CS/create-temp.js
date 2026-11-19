/* =====================================================================
   types/gears/follower_CS/create.js
   Follower oscillante a elle (type "follower_CS")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
   ---------------------------------------------------------------------
   Pezzi: mozzo sul fulcro, braccio lungo fino al gomito, braccio corto (il naso) che finisce a punta: la punta è il punto di contatto
   con la camma. Il link fissa la direzione del braccio lungo (g.rodLocalCS, angolo locale) e la piegatura con segno (g.bendCS);
   senza link valgono "angle" e "bendAngle" (90° se manca) nel riferimento locale dell'asse. Il foro per l'asse (a D, se solidale) lo fa
   il simulatore sul solo mozzo: braccia e gomito sono marcati noBore.
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
    const a1 = g.rodLocalCS !== undefined ? g.rodLocalCS : c.angle * Math.PI / 180, bend = g.bendCS !== undefined ? g.bendCS : (c.bend !== null ? c.bend : Math.PI / 2);
    const hw = c.width / 2, L = c.L, L2 = c.L2, u1 = [Math.cos(a1), Math.sin(a1)], a2 = a1 + bend, u2 = [Math.cos(a2), Math.sin(a2)];
    // un braccio come rettangolo [da p lungo u, lunghezza len, mezza larghezza hw]; il naso finisce a punta in (gomito + L2·u2)
    const bar = (p, u, len, tipLen) => {
      const n = [-u[1], u[0]], at = (s, t) => [p[0] + u[0] * s + n[0] * t, p[1] + u[1] * s + n[1] * t];
      return tipLen > 0 ? [at(0, -hw), at(len - tipLen, -hw), at(len, 0), at(len - tipLen, hw), at(0, hw)] : [at(0, -hw), at(len, -hw), at(len, hw), at(0, hw)];
    };
    const elbow = [L * u1[0], L * u1[1]], out = [];
    out.push(extrude_fCS(bar([0, 0], u1, L, 0), w0, w1));                                                   // braccio lungo
    if (L2 > 0) {
      out.push(extrude_fCS(bar(elbow, u2, L2, Math.min(Math.max(c.width * 2.5, 5), L2 * 0.8)), w0, w1));    // naso, a punta
      const disc = cylinderSolid(hw, w0, w1, 24, elbow[0], elbow[1]); disc.noBore = true; out.push(disc);   // gomito arrotondato
    }
    out.push(cylinderSolid(c.hubR, w0, w1, 40));                                                            // mozzo (foro per l'asse)
    return out;
  },
  cacheKey: g => [g.followerCS, g.rodLocalCS, g.bendCS],
  sigKey: g => []
});
