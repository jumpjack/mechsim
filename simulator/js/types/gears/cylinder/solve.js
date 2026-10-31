/* =====================================================================
   types/gears/cylinder/solve.js
   Disco/cilindro liscio (type "cylinder")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('cylinder', {
  meshWith: [],                // non ingrana: si usa per manovelle, tamburi, dischi pilotati da link (pin_slot, geneva...)

  validate(g, w, { E, isVec }) {
    if (g.r === undefined) E(`${w}: manca "r"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  }
});
