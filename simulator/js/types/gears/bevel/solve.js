/* =====================================================================
   types/gears/bevel/solve.js
   Ingranaggio conico (type "bevel")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('bevel', {
  meshWith: ['bevel'],
  minTeeth: 3,

  validate(g, w, { E, W, isVec, partnerOf }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (g.apexW === undefined) E(`${w}: manca "apexW" (posizione dell'apice lungo l'asse)`);
    if (g.side !== undefined && g.side !== 1 && g.side !== -1) E(`${w}: "side" deve essere 1 oppure -1`);
    if (!g.meshWith && !partnerOf[g.id] && g.delta === undefined) W(`${w}: conico senza ingranaggio accoppiato e senza "delta": userò 45°. Aggiungi "delta": gradi nel JSON`);
  },

  /* Apice del cono e direzione dell'asse (passo 6 di resolveModel). Ritorna un testo per il log. */
  resolve(g, { ev }) {
    g.apexW = ev(g.def.apexW);
    g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    g.e = V.mul(g.ax.dir, g.side);
    return `, apexW=${+g.apexW.toFixed(2)} (apice ${fmtV(g.apex)}), side=${g.side}`;
  },

  /* Semiangolo del cono: dalla coppia, oppure da "delta" del JSON (default 45°). */
  afterPairs(g, { ev }) {
    if (g.partner) {
      const p = g.partner, cs = V.dot(g.e, p.e);
      g.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), p.z / g.z + cs);
      step('conico', `${g.id}: δ=${(g.delta * 180 / PI).toFixed(3)}° calcolato dalla coppia con ${p.id}`);
    }
    // conici senza ingranaggio accoppiato: "delta" in gradi dal JSON (default 45°). Senza questo la geometria diventerebbe NaN.
    if (g.delta === undefined) {
      CTX.where = `conico "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = ev(g.def.delta) * PI / 180;
        step('conico', `${g.id}: nessun ingranaggio accoppiato, uso "delta" del JSON = ${(g.delta * 180 / PI).toFixed(3)}°`);
      } else {
        g.delta = PI / 4;
        warn('conico', `${g.id}: nessun ingranaggio accoppiato e nessun "delta" nel JSON: uso 45° (aggiungi "delta": gradi per evitare questo avviso)`);
      }
    }
  },

  /* Punto di contatto di due conici: sulla bisettrice dei coni. Con altri partner → null (contatto cilindrico). */
  contact(g, p) {
    if (p.type !== 'bevel') return null;
    const gh = V.unit(V.add(V.mul(g.e, Math.sin(p.delta)), V.mul(p.e, Math.sin(g.delta))));
    const apexDist = V.len(V.sub(g.apex, p.apex));
    step('ingranamento', `${g.id} (conico, z=${g.z}, δ=${(g.delta * 180 / PI).toFixed(2)}°) ⇄ ${p.id} (conico, z=${p.z}, δ=${(p.delta * 180 / PI).toFixed(2)}°): distanza fra gli apici ${apexDist.toFixed(3)} mm`);
    if (apexDist > 1e-6) warn('ingranamento', `Coppia conica ${g.id}–${p.id}: gli apici non coincidono (distanza ${apexDist.toFixed(3)} mm): ${g.id} apice ${fmtV(g.apex)}, ${p.id} apice ${fmtV(p.apex)}`);
    return { X: V.add(g.apex, V.mul(gh, g.r / Math.sin(g.delta))), cg: V.unit(V.perp(gh, g.e)), cp: V.unit(V.perp(gh, p.e)) };
  },

  validateModel(g, B) {
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) B(`conico ${g.id}: delta non valido (${g.delta})`);
    if (!g.apex.every(Number.isFinite)) B(`conico ${g.id}: apice non finito`, g.apex);
  }
});
