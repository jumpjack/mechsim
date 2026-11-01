/* =====================================================================
   types/gears/spur/solve.js
   ===================================================================== */
Registry.gear('spur', {
  meshWith: ['spur'],
  minTeeth: 3,

  validate(g, w, { E, isVec }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (larghezza lungo l'asse)`);
  }
});
