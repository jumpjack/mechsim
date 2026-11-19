/* =====================================================================
   types/gears/bevel_MT/create.js
   Ingranaggio conico (type "bevel_MT")
   Metà "COME SI CREA": geometria e mesh. La metà "COME SI RISOLVE"
   (validazione, parametri, cinematica) è in bevel_MT/solve.js.
   =====================================================================
   QUESTO È IL FILE ORIGINALE, RIGA PER RIGA, CAMBIA SOLO DA DOVE
   PRENDE I PARAMETRI. Niente base piatta, niente mozzo, niente
   proiezione, niente appiattimento.
   Originale:
     bevelGear(g.z, g.m, g.delta, g.rho, g.def.k0 || 0.7)
     pl = g.def.plate
   Ora:
     bevelMTGear(g.z, g.m, g.delta, g.rho, g.k0)
     pl = g.plate (messa da solve.js, che la calcola da pos+thickness)
   con fallback a g.def.k0 / g.def.plate se solve non è ancora passato.
   Il "centro della conica" NON è un parametro: wMean è la media degli
   Z dei punti P, e i due centri del loft sono [0,0,k0*wMean] e
   [0,0,wMean]. Non c'è niente da calcolare, si ricalcola da solo
   da P. Per questo cambiare la sorgente dei parametri è 2 righe.
   PERCHÉ LA VERSIONE PIATTA NON INGRANAVA:
   Nell'originale a s=0 (punto primitivo) Z = wp = R / tan(delta).
   È lì che i denti delle due ruote si devono incontrare, sullo stesso
   punto del cono primitivo, con i fianchi per l'apice.
   Nella versione piatta avevo messo Z = Z_base = max(Z_conico) = wp +
   1.25*m*sin(delta) per tutta la faccia posteriore, e Z = Z_base -
   thickness per quella anteriore. Quindi a s=0 la Z non era più wp,
   ma wp + 1.25*m*sin(delta) (per m=2, delta=45°: +1.77 mm).
   I denti erano spostati di 1.77 mm lungo l'asse rispetto al cono
   primitivo: passano uno accanto all'altro senza toccarsi, con il
   vuoto che si vede nella foto. Non è un problema di fase, è che
   la geometria non sta più sul cono primitivo.
   TRADE-OFF, DETTO CHIARO:
   - Originale (questo file): ingrana esatto, denti sulla faccia
     conica, nessun bordo extra. MA la base NON è piatta, è conica
     (fan al centro). Per stampare si mette brim / supporti.
   - Base piatta + niente bordo + ingranamento esatto: non si può
     avere tutti e tre con un semplice loft. La base piatta sposta
     i punti fuori dal cono primitivo (e allora non ingrana), oppure
     serve un disco extra che diventa il bordo che non vuoi.
   Se vuoi che ingrani, usa questo file. La base piatta esatta è
   incompatibile con la conica esatta.
   ===================================================================== */
function bevelMTGear(z, m, delta, rho, k0) {
  const R = m * z / 2, wp = R / Math.tan(delta);
  const zVirtual = z / Math.cos(delta), rVirtual = R / Math.cos(delta);
  const prof = toothProfile(zVirtual, m, 8), pitchV = 2 * Math.PI / zVirtual, P = [];
  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / Math.cos(delta);
      const s = r - rVirtual;
      const q = R + s * Math.cos(delta);
      P.push([q * Math.cos(t), q * Math.sin(t), wp - s * Math.sin(delta)]);
    }
  }
  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  return loft(P.map(p => p.map(v => v * k0)), P, [0, 0, k0 * wMean], [0, 0, wMean]);
}

Registry.gear('bevel_MT', {
  solids(g) {
    const k0 = (g.k0 !== undefined && Number.isFinite(g.k0)) ? g.k0 : (g.def && g.def.k0 !== undefined ? g.def.k0 : 0.7);
    const out = [bevelMTGear(g.z, g.m, g.delta, g.rho, k0)];
    const pl = (g.plate !== undefined ? g.plate : (g.def ? g.def.plate : undefined));
    if (pl) { const wp = g.r / Math.tan(g.delta); out.push(cylinderSolid(pl.k * g.r, wp + pl.from, wp + pl.to, pl.n || 48)); }
    return out;
  },
  cacheKey: g => [g.delta, g.k0, g.plate, g.def ? g.def.k0 : null],
  markerZ: g => g.r * 0.2
});
