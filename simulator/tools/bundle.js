#!/usr/bin/env node
/* Unisce nucleo + TUTTI i tipi trovati in types/ in un unico file, dist/simulatore.js.
   Serve per pubblicare un file solo (o per darlo in pasto a un assistente): in quel caso non c'è nessun caricamento dinamico.
   I tipi si scoprono da soli scandendo le cartelle: aggiungere un tipo e rilanciare questo script basta.
   Uso:  node tools/bundle.js        (le cartelle che iniziano per "_" sono ignorate) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'), js = path.join(root, 'js');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(js, 'manifest.js'), 'utf8'), ctx);
const core = ctx.SIM_CORE, main = core[core.length - 1], rest = core.slice(0, -1);

const types = [];
for (const [fam, files] of [['gears', ['create.js', 'solve.js']], ['links', ['create.js', 'solve.js']], ['parts', ['create.js']]]) {
  const dir = path.join(js, 'types', fam);
  if (!fs.existsSync(dir)) continue;
  for (const t of fs.readdirSync(dir).sort()) {
    if (t.startsWith('_') || !fs.statSync(path.join(dir, t)).isDirectory()) continue;
    for (const f of files) {
      const p = path.join('types', fam, t, f);
      if (!fs.existsSync(path.join(js, p))) throw new Error(`manca ${p}`);
      types.push(p);
    }
  }
}

const parts = [...rest, ...types, main];
const out = parts.map(p => `/* >>>>> ${p.replace(/\\/g, '/')} */\n` + fs.readFileSync(path.join(js, p), 'utf8')).join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'simulatore.js'), `/* BUNDLE generato da tools/bundle.js: ${parts.length} file. Non modificare: si rigenera. */\n` + out);
console.log(`dist/simulatore.js: ${rest.length} file di nucleo + ${types.length} file di tipi (${types.length ? [...new Set(types.map(t => t.split(path.sep)[2]))].join(', ') : '-'})`);
