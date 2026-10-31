/* =====================================================================
   core/06-validate.js
   Controllo strutturale del JSON (parte generica; i controlli per tipo stanno in types/<famiglia>/<tipo>/solve.js)
   ===================================================================== */
/* Posizione e spessore di un ingranaggio lungo il proprio asse. Due modi equivalenti:
     "w": [da, a]                       (come prima: le macchine esistenti non cambiano)
     "pos": p, "thickness": t           → w = [p, p + t]  (p = faccia più vicina all'origine dell'asse; t > 0 verso +asse)
   pos e thickness possono essere numeri o espressioni. Il "w" ricavato è una proprietà NON enumerabile del gear (non finisce nel JSON
   esportato) e si ricalcola a ogni controllo; se nel gear c'è anche un "w" esplicito, vale quello. */
const derivedW = new WeakSet();
function normalizeGearGeometry(def, w, E, W) {
  if (def.pos === undefined && def.thickness === undefined) return;
  if (def.w !== undefined && !derivedW.has(def)) { W(`${w}: ci sono sia "w" sia "pos"/"thickness": uso "w"`); return; }
  if (def.pos === undefined || def.thickness === undefined) { E(`${w}: "pos" e "thickness" vanno indicati insieme (in alternativa a "w")`); return; }
  const a = def.pos, t = def.thickness;
  for (const [k, v] of [['pos', a], ['thickness', t]]) if (typeof v !== 'number' && typeof v !== 'string') { E(`${w}: "${k}" deve essere un numero o un'espressione`); return; }
  const wv = typeof a === 'number' && typeof t === 'number' ? (t >= 0 ? [a, a + t] : [a + t, a]) : [String(a), `(${a})+(${t})`];
  Object.defineProperty(def, 'w', { value: wv, enumerable: false, writable: true, configurable: true });
  derivedW.add(def);
}

/* Controllo strutturale del JSON per la variante attiva: riferimenti mancanti, campi obbligatori, tipi non supportati.
   Stampa ogni problema con "fail" (console + riquadro rosso); se ce ne sono, lancia un errore e la costruzione si ferma. */
