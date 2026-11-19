/* =====================================================================
   types/gears/anchor_CS/create.js
   Ancora di Graham con pendolo (type "anchor_CS")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
   ---------------------------------------------------------------------
   Pezzi: mozzo, due bracci dritti dal mozzo (lunghezza e apertura regolabili: armLength, armAngle), due pallette (forma calcolata dal link:
   faccia di riposo ad arco centrato sul perno, faccia di impulso inclinata), eventuali raccordi fra punta dei bracci e pallette, asta e
   lente del pendolo. L'asta e la lente stanno in un piano più avanti rispetto alla piastra (rodGap), lungo la retta A→W (verso la ruota,
   cioè verso Z− se l'ancora sta sopra la ruota). Il foro per l'asse (a D, se solidale) lo fa il simulatore sul solo mozzo: gli altri pezzi
   sono marcati noBore.
   ===================================================================== */

/* Triangolazione per orecchie di un poligono semplice antiorario (copia privata di questo tipo). */
function earClip_aCS(poly) {
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

/* Prisma retto di un poligono fra w0 e w1 lungo l'asse locale z (non viene forato dal simulatore). */
function extrude_aCS(poly, w0, w1) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip_aCS(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T, noBore: true };
}

Registry.gear('anchor_CS', {
  solids(g) {
    const A = g.graham, c = g.anchorCS, [w0, w1] = g.w;
    if (!A || !c) return [cylinderSolid(c ? c.hubR : 5, w0, w1, 32)];             // senza link: solo il mozzo
    const ca = Math.cos(A.deltaA), sa = Math.sin(A.deltaA), loc = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];   // sistema dell'ancora → locale
    const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const bar = (p, q, hw) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * hw, ny = dx / l * hw;
      return [[p[0] - nx, p[1] - ny], [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny], [p[0] + nx, p[1] + ny]].map(loc); };
    const out = [];
    out.push(extrude_aCS(A.entry.map(loc), w0, w1), extrude_aCS(A.exit.map(loc), w0, w1));                      // pallette
    // bracci: estremità posteriori delle pallette (dove il braccio "naturale" le raggiunge) e bracci scelti dall'utente
    const mE = pol(A.rho - A.depth / 2, A.aR + A.arcExtra), mX = pol(A.rho + A.depth / 2, A.aL - A.arcExtra);
    const half = c.armAng != null ? Math.abs(c.armAng) * Math.PI / 360 : A.aR + A.arcExtra;                      // semi-apertura (rad)
    const lE = c.armLen != null ? c.armLen : Math.hypot(mE[0], mE[1]), lX = c.armLen != null ? c.armLen : Math.hypot(mX[0], mX[1]);
    const tE = pol(lE, half), tX = pol(lX, -half);                                                               // punte dei bracci (ingresso a +, uscita a −)
    out.push(extrude_aCS(bar([0, 0], tE, c.armW / 2), w0, w1), extrude_aCS(bar([0, 0], tX, c.armW / 2), w0, w1));
    if (c.armConn) {                                                                                             // raccordi punta del braccio → paletta
      if (Math.hypot(tE[0] - mE[0], tE[1] - mE[1]) > 0.05) out.push(extrude_aCS(bar(tE, mE, c.armW / 2), w0, w1));
      if (Math.hypot(tX[0] - mX[0], tX[1] - mX[1]) > 0.05) out.push(extrude_aCS(bar(tX, mX, c.armW / 2), w0, w1));
    }
    const z0 = w1 + c.rodGap, z1 = z0 + Math.max(1, c.rodW * 0.8), zm = (z0 + z1) / 2;
    out.push(extrude_aCS(bar([0, 0], [A.L, 0], c.rodW / 2), z0, z1));                                           // asta lungo A→W
    const [bx, by] = loc([A.L, 0]), bob = cylinderSolid(c.bobR, zm - c.bobT / 2, zm + c.bobT / 2, 48, bx, by);   // lente
    bob.noBore = true; out.push(bob);
    out.push(cylinderSolid(c.hubR, w0, w1, 48));                                                                 // mozzo (foro per l'asse)
    return out;
  },
  cacheKey: g => [g.graham, g.anchorCS, g.pendLen],
  sigKey: g => []
});
