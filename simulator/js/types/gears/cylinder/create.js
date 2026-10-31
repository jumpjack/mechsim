/* =====================================================================
   types/gears/cylinder/create.js
   Disco/cilindro liscio (type "cylinder")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
Registry.gear('cylinder', {
  solids: g => [cylinderSolid(g.r, g.w[0], g.w[1], g.def.n || 32)],     // cylinderSolid è in core/04-geometry.js
  cacheKey: g => [g.def.n]
});
