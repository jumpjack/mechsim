/* =====================================================================
   types/gears/maltese/solve.js + geneva_driver/solve.js
   ===================================================================== */
Registry.gear('maltese', {
  meshWith: [],
  noRadiusCheck: true,
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

Registry.gear('geneva_driver', {
  meshWith: [],
  noRadiusCheck: true,
  radius(g){ if(g.r && g.r>0) return g.r; return 10; },
  validate(g, w, { E, W, isVec }){
    // slots opzionale qui: se manca lo prende dal link geneva o dalla croce collegata
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  }
});

// Se l'utente lascia type "spur" come driver, lo accettiamo come driver geneva
Registry.gear('spur', {
  meshWith: [],
  noRadiusCheck: true,
  radius(g){ if(g.r && g.r>0) return g.r; return 20; },
  validate(g,w,{E,isVec}){
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  }
});