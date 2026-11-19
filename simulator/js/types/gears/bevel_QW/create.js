/* =====================================================================
types/gears/bevel_QW/create.js
Ingranaggio conico (type "bevel_QW")
Usa pos e thickness invece di w. Gestisce free e bore.
===================================================================== */

function bevelGear_QW(z, m, delta, rho, pos, thickness, k0) {
  const R = m * z / 2;
  const wp = R / Math.tan(delta);
  const zVirtual = z / cos(delta);
  const rVirtual = R / cos(delta);
  const prof = toothProfile(zVirtual, m, 8);
  const pitchV = 2 * PI / zVirtual;
  const P = [];

  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / cos(delta);
      const s = r - rVirtual;
      const q = R + s * cos(delta);
      const zRel = wp - s * sin(delta);
      P.push([q * cos(t), q * sin(t), zRel]);
    }
  }

  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  const halfThick = thickness / 2;

  const P_inner = P.map(p => [p[0] * k0, p[1] * k0, p[2] * k0]);
  const P_outer = P;

  const zOffset = pos - wMean;
  const P_inner_shifted = P_inner.map(p => [p[0], p[1], p[2] + zOffset - halfThick]);
  const P_outer_shifted = P_outer.map(p => [p[0], p[1], p[2] + zOffset + halfThick]);

  return loft(P_inner_shifted, P_outer_shifted, [0, 0, pos - halfThick], [0, 0, pos + halfThick]);
}

Registry.gear('bevel_QW', {
  solids(g) {
    const pos = g.def.pos !== undefined ? ev(g.def.pos) : 0;
    const thickness = g.def.thickness !== undefined ? ev(g.def.thickness) : 10;
    const k0 = g.def.k0 || 0.7;

    const out = [bevelGear_QW(g.z, g.m, g.delta, g.rho, pos, thickness, k0)];

    const pl = g.def.plate;
    if (pl) {
      out.push(cylinderSolid(pl.k * g.r, pos - thickness/2 + pl.from, pos - thickness/2 + pl.to, pl.n || 48));
    }

    if (g.bore !== undefined && g.bore !== false) {
      const boreR = typeof g.bore === 'object' ? ev(g.bore.r) / 2 : ev(g.bore) / 2;
      if (boreR > 0) {
        const boreSolid = cylinderSolid(boreR, pos - thickness/2 - 1, pos + thickness/2 + 1, 24);
        out.push({ type: 'subtract', solid: boreSolid });
      }
    }

    return out;
  },
  cacheKey: g => [g.delta, g.def.pos, g.def.thickness, g.def.plate, g.def.k0, g.def.bore],
  markerZ: g => {
    const pos = g.def.pos !== undefined ? ev(g.def.pos) : 0;
    return pos + g.r * 0.2;
  }
});