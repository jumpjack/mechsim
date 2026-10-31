/* =====================================================================
   types/links/brake/solve.js
   Freno (link "brake"): ferma un asse quando è inserito
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('brake', {
  collection: 'brakes',
  order: { constraints: 10, status: 20 },

  validate(l, w, { E, ax, isVec }) {
    ax(l.axis, 'axis');
    if (!l.shoe || !isVec(l.shoe.at, 3) || !isVec(l.shoe.size, 3) || !isVec(l.shoe.released, 3)) E(`${w}: "shoe" richiede at, size e released con 3 elementi ciascuno`);
  },

  resolve(M) {
    for (const l of activeLinks('brake')) {
      CTX.where = `link brake`;
      M.brakes.push({ def: l, idx: M.axisBy[l.axis].idx });
      step('link', `freno su ${l.axis}`);
    }
  },

  /* Freno inserito → velocità dell'asse = 0 (precedenza massima fra i vincoli) */
  constraints(M, push, { unit }) {
    for (const b of M.brakes) if (state.brakes[b.def.axis]) push('freno', `freno su ${b.def.axis}`, unit(b.idx), 0, { axisIdx: b.idx });
  },

  status: M => M.brakes.filter(b => state.brakes[b.def.axis] && b.def.message).map(b => b.def.message)
});
