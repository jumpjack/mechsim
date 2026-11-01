/* =====================================================================
   types/gears/spur/solve.js
   Ingranaggio cilindrico a denti dritti (type "spur")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('spur', {
  meshWith: ['spur'],          // tipi con cui può essere in presa (meshWith)
  minTeeth: 3,

  validate(g, w, { E, isVec }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (larghezza lungo l'asse)`);
  }
});
