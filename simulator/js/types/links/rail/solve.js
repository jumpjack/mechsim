/* =====================================================================
   types/links/rail/solve.js
   Binario (link "rail"): una guida passa per un punto fisso e interseca sempre un altro asse
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
/* Risolve un binario. Piano π = (P, retta di A); la guida è la perpendicolare a g (la retta T) in P dentro π:  b = n × g,  n = y × (O_A − P).
   Orientata verso il punto d'intersezione X = P + t·b = O_A + s·y  (t = distanza da P lungo la guida, s = posizione su A). */
function solveRail(q, cache) {
  const P = q.a.O, g = V.unit(q.t.dir);
  const fs = axisFrame(q.slider, cache), y = V.unit(fs.dir), d = V.sub(fs.O, P);
  let n = V.cross(y, d), degenerate = false;
  if (V.len(n) < 1e-9 * (V.len(d) || 1)) { n = V.cross(y, g); degenerate = true; }   // P sta sulla retta di A: piano (A, T)
  let b = V.cross(n, g);
  if (V.len(b) < 1e-9 * (V.len(n) || 1)) return q.last ? { ...q.last, stale: true } : null;  // T perpendicolare al piano: indeterminato, si tiene l'ultima posa
  b = V.unit(b);
  const bxy = V.cross(b, y), den = V.dot(bxy, bxy);
  let X = null, t = NaN, s = NaN, resid = NaN;
  if (den > 1e-12) {
    t = V.dot(V.cross(d, y), bxy) / den;
    s = V.dot(V.cross(d, b), bxy) / den;
    if (t < 0) { b = V.mul(b, -1); t = -t; }                       // la guida punta verso l'intersezione
    X = V.add(P, V.mul(b, t));
    resid = V.len(V.sub(X, V.add(fs.O, V.mul(y, s))));
  } else if (V.dot(b, q.prev) < 0) b = V.mul(b, -1);                // guida parallela ad A: nessuna intersezione, si tiene il verso precedente
  q.prev = b;
  q.last = { b, g, X, t, s, resid, degenerate, perp: V.dot(b, g) };
  return q.last;
}

function applyRail(q, r) {
  if (!r) return;
  setNodePose(q.a, { O: q.a.O, dir: r.b, ref: r.g });               // ref = coda (⟂ a b): la posa attorno a b è liscia
  q.a.dir = r.b.slice(); q.a.ref = r.g.slice(); q.a.yv = V.cross(q.a.dir, q.a.ref);
  if (q.marker && r.X) { const p = V.toB(r.X); q.marker.position.set(p[0], p[1], p[2]); q.marker.setEnabled(true); }
  else if (q.marker) q.marker.setEnabled(false);
}


Registry.link('rail', {
  collection: 'rails',

  validate(l, w, { E, ax, axisBy }) {
    ax(l.guide, 'guide'); ax(l.slider, 'slider');
    if (l.guide !== undefined && l.guide === l.slider) E(`${w}: guide e slider devono essere assi diversi`);
    if (!(axisBy[l.perpendicularTo] && axisBy[l.perpendicularTo].through !== undefined)) E(`${w}: "perpendicularTo" deve riferire un asse con "through" (qui: "${l.perpendicularTo}")`);
    if (axisBy[l.guide] && (axisBy[l.guide].through !== undefined || axisBy[l.guide].alignWith !== undefined)) E(`${w}: la guida "${l.guide}" non può avere "through" né "alignWith" (la sua direzione la calcola il binario)`);
  },

  /* Chiamato alla fine di initThrough: il binario si appoggia alle rette "through" appena create. */
  initThrough(M, ev) {
    /* Binari ("rail"): link { "type":"rail", "guide": B, "slider": A, "perpendicularTo": T }.
       B passa per il proprio punto fisso P (la sua origine) e viene orientata ogni frame in modo che:
         1. intersechi sempre la retta di A (B giace nel piano che contiene P e la retta di A);
         2. sia perpendicolare in P alla retta T (di norma la coda, un asse "through").
       Il punto d'intersezione X non è un dato: si calcola e cambia di continuo (A scorre lungo B), quindi non servono "estremità". */
    M.rails = [];
    for (const l of MACHINE.links) if (l.type === 'rail' && isActive(l)) {
      CTX.where = `link rail ${l.guide} su ${l.slider}`;
      const a = M.axisBy[l.guide], slider = M.axisBy[l.slider], t = M.through.find(x => x.a.id === l.perpendicularTo);
      if (!a || !slider || !t) throw new Error(`link rail: guide "${l.guide}", slider "${l.slider}" e perpendicularTo "${l.perpendicularTo}" (asse con through) devono esistere`);
      const k = M.perpendicular.findIndex(q => q.a === a);
      if (k >= 0) { M.perpendicular.splice(k, 1); warn('rail', `${a.id}: il binario sostituisce il suo "perpendicularTo"`); }
      a.aimed = a.aligned = true;
      M.rails.push({ a, slider, t, def: l, prev: V.mul(V.unit(a.dir), l.sign < 0 ? -1 : 1) });
      step('rail', `${a.id}: passa per ${fmtV(a.O)}, interseca sempre ${slider.id} ed è perpendicolare a ${t.a.id}`);
    }
  },

  /* Chiamato per ogni retta "through" dentro updateThrough: i binari che dipendono da questa retta si risolvono subito. */
  afterThroughLine(M, t, cache, lines) {
    // le rette through successive possono avere "refFrom" sulla guida: per questo si risolve subito
    for (const q of M.rails) if (q.t === t) {
      const rr = solveRail(q, cache); applyRail(q, rr);
      if (!rr) { lines.push(`${q.a.id}: binario indeterminato (la retta ${t.a.id} è perpendicolare al piano di ${q.slider.id}), tenuta l'ultima posizione.`); continue; }
      lines.push(`${q.a.id}: binario su ${q.slider.id}, ` + (rr.X
        ? `intersezione a ${fmt(rr.t, 1)} mm da P e a ${fmt(rr.s, 1)} mm dall'origine di ${q.slider.id} (residuo ${rr.resid.toExponential(1)}), ` : `nessuna intersezione (parallela a ${q.slider.id}), `)
        + `angolo con ${t.a.id} ${fmt(Math.acos(Math.max(-1, Math.min(1, rr.perp))) * 180 / PI, 2)}°` + (rr.degenerate ? ' [P su ' + q.slider.id + ': piano da ' + t.a.id + ']' : '') + '.');
    }
  }
});
