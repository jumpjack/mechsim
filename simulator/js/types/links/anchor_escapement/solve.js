/* types/links/anchor_escapement/solve.js
   Scappamento Graham
   - Periodo da sqrt(L) (slider lunghezza)
   - Attrito e ampiezza letti live da state.params
   - Rallentatore via slider → state.timeScale
   - Energia solo quando la ruota è driver con velocità > 0
*/
function liveParam(nameOrVal, fallback) {
  // Se è una stringa (id del controllo), leggi il valore live
  if (typeof nameOrVal === 'string') {
    if (typeof state !== 'undefined') {
      // state.params[id] è il valore numerico corrente del controllo
      if (state.params && state.params[nameOrVal] != null) {
        const v = +state.params[nameOrVal];
        if (!isNaN(v)) return v;
      }
      // fallback: state.ctrl[id].all
      if (state.ctrl && state.ctrl[nameOrVal]) {
        const c = state.ctrl[nameOrVal];
        const v = +(typeof c === 'object' ? (c.all ?? c[Object.keys(c)[0]]) : c);
        if (!isNaN(v)) return v;
      }
    }
    const parsed = parseFloat(nameOrVal);
    return isNaN(parsed) ? fallback : parsed;
  }
  if (typeof nameOrVal === 'number' && !isNaN(nameOrVal)) return nameOrVal;
  return fallback;
}

