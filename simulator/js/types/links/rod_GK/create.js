/* =====================================================================
   types/links/rod_GK/create.js
   Asta a lunghezza fissa (spinta/tiro su un bilanciere)
   ===================================================================== */
Registry.link('rod_GK', {
  order: { build: 30 },

  build(M, { inGroup }) {
    for (const q of M.rods_GK || []) {
      if (q.def && q.def.marker) {
        const r = q.def.marker === true ? 4 : +q.def.marker;
        q.marker = BABYLON.MeshBuilder.CreateSphere('rod_GK_marker', { diameter: 2 * r }, scene);
        q.marker.material = markerMat;
        q.marker.isPickable = false;
        M.extras.push(q.marker);
        inGroup(q.def.group, q.marker);
      }

      if (q.wantRodVisual) {
        const rodMat = new BABYLON.StandardMaterial('rod_GK_rodMat', scene);
        rodMat.diffuseColor = BABYLON.Color3.FromHexString('#e67e22');
        rodMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        const tess = (q.def && q.def.rodSides !== undefined) ? +q.def.rodSides : 8;
        const diam = (q.def && q.def.rodDiameter !== undefined) ? +q.def.rodDiameter : 2.8;
        q.rodMesh = BABYLON.MeshBuilder.CreateCylinder('rod_GK_rod', {
          height: 1, diameter: diam, tessellation: tess
        }, scene);
        q.rodMesh.material = rodMat;
        q.rodMesh.isPickable = false;
        q.rodMesh.setEnabled(false);
        M.extras.push(q.rodMesh);
        inGroup(q.def && q.def.group, q.rodMesh);
      }

      const fromId  = q.from  && q.from.id  ? q.from.id  : '?';
      const pivotId = q.pivot && q.pivot.id ? q.pivot.id : '?';
      step('scena', `rod_GK ${fromId} → pivot ${pivotId}: build ok`);
    }
  }
});
