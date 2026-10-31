/* =====================================================================
   core/12-ui.js
   Interfaccia: tabella, pannelli, selezione, testi di stato, assi X/Y/Z
   ===================================================================== */
const rpmOf = exp => Math.pow(10, exp);
let sinceTable = 0;
let rowOf = {};

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function buildTable() {
  const tb = $('gearRows'); tb.innerHTML = ''; rowOf = {};
  for (const g of M.gears) {
    const row = tb.insertRow(); row.tabIndex = 0; row.dataset.gear = g.id; rowOf[g.id] = row;
    row.innerHTML = `<td>${esc(g.label)}</td><td>${esc(g.def.name)}${g.def.note ? ` <span style="color:var(--muted)">(${esc(g.def.note)})</span>` : ''}</td>` +
                    `<td>${esc(g.ax.id)}</td><td>${esc(g.z || '—')}</td><td>${fmt(2 * g.r, 1)}</td><td></td>`; // `
    row.onclick = () => selectGear(g.id);
    row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectGear(g.id); } };
  }
}

function highlight(id) {
  if (state.current && M.gearBy[state.current]) M.gearBy[state.current].mesh.renderOverlay = false;
  state.current = id;
  const g = M.gearBy[id];
  g.mesh.renderOverlay = true; g.mesh.overlayColor = new C3(1, .45, 1); g.mesh.overlayAlpha = .45;
  $('selected').textContent = `${g.label} — ${g.ax.id}`;
  $('selected').title = `${g.label} — ${g.def.name}${g.z ? ', ' + g.z + ' denti' : ''}. Asse: ${g.ax.id}. Sensi visti ${g.ax.def.viewLabel || 'da davanti'}.`;
  for (const r of document.querySelectorAll('#gearRows tr')) r.classList.toggle('sel', r.dataset.gear === id);
}

function updateDriver() {
  const rpm = +$('speed').value;
  $('rpmLabel').textContent = fmt(rpm, 1);
  const g = state.current && M.gearBy[state.current];
  state.driver = g ? { gear: g.id, w: g.ax.cw * rpm * PI / 30 } : null;
  explainSoon();
}
function selectGear(id) {
  if (state.current === id) { releaseGear(); return; }
  highlight(id); updateDriver();
}

function releaseGear() {
  if (state.current && M.gearBy[state.current]) M.gearBy[state.current].mesh.renderOverlay = false;
  state.current = null; state.driver = null;
  $('selected').textContent = 'Nessun ingranaggio selezionato';
  $('selected').title = 'Seleziona un ingranaggio nella scena o nella tabella.';
  for (const r of document.querySelectorAll('#gearRows tr')) r.classList.remove('sel');
  explainSoon();
}

/* Gira la chiave di dphi: ogni asse si sposta di quanto prescrive la cinematica (soluzione con la sola chiave a velocità 1). */
function applyKeyOffset(deg) {
  const dphi = (deg - state.keyOffset) * PI / 180;
  state.keyOffset = deg;
  if (!M || !M.inputs.length || !dphi) return;
  const keyIdx = M.inputs[0].idx, { cons } = solveSpeeds(M);
  const bv = cons.map(c => (c.kind === 'input' && c.axisIdx === keyIdx) ? M.axes[keyIdx].cw : 0);
  const s = relSpins(M, solveConstraints(M, cons, bv).w);
  M.axes.forEach((a, i) => { a.theta += s[i] * dphi; });
}


/* Imposta la declinazione: ruota axis_Decli (e tutta la forcella che ne è portata) dell'angolo richiesto.
   Il segno è scelto in modo che +° corrisponda al senso "positivo" attorno all'asse; se in scena risulta
   invertito, cambia in `-dphi` nella riga `a.theta += dphi`. */
function applyDeclination(deg) {
  const dphi = (deg - state.declination) * PI / 180;
  state.declination = deg;
  if (!M || !dphi) return;
  const a = M.axisBy.axis_Decli;
  if (!a) return;
  a.theta += dphi;
  if (!a.aimed && a.node) a.node.rotationQuaternion = Quat.RotationAxis(a.axisB, a.theta);
  updateThrough(M);
}

