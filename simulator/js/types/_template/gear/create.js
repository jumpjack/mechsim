/* =====================================================================
   TEMPLATE per un nuovo tipo di INGRANAGGIO — metà "COME SI CREA"
   Copia la cartella types/_template/gear in types/gears/<nome> (es. types/gears/rack) e sostituisci NOME con <nome>.
   Nel JSON della macchina basta poi scrivere  { "type": "<nome>", ... }: i file si caricano da soli.
   ===================================================================== */

/* La funzione geometrica del tipo (come spurGear() o bevelGear()). Un solido è { P: [[x,y,z], ...], T: [[i,j,k], ...] }
   nel sistema locale dell'ingranaggio: z lungo l'asse (da w[0] a w[1]), x/y nel piano. Primitive condivise in core/04-geometry.js:
   loft(A, B, capA, capB), ringsLoft(rings, capA, capB), toothProfile(z, m, n), cylinderSolid(...), boxSolid(...), prismSolid(...). */
function NOMEGear(g) {
  return cylinderSolid(g.r, g.w[0], g.w[1], 32);          // sostituire con la geometria vera
}

Registry.gear('NOME', {
  solids: g => [NOMEGear(g)],        // array di solidi (si possono aggiungere piastre, mozzi, ...)
  cacheKey: g => [],                 // parametri che cambiano la geometria oltre a z, m, rho, w, side, r, colore (già inclusi)
  sigKey: g => [],                   // parametri che, se cambiano, rendono "nuovo" l'ingranaggio (di norma: come cacheKey o vuoto)
  // markerZ: g => 0                 // posizione assiale del marker rosso se manca "w" (facoltativo)
});
