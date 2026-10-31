/* =====================================================================
   core/08-axis-constraints.js
   Assi "through", "alignWith", "perpendicularTo", "spinPerpTo", "spinAlignTo": vincoli di posa degli assi
   ===================================================================== */
/* =====================================================================
   3c. ASSI "through": retta che passa SEMPRE per due punti
   ---------------------------------------------------------------------
   "through": [P1, P2]  con P = id di un asse (si usa l'origine di quell'asse, nel punto in cui si trova in quel momento: dipende
   dagli angoli di RA e declinazione) oppure [x,y,z] (punto fisso nel mondo, espressioni ammesse; si valuta dopo tutte le rotazioni).
   Ogni frame: origine = P1, direzione = da P1 verso P2.
   ===================================================================== */
const MAT = {
  rot(k, a) {
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = k;
    return [[t*x*x + c, t*x*y - s*z, t*x*z + s*y], [t*x*y + s*z, t*y*y + c, t*y*z - s*x], [t*x*z - s*y, t*y*z + s*x, t*z*z + c]];
  },
  mul: (A, B) => A.map(r => [0, 1, 2].map(j => r[0]*B[0][j] + r[1]*B[1][j] + r[2]*B[2][j])),
  mulV: (A, v) => A.map(r => r[0]*v[0] + r[1]*v[1] + r[2]*v[2])
};

/* Posa assoluta di un asse guidato dagli ingranaggi dagli angoli correnti a.theta (stessa composizione dei nodi Babylon). */
function axisFrame(a, cache) {
  let f = cache.get(a);
  if (f) return f;
  const Rs = MAT.rot(a.dir, a.theta);
  if (a.carrier) {
    const pc = axisFrame(a.carrier, cache);
    f = { R: MAT.mul(pc.R, Rs), O: V.add(pc.O, MAT.mulV(pc.R, V.sub(a.O, a.carrier.O))), dir: MAT.mulV(pc.R, a.dir) };
  } else f = { R: Rs, O: a.O, dir: a.dir };
  cache.set(a, f);
  return f;
}

