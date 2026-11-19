/* =====================================================================
   types/gears/anchor_CS/solve.js
   Ancora di Graham con pendolo (type "anchor_CS"), da usare con il link "graham_escapement_CS"
   Metà "COME SI RISOLVE" del tipo: validazione e parametri. Il disegno è in create.js; geometria delle pallette e fisica sono nel link.
   ---------------------------------------------------------------------
   JSON:  { "id": "ancora_CS", "type": "anchor_CS", "axis": "...", "pendulumLength": "pendulumLength", "pos": 0, "thickness": 4 }
   Obbligatori:  "pendulumLength" = lunghezza del pendolo, mm (numero o espressione: va bene lo slider);
                 posizione e spessore della piastra dell'ancora ("w" oppure "pos"+"thickness"): di norma nello stesso piano della ruota.
   Facoltativi (numeri o espressioni):
     BRACCI (solo aspetto: non cambiano il funzionamento, che dipende dalle pallette):
       "armLength"    lunghezza dei due bracci dal perno, mm (default: fino alle pallette)
       "armAngle"     angolo di APERTURA totale fra i due bracci, gradi (default: ~106°, fino alle pallette)
       "armWidth"     larghezza dei bracci, mm (3)
       "armConnector" false = niente raccordi fra la punta dei bracci e le pallette (true: se i bracci non arrivano alle pallette,
                      un piccolo raccordo li collega, così l'ancora resta un solo pezzo)
     PENDOLO:  "bobRadius" raggio della lente (10)   "bobThickness" spessore della lente (4)   "rodWidth" larghezza dell'asta (2,4)
     ALTRO:    "hubRadius" raggio del mozzo (5)
               "rodGap" spazio assiale fra piastra e asta del pendolo (1): l'asta sta in un piano più avanti, così non urta la ruota
   Le pallette (forma, posizione, facce di riposo e di impulso) NON si specificano: le calcola il link da raggio, denti e interasse.
   Il pendolo pende lungo la retta fra il perno dell'ancora e il centro della ruota (A→W): con gravità verso Z− l'ancora sta SOPRA
   la ruota (stesse x e y, z maggiore) e gli assi sono orizzontali.
   ===================================================================== */
Registry.gear('anchor_CS', {
  meshWith: [],                // non ingrana
  noRadiusCheck: true,         // il raggio non è un dato di partenza: le pallette stanno dove le mette il link

  radius: () => 10,            // provvisorio

  validate(g, w, { E, isVec }) {
    if (g.pendulumLength === undefined) E(`${w}: manca "pendulumLength" (lunghezza del pendolo, mm)`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
    for (const k of ['pendulumLength', 'bobRadius', 'bobThickness', 'rodWidth', 'armWidth', 'armLength', 'armAngle', 'hubRadius', 'rodGap'])
      if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
    if (g.armConnector !== undefined && typeof g.armConnector !== 'boolean') E(`${w}: "armConnector" deve essere true o false`);
  },

  resolve(g, { ev }) {
    const d = g.def, n = (v, def) => v !== undefined ? ev(v) : def;
    g.pendLen = ev(d.pendulumLength);
    g.anchorCS = { bobR: n(d.bobRadius, 10), bobT: n(d.bobThickness, 4), rodW: n(d.rodWidth, 2.4), armW: n(d.armWidth, 3), hubR: n(d.hubRadius, 5), rodGap: n(d.rodGap, 1),
                   armLen: n(d.armLength, null), armAng: n(d.armAngle, null), armConn: d.armConnector !== false };
    return `, pendolo ${+g.pendLen.toFixed(1)} mm`;
  }
});
