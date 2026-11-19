/* =====================================================================
   types/gears/bevel_DS/solve.js
   Ingranaggio conico DS (type "bevel_DS")
   Metà "COME SI RISOLVE": validazione, parametri, cinematica.
   La geometria è in create.js.
   ===================================================================== */

/* Intersezione di due rette 3D. null se parallele o sghembe. */
function bevelIntersectAxes(ax1, ax2, tol = 1e-3) {
  const d1 = V.unit(ax1.dir), d2 = V.unit(ax2.dir);
  const w0 = V.sub(ax1.O, ax2.O);
  const a = V.dot(d1, d1), b = V.dot(d1, d2), c = V.dot(d2, d2);
  const dd = V.dot(d1, w0), ee = V.dot(d2, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-10) return null;
  const t = (b * ee - c * dd) / denom;
  const s = (a * ee - b * dd) / denom;
  const p1 = V.add(ax1.O, V.mul(d1, t));
  const p2 = V.add(ax2.O, V.mul(d2, s));
  if (V.len(V.sub(p1, p2)) > tol) return null;
  return V.mul(V.add(p1, p2), 0.5);
}

/* Calcola l'apice e i denti (se non specificati) per una coppia di conici. */
function resolveBevelPair(g, p) {
  if (g._bpDone && p._bpDone) return;

  // 1. Apice comune (intersezione degli assi)
  let A = bevelIntersectAxes(g.ax, p.ax);
  if (!A) {
    warn('conico', `${g.id}–${p.id}: assi non incidenti, uso l'origine di ${g.id} come apice`);
    A = g.ax.O;
  }

  g.apexW = V.dot(V.sub(A, g.ax.O), g.ax.dir);
  g.apex = A;
  p.apexW = V.dot(V.sub(A, p.ax.O), p.ax.dir);
  p.apex = A;

  // 2. Angolo tra gli assi
  const cs = V.dot(g.e, p.e);
  const cosS = Math.max(-1, Math.min(1, cs));
  const sinS = Math.sqrt(Math.max(0, 1 - cosS * cosS));
  const Sigma = Math.acos(cosS);

  // 3. Determinazione di z (numero di denti)
  const hasPosG = g._pos !== undefined;
  const hasPosP = p._pos !== undefined;
  let calculated = false;

  if (g._teeth === undefined && p._teeth === undefined && hasPosG && hasPosP) {
    const wp_g = g.side * (g._pos - g.apexW);
    const wp_p = p.side * (p._pos - p.apexW);

    if (wp_g > 1e-6 && wp_p > 1e-6 && sinS > 1e-6) {
      const k = wp_g / wp_p;
      // Calcolo z reali
      const tanDg = (1 / k - cosS) / sinS;
      const tanDp = (k - cosS) / sinS;
      const r_g = wp_g * tanDg;
      const r_p = wp_p * tanDp;
      const z_g_real = 2 * r_g / g.m;
      const z_p_real = 2 * r_p / p.m;

      // Arrotondamento a interi
      const z_g = Math.max(3, Math.round(z_g_real));
      const z_p = Math.max(3, Math.round(z_p_real));
      g.z = z_g;
      p.z = z_p;

      // Ricalcolo di delta con z interi
      const u = z_g / z_p;
      const tanDg_new = sinS / (1 / u + cosS);
      const tanDp_new = sinS / (u + cosS);
      g.delta = Math.atan(tanDg_new);
      p.delta = Math.atan(tanDp_new);

      // Ricalcolo della posizione esatta per far toccare le ruote
      const wp_g_new = (g.m * z_g / 2) / tanDg_new;
      const wp_p_new = (p.m * z_p / 2) / tanDp_new;
      g._pos = g.apexW + g.side * wp_g_new;
      p._pos = p.apexW + p.side * wp_p_new;

      calculated = true;
      step('conico', `${g.id}–${p.id}: z=${g.z},${p.z} calcolati da pos (reali ${z_g_real.toFixed(2)}, ${z_p_real.toFixed(2)})`);
    }
  }

  if (!calculated) {
    if (g._teeth !== undefined) g.z = g._teeth;
    if (p._teeth !== undefined) p.z = p._teeth;

    if (g.z !== undefined && p.z !== undefined) {
      const u = g.z / p.z;
      g.delta = Math.atan(sinS / (1 / u + cosS));
      p.delta = Math.atan(sinS / (u + cosS));
    } else {
      warn('conico', `${g.id}–${p.id}: impossibile calcolare i denti. Uso z=20 di default.`);
      g.z = 20; p.z = 20;
      g.delta = Math.atan(sinS / (1 + cosS));
      p.delta = Math.atan(sinS / (1 + cosS));
    }
  }

  g._bpDone = true;
  p._bpDone = true;
}

