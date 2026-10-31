/* =====================================================================
   core/01-utils.js
   Controlli iniziali, utilità generali, vettori V, NotPlaced
   ===================================================================== */
/*
 * Codice modificato da Meta AI il 20 ottobre 2026
 * 
 * Modifiche apportate:
 * 1. Supporto per ingranaggi vincolati/libere sull'asse:
 *    - Nuove proprietà nel gear: "fixed", "fixedToAxis", "bound", "vincolato", "free"
 *      Se free=true o fixed=false -> ingranaggio libero di ruotare sull'asse.
 *    - Retrocompatibilità: se la proprietà non è specificata, l'ingranaggio è vincolato (fixed=true),
 *      quindi il comportamento esistente non cambia. Prima era necessario aggiungere un asse
 *      concentrico per avere una ruota libera; ora basta impostare free:true nel gear.
 *    - Implementazione: per ogni gear libero viene creato un asse virtuale coassiale
 *      con stesso carrier dell'asse ospite, con indice proprio. La cinematica viene
 *      ricalcolata con buildKinematics() dopo la creazione degli assi virtuali.
 *      g.ax punta all'asse virtuale, g.hostAx conserva l'asse ospite originale.
 * 2. Marker definito nell'ingranaggio stesso, non nel suo asse:
 *    - Ogni ingranaggio ha ora un marker (sfera) creato in buildScene.
 *    - Proprietà gear.marker: true (default 4mm), numero (raggio in mm),
 *      o oggetto {radius, color, at:[x,y,z]}. Se false, nessun marker.
 *    - Retrocompatibile: se marker non specificato, viene creato con default,
 *      soddisfando il requisito "ogni ingranaggio deve avere un marker".
 *    - Il marker è figlio del frame dell'asse (virtuale se libero) e ruota con l'ingranaggio.
 * Data: 2026-10-20
 * Autore modifica: Meta AI (Muse Spark) per conto di Luca Cassioli
 */

if (typeof BABYLON === 'undefined') throw new Error('babylon.js non caricato');
if (typeof MACHINE === 'undefined') throw new Error('MACHINE non definito (errore di sintassi nel blocco MACHINE: guarda gli errori sopra in console)');
const DEFAULT_MACHINE = JSON.parse(JSON.stringify(MACHINE));   // copia della macchina precaricata, per "Macchina predefinita"
step('avvio', `Babylon ${BABYLON.Engine.Version} · MACHINE "${MACHINE.title}": ${MACHINE.axes.length} assi e ${MACHINE.gears.length} ingranaggi definiti (tutte le varianti)`);

/* =====================================================================
   0. STRUTTURA DATI  (tutto ciò che serve per costruire e far girare la macchina)
   ---------------------------------------------------------------------
   Per aggiungere un asse o un ingranaggio basta aggiungere un elemento in "axes" o in "gears".
   Sistema di riferimento del modello: X destra, Y profondità (verso il fondo), Z alto. Millimetri.
   Ovunque un numero è atteso si può scrivere un'espressione tra virgolette (es. "gears.gear_F.pr+4+8"):
     • costanti di "consts" e valori dei cursori di "controls" (per nome)
     • gears[ID].z, gears[ID].m, gears[ID].pr, gears[ID].d  = denti, modulo, raggio primitivo, diametro dell'ingranaggio ID (anche gears.ID.pr)
     • axes[ID].ox, axes[ID].oy, axes[ID].oz = coordinate dell'origine dell'asse ID (dopo il posizionamento) (anche axes.ID.ox)
     • pi, sin, cos, tan, atan, atan2, sqrt, abs, min, max
   Ogni elemento può avere  variant:{nome:valore}  e viene incluso solo se quella variante è attiva.
   Ingranaggi conici senza ingranaggio accoppiato (nessun meshWith): aggiungere  "delta": gradi  (semi-angolo del cono primitivo).
   Asse con  "rest":"carrier": se nulla ne determina la velocità, resta solidale al suo carrier.
*/

/* =====================================================================
   1. UTILITÀ: vettori, valutatore di espressioni, formattazione
   ===================================================================== */
const PI = Math.PI, cos = Math.cos, sin = Math.sin;
const $ = id => document.getElementById(id);
const esc = v => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));  // il JSON può arrivare da un file esterno: niente HTML dai suoi testi

const fmt = (v, d) => v.toLocaleString('it', { maximumFractionDigits: d });
const fmtV = v => '(' + v.map(x => Number.isFinite(x) ? +x.toFixed(2) : x).join(', ') + ')';

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  unit: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  perp: (a, d) => V.sub(a, V.mul(d, V.dot(a, d))),
  anyPerp: d => V.unit(V.cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])),
  toB: a => [a[0], a[2], -a[1]]
};

class NotPlaced extends Error {}