function updateTexts() {
  const lines = []; let bad = false;
  try {
    for (const c of MACHINE.checks || []) if (isActive(c)) {
      if (c.type === 'axisClearsGear') {
        const a = M.axisBy[c.axis], g = M.gearBy[c.gear];
        const dist = V.len(V.perp(V.sub(a.O, g.ax.O), a.dir)), gap = dist - c.shaftR - (g.r + g.m), ex = { dist, gap, miss: c.min - gap };
        lines.push(template(c.text, M.ev, ex) + template(gap < c.min ? c.bad : c.ok, M.ev, ex));
        if (gap < c.min) bad = true;
      } else if (c.type === 'info') lines.push(template(c.text, M.ev));
    }
    const notes = (MACHINE.ratios || []).map((r, i) => template(r.text, M.ev, { r: M.ratioVals[i] }));
    $('note').textContent = notes.concat((MACHINE.notes || []).map(t => template(t, M.ev))).join(' ');
  } catch (e) { warn('testi', `errore nei testi di "checks"/"ratios"/"notes": ${e.message}`); }
  $('check').textContent = lines.join(' ');
  $('check').className = 'small' + (bad ? ' bad' : '');
}

function statusText(w, locked) {
  const lines = [], E = 1e-9;
  lines.push(...Registry.collect('status', M, w, locked));         // righe di stato dei link (nottolino, freno, snodo...)
  if (M.differential) {
    const d = MACHINE.differential, [a, b] = M.differential;
    lines.push(template(d.text, M.ev, { a, b }) + ` Uscita: ${fmt(Math.abs(w[M.axisBy[d.out].idx]) * 30 / PI, 3)} giri/min.`);
  }
  if (M.spinText) lines.push(M.spinText);
  if (M.throughText) lines.push(M.throughText);
  return lines.join('\n');
}

function afterRebuild() {
  for (const [btn, gear] of [['siderealTime', 'gear_A1_upper'], ['siderealTimeRegulator', 'gear_M']]) {   // i due pulsanti presuppongono questi ingranaggi
    const b = $(btn); if (b) b.disabled = !M.gearBy[gear];
  }
  buildTable();
  const cur = state.current;
  if (cur && M.gearBy[cur]) highlight(cur);
  else {
    state.current = null;
    if (state.driver && !M.gearBy[state.driver.gear]) state.driver = null;
    $('selected').textContent = 'Nessun ingranaggio selezionato';
    $('selected').title = 'Seleziona un ingranaggio nella scena o nella tabella.';
  }
  updateTexts();
  sinceTable = 1;
  explainSoon();
  if (typeof updateDynamicLines === 'function') updateDynamicLines();
}


let rebuildQueued = false;
function onModelChange() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    try { rebuild(false); afterRebuild(); }
    catch (e) { reportError('ricostruzione (cursore)', e); console.warn('[rebuild] il modello precedente resta visualizzato'); }
  });
}

function onVariantChange() {
  try { rebuild(true); buildPanel(); afterRebuild(); return true; }
  catch (e) { reportError('cambio variante', e); console.warn('[rebuild] il modello precedente resta visualizzato (la variante selezionata ha errori)'); return false; }
}

/* Selettore delle varianti, costruito da MACHINE.variants:
     "variants": { "mirror_drive": { "label": "Comando dello specchio", "options": { "originale": "Originale", "alternativa": "Alternativa" }, "active": "originale" } }
   Un gruppo di radio per ogni variante (un valore di "options" per radio; l'etichetta è il valore della voce, o la chiave se manca).
   Con esattamente due opzioni e  "ui": "checkbox"  si ha invece una sola casella: spenta = prima opzione, accesa = seconda.
   Se la variante scelta dà errori il modello precedente resta visibile e la scelta viene annullata. */
function buildVariantPanel() {
  let box = $('variantsBox');
  if (!box) {                                    // la pagina non ha il contenitore: lo crea sotto i gruppi
    box = el('div', { id: 'variantsBox' }, el('h2', { textContent: 'Varianti' }), el('div', { id: 'variants' }));
    $('groups').insertAdjacentElement('afterend', box);
  }
  const host = $('variants'); host.innerHTML = '';
  const keys = Object.keys(MACHINE.variants || {});
  box.hidden = !keys.length;
  const choose = (k, value) => {
    const prev = state.variants[k]; state.variants[k] = value;
    if (!onVariantChange()) { state.variants[k] = prev; buildVariantPanel(); }
  };
  for (const k of keys) {
    const v = MACHINE.variants[k], opts = v.options || {}, names = Object.keys(opts);
    const nice = o => (typeof opts[o] === 'string' ? opts[o] : opts[o] && opts[o].label) || o;
    const row = el('div', { className: 'variant-row' }, el('div', { className: 'small', textContent: v.label || k }));
    if (v.ui === 'checkbox' && names.length === 2) {
      const inp = el('input', { type: 'checkbox', checked: state.variants[k] === names[1] });
      inp.onchange = () => choose(k, inp.checked ? names[1] : names[0]);
      row.append(el('label', {}, inp, ' ' + nice(names[1])));
    } else for (const o of names) {
      const inp = el('input', { type: 'radio', name: 'variant_' + k, value: o, checked: state.variants[k] === o });
      inp.onchange = () => { if (inp.checked) choose(k, o); };
      row.append(el('label', { style: 'margin-right:10px' }, inp, ' ' + nice(o)));
    }
    host.append(row);
  }
}

