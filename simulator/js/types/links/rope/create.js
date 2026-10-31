/* =====================================================================
   types/links/rope/create.js
   Fune con peso (link "rope"): si avvolge su un asse
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
Registry.link('rope', {
  order: { build: 20, afterPose: 20 },

  build(M, { inGroup }) {
    for (const r of M.ropes) {
      r.rope = BABYLON.MeshBuilder.CreateCylinder('rope', { height: 1, diameter: 4, tessellation: 12 }, scene);
      r.weight = BABYLON.MeshBuilder.CreateCylinder('weight', { height: 30, diameter: 24, tessellation: 24 }, scene);
      r.rope.material = material('#5a4630'); r.weight.material = material('#6b7280');
      r.rope.isPickable = r.weight.isPickable = false; r.top = V.toB(r.at);
      M.extras.push(r.rope, r.weight); inGroup(r.def.group, r.rope); inGroup(r.def.group, r.weight);
      step('scena', `fune su ${r.def.axis}: fune e peso creati`);
    }
  },

  /* A ogni frame: la lunghezza della fune segue l'angolo dell'asse (len0 + raggio·θ, fra min e max) */
  afterPose(M) {
    for (const r of M.ropes) {
      const len = Math.min(r.def.max, Math.max(r.def.min, r.def.len0 + r.radius * M.axes[r.idx].theta));
      r.rope.scaling.y = len;
      r.rope.position.set(r.top[0], r.top[1] - len / 2, r.top[2]);
      r.weight.position.set(r.top[0], r.top[1] - len - 15, r.top[2]);
    }
  }
});
