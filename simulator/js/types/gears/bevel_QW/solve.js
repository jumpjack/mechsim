/* =====================================================================
types/gears/bevel_QW/solve.js
Ingranaggio conico ad AUTO-CALCOLO COMPLETO (type "bevel_QW")
Basta specificare: axis, pos (posizione centro sull'asse), thickness e module.
===================================================================== */

console.log('[bevel_QW] solve.js caricato');

Registry.gear('bevel_QW', {
  meshWith: ['bevel_QW'],  // Può ingranare SOLO con altri bevel_QW
  minTeeth: 3,

  validate(g, w, { E, W, isVec, partnerOf }) {
    if (g.module === undefined) E(`${w}: manca "module"`);

    if (g.pos !== undefined) {
      if (g.thickness === undefined) E(`${w}: manca "thickness" (spessore della ruota)`);
    } else {
      if (g.teeth === undefined) E(`${w}: mancano i "teeth" (oppure fornisci "pos" per l'auto-calcolo)`);
      if (g.apexW === undefined) E(`${w}: manca "apexW" (oppure fornisci "pos" per l'auto-calcolo)`);
    }

    if (g.side !== undefined && g.side !== 1 && g.side !== -1) E(`${w}: "side" deve essere 1 oppure -1`);

    if (g.free !== undefined && typeof g.free !== 'boolean') {
      E(`${w}: "free" deve essere boolean (true/false)`);
    }

    if (g.bore !== undefined && g.bore !== false) {
      const b = g.bore;
      if (typeof b === 'number' || typeof b === 'string') {
        // OK
      } else if (typeof b === 'object' && b !== null) {
        if (b.r === undefined) E(`${w}: bore manca "r"`);
      } else {
        E(`${w}: bore deve essere numero, false oppure {r:...}`);
      }
    }
  },

  resolve(g, { ev }) {
    const pId = g.meshWith || (typeof CTX !== 'undefined' && CTX.gears
      ? Object.keys(CTX.gears).find(id => CTX.gears[id].meshWith === g.id)
      : null);
    const p = pId && typeof CTX !== 'undefined' && CTX.gears ? CTX.gears[pId] : null;

    if (g.def.pos !== undefined && p && p.def && p.def.pos !== undefined) {
      if (g.z !== undefined) {
        return `, pos=${ev(g.def.pos)}, apexW=${+g.apexW.toFixed(2)} (auto-calcolato dal partner), side=${g.side}`;
      }

      const pos_g = ev(g.def.pos);
      const pos_p = ev(p.def.pos);
      const m = ev(g.module);

      const O1 = g.ax.O, d1 = g.ax.dir;
      const O2 = p.ax.O, d2 = p.ax.dir;

      const W1 = V.add(O1, V.mul(d1, pos_g));
      const W2 = V.add(O2, V.mul(d2, pos_p));

      const w0 = V.sub(O1, O2);
      const a = V.dot(d1, d1), b = V.dot(d1, d2), c = V.dot(d2, d2);
      const d_dot = V.dot(d1, w0), e_dot = V.dot(d2, w0);
      const D = a * c - b * b;

      if (Math.abs(D) < 1e-8) {
        throw new Error(`Assi paralleli per coppia conica ${g.id} e ${p.id}. Le ruote coniche richiedono assi concorrenti.`);
      }

      const t1 = (b * e_dot - c * d_dot) / D;
      const t2 = (a * e_dot - b * d_dot) / D;
      const P1 = V.add(O1, V.mul(d1, t1));
      const P2 = V.add(O2, V.mul(d2, t2));
      const dist = V.len(V.sub(P1, P2));

      if (dist > 0.5) {
        throw new Error(`Assi non concorrenti per ${g.id} e ${p.id}: distanza minima ${dist.toFixed(2)} mm.`);
      }

      const apex = V.mul(V.add(P1, P2), 0.5);
      g.apex = apex;
      p.apex = apex;

      const vec1 = V.sub(W1, apex);
      const vec2 = V.sub(W2, apex);
      const L1_signed = V.dot(vec1, d1);
      const L2_signed = V.dot(vec2, d2);

      const L1 = Math.abs(L1_signed);
      const L2 = Math.abs(L2_signed);

      g.side = L1_signed > 0 ? 1 : -1;
      p.side = L2_signed > 0 ? 1 : -1;
      g.e = V.mul(d1, g.side);
      p.e = V.mul(d2, p.side);

      const cosSigma = Math.max(-1, Math.min(1, V.dot(g.e, p.e)));
      const sinSigma = Math.sqrt(Math.max(0, 1 - cosSigma * cosSigma));

      const tanDelta1_geom = (L2 - L1 * cosSigma) / (L1 * sinSigma);
      const tanDelta2_geom = (L1 - L2 * cosSigma) / (L2 * sinSigma);

      const delta1_geom = Math.atan(tanDelta1_geom);
      const delta2_geom = Math.atan(tanDelta2_geom);

      const r1_geom = L1 * Math.tan(delta1_geom);
      const r2_geom = L2 * Math.tan(delta2_geom);

      const minTeeth = Registry.gear('bevel_QW').minTeeth || 3;
      let z1 = Math.max(minTeeth, Math.round(2 * r1_geom / m));
      let z2 = Math.max(minTeeth, Math.round(2 * r2_geom / m));

      const delta1 = Math.atan2(sinSigma, z2 / z1 + cosSigma);
      const delta2 = Math.atan2(sinSigma, z1 / z2 + cosSigma);

      const r1_exact = m * z1 / 2;
      const r2_exact = m * z2 / 2;

      const L1_exact = r1_exact / Math.tan(delta1);
      const L2_exact = r2_exact / Math.tan(delta2);

      g.apexW = pos_g - g.side * L1_exact;
      p.apexW = pos_p - p.side * L2_exact;

      g.z = z1;
      p.z = z2;
      g.delta = delta1;
      p.delta = delta2;

      step('bevel_QW (auto)', `${g.id} e ${p.id}: Apice calcolato in ${fmtV(apex)}.`);
      step('bevel_QW (auto)', `  Posizioni: ${g.id}=${pos_g}, ${p.id}=${pos_p}`);
      step('bevel_QW (auto)', `  Soluzione: z1=${z1}, z2=${z2}, δ1=${(delta1*180/Math.PI).toFixed(2)}°, δ2=${(delta2*180/Math.PI).toFixed(2)}°`);

      const err1 = Math.abs(L1_exact - L1);
      const err2 = Math.abs(L2_exact - L2);
      if (err1 > 0.1 || err2 > 0.1) {
        warn('bevel_QW', `Per rispettare il modulo ${m} e denti interi, la geometria è stata adattata: ${g.id} (ΔL=${err1.toFixed(2)}mm), ${p.id} (ΔL=${err2.toFixed(2)}mm)`);
      }

      return `, pos=${pos_g}, apexW=${+g.apexW.toFixed(2)} (auto), side=${g.side}`;
    }

    g.apexW = ev(g.def.apexW);
    g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    g.e = V.mul(g.ax.dir, g.side || 1);
    return `, apexW=${+g.apexW.toFixed(2)} (manuale), side=${g.side}`;
  },

  afterPairs(g, { ev }) {
    if (g.partner) {
      const p = g.partner, cs = V.dot(g.e, p.e);
      g.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), p.z / g.z + cs);
      p.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), g.z / p.z + cs);
    }
    if (g.delta === undefined) {
      CTX.where = `bevel_QW "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = ev(g.def.delta) * PI / 180;
      } else {
        g.delta = PI / 4;
        warn('bevel_QW', `${g.id}: nessun ingranaggio accoppiato e nessun "delta": uso 45°`);
      }
    }
  },

  contact(g, p) {
    if (p.type !== 'bevel_QW') return null;  // Solo bevel_QW ↔ bevel_QW
    const gh = V.unit(V.add(V.mul(g.e, Math.sin(p.delta)), V.mul(p.e, Math.sin(g.delta))));
    const apexDist = V.len(V.sub(g.apex, p.apex));

    if (apexDist > 1e-6) {
      warn('ingranamento', `Coppia conica ${g.id}–${p.id}: gli apici non coincidono (distanza ${apexDist.toFixed(3)} mm)`);
    }

    return {
      X: V.add(g.apex, V.mul(gh, g.r / Math.sin(g.delta))),
      cg: V.unit(V.perp(gh, g.e)),
      cp: V.unit(V.perp(gh, p.e))
    };
  },

  validateModel(g, B) {
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) B(`bevel_QW ${g.id}: delta non valido (${g.delta})`);
    if (!g.apex.every(Number.isFinite)) B(`bevel_QW ${g.id}: apice non finito`, g.apex);
    if (!Number.isFinite(g.z) || g.z < Registry.gear('bevel_QW').minTeeth) B(`bevel_QW ${g.id}: numero di denti non valido (${g.z})`);
  }
});