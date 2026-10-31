/* =====================================================================
   types/gears/bevel/create.js
   Ingranaggio conico (type "bevel")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
function bevelGear(z, m, delta, rho, k0) {
  const R = m * z / 2, wp = R / Math.tan(delta);
  const zVirtual = z / cos(delta), rVirtual = R / cos(delta);
  const prof = toothProfile(zVirtual, m, 8), pitchV = 2 * PI / zVirtual, P = [];
  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / cos(delta);
      const s = r - rVirtual;
      const q = R + s * cos(delta);
      P.push([q * cos(t), q * sin(t), wp - s * sin(delta)]);
    }
  }
  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  return loft(P.map(p => p.map(v => v * k0)), P, [0, 0, k0 * wMean], [0, 0, wMean]);
}

Registry.gear('bevel', {
  solids(g) {
    const out = [bevelGear(g.z, g.m, g.delta, g.rho, g.def.k0 || 0.7)], pl = g.def.plate;
    if (pl) { const wp = g.r / Math.tan(g.delta); out.push(cylinderSolid(pl.k * g.r, wp + pl.from, wp + pl.to, pl.n || 48)); }
    return out;
  },
  cacheKey: g => [g.delta, g.def.plate, g.def.k0],
  markerZ: g => g.r * 0.2              // senza "w" il marker sta a 0,2·r lungo l'asse
});