function initThrough(M, ev) {
  M.through = [];
  for (const a of M.axes) if (a.def.through) {
    CTX.where = `asse "${a.id}", campo through`;
    const pts = a.def.through.map(q => typeof q === 'string'
      ? { axis: M.axisBy[q] }
      : { fixed: q.map(e => ev(e)) });
    for (const [i, p] of pts.entries()) if (p.fixed) {
      if (!p.fixed.every(Number.isFinite)) throw new Error(`asse "${a.id}": punto fisso non valido ${fmtV(p.fixed)}`);
      // assi da cui dipende il punto fisso (axes.ID.ox/oy/oz): durante la rotazione degli ingranaggi non devono spostarsi
      p.deps = [...new Set([...a.def.through[i].join(' ').matchAll(/axes\s*\.\s*([A-Za-z0-9_]+)\s*\.\s*o[xyz]/g)].map(m => m[1]))].map(id => M.axisBy[id]).filter(Boolean);
    }
    const t = { a, pts, ref: [0, 0, 1] };
    if (a.def.refFrom) {
      t.refFrom = M.axisBy[a.def.refFrom];
      if (!t.refFrom) throw new Error(`asse "${a.id}": refFrom "${a.def.refFrom}" non esiste o non è attivo`);
      step('through', `${a.id}: riferimento stabilizzato dall'asse ${t.refFrom.id}`);
    }

    a.aimed = true;
    M.through.push(t);
    const cache = new Map(), r = solveThrough(t, cache);
    a.O = r.O.slice(); a.dir = r.dir.slice(); a.ref = r.ref.slice(); a.yv = V.cross(a.dir, a.ref);
    step('through', `${a.id}: passa per ${pts.map(p => p.axis ? p.axis.id + ' ' + fmtV(axisFrame(p.axis, cache).O) : fmtV(p.fixed)).join(' e per ')}`);
  }
  // assi "alignWith": mantengono la propria origine (cinematica normale, portati dal loro carrier) ma hanno la direzione di un asse "through"
  M.aligned = [];
  for (const a of M.axes) if (a.def.alignWith) {
    const t = M.through.find(x => x.a.id === a.def.alignWith);
    if (!t) throw new Error(`asse "${a.id}": alignWith "${a.def.alignWith}" non è un asse con through`);
    a.aimed = a.aligned = true;
    a.dir = t.dir.slice(); a.ref = V.unit(V.perp(a.ref, a.dir)); a.yv = V.cross(a.dir, a.ref);   // posa iniziale (bounding box)
    const q = { a, t, ref: a.ref.slice() };
    // Se l'asse è portato da un carrier (es. il tubo sul barilotto), memorizzo il suo riferimento
    // nel sistema del carrier: la rotazione attorno al proprio asse seguirà così rigidamente il
    // carrier, invece dello "spin" apparente del trasporto parallelo lungo la coda.
    if (a.carrier) q.refLocal = a.ref.slice();
    M.aligned.push(q);
    step('allineato', `${a.id}: stessa direzione di ${t.a.id}, origine ${fmtV(a.O)}` + (a.carrier ? `, riferimento ancorato a ${a.carrier.id}` : ''));
  }
  // Assi solidali a una retta ma vincolati a restarle perpendicolari.
  M.perpendicular = [];
for (const a of M.axes) if (a.def.perpendicularTo) {
  const spec = a.def.perpendicularTo;
  const t = M.through.find(x => x.a.id === spec.line);
  const reference = M.axisBy[spec.reference];
  if (!t || !reference) throw new Error(`asse "${a.id}": perpendicularTo richiede una retta through e un asse reference validi`);
  a.aimed = true; a.aligned = true;
  const q = { a, t, reference };
  if (spec.refFrom) {
    const t2 = M.through.find(x => x.a.id === spec.refFrom);
    if (t2) q.refFromLine = t2;
    else {
      const a2 = M.axisBy[spec.refFrom];
      if (!a2) throw new Error(`asse "${a.id}": perpendicularTo.refFrom "${spec.refFrom}" non esiste o non è attivo`);
      q.refFromAxis = a2;
    }
    step('perpendicolare', `${a.id}: perpendicolare a ${t.a.id}, orientamento (ref) da ${spec.refFrom}`);
  } else {
    step('perpendicolare', `${a.id}: perpendicolare a ${t.a.id}, ref dalla verticale ${reference.id}`);
  }
  M.perpendicular.push(q);
}

  // i link possono agganciarsi qui (es. "rail": il binario si appoggia alle rette "through" appena create)
  Registry.run('initThrough', M, ev);
  CTX.where = '';
}

/* Assi "spinPerpTo": ruotano su se stessi (a.theta) in modo che l'asse figlio "axis" (perpendicolare a loro, come il barilotto sulla forcella)
   resti perpendicolare alla retta "line" (la coda). La retta passa per B (sull'asse di rotazione: la rotazione non lo sposta) e per M, quindi
   l'angolo si ricava in forma chiusa:  b(φ) = b0 cosφ + (f × b0) sinφ,  b(φ)·(M−B) = 0. */
function initSpins(M) {
  M.spins = [];
  for (const a of M.axes) if (a.def.spinPerpTo) {
    const sp = a.def.spinPerpTo, t = M.through.find(x => x.a.id === sp.line);
    if (!t) throw new Error(`asse "${a.id}": spinPerpTo.line "${sp.line}" non ha through`);
    M.spins.push({ a, child: M.axisBy[sp.axis], t, prev: 0 });
    step('spin', `${a.id}: ruota su se stesso perché ${sp.axis} resti perpendicolare a ${sp.line}`);
  }
}

