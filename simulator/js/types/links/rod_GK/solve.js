/* =====================================================================
   types/links/rod_GK/solve.js
   Asta a lunghezza fissa: collega un punto guida a un punto su un bilanciere.

   I due meccanismi restano separati:
     - slider_GK  posiziona il pistone (e i suoi follower)
     - rod_GK     legge un punto sul pistone (o su qualunque asse) e risolve
                  l'angolo del bilanciere

   JSON:
     { "type": "rod_GK",
       "from":    "axis_Pistone",     // asse da cui parti (es. pistone)
       "fromAt":  [0, 0, 10],         // punto LOCALE su from [ref, yv, dir]
       "pivot":   "axis_Rocker",      // bilanciere (ruota attorno a dir)
       "pivotAt": [0, -40, 0],        // punto di attacco LOCALE sul bilanciere
                                      //   [ref, yv, dir] a theta = 0
       "length":  55,                 // lunghezza asta
       "rod":     "axis_Spinta",      // opzionale: asse visuale dell'asta
       "marker":  true
     }

   Non serve più un asse "to" / RockerPin per il vincolo.
   Se vuoi un perno visuale sul bilanciere, metti una part su pivot
   oppure un asse con carrier = pivot e place all'offset desiderato
   (non lo tocchiamo).
   ===================================================================== */

function rodrigues(k, theta, v) {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const kxv = V.cross(k, v);
  const kdo = V.dot(k, v);
  return V.add(V.add(V.mul(v, ct), V.mul(kxv, st)), V.mul(k, kdo * (1 - ct)));
}

function frameBasis(a, cache) {
  const f = axisFrame(a, cache);
  const dir = V.unit(f.dir);
  // ref/yv a theta=0 (non ruotati): li prendiamo dall'asse come definiti al resolve
  let ref0 = a._rodRef0 || a.ref || V.anyPerp(dir);
  ref0 = V.unit(V.perp(ref0, dir));
  if (V.len(ref0) < 1e-8) ref0 = V.anyPerp(dir);
  let yv0 = a._rodYv0 || a.yv || V.cross(dir, ref0);
  yv0 = V.unit(V.perp(yv0, dir));
  if (V.len(yv0) < 1e-8) yv0 = V.cross(dir, ref0);
  return { O: f.O, dir, ref0: V.unit(ref0), yv0: V.unit(yv0) };
}

/** Punto locale [x,y,z] nel basis (ref0,yv0,dir), poi ruotato di theta attorno a dir */
function bodyPoint(basis, at, theta) {
  const loc = V.add(
    V.add(V.mul(basis.ref0, at[0]), V.mul(basis.yv0, at[1])),
    V.mul(basis.dir, at[2])
  );
  return V.add(basis.O, theta ? rodrigues(basis.dir, theta, loc) : loc);
}

