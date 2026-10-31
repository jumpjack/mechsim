/* =====================================================================
   types/links/pin_slot/solve.js
   Perno in scanalatura (link "pin_slot"): il perno della ruota 1 scorre nella scanalatura della ruota 2
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('pin_slot', {
  collection: 'pinSlots',
  order: { resolve: 10, constraints: 60, afterIntegrate: 30 },

  validate(l, w, { E, axisBy, gearBy }) {
    const dGear = gearBy[l.driver], sGear = gearBy[l.driven];
    if (!dGear) E(`${w}: driver "${l.driver}" non esiste o non è attivo`);
    else if (!sGear) E(`${w}: driven "${l.driven}" non esiste o non è attivo`);
    else if (dGear === sGear) E(`${w}: driver e driven devono essere diversi`);
    else {
      const d1 = axisBy[dGear.axis], d2 = axisBy[sGear.axis];
      if (d1 && d2 && Math.abs(Math.abs(V.dot(d1.dir, d2.dir)) - 1) > 1e-6)
        E(`${w}: gli assi di ${l.driver} e ${l.driven} devono essere paralleli`);
    }
    if (l.pinAxis) {
      const pa = axisBy[l.pinAxis];
      if (!pa) E(`${w}: pinAxis "${l.pinAxis}" non esiste o non è attivo`);
      else if (dGear && pa.carrier !== dGear.axis)
        E(`${w}: pinAxis "${l.pinAxis}" deve avere carrier = "${dGear.axis}"`);
    } else if (l.pinRadius === undefined) {
      E(`${w}: specificare "pinAxis" oppure "pinRadius"`);
    }
  },

  // ---- risoluzione geometrica (meccanismo Antikythera e simili)
  resolve(M, { ev }) {
  for (const l of activeLinks('pin_slot')) {
    CTX.where = `link pin_slot ${l.driver} → ${l.driven}`;
    const g1 = M.gearBy[l.driver], g2 = M.gearBy[l.driven];
    if (!g1) throw new Error(`pin_slot: driver "${l.driver}" non esiste`);
    if (!g2) throw new Error(`pin_slot: driven "${l.driven}" non esiste`);

    let rPin, pinAxis = null;
    if (l.pinAxis) {
      pinAxis = M.axisBy[l.pinAxis];
      if (!pinAxis) throw new Error(`pin_slot: pinAxis "${l.pinAxis}" non esiste`);
      rPin = V.len(V.perp(V.sub(pinAxis.O, g1.ax.O), g1.ax.dir));
      if (rPin < 1e-6) throw new Error(`pin_slot: pinAxis coincide con l'asse di ${l.driver}`);
    } else {
      rPin = ev(l.pinRadius);
    }

  let slotAngle = 0;
  if (l.slotAngle !== undefined) {
    slotAngle = ev(l.slotAngle) * PI / 180;
  } else if (l.slotAxis && M.axisBy[l.slotAxis]) {
    const sa = M.axisBy[l.slotAxis];
    // Proietta la direzione dello slot nel piano (ref, yv) di K2
    slotAngle = Math.atan2(V.dot(sa.dir, g2.ax.yv), V.dot(sa.dir, g2.ax.ref));
  }
    const carrier = commonFrame(g1.ax, g2.ax);
    if (g1.ax.carrier !== g2.ax.carrier) {
      warn('pin_slot', `${g1.id} e ${g2.id} hanno carrier diversi: la cinematica potrebbe essere inaccurata`);
    }

    const relPerp = V.perp(V.sub(g2.ax.O, g1.ax.O), g1.ax.dir);
    const d = V.len(relPerp);
    if (d < 1e-6) throw new Error(`pin_slot: gli assi di ${l.driver} e ${l.driven} coincidono`);
    const dx = V.dot(relPerp, g1.ax.ref);
    const dy = V.dot(relPerp, g1.ax.yv);

    let initialPinAngle = 0;
    if (pinAxis) {
      const pinRel = V.perp(V.sub(pinAxis.O, g1.ax.O), g1.ax.dir);
      initialPinAngle = Math.atan2(V.dot(pinRel, g1.ax.yv), V.dot(pinRel, g1.ax.ref));
    }

    M.pinSlots.push({
      def: l, g1, g2, rPin, slotAngle, carrier,
      dx, dy, d, initialPinAngle, pinAxis,
      slotAxis: l.slotAxis ? M.axisBy[l.slotAxis] : null
    });
    step('pin_slot', `${g1.id} → ${g2.id}: rPin=${rPin.toFixed(3)}, d=${d.toFixed(3)}, slotAngle=${(slotAngle*180/PI).toFixed(2)}°`);
  }
  },

  /* Vincolo cinematico: s2 = rapporto · s1, con rapporto istantaneo dalla posizione del perno */
  constraints(M, push, { n }) {
    for (const ps of M.pinSlots) {
      const row = new Array(n).fill(0);
      const alpha1 = ps.g1.ax.theta + ps.initialPinAngle;
      const A = ps.rPin * Math.cos(alpha1) - ps.dx;
      const B = ps.rPin * Math.sin(alpha1) - ps.dy;
      const den = A * A + B * B;
      if (den < 1e-20) {
        warn('pin_slot', `${ps.g1.id} → ${ps.g2.id}: pin a C₂, vincolo saltato`);
        continue;
      }
      const ratio = ps.rPin * (A * Math.cos(alpha1) + B * Math.sin(alpha1)) / den;

      row[ps.g2.ax.idx] += 1;
      row[ps.g1.ax.idx] -= ratio;
      if (ps.carrier) {
        for (const k in ps.carrier.Om) {
          const proj1 = V.dot(ps.carrier.Om[k], ps.g1.ax.dir);
          const proj2 = V.dot(ps.carrier.Om[k], ps.g2.ax.dir);
          row[+k] += -proj2 + ratio * proj1;
        }
      }
      push('pin_slot', `pin_slot ${ps.g1.id} → ${ps.g2.id} (rapporto ${ratio.toFixed(4)})`, row, 0);
    }
  },

  /* Posizione della ruota 2 dalla geometria del perno, senza salti di 2π */
  afterIntegrate(M) {
    for (const ps of M.pinSlots) {
      const alpha1 = ps.g1.ax.theta + ps.initialPinAngle;
      const A = ps.rPin * Math.cos(alpha1) - ps.dx;
      const B = ps.rPin * Math.sin(alpha1) - ps.dy;
      if (A * A + B * B < 1e-20) continue;
      const curA2 = ps.g2.ax.theta + ps.slotAngle;
      let target = Math.atan2(B, A);
      while (target - curA2 > PI) target -= 2 * PI;
      while (target - curA2 < -PI) target += 2 * PI;
      ps.g2.ax.theta = target - ps.slotAngle;
    }
  }
});
