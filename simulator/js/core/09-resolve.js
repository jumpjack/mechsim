/* =====================================================================
   core/09-resolve.js
   Risoluzione del modello: posizionamento degli assi, ingranaggi, coppie, link; verifica del modello risolto
   ===================================================================== */
function rotateVec(v, k, phi) {
  const c = cos(phi), s = sin(phi), kv = V.cross(k, v), kd = V.dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

function dependentsOf(M, root) {
  const set = new Set([root]);
  const refsOf = a => {
    const out = [], p = a.def.place;
    if (a.carrier) out.push(a.carrier);
    if (p.coaxial) out.push(M.axisBy[p.coaxial]);
    if (p.offset) out.push(M.axisBy[p.offset.from]);
    if (p.byMesh) { const g = M.gearBy[p.byMesh], q = M.gearBy[meshId(g.def)]; out.push(M.axisBy[q.def.axis]); }
    if (p.byApex) out.push(M.axisBy[M.gearBy[p.byApex].def.axis]);
    return out;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const a of M.axes) if (!set.has(a) && refsOf(a).some(r => set.has(r))) { set.add(a); changed = true; }
  }
  return set;
}

/* Geometria del punto di contatto fra g (che dichiara meshWith) e p. Il tipo di g può definire contact(g, p) nel proprio
   solve.js; se non esiste, o restituisce null, si usa il contatto fra ruote cilindriche (defaultContact). */
function contactGeometry(g, p) {
  const impl = Registry.get('gear', g.type);
  const c = impl && impl.contact ? impl.contact(g, p) : null;
  return c || defaultContact(g, p);
}

function defaultContact(g, p) {
  const v = V.sub(p.ax.O, g.ax.O), cg = V.unit(V.perp(v, g.ax.dir)), cp = V.unit(V.perp(V.mul(v, -1), p.ax.dir));
  const dist = V.len(V.perp(v, g.ax.dir));
  step('ingranamento', `${g.id} (z=${g.z}) ⇄ ${p.id} (z=${p.z}): interasse ${dist.toFixed(3)} mm (atteso ${(g.r + p.r).toFixed(3)})`);
  if (V.len(V.cross(g.ax.dir, p.ax.dir)) > 1e-6) warn('ingranamento', `Ingranaggi ${g.id}–${p.id}: gli assi (${g.ax.id}, ${p.ax.id}) non sono paralleli: la coppia cilindrica non ingrana correttamente`);
  if (Math.abs(dist - (g.r + p.r)) > 1e-6) warn('ingranamento', `Ingranaggi ${g.id}–${p.id}: interasse ${dist.toFixed(3)} invece di ${(g.r + p.r).toFixed(3)} (la velocità resta calcolata dal rapporto dei denti ${g.z}:${p.z})`);
  // Punto di contatto "cinematico": divide l'interasse reale in proporzione ai DENTI (non ai raggi primitivi).
  // Così il rapporto di velocità è sempre z_g : z_p, anche quando due ruote di denti diversi (a, a1) condividono lo stesso interasse.
  const dg = (g.z + p.z) > 0 ? dist * g.z / (g.z + p.z) : g.r;
  return { X: V.add(g.ax.O, V.mul(cg, dg)), cg, cp };
}

function describePlace(M, p) {
  if (p.at) return `posizione fissa ${JSON.stringify(p.at)}`;
  if (p.coaxial) return `coassiale a ${p.coaxial}`;
  if (p.offset) return `spostato da ${p.offset.from} di ${JSON.stringify(p.offset.by)}`;
  if (p.byMesh) {
    const g = M.gearBy[p.byMesh];
    return `interasse di ${p.byMesh} con ${g && meshId(g.def)}`;
  }
  if (p.byApex) return `apice di ${p.byApex}`;
  return 'sconosciuto';
}