function buildViewPanel() {
console.log("[buildViewPanel]")
  let box = $('viewsBox');
  if (!box) {
    // Se il contenitore non esiste, lo crea sotto il pannello delle varianti (o dei gruppi)
    const anchor = $('variantsBox') || $('groups');
    box = el('div', { id: 'viewsBox' }, el('h2', { textContent: 'Viste' }), el('div', { id: 'viewsList' }));
    anchor.insertAdjacentElement('afterend', box);
  }

  const host = $('viewsList');
  host.innerHTML = '';

  const views = MACHINE.views || [];
  if (!views.length) {
    box.hidden = true;
    return;
  }

  box.hidden = false;

  views.forEach((v, i) => {
    const inp = el('input', {
      type: 'radio',
      name: 'view_radio',
      value: v.id,
      checked: i === 0 // La prima vista è selezionata di default
    });

    inp.onchange = () => {
      if (inp.checked) {
        goView(v);
      }
    };

    // Crea una riga per il radio button
    const row = el('label', { style: 'margin-right: 10px; display: block; cursor: pointer;' },
      inp,
      ' ' + (v.label || v.id)
    );
    host.append(row);
  });
}



function goView(v) {
  let target, radius;
  CTX.where = `vista "${v.id}"`;
  if (v.auto) {
    const b = modelBounds();
    target = V3.Zero();                                   // l'origine sta al centro del pannello 3D
    let R = 0;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) R = Math.max(R, Math.hypot(x, y, z));
    const half = Math.min(camera.fov / 2, Math.atan(Math.tan(camera.fov / 2) * engine.getAspectRatio(camera)));
    radius = R / Math.sin(half) * (v.scale || 1);         // raggio che fa stare tutto il modello nella metà sinistra
  } else { target = toV3(V.toB(v.target.map(e => M.ev(e)))); radius = v.radius; }
  CTX.where = '';
  if (![target.x, target.y, target.z, radius].every(Number.isFinite) || radius <= 0) { fail('vista', `vista "${v.id}": target/raggio non validi`, target, radius); return; }
  camera.setTarget(target);
  camera.alpha = M.ev(v.alpha); camera.beta = M.ev(v.beta); camera.radius = radius;
  step('vista', `"${v.id}": target=(${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}) raggio=${radius.toFixed(1)}`);
}

function buildShowSpeeds() {
  const box = $('showSpeeds');
  box.innerHTML = '<div class="small" style="color:var(--muted);margin-bottom:4px">Velocità (giri/min)</div>';
  for (const item of (MACHINE.show || [])) {
    const row = el('div', { className: 'shown-speed' });
    const label = el('span', { className: 'shown-speed-label', textContent: item.label || item.gear || item.axis || '' });
    const value = el('span', { className: 'shown-speed-value', textContent: '—' });
    row.append(label, value);
    box.append(row);
    item._valueElement = value;
  }
  updateShowSpeeds();
}

function updateShowSpeeds() {
  if (!M) return;
  let w;
  try { w = solveSpeeds(M).w; } catch (e) { return; }
  for (const item of (MACHINE.show || [])) {
    const out = item._valueElement;
    if (!out) continue;
    const axis = item.axis ? M.axisBy[item.axis] : item.gear && M.gearBy[item.gear] ? M.gearBy[item.gear].ax : null;
    if (!axis) { out.textContent = 'non disponibile'; continue; }
    out.textContent = fmtRpm(rpmOfW(axis, w[axis.idx]));
  }
}

