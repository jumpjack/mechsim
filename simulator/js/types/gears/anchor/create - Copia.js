/* types/gears/anchor/create.js
   Ancora + pallet rivolti verso ruota + pendolo in mezzo sfalsato in Z
*/
function earClip(poly) {
  const idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const eps = 1e-9;
  const inside = (p, a, b, c) => cross(a,b,p) > eps && cross(b,c,p) > eps && cross(c,a,p) > eps;
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
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c)) { ok = false; break; }
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
  for (const [a, b, c] of earClip(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T };
}

function discPoly(R, segs = 24) {
  const p = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2 * Math.PI / segs;
    p.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return p;
}

function rectPoly(cx, cy, w, h, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y]) => [cx + x*c - y*s, cy + x*s + y*c]);
}

function anchorSolids({ spanDeg, armLen, palletW, palletH, pendLen, bobR, w0, w1, centerAng }) {
  const out = [];
  const span = spanDeg * Math.PI / 180;
  const leftAng  = centerAng - span/2;
  const rightAng = centerAng + span/2;
  const midAng = centerAng;

  const cm = Math.cos(midAng), sm = Math.sin(midAng);

  // mozzo
  out.push(extrudePolygon(discPoly(5, 16), w0, w1));

  // bracci - partono dal bordo mozzo
  function arm(ang) {
    const r0 = 4.5;
    const pts = [[r0,-2],[armLen,-2],[armLen,2],[r0,2]];
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return pts.map(([x,y]) => [x*ca - y*sa, x*sa + y*ca]);
  }
  out.push(extrudePolygon(arm(leftAng), w0, w1));
  out.push(extrudePolygon(arm(rightAng), w0, w1));

  // pallet rivolti verso la ruota - tangenziali al braccio
  out.push(extrudePolygon(rectPoly(armLen*Math.cos(leftAng), armLen*Math.sin(leftAng), palletW, palletH, leftAng + Math.PI/2), w0, w1));
  out.push(extrudePolygon(rectPoly(armLen*Math.cos(rightAng), armLen*Math.sin(rightAng), palletW, palletH, rightAng + Math.PI/2), w0, w1));

  // PENDOLO - CORRETTO: cresce lungo +X come i bracci, non lungo Y
  if (pendLen > 0) {
    // rettangolo da 0 a pendLen lungo X
    const rodLocal = [[0,-1.5],[pendLen,-1.5],[pendLen,1.5],[0,1.5]];
    const rod = rodLocal.map(([x,y]) => [x*cm - y*sm, x*sm + y*cm]);

    const z0 = w1 + 4;
    const z1 = z0 + 5;
    out.push(extrudePolygon(rod, z0, z1));

    // bob in punta
    const bob = discPoly(bobR, 24).map(([x,y]) => {
      const xx = x + pendLen; // sposta in punta
      return [xx*cm - y*sm, xx*sm + y*cm];
    });
    out.push(extrudePolygon(bob, z0-1, z1+1));
  }
  return out;
}

Registry.gear('anchor', {
  noRadiusCheck: true,
  radius: g => (g.def?.armLen || 38) + (g.def?.palletW || 10),
  solids: g => {
    const span    = g.def?.span ?? 90;
    const armLen  = g.def?.armLen ?? 38;
    const palletW = g.def?.palletW ?? 10;
    const palletH = g.def?.palletH ?? 6;
    const pendLen = g.def?.pendulumLength ?? g.def?.pendLen ?? 160;
    const bobR    = g.def?.bobR ?? 14;
    const centerAng = g.def?.centerAng ?? -Math.PI ; // <--- metti qui l'orientamento verso la ruota
    const w0 = g.w?.[0] ?? -2;
    const w1 = g.w?.[1] ??  2;
    return anchorSolids({ spanDeg: span, armLen, palletW, palletH, pendLen, bobR, w0, w1, centerAng });
  },
  cacheKey: g => [g.def?.span, g.def?.armLen, g.def?.palletW, g.def?.palletH, g.def?.pendulumLength, g.def?.bobR, g.def?.centerAng, g.w],
  sigKey:   g => [g.def?.span, g.def?.armLen, g.def?.palletW, g.def?.palletH, g.def?.pendulumLength, g.def?.bobR, g.def?.centerAng, g.w]
});