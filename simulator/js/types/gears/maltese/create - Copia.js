/* =====================================================================
   types/gears/maltese/create.js
   Croce di Malta (type "maltese"), la ruota condotta di un link "geneva"
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
/* ---- Croce di Malta -------------------------------------------------------------------------------------------
   Triangolazione dei contorni: i "coperchi" non si possono fare a ventaglio dal centro (la croce non è una figura "stellata":
   le scanalature coprirebbero i lati), quindi si taglia il poligono per orecchie.                                       */
function earClip(poly) {                       // poly: [[x, y], ...] in senso antiorario, semplice → lista di triangoli [i, j, k]
  const n = poly.length, idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const eps = 1e-9;
  const strictlyInside = (p, a, b, c) => cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = -1, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic], cr = cross(a, b, c);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;                                                  // angolo rientrante o piatto
      let ok = true;
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && strictlyInside(poly[j], a, b, c)) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat;                                          // nessun orecchio: si scarta il vertice più piatto (area ≈ 0) e si prosegue
    const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/* Prisma retto di un poligono (antiorario) tra w0 e w1 lungo l'asse z locale: {P, T} come loft(). */
function extrudePolygon(poly, w0, w1) {
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T };
}

/* Contorno della croce.  N scanalature, interasse a, raggio del perno r (a·sin(π/N) = r nel Geneva corretto), larghezza scanalatura 2h.
   - punte delle braccia a R = √(a²−r²): è dove il perno entra nella scanalatura (tangente, velocità della croce = 0);
   - fondo della scanalatura: semicerchio di raggio h centrato a distanza a−r dal centro (il perno arriva fino lì);
   - tra due scanalature il bordo è l'arco concavo del disco di blocco della manovella (centro sull'asse della manovella, raggio ρ).
   La scanalatura 0 è lungo +x locale (riferimento dell'asse); le altre a passo 2π/N.                                  */
function malteseOutline(N, a, r, h) {
  const R = Math.sqrt(Math.max(0, a * a - r * r));
  h = Math.min(h, 0.9 * R * Math.sin(Math.PI / N), 0.45 * (a - r));
  const x1 = Math.sqrt(R * R - h * h), xc = a - r;
  const dTip = Math.atan2(h, x1), dMax = Math.PI / N - dTip;
  const rho = Math.sqrt(R * R + a * a - 2 * R * a * Math.cos(dMax));          // disco di blocco: passa per le punte
  const nearR = d => a * Math.cos(d) - Math.sqrt(Math.max(0, rho * rho - a * a * Math.sin(d) ** 2));
  const rot = (x, y, t) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
  const poly = [], nArc = 14, nSemi = 8;
  for (let k = 0; k < N; k++) {
    const th = k * 2 * Math.PI / N;
    poly.push(rot(x1, -h, th), rot(xc, -h, th));                               // lato inferiore, dalla punta al fondo
    for (let i = 1; i < nSemi; i++) { const p = -Math.PI / 2 - Math.PI * i / nSemi; poly.push(rot(xc + h * Math.cos(p), h * Math.sin(p), th)); }
    poly.push(rot(xc, h, th), rot(x1, h, th));                                 // lato superiore, dal fondo alla punta
    const psi = th + Math.PI / N;                                              // centro del braccio
    for (let i = 1; i < nArc; i++) { const d = -dMax + 2 * dMax * i / nArc, rr = nearR(d); poly.push([rr * Math.cos(psi + d), rr * Math.sin(psi + d)]); }
  }
  return { poly, R, rho, h };
}

/* geo = { a, r, s0 } viene dal link "geneva" (g.geneva): interasse, raggio del perno, angolo della scanalatura 0 nel riferimento della croce.
   Senza link si ricava un Geneva coerente da R_out (raggio delle punte) con la scanalatura 0 lungo ref. */
function malteseSolid(N, w0, w1, geo, slotWidth, R_out) {
  let a, r;
  if (geo && geo.a > 0 && geo.r > 0 && geo.r < geo.a) ({ a, r } = geo);
  else { const R = R_out || 50; a = R / Math.cos(Math.PI / N); r = R * Math.tan(Math.PI / N); }
  const R = Math.sqrt(a * a - r * r), s0 = (geo && geo.s0) || 0, c = Math.cos(s0), s = Math.sin(s0);
  const poly = malteseOutline(N, a, r, (slotWidth || 0.12 * R) / 2).poly.map(([x, y]) => [x * c - y * s, x * s + y * c]);   // la scanalatura 0 va dove la cerca il link
  return extrudePolygon(poly, w0, w1);
}

Registry.gear('maltese', {
  solids: g => [malteseSolid(g.def.slots || (g.geneva && g.geneva.N) || 4, g.w[0], g.w[1], g.geneva, g.def.slotWidth, g.r)],
  cacheKey: g => [g.def.slots, g.def.slotWidth, g.geneva],
  sigKey: g => [g.def.slots, g.def.slotWidth, g.geneva]
});
