// Uso: node run.js <orig|new> <out.json>   (orig = script originale, ORIG_SCRIPT=percorso; new = js/loader.js o NEW_ENTRY=dist/simulatore.js)
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const mode = process.argv[2], outFile = process.argv[3];
const APP = mode === 'orig' ? path.resolve(process.env.ORIG_SCRIPT || path.join(__dirname, 'script_2.js')) : path.resolve(process.env.NEW_ENTRY || path.join(__dirname, '..', 'js', 'loader.js'));
let html = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8').replace('src="machine.js"', `src="${process.env.MACHINE_FILE||'machine.js'}"`).replace('<script id="app"></script>', `<script src="file://${APP}"></script>`);
const dom = new JSDOM(html, { url: 'file://' + path.join(__dirname, 'page.html'), runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
const w = dom.window, ev = c => w.eval(c);
const errors = [];
w.addEventListener('error', e => errors.push('window.error: ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SNAP = `(function(){
  const r = x => typeof x === 'number' ? +x.toPrecision(8) : x, rv = v => v && v.map ? v.map(r) : v;
  const sum = m => { const p = m.getVerticesData('position') || []; let s = 0, a = 0; for (const x of p) { s += x; a += Math.abs(x); } return [p.length, r(s), r(a)]; };
  const o = {};
  o.axes = M.axes.map(a => ({ id:a.id, O:rv(a.O), dir:rv(a.dir), ref:rv(a.ref), theta:r(a.theta), carrier:a.carrier&&a.carrier.id, cw:a.cw, aimed:!!a.aimed, virt:!!a.isFreeGearAxis,
      pos: a.node && rv(a.node.position.asArray()), q: a.node && a.node.rotationQuaternion && rv(a.node.rotationQuaternion.asArray()) }));
  o.gears = M.gears.map(g => ({ id:g.id, type:g.type, z:g.z, m:r(g.m), r:r(g.r), rho:r(g.rho), delta:r(g.delta), apexW:r(g.apexW), side:g.side, w:rv(g.w), axis:g.ax.id, host:g.hostAx&&g.hostAx.id,
      partner:g.partner&&g.partner.id, role:g.role, sprime:g.sprime, cdir:rv(g.cdir), apex:rv(g.apex), geneva:g.geneva,
      wp:g.wp&&Object.fromEntries(Object.entries(g.wp).map(([k,v])=>[k,r(v)])), tris:g.mesh.getTotalIndices()/3, vs:sum(g.mesh),
      marker: g.markerMesh && rv(g.markerMesh.position.asArray()) }));
  o.meshes = M.meshes.map(m => ({ g:m.g.id, p:m.p.id, X:rv(m.X), row:rv(m.row) }));
  o.pinSlots = (M.pinSlots||[]).map(p => ({ g1:p.g1.id, g2:p.g2.id, rPin:r(p.rPin), d:r(p.d), slotAngle:r(p.slotAngle), a0:r(p.initialPinAngle), dx:r(p.dx), dy:r(p.dy) }));
  o.genevas = (M.genevas||[]).map(g => ({ rPin:r(g.rPin), d:r(g.d), R:r(g.R), N:g.N, slotAngle:r(g.slotAngle), a0:r(g.initialPinAngle), tl:r(g.thetaLine), beta:r(g.beta), engaged:g.engaged }));
  o.hookes = (M.hookes||[]).map(h => ({ cb:r(h.cb), sb:r(h.sb), bend:rv(h.bend), cross: h.cross && rv(h.cross.rotationQuaternion.asArray()) }));
  o.ratchets = (M.ratchets||[]).map(x => ({ sign:x.sign, driver:x.driver, driven:x.driven }));
  o.brakes = (M.brakes||[]).map(b => ({ idx:b.idx, pos:rv(b.mesh.position.asArray()) }));
  o.ropes = (M.ropes||[]).map(x => ({ idx:x.idx, top:rv(x.top), len:r(x.rope.scaling.y), wy:r(x.weight.position.y) }));
  o.rails = (M.rails||[]).map(q => ({ a:q.a.id, last: q.last && { b:rv(q.last.b), g:rv(q.last.g), X:rv(q.last.X), t:r(q.last.t), s:r(q.last.s) }, mk: q.marker && rv(q.marker.position.asArray()) }));
  o.through = (M.through||[]).map(t => ({ a:t.a.id, dir:rv(t.dir), ref:rv(t.ref) }));
  const S = solveSpeeds(M);
  o.speeds = rv(S.w); o.locked = [...S.locked].map(x=>x.def.driver+'>'+x.def.driven);
  o.cons = S.cons.map(c => [c.kind, c.label, r(c.b), !!c.independent, !!c.conflict]);
  o.status = document.getElementById('status').textContent;
  o.table = [...document.querySelectorAll('#gearRows tr')].map(tr => tr.textContent.replace(/\\s+/g,' '));
  o.brakesPanel = document.getElementById('brakes').textContent;
  o.ratios = rv(M.ratioVals);
  o.groups = Object.keys(M.groupItems||{}).map(k => [k, M.groupItems[k].length]);
  o.nExtras = M.extras.length; o.nNodes = M.nodes.length; o.nMeshes = M.allMeshes.length;
  return o;
})()`;

(async () => {
  await new Promise(res => w.addEventListener('load', res));
  for (let i = 0; i < 100; i++) { if (ev('typeof M !== "undefined" && M !== null')) break; await sleep(100); }
  await sleep(300);
  if (!ev('typeof M !== "undefined" && M !== null')) { console.log('BOOT FAILED'); console.log(JSON.stringify(ev('LOG.filter(l=>l[0]!=="step")'), null, 1)); process.exit(2); }
  ev('engine.stopRenderLoop(); engine.getDeltaTime = () => 16.6667;');
  const frame = n => ev(`for (let i=0;i<${n};i++) scene.onBeforeRenderObservable.notifyObservers(scene); sinceTable = 1; scene.onBeforeRenderObservable.notifyObservers(scene);`);
  const res = {};
  res.s0 = JSON.parse(JSON.stringify(ev(SNAP)));
  if (process.env.GENERIC) {      // macchina qualunque: tutti gli ingressi in rotazione, freni inseriti, poi rilasciati, poi ogni variante cambiata
    ev(`Object.values(state.inputs).forEach((x, i) => x.rpm = [20, 60, 40, 25, 15, 30, 10, 20, 5][i % 9]); for (const b of (M.brakes || [])) state.brakes[b.def.axis] = true;`);
    frame(1);  res.s1 = JSON.parse(JSON.stringify(ev(SNAP)));
    frame(60); res.s60 = JSON.parse(JSON.stringify(ev(SNAP)));
    frame(140); res.s200 = JSON.parse(JSON.stringify(ev(SNAP)));
    ev(`for (const b of (M.brakes || [])) state.brakes[b.def.axis] = false; Object.values(state.inputs).forEach(x => x.rpm = -x.rpm);`);
    frame(120); res.s320 = JSON.parse(JSON.stringify(ev(SNAP)));
    ev(`for (const [k, v] of Object.entries(MACHINE.variants || {})) { const o = Object.keys(v.options || {}); if (o.length > 1) state.variants[k] = o.find(x => x !== state.variants[k]); } onVariantChange();`);
    frame(5); res.sVarB = JSON.parse(JSON.stringify(ev(SNAP)));
  } else {
  ev(`Object.assign(state.inputs.in_in, {rpm:20}); state.inputs.in_crank.rpm=60; state.inputs.in_k1.rpm=40; state.inputs.in_h1.rpm=25; state.inputs.in_r1.rpm=15; state.inputs.in_w.rpm=30; state.inputs.in_c.rpm=10; state.inputs.in_spin.rpm=20; state.inputs.in_drum.rpm=5; state.brakes.ax_r2=true;`);
    frame(1);  res.s1 = JSON.parse(JSON.stringify(ev(SNAP)));
    frame(60); res.s60 = JSON.parse(JSON.stringify(ev(SNAP)));
    frame(140); res.s200 = JSON.parse(JSON.stringify(ev(SNAP)));
    ev(`state.brakes.ax_r2=false; state.inputs.in_r1.rpm=-15;`);
    frame(120); res.s320 = JSON.parse(JSON.stringify(ev(SNAP)));
    ev(`state.variants.drive='b'; onVariantChange();`);
    frame(5); res.sVarB = JSON.parse(JSON.stringify(ev(SNAP)));
  }
  await Promise.resolve(ev(`applyMachine(JSON.parse(JSON.stringify(DEFAULT_MACHINE)))`));
  frame(5); res.sReload = JSON.parse(JSON.stringify(ev(SNAP)));
  res.log = [...new Set(ev('LOG.filter(l => l[0] !== "step").map(l => l.join(" | "))'))].sort();
  res.errors = errors;
  res.scripts = ev('[...document.querySelectorAll("script[src]")].map(s => s.src.replace(/.*\\/js\\//, ""))');
  fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
  console.log('ok', mode, 'log non-step:', res.log.length, 'errors:', errors.length);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