function updateEscapements(M) {
  // --- Rallentatore ---
  // Se c'è un controllo "timeScale" nel JSON, usalo; altrimenti state.timeScale esistente
  if (typeof state !== 'undefined') {
    const ts = liveParam('timeScale', state.timeScale ?? 1);
    state.timeScale = Math.max(0.01, Math.min(5, ts));
  }
  const scale = (typeof state !== 'undefined' && typeof state.timeScale === 'number')
    ? state.timeScale
    : 1;

  let dt = (typeof M.dt === 'number' && M.dt > 0) ? M.dt : (1 / 60);
  dt *= scale;
  if (!(dt > 0)) dt = 1e-6;
  if (dt > 0.05) dt = 0.05;

  const g_mm = 9810;

  for (const gv of M.escapements || []) {
    const axE = gv.g1.ax;
    const axA = gv.g2.ax;
    const N  = gv.N || 30;
    const halfPitch = Math.PI / N;

    // ---------- parametri LIVE ----------
    let L = gv.g2.pendLen;
    if (L == null || !(L > 0)) {
      L = (gv.g2.def && (gv.g2.def.pendulumLength || gv.g2.def.pendLen)) || 160;
    }
    if (typeof L === 'string') L = liveParam(L, 160);
    gv.pendLen = Math.max(20, +L);

    // attrito: dal link ("frictionVal") o default
    const friction = Math.max(0.001, Math.min(0.5,
      liveParam(gv.friction ?? gv.def?.friction ?? 'frictionVal', 0.03)
    ));

    // ampiezza target in gradi → radianti
    const ampDeg = liveParam(gv.amplitude ?? gv.def?.amplitude ?? 'amplitude', 6);
    const targetAmp = Math.max(2, Math.min(20, ampDeg)) * Math.PI / 180;

    const lockAng    = ((gv.def?.lockAngle    ?? 1.5) * Math.PI / 180);
    const impulseAng = ((gv.def?.impulseAngle ?? 4.0) * Math.PI / 180);
    const dropAng    = ((gv.def?.dropAngle    ?? 1.0) * Math.PI / 180);

    if (gv.lastTheta === undefined) {
      gv.lastTheta = axA.theta;
      gv.vel = 0;
      gv.state = 'locked_entry';
      gv.impulse = 0;
      gv.power = 0;
      gv.locked = true;
    }

    const omega0 = Math.sqrt(g_mm / gv.pendLen);
    // damping fortemente influenzato dallo slider attrito
    const damping = 0.008 + friction * 3.5;

    // ---------- potenza e SENSO di rotazione dalla catena ----------
    // Driver valido se è sullo stesso asse dello scappamento OPPURE su un asse
    // collegato via mesh. Il segno viene propagato lungo la catena (rapporto denti).
    let isWheelDriver = false;
    let driverOmegaAbs = 0;
    let driveSign = gv.driveSign || 1; // segno sullo scappamento (+1 / -1)

    if (typeof state !== 'undefined' && state.driver && M.gearBy) {
      const dg = M.gearBy[state.driver.gear];
      const escAxIdx = gv.g1.ax ? gv.g1.ax.idx : -1;
      const rawW = state.driver.w || 0;

      if (dg && dg.ax != null && escAxIdx >= 0 && Math.abs(rawW) > 1e-6) {
        const drvAxIdx = dg.ax.idx;

        // rapporto di trasmissione asse_driver → asse_scappamento
        // costruiamo un grafo con segno: edge (i→j) con fattore k  ⇒  ω_j = k * ω_i
        const factorTo = new Map(); // axisIdx → fattore rispetto al driver
        factorTo.set(drvAxIdx, 1);

        const edges = []; // {a, b, k}  ω_b = k * ω_a
        for (const m of (M.meshes || [])) {
          if (!m.g || !m.p || !m.g.ax || !m.p.ax) continue;
          const z1 = m.g.z || m.g.def?.teeth || 1;
          const z2 = m.p.z || m.p.def?.teeth || 1;
          const i1 = m.g.ax.idx, i2 = m.p.ax.idx;
          // esterna: ω2 = -(z1/z2) ω1
          edges.push({ a: i1, b: i2, k: -(z1 / z2) });
          edges.push({ a: i2, b: i1, k: -(z2 / z1) });
        }
        // solidali sullo stesso asse: fattore 1
        for (const g of (M.gears || [])) {
          if (!g.ax) continue;
          for (const h of (M.gears || [])) {
            if (h !== g && h.ax && h.ax.idx === g.ax.idx) {
              edges.push({ a: g.ax.idx, b: h.ax.idx, k: 1 });
            }
          }
        }

        let changed = true;
        while (changed) {
          changed = false;
          for (const e of edges) {
            if (factorTo.has(e.a) && !factorTo.has(e.b)) {
              factorTo.set(e.b, factorTo.get(e.a) * e.k);
              changed = true;
            }
          }
        }

        if (factorTo.has(escAxIdx) || drvAxIdx === escAxIdx) {
          isWheelDriver = true;
          const fac = factorTo.has(escAxIdx) ? factorTo.get(escAxIdx) : 1;
          const omegaOnEsc = rawW * fac;
          driverOmegaAbs = Math.abs(omegaOnEsc);
          driveSign = omegaOnEsc >= 0 ? 1 : -1;
          gv.driveSign = driveSign;
        }
      }
    }

    if (isWheelDriver && driverOmegaAbs > 1e-4) {
      const targetPower = Math.min(5.5, 0.8 + driverOmegaAbs * 2.5);
      gv.power += (targetPower - gv.power) * Math.min(1, 4 * dt);
    } else {
      gv.power *= Math.max(0, 1 - 8 * dt);
      if (gv.power < 0.05) gv.power = 0;
    }

    // soglie intorno allo zero
    const entryUnlock     = -lockAng;
    const entryImpulseEnd = -lockAng - impulseAng;
    const exitUnlock      = +lockAng;
    const exitImpulseEnd  = +lockAng + impulseAng;
    // softClamp dipende dall'ampiezza target (slider)
    const softClamp = Math.max(targetAmp * 1.6, 12 * Math.PI / 180);

    let shouldAdvance = false;
    let impulseDir = 0;

    if (gv.state === 'locked_entry') {
      if (axA.theta < entryUnlock && gv.power > 0.05) {
        gv.state = 'impulse_entry';
        shouldAdvance = true;
        impulseDir = -1;
      }
    } else if (gv.state === 'impulse_entry') {
      if (axA.theta < entryImpulseEnd - dropAng) {
        gv.state = 'locked_exit';
      }
    } else if (gv.state === 'locked_exit') {
      if (axA.theta > exitUnlock && gv.power > 0.05) {
        gv.state = 'impulse_exit';
        shouldAdvance = true;
        impulseDir = +1;
      }
    } else if (gv.state === 'impulse_exit') {
      if (axA.theta > exitImpulseEnd + dropAng) {
        gv.state = 'locked_entry';
      }
    }

    // Kick di avvio solo con potenza
    if (gv.power > 0.1 && Math.abs(gv.vel) < 0.1 * omega0 && Math.abs(axA.theta) < 2.0 * Math.PI / 180) {
      const kickDir = (gv.state === 'locked_entry' || gv.state === 'impulse_entry') ? -1 : 1;
      gv.vel += kickDir * 1.6 * omega0;
      gv.impulse = kickDir * 1.8 * omega0;
    }

    // motore spento → smorza forte
    if (gv.power < 0.05) {
      gv.vel *= Math.max(0, 1 - 3 * dt);
      gv.impulse = 0;
    }

    // avanzamento + impulso (mirato all'ampiezza target)
    gv.locked = !shouldAdvance;

    if (shouldAdvance && gv.power > 0.05) {
      // scatto dello scappamento nel verso imposto dal driver
      const step = (gv.driveSign || 1) * halfPitch;
      axE.theta += step;

      // Propaga lo scatto a tutti gli assi collegati via mesh (rapporto denti, segno invertito)
      if (M.meshes && M.meshes.length) {
        const dTheta = new Map();
        dTheta.set(axE.idx, step);
        let changed = true;
        while (changed) {
          changed = false;
          for (const m of M.meshes) {
            if (!m.g || !m.p || !m.g.ax || !m.p.ax) continue;
            const i1 = m.g.ax.idx, i2 = m.p.ax.idx;
            const z1 = m.g.z || m.g.def?.teeth || 1;
            const z2 = m.p.z || m.p.def?.teeth || 1;
            // ω2 = - (z1/z2) * ω1  →  Δθ2 = - (z1/z2) * Δθ1
            if (dTheta.has(i1) && !dTheta.has(i2)) {
              dTheta.set(i2, - (z1 / z2) * dTheta.get(i1));
              changed = true;
            } else if (dTheta.has(i2) && !dTheta.has(i1)) {
              dTheta.set(i1, - (z2 / z1) * dTheta.get(i2));
              changed = true;
            }
          }
        }
        for (const [idx, dth] of dTheta) {
          if (idx === axE.idx) continue; // già applicato
          const ax = M.axes[idx];
          if (ax) ax.theta += dth;
        }
      }

      const frNorm = Math.min(1, friction * 5);
      const eff = (1 - frNorm * 0.45);

      const E = 0.5 * gv.vel * gv.vel + omega0 * omega0 * (1 - Math.cos(axA.theta));
      const Etarget = omega0 * omega0 * (1 - Math.cos(targetAmp));
      const deficit = Math.max(0, Etarget - E);

      const boost = Math.sqrt(2 * deficit) * 0.55 * eff;
      const pBoost = gv.power * 0.5 * eff * omega0;
      const dir = impulseDir || (gv.vel >= 0 ? 1 : -1);

      gv.impulse = dir * (0.18 * omega0 + boost + pBoost);
      gv.power = Math.max(0, gv.power - (0.2 + frNorm * 0.15));
    } else {
      gv.impulse *= 0.8;
    }

    // integrazione pendolo
    const alpha = -omega0 * omega0 * Math.sin(axA.theta) - damping * gv.vel + gv.impulse;
    gv.vel += alpha * dt;
    axA.theta += gv.vel * dt;

    if (axA.theta >  softClamp) { axA.theta =  softClamp; gv.vel *= 0.2; }
    if (axA.theta < -softClamp) { axA.theta = -softClamp; gv.vel *= 0.2; }

    gv.lastTheta = axA.theta;
  }
}

