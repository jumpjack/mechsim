/* =====================================================================
   types/gears/escape_wheel_CS/solve.js
   Ruota di scappamento (type "escape_wheel_CS"), da usare con il link "graham_escapement_CS"
   Metà "COME SI RISOLVE" del tipo: validazione. Il disegno è in create.js; geometria e fisica del contatto con l'ancora sono nel link.
   ---------------------------------------------------------------------
   JSON:  { "id": "ruota_CS", "type": "escape_wheel_CS", "axis": "...", "r": 30, "teeth": 30, "pos": 0, "thickness": 4 }
   Obbligatori:  "r" = raggio delle punte dei denti (mm), "teeth" = numero di denti (≥ 8), posizione e spessore ("w" oppure "pos"+"thickness").
   Facoltativi (numeri o espressioni):
     "toothDepth"  altezza del dente, mm (0,25·r)         "hook"      gancio della faccia anteriore, gradi (3)
     "valley"      larghezza del fondo fra i denti, gradi (1)   "rimWidth"  larghezza della corona, mm (0,12·r)
     "spokes"      numero di razze (5)                    "hubRadius" raggio del mozzo, mm (0,18·r)
   La ruota gira nel verso positivo dell'asse: è quello giusto per lo scappamento.
   ===================================================================== */
Registry.gear('escape_wheel_CS', {
  meshWith: [],                // non ingrana: la muove un motore (clic sulla ruota + slider) e la regola l'ancora
  minTeeth: 8,

  validate(g, w, { E, isVec }) {
    if (g.r === undefined) E(`${w}: manca "r" (raggio delle punte dei denti)`);
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
    for (const k of ['toothDepth', 'hook', 'valley', 'rimWidth', 'spokes', 'hubRadius'])
      if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
  },

  /* Parametri del disegno già valutati (le espressioni possono usare gli slider). */
  resolve(g, { ev }) {
    const d = g.def, R = g.r, n = (v, def) => v !== undefined ? ev(v) : def;
    g.wheelCS = { depth: n(d.toothDepth, 0.25 * R), hook: n(d.hook, 3), valley: n(d.valley, 1), rimWidth: n(d.rimWidth, 0.12 * R), spokes: Math.round(n(d.spokes, 5)), hubR: n(d.hubRadius, 0.18 * R) };
    return `, scappamento: punte a ${R} mm`;
  }
});
