/* =====================================================================
   types/gears/spur/create.js
   Ingranaggio cilindrico a denti dritti (type "spur", il tipo di default)
   ===================================================================== */
function spurGear(z, m, rho, w0, w1, degStart, degEnd) {
  const prof = toothProfile(z, m, z > 120 ? 6 : 8), pitch = 2 * PI / z;
  let s, e, sector = false;
  if (degStart !== undefined && degEnd !== undefined) {
    s = degStart * PI / 180;
    e = degEnd * PI / 180;
    if (e <= s) e += 2 * PI;
    if (e - s < 2 * PI - 1e-6) sector = true;
  }
  const A = [], B = [];
  const pushPt = (r, a) => {
    const x = r * cos(a), y = r * sin(a);
    A.push([x, y, w0]); B.push([x, y, w1]);
  };
  if (!sector) {
    for (let k = 0; k < z; k++) for (const [r, d] of prof) pushPt(r, rho + k * pitch + d);
    return loft(A, B, [0, 0, w0], [0, 0, w1]);
  }
  const rbase = prof[0][0];
  pushPt(rbase, s);
  const kLo = Math.floor((s - rho) / pitch) - 1;
  const kHi = Math.ceil((e - rho) / pitch) + 1;
  for (let k = kLo; k <= kHi; k++) {
    for (const [r, d] of prof) {
      const a = rho + k * pitch + d;
      if (a > s + 1e-9 && a < e - 1e-9) pushPt(r, a);
    }
  }
  pushPt(rbase, e);
  pushPt(0, 0);
  return loft(A, B, [0, 0, w0], [0, 0, w1]);
}

Registry.gear('spur', {
  // dichiarato anche qui: se solve.js non si fonde, la presa spur↔spur resta valida
  meshWith: ['spur'],
  solids: g => [spurGear(g.z, g.m, g.rho, g.w[0], g.w[1], g.def.degStart, g.def.degEnd)],
  cacheKey: g => [g.def.degStart, g.def.degEnd],
  sigKey: g => [g.def.degStart, g.def.degEnd]
});
