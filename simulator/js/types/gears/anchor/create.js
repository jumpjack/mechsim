/* types/gears/anchor/create.js
   Ancora / pallet Graham-like:
   - bracci eleganti
   - pallet con faccia di blocco (quasi concentrica) + faccia di impulso inclinata
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

function discPoly(R, segs = 24) {
  const p = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2 * Math.PI / segs;
    p.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return p;
}

/**
 * Genera un pallet Graham-like.
 * - faccia di blocco (quasi concentrica rispetto al centro ancora)
 * - faccia di impulso inclinata
 */
function palletPoly(armLen, ang, palletW, palletH, isEntry) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = ca, ry = sa;
  const tx = -sa, ty = ca;

  const lockLen = palletH * 0.55;
  const impulseLen = palletH * 0.55;
  const thick = palletW * 0.55;
  const sign = isEntry ? 1 : -1;

  const ptsLocal = [
    [-thick * 0.3, -lockLen * 0.9],
    [ thick * 0.9, -lockLen],
    [ thick * 1.0,  0],
    [ thick * 0.4,  impulseLen],
    [-thick * 0.4,  impulseLen * 0.6]
  ];

  return ptsLocal.map(([u, v]) => {
    const vv = v * sign;
    const x = armLen * rx + u * rx + vv * tx;
    const y = armLen * ry + u * ry + vv * ty;
    return [x, y];
  });
}

function armPoly(ang, armLen, width = 4.2) {
  const r0 = 5.5;
  const half = width / 2;
  const pts = [
    [r0, -half],
    [armLen - 2, -half * 0.85],
    [armLen - 2,  half * 0.85],
    [r0,  half]
  ];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
}

function anchorSolids({ spanDeg, armLen, palletW, palletH, pendLen, bobR, w0, w1, centerAng }) {
  const out = [];
  const span = spanDeg * Math.PI / 180;
  const leftAng  = centerAng - span / 2;
  const rightAng = centerAng + span / 2;
  const midAng  = centerAng;
  const cm = Math.cos(midAng), sm = Math.sin(midAng);

  // mozzo centrale
  out.push(extrudePolygon(discPoly(6.5, 20), w0, w1));

  // bracci
  out.push(extrudePolygon(armPoly(leftAng,  armLen), w0, w1));
  out.push(extrudePolygon(armPoly(rightAng, armLen), w0, w1));

  // pallet (entry = sinistra, exit = destra)
  out.push(extrudePolygon(
    palletPoly(armLen, leftAng,  palletW, palletH, true),
    w0, w1
  ));
  out.push(extrudePolygon(
    palletPoly(armLen, rightAng, palletW, palletH, false),
    w0, w1
  ));

  // asta + bob del pendolo
  if (pendLen > 0) {
    const rodLocal = [[0, -1.8], [pendLen, -1.8], [pendLen, 1.8], [0, 1.8]];
    const rod = rodLocal.map(([x, y]) => [x * cm - y * sm, x * sm + y * cm]);
    const z0 = w1 + 3;
    const z1 = z0 + 5;
    out.push(extrudePolygon(rod, z0, z1));

    const bob = discPoly(bobR, 28).map(([x, y]) => {
      const xx = x + pendLen;
      return [xx * cm - y * sm, xx * sm + y * cm];
    });
    out.push(extrudePolygon(bob, z0 - 1.5, z1 + 1.5));
  }

  return out;
}

function toRadFromDeg(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v * Math.PI / 180;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s.endsWith('deg')) return parseFloat(s) * Math.PI / 180;
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return n * Math.PI / 180;
  }
  return null;
}

function computeAutoAngle(g) {
  try {
    const model = g.model || g.system || globalThis.model || globalThis.project || globalThis.machine || Registry?.model;
    const axes = model?.axes || g.model?.axes || globalThis.model?.axes || globalThis.project?.axes;
    const gears = model?.gears || [];
    const links = model?.links || [];
    if (!axes) return null;

    const anchorAxisId = g.axis || g.def?.axis || 'anc';
    let driverAxisId = null;

    const myId = g.def?.id || g.id || 'ancora';
    const link = links.find(l => l.driven === myId);
    if (link) {
      const driverGear = gears.find(gg => gg.id === link.driver);
      if (driverGear) driverAxisId = driverGear.axis;
    }
    if (!driverAxisId) driverAxisId = 'esc';

    const aAx = axes.find(a => a.id === anchorAxisId);
    const dAx = axes.find(a => a.id === driverAxisId);
    if (!aAx || !dAx) return null;

    const aPos = aAx.place?.at || [0, 0, 0];
    const dPos = dAx.place?.at || [0, 0, 0];
    return Math.atan2(dPos[1] - aPos[1], dPos[0] - aPos[0]);
  } catch (e) {
    return null;
  }
}

Registry.gear('anchor', {
  noRadiusCheck: true,
  radius: g => (g.armLen ?? 38) + (g.palletW ?? 10),
  solids: g => {
    const span    = g.span    ?? 90;
    const armLen  = g.armLen  ?? 38;
    const palletW = g.palletW ?? 10;
    const palletH = g.palletH ?? 8;
    const pendLen = g.pendLen ?? 160;
    const bobR    = g.bobR    ?? 14;
    const w0 = g.w?.[0] ?? -2;
    const w1 = g.w?.[1] ??  2;

    let raw = g.def?.relPos;
    if (raw === undefined) raw = g.def?.centerAng;
    let centerAng;

    if (typeof raw === 'string' && raw.toLowerCase().trim() === 'auto') {
      centerAng = computeAutoAngle(g);
      if (centerAng === null) centerAng = -Math.PI;
    } else if (raw !== undefined) {
      const r = toRadFromDeg(raw);
      centerAng = r !== null ? r : -Math.PI;
    } else {
      centerAng = computeAutoAngle(g);
      if (centerAng === null) centerAng = -Math.PI;
    }

    return anchorSolids({
      spanDeg: span, armLen, palletW, palletH,
      pendLen, bobR, w0, w1, centerAng
    });
  },
  cacheKey: g => [g.span, g.armLen, g.palletW, g.palletH, g.pendLen, g.bobR, g.def?.relPos, g.def?.centerAng, g.w],
  sigKey:   g => [g.span, g.armLen, g.palletW, g.palletH, g.pendLen, g.bobR, g.def?.relPos, g.def?.centerAng, g.w]
});
