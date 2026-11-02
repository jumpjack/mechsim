/* =====================================================================
   types/gears/wormwheel/solve.js
   Ruota per vite senza fine (type "wormwheel")
   FIX interasse + FIX w non centrato sull'origine
   ===================================================================== */
Registry.gear('wormwheel', {
  meshWith: ['worm'],
  minTeeth: 3,
  toothPhase: false,

  validate(g, w, { E }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!g.meshWith) E(`${w}: una ruota per vite senza fine deve avere meshWith = la vite`);
  },

  /* Larghezza di fascia: dipende dalla vite. Se c'è pos/thickness, centra la fascia lì. */
  afterPairs(g, { ev, vec }) {
    if (!g.partner || g.partner.type !== 'worm') throw new Error(`${g.id}: una ruota per vite deve avere meshWith = una vite`);
    const f = g.def.face !== undefined ? ev(g.def.face) : wheelFace(g.m, g.partner.wp);
    if (g.def.w !== undefined) {
      g.w = vec(g.def.w);
    } else if (g.def.pos !== undefined) {
      const pos = ev(g.def.pos);
      const th = g.def.thickness !== undefined ? ev(g.def.thickness) : f;
      const center = pos + th/2;
      g.w = [center - f/2, center + f/2];
    } else {
      g.w = [-f/2, f/2];
    }
    step('ruota-vite', `${g.id}: larghezza fascia ${f.toFixed(2)} mm, w=[${g.w[0].toFixed(2)}, ${g.w[1].toFixed(2)}]`);
  },

  /* Contatto vite/ruota con controllo interasse robusto */
  contact(g, p) {
    // g = ruota, p = vite
    const offG = (g.w[0] + g.w[1]) / 2;
    const offP = (p.w[0] + p.w[1]) / 2;
    const Og = V.add(g.ax.O, V.mul(g.ax.dir, offG));
    const Op = V.add(p.ax.O, V.mul(p.ax.dir, offP));
    const delta = V.sub(Og, Op);

    const dotAxes = V.dot(g.ax.dir, p.ax.dir);
    const cross = V.cross(g.ax.dir, p.ax.dir);
    const crossLen = V.len(cross);
    const dist = crossLen < 1e-9 ? V.len(delta) : Math.abs(V.dot(delta, cross)) / crossLen;
    const expected = g.r + p.r; // m*(q+z)/2

    const tol = Math.max(0.05, g.m * 0.05);
    step('ingranamento', `${g.id} (ruota z=${g.z}) ⇄ ${p.id} (vite q=${(p.wp.q/g.m).toFixed(1)}): interasse misurato ${dist.toFixed(3)} mm, atteso ${expected.toFixed(3)} mm (m*(q+z)/2)`);

    if (Math.abs(dotAxes) > 0.02) {
      warn('ingranamento', `Vite ${p.id} – ruota ${g.id}: assi non perpendicolari (dot=${dotAxes.toFixed(3)})`);
    }
    const projG = V.dot(delta, g.ax.dir);
    const projP = V.dot(delta, p.ax.dir);
    if (Math.abs(projG) > tol || Math.abs(projP) > tol) {
      warn('ingranamento', `Vite ${p.id} – ruota ${g.id}: anchor disallineati, proiezioni su assi ${projG.toFixed(3)}, ${projP.toFixed(3)} mm`);
    }
    if (Math.abs(dist - expected) > tol) {
      warn('ingranamento', `⛔ INTERASSE ERRATO Vite ${p.id} – ruota ${g.id}: misurato ${dist.toFixed(3)} mm invece di ${expected.toFixed(3)} mm. Formula: a = m*(q+z2)/2 = ${g.m}*(${p.wp.q/g.m}+${g.z})/2`);
    }

    const uc = V.unit(V.perp(V.sub(g.ax.O, p.ax.O), p.ax.dir));
    g.sprime = Math.sign(V.dot(g.ax.dir, V.cross(p.ax.dir, uc))) || 1;
    return { X: V.add(g.ax.O, V.mul(uc, -g.r)), cg: V.mul(uc, -1), cp: uc };
  },

  meshRow(m, n) {
    const row = new Array(n).fill(0);
    row[m.g.ax.idx] += m.g.z;
    row[m.p.ax.idx] += m.p.hand * m.g.sprime * m.p.z;
    return row;
  }
});