function validateMachine() {
  const errs = [];
  const E = m => { errs.push(m); fail('json', m); };
  const W = m => warn('json', m);
  const act = l => (l || []).filter(isActive);
  const axes = act(MACHINE.axes), gears = act(MACHINE.gears), links = act(MACHINE.links);
  const axisBy = {}, gearBy = {};
  const isVec = (v, n) => Array.isArray(v) && v.length === n;
  let curW = '';                                         // descrizione dell'elemento che si sta controllando (per ax())
  const ax = (id, what) => { if (!axisBy[id]) E(`${curW}: ${what} "${id}" non esiste o non è attivo`); };
  const partnerOf = {};                                  // id gear -> id del gear che dichiara meshWith verso di lui
  const vctx = { E, W, ax, isVec, axisBy, gearBy, partnerOf };
  step('json', `Controllo del JSON (variante attiva: ${JSON.stringify(state.variants)})`);

  // varianti: chiavi e valori devono esistere
  const checkVariant = (el, what) => {
    if (!el.variant) return;
    for (const k in el.variant) {
      if (!MACHINE.variants[k]) E(`${what}: "variant" usa la chiave sconosciuta "${k}"`);
      else if (!(el.variant[k] in MACHINE.variants[k].options)) E(`${what}: variant ${k}="${el.variant[k]}" non è fra le opzioni (${Object.keys(MACHINE.variants[k].options).join(', ')})`);
    }
  };
  for (const a of MACHINE.axes) { checkVariant(a, `asse "${a.id}"`); (a.parts || []).forEach((p, i) => checkVariant(p, `asse "${a.id}", parte #${i}`)); }
  for (const g of MACHINE.gears) checkVariant(g, `ingranaggio "${g.id}"`);
  for (const l of MACHINE.links) checkVariant(l, `link "${l.type}"`);
  for (const i of MACHINE.inputs) checkVariant(i, `input "${i.id}"`);
  for (const c of MACHINE.checks || []) checkVariant(c, `check "${c.type}"`);

  // id univoci (nella variante attiva)
  for (const a of axes) { if (!a.id) E('c\'è un asse senza "id"'); else if (axisBy[a.id]) E(`asse duplicato nella variante attiva: "${a.id}"`); else axisBy[a.id] = a; }
  for (const g of gears) { if (!g.id) E('c\'è un ingranaggio senza "id"'); else if (gearBy[g.id]) E(`ingranaggio duplicato nella variante attiva: "${g.id}"`); else gearBy[g.id] = g; }

  // assi
  for (const a of axes) {
    const w = `asse "${a.id}"`;
    if (!isVec(a.dir, 3)) E(`${w}: "dir" deve essere un array di 3 elementi`);
    if (a.view !== undefined && !isVec(a.view, 3)) E(`${w}: "view" deve essere un array di 3 elementi`);
    if (a.rest !== undefined && a.rest !== 'carrier' && a.rest !== 'world') E(`${w}: "rest" può essere solo "carrier" o "world"`);
    if (a.rest === 'carrier' && !a.carrier) W(`${w}: "rest":"carrier" senza "carrier": ignorato`);
    if (a.through !== undefined) {
      const okPt = q => (typeof q === 'string' && axisBy[q]) || isVec(q, 3);
      if (!Array.isArray(a.through) || a.through.length !== 2 || !a.through.every(okPt)) E(`${w}: "through" deve essere [P1, P2] con P = id di un asse oppure [x,y,z]`);
      if (a.carrier !== undefined) E(`${w}: un asse con "through" non può avere "carrier" (la sua posa è calcolata ogni frame)`);
    }
    if (a.spinPerpTo !== undefined) {
      const sp = a.spinPerpTo;
      if (!axisBy[sp.axis]) E(`${w}: spinPerpTo.axis "${sp.axis}" non esiste o non è attivo`);
      if (!(axisBy[sp.line] && axisBy[sp.line].through !== undefined)) E(`${w}: spinPerpTo.line deve riferire un asse con "through" (qui: "${sp.line}")`);
    }
    if (a.alignWith !== undefined && !(axisBy[a.alignWith] && axisBy[a.alignWith].through !== undefined)) E(`${w}: "alignWith" deve riferire un asse con "through" (qui: "${a.alignWith}")`);
    if (!a.place) { E(`${w}: manca "place"`); continue; }
    const p = a.place, kinds = ['at', 'coaxial', 'offset', 'byMesh', 'byApex'].filter(k => p[k] !== undefined);
    if (kinds.length !== 1) E(`${w}: "place" deve contenere esattamente una chiave fra at/coaxial/offset/byMesh/byApex (trovate: ${kinds.join(', ') || 'nessuna'})`);
    if (p.at !== undefined && !isVec(p.at, 3)) E(`${w}: place.at deve avere 3 elementi`);
    if (p.coaxial !== undefined && !axisBy[p.coaxial]) E(`${w}: place.coaxial riferisce l'asse "${p.coaxial}" che non esiste o non è attivo`);
    if (p.offset) {
      if (!axisBy[p.offset.from]) E(`${w}: place.offset.from riferisce l'asse "${p.offset.from}" che non esiste o non è attivo`);
      if (!isVec(p.offset.by, 3)) E(`${w}: place.offset.by deve avere 3 elementi`);
    }
    if (p.byMesh !== undefined) {
      const g = gearBy[p.byMesh];
      if (!g) E(`${w}: place.byMesh riferisce l'ingranaggio "${p.byMesh}" che non esiste o non è attivo`);
      else if (!meshId(g)) E(`${w}: place.byMesh="${p.byMesh}" ma quell'ingranaggio non ha "meshWith": impossibile calcolare l'interasse`);
      else if (!gearBy[meshId(g)]) E(`${w}: l'ingranaggio "${p.byMesh}" ha meshWith="${meshId(g)}" che non esiste o non è attivo`);
      if (!isVec(p.dir, 3)) E(`${w}: place.byMesh richiede "dir" con 3 elementi`);
    }
    if (p.byApex !== undefined) {
      const g = gearBy[p.byApex];
      if (!g) E(`${w}: place.byApex riferisce l'ingranaggio "${p.byApex}" che non esiste o non è attivo`);
      else if (g.apexW === undefined) E(`${w}: place.byApex="${p.byApex}" ma quell'ingranaggio non ha "apexW"`);
    }
    if (a.carrier !== undefined && !axisBy[a.carrier]) E(`${w}: carrier "${a.carrier}" non esiste o non è attivo`);
    for (const r of [].concat(a.rotate || [])) {
      if (r.around !== 'self' && !axisBy[r.around]) E(`${w}: rotate.around riferisce l'asse "${r.around}" che non esiste o non è attivo ("self" = attorno a se stesso)`);
      if (r.deg === undefined) E(`${w}: rotate senza "deg"`);
    }
    if (a.group && !(MACHINE.groups || []).some(g => g.id === a.group)) W(`${w}: group "${a.group}" non è definito in "groups"`);
    (a.parts || []).forEach((pt, i) => {
      if (!isActive(pt)) return;
      const pw = `${w}, parte #${i} (${pt.shape})`;
      const pimpl = Registry.get('part', pt.shape);
      if (!pimpl) E(`${pw}: forma sconosciuta (ammesse: ${Registry.names('part').join(', ')})`);
      else if (pimpl.validate) pimpl.validate(pt, pw, vctx);
      if (pt.at !== undefined && !isVec(pt.at, 2)) E(`${pw}: "at" deve avere 2 elementi`);
    });

    if (a.refFrom !== undefined) {
      if (!axisBy[a.refFrom]) E(`${w}: "refFrom" riferisce l'asse "${a.refFrom}" che non esiste o non è attivo`);
      if (a.through === undefined) E(`${w}: "refFrom" ha senso solo su assi con "through"`);
    }

if (a.perpendicularTo && a.perpendicularTo.refFrom !== undefined) {
  const rf = a.perpendicularTo.refFrom;
  const ok = axisBy[rf] && (axisBy[rf].through !== undefined || true);
  if (!axisBy[rf]) E(`${w}: perpendicularTo.refFrom "${rf}" non esiste o non è attivo`);
}

  }

  // ingranaggi
  for (const g of gears) if (meshId(g) && !partnerOf[meshId(g)]) partnerOf[meshId(g)] = g.id;
  for (const g of gears) {
    const w = `ingranaggio "${g.id}"`, type = g.type || 'spur';
    curW = w;
    normalizeGearGeometry(g, w, E, W);                 // "pos"/"thickness" → "w", prima dei controlli del tipo
    if (!g.axis) E(`${w}: manca "axis"`);
    else if (!axisBy[g.axis]) E(`${w}: asse "${g.axis}" non esiste o non è attivo`);

    const impl = Registry.get('gear', type);
    if (!impl) {
      E(`${w}: tipo sconosciuto "${type}" (tipi caricati: ${Registry.names('gear').join(', ')})`);
      continue;
    }

    if (g.meshWith !== undefined) {
      if (meshId(g) === g.id) E(`${w}: meshWith punta a sé stesso`);
      else if (!gearBy[meshId(g)]) E(`${w}: meshWith="${meshId(g)}" non esiste o non è attivo`);
      else {
        const pt = gearBy[meshId(g)].type || 'spur';
        if (!(impl.meshWith || []).includes(pt)) E(`${w} (${type}) in presa con "${meshId(g)}" (${pt}): combinazione non supportata`);
      }
    }
    if (impl.validate) impl.validate(g, w, vctx);        // controlli specifici del tipo (types/gears/<tipo>/solve.js)

    // proprietà comuni a tutti gli ingranaggi: vincolo sull'asse e marker (retrocompatibili)
    if (g.fixed !== undefined && typeof g.fixed !== 'boolean') E(`${w}: "fixed" deve essere boolean`);
    if (g.free !== undefined && typeof g.free !== 'boolean') E(`${w}: "free" deve essere boolean`);
    if (g.fixedToAxis !== undefined && typeof g.fixedToAxis !== 'boolean') E(`${w}: "fixedToAxis" deve essere boolean`);
    if (g.bound !== undefined && typeof g.bound !== 'boolean') E(`${w}: "bound" deve essere boolean`);
    if (g.vincolato !== undefined && typeof g.vincolato !== 'boolean') E(`${w}: "vincolato" deve essere boolean`);
    if (g.marker !== undefined && !(typeof g.marker === 'boolean' || typeof g.marker === 'number' || typeof g.marker === 'object')) E(`${w}: "marker" deve essere boolean, number o object`);
    // foro centrale (vedi computeBore in core/09-resolve.js)
    if (g.bore !== undefined && g.bore !== false && typeof g.bore !== 'number' && typeof g.bore !== 'string') E(`${w}: "bore" deve essere false (nessun foro) oppure il raggio del foro`);
    if (g.flat !== undefined && g.flat !== false && typeof g.flat !== 'number' && typeof g.flat !== 'string') E(`${w}: "flat" deve essere un numero fra 0 e 1 (distanza del lato piano, in frazione del raggio) oppure false`);
    if (g.flatAngle !== undefined && typeof g.flatAngle !== 'number' && typeof g.flatAngle !== 'string') E(`${w}: "flatAngle" deve essere un numero (gradi)`);
  }

  // link
  for (const l of links) {
    const w = `link "${l.type}"`;
    curW = w;
    const impl = Registry.get('link', l.type);
    if (!impl) { E(`link di tipo sconosciuto: "${l.type}" (tipi caricati: ${Registry.names('link').join(', ')})`); continue; }
    if (impl.validate) impl.validate(l, w, vctx);        // controlli specifici del tipo (types/links/<tipo>/solve.js)
  }
  for (const i of act(MACHINE.inputs)) if (!axisBy[i.axis]) E(`input "${i.id}": asse "${i.axis}" non esiste o non è attivo`);
  if (MACHINE.differential) {
    const d = MACHINE.differential;
    if (!axisBy[d.out]) E(`differential.out "${d.out}" non esiste o non è attivo`);
    for (const id of d.ins || []) if (!axisBy[id]) E(`differential.ins "${id}" non esiste o non è attivo`);
  }
  for (const r of MACHINE.ratios || []) { if (!axisBy[r.from]) E(`ratios.from "${r.from}" non esiste o non è attivo`); if (!axisBy[r.to]) E(`ratios.to "${r.to}" non esiste o non è attivo`); }
  for (const v of MACHINE.views || []) if (!v.auto && (!isVec(v.target, 3) || v.radius === undefined)) E(`vista "${v.id}": richiede "auto" oppure "target" (3 elementi) e "radius"`);
  for (const c of act(MACHINE.checks)) if (c.type === 'axisClearsGear') {
    if (!axisBy[c.axis]) E(`check axisClearsGear: asse "${c.axis}" non esiste o non è attivo`);
    if (!gearBy[c.gear]) E(`check axisClearsGear: ingranaggio "${c.gear}" non esiste o non è attivo`);
  }

  if (errs.length) throw new Error(`${errs.length} errore/i nel JSON (variante ${JSON.stringify(state.variants)}): ${errs[0]}${errs.length > 1 ? ` … (+${errs.length - 1}, vedi console)` : ''}`);
  step('json', `JSON ok: ${axes.length} assi, ${gears.length} ingranaggi, ${links.length} link attivi`);
}
