/* =====================================================================
   core/14-main.js
   Avvio (asincrono: prima si caricano i file dei tipi usati) e ciclo di animazione
   ===================================================================== */
setupMachineLoader();            // prima del resto: se la macchina precaricata ha errori, si può comunque caricarne un'altra

scene.onPointerObservable.add(info => {
  const hit = info.pickInfo;
  if (M && info.type === BABYLON.PointerEventTypes.POINTERTAP && hit && hit.hit && hit.pickedMesh.metadata) selectGear(hit.pickedMesh.metadata);
});

/* Ciclo di animazione. I tipi di link intervengono nelle fasi: events (sotto-passi), afterIntegrate, afterPose. */
scene.onBeforeRenderObservable.add(() => {
  if (!M) return;
  const dt = Math.min(engine.getDeltaTime() / 1000, .05) * state.timeScale;
  if (dt === 0) return;

  // integrazione a sotto-passi: ogni link può dichiarare eventi (es. il perno entra nella croce di Malta) che spezzano il passo
  let left = dt;
  for (let it = 0; it < 8 && left > 1e-9; it++) {
    const { w } = solveSpeeds(M);
    const s = relSpins(M, w);

    const events = Registry.collect('events', M, s, w);           // [{ te, hit() }]
    let h = left;
    for (const e of events) h = Math.min(h, e.te);
    const hits = events.filter(e => e.te <= h + 1e-12);

    M.axes.forEach((a, i) => { a.theta += s[i] * h; });
    for (const e of hits) e.hit();

    left -= h;
    if (!hits.length) break;
  }

  // dopo l'integrazione: geneva (riallineamento esatto) → hooke → updateSpin → pin_slot
  Registry.run('afterIntegrate', M);

  for (const a of M.axes) if (!a.aimed) a.node.rotationQuaternion = Quat.RotationAxis(a.axisB, a.theta);

  updateThrough(M);
  updateSpinAlign(M);
  updateDynamicLines();

  const angleBox = $("siderostatAngles");
  if (angleBox) {
    const deg = axis => {
      const v = ((axis.theta * 180 / PI) % 360 + 360) % 360;
      return v > 180 ? v - 360 : v;
    };
    angleBox.innerHTML = (M.spinAlign || []).map(q => {
      const sourceName = q.axis.def.name || q.axis.id;
      const targetName = q.target.def.name || q.target.id;
      return `<div><b>${esc(sourceName)}</b> rispetto a <b>${esc(targetName)}</b>: ${fmt(deg(q.axis), 2)}°</div>`;
    }).join("") || "Nessun vincolo di orientamento attivo.";
  }

  Registry.run('afterPose', M);          // oggetti dei link aggiornati alla posa corrente: crociera di Hooke, fune, ceppo del freno

  sinceTable += dt;
  if (sinceTable > .1 || !dt) {
    sinceTable = 0;
    const { w: finalW, locked: finalLocked, cons: finalCons } = solveSpeeds(M);
    updateTable(finalW, finalCons);
    $('status').textContent = statusText(finalW, finalLocked);
  }
});

let frames = 0;
function startRenderLoop() {
  engine.runRenderLoop(() => {
    try {
      scene.render();
      if (++frames === 1) console.log('%c[render]%c primo frame disegnato', 'color:#d9b45a;font-weight:bold', 'color:inherit');
    } catch (e) {
      reportError('render', e);
      engine.stopRenderLoop();
    }
  });
}
addEventListener('resize', () => engine.resize());

/* Avvio. È asincrono perché i tipi di ingranaggi, link e parti usati dalla macchina si caricano da types/ solo se servono
   (Registry.loadFor). Se tutti i tipi sono già presenti (versione "bundle") non si carica nulla. */
(async () => {
  try {
    await Registry.loadFor(MACHINE);
    step('avvio', 'costruzione dell\'interfaccia e del modello');
    buildStaticPanel();
    rebuild(true);
    buildPanel();
    afterRebuild();
    const diag = fitCameraToModel();
    step('avvio', `modello pronto: diagonale ${diag.toFixed(0)} mm`);
  } catch (e) { reportError('avvio', e); }

  // Linee dinamiche specifiche del siderostato (assi che esistono solo in quella macchina; se mancano vengono ignorate).
  // Andrebbero spostate nel file della macchina.
  if (M) {
// Siderostato Foucault:
//     createParallel("axis_forcella", "axis_coda_specchio", -35, 800, "#ffff00"); // sole
//     createParallel("axis_coda_specchio", "axis_coda_specchio", -35, 800, "#888888"); // bisettrice
//     createParallel("axis_direzione_riflesso", "axis_coda_specchio", -35, 5800, "#ff8800"); // riflesso

// Eliostato Gravesande:
    createParallel("axis_lancetta", "axis_a_a_MirrorHolder", 0, 800, "#ffff00"); // sole
    createParallel("axis_D_E_coda_specchio", "axis_a_a_MirrorHolder", 0, 800, "#888888"); // bisettrice
    createParallel("axis_direzione_riflesso", "axis_a_a_MirrorHolder", 0, 5800, "#ff8800"); // riflesso

  }
  startRenderLoop();
})();
