/* =====================================================================
   types/gears/worm/solve.js
   Vite senza fine (type "worm")
   Metà "COME SI RISOLVE" + validazione interasse worm/wheel
   ===================================================================== */
Registry.gear('worm', {
  meshWith: ['wormwheel'],
  toothPhase: false,

  defaultTeeth: (g, ev) => ev(g.def.starts === undefined ? 1 : g.def.starts),
  radius: (g, { ev, teeth, module }) => g.def.q !== undefined ? ev(g.def.q) * module(g) / 2 : teeth(g) * module(g) / 2,
  anchorOffset: (g, { vec }) => { const w = vec(g.def.w); return (w[0] + w[1]) / 2; },

  validate(g, w, { E, isVec }) {
    if (g.q === undefined) E(`${w}: manca "q"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  },

  resolve(g, { ev }) {
    g.hand = g.def.hand || 1;
    g.wp = wormParams(g.m, ev(g.def.q), g.z, g.hand, g.w[1] - g.w[0]);
    step('vite', `${g.id}: principi=${g.z}, q=${ev(g.def.q)}, rp=${+g.wp.rp.toFixed(3)}, passo=${+g.wp.px.toFixed(3)}`);
  },

  /* Controllo interasse lato vite (simmetrico a quello della ruota) */
  contact(g, p) {
    // g = vite, p = ruota
    const offG = (g.w[0] + g.w[1]) / 2;
    const offP = (p.w[0] + p.w[1]) / 2;
    const Og = V.add(g.ax.O, V.mul(g.ax.dir, offG));
    const Op = V.add(p.ax.O, V.mul(p.ax.dir, offP));
    const delta = V.sub(Op, Og);

    const dotAxes = V.dot(g.ax.dir, p.ax.dir);
    const cross = V.cross(g.ax.dir, p.ax.dir);
    const crossLen = V.len(cross);
    const dist = crossLen < 1e-9 ? V.len(delta) : Math.abs(V.dot(delta, cross)) / crossLen;
    const expected = g.r + p.r; // = m*(q+z2)/2

    // tolleranza: 1% del modulo o 0.05 mm
    const tol = Math.max(0.05, g.m * 0.05);
    step('ingranamento', `${p.id} (ruota z=${p.z}) ⇄ ${g.id} (vite q=${g.wp.q / g.m}): interasse misurato ${dist.toFixed(3)} mm, atteso ${expected.toFixed(3)} mm`);

    if (Math.abs(dotAxes) > 0.02) {
      warn('ingranamento', `Vite ${g.id} – ruota ${p.id}: assi non perpendicolari (dot=${dotAxes.toFixed(3)}), atteso 0`);
    }
    // proiezione del vettore interasse sugli assi deve essere ~0 se gli anchor sono allineati
    const projG = V.dot(delta, g.ax.dir);
    const projP = V.dot(delta, p.ax.dir);
    if (Math.abs(projG) > tol || Math.abs(projP) > tol) {
      warn('ingranamento', `Vite ${g.id} – ruota ${p.id}: anchor disallineati, proiezioni ${projG.toFixed(3)}, ${projP.toFixed(3)} mm`);
    }
    if (Math.abs(dist - expected) > tol) {
      // usa E se vuoi bloccare, W se vuoi solo avvisare
      warn('ingranamento', `⛔ INTERASSE ERRATO Vite ${g.id} – ruota ${p.id}: misurato ${dist.toFixed(3)} mm invece di ${expected.toFixed(3)} mm (q=${g.wp.q / g.m}, z2=${p.z}, m=${g.m}). Correggi la place di axis_worm: dovrebbe essere (q+z2)*m/2 = ${expected.toFixed(3)}`);
    }

    const uc = V.unit(V.perp(V.sub(p.ax.O, g.ax.O), g.ax.dir));
    p.sprime = Math.sign(V.dot(p.ax.dir, V.cross(g.ax.dir, uc))) || 1;
    return { X: Og, cg: uc, cp: V.mul(uc, -1) };
  }
});