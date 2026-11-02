/* =====================================================================
   core/11-scene.js
   Scena Babylon, materiali e mesh, costruzione della scena dal modello, linee dinamiche, rebuild()
   ===================================================================== */
/* =====================================================================
   5. SCENA BABYLON
   ===================================================================== */
const { Vector3: V3, Color3: C3, Quaternion: Quat } = BABYLON;
const canvas = $('stage');
const engine = new BABYLON.Engine(canvas, true, { antialias: true });
const scene  = new BABYLON.Scene(engine);
scene.useRightHandedSystem = true;
scene.clearColor = new BABYLON.Color4(.8, .8, .8, 1);

const camera = new BABYLON.ArcRotateCamera('cam', PI / 2 - .7, 1.1, 1000, V3.Zero(), scene);

// 1. Attiva la modalità ortogonale
camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

// 2. Definisci i parametri di base per lo zoom
const baseRadius = 1000;      // Deve corrispondere al raggio iniziale della camera
const baseOrthoSize = 400;    // Regola questo valore per l'inquadratura iniziale

function updateOrthoBounds() {
    const aspectRatio = engine.getAspectRatio(camera);
    // Più la camera è lontana (radius grande), più l'area inquadrata è ampia (zoom out)
    const scale = camera.radius / baseRadius;
    const currentSize = baseOrthoSize * scale;

    camera.orthoTop = currentSize / 2;
    camera.orthoBottom = -currentSize / 2;
    camera.orthoLeft = -currentSize / 2 * aspectRatio;
    camera.orthoRight = currentSize / 2 * aspectRatio;
}

// 3. Aggiorna i limiti ogni volta che la vista cambia (es. rotella del mouse)
camera.onViewMatrixChangedObservable.add(updateOrthoBounds);
updateOrthoBounds(); // Inizializza i valori

// Il resto del codice rimane invariato
camera.attachControl(canvas, false);
camera.lowerRadiusLimit = 30;
camera.wheelDeltaPercentage = .02;
camera.panningSensibility = 40;
camera.minZ = 1;