function updateSpin(M) {
  if (!M.spins || !M.spins.length) return;
  const lines = [];
  for (const q of M.spins) {
    const keep = q.a.theta;
    q.a.theta = 0;                                              // con rotazione nulla: asse della forcella f, direzione b0 del figlio
    const c0 = new Map(), f = V.unit(axisFrame(q.a, c0).dir), b0 = V.unit(axisFrame(q.child, c0).dir);
    const P0 = q.t.pts[0].axis ? axisFrame(q.t.pts[0].axis, c0).O : q.t.pts[0].fixed;
    const P1 = q.t.pts[1].axis ? axisFrame(q.t.pts[1].axis, c0).O : q.t.pts[1].fixed;
    const c = V.sub(P1, P0), k = V.dot(b0, c), m = V.dot(V.cross(f, b0), c);
    if (Math.hypot(k, m) < 1e-9 * (V.len(c) || 1)) {
      q.a.theta = keep;
      warn('spin', `${q.a.id}: la retta ${q.t.a.id} è parallela all'asse della forcella, l'angolo di rotazione è indeterminato`);
      continue;
    }
    let phi = Math.atan2(-k, m);                                // due soluzioni: φ e φ+π (b e −b): si sceglie la più vicina alla precedente
    const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
    if (Math.abs(wrap(phi + PI - q.prev)) < Math.abs(wrap(phi - q.prev))) phi += PI;
    phi = q.prev + wrap(phi - q.prev);                          // senza salti di 2π
    q.prev = phi; q.a.theta = phi;
    lines.push(`${q.a.id}: ruota su se stessa di ${fmt(wrap(phi) * 180 / PI, 1)}° per tenere ${q.child.id} perpendicolare a ${q.t.a.id}.`);
  }
  M.spinText = lines.join(' ');
}

function solveThrough(t, cache) {
  const P = t.pts.map(p => p.axis ? axisFrame(p.axis, cache).O : p.fixed);
  const d = V.sub(P[1], P[0]), len = V.len(d);
  const dir = len > 1e-9 ? V.mul(d, 1 / len) : (t.dir || [0, 0, 1]);
// Il "ref" della coda (l'orientamento del suo frame attorno alla propria direzione) è derivato
  // dall'asse dichiarato in MACHINE con "refFrom": si prende la direzione CORRENTE di quell'asse
  // (che risente del suo carrier/rotazioni) e la si proietta perpendicolarmente alla coda. In questo
  // modo il frame della coda è ancorato a un vincolo fisico dichiarato nel JSON (la coda è solidale
  // allo specchio, lo specchio è solidale alla verticale) e non alla storia del proprio moto.
  const refSrc = t.refFrom ? V.unit(axisFrame(t.refFrom, cache).dir) : t.ref;
  let ref = V.perp(refSrc, dir);
  if (V.len(ref) < 1e-6) ref = V.perp([1, 0, 0], dir);
  ref = V.unit(ref);
  t.dir = dir; t.ref = ref;
  return { O: P[0], dir, ref, len, P };
}

function setNodePose(a, p) {
  const yv = V.cross(p.dir, p.ref), O = V.toB(p.O), fx = V.toB(p.ref), fy = V.toB(yv), fz = V.toB(p.dir);
  a.node.position.set(O[0], O[1], O[2]);
  a.node.rotationQuaternion = Quat.FromRotationMatrix(BABYLON.Matrix.FromValues(fx[0], fx[1], fx[2], 0, fy[0], fy[1], fy[2], 0, fz[0], fz[1], fz[2], 0, 0, 0, 0, 1));
}

