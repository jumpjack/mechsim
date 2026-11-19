/* =====================================================================
   types/gears/follower_CS/solve.js
   Follower oscillante a elle (type "follower_CS"): braccio lungo che ruota attorno a un estremo (il suo asse), un gomito e un braccio corto,
   il "naso", il cui estremo è il punto di contatto con la camma.
   Metà "COME SI RISOLVE" del tipo: validazione e parametri. Il disegno è in create.js; dinamica e contatto sono nel link "cam_follower_CS".
   ---------------------------------------------------------------------
   JSON:  { "id": "follower_CS", "type": "follower_CS", "axis": "...", "length": 70, "noseLength": 22, "pos": 0, "thickness": 4 }
   Il fulcro è l'asse (axes[].place). Obbligatori: "length" = braccio lungo, dal fulcro al gomito (mm); posizione e spessore
   ("w" oppure "pos"+"thickness").
   Facoltativi (numeri o espressioni):
     "noseLength"  braccio corto (il naso), mm (0,3·length). Con 0 il follower è una barra dritta e il contatto è la sua punta.
     "bendAngle"   angolo di piegatura al gomito, gradi, con segno: > 0 il naso gira in senso antiorario rispetto al braccio lungo,
                   < 0 in senso orario (default: 90° dal lato che porta il naso verso la camma)
     "angle"       direzione iniziale del braccio lungo, gradi, rispetto alla retta fulcro?centro della camma (0)
     "width"       larghezza dei bracci, mm (4)
     "mass"        massa TOTALE del follower (1), distribuita in modo uniforme lungo i due bracci (conta insieme alla rigidezza della molla)
     "hubRadius"   raggio del mozzo, mm (5)
   Dove poggia il naso lo decide solo la dinamica: all'inizio, se il naso cade dentro la camma, il codice solleva il follower finché sta fuori.
   Follower SOLIDALI: più follower_CS sullo stesso asse sono un corpo solo (si sommano coppie e inerzie, ognuno può toccare la propria
   camma); una ruota qualsiasi sullo stesso asse segue il follower e trascina, attraverso gli ingranamenti, tutto ciò che è ingranato con lei.
   ===================================================================== */
Registry.gear('follower_CS', {
  meshWith: [],                // non ingrana
  noRadiusCheck: true,

  radius: (g, { ev }) => g.def.length !== undefined ? ev(g.def.length) : 10,

  validate(g, w, { E, isVec }) {
    if (g.length === undefined) E(`${w}: manca "length" (braccio lungo, mm)`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
    for (const k of ['length', 'noseLength', 'bendAngle', 'angle', 'width', 'mass', 'hubRadius'])
      if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
  },

  resolve(g, { ev }) {
    const d = g.def, n = (v, def) => v !== undefined ? ev(v) : def, L = ev(d.length), L2 = n(d.noseLength, 0.3 * L);
    if (!(L > 0)) throw new Error(`${g.id}: "length" deve essere positiva`);
    if (!(L2 >= 0)) throw new Error(`${g.id}: "noseLength" non può essere negativa`);
    g.followerCS = { L, L2, bend: d.bendAngle !== undefined ? ev(d.bendAngle) * Math.PI / 180 : null, angle: n(d.angle, 0), width: n(d.width, 4), mass: n(d.mass, 1), hubR: n(d.hubRadius, 5) };
    return `, follower a elle ${+L.toFixed(1)} + ${+L2.toFixed(1)} mm`;
  }
});
