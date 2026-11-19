/* =====================================================================
   types/gears/escape_wheel_CS/create.js
   Ruota di scappamento (type "escape_wheel_CS")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
   ---------------------------------------------------------------------
   Un solo corpo: corona + denti a sega con gancio, che nascono dalla corona (si sovrappongono alla corona, nessuno è "staccato"),
   razze e mozzo. Il foro dell'asse (a D, se solidale) lo fa il simulatore sul solo mozzo: gli altri pezzi sono marcati noBore.
   La posizione dei denti (fase) la fissa il link: all'avvio un dente poggia sulla paletta d'ingresso.
   ===================================================================== */

/* Triangolazione per orecchie di un poligono semplice antiorario (copia privata di questo tipo). */
function earClip_wCS(poly) {
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

/* Prisma retto di un poligono fra w0 e w1 lungo l'asse locale z. */
function extrude_wCS(poly, w0, w1) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip_wCS(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T, noBore: true };
}

/* Corona circolare (cilindro cavo) fra rIn e rOut. */
function ring_wCS(rOut, rIn, w0, w1, n) {
  const P = [], T = [];
  for (const [r, z] of [[rOut, w0], [rOut, w1], [rIn, w0], [rIn, w1]]) for (let i = 0; i < n; i++) P.push([r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n), z]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i]);                         // parete esterna
    T.push([2 * n + j, 2 * n + i, 3 * n + j], [2 * n + i, 3 * n + i, 3 * n + j]);   // parete interna
    T.push([n + i, n + j, 3 * n + j], [n + i, 3 * n + j, 3 * n + i]); // faccia superiore
    T.push([i, 2 * n + j, j], [i, 2 * n + i, 2 * n + j]);             // faccia inferiore
  }
  return { P, T, noBore: true };
}

Registry.gear('escape_wheel_CS', {
  solids(g) {
    const W = g.graham, c = g.wheelCS, [w0, w1] = g.w, R = g.r;
    if (!W || !c) return [cylinderSolid(R, w0, w1, 64)];                          // senza link: disco semplice
    const N = W.N, p = 2 * Math.PI / N, Rr = R - c.depth, rIn = Math.max(c.hubR + 1, Rr - c.rimWidth), lead = -c.hook * Math.PI / 180, valley = c.valley * Math.PI / 180;
    const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)], out = [];
    out.push(ring_wCS(Rr, rIn, w0, w1, Math.max(96, N * 4)));                     // corona
    for (let m = 0; m < N; m++) {                                                 // denti: dorso lungo, punta a R, faccia anteriore con gancio
      const t = W.phi0Local + m * p;
      out.push(extrude_wCS([pol(Rr, t - p + lead + valley), pol(R, t), pol(Rr, t + lead), pol(Rr - 1.5, t + lead), pol(Rr - 1.5, t - p + lead + valley)], w0, w1));
    }
    const zm = (w0 + w1) / 2, hz = 0.35 * (w1 - w0), sw = 0.09 * R / 2;            // razze: più sottili della corona
    for (let j = 0; j < c.spokes; j++) {
      const a = W.phi0Local + (j + 0.5) * 2 * Math.PI / c.spokes, e = [Math.cos(a), Math.sin(a)], nn = [-e[1], e[0]], r0 = c.hubR - 1, r1 = rIn + 1;
      out.push(extrude_wCS([[e[0] * r0 - nn[0] * sw, e[1] * r0 - nn[1] * sw], [e[0] * r1 - nn[0] * sw, e[1] * r1 - nn[1] * sw], [e[0] * r1 + nn[0] * sw, e[1] * r1 + nn[1] * sw], [e[0] * r0 + nn[0] * sw, e[1] * r0 + nn[1] * sw]], zm - hz, zm + hz));
    }
    out.push(cylinderSolid(c.hubR, w0, w1, 48));                                  // mozzo: il simulatore ci pratica il foro per l'asse
    return out;
  },
  cacheKey: g => [g.graham, g.wheelCS],
  sigKey: g => []
});