function solveRodGK(q, cache) {
  // --- punto guida (from) ---
  // from può essere aimed (pistone): usiamo O/dir/ref aggiornati
  const fFrom = axisFrame(q.from, cache);
  const dirF = V.unit(fFrom.dir);
  let refF = q.from.ref ? V.unit(V.perp(q.from.ref, dirF)) : V.anyPerp(dirF);
  if (V.len(refF) < 1e-8) refF = V.anyPerp(dirF);
  let yvF = q.from.yv ? V.unit(V.perp(q.from.yv, dirF)) : V.cross(dirF, refF);
  if (V.len(yvF) < 1e-8) yvF = V.cross(dirF, refF);
  const F = V.add(fFrom.O,
    V.add(V.mul(refF, q.fromAt[0]),
      V.add(V.mul(yvF, q.fromAt[1]), V.mul(dirF, q.fromAt[2]))));

  // --- bilanciere ---
  const basis = frameBasis(q.pivot, cache);
  const O = basis.O;
  const k = basis.dir;
  const loc0 = V.add(
    V.add(V.mul(basis.ref0, q.pivotAt[0]), V.mul(basis.yv0, q.pivotAt[1])),
    V.mul(basis.dir, q.pivotAt[2])
  );
  // componente nel piano ⟂ k (il moto del punto di attacco)
  const loc = V.perp(loc0, k);
  const R = V.len(loc);
  const axial = V.dot(loc0, k);       // eventuale offset lungo l'asse (costante)

  if (R < 1e-9) {
    return q.last ? { ...q.last, stale: true } : null;
  }

  const FO = V.sub(F, O);
  const Fperp = V.perp(FO, k);
  const d = V.len(Fperp);
  // lunghezza efficace nel piano: la distanza 3D tiene conto anche del dislivello assiale
  const dAx = V.dot(FO, k) - axial;
  const Lplane2 = q.length * q.length - dAx * dAx;
  if (Lplane2 < 0) {
    return q.last ? { ...q.last, stale: true } : null;
  }
  const Lplane = Math.sqrt(Lplane2);

  if (d < 1e-9) {
    return q.last ? { ...q.last, stale: true } : null;
  }

  const cosAlpha = (d * d + R * R - Lplane * Lplane) / (2 * d * R);
  if (cosAlpha < -1.001 || cosAlpha > 1.001) {
    return q.last ? { ...q.last, stale: true } : null;
  }
  const cA = Math.max(-1, Math.min(1, cosAlpha));
  const alpha = Math.acos(cA);

  const u = V.unit(Fperp);
  const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
  const locU = V.unit(loc);
  const angLoc0 = Math.atan2(V.dot(V.cross(u, locU), k), V.dot(u, locU));

  // theta tale che angolo di loc ruotato = ±alpha rispetto a u
  const th1 = wrap(alpha - angLoc0);
  const th2 = wrap(-alpha - angLoc0);

  let theta;
  if (q.prevTheta == null || !Number.isFinite(q.prevTheta)) {
    theta = Math.abs(th1) <= Math.abs(th2) ? th1 : th2;
  } else {
    const d1 = Math.abs(wrap(th1 - q.prevTheta));
    const d2 = Math.abs(wrap(th2 - q.prevTheta));
    theta = d1 <= d2 ? th1 : th2;
  }
  theta = q.prevTheta != null ? q.prevTheta + wrap(theta - q.prevTheta) : theta;
  q.prevTheta = theta;

  const P = bodyPoint(basis, q.pivotAt, theta);

  const rodVec = V.sub(P, F);
  const rodLen = V.len(rodVec);
  const rodDir = rodLen > 1e-9 ? V.mul(rodVec, 1 / rodLen) : [0, 0, 1];
  let rodRef = V.perp(k, rodDir);
  if (V.len(rodRef) < 1e-8) rodRef = V.anyPerp(rodDir);
  rodRef = V.unit(rodRef);

  q.last = { F, P, O, theta, rodDir, rodRef, resid: Math.abs(rodLen - q.length), stale: false };
  return q.last;
}

function applyRodGK(q, r) {
  if (!r) return;

  // solo l'angolo del bilanciere: la gerarchia Babylon (parts, eventuali carrier)
  // ruota da sola con theta
  q.pivot.theta = r.theta;

  // aggiorna il quaternion del nodo pivot (non è aimed)
  if (q.pivot.node && q.pivot.axisB) {
    q.pivot.node.rotationQuaternion = Quat.RotationAxis(q.pivot.axisB, r.theta);
  }

  if (q.rod) {
    q.rod.O = r.F.slice();
    q.rod.dir = r.rodDir.slice();
    q.rod.ref = r.rodRef.slice();
    q.rod.yv = V.cross(r.rodDir, r.rodRef);
    setNodePose(q.rod, { O: r.F, dir: r.rodDir, ref: r.rodRef });
  }

  if (q.marker) {
    const p = V.toB(r.P);
    q.marker.position.set(p[0], p[1], p[2]);
    q.marker.setEnabled(true);
  }

  if (q.rodMesh) {
    const mid = V.mul(V.add(r.F, r.P), 0.5);
    const len = Math.max(V.len(V.sub(r.P, r.F)), 1e-6);
    const yM = r.rodDir, xM = r.rodRef, zM = V.cross(xM, yM);
    const xB = V.toB(xM), yB = V.toB(yM), zB = V.toB(zM);
    const p = V.toB(mid);
    q.rodMesh.position.set(p[0], p[1], p[2]);
    q.rodMesh.rotationQuaternion = Quat.FromRotationMatrix(
      BABYLON.Matrix.FromValues(
        xB[0], xB[1], xB[2], 0,
        yB[0], yB[1], yB[2], 0,
        zB[0], zB[1], zB[2], 0,
        0, 0, 0, 1
      )
    );
    q.rodMesh.scaling.set(1, len, 1);
    q.rodMesh.setEnabled(true);
  }
}