Registry.gear('bevel_DS', {
  meshWith: ['bevel_DS'],
  minTeeth: 3,

  validate(g, w, { E, W, partnerOf }) {
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (g.side !== undefined && g.side !== 1 && g.side !== -1) {
      E(`${w}: "side" deve essere 1 oppure -1`);
    }
    const hasPartner = !!partnerOf[g.id];
    const hasApexW = g.apexW !== undefined;
    const hasPos = g.pos !== undefined || g.at !== undefined;

    if (hasApexW && hasPos) E(`${w}: specifica "pos" OPPURE "apexW", non entrambi`);
    if (!hasApexW && !hasPos && !hasPartner) E(`${w}: manca "pos" (o "apexW") per definire la posizione`);

    if (g.free !== undefined && typeof g.free !== 'boolean') E(`${w}: "free" deve essere boolean`);
    if (g.bore !== undefined && g.bore !== false) {
      const b = g.bore;
      if (!(typeof b === 'number' || typeof b === 'string' || (typeof b === 'object' && b !== null && b.r !== undefined))) {
        E(`${w}: "bore" deve essere numero, false oppure {r:...}`);
      }
    }
    if (g.flat !== undefined && g.flat !== false) {
      if (typeof g.flat !== 'number' && typeof g.flat !== 'string') {
        E(`${w}: "flat" deve essere numero fra 0 e 1, oppure false`);
      }
    }
    if (g.flatAngle !== undefined && typeof g.flatAngle !== 'number' && typeof g.flatAngle !== 'string') {
      E(`${w}: "flatAngle" deve essere numero (gradi)`);
    }
  },

  resolve(g, { ev }) {
    g.e = V.mul(g.ax.dir, g.side || 1);

    if (g.def.apexW !== undefined) {
      g.apexW = ev(g.def.apexW);
      g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    } else if (g.def.pos !== undefined) {
      g._pos = ev(g.def.pos);
    } else if (g.def.at !== undefined) {
      g._pos = ev(g.def.at);
    }

    if (g.def.k0 !== undefined) g.k0 = ev(g.def.k0);
    if (g.def.thickness !== undefined) g._thickness = ev(g.def.thickness);
    if (g.def.teeth !== undefined) g._teeth = ev(g.def.teeth);

    g.free = g.def.free === true;
    if (g.def.bore !== undefined) {
      const b = g.def.bore;
      if (b === false) g.bore = false;
      else if (typeof b === 'object' && b !== null) g.bore = { r: ev(b.r) };
      else g.bore = ev(b);
    }
    if (g.def.flat !== undefined && g.def.flat !== false) {
      g.flat = ev(g.def.flat);
      g.flatAngle = g.def.flatAngle !== undefined ? ev(g.def.flatAngle) : 0;
    }

    return `, ${g.apexW !== undefined ? 'apexW='+g.apexW.toFixed(2) : (g._pos!==undefined ? 'pos='+g._pos.toFixed(2) : 'auto')}`;
  },

  afterPairs(g) {
    if (g.partner && !g._bpDone) resolveBevelPair(g, g.partner);

    if (g.delta === undefined) {
      CTX.where = `conico "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = g.def.delta * PI / 180;
      } else {
        g.delta = PI / 4;
      }
    }

    if (g.k0 === undefined) {
      if (g._thickness !== undefined && g.z !== undefined && g.delta !== undefined) {
        const wp = (g.m * g.z / 2) / Math.tan(g.delta);
        if (wp > 0) g.k0 = Math.max(0.1, Math.min(0.95, 1 - g._thickness / wp));
      } else {
        g.k0 = 0.7;
      }
    }
  },

  contact(g, p) {
    if (p.type !== 'bevel_DS') return null;
    if (!g.apex || !p.apex) return null;
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
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) {
      B(`conico ${g.id}: delta non valido (${g.delta})`);
    }
    if (!g.apex) B(`conico ${g.id}: apice non calcolato`);
    else if (!g.apex.every(Number.isFinite)) B(`conico ${g.id}: apice non finito`);
  }
});