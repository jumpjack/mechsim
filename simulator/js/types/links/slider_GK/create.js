/* =====================================================================
   types/links/slider_GK/create.js
   Biella-manovella + pistone (link "slider_GK")
   Metà "COME SI CREA": marker + eventuale biella visuale di default.
   Se nel link è presente "rod", la geometria della biella è nelle parts
   di quell'asse e qui non si crea alcun mesh della biella.
   ===================================================================== */
Registry.link('slider_GK', {
  order: { build: 30 },

  build(M, { inGroup }) {
    for (const q of M.sliders_GK || []) {
      if (q.def.marker) {
        const r = q.def.marker === true ? 4 : +q.def.marker;
        q.marker = BABYLON.MeshBuilder.CreateSphere('slider_GK_marker', { diameter: 2 * r }, scene);
        q.marker.material = markerMat;
        q.marker.isPickable = false;
        M.extras.push(q.marker);
        inGroup(q.def.group, q.marker);
      }

      // biella di default solo se non c'è un asse "rod" dedicato
      if (q.wantRodVisual) {
        const rodMat = new BABYLON.StandardMaterial('slider_GK_rodMat', scene);
        rodMat.diffuseColor = BABYLON.Color3.FromHexString('#27ae60');
        rodMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        const tess = (q.def.rodSides !== undefined) ? +q.def.rodSides : 6;
        const diam = (q.def.rodDiameter !== undefined) ? +q.def.rodDiameter : 3.2;
        q.rodMesh = BABYLON.MeshBuilder.CreateCylinder('slider_GK_rod', {
          height: 1,
          diameter: diam,
          tessellation: tess
        }, scene);
        q.rodMesh.material = rodMat;
        q.rodMesh.isPickable = false;
        q.rodMesh.setEnabled(false);
        M.extras.push(q.rodMesh);
        inGroup(q.def.group, q.rodMesh);
      }

      step('scena', `slider_GK ${q.crankPin.id}→${q.pistonPin.id}: build ok` +
        (q.rod ? ` (biella = asse ${q.rod.id})` : q.wantRodVisual ? ' (biella visuale default)' : ''));
    }
  }
});