function buildPanel() {
  const cb = $('controls'); cb.innerHTML = '';
  for (const c of MACHINE.controls) {
    if (c.hidden) continue;
    const vv = c.variantKey ? state.variants[c.variantKey] : 'all', rng = c.ranges[vv];
    if (!rng) continue;
    const out = el('b', { textContent: fmt(state.ctrl[c.id][vv], 1) });
    const inp = el('input', { type: 'range', min: rng.min, max: rng.max, step: c.step, value: state.ctrl[c.id][vv] });
    inp.oninput = () => { state.ctrl[c.id][vv] = +inp.value; out.textContent = fmt(+inp.value, 1); onModelChange(); };
    cb.append(el('label', {}, c.label + ': ', out, inp));
  }
  buildShowSpeeds();
  const wc = $('wheelControls'); wc.innerHTML = '';
//   for (const gearId of ['gear_U3', 'gear_Rp']) {
//     const title = gearId === 'gear_U3' ? 'Declinazione' : 'Ascensione retta';
//     const section = el('div', { className: 'wheel-controls' });
//     section.append(el('h2', { textContent: `${title} — pilotaggio indipendente` }));
//     const speedOut = el('b', { textContent: fmt(state.wheelInputs[gearId].rpm, 3) });
//     const speedSlider = el('input', { type: 'range', min: -100, max: 100, step: 1, value: state.wheelInputs[gearId].rpm, title: `Velocità indipendente di ${title}, in giri/min` });
//     speedSlider.oninput = () => { state.wheelInputs[gearId].rpm = +speedSlider.value; speedOut.textContent = fmt(+speedSlider.value, 3); explainSoon(); };
//     section.append(el('label', {}, 'Velocità angolare: ', speedOut, ' giri/min', speedSlider));
//     const offsetOut = el('b', { textContent: fmt(state.wheelOffsets[gearId], 1) });
//     const offsetSlider = el('input', { type: 'range', min: -360, max: 360, step: 1, value: state.wheelOffsets[gearId], title: `Offset angolare di ${title}, in gradi` });
//     offsetSlider.oninput = () => {
//       const v = +offsetSlider.value, delta = (v - state.wheelOffsets[gearId]) * PI / 180;
//       state.wheelOffsets[gearId] = v; offsetOut.textContent = fmt(v, 1);
//       const g = M && M.gearBy[gearId];
//       if (g && delta) { g.ax.theta += delta; updateThrough(M); updateSpin(M); }
//     };
//     section.append(el('label', {}, 'Offset angolare: ', offsetOut, '°', offsetSlider));
//     wc.append(section);
//   }

// data-driven: prendi tutti i gear che dichiarano independentTuning
// usa M.gears se è l'array sorgente (mantiene l'ordine del JSON), altrimenti gearBy
const tunableGears = getTunableGears(M);

for (const gear of tunableGears) {
  const gearId = gear.id;
  const title = typeof getIndependentTuning(gear) === 'string'
   ? getIndependentTuning(gear)
    : (gear.label || gearId); // fallback se metterai independentTuning: true

  // inizializza se manca - rende il tutto robusto a nuovi gear
  state.wheelInputs[gearId]??= { rpm: 0 };
  state.wheelOffsets[gearId]??= 0;

  const section = el('div', { className: 'wheel-controls' });
  section.append(el('h2', { textContent: `${title} — pilotaggio indipendente` }));

  const speedOut = el('b', { textContent: fmt(state.wheelInputs[gearId].rpm, 3) });
  const speedSlider = el('input', {
    type: 'range', min: -100, max: 100, step: 1,
    value: state.wheelInputs[gearId].rpm,
    title: `Velocità indipendente di ${title}, in giri/min`
  });
  speedSlider.oninput = () => {
    state.wheelInputs[gearId].rpm = +speedSlider.value;
    speedOut.textContent = fmt(+speedSlider.value, 3);
    explainSoon();
  };
  section.append(el('label', {}, 'Velocità angolare: ', speedOut, ' giri/min', speedSlider));

  const offsetOut = el('b', { textContent: fmt(state.wheelOffsets[gearId], 1) });
  const offsetSlider = el('input', {
    type: 'range', min: -360, max: 360, step: 1,
    value: state.wheelOffsets[gearId],
    title: `Offset angolare di ${title}, in gradi`
  });
  offsetSlider.oninput = () => {
    const v = +offsetSlider.value, delta = (v - state.wheelOffsets[gearId]) * PI / 180;
    state.wheelOffsets[gearId] = v;
    offsetOut.textContent = fmt(v, 1);
    // gear è già l'istanza, non serve più cercare per id
    if (delta) { gear.ax.theta += delta; updateThrough(M); updateSpin(M); }
  };
  section.append(el('label', {}, 'Offset angolare: ', offsetOut, '°', offsetSlider));

  wc.append(section);
}


  const bb = $('brakes'); bb.innerHTML = '';
  Registry.run('panel', M, { el, box: bb, explainSoon });          // controlli dei link (es. i freni) nel contenitore #brakes
 // if (M.inputs.length) $('keyTitle').textContent = M.inputs[0].def.label;
}


