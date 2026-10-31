/* =====================================================================
   types/gears/worm/solve.js
   Vite senza fine (type "worm")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('worm', {
  meshWith: ['wormwheel'],
  toothPhase: false,           // nessuna mezza fase fra vite e ruota

  defaultTeeth: (g, ev) => ev(g.def.starts === undefined ? 1 : g.def.starts),           // "teeth" = numero di principi (starts)
  radius: (g, { ev, teeth, module }) => g.def.q !== undefined ? ev(g.def.q) * module(g) / 2 : teeth(g) * module(g) / 2,   // r = q·m/2
  anchorOffset: (g, { vec }) => { const w = vec(g.def.w); return (w[0] + w[1]) / 2; },   // l'interasse si misura a metà lunghezza

  validate(g, w, { E, isVec }) {
    if (g.q === undefined) E(`${w}: manca "q"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  },

  resolve(g, { ev }) {
    g.hand = g.def.hand || 1;
    g.wp = wormParams(g.m, ev(g.def.q), g.z, g.hand, g.w[1] - g.w[0]);
    step('vite', `${g.id}: principi=${g.z}, passo destro=${g.hand > 0}, rp=${+g.wp.rp.toFixed(3)}, passo assiale=${+g.wp.px.toFixed(3)}, lunghezza=${+g.wp.L.toFixed(2)}`);
  }
});