Registry.link('anchor_escapement', {
  collection: 'escapements',
  order: { resolve: 20, constraints: 55, afterIntegrate: 10 },

  validate(l, w, { E }) {
    if (!l.driver) E(`${w}: manca "driver" (id della ruota di scappamento)`);
    if (!l.driven) E(`${w}: manca "driven" (id dell’ancora)`);
  },

  resolve(M) {
    for (const l of activeLinks('anchor_escapement')) {
      const g1 = M.gearBy[l.driver];
      const g2 = M.gearBy[l.driven];
      if (!g1) throw new Error(`anchor_escapement: driver "${l.driver}" non trovato`);
      if (!g2) throw new Error(`anchor_escapement: driven "${l.driven}" non trovato`);

      const N = l.teeth || g1.z || (g1.def && (g1.def.teeth || g1.def.z)) || 30;
      const R = g1.r || 30;
      g1.escapement = { R, N };
      g2.escapement = { R, N };
      g1.r = R;

      M.escapements.push({
        def: l, g1, g2, N, R,
        friction: l.friction || 'frictionVal',
        amplitude: l.amplitude || 'amplitude',
        lastTheta: undefined,
        vel: 0,
        state: 'locked_entry',
        impulse: 0,
        power: 0,
        locked: true
      });
    }
  },

  constraints(M, push, { unit }) {
    for (const gv of M.escapements) {
      if (gv.locked !== false) {
        push('anchor_escapement', `bloccato ${gv.g1.id}`, unit(gv.g1.ax.idx), 0, { axisIdx: gv.g1.ax.idx });
      }
    }
  },

  afterIntegrate: M => updateEscapements(M),
  settle:         M => updateEscapements(M)
});
