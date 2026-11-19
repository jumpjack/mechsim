/* =====================================================================
   types/links/slider_GK/solve.js
   Biella-manovella + pistone in cilindro (slider-crank)
   ---------------------------------------------------------------------
   JSON:
     { "type": "slider_GK",
       "crankPin":  "axis_Biella",
       "pistonPin": "axis_Pistone_Orizz",
       "cylinder":  "axis_Pistone_Vert",
       "length":    120,
       "piston":    "axis_Pistone",
       "rod":       "axis_Rod",
       "crankOffset": 0,
       "pistonOffset": 0,
       "followers": [                    // assi trasportati dal pistone
         { "axis": "axis_Attacco", "at": [0, 0, 10] }
       ],
       "marker": true
     }

   "followers": ogni asse elencato viene posizionato ogni frame solidale al
   pistone. "at" è il punto locale sul pistone [ref, yv, dir] che diventa
   l'origine del follower. Il follower mantiene la dir del pistone (guida).
   ===================================================================== */

function solveSliderGK(q, cache) {
  const fPin = axisFrame(q.crankPin, cache);
  const pinDir = V.unit(fPin.dir);
  const C = V.add(fPin.O, V.mul(pinDir, q.crankOffset));

  const Q = q.cylinder.O;
  const u = V.unit(q.cylinder.dir);
  const L = q.length;

  const d = V.sub(Q, C);
  const b = 2 * V.dot(d, u);
  const c = V.dot(d, d) - L * L;
  const disc = b * b - 4 * c;

  if (disc < -1e-8) {
    return q.last ? { ...q.last, stale: true } : null;
  }

  const sqrtD = Math.sqrt(Math.max(0, disc));
  const s1 = (-b + sqrtD) / 2;
  const s2 = (-b - sqrtD) / 2;

  let s;
  if (q.prevS == null || !Number.isFinite(q.prevS)) {
    s = s1 >= s2 ? s1 : s2;
  } else {
    s = Math.abs(s1 - q.prevS) <= Math.abs(s2 - q.prevS) ? s1 : s2;
  }
  q.prevS = s;

  const P = V.add(Q, V.mul(u, s));

  let ref = q.prevRef ? V.perp(q.prevRef, pinDir) : V.anyPerp(pinDir);
  if (V.len(ref) < 1e-8) ref = V.anyPerp(pinDir);
  ref = V.unit(ref);
  q.prevRef = ref;

  const rodVec = V.sub(P, C);
  const rodLen = V.len(rodVec);
  const rodDir = rodLen > 1e-9 ? V.mul(rodVec, 1 / rodLen) : (q.last && q.last.rodDir ? q.last.rodDir : [0, 0, 1]);

  let rodRef = V.perp(pinDir, rodDir);
  if (V.len(rodRef) < 1e-8) rodRef = V.anyPerp(rodDir);
  rodRef = V.unit(rodRef);

  q.last = {
    C, P, s,
    pinDir, ref,
    rodDir, rodRef,
    resid: Math.abs(rodLen - L),
    stale: false
  };
  return q.last;
}