canvas.addEventListener('wheel', e => e.preventDefault(), { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());
new BABYLON.HemisphericLight('sky', new V3(.3, 1, .5), scene).intensity = .75;
new BABYLON.DirectionalLight('sun', new V3(.5, -1, -.7), scene).intensity = .8;

const matCache = {};
function material(hex) {
  if (!hex) { console.warn(`[DEBUG material] hex undefined, uso #ffcc00`); hex = "#ffcc00"; }
  if (!matCache[hex]) {
    const m = new BABYLON.StandardMaterial('m' + hex, scene);
    m.diffuseColor = C3.FromHexString(hex); m.specularColor = new C3(.28, .28, .28); m.backFaceCulling = false;
    matCache[hex] = m;
  }
  return matCache[hex];
}
const markerMat = material('#d4262e');
const toV3 = a => new V3(a[0], a[1], a[2]);

// Costruisce una mesh da uno o più solidi. I solidi con vertici non finiti (NaN/Infinity) vengono saltati e segnalati.
// Costruisce una mesh da uno o più solidi. I solidi con vertici non finiti (NaN/Infinity) vengono saltati e segnalati.
function buildMesh(name, solids, mapPoint, mat, pickable) {
  console.log(`[DEBUG buildMesh] ${name}: ${solids ? solids.length : 'NO SOLIDS'} solidi`);
  if(!solids || !Array.isArray(solids)){
    throw new Error(`solids non è un array per ${name}: ${typeof solids} - ${JSON.stringify(solids).substring(0,500)}`);
  }
  const pos = [], nor = [], idx = [];
  let n = 0;
  for (let si=0; si<solids.length; si++) {
    const solid = solids[si];
    if(!solid){
      throw new Error(`${name} solido #${si} è undefined/null - solids[${si}] mancante`);
    }
    const { P, T } = solid;
    console.log(`[DEBUG] ${name} solido #${si}: P=${P ? P.length : 'NO P'} T=${T ? T.length : 'NO T'}`);
    if(!P){
      throw new Error(`${name} solido #${si}: P mancante - solid=${JSON.stringify(solid).substring(0,500)}`);
    }
    if(!T){
      throw new Error(`${name} solido #${si}: T mancante - P len ${P.length}`);
    }
    if(!Array.isArray(P) || P.length===0){
      throw new Error(`${name} solido #${si}: P non array o vuoto - P=${JSON.stringify(P).substring(0,500)}`);
    }
    if(!Array.isArray(T) || T.length===0){
      console.warn(`[DEBUG] ${name} solido #${si}: T vuoto, salto solido`);
      continue;
    }
    // check first P entry
    if(!P[0] || P[0].length < 3){
      throw new Error(`${name} solido #${si}: P[0] invalido - P[0]=${JSON.stringify(P[0])} - primo punto non [x,y,z]`);
    }
    let R;
    try{
      R = P.map(mapPoint);
    }catch(e){
      throw new Error(`${name} solido #${si}: P.map(mapPoint) fallito - ${e.message} - P[0]=${JSON.stringify(P[0])}`);
    }
    const badIdx = R.findIndex(p => !p || !Array.isArray(p) || !p.every(Number.isFinite));
    if (badIdx >= 0) {
      const badP = P[badIdx];
      const badR = R[badIdx];
      console.error(`[DEBUG] ${name} solido #${si} vertice non finito #${badIdx}: P=${JSON.stringify(badP)} R=${JSON.stringify(badR)}`);
      fail('mesh', `"${name}" solido #${si}: vertice non finito (#${badIdx} su ${R.length}): P=${JSON.stringify(badP)} R=${JSON.stringify(badR)}`, P[badIdx]);
      continue;
    }
    let vol = 0;
    try{
      for (const [a, b, c] of T) {
        if(a===undefined || b===undefined || c===undefined){
          throw new Error(`T contiene undefined: [${a},${b},${c}] in solido #${si} T[${T.indexOf([a,b,c])}]`);
        }
        const A = R[a], B = R[b], C = R[c];
        if(!A || !B || !C){
          throw new Error(`R[${a}]=${A} R[${b}]=${B} R[${c}]=${C} out of range - R len ${R.length}, T tri [${a},${b},${c}] in solido #${si}`);
        }
        vol += A[0]*(B[1]*C[2]-B[2]*C[1]) + A[1]*(B[2]*C[0]-B[0]*C[2]) + A[2]*(B[0]*C[1]-B[1]*C[0]);
      }
    }catch(e){
      console.error(`[DEBUG] ${name} solido #${si} calcolo volume fallito:`, e.message, `T[0]=${JSON.stringify(T[0])} R len=${R.length}`);
      throw e;
    }
    for (const t of T) {
      if(!t || t.length!==3){
        throw new Error(`${name} solido #${si}: triangolo invalido ${JSON.stringify(t)}`);
      }
      const [a, b, c] = vol < 0 ? [t[0], t[2], t[1]] : t;
      const A = R[a], B = R[b], C = R[c];
      if(!A || !B || !C){
        throw new Error(`${name} solido #${si}: R[${a}]=${JSON.stringify(A)} R[${b}]=${JSON.stringify(B)} R[${c}]=${JSON.stringify(C)} - R len ${R.length} tri [${a},${b},${c}]`);
      }
      const ux = B[0]-A[0], uy = B[1]-A[1], uz = B[2]-A[2], vx = C[0]-A[0], vy = C[1]-A[1], vz = C[2]-A[2];
      let x = uy*vz-uz*vy, y = uz*vx-ux*vz, z = ux*vy-uy*vx;
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      pos.push(...A, ...B, ...C);
      nor.push(x, y, z, x, y, z, x, y, z);
      idx.push(n, n + 1, n + 2); n += 3;
    }
  }
  const mesh = new BABYLON.Mesh(name, scene);
  if (pos.length) {
    const data = new BABYLON.VertexData();
    data.positions = pos; data.normals = nor; data.indices = idx; data.applyToMesh(mesh);
  } else warn('mesh', `"${name}": nessuna geometria valida, la mesh resta vuota`);
  mesh.material = mat; mesh.isPickable = !!pickable;
  return mesh;
}


function frameMap(side = 1, apexW = 0) {
  return p => [p[0], side * p[1], apexW + side * p[2]];
}

const wrapAngle = a => { const r = ((a % (2 * PI)) + 2 * PI) % (2 * PI); return r > 2 * PI - 1e-6 ? 0 : r; };
const cacheKey = obj => JSON.stringify(obj, (k, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);

/* I solidi di un ingranaggio li costruisce il suo tipo: types/gears/<tipo>/create.js → solids(g) */
function gearSolids(g) {
  const impl = Registry.get('gear', g.type);
  if (!impl || !impl.solids) throw new Error(`il tipo "${g.type}" non definisce solids(g) (types/gears/${g.type}/create.js)`);
  let solids = impl.solids(g);
  if (g.bore) {                                                  // foro per l'asse (core/04-geometry.js: boreSolids, raggio da computeBore)
    const res = boreSolids(solids, g.bore);
    solids = res.solids;
    for (const why of new Set(res.skipped)) {
      const msg = `${g.id}: foro dell'asse non praticato (${why})`;
      if (/settore/.test(why)) step('foro', msg); else warn('foro', msg + ' — nel gear: "bore": raggio del foro, oppure "bore": false per non forare');
    }
  }
  return solids;
}

// function resolvePart(p, ev) {
//   const k = { shape: p.shape, n: p.n || 32, color: p.color };
//   if (p.r !== undefined) k.r = ev(p.r);
//   if (p.w) k.w = p.w.map(e => ev(e));
//   k.at = (p.at || [0, 0]).map(e => ev(e));
//   if (p.half) k.half = p.half.map(e => ev(e));
//   if (p.poly) { k.poly = p.poly.map(pt => pt.map(e => ev(e))); k.y = p.y || [-1, 1]; }
//   const impl = Registry.get('part', k.shape);          // la forma la costruisce types/parts/<forma>/create.js → solid(k)
//   if (!impl || !impl.solid) throw new Error(`forma di parte sconosciuta: "${k.shape}"`);
//   const solid = impl.solid(k);
//   return { key: k, solid };
// }

function resolvePart(p, ev) {
  const k = { shape: p.shape, n: p.n || 32, color: p.color };
  if (p.r !== undefined) k.r = ev(p.r);
  if (p.w) k.w = p.w.map(e => ev(e));
  k.at = (p.at || [0, 0]).map(e => ev(e));
  if (p.half) k.half = p.half.map(e => ev(e));
  if (p.poly) { k.poly = p.poly.map(pt => pt.map(e => ev(e))); k.y = p.y || [-1, 1]; }

  // --- FIX ESTENSIBILITÀ: lascia passare tutti gli altri campi ---
  const known = new Set(['shape','n','color','r','w','at','half','poly','y']);
  for (const key of Object.keys(p)) {
    if (known.has(key)) continue;
    const v = p[key];
    if (typeof v === 'number' || typeof v === 'string') {
      try { k[key] = ev(v); } catch { k[key] = v; }
    } else if (Array.isArray(v)) {
      k[key] = v.map(e => {
        if (typeof e === 'number' || typeof e === 'string') {
          try { return ev(e); } catch { return e; }
        }
        return e;
      });
    } else if (v && typeof v === 'object') {
      const o = {};
      for (const kk in v) {
        const vv = v[kk];
        if (typeof vv === 'number' || typeof vv === 'string') {
          try { o[kk] = ev(vv); } catch { o[kk] = vv; }
        } else o[kk] = vv;
      }
      k[key] = o;
    } else {
      k[key] = v;
    }
  }

  const impl = Registry.get('part', k.shape);
  if (!impl || !impl.solid) throw new Error(`forma di parte sconosciuta: "${k.shape}"`);
  const solid = impl.solid(k);
  return { key: k, solid };
}

/* =====================================================================
   6. COSTRUZIONE DELLA SCENA A PARTIRE DAL MODELLO
   ===================================================================== */
let M = null;
const meshCache = new Map();

function buildScene(M) {
  step('scena', `Costruzione della scena: ${M.axes.length} assi, ${M.gears.length} ingranaggi`);
  const used = new Set();
  let built = false;
  const cached = (key, make) => {
    used.add(key);
    let m = meshCache.get(key);
    built = false;
    if (!m || m.isDisposed()) { m = make(); meshCache.set(key, m); built = true; }
    m.renderOverlay = false;
    return m;
  };
  M.nodes = []; M.extras = []; M.allMeshes = []; M.groupItems = {};
  const inGroup = (grp, item) => { if (grp) (M.groupItems[grp] = M.groupItems[grp] || []).push(item); };



  for (const a of M.axes) { a.node = new BABYLON.TransformNode('axis_' + a.id, scene); a.node.rotationQuaternion = Quat.Identity(); M.nodes.push(a.node); }
  for (const a of M.axes) {
    const Ob = V.toB(a.O);
    if (a.carrier) { a.node.parent = a.carrier.node; a.node.position = toV3(V.sub(Ob, V.toB(a.carrier.O))); }
    else a.node.position = toV3(Ob);
    a.axisB = toV3(V.toB(a.dir));
    inGroup(a.group || a.def.group, a.node);
    a.frame = new BABYLON.TransformNode('frame_' + a.id, scene); a.frame.parent = a.node; M.nodes.push(a.frame);
    const fx = V.toB(a.ref), fy = V.toB(a.yv), fz = V.toB(a.dir);
    a.frame.rotationQuaternion = Quat.FromRotationMatrix(BABYLON.Matrix.FromValues(fx[0], fx[1], fx[2], 0, fy[0], fy[1], fy[2], 0, fz[0], fz[1], fz[2], 0, 0, 0, 0, 1));
    if (a.aligned) a.node.parent = null;
    if (a.aimed) a.frame.rotationQuaternion = Quat.Identity();   // la posa degli assi "through" è assoluta (updateThrough)
    step('scena', `asse ${a.id}: nodo creato in ${fmtV(a.O)}` + (a.carrier ? ` (figlio di ${a.carrier.id})` : ''));
  }

  for (const g of M.gears) {
    CTX.where = `scena: ingranaggio ${g.id}`;
    const gimpl = Registry.get('gear', g.type);
    const key = 'g|' + cacheKey([
      g.type, g.z, g.m, wrapAngle(g.rho), g.w, g.apexW, g.side, g.r, g.def.color || g.ax.def.color,
      gimpl && gimpl.cacheKey ? gimpl.cacheKey(g) : null,       // parametri geometrici specifici del tipo (create.js)
      g.bore ? [g.bore.r, g.bore.flat, g.bore.ang] : null       // foro centrale
    ]);
    g.sig = JSON.stringify([g.type, g.z, g.m, g.def.axis, g.apexW, g.w, g.side, gimpl && gimpl.sigKey ? gimpl.sigKey(g) : null]);
    const t0 = performance.now();
    try {
      g.mesh = cached(key, () => {
        const col = g.def.color || g.ax.def.color || g.ax?.def?.color || "#ffcc00";
        console.log(`[DEBUG buildScene] gear ${g.id} type ${g.type} color ${col} solids`, (()=>{try{const s=gearSolids(g); console.log(`  solids len ${s.length} first P len ${s[0]?.P?.length} T len ${s[0]?.T?.length}`); return s;}catch(e){console.error(`  gearSolids fallito per ${g.id}:`, e); throw e;}})());
        return buildMesh('gear_' + g.id, gearSolids(g), frameMap(g.side, g.apexW || 0), material(col), true);
      });
    } catch (e) { throw new Error(`ingranaggio ${g.id} (${g.type}): errore nella geometria: ${e.message}`); }
    const tri = g.mesh.getTotalIndices() / 3;
    step('ingranaggio', `${g.id} [${g.type}]: ${built ? `mesh costruita (${tri} triangoli, ${(performance.now() - t0).toFixed(0)} ms)` : `mesh riusata dalla cache (${tri} triangoli)`}`);
    if (!tri) warn('ingranaggio', `${g.id}: la mesh non contiene triangoli`); // `
    g.mesh.parent = g.ax.frame; g.mesh.metadata = g.id; g.mesh.setEnabled(true);
    M.allMeshes.push(g.mesh);

    // --- marker definito nell'ingranaggio stesso (nuova funzionalità) ---
    // Ogni ingranaggio deve avere un marker; definizione in gear.marker, non nell'asse
    const getMarkerDef = (def) => {
      let md = def.marker;
      if (md === false) return null; // esplicitamente disabilitato
      if (md === undefined) md = true; // default: ogni ingranaggio ha marker (requisito)
      if (md === true) return { radius: 4, color: null, at: null };
      if (typeof md === 'number') return { radius: md, color: null, at: null };
      if (typeof md === 'object') {
        const radius = md.radius ?? md.r ?? md.size ?? 4;
        const color = md.color ?? null;
        const at = md.at ?? md.pos ?? md.position ?? null;
        return { radius: radius===true?4:radius, color, at };
      }
      return { radius: 4, color: null, at: null };
    };
    const mDef = getMarkerDef(g.def);
    if (mDef) {
      try {
        const rad = +mDef.radius || 4;
        const diam = 2*rad;
        const mat = mDef.color ? material(mDef.color) : markerMat;
        const mk = BABYLON.MeshBuilder.CreateSphere('marker_'+g.id, {diameter: diam}, scene);
        mk.material = mat;
        mk.isPickable = false;
        let posArr;
        if (mDef.at && Array.isArray(mDef.at)) {
          try {
            posArr = mDef.at.map(e => typeof e==='string' ? M.ev(e) : e);
          } catch { posArr = mDef.at; }
        } else {
          const rPos = g.r * 0.65;
          let zPos = 0;
          if (g.w) zPos = (g.w[0]+g.w[1])/2;
          else if (gimpl && gimpl.markerZ) zPos = gimpl.markerZ(g);
          posArr = [rPos, 0, zPos];
        }
        const side = g.side || 1;
        const apexW = g.apexW || 0;
        const mapped = [posArr[0], side*posArr[1], apexW + side*posArr[2]];
        mk.position.set(mapped[0], mapped[1], mapped[2]);
        mk.parent = g.ax.frame;
        M.allMeshes.push(mk);
        if (M.extras) M.extras.push(mk);
        try { inGroup(g.ax.def.group || g.def.group || g.hostAx?.def?.group, mk); } catch {}
        g.markerMesh = mk;
        g.markerDef = mDef;
        step('ingranaggio', `${g.id}: marker creato raggio=${rad}mm in [${mapped.map(v=>+v.toFixed(2)).join(', ')}] (definito nel gear)`);
      } catch(e) {
        warn('ingranaggio', `${g.id}: impossibile creare marker: ${e.message}`);
      }
    }
  }
  for (const a of M.axes) {
    const parts = a.def.parts || []; let count = 0;
    parts.forEach((pd, i) => {
      if (!isActive(pd)) return;
      CTX.where = `scena: asse ${a.id}, parte #${i} (${pd.shape})`;
      const { key, solid } = resolvePart(pd, M.ev);
      const mat = key.color === 'marker' ? markerMat : material(key.color || a.def.color);
      const mesh = cached('p|' + cacheKey([key, key.color || a.def.color]), () => buildMesh(`part_${a.id}_${i}_${pd.shape}`, [solid], frameMap(), mat, false));
      mesh.parent = a.frame; mesh.setEnabled(true);
      M.allMeshes.push(mesh); count++;
    });
    step('parti', `${a.id}: ${count} parti costruite` + (parts.length - count ? ` (${parts.length - count} saltate per variante)` : ''));
  }
  CTX.where = '';
  for (const [k, m] of meshCache) if (!used.has(k)) { m.dispose(); meshCache.delete(k); }

  // oggetti Babylon dei link (freni, funi, marker dei binari, snodi di Hooke...): types/links/<tipo>/create.js → build(M, ctx)
  Registry.run('build', M, { inGroup });

  applyGroups();
  step('scena', `Scena completa: ${M.allMeshes.length} mesh, ${M.nodes.length} nodi, ${M.extras.length} elementi extra`);
}

function applyGroups() {
  if (!M) return;
  for (const g in M.groupItems) for (const it of M.groupItems[g]) it.setEnabled(state.groups[g] !== false);
}

// Ingombro del modello: ignora le mesh vuote o con bounding box non finito (e le segnala).
function modelBounds() {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  let skipped = 0;
  for (const m of M.allMeshes) {
    if (!m.getTotalVertices()) { skipped++; continue; }
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox, vs = [bb.minimumWorld, bb.maximumWorld];
    if (!vs.every(v => Number.isFinite(v.x + v.y + v.z))) { skipped++; warn('ingombro', `bounding box non finito per la mesh "${m.name}"${m.metadata ? ` (ingranaggio ${m.metadata})` : ''}`); continue; }
    for (const v of vs) for (let i = 0; i < 3; i++) { const c = [v.x, v.y, v.z][i]; min[i] = Math.min(min[i], c); max[i] = Math.max(max[i], c); }
  }
  step('ingombro', `min=${fmtV(min)} max=${fmtV(max)}` + (skipped ? ` (${skipped} mesh ignorate)` : '')); // `
  return { min, max };
}


/* =====================================================================
5e LINEE DINAMICHE POST-ANIMAZIONE (es. Raggi riflessi, linee di mira)
===================================================================== */
const dynamicLines = [];

function _getWorldPos(id) {
    // prova axis -> node -> transform di scena
    const ax = M.axisBy?.[id];
    if (ax?.node) {
        ax.node.computeWorldMatrix(true);
        return ax.node.getAbsolutePosition().clone();
    }
    if (M.pointBy?.[id]?.node) {
        M.pointBy[id].node.computeWorldMatrix(true);
        return M.pointBy[id].node.getAbsolutePosition().clone();
    }
    // fallback diretto a Babylon - funziona se gli id sono nomi di TransformNode/Mesh
    const t = scene.getTransformNodeByName(id) || scene.getNodeByName(id) || scene.getMeshByName(id);
    if (t) {
        t.computeWorldMatrix(true);
        return t.getAbsolutePosition().clone();
    }
    throw new Error(`Nodo non trovato per id: ${id}`);
}

function _getWorldZ(id) {
    const ax = M.axisBy?.[id];
    if (ax?.frame) {
        ax.frame.computeWorldMatrix(true);
        const wm = ax.frame.getWorldMatrix();
        return new BABYLON.Vector3(wm.m[8], wm.m[9], wm.m[10]).normalize();
    }
    if (ax?.node) {
        // se è un asse senza frame, usa il suo Z locale
        ax.node.computeWorldMatrix(true);
        const wm = ax.node.getWorldMatrix();
        return new BABYLON.Vector3(wm.m[8], wm.m[9], wm.m[10]).normalize();
    }
    // punto puro -> non ha direzione, usiamo Y world per l'offset
    return new BABYLON.Vector3(0, 1, 0);
}

function createParallel(directionAxisId, baseAxisId, offsetAlongBase = 0, length = 500, color = "#ffff00") {
    if (!M) throw new Error("Modello non ancora costruito.");
    const meshName = "dynParallel_" + directionAxisId + "_" + baseAxisId + "_off" + offsetAlongBase;
    const lineMesh = BABYLON.MeshBuilder.CreateLines(meshName, {
        points: [BABYLON.Vector3.Zero(), new BABYLON.Vector3(0,0.1,0)], updatable: true
    }, scene);
    lineMesh.color = BABYLON.Color3.FromHexString(color);
    lineMesh.isPickable = false;
    lineMesh.renderingGroupId = 1;
    lineMesh.alwaysSelectAsActiveMesh = true;

    dynamicLines.push({ mesh: lineMesh, type: 'offset_on_axis', directionAxisId, baseAxisId, offsetAlongBase, length });
    return lineMesh;
}


/* Una linea dinamica appartiene a una macchina precisa: se la macchina corrente non ha gli assi che la definiscono, si nasconde. */
function hideDynamicLine(entry) { if (entry.mesh && entry.mesh.isEnabled()) entry.mesh.setEnabled(false); }

function updateDynamicLines() {
    if (!M) return;
    for (const entry of dynamicLines) {
        try {
            const { mesh, type, length } = entry;
            let worldDir, worldPos;

            if (type === 'offset_on_axis') {
                const dirAxis = M.axisBy[entry.directionAxisId];
                if (!dirAxis) { hideDynamicLine(entry); continue; }
                dirAxis.frame?.computeWorldMatrix(true);
                const wmDir = dirAxis.frame ? dirAxis.frame.getWorldMatrix() : dirAxis.node.getWorldMatrix();
                worldDir = new BABYLON.Vector3(wmDir.m[8], wmDir.m[9], wmDir.m[10]).normalize();

                const basePos = _getWorldPos(entry.baseAxisId);
                const baseDir = _getWorldZ(entry.baseAxisId);
                worldPos = basePos.add(baseDir.scale(entry.offsetAlongBase));

            } else if (type === 'parallel_by_points') {
                const pos1 = _getWorldPos(entry.point1Id);
                const pos2 = _getWorldPos(entry.point2Id);

                let dir = pos2.subtract(pos1);
                if (dir.lengthSquared() < 1e-10) continue; // punti coincidenti
                worldDir = dir.normalize();

                const basePos = _getWorldPos(entry.baseAxisId);
                const baseDir = _getWorldZ(entry.baseAxisId);
                worldPos = basePos.add(baseDir.scale(entry.offsetAlongBase));
            } else continue;

            const half = length / 2;
            const p1 = worldPos.subtract(worldDir.scale(half));
            const p2 = worldPos.add(worldDir.scale(half));

            BABYLON.MeshBuilder.CreateLines(null, { points: [p1, p2], instance: mesh }, scene);
            if (!mesh.isEnabled()) mesh.setEnabled(true);
            entry.warned = false;

        } catch (err) {
            hideDynamicLine(entry);                      // asse o nodo mancante (macchina diversa): nascosta, e l'avviso esce una volta sola
            if (!entry.warned) { entry.warned = true; console.warn(`[updateDynamicLines] ${entry.mesh?.name} nascosta:`, err.message); }
        }
    }
}



/* Diagnostica: dopo ogni ricostruzione, ogni mesh/nodo della scena deve appartenere al modello corrente, alla cache delle mesh,
   agli assi X/Y/Z o alle linee dinamiche. Ciò che resta è un residuo della macchina precedente: lo scrive in console, per nome. */
function reportOrphans() {
  try {
    const known = new Set(), add = n => { if (!n || known.has(n)) return; known.add(n); n.getChildren().forEach(add); };
    (M.nodes || []).forEach(add); (M.extras || []).forEach(add); (M.allMeshes || []).forEach(add);
    for (const m of meshCache.values()) add(m);
    if (typeof axesGizmo !== 'undefined') axesGizmo.forEach(add);
    dynamicLines.forEach(e => add(e.mesh));
    const orphans = [...scene.meshes, ...scene.transformNodes].filter(n => !known.has(n));
    if (orphans.length) console.warn(`[scena] ${orphans.length} oggetti residui dopo la ricostruzione (non appartengono al modello corrente): ` + orphans.slice(0, 12).map(n => n.name + (n.parent ? ' ← ' + n.parent.name : '')).join(', '), orphans);
  } catch (e) { console.warn('[scena] controllo oggetti residui non riuscito:', e.message); }
}

function rebuild(verbose = true, fresh = false) {   // fresh: macchina nuova, non si riportano gli angoli del modello precedente
  DBG.on = verbose || DBG.always;
  if (verbose) seenMsgs.clear();
  const t0 = performance.now();
  step('rebuild', '════════ ricostruzione del modello ════════');
  syncParams();
  const newM = resolveModel();   // se fallisce lancia un errore e resta il modello precedente
  validateModel(newM);

  const prevTheta = {}, prevSig = {};
  if (M) {
    if (!fresh) {
      for (const a of M.axes) prevTheta[a.id] = a.theta;
      for (const g of M.gears) prevSig[g.id] = g.sig;
    }
    for (const m of meshCache.values()) { m.parent = null; m.renderOverlay = false; }
    // M può essere a metà (buildScene fallita). I nodi si smaltiscono CON i loro figli (perni, nucleo e forcelle di Hooke, marker...):
    // con dispose(true) i figli restavano nella scena, staccati, e a ogni rebuild se ne accumulavano di nuovi. Le mesh in cache
    // sono già state staccate dai nodi qui sopra, quindi la ricorsione non le tocca.
    (M.nodes || []).forEach(n => { if (!n.isDisposed()) n.dispose(false); });
    (M.extras || []).forEach(m => { if (!m.isDisposed()) m.dispose(); });
  }
  M = newM;
  buildScene(M);
  reportOrphans();


  for (const a of M.axes) a.theta = prevTheta[a.id] || 0;
  const dirty = a => { const gs = M.gears.filter(g => g.ax === a); return gs.length > 0 && gs.every(g => prevSig[g.id] !== g.sig); };
  for (const a of M.axes) if (dirty(a)) for (const m of M.meshes) {
    const other = m.g.ax === a ? m.p.ax : m.p.ax === a ? m.g.ax : null;
    if (!other || dirty(other)) continue;
    const nz = m.row.map((v, i) => Math.abs(v) > 1e-9 ? i : -1).filter(i => i >= 0);
    if (nz.length === 2) { a.theta = -m.row[other.idx] / m.row[a.idx] * other.theta; break; }
  }
  M.spins.forEach(q => { q.prev = q.a.theta; });
  updateSpin(M);
  Registry.run('settle', M);          // i link riportano a posto ciò che dipende dalla geometria (es. croce di Malta)
  updateThrough(M);
  // chiamala subito dopo aver costruito M
ensureWheelState(M);

  CTX.where = 'differential';
  try {
    M.differential = MACHINE.differential && relationCoeffs(M, MACHINE.differential.out, MACHINE.differential.ins);
    if (M.differential) step('differenziale', `w_${MACHINE.differential.out} = ${M.differential.map((c, i) => `${+c.toFixed(4)}·w_${MACHINE.differential.ins[i]}`).join(' + ')}`); // `
  } catch (e) { M.differential = null; warn('differenziale', `non calcolabile: ${e.message}`); }
  CTX.where = 'ratios';
  M.ratioVals = (MACHINE.ratios || []).map(r => {
    try { const v = Math.abs(relationCoeffs(M, r.to, [r.from, r.from])[0]); step('rapporto', `${r.from} → ${r.to}: ${+v.toFixed(4)}`); return v; }
    catch (e) { warn('rapporto', `${r.from} → ${r.to} non calcolabile: ${e.message}`); return NaN; }
  });
  CTX.where = '';
  step('rebuild', `completata in ${(performance.now() - t0).toFixed(0)} ms`); //`
}
