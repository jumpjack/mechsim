// Regressione: caricare una macchina con tipi NUOVI mentre il modello precedente è in funzione (render loop attivo).
// Prima della correzione del registro dava "M.ropes is not iterable" (o M.hookes...) e fermava il render loop.
// Uso: node apply-while-running.js <macchina iniziale.js> <macchina da caricare.js>   (es. machine_min.js e la tua macchina)
const { JSDOM } = require('jsdom'); const fs = require('fs'), path = require('path');
const [initial, applyFile] = process.argv.slice(2);
if (!initial || !applyFile) { console.log('uso: node apply-while-running.js <iniziale.js> <da-caricare.js>'); process.exit(1); }
const APP = path.resolve(process.env.NEW_ENTRY || path.join(__dirname, '..', 'js', 'loader.js'));
const html = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8').replace('src="machine.js"', `src="${path.resolve(initial)}"`).replace('<script id="app"></script>', `<script src="file://${APP}"></script>`);
const dom = new JSDOM(html, { url: 'file://' + path.join(__dirname, 'page.html'), runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
const w = dom.window, ev = c => w.eval(c), sleep = ms => new Promise(r => setTimeout(r, ms));
const errori = () => ev('LOG.filter(l => l[0] === "ERROR").map(l => l[1] + ": " + l[2]).join(" || ")') || 'nessuno';
(async () => {
  await new Promise(r => w.addEventListener('load', r));
  await sleep(2000);                                               // il render loop gira
  w.__txt = fs.readFileSync(applyFile, 'utf8');
  ev('window.__r = "in corso"; applyMachine(parseMachineText(window.__txt)).then(() => window.__r = "ok", e => window.__r = "ERRORE: " + e.message)');
  await sleep(4000);
  const ok = ev('window.__r') === 'ok' && errori() === 'nessuno' && ev('engine._activeRenderLoops.length') === 1;
  console.log(ok ? 'OK' : 'FALLITO', '| applyMachine:', ev('window.__r'), '| errori:', errori(), '| render loop attivo:', ev('engine._activeRenderLoops.length') === 1);
  process.exit(ok ? 0 : 1);
})();
