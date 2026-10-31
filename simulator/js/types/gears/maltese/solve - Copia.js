/* =====================================================================
   types/gears/maltese/solve.js
   Croce di Malta (type "maltese")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('maltese', {
  meshWith: [],                // non ingrana: lo spostamento lo comanda il link "geneva"
  noRadiusCheck: true,         // il raggio vero lo fissa il link geneva (raggio d'ingaggio R)

  /* Raggio provvisorio, finché il link geneva non imposta g.r = R */
  radius(g, { module }) {
    if (g.r && g.r > 0) return g.r;
    const N = g.def.slots || 4;
    return module(g) * N * 1.5 || 10;
  },

  validate(g, w, { E, W, isVec }) {
    if (g.slots === undefined) E(`${w}: mancano gli "slots" (numero di scanalature, es. 4)`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (spessore lungo l'asse)`);
    if (g.teeth !== undefined) W(`${w}: la croce di Malta non ha "teeth", verranno ignorati`);
  }
});
