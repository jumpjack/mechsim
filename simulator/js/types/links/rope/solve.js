/* =====================================================================
   types/links/rope/solve.js
   Fune con peso (link "rope")
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('rope', {
  collection: 'ropes',

  validate(l, w, { E, ax, isVec }) {
    ax(l.axis, 'axis');
    if (!isVec(l.at, 3)) E(`${w}: "at" deve avere 3 elementi`);
    for (const k of ['radius', 'len0', 'min', 'max']) if (l[k] === undefined) E(`${w}: manca "${k}"`);
  },

  // la fune non impone vincoli cinematici: la sua lunghezza dipende solo dall'angolo dell'asse
  resolve(M, { ev, vec }) {
    for (const l of activeLinks('rope')) {
      CTX.where = `link rope`;
      M.ropes.push({ def: l, idx: M.axisBy[l.axis].idx, at: vec(l.at), radius: ev(l.radius) });
      step('link', `fune su ${l.axis}`);
    }
  }
});
