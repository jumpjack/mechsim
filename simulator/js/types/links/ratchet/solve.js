/* =====================================================================
   types/links/ratchet/solve.js
   Nottolino (link "ratchet"): trascina in un verso, ruota libera nell'altro
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('ratchet', {
  collection: 'ratchets',
  order: { constraints: 40, status: 10 },

  validate(l, w, { W, ax }) {
    ax(l.driver, 'driver'); ax(l.driven, 'driven');
    for (const k of ['drives', 'winding', 'freewheel', 'blocks']) if (!l.messages || l.messages[k] === undefined) W(`${w}: manca messages.${k}`);
  },

  resolve(M) {
    for (const l of activeLinks('ratchet')) {
      CTX.where = `link ratchet`;
      M.ratchets.push({ def: l, driver: M.axisBy[l.driver].idx, driven: M.axisBy[l.driven].idx, sign: l.sign || 1 });
      step('link', `nottolino: ${l.driver} → ${l.driven}`);
    }
  },

  /* Vincolo unilaterale: se, ignorandolo, la ruota condotta andrebbe "contro" il nottolino, lo si blocca (accoppia le due velocità). */
  lockable: M => M.ratchets.length,
  lock(M, w, locked) {
    let changed = false;
    for (const rt of M.ratchets) if (!locked.has(rt) && rt.sign * (w[rt.driven] - w[rt.driver]) < -1e-9) { locked.add(rt); changed = true; }
    return changed;
  },
  constraints(M, push, { n, locked }) {
    for (const rt of locked) if (rt.def && rt.def.type === 'ratchet') {
      const r = new Array(n).fill(0); r[rt.driven] = 1; r[rt.driver] = -1;
      push('nottolino', `nottolino ${M.axes[rt.driver].id} → ${M.axes[rt.driven].id} (bloccato)`, r, 0);
    }
  },

  status(M, w, locked) {
    const lines = [], E = 1e-9;
    for (const r of M.ratchets) {
      const wd = w[r.driver], wa = w[r.driven], m = r.def.messages;
      if (locked.has(r)) lines.push(r.sign * wd > E ? m.drives : m.blocks);
      else if (Math.abs(wd) > E && Math.abs(wa) < E) lines.push(m.winding);
      else if (Math.abs(wa) > E && Math.abs(wd) < E) lines.push(m.freewheel);
    }
    return lines;
  },

  linkedAxes: M => M.ratchets.flatMap(r => [M.axes[r.driver], M.axes[r.driven]])
});