function resolveModel() {
  CTX.where = 'validazione del JSON';
  validateMachine();
  step('modello', 'Variante attiva', { ...state.variants }, 'parametri', { ...state.params });

  const M = { axes: [], axisBy: {}, gears: [], gearBy: {}, pairs: [], meshes: [], inputs: [], constVal: {} };
  for (const lt of Object.values(Registry.types('link'))) if (lt.collection) M[lt.collection] = [];   // un array per ogni tipo di link caricato
  const resolving = new Set();
  let ev;
  const gImpl = g => Registry.get('gear', g.def.type || 'spur');     // il tipo dal registro (types/gears/<tipo>)
  const gTeeth = g => g.z !== undefined ? g.z : (g.z = g.def.teeth !== undefined ? ev(g.def.teeth) : (gImpl(g) && gImpl(g).defaultTeeth ? gImpl(g).defaultTeeth(g, ev) : 0));
  const gModule = g => g.m !== undefined ? g.m : (g.m = g.def.module !== undefined ? ev(g.def.module) : 0);
  const gRadius = g => {
    if (g.def.r !== undefined) return ev(g.def.r);
    const im = gImpl(g);
    if (im && im.radius) return im.radius(g, { ev, teeth: gTeeth, module: gModule });
    return gTeeth(g) * gModule(g) / 2;
  };
  const gAnchor = g => { const im = gImpl(g); return im && im.anchorOffset ? im.anchorOffset(g, { vec }) : 0; };   // spostamento assiale del punto d'interasse (vite)

  ev = M.ev = makeEvaluator(M, state, resolving, gTeeth, gModule, gRadius);
  const vec = arr => arr.map(e => ev(e));

  // ---- 1. registrazione di assi e ingranaggi attivi
  const skippedA = [], skippedG = [];
  for (const def of MACHINE.axes) {
    if (isActive(def)) { const a = { id: def.id, def, idx: M.axes.length, O: null, theta: 0 }; M.axes.push(a); M.axisBy[a.id] = a; }
    else skippedA.push(def.id);
  }
  for (const def of MACHINE.gears) {
    if (isActive(def)) { const g = { id: def.id, def, label: def.label || def.id }; M.gears.push(g); M.gearBy[g.id] = g; }
    else skippedG.push(def.id);
  }
  step('assi', `${M.axes.length} assi attivi: ${M.axes.map(a => a.id).join(', ')}` + (skippedA.length ? `  (saltati per variante: ${skippedA.join(', ')})` : ''));
  step('ingranaggi', `${M.gears.length} ingranaggi attivi: ${M.gears.map(g => g.id).join(', ')}` + (skippedG.length ? `  (saltati per variante: ${skippedG.join(', ')})` : ''));

  // ---- 2. costanti
  for (const name in MACHINE.consts) {
    CTX.where = `costante "${name}"`;
    try {
      const v = ev(name);
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`la costante "${name}" vale ${v} (espressione: ${JSON.stringify(MACHINE.consts[name])})`);
      step('costante', `${name} = ${typeof v === 'number' ? +v.toFixed(4) : v}`);
    } catch (e) {
      if (e instanceof NotPlaced) warn('costante', `"${name}" dipende dall'asse "${e.message}", non ancora posizionato: verrà valutata più tardi`);
      else if (/non finit|vale (NaN|Infinity|-Infinity)/.test(e.message)) throw e;
      else warn('costante', `"${name}" non valutabile: ${e.message}`);
    }
  }

  // ---- 3. direzioni degli assi
  for (const a of M.axes) {
    CTX.where = `asse "${a.id}", campi dir/view/ref`;
try {
  a.dir = V.unit(vec(a.def.dir));
  if (!a.dir.every(Number.isFinite) || V.len(a.dir) < 1e-9) throw new Error('dir non valida');
} catch (e) {
  if (e instanceof NotPlaced) { a.dir = [0,0,1]; a.cw = 1; a.deferredDir = true; }
  else throw e;
}
    a.view = V.unit(vec(a.def.view || [0, -1, 0]));
    a.cw = -Math.sign(V.dot(a.view, a.dir)) || 1;
    // carrier può essere asse o gear libero (gestito dopo per gear)
    if (a.def.carrier) {
      if (M.axisBy[a.def.carrier]) a.carrier = M.axisBy[a.def.carrier];
      else if (M.gearBy[a.def.carrier]) { a.carrier = null; a._carrierGearId = a.def.carrier; }
      else a.carrier = null;
    } else a.carrier = null;
    a.ref = a.def.ref ? V.unit(V.perp(vec(a.def.ref), a.dir)) : null;
    step('asse', `${a.id} "${a.def.name}": dir=${fmtV(a.dir)}, visto ${a.def.viewLabel || 'da davanti'}` + (a.carrier ? `, portato da ${a.carrier.id}` : ''));
  }
  Registry.run('prepareAxes', M);          // i link possono fissare i riferimenti degli assi prima del default (es. snodo di Hooke)
  for (const a of M.axes) { a.ref = a.ref || V.anyPerp(a.dir); a.yv = V.cross(a.dir, a.ref); }

  // ---- 4. posizionamento degli assi (iterativo: un asse può dipendere da un altro non ancora posizionato)
  const originOf = a => {
    const p = a.def.place;
    if (p.at) return vec(p.at);
    if (p.coaxial) { const o = M.axisBy[p.coaxial]; if (!o.O) throw new NotPlaced(p.coaxial); return o.O.slice(); }
    if (p.offset) { const o = M.axisBy[p.offset.from]; if (!o.O) throw new NotPlaced(p.offset.from); return V.add(o.O, vec(p.offset.by)); }
    if (p.byMesh) {
      const g = M.gearBy[p.byMesh], q = M.gearBy[meshId(g.def)], qa = M.axisBy[q.def.axis];
      if (!qa.O) throw new NotPlaced(q.def.axis);
      let o = V.add(qa.O, V.mul(V.unit(vec(p.dir)), gRadius(g) + gRadius(q)));
      if (gAnchor(q)) o = V.add(o, V.mul(qa.dir, gAnchor(q)));          // es. vite senza fine: interasse misurato a metà lunghezza
      if (gAnchor(g)) o = V.sub(o, V.mul(a.dir, gAnchor(g)));
      return o;
    }
    if (p.byApex) {
      const g = M.gearBy[p.byApex], ga = M.axisBy[g.def.axis];
      if (!ga.O) throw new NotPlaced(g.def.axis);
      return V.add(ga.O, V.mul(ga.dir, ev(g.def.apexW)));
    }
    throw new Error('Posizionamento mancante per l\'asse ' + a.id);
  };
  const waiting = {};
  for (let pass = 0, left = M.axes.length; left > 0 && pass < 50; pass++) {
    let progress = false;
    for (const a of M.axes) if (!a.O) {
      CTX.where = `posizionamento dell'asse "${a.id}" (${describePlace(M, a.def.place)})`;
      try {
        a.O = originOf(a); left--; progress = true; delete waiting[a.id];
        step('asse', `${a.id}: posizionato in ${fmtV(a.O)}  ← ${describePlace(M, a.def.place)}`);
      } catch (e) { if (!(e instanceof NotPlaced)) throw e; waiting[a.id] = e.message; }
    }
    if (!progress) break;
  }
  const unplaced = M.axes.filter(a => !a.O);
  if (unplaced.length) {
    for (const a of unplaced) fail('posizionamento', `asse "${a.id}": non posizionabile, attende l'asse "${waiting[a.id]}" che a sua volta non è posizionabile (dipendenza circolare o catena di riferimenti interrotta)`);
    throw new Error('Assi non posizionabili: ' + unplaced.map(a => a.id).join(', '));
  }

  // ---- 5. rotazioni di gruppo (rotate)
  for (const a of M.axes) for (const rot of [].concat(a.def.rotate || [])) {
    CTX.where = `rotate dell'asse "${a.id}"`;
    const self = rot.around === 'self', ar = self ? a : M.axisBy[rot.around];


    if (!ar) throw new Error('rotate.around sconosciuto: ' + rot.around);
    const group = dependentsOf(M, a);
    if (!self && group.has(ar)) throw new Error(`rotate: l'asse ${ar.id} dipende da ${a.id}, non si può ruotare ${a.id} attorno ad esso`);
    const deg = ev(rot.deg), phi = deg * PI / 180 * ar.cw, k = ar.dir, P = ar.O.slice();
    for (const b of group) {
      b.O = V.add(P, rotateVec(V.sub(b.O, P), k, phi));
      b.dir = rotateVec(b.dir, k, phi); b.ref = rotateVec(b.ref, k, phi); b.view = rotateVec(b.view, k, phi);
      b.yv = V.cross(b.dir, b.ref);
    }
    step('rotazione', `${a.id}: ${+deg.toFixed(2)}° attorno a ${self ? 'se stesso' : ar.id}; trascina: ${[...group].map(b => b.id).join(', ')}`);

for (const x of self ? [a] : [ar, a]) {
  const pa = x.def.place.at;
  if (!pa || !pa.some(e => typeof e === 'string' && /axes\s*[.\[]/.test(e))) continue;
  const dlt = V.sub(vec(pa), x.O);
  if (V.len(dlt) > 1e-12)
    for (const b of dependentsOf(M, x)) b.O = V.add(b.O, dlt);
}

  }

  // ---- 5b. cinematica dei corpi: velocità angolare assoluta e velocità dell'origine di ogni asse
  CTX.where = 'cinematica dei corpi';
  buildKinematics(M);
  for (const a of M.axes) if (a.carrier) {
    const par = Math.abs(V.dot(a.dir, a.carrier.dir));
    step('carrier', `${a.id} portato da ${a.carrier.id}: ` + (par > 1 - 1e-9 ? 'asse parallelo al carrier' : par < 1e-9 ? 'asse PERPENDICOLARE al carrier' : `asse inclinato (cos=${par.toFixed(3)})`) + (a.soft ? ' · a riposo: solidale al carrier' : ''));
  }

// ---- 5c. ri-valutazione dei place.at che dipendono da altri assi
for (const a of M.axes) {
  const p = a.def.place;
  if (!p.at) continue;
  if (!p.at.some(e => typeof e === 'string' && /axes\s*[.\[]/.test(e))) continue;
  CTX.where = `ri-posizionamento di "${a.id}" dopo le rotazioni`;
  a.O = vec(p.at);
}

// ---- 5d. ri-valutazione iterativa delle dir che dipendono da altri assi
let changed = true, guard = 0;
while (changed && guard++ < 10) {
  changed = false;
  for (const a of M.axes) {
    const d = a.def.dir;
    if (!Array.isArray(d) || !d.some(e => typeof e === 'string' && /\baxes\b/.test(e))) continue;
    CTX.where = `ri-orientamento di "${a.id}"`;
    const nd = V.unit(vec(d));
    if (Math.abs(nd[0]-a.dir[0])+Math.abs(nd[1]-a.dir[1])+Math.abs(nd[2]-a.dir[2]) > 1e-9) {
      a.dir = nd; changed = true;
    }
    if (Array.isArray(a.def.ref) && a.def.ref.some(e => typeof e === 'string' && /\baxes\b/.test(e))) {
      a.ref = V.unit(V.perp(vec(a.def.ref), a.dir));
    }
    a.cw = -Math.sign(V.dot(a.view, a.dir)) || 1;
    a.yv = V.cross(a.dir, a.ref);
  }
}

// ---- 5d-bis. Assi con "forceDir": direzione imposta dopo tutte le rotazioni
for (const a of M.axes) if (a.def.forceDir) {
  CTX.where = `forceDir dell'asse "${a.id}"`;
  a.dir = V.unit(vec(a.def.forceDir));
  let ref = V.perp(a.ref, a.dir);
  if (V.len(ref) < 1e-9) ref = V.anyPerp(a.dir);
  a.ref = V.unit(ref);
  a.yv = V.cross(a.dir, a.ref);
  a.cw = -Math.sign(V.dot(a.view, a.dir)) || 1;
  step('forceDir', `${a.id}: direzione imposta a ${fmtV(a.dir)}`);
}
CTX.where = '';

  // ---- 5e. assi con "through" (dopo tutte le rotazioni)
  initThrough(M, ev);
  initSpins(M);
  initSpinAlign(M);


  // ---- 6. ingranaggi
  for (const g of M.gears) {
    CTX.where = `ingranaggio "${g.id}"`;
    g.ax = M.axisBy[g.def.axis];
    if (!g.ax) throw new Error('Asse mancante per l\'ingranaggio ' + g.id);
    g.type = g.def.type || 'spur';
    g.z = gTeeth(g); g.m = gModule(g); g.r = gRadius(g);
    if (![g.z, g.m, g.r].every(Number.isFinite)) throw new Error(`ingranaggio "${g.id}": valori non validi z=${g.z} m=${g.m} r=${g.r}`);
    g.side = g.def.side || 1;
    g.w = g.def.w ? vec(g.def.w) : null;
    const impl = gImpl(g);
    const extra = impl && impl.resolve ? (impl.resolve(g, { ev, vec }) || '') : '';       // parametri specifici del tipo
    step('ingranaggio', `${g.id} [${g.type}] "${g.def.name}" su ${g.ax.id}: z=${g.z}, m=${+g.m.toFixed(5)}, r=${+g.r.toFixed(3)}` + (g.w ? `, w=[${g.w.map(x => +x.toFixed(2)).join(', ')}]` : '') + extra);
  }

  // ---- 6b. gestione ingranaggi liberi/vincolati sull'asse (nuova funzionalità) ----
  // Retrocompatibilità: se non specificato, fixed=true (vincolato)
  function gearIsFixed(def) {
    if (def.free !== undefined) return !def.free;
    if (def.fixed !== undefined) return !!def.fixed;
    if (def.fixedToAxis !== undefined) return !!def.fixedToAxis;
    if (def.bound !== undefined) return !!def.bound;
    if (def.vincolato !== undefined) return !!def.vincolato;
    if (def.isFixed !== undefined) return !!def.isFixed;
    return true; // default: vincolato all'asse
  }

  // --- supporto per assi il cui carrier è un gear libero (es. satellite portato da gear libero) ---
  // Risolviamo eventuali carrier che puntano a gear id (verrà risolto dopo creazione assi virtuali)
  // Per ora lasciamo a.carrier come da definizione asse, ma salviamo _carrierGearId se punta a gear
  for (const a of M.axes) {
    if (a.def.carrier && M.gearBy[a.def.carrier] && !M.axisBy[a.def.carrier]) {
      a._carrierGearId = a.def.carrier;
      // temporaneamente nessun carrier, verrà risolto dopo
      a.carrier = null;
    }
  }

  // Raggruppa gear liberi che devono essere solidali tra loro
  const freeGears = M.gears.filter(g => !gearIsFixed(g.def));
  const parent = {};
  freeGears.forEach(g => parent[g.id] = g.id);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a,b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  // Unione per solidalWith / coupledTo / sameAs / solidaleCon
  for (const g of freeGears) {
    const refs = [];
    const single = g.def.solidalWith || g.def.coupledTo || g.def.sameAs || g.def.solidaleCon || g.def.solidal || g.def.sharedWith || g.def.solidalTo || g.def.bindTo;
    if (single) {
      if (Array.isArray(single)) refs.push(...single);
      else refs.push(single);
    }
    // supporta anche array in solidalWith
    for (const ref of refs) {
      if (typeof ref === 'string' && M.gearBy[ref]) {
        const other = M.gearBy[ref];
        if (freeGears.includes(other)) union(g.id, other.id);
      }
    }
  }

  // Unione per freeGroup / solidalGroup con stesso host
  const groups = {};
  for (const g of freeGears) {
    const fg = g.def.freeGroup || g.def.groupFree || g.def.solidalGroup || g.def.freeAxisGroup;
    if (!fg) continue;
    const hostId = g.ax.id; // host originale
    const key = hostId + "|" + fg;
    if (!groups[key]) groups[key] = [];
    groups[key].push(g.id);
  }
  for (const key in groups) {
    const ids = groups[key];
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Crea un asse virtuale per ogni gruppo di gear liberi solidali
  const virtualByRoot = {};
  for (const g of freeGears) {
    const root = find(g.id);
    if (!virtualByRoot[root]) {
      // usa il primo gear del gruppo come rappresentante per O, dir, carrier
      const rep = M.gearBy[root] || g;
      const host = rep.ax; // host originale
      let vId = "freeGroup_" + root + "__freeAx";
      // per rendere id più leggibile se freeGroup presente
      const fg = rep.def.freeGroup || rep.def.solidalGroup;
      if (fg) vId = "free_" + fg + "__freeAx";
      let uid = vId;
      let cnt = 0;
      while (M.axisBy[uid]) { cnt++; uid = vId + "_" + cnt; }
      const vAx = {
        id: uid,
        def: { id: uid, name: "Asse libero gruppo " + root, group: host.def.group, color: host.def.color },   // il colore serve ai gear liberi senza "color" proprio
        idx: M.axes.length,
        O: host.O.slice(),
        dir: host.dir.slice(),
        ref: host.ref.slice(),
        yv: host.yv.slice(),
        view: host.view.slice(),
        cw: host.cw,
        carrier: host.carrier,
        theta: 0,
        isFreeGearAxis: true,
        hostAxisId: host.id,
        gearId: rep.id,
        freeGroupRoot: root
      };
      M.axes.push(vAx);
      M.axisBy[uid] = vAx;
      virtualByRoot[root] = vAx;
      step('ingranaggio', `Gruppo libero ${root} (${Object.keys(groups).find(k=>k.includes(root))||'singolo'}): creato asse virtuale ${uid} da host ${host.id}`);
    }
  }

  // Assegna a ogni gear libero il suo asse virtuale di gruppo
  for (const g of M.gears) {
    CTX.where = `ingranaggio "${g.id}" vincolo asse`;
    const isFixed = gearIsFixed(g.def);
    g.fixed = isFixed;
    g.isFree = !isFixed;
    if (!isFixed) {
      const root = find(g.id);
      const vAx = virtualByRoot[root];
      const host = g.ax; // host originale prima di sovrascrivere
      g.hostAx = host;
      g.ax = vAx;
      step('ingranaggio', `${g.id}: libero sull'asse ${host.id} -> usa asse virtuale ${vAx.id} (carrier=${vAx.carrier ? vAx.carrier.id : 'mondo'})${g.def.freeGroup ? ' [freeGroup='+g.def.freeGroup+']' : ''}${g.def.solidalWith ? ' [solidalWith='+g.def.solidalWith+']' : ''}`);
    } else {
      g.hostAx = g.ax;
      step('ingranaggio', `${g.id}: vincolato all'asse ${g.ax.id} (default retrocompatibile)`);
    }
  }

  // Risolvi carrier che erano gear id (es. satellite portato da gear libero)
  for (const a of M.axes) {
    if (a._carrierGearId) {
      const gear = M.gearBy[a._carrierGearId];
      if (gear && gear.ax) {
        a.carrier = gear.ax;
        step('asse', `${a.id}: carrier era gear ${a._carrierGearId} -> ora asse virtuale ${gear.ax.id}`);
      } else {
        warn('asse', `${a.id}: carrier gear ${a._carrierGearId} non trovato o non libero`);
      }
      delete a._carrierGearId;
    }
  }

  // ricalcola cinematica includendo gli assi virtuali per i gear liberi
  if (M.axes.some(a => a.isFreeGearAxis)) {
    buildKinematics(M);
    step('cinematica', `ricalcolata con ${M.axes.filter(a=>a.isFreeGearAxis).length} assi virtuali per ingranaggi liberi (gruppi: ${Object.keys(virtualByRoot).length})`);
  }

  // ---- 7. coppie di ingranaggi (ogni coppia una sola volta, anche se dichiarata da entrambi i lati)
  const seenPairs = new Set();
  for (const g of M.gears) if (meshId(g.def)) {
    const p = M.gearBy[meshId(g.def)];
    if (!p) throw new Error('meshWith sconosciuto: ' + meshId(g.def));
    const key = [g.id, p.id].sort().join('|');
    if (seenPairs.has(key)) { step('coppia', `${g.id} ⇄ ${p.id}: dichiarata due volte, ignoro il doppione`); continue; }
    seenPairs.add(key);
    g.partner = p; g.role = 'gap';
    if (!p.partner) { p.partner = g; p.role = 'tooth'; }
    M.pairs.push({ g, p });
    step('coppia', `${g.id} → ${p.id}`);
  }
  for (const g of M.gears) {                     // parametri che dipendono dall'ingranaggio accoppiato (es. delta dei conici, fascia della ruota per vite)
    const impl = gImpl(g);
    if (impl && impl.afterPairs) { CTX.where = `${g.type} "${g.id}"`; impl.afterPairs(g, { ev, vec }); }
  }
  for (const { g, p } of M.pairs) {
    CTX.where = `contatto ${g.id} ⇄ ${p.id}`;
    const c = contactGeometry(g, p);
    g.cdir = c.cg; p.cdir = c.cp;
    M.meshes.push({ g, p, X: c.X });
  }
  for (const g of M.gears) {
    g.rho = 0;
    if (g.cdir) {
      const phi = Math.atan2(V.dot(g.cdir, V.mul(g.ax.yv, g.side)), V.dot(g.cdir, g.ax.ref));
      const im = gImpl(g);
      g.rho = phi + (g.role === 'gap' && !(im && im.toothPhase === false) ? PI / g.z : 0);
      const ang = g.def.angle!==undefined ? ev(g.def.angle) : (g.def.phase!==undefined ? ev(g.def.phase) : 0);
      if(ang) g.rho += ang * PI/180;      
    }
  }



  // ---- 7b. link: ogni tipo risolve i propri elementi (pin_slot, geneva, nottolino, freno, fune, snodo, binario...)
  Registry.run('resolve', M, { ev, vec });

  // ---- 8. equazioni cinematiche degli ingranamenti
// ---- 8. equazioni cinematiche degli ingranamenti
  // Condizione: nel punto di contatto X le velocità (assolute) dei due corpi hanno la stessa componente tangenziale.
  // Con la composizione corretta delle velocità angolari (sezione 3b) l'equazione vale in qualunque sistema di riferimento,
  // quindi non servono riferimenti "relativeTo": il moto del carrier è già incluso, anche per assi perpendicolari al carrier.
  const n = M.axes.length;
  for (const m of M.meshes) {
    m.frame = commonFrame(m.g.ax, m.p.ax);
    m.g.meshInfo = { partner: m.p, frame: m.frame };
    m.p.meshInfo = { partner: m.g, frame: m.frame };
    step('cinematica', `${m.g.id} ⇄ ${m.p.id}: rapporto denti ${m.g.z}:${m.p.z}, riferimento del rapporto: ${m.frame ? m.frame.id : 'mondo'}`);
    const gim = gImpl(m.g), special = gim && gim.meshRow ? gim.meshRow(m, n) : null;   // il tipo può avere una propria equazione di presa
    if (special) { m.row = special; continue; }
    m.row = new Array(n).fill(0);
    const t = V.unit(V.cross(m.g.ax.dir, V.sub(m.X, m.g.ax.O)));
    const vg = pointVel(m.g.ax, m.X), vp = pointVel(m.p.ax, m.X);
    for (const k in vg) m.row[k] += V.dot(t, vg[k]);
    for (const k in vp) m.row[k] -= V.dot(t, vp[k]);
  }
  step('cinematica', `${M.meshes.length} equazioni di ingranamento su ${n} assi`);

  // ---- 9. input (i link sono già stati risolti al punto 7b)
  for (const def of MACHINE.inputs) if (isActive(def)) { M.inputs.push({ def, id: def.id, idx: M.axisBy[def.axis].idx }); step('input', `${def.id}: asse ${def.axis}`); }
  // ---- 10. foro centrale degli ingranaggi (libero → circolare con gioco, solidale → "a D")
  for (const g of M.gears) g.bore = computeBore(g, ev);
  const nb = M.gears.filter(g => g.bore);
  if (nb.length) step('foro', `${nb.length} ingranaggi con foro (${nb.filter(g => g.bore.free).length} liberi, ${nb.filter(g => !g.bore.free).length} solidali con l'asse)`);
  CTX.where = '';
  return M;
}

/* Foro centrale di un ingranaggio, per l'asse su cui sta:
     · libero sull'asse ("free": true): foro circolare di raggio 1,05 × il raggio dell'asse (gioco per farlo girare);
     · solidale con l'asse (default): foro con un lato piano ("a D") di raggio uguale a quello dell'asse, per bloccarlo con la stampa 3D.
   Raggio dell'asse = il maggiore fra le parti "cylinder" dell'asse (quello ospite, se il gear è libero) centrate sull'asse che attraversano
   lo spessore del gear; se nessuna lo attraversa, il maggiore in assoluto; se l'asse non ha parti cilindriche non c'è foro.
   Nel gear:  "bore": raggio del foro (sostituisce quello calcolato) oppure false (nessun foro);
              "flat": distanza del lato piano dal centro in frazione del raggio (default 0,8; false = foro circolare);
              "flatAngle": direzione del lato piano nel riferimento dell'asse, in gradi (default 0: uguale per tutti i gear dello stesso asse). */
function computeBore(g, ev) {
  const d = g.def;
  if (d.bore === false) return null;
  const fixed = g.fixed !== false;
  let r = null;
  if (d.bore !== undefined) r = ev(d.bore);
  else {
    const cyl = [];
    for (const p of ((g.hostAx || g.ax).def.parts || [])) {
      if (!isActive(p) || p.shape !== 'cylinder' || p.r === undefined || !Array.isArray(p.w)) continue;
      const at = p.at ? p.at.map(e => ev(e)) : [0, 0];
      if (Math.hypot(at[0], at[1]) > 1e-6) continue;                 // parti fuori asse (perni...): non sono l'albero
      const w = p.w.map(e => ev(e));
      cyl.push({ r: ev(p.r), w0: Math.min(w[0], w[1]), w1: Math.max(w[0], w[1]) });
    }
    if (cyl.length) {
      let sel = cyl;
      if (g.w) {
        const a = Math.min(g.w[0], g.w[1]), b = Math.max(g.w[0], g.w[1]), hit = cyl.filter(c => c.w1 > a && c.w0 < b);
        if (hit.length) sel = hit;
      }
      r = Math.max(...sel.map(c => c.r));
      if (!fixed) r *= 1.05;
    }
  }
  if (!(r > 0)) return null;
  let flat = null;
  if (fixed && d.flat !== false) { flat = d.flat !== undefined ? ev(d.flat) : 0.8; if (!(flat > 0 && flat < 1)) flat = null; }
  return { r, flat, ang: (d.flatAngle !== undefined ? ev(d.flatAngle) : 0) * PI / 180, n: 48, free: !fixed };
}

/* Verifica del modello risolto: valori non finiti, assi isolati. Lancia un errore se qualcosa renderebbe la scena inutilizzabile. */
function validateModel(M) {
  let bad = 0;
  const B = (m, ...r) => { bad++; fail('verifica', m, ...r); };
  for (const a of M.axes) if (![...a.O, ...a.dir, ...a.ref].every(Number.isFinite)) B(`asse ${a.id}: origine/direzione/riferimento non finiti`, a.O, a.dir, a.ref);
  for (const g of M.gears) {
    const impl = Registry.get('gear', g.type);
    if (!(impl && impl.noRadiusCheck) && !(g.r > 0)) B(`ingranaggio ${g.id}: raggio non valido (${g.r})`);
    if (impl && impl.validateModel) impl.validateModel(g, B);              // controlli del modello risolto, specifici del tipo
    if (g.w && !g.w.every(Number.isFinite)) B(`ingranaggio ${g.id}: w non valido`, g.w);
    if (impl && impl.minTeeth && !(g.z >= impl.minTeeth)) B(`ingranaggio ${g.id}: numero di denti non valido (${g.z})`);
  }
  for (const m of M.meshes) if (!m.row.every(Number.isFinite)) B(`ingranamento ${m.g.id}⇄${m.p.id}: coefficienti cinematici non finiti`, m.row);

  const linked = new Set();
  for (const m of M.meshes) { linked.add(m.g.ax); linked.add(m.p.ax); }
  for (const a of Registry.collect('linkedAxes', M)) linked.add(a);        // assi che i link collegano al resto (nottolino, snodo...)
  for (const a of M.axes) if (a.carrier) { linked.add(a); linked.add(a.carrier); }
  for (const a of M.axes) if (!linked.has(a) && !a.aimed && !a.def.static) warn('verifica', `asse ${a.id}: nessun ingranamento, nottolino, snodo o portasatelliti lo collega al resto (${M.gears.filter(g => g.ax === a).length} ingranaggi): girerà solo se pilotato direttamente`);

  if (DBG.on) {
    console.groupCollapsed('[verifica] riepilogo assi e ingranaggi (clic per aprire)');
    console.table(M.axes.map(a => ({ asse: a.id, origine: fmtV(a.O), dir: fmtV(a.dir), portato_da: a.carrier ? a.carrier.id : '', a_riposo: a.soft ? 'solidale al carrier' : '', gruppo: a.def.group || '' })));
    console.table(M.gears.map(g => ({ id: g.id, tipo: g.type, asse: g.ax.id, denti: g.z, modulo: +g.m.toFixed(4), raggio: +g.r.toFixed(3), delta_gradi: g.delta !== undefined ? +(g.delta * 180 / PI).toFixed(2) : '', in_presa_con: g.partner ? g.partner.id : '' })));
    console.groupEnd();
  }
  if (bad) throw new Error(`${bad} problema/i nel modello risolto (vedi console)`);
  step('verifica', `modello risolto valido: ${M.axes.length} assi, ${M.gears.length} ingranaggi, ${M.meshes.length} ingranamenti`);
}
