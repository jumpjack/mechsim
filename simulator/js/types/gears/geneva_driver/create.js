/* =====================================================================
   types/gears/geneva_driver/create.js
   Driver di un Geneva (type "geneva_driver"): ruota porta-perno + perno + disco di blocco
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (misure, default) è in solve.js.
   ===================================================================== */

/* Profilo del disco di blocco: raggio in funzione dell'angolo, 360 raggi dal centro, con il perno a 0°.
   Raggio massimo = ρ − gioco (ρ = raggio degli archi concavi della croce, calcolato dal link). Dove la croce passa durante l'ingaggio il
   raggio si riduce: si fa muovere la croce come nel simulatore (il perno resta fisso nel riferimento del driver, il centro della croce gli
   gira intorno) e per ogni raggio si prende la prima intersezione con il contorno della croce, in tutte le posizioni dell'ingaggio. */
function genevaLockProfile(gv, gap) {
  const TAU = 2 * Math.PI, rays = 720;
  if (typeof malteseOutline !== 'function') return new Array(rays).fill(Math.max(0.1, gv.rho - gap));      // croce non caricata: disco pieno
  const poly = malteseOutline(gv.N, gv.a, gv.r, gv.hRaw).poly, nP = poly.length, a = gv.a, r = gv.r;
  // A croce ferma il centro del driver sta in (R, -r) nel riferimento della croce (scanalatura 0 lungo +x): il disco deve restare dentro
  // il poligono reale degli archi (non solo dentro la circonferenza ideale di raggio ρ, di cui il poligono è un'approssimazione).
  const Oc = [Math.sqrt(Math.max(0, a * a - r * r)), -r];
  let rLock = Infinity;
  for (let i = 0; i < nP; i++) {
    const p = poly[i], q = poly[(i + 1) % nP], ex = q[0] - p[0], ey = q[1] - p[1], l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((Oc[0] - p[0]) * ex + (Oc[1] - p[1]) * ey) / l2)) : 0;
    rLock = Math.min(rLock, Math.hypot(Oc[0] - p[0] - t * ex, Oc[1] - p[1] - t * ey));
  }
  const rhoD = Math.max(0.1, Math.min(gv.rho, rLock) - gap), prof = new Array(rays).fill(rhoD);
  const beta = Math.acos(Math.min(1, r / a)), S = 1600, best = new Array(rays).fill(Infinity), X = new Array(nP), Y = new Array(nP);
  for (let k = 0; k <= S; k++) {
    const phi = -beta + 2 * beta * k / S;                                       // rotazione del driver; 0 = perno sulla linea dei centri
    const cx = a * Math.cos(phi), cy = -a * Math.sin(phi);                      // centro della croce, nel riferimento del driver
    const kap = Math.atan2(a * Math.sin(phi), r - a * Math.cos(phi)), c = Math.cos(kap), s = Math.sin(kap);   // la scanalatura 0 punta al perno
    for (let i = 0; i < nP; i++) { X[i] = cx + poly[i][0] * c - poly[i][1] * s; Y[i] = cy + poly[i][0] * s + poly[i][1] * c; }
    for (let i = 0; i < nP; i++) {
      const j = (i + 1) % nP, x1 = X[i], y1 = Y[i], dx = X[j] - x1, dy = Y[j] - y1;
      let a1 = Math.atan2(y1, x1), da = Math.atan2(Y[j], X[j]) - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 3) continue;                                           // lato che passa per il centro del driver: non succede
      const lo = da >= 0 ? a1 : a1 + da, span = Math.abs(da);
      const m0 = Math.ceil((((lo % TAU) + TAU) % TAU) / TAU * rays - 1e-9), m1 = Math.floor((((lo % TAU) + TAU) % TAU + span) / TAU * rays + 1e-9);
      for (let m = m0; m <= m1; m++) {
        const ang = m * TAU / rays, ex = Math.cos(ang), ey = Math.sin(ang), den = ex * dy - ey * dx;
        if (Math.abs(den) < 1e-12) continue;
        const sRay = (x1 * dy - y1 * dx) / den, t = (x1 * ey - y1 * ex) / den;
        if (sRay > 0 && t >= -1e-9 && t <= 1 + 1e-9) {
          // il gioco si misura in perpendicolare al lato, non lungo il raggio: su un lato quasi radiale serve ritirarsi di più (max 5 volte)
          const cand = sRay - gap / Math.max(0.2, Math.abs(den) / Math.hypot(dx, dy)), jj = ((m % rays) + rays) % rays;
          if (cand < best[jj]) best[jj] = cand;
        }
      }
    }
  }
  for (let j = 0; j < rays; j++) prof[j] = Math.max(0.1, Math.min(rhoD, best[j]));
  // filtro di minimo di ±1°: fra due raggi consecutivi il poligono del disco collega punti a raggio molto diverso (bordo quasi radiale
  // dell'incavatura): così l'incavatura si allarga di qualche decimo di millimetro e il disco non può toccare la croce in quel tratto
  return prof.map((_, j) => { let m = Infinity; for (let k = -2; k <= 2; k++) m = Math.min(m, prof[(j + k + rays) % rays]); return m; });
}

Registry.gear('geneva_driver', {
  solids(g) {
    const gv = g.geneva, drv = g.drv, TAU = 2 * Math.PI;
    if (!gv || !gv.a || !drv || !gv.zCross) return [cylinderSolid(g.r > 0 ? g.r : 10, g.w[0], g.w[1], 48)];   // senza link: disco semplice
    const [w0, w1] = g.w, [c0, c1] = gv.zCross, pa = gv.pinAngle || 0;
    const tp = drv.pinThickness !== null ? drv.pinThickness : Math.max(1, 0.5 * (w1 - w0));
    const pw = drv.pinSide > 0 ? [c1 + drv.pinGap, c1 + drv.pinGap + tp] : [c0 - drv.pinGap - tp, c0 - drv.pinGap];      // ruota porta-perno, sfalsata rispetto alla croce
    const px = gv.r * Math.cos(pa), py = gv.r * Math.sin(pa);
    const pin = cylinderSolid(drv.pinD / 2, drv.pinSide > 0 ? c0 : (pw[0] + pw[1]) / 2, drv.pinSide > 0 ? (pw[0] + pw[1]) / 2 : c1, 24, px, py);
    pin.noBore = true;                                                          // il perno è fuori asse: non si fora
    const prof = genevaLockProfile(gv, drv.lockGap), n = prof.length, A = [], B = [];          // n = 720 raggi
    for (let j = 0; j < n; j++) {
      const ang = pa + j * TAU / n, x = prof[j] * Math.cos(ang), y = prof[j] * Math.sin(ang);
      A.push([x, y, w0]); B.push([x, y, w1]);
    }
    return [
      cylinderSolid(g.r, pw[0], pw[1], 72),                                     // ruota porta-perno
      pin,
      loft(A, B, [0, 0, w0], [0, 0, w1])                                        // disco di blocco con l'incavatura, allineato con la croce
    ];
  },
  cacheKey: g => [g.geneva, g.drv],
  sigKey: g => []
});
