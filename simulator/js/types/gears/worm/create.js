/* =====================================================================
   types/gears/worm/create.js
   Vite senza fine (type "worm")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
function wormParams(m, q, starts, hand, L) {
  const rp = q * m / 2;
  return { m, rp, ra: rp + m, rr: rp - 1.2 * m, px: PI * m, lead: starts * PI * m, starts, hand, L };
}

function wormRadius(wp, u) {
  const au = Math.abs(u), t = Math.tan(PRESSURE);
  const tipHalf = (wp.px / 2 - 2 * (wp.ra - wp.rp) * t) / 2, rootHalf = (wp.px / 2 + 2 * (wp.rp - wp.rr) * t) / 2;
  if (au <= tipHalf) return wp.ra;
  if (au >= rootHalf) return wp.rr;
  return wp.ra - (au - tipHalf) * (wp.ra - wp.rr) / (rootHalf - tipHalf);
}

function wormSolid(wp, rho, w0, w1) {
  const n = 96, nx = Math.max(2, Math.ceil((w1 - w0) / (wp.px / 20))), wc = (w0 + w1) / 2, k = wp.hand * wp.lead / (2 * PI);
  const rings = [];
  for (let i = 0; i <= nx; i++) {
    const x = w0 + (w1 - w0) * i / nx, ring = [];
    for (let j = 0; j < n; j++) {
      const psi = 2 * PI * j / n;
      let u = x - wc - k * psi; u -= wp.px * Math.round(u / wp.px);
      const r = wormRadius(wp, u), a = rho + psi;
      ring.push([r * cos(a), r * sin(a), x]);
    }
    rings.push(ring);
  }
  return ringsLoft(rings, [0, 0, w0], [0, 0, w1]);
}


Registry.gear('worm', {
  solids: g => [wormSolid(g.wp, g.rho, g.w[0], g.w[1])],
  cacheKey: g => [g.wp]
});