function buildStaticPanel() {
  $('title').textContent = MACHINE.title;
  $('groups').innerHTML = '';
  buildVariantPanel();
  buildViewPanel();
  for (const g of MACHINE.groups) {
    const c = el('input', { type: 'checkbox', checked: state.groups[g.id] });
    c.onchange = () => { state.groups[g.id] = c.checked; applyGroups(); };
    $('groups').append(el('label', {}, c, ' ' + g.label));
  }
  $('rpmLabel').textContent = fmt(+$('speed').value, 1);
  $('speed').oninput = updateDriver;
  $('siderealTime').onclick = () => {
    const gearId = 'gear_A1_upper';
    const g = M && M.gearBy[gearId];
    if (!g) { reportError('Sidereal time', new Error(`ingranaggio ${gearId} non trovato`)); return; }
    highlight(gearId);
    const rpm = 1 / 1440;
    $('speed').value = String(rpm);
    $('rpmLabel').textContent = rpm.toFixed(6);
    state.driver = { gear: gearId, w: g.ax.cw * rpm * PI / 30 };
    explainSoon();
  };

  $('siderealTimeRegulator').onclick = () => {
    const gearId = 'gear_M';
    const g = M && M.gearBy[gearId];
    if (!g) { reportError('Sidereal time', new Error(`ingranaggio ${gearId} non trovato`)); return; }
    highlight(gearId);
    const rpm = 1 / 1440;
    $('speed').value = String(rpm);
    $('rpmLabel').textContent = rpm.toFixed(6);
    state.driver = { gear: gearId, w: g.ax.cw * rpm * PI / 30 };
    explainSoon();
  };

//
//   $('keyRpmLabel').textContent = fmt(+$('keySpeed').value, 1);
//   $('keyOffLabel').textContent = fmt(+$('keyOffset').value, 0);
//   $('keySpeed').oninput = () => {
//     const v = +$('keySpeed').value;
//     for (const id in state.inputs) state.inputs[id].rpm = v;
//     $('keyRpmLabel').textContent = fmt(v, 1); explainSoon();
//   };
//   $('keyOffset').oninput = () => { const v = +$('keyOffset').value; $('keyOffLabel').textContent = fmt(v, 0); applyKeyOffset(v); };
//   $('decliLabel').textContent = fmt(state.declination, 1);
//   $('decliSlider').value = state.declination;
//   $('decliSlider').oninput = () => {
//     const v = +$('decliSlider').value;
//     $('decliLabel').textContent = fmt(v, 1);
//     applyDeclination(v);
//   };
}

let axesGizmo = [];
function drawAxes(len) {
  axesGizmo.forEach(o => o.dispose(false, true)); axesGizmo = [];
  const defs = [[[1, 0, 0], '#e5484d', 'X'], [[0, 1, 0], '#3fb950', 'Y'], [[0, 0, 1], '#58a6ff', 'Z']];
  for (const [d, hex, label] of defs) {
    const col = C3.FromHexString(hex), end = toV3(V.mul(V.toB(d), len));
    const line = BABYLON.MeshBuilder.CreateLines('axis', { points: [V3.Zero(), end] }, scene);
    line.color = col;
    const tip = BABYLON.MeshBuilder.CreateSphere('axisTip', { diameter: 8 }, scene);
    tip.position = end;
    const tm = new BABYLON.StandardMaterial('a', scene); tm.emissiveColor = col; tm.disableLighting = true; tip.material = tm;
    const tex = new BABYLON.DynamicTexture('t', { width: 64, height: 64 }, scene, false);
    tex.hasAlpha = true; tex.drawText(label, 14, 48, 'bold 44px sans-serif', hex, 'transparent', true);
    const plane = BABYLON.MeshBuilder.CreatePlane('axisLabel', { size: 24 }, scene), pm = new BABYLON.StandardMaterial('a', scene);
    pm.diffuseTexture = tex; pm.useAlphaFromDiffuseTexture = true; pm.emissiveColor = C3.White(); pm.disableLighting = true; pm.backFaceCulling = false;
    plane.material = pm; plane.billboardMode = 7; plane.position = end.add(new V3(0, 14, 0));
    for (const o of [line, tip, plane]) { o.renderingGroupId = 1; o.isPickable = false; axesGizmo.push(o); }
  }
}




