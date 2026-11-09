/* 15-stl-export FIXED - non rompe più la scena */
(function(){
  function getAllMeshes() {
    return (window.M && M.allMeshes ? M.allMeshes : scene.meshes)
      .filter(m => m && m.getTotalVertices && m.getTotalVertices()>0 && !m.name.startsWith('marker_') && !m.name.includes('_tmp') && !m.name.includes('_clone') && !m.name.includes('_stl'));
  }

  window.exportSTL_fixed = function(opts){
    opts = opts || {};
    const fileName = opts.fileName || 'modello';
    const binary = opts.binary !== false;
    const onlySelected = !!opts.onlySelected;
    const worldSpace = !!opts.worldSpace; // true = assieme in posa, false = a zero per stampa

    if (!BABYLON.STLExport) { alert('manca serializer'); return; }

    let src;
    if (onlySelected) {
      const first = Array.from(meshCache.values())[0];
      src = first ? [first] : [];
    } else {
      src = getAllMeshes();
    }
    if (!src.length) { alert('niente mesh'); return; }

    console.log('[STL FIXED] sorgenti:', src.length);

    if (!worldSpace) {
      // ESPORTAZIONE A ZERO - non tocca nulla, non rompe la scena
      // doNotBake = true = esporta geometria locale
      BABYLON.STLExport.CreateSTL(src, true, fileName, binary, true, true);
      console.log('[STL FIXED] esportato a zero, scena intatta');
      return;
    }

    // ESPORTAZIONE IN POSA - clona con geometria UNICA, così l'originale non si rompe
    const clones = [];
    for (const m of src) {
      try {
        const c = m.clone(m.name + "_tmp");
        if (!c) continue;
        c.makeGeometryUnique(); // FONDAMENTALE: sennò cuoci anche l'originale!
        c.parent = null;
        const wm = m.getWorldMatrix().clone();
        wm.decompose(c.scaling, c.rotationQuaternion, c.position);
        c.bakeCurrentTransformIntoVertices();
        clones.push(c);
      } catch(e) { console.error('clone fail', m.name, e); }
    }
    console.log('[STL FIXED] cloni pronti:', clones.length);
    // i cloni hanno già i vertici in world space, quindi doNotBake = true
    BABYLON.STLExport.CreateSTL(clones, true, fileName, binary, true, true);
    setTimeout(()=>{ clones.forEach(c=>{ try{c.dispose()}catch(e){} }); console.log('[STL FIXED] cloni rimossi, scena intatta'); }, 2000);
  };

  console.log('[STL FIXED] caricato. Usa: exportSTL_fixed({fileName:"prova", worldSpace:false}) o worldSpace:true');
})();