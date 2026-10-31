/* =====================================================================
   types/gears/wormwheel/solve.js
   Ruota per vite senza fine (type "wormwheel")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
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

  /* Larghezza di fascia: dipende dalla vite accoppiata (wheelFace è in create.js). */
  afterPairs(g, { ev, vec }) {
    if (!g.partner || g.partner.type !== 'worm') throw new Error(`${g.id}: una ruota per vite deve avere meshWith = una vite`);
    const f = g.def.face !== undefined ? ev(g.def.face) : wheelFace(g.m, g.partner.wp);
    g.w = g.def.w ? vec(g.def.w) : [-f / 2, f / 2];
    step('ruota-vite', `${g.id}: larghezza di fascia ${+f.toFixed(2)} mm`);
  },

  /* Contatto vite/ruota: la ruota (g) tocca la vite (p) sul proprio asse-interasse. Imposta anche il segno g.sprime. */
  contact(g, p) {
    const uc = V.unit(V.perp(V.sub(g.ax.O, p.ax.O), p.ax.dir));
    const dist = V.len(V.perp(V.sub(g.ax.O, p.ax.O), p.ax.dir));
    step('ingranamento', `${g.id} (ruota, z=${g.z}) ⇄ ${p.id} (vite): interasse ${dist.toFixed(3)} mm (atteso ${(g.r + p.r).toFixed(3)})`);
    if (Math.abs(dist - (g.r + p.r)) > 1e-6) warn('ingranamento', `Vite ${p.id} – ruota ${g.id}: interasse ${dist.toFixed(3)} invece di ${(g.r + p.r).toFixed(3)}`);
    if (Math.abs(V.dot(g.ax.dir, p.ax.dir)) > 1e-6 || Math.abs(V.dot(g.ax.dir, uc)) > 1e-6) warn('ingranamento', `Vite ${p.id} – ruota ${g.id}: l'asse della ruota non è perpendicolare alla vite e all'interasse`);
    g.sprime = Math.sign(V.dot(g.ax.dir, V.cross(p.ax.dir, uc))) || 1;
    return { X: V.add(g.ax.O, V.mul(uc, -g.r)), cg: V.mul(uc, -1), cp: uc };
  },

  /* Equazione di presa: z_ruota·ω_ruota + (verso)·principi·ω_vite = 0 (non è un semplice rapporto fra denti). */
  meshRow(m, n) {
    const row = new Array(n).fill(0);
    row[m.g.ax.idx] += m.g.z;
    row[m.p.ax.idx] += m.p.hand * m.g.sprime * m.p.z;
    return row;
  }
});
