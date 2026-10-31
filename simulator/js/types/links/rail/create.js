/* =====================================================================
   types/links/rail/create.js
   Binario (link "rail"): marker del punto d'intersezione
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
Registry.link('rail', {
  order: { build: 30 },

  build(M, { inGroup }) {
    for (const q of M.rails) if (q.def.marker) {            // "marker": true (o il raggio in mm) → sferetta sul punto d'intersezione del binario
      q.marker = BABYLON.MeshBuilder.CreateSphere('rail_marker', { diameter: 2 * (q.def.marker === true ? 6 : +q.def.marker) }, scene);
      q.marker.material = markerMat; q.marker.isPickable = false;
      M.extras.push(q.marker); inGroup(q.def.group, q.marker);
      step('scena', `binario ${q.a.id}: marker dell'intersezione creato`);
    }
  }
});