function updateThrough(M) {
  if (!M.through || !M.through.length) return;
  const cache = new Map(), lines = [];
  for (const t of M.through) {
    const r = solveThrough(t, cache);
    setNodePose(t.a, r);
    // i link che dipendono da questa retta (es. i binari) si risolvono subito: le rette through successive possono avere "refFrom" sulla guida
    Registry.run('afterThroughLine', M, t, cache, lines);
    for (const p of t.pts) if (p.deps) {
      const moved = Math.max(0, ...p.deps.map(d => V.len(V.sub(axisFrame(d, cache).O, d.O))));
      p.moved = moved;
     // if (moved > 1e-6) fail('through', `${t.a.id}: il punto fisso dipende da ${p.deps.map(d => d.id).join(', ')}, che si è spostato di ${moved.toFixed(3)} mm durante la rotazione degli ingranaggi: il punto non è fisso, c'è un errore nella definizione`);
    }
    const fx = t.pts.find(p => p.deps);
    lines.push(`${t.a.id}: passa per ${t.pts.map(p => p.axis ? p.axis.id : 'il punto fisso').join(' e per ')}, distanza fra i due punti ${fmt(r.len, 1)} mm.` +
               (fx ? ` Spostamento del punto fisso durante la rotazione: ${fmt(fx.moved || 0, 3)} mm (deve essere 0).` : ''));
  }
  for (const q of M.aligned || []) {
    const f = axisFrame(q.a, cache), dir = q.t.dir;
    let ref;
    if (q.refLocal && q.a.carrier) {
      // Il riferimento dell'asse ruota rigidamente con il carrier (il barilotto): è lui a "portare"
      // l'orientamento del tubo attorno al proprio asse. La direzione invece resta imposta
      // geometricamente dalla coda (alignWith), quindi il riferimento va riportato nel piano
      // perpendicolare alla direzione corrente.
      const carR = axisFrame(q.a.carrier, cache).R;
      ref = V.perp(MAT.mulV(carR, q.refLocal), dir);
      if (V.len(ref) < 1e-6) ref = V.perp(q.ref, dir);
      if (V.len(ref) < 1e-6) ref = V.perp([1, 0, 0], dir);
    } else {
      ref = V.perp(q.ref, dir);
      if (V.len(ref) < 1e-6) ref = V.perp([1, 0, 0], dir);
    }
    ref = V.unit(ref); q.ref = ref;
    setNodePose(q.a, { O: f.O, dir, ref });
    if (q.a.carrier) {
      const cd = V.unit(axisFrame(q.a.carrier, cache).dir), tilt = Math.asin(Math.max(-1, Math.min(1, V.dot(dir, cd)))) * 180 / PI;
      q.tilt = tilt;
      lines.push(`${q.a.id}: coassiale a ${q.t.a.id}; inclinato di ${fmt(Math.abs(tilt), 1)}° rispetto al piano perpendicolare a ${q.a.carrier.id} (con la sola rotazione attorno al barilotto sarebbe 0°).`);
    }
  }
  // L'asse orizzontale dello specchio resta nel centro fisso e si orienta
  // come prodotto vettoriale fra la verticale di riferimento e la coda:
  // così è orizzontale, perpendicolare alla coda e ne segue l'orientamento.
for (const q of M.perpendicular || []) {
  const vertical = V.unit(axisFrame(q.reference, cache).dir);
  const tailDir  = V.unit(q.t.dir);
  let dir = V.cross(vertical, tailDir);
  if (V.len(dir) < 1e-8) dir = q.a.dir.slice();
  dir = V.unit(dir);

  // Riferimento del frame:
  //  – se "refFrom" punta a un asse "through" (tipicamente la coda stessa), uso il suo .ref
  //    (che è già stabile perché quell'asse ha il proprio refFrom);
  //  – se "refFrom" punta a un asse ordinario, uso il suo .ref (o .dir come fallback);
  //  – altrimenti comportamento storico: proiezione della verticale sul piano ⟂ a dir.
  let refSrc;
  if (q.refFromLine)      refSrc = q.refFromLine.ref;
  else if (q.refFromAxis) refSrc = q.refFromAxis.ref || q.refFromAxis.dir;
  else                    refSrc = vertical;

  let ref = V.perp(refSrc, dir);
  if (V.len(ref) < 1e-8) ref = V.perp([0, 1, 0], dir);
  ref = V.unit(ref);

  setNodePose(q.a, { O: q.a.O, dir, ref });
  q.a.dir = dir; q.a.ref = ref; q.a.yv = V.cross(dir, ref);
  lines.push(`${q.a.id}: perpendicolare a ${q.t.a.id}, ref da ${q.refFromLine ? q.refFromLine.a.id : q.refFromAxis ? q.refFromAxis.id : q.reference.id}.`);
}
  M.throughText = lines.join(' ');
}