function applySliderGK(q, r) {
  if (!r) return;

  // --- perno del pistone ---
  const pinO = V.sub(r.P, V.mul(r.pinDir, q.pistonOffset));
  q.pistonPin.O   = pinO.slice();
  q.pistonPin.dir = r.pinDir.slice();
  q.pistonPin.ref = r.ref.slice();
  q.pistonPin.yv  = V.cross(r.pinDir, r.ref);
  setNodePose(q.pistonPin, { O: pinO, dir: r.pinDir, ref: r.ref });

  // --- corpo del pistone ---
  const pDir = V.unit(q.cylinder.dir);
  let pRef = V.perp(r.ref, pDir);
  if (V.len(pRef) < 1e-8) pRef = V.anyPerp(pDir);
  pRef = V.unit(pRef);
  const pYv = V.cross(pDir, pRef);

  if (q.piston) {
    q.piston.O   = r.P.slice();
    q.piston.dir = pDir.slice();
    q.piston.ref = pRef.slice();
    q.piston.yv  = pYv.slice();
    setNodePose(q.piston, { O: r.P, dir: pDir, ref: pRef });
  }

  // --- follower: assi solidali al pistone ---
  // origine = P + ref·atx + yv·aty + dir·atz  (at nel frame del pistone)
  for (const f of q.followers) {
    const at = f.at;
    const O = V.add(r.P,
      V.add(V.mul(pRef, at[0]),
        V.add(V.mul(pYv, at[1]), V.mul(pDir, at[2]))));
    f.axis.O   = O.slice();
    f.axis.dir = pDir.slice();
    f.axis.ref = pRef.slice();
    f.axis.yv  = pYv.slice();
    setNodePose(f.axis, { O, dir: pDir, ref: pRef });
  }

  // --- asse biella ---
  if (q.rod) {
    q.rod.O   = r.C.slice();
    q.rod.dir = r.rodDir.slice();
    q.rod.ref = r.rodRef.slice();
    q.rod.yv  = V.cross(r.rodDir, r.rodRef);
    setNodePose(q.rod, { O: r.C, dir: r.rodDir, ref: r.rodRef });
  }

  if (q.marker) {
    const p = V.toB(r.P);
    q.marker.position.set(p[0], p[1], p[2]);
    q.marker.setEnabled(true);
  }

  if (q.rodMesh) {
    const mid = V.mul(V.add(r.C, r.P), 0.5);
    const len = Math.max(V.len(V.sub(r.P, r.C)), 1e-6);
    const yM = r.rodDir, xM = r.rodRef, zM = V.cross(xM, yM);
    const xB = V.toB(xM), yB = V.toB(yM), zB = V.toB(zM);
    const p  = V.toB(mid);
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


Registry.link('slider_GK', {
  collection: 'sliders_GK',
  order: { afterIntegrate: 40 },

  validate(l, w, { E, ax, axisBy, isVec }) {
    ax(l.crankPin,  'crankPin');
    ax(l.pistonPin, 'pistonPin');
    ax(l.cylinder,  'cylinder');
    if (l.piston) ax(l.piston, 'piston');
    if (l.rod)    ax(l.rod,    'rod');

    if (l.crankPin === l.pistonPin) E(`${w}: crankPin e pistonPin devono essere assi diversi`);
    if (l.crankPin === l.cylinder)  E(`${w}: crankPin e cylinder devono essere assi diversi`);
    if (l.pistonPin === l.cylinder) E(`${w}: pistonPin e cylinder devono essere assi diversi`);

    if (l.followers) {
      if (!Array.isArray(l.followers)) E(`${w}: "followers" deve essere un array`);
      for (const [i, f] of l.followers.entries()) {
        if (!f || typeof f !== 'object') E(`${w}: followers[${i}] non valido`);
        ax(f.axis, `followers[${i}].axis`);
        if (f.at !== undefined && !isVec(f.at, 3)) E(`${w}: followers[${i}].at deve avere 3 elementi`);
      }
    }

    const pp = axisBy[l.pistonPin];
    if (pp && (pp.through !== undefined || pp.alignWith !== undefined))
      E(`${w}: pistonPin "${l.pistonPin}" non può avere "through" né "alignWith"`);
    if (l.piston) {
      const pis = axisBy[l.piston];
      if (pis && (pis.through !== undefined || pis.alignWith !== undefined))
        E(`${w}: piston "${l.piston}" non può avere "through" né "alignWith"`);
    }
    if (l.rod) {
      const rd = axisBy[l.rod];
      if (rd && (rd.through !== undefined || rd.alignWith !== undefined))
        E(`${w}: rod "${l.rod}" non può avere "through" né "alignWith"`);
    }
  },

  resolve(M, { ev, vec }) {
    for (const l of MACHINE.links) {
      if (l.type !== 'slider_GK' || !isActive(l)) continue;
      CTX.where = `link slider_GK ${l.crankPin} → ${l.pistonPin}`;

      const crankPin  = M.axisBy[l.crankPin];
      const pistonPin = M.axisBy[l.pistonPin];
      const cylinder  = M.axisBy[l.cylinder];
      const piston    = l.piston ? M.axisBy[l.piston] : null;
      const rod       = l.rod    ? M.axisBy[l.rod]    : null;

      if (!crankPin)  throw new Error(`slider_GK: crankPin "${l.crankPin}" non esiste`);
      if (!pistonPin) throw new Error(`slider_GK: pistonPin "${l.pistonPin}" non esiste`);
      if (!cylinder)  throw new Error(`slider_GK: cylinder "${l.cylinder}" non esiste`);
      if (l.piston && !piston) throw new Error(`slider_GK: piston "${l.piston}" non esiste`);
      if (l.rod && !rod)       throw new Error(`slider_GK: rod "${l.rod}" non esiste`);

      let length;
      if (l.length !== undefined) {
        length = ev(l.length);
        if (!Number.isFinite(length) || length <= 0)
          throw new Error(`slider_GK: "length" non valida (${l.length})`);
      } else {
        length = V.len(V.sub(pistonPin.O, crankPin.O));
        if (length < 1e-3) length = 100;
        step('slider_GK', `length non specificata, usata distanza iniziale ${fmt(length, 2)} mm`);
      }

      const crankOffset  = l.crankOffset  !== undefined ? ev(l.crankOffset)  : 0;
      const pistonOffset = l.pistonOffset !== undefined ? ev(l.pistonOffset) : 0;

      const followers = [];
      for (const f of (l.followers || [])) {
        const ax = M.axisBy[f.axis];
        if (!ax) throw new Error(`slider_GK: follower "${f.axis}" non esiste`);
        ax.aimed = true;
        followers.push({
          axis: ax,
          at: f.at !== undefined ? vec(f.at) : [0, 0, 0]
        });
      }

      const wantRodVisual = !rod && l.rodVisual !== false;

      pistonPin.aimed = true;
      if (piston) piston.aimed = true;
      if (rod)    rod.aimed = true;

      M.sliders_GK.push({
        def: l,
        crankPin, pistonPin, cylinder, piston, rod,
        length, crankOffset, pistonOffset,
        followers,
        wantRodVisual,
        prevS: null,
        prevRef: null,
        last: null,
        rodMesh: null,
        marker: null
      });

      step('slider_GK',
        `biella L=${fmt(length, 1)} mm · crankPin=${crankPin.id} · pistonPin=${pistonPin.id} · guida=${cylinder.id}` +
        (piston ? ` · pistone=${piston.id}` : '') +
        (rod ? ` · rod=${rod.id}` : wantRodVisual ? ' · rodVisual' : '') +
        (followers.length ? ` · followers=[${followers.map(f => f.axis.id).join(',')}]` : '') +
        ` · crankOffset=${fmt(crankOffset, 1)}`);
    }
  },

  afterIntegrate(M) {
    if (!M.sliders_GK || !M.sliders_GK.length) return;
    const cache = new Map();
    for (const q of M.sliders_GK) {
      const r = solveSliderGK(q, cache);
      applySliderGK(q, r);
    }
  },

  afterPose(M) {
    if (!M.sliders_GK || !M.sliders_GK.length) return;
    const cache = new Map();
    for (const q of M.sliders_GK) {
      const r = solveSliderGK(q, cache);
      applySliderGK(q, r);
    }
  }
});
