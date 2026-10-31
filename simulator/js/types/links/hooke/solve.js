/* =====================================================================
   types/links/hooke/solve.js
   Snodo di Hooke (link "hooke"): rapporto di trasmissione variabile fra due assi incidenti
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
const hookeRatio = (h, theta) => (1 - h.sb * h.sb * cos(theta) ** 2) / h.cb;
function hookePsi(h, phi) {
  const p = Math.atan2(sin(phi), h.cb * cos(phi));
  return p + 2 * PI * Math.round((phi - p) / (2 * PI));
}

Registry.link('hooke', {
  collection: 'hookes',
  order: { constraints: 30, afterIntegrate: 20, status: 30 },

  validate(l, w, { E, ax }) {
    ax(l.input, 'input'); ax(l.output, 'output');
    if (!l.arm) E(`${w}: manca "arm"`);
  },

  /* Prima dei riferimenti di default: i riferimenti dei due assi devono essere coerenti con la crociera. */
  prepareAxes(M) {
    for (const l of activeLinks('hooke')) {
      CTX.where = `link hooke ${l.input} → ${l.output}`;
      const ai = M.axisBy[l.input], ao = M.axisBy[l.output];
      const bend = V.unit(V.perp(ao.dir, ai.dir)), pinB = V.cross(ai.dir, bend);
      ai.ref = ai.ref || V.unit(V.cross(bend, ai.dir));
      ao.ref = ao.ref || V.unit(V.cross(pinB, ao.dir));
    }
  },

  resolve(M) {
    for (const l of activeLinks('hooke')) {
      CTX.where = `link hooke`;
      const ai = M.axisBy[l.input], ao = M.axisBy[l.output], cb = V.dot(ai.dir, ao.dir);
      M.hookes.push({ def: l, inIdx: ai.idx, outIdx: ao.idx, cb, sb: Math.sqrt(1 - cb * cb), bend: V.unit(V.perp(ao.dir, ai.dir)) });
      step('link', `snodo di Hooke: ${l.input} → ${l.output}, angolo ${(Math.acos(cb) * 180 / PI).toFixed(2)}°`);
    }
  },

  constraints(M, push, { n }) {
    for (const h of M.hookes) {
      const r = new Array(n).fill(0); r[h.inIdx] = 1; r[h.outIdx] = -hookeRatio(h, M.axes[h.inIdx].theta);
      push('hooke', `snodo ${M.axes[h.inIdx].id} → ${M.axes[h.outIdx].id}`, r, 0);
    }
  },

  /* Angolo dell'asse condotto: ψ = atan2(sin φ, cos β · cos φ) */
  afterIntegrate(M) {
    for (const h of M.hookes) M.axes[h.outIdx].theta = hookePsi(h, M.axes[h.inIdx].theta);
  },

  status(M, w) {
    const lines = [], E = 1e-9;
    for (const h of M.hookes) if (Math.abs(w[h.inIdx]) > E) lines.push(template(h.def.message, M.ev, { beta: Math.acos(h.cb) * 180 / PI, lo: h.cb, hi: 1 / h.cb }));
    return lines;
  },

  linkedAxes: M => M.hookes.flatMap(h => [M.axes[h.inIdx], M.axes[h.outIdx]])
});