function initSpinAlign(M) { /* per giunti sferici "dissociati" in due assi ortogonali */
  M.spinAlign = [];

  const sourceVectors = new Set(["ref", "yv"]);
  const targetVectors = new Set(["dir", "ref", "yv"]);

  for (const axis of M.axes) {
    const spec = axis.def.spinAlignTo;
    if (!spec) continue;

    const target = M.axisBy[spec.target];

    if (!target) {
      throw new Error(
        `Asse "${axis.id}": spinAlignTo.target ` +
        `"${spec.target}" non esiste o non è attivo`
      );
    }

    const sourceVector = spec.sourceVector || "yv";
    const targetVector = spec.targetVector || "dir";
    const mode = spec.mode || "parallel";

    if (!sourceVectors.has(sourceVector)) {
      throw new Error(
        `Asse "${axis.id}": sourceVector deve essere "ref" oppure "yv"`
      );
    }

    if (!targetVectors.has(targetVector)) {
      throw new Error(
        `Asse "${axis.id}": targetVector non valido`
      );
    }

    if (!["parallel", "same"].includes(mode)) {
      throw new Error(
        `Asse "${axis.id}": mode deve essere "parallel" oppure "same"`
      );
    }

    if (axis.aimed || axis.aligned) {
      throw new Error(
        `Asse "${axis.id}": spinAlignTo richiede ` +
        `un asse orientabile tramite theta`
      );
    }

    M.spinAlign.push({
      axis,
      target,
      sourceVector,
      targetVector,
      mode
    });
  }
}



function currentWorldVector(axis, property) {
  // Gli assi aimed/aligned hanno già i riferimenti
  // aggiornati nel sistema di coordinate del modello.
  if (axis.aimed || axis.aligned) {
    return V.unit(axis[property]);
  }

  // Per gli altri assi, trasforma il vettore locale
  // nella posa corrente del modello.
  const frame = axisFrame(axis, new Map());

  if (property === "dir") {
    return V.unit(frame.dir);
  }

  return V.unit(MAT.mulV(frame.R, axis[property]));
}

function updateSpinAlign(M)  {  /* Per gestione giunti sferici dissociati */
//console.log("[updateSpinAlign]");
  const wrap = angle =>
    Math.atan2(Math.sin(angle), Math.cos(angle));

  for (const q of M.spinAlign || []) {
//console.log("[updateSpinAlign] vincolo ", q);

    const { axis, target, sourceVector, targetVector, mode } = q;

    const previous = axis.theta || 0;

    // Direzione obiettivo nella posa corrente.
    const targetDir = currentWorldVector(target, targetVector);

    // La sorgente viene valutata con theta = 0:
    // così ricaviamo la direzione di riferimento
    // prima della rotazione attorno all'asse.
    axis.theta = 0;

    const baseFrame = axisFrame(axis, new Map());
    const k = V.unit(baseFrame.dir);

    const sourceDir = V.unit(
      MAT.mulV(baseFrame.R, axis[sourceVector])
    );

    axis.theta = previous;

    // La rotazione attorno a k può allineare soltanto
    // direzioni perpendicolari a k.
    if (Math.abs(V.dot(targetDir, k)) > 1e-4) {
      if (!q.invalidGeometry) {
        warn(
          "spinAlign",
          `${axis.id}: il vettore obiettivo ${target.id}.${targetVector} ` +
          `non è perpendicolare all'asse di rotazione`
        );
        q.invalidGeometry = true;
      }
      continue;
    }

    const sourceProjected = V.perp(sourceDir, k);
    const targetProjected = V.perp(targetDir, k);

    if (
      V.len(sourceProjected) < 1e-8 ||
      V.len(targetProjected) < 1e-8
    ) {
      continue;
    }

    const from = V.unit(sourceProjected);
    const to = V.unit(targetProjected);

    // Angolo che ruota from verso to attorno a k.
    const t1 = Math.atan2(
      V.dot(to, V.cross(k, from)),
      V.dot(from, to)
    );

    // Una relazione "parallel" ammette anche
    // la direzione opposta, separata da 180°.
    const candidates =
      mode === "parallel" ? [t1, t1 + PI] : [t1];

    let best = candidates[0];

    for (const candidate of candidates.slice(1)) {
      if (
        Math.abs(wrap(candidate - previous)) <
        Math.abs(wrap(best - previous))
      ) {
        best = candidate;
      }
    }

    // Aggiorna theta senza salti di 2π.
    axis.theta = previous + wrap(best - previous);

    // Il nodo viene aggiornato subito, come nel codice attuale.
    if (axis.node) {
      axis.node.rotationQuaternion =
        Quat.RotationAxis(axis.axisB, axis.theta);
    }
  }
}


/* updateSpin fa parte della fase afterIntegrate dei link (dopo geneva e hooke, prima di pin_slot) */
Registry.hook('afterIntegrate', 25, M => updateSpin(M), 'updateSpin');
