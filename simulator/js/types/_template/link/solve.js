/* =====================================================================
   TEMPLATE per un nuovo tipo di LINK — metà "COME SI RISOLVE"
   ===================================================================== */
Registry.link('NOME', {
  collection: 'NOMEs',                     // M.NOMEs: array degli elementi risolti (lo crea il nucleo)
  order: { constraints: 100 },             // posizione nell'elenco dei vincoli (più basso = più prioritario)

  // JSON di UN link. w = "link NOME"; ctx: E, W, ax(id, 'etichetta') per controllare un asse, isVec, axisBy, gearBy
  validate(l, w, { E, ax }) {
    ax(l.axis, 'axis');
  },

  // trasforma i link attivi di questo tipo in elementi di M.NOMEs (ctx: ev per le espressioni, vec per i vettori)
  resolve(M, { ev, vec }) {
    for (const l of activeLinks('NOME')) {
      M.NOMEs.push({ def: l, idx: M.axisBy[l.axis].idx });
    }
  },

  // equazioni cinematiche: riga r di n coefficienti = combinazione delle velocità angolari degli assi, uguale a b.
  // push(kind, etichetta, r, b)   ctx: n, unit(i) (riga con un 1 in posizione i), locked
  constraints(M, push, { n, unit }) {
    // for (const x of M.NOMEs) push('NOME', `...`, unit(x.idx), 0);
  },

  // facoltativi: prepareAxes(M) · initThrough(M, ev) · lock(M, w, locked)/lockable(M) · events(M, s, w) · afterIntegrate(M)
  //              settle(M) · afterThroughLine(M, t, cache, lines) · status(M, w, locked) → [righe] · linkedAxes(M) → [assi]
});
