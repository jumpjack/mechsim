/* =====================================================================
   types/gears/wormwheel/create.js
   Ruota per vite senza fine (type "wormwheel")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
const wheelFace = (m, wp) => 1.7 * Math.sqrt(4.5 * m * wp.rp);

function wormWheelSolid(z, m, wp, sg, rho, w0, w1) {
  const rg = z * m / 2, a = wp.rp + rg, t = Math.tan(PRESSURE), e = 0.03 * m;
  const rc = wp.ra + 0.25 * m, rBlank = rg + m;
  const inCutter = (Y, Zc, xt) => {
    const r = Math.hypot(Y, Zc);
    if (r > rc) return false;
    if (r <= wp.rr) return true;
    let u = xt - wp.hand * wp.lead / (2 * PI) * Math.atan2(Zc, Y); u -= wp.px * Math.round(u / wp.px);
    return Math.abs(u) <= wp.px / 4 - (r - wp.rp) * t + e;
  };
  const cut = (r, phiP, zP) => {
    const lim = (a - rc) / r;
    if (lim >= 1) return false;
    const Pm = Math.acos(Math.max(-1, lim)), NS = 90;
    for (let s = 0; s <= NS; s++) {
      const Phi = -Pm + 2 * Pm * s / NS, X = sg * r * Math.sin(Phi);
      if (Math.abs(X) > wp.L / 2) continue;
      if (inCutter(a - r * Math.cos(Phi), sg * zP, X - sg * rg * (Phi - phiP))) return true;
    }
    return false;
  };
  const nPhi = 40, nZ = 17, pitch = 2 * PI / z, rLo = a - rc - 0.5 * m, table = [];
  for (let iz = 0; iz < nZ; iz++) {
    const zP = w0 + (w1 - w0) * iz / (nZ - 1), row = [];
    for (let ip = 0; ip < nPhi; ip++) {
      const phiP = pitch * ip / nPhi;
      let r = rBlank;
      if (cut(rBlank, phiP, zP)) {
        let lo = rLo, hi = rBlank;
        for (let b = 0; b < 16; b++) { const mid = (lo + hi) / 2; if (cut(mid, phiP, zP)) hi = mid; else lo = mid; }
        r = lo;
      }
      row.push(r);
    }
    table.push(row);
  }
  const rings = table.map((row, iz) => {
    const zP = w0 + (w1 - w0) * iz / (nZ - 1), ring = [];
    for (let k = 0; k < z; k++) for (let ip = 0; ip < nPhi; ip++) {
      const ang = rho + (k * nPhi + ip) * 2 * PI / (z * nPhi);
      ring.push([row[ip] * cos(ang), row[ip] * sin(ang), zP]);
    }
    return ring;
  });
  return ringsLoft(rings, [0, 0, w0], [0, 0, w1]);
}

Registry.gear('wormwheel', {
  solids: g => [wormWheelSolid(g.z, g.m, g.partner.wp, g.sprime, g.rho, g.w[0], g.w[1])],
  cacheKey: g => [g.partner && g.partner.wp, g.sprime]
});
