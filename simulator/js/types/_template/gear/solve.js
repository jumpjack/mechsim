/* =====================================================================
   TEMPLATE per un nuovo tipo di INGRANAGGIO — metà "COME SI RISOLVE"
   Tutte le proprietà sono facoltative, tranne meshWith se il tipo deve ingranare con qualcosa.
   ===================================================================== */
Registry.gear('NOME', {
  meshWith: ['spur'],      // tipi con cui può stare in presa ("meshWith" nel JSON); [] se non ingrana
  minTeeth: 3,             // se presente, controlla z >= minTeeth nel modello risolto
  // noRadiusCheck: true,  // se il raggio non è un dato valido a priori (es. la croce di Malta)
  // toothPhase: false,    // true di default: la ruota "condotta" in presa è sfasata di mezzo passo (π/z); false per vite/ruota

  // JSON del gear (g = definizione, w = descrizione per i messaggi). ctx: E (errore), W (avviso), isVec, partnerOf, axisBy, gearBy
  validate(g, w, { E, W, isVec }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  },

  // defaultTeeth(g, ev) { return 0; },            // valore di z se "teeth" non c'è
  // radius(g, { ev, teeth, module }) { ... },     // raggio primitivo, se non è z·m/2
  // anchorOffset(g, { vec }) { return 0; },       // spostamento assiale del punto d'interasse (es. vite: metà lunghezza)

  // resolve(g, { ev, vec }) { ... return 'testo per il log'; },       // dopo aver assegnato asse, z, m, r, w
  // afterPairs(g, { ev, vec }) { ... },                               // quando g.partner è noto
  // contact(g, p) { ... return { X, cg, cp }; },                      // punto di contatto con p; null = ruote cilindriche
  // meshRow(m, n) { ... return riga di n coefficienti; },             // equazione di presa, se non è il semplice rapporto dei denti
  // validateModel(g, B) { if (...) B('messaggio'); }                  // controlli sul modello risolto
});
