/* =====================================================================
   types/gears/geneva_driver/solve.js
   Driver di un Geneva (type "geneva_driver"): ruota porta-perno + perno + disco di blocco
   Metà "COME SI RISOLVE" del tipo: validazione e misure. La geometria è in create.js.
   ---------------------------------------------------------------------
   Si usa come "driver" di un link "geneva", senza specificare dove sta il perno: lo calcola il codice (r = interasse·sin(π/N)).
     { "id":"drv", "type":"geneva_driver", "axis":"asse_manovella" }
     { "type":"geneva", "driver":"drv", "driven":"croce", "slots":7 }
   Il driver è fatto da:
     · ruota porta-perno: raggio poco più grande della distanza del perno dal centro, spostata assialmente rispetto alla croce
       (così non può urtarla);
     · perno: sta nella scanalatura della croce, diametro un po' più piccolo della larghezza della scanalatura;
     · disco di blocco: allineato con la croce, del raggio esatto per entrare negli incavi senza toccarli, con l'incavatura
       dove passano le punte della croce durante l'ingaggio.
   Proprietà facoltative del gear (numeri o espressioni, mm):
     "w" / "pos" + "thickness"   posizione e spessore del disco di blocco (default: quelli della croce)
     "pinThickness"  spessore della ruota porta-perno (default: metà dello spessore del disco di blocco, almeno 1)
     "pinGap"        spazio assiale fra la croce e la ruota porta-perno (default 0,5)
     "pinSide"       1 (default) = ruota porta-perno verso +asse rispetto alla croce, -1 = verso -asse
     "pinDiameter"   diametro del perno (default: 0,9 × larghezza della scanalatura)
     "lockGap"       gioco del disco di blocco rispetto alla croce (default 0,15)
     "r"             raggio della ruota porta-perno (default: distanza del perno + diametro del perno)
   La posizione del perno sul driver si sceglie nel link: "pinAngle" (gradi).
   ===================================================================== */
Registry.gear('geneva_driver', {
  meshWith: [],                // non ingrana: se serve una ruota dentata, se ne mette un'altra sullo stesso asse
  noRadiusCheck: true,         // il raggio vero lo fissa il link geneva (genevaDriver)

  radius: () => 10,            // provvisorio, finché il link non conosce interasse e numero di scanalature

  validate(g, w, { E, isVec }) {
    if (g.w !== undefined && !isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
    if (g.pinSide !== undefined && g.pinSide !== 1 && g.pinSide !== -1) E(`${w}: "pinSide" deve essere 1 oppure -1`);
  },

  /* Chiamato dal link geneva (types/links/geneva/solve.js) quando risolve la coppia: gv = dimensioni del Geneva. */
  genevaDriver(g, gv, { ev }) {
    const d = g.def, num = (v, def) => v !== undefined ? ev(v) : def;
    const pinD = num(d.pinDiameter, 1.8 * gv.h);
    g.drv = {
      pinD,
      pinThickness: num(d.pinThickness, null),                  // il default dipende dallo spessore del disco di blocco: lo decide create.js
      pinGap: num(d.pinGap, 0.5),
      pinSide: d.pinSide === -1 ? -1 : 1,
      lockGap: num(d.lockGap, 0.15)
    };
    g.r = num(d.r, gv.r + pinD);                                // raggio della ruota porta-perno
    if (!g.w && gv.zCross) g.w = gv.zCross.slice();             // disco di blocco allineato con la croce
  }
});
