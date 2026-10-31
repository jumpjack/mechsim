/* =====================================================================
   types/links/brake/create.js
   Freno (link "brake"): ceppo che ferma un asse
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
Registry.link('brake', {
  order: { build: 10, afterPose: 30 },

  build(M, { inGroup }) {
    for (const b of M.brakes) {
      const s = b.def.shoe, at = V.toB(s.at.map(e => M.ev(e))), rel = V.toB(s.released);
      b.mesh = BABYLON.MeshBuilder.CreateBox('shoe', { width: s.size[0], height: s.size[2], depth: s.size[1] }, scene);
      b.mesh.material = new BABYLON.StandardMaterial('shoeMat', scene); b.mesh.isPickable = false;
      b.engaged = toV3(at); b.released = toV3(V.add(at, rel));
      M.extras.push(b.mesh); inGroup(b.def.group, b.mesh);
      step('scena', `freno su ${b.def.axis}: ceppo creato`);
    }
  },

  /* Casella "freno inserito" nel pannello (contenitore #brakes) */
  panel(M, { el, box, explainSoon }) {
    for (const b of M.brakes) {
      const c = el('input', { type: 'checkbox', checked: !!state.brakes[b.def.axis] });
      c.onchange = () => { state.brakes[b.def.axis] = c.checked; explainSoon(); };
      box.append(el('label', {}, c, ' ' + b.def.label));
    }
  },

  /* A ogni frame: il ceppo sta sull'asse se il freno è inserito, altrimenti si ritrae (e cambia colore) */
  afterPose(M) {
    for (const b of M.brakes) {
      const on = !!state.brakes[b.def.axis];
      b.mesh.position.copyFrom(on ? b.engaged : b.released);
      b.mesh.material.diffuseColor = C3.FromHexString(on ? '#d4262e' : '#6b7280');
    }
  }
});
