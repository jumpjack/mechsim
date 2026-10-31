/* types/links/anchor_escapement/solve.js
   Scappamento a pendolo (Graham-like semplificato):
   - periodo corretto con lunghezza regolabile
   - ampiezza stabilizzata verso un target
   - impulso che ripristina l’energia invece di un valore fisso
*/
function updateEscapements(M) {
  const dt = (typeof M.dt === 'number' && M.dt > 0) ? M.dt : 1 / 60;
  const g_mm = 9810; // mm/s²

  for (const gv of M.escapements || []) {
    const axE = gv.g1.ax; // asse della ruota di scappamento
    const axA = gv.g2.ax; // asse dell’ancora / pendolo
    const halfPitch = Math.PI / gv.N;

    // lunghezza pendolo live (slider)
    gv.pendLen = gv.g2.pendLen
      || (gv.g2.def && (gv.g2.def.pendulumLength || gv.g2.def.pendLen))
      || gv.def.pendulumLength
      || 160;

    if (gv.lastTheta === undefined) {
      gv.lastTheta = axA.theta;
      gv.vel = 0;
      gv.state = 'blocked_entry';
      gv.impulse = 0;
      // ampiezza target (radianti) – può essere passata dal link o dal gear
      gv.targetAmp = ((gv.amplitude || gv.def?.amplitude || 8) * Math.PI / 180);
    }

    const L = Math.max(gv.pendLen, 20);
    const omega = Math.sqrt(g_mm / L);
    const damping = 0.018; // damping più leggero → oscillazione più “viva”

    // equazione del pendolo + impulso
    const alpha = -omega * omega * Math.sin(axA.theta) - damping * gv.vel + gv.impulse;
    gv.vel += alpha * dt;

    // rispetta il drag dell’utente
    const isDragging = M.dragAxis && M.dragAxis.idx === axA.idx;
    if (!isDragging) {
      axA.theta += gv.vel * dt;
    } else {
      gv.vel = (axA.theta - gv.lastTheta) / dt;
    }

    // soft limit di ampiezza (evita il giro completo senza azzerare bruscamente)
    const maxAng = Math.max(gv.targetAmp * 1.6, 18 * Math.PI / 180);
    if (axA.theta > maxAng) {
      axA.theta = maxAng;
      gv.vel *= 0.3;
    } else if (axA.theta < -maxAng) {
      axA.theta = -maxAng;
      gv.vel *= 0.3;
    }

    // rilevamento passaggio per lo zero → avanzamento della ruota + impulso
    const releaseWindow = ((gv.def && gv.def.impulseWindow) || 1.8) * Math.PI / 180;
    let shouldAdvance = false;

    if (gv.state === 'blocked_entry' && gv.lastTheta > releaseWindow && axA.theta <= releaseWindow) {
      shouldAdvance = true;
      gv.state = 'blocked_exit';
    } else if (gv.state === 'blocked_exit' && gv.lastTheta < -releaseWindow && axA.theta >= -releaseWindow) {
      shouldAdvance = true;
      gv.state = 'blocked_entry';
    }

    if (shouldAdvance) {
      // avanza di mezzo dente
      axE.theta += halfPitch;

      // energia attuale (approssimazione)
      // E ≈ ½ v² + ω² (1 − cosθ)
      const E = 0.5 * gv.vel * gv.vel + omega * omega * (1 - Math.cos(axA.theta));
      const Etarget = omega * omega * (1 - Math.cos(gv.targetAmp));

      // impulso proporzionale al deficit di energia e alla direzione del moto
      const deficit = Math.max(0, Etarget - E);
      const boost = Math.sqrt(2 * deficit) * 0.85;
      const dir = gv.vel >= 0 ? 1 : -1;

      // se l’ampiezza è già buona, impulso piccolo; se bassa, impulso più forte
      gv.impulse = dir * (0.35 * omega + boost * 0.9);
    } else {
      // decadimento rapido dell’impulso dopo l’applicazione
      gv.impulse *= 0.82;
    }

    gv.lastTheta = axA.theta;
  }
}

Registry.link('anchor_escapement', {
  collection: 'escapements',
  order: { resolve: 20, constraints: 60, afterIntegrate: 10 },

  validate(l, w, { E }) {
    if (!l.driver) E(`${w}: manca "driver" (id della ruota di scappamento)`);
    if (!l.driven) E(`${w}: manca "driven" (id dell’ancora)`);
  },

  resolve(M) {
    for (const l of activeLinks('anchor_escapement')) {
      const g1 = M.gearBy[l.driver];   // escapement wheel
      const g2 = M.gearBy[l.driven];   // anchor

      if (!g1) throw new Error(`anchor_escapement: driver "${l.driver}" non trovato`);
      if (!g2) throw new Error(`anchor_escapement: driven "${l.driven}" non trovato`);

      const N = l.teeth || g1.z || (g1.def && (g1.def.teeth || g1.def.z)) || 30;
      const R = g1.r || 30;
      const d = 50;

      g1.escapement = { R, N, d };
      g2.escapement = { R, N, d };
      g1.r = R;

      const pendLen = l.pendulumLength || g2.pendLen || (g2.def && (g2.def.pendulumLength || g2.def.pendLen)) || 160;
      const amplitude = l.amplitude || (g2.def && g2.def.amplitude) || 8;

      M.escapements.push({
        def: l, g1, g2, N, R, d,
        pendLen, amplitude,
        lastTheta: undefined,
        vel: 0,
        state: 'blocked_entry',
        impulse: 0,
        targetAmp: amplitude * Math.PI / 180
      });
    }
  },

  constraints(M, push, { unit }) {
    for (const gv of M.escapements) {
      const axE = gv.g1.ax;
      push('anchor_escapement', `bloccato ${gv.g1.id}`, unit(axE.idx), 0, { axisIdx: axE.idx });
    }
  },

  afterIntegrate: M => updateEscapements(M),
  settle:         M => updateEscapements(M)
});