Registry.link('rod_GK', {
  collection: 'rods_GK',
  order: { afterIntegrate: 50 },

  validate(l, w, { E, ax, isVec }) {
    ax(l.from,  'from');
    ax(l.pivot, 'pivot');
    if (l.rod) ax(l.rod, 'rod');
    if (l.from === l.pivot) E(`${w}: from e pivot devono essere assi diversi`);
    if (l.fromAt  !== undefined && !isVec(l.fromAt,  3)) E(`${w}: "fromAt" deve avere 3 elementi`);
    if (l.pivotAt !== undefined && !isVec(l.pivotAt, 3)) E(`${w}: "pivotAt" deve avere 3 elementi`);
    // "to" è accettato ma ignorato (retrocompatibilità): non serve più
  },

  resolve(M, { ev, vec }) {
    for (const l of MACHINE.links) {
      if (l.type !== 'rod_GK' || !isActive(l)) continue;
      CTX.where = `link rod_GK ${l.from} → pivot ${l.pivot}`;

      const from  = M.axisBy[l.from];
      const pivot = M.axisBy[l.pivot];
      const rod   = l.rod ? M.axisBy[l.rod] : null;

      if (!from)  throw new Error(`rod_GK: from "${l.from}" non esiste`);
      if (!pivot) throw new Error(`rod_GK: pivot "${l.pivot}" non esiste`);
      if (l.rod && !rod) throw new Error(`rod_GK: rod "${l.rod}" non esiste`);

      let length;
      if (l.length !== undefined) {
        length = ev(l.length);
        if (!Number.isFinite(length) || length <= 0)
          throw new Error(`rod_GK: "length" non valida (${l.length})`);
      } else {
        length = 50;
        step('rod_GK', `length non specificata, uso ${length} mm`);
      }

      const fromAt  = l.fromAt  !== undefined ? vec(l.fromAt)  : [0, 0, 0];
      const pivotAt = l.pivotAt !== undefined ? vec(l.pivotAt) : [0, 1, 0];

      // congela il basis a theta=0 del pivot
      const dir = V.unit(pivot.dir);
      let ref0 = pivot.ref ? V.unit(V.perp(pivot.ref, dir)) : V.anyPerp(dir);
      if (V.len(ref0) < 1e-8) ref0 = V.anyPerp(dir);
      let yv0 = pivot.yv ? V.unit(V.perp(pivot.yv, dir)) : V.cross(dir, ref0);
      if (V.len(yv0) < 1e-8) yv0 = V.cross(dir, ref0);
      pivot._rodRef0 = V.unit(ref0);
      pivot._rodYv0  = V.unit(yv0);

      // raggio del punto di attacco nel piano
      const loc = V.add(
        V.add(V.mul(pivot._rodRef0, pivotAt[0]), V.mul(pivot._rodYv0, pivotAt[1])),
        V.mul(dir, pivotAt[2])
      );
      const R = V.len(V.perp(loc, dir));
      if (R < 1e-3)
        warn('rod_GK', `pivotAt quasi sull'asse di ${pivot.id}: raggio ${fmt(R, 3)} mm — il bilanciere non può ruotare utilmente`);

      if (rod) rod.aimed = true;

      const wantRodVisual = !rod && l.rodVisual !== false;

      M.rods_GK.push({
        def: l,
        from, pivot, rod,
        length, fromAt, pivotAt,
        wantRodVisual,
        prevTheta: pivot.theta || 0,
        last: null,
        rodMesh: null,
        marker: null
      });

      step('rod_GK',
        `L=${fmt(length, 1)} mm · from=${from.id} at [${fromAt.map(x => fmt(x, 1)).join(',')}]` +
        ` · pivot=${pivot.id} at [${pivotAt.map(x => fmt(x, 1)).join(',')}] r=${fmt(R, 1)} mm` +
        (rod ? ` · rod=${rod.id}` : ''));
    }
  },

  afterIntegrate(M) {
    if (!M.rods_GK || !M.rods_GK.length) return;
    const cache = new Map();
    for (const q of M.rods_GK) {
      const r = solveRodGK(q, cache);
      applyRodGK(q, r);
    }
  },

  afterPose(M) {
    if (!M.rods_GK || !M.rods_GK.length) return;
    const cache = new Map();
    for (const q of M.rods_GK) {
      const r = solveRodGK(q, cache);
      applyRodGK(q, r);
    }
  }
});
