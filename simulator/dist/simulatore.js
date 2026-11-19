/* BUNDLE generato da tools/bundle.js: 73 file. Non modificare: si rigenera. */
/* >>>>> core/01-utils.js */
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

/* >>>>> core/02-expression.js */
/* =====================================================================
   core/02-expression.js
   Valutatore delle espressioni del JSON (makeEvaluator) e template()
   ===================================================================== */
function makeEvaluator(M, state, resolving, gTeeth, gModule, gRadius) {
  const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2, sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max };
  const cache = {};

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        let str = "";
        while (j < src.length) {
          const c = src[j];
          if (c === "\\" && j + 1 < src.length) {
            const nxt = src[j+1];
            if (nxt === quote || nxt === "\\") { str += nxt; j += 2; continue; }
          }
          if (c === quote) break;
          str += c; j++;
        }
        if (j >= src.length) throw new Error('Stringa non chiusa: ' + src);
        tokens.push({type:'string', value:str});
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && i+1 < src.length && /[0-9]/.test(src[i+1]))) {
        const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
        if (m) {
          tokens.push({type:'number', value:parseFloat(m[0])});
          i += m[0].length;
          continue;
        }
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        tokens.push({type:'identifier', name:src.slice(i,j)});
        i = j;
        continue;
      }
      if (',.+-*/^()[]'.indexOf(ch) >= 0) {
        tokens.push({type:'op', value:ch});
        i++;
        continue;
      }
      throw new Error('Carattere inatteso: ' + ch + ' in ' + src);
    }
    return tokens;
  }

  class Parser {
    constructor(tokens){ this.tokens=tokens; this.pos=0; }
    peek(){ return this.tokens[this.pos]; }
    consume(){ return this.tokens[this.pos++]; }
    parseExpression(){ return this.parseAddSub(); }
    parseAddSub(){
      let left=this.parseMulDiv();
      while (this.peek() && this.peek().type==='op' && (this.peek().value==='+'||this.peek().value==='-')){
        const op=this.consume().value;
        const right=this.parseMulDiv();
        left={type:'bin', op, left, right};
      }
      return left;
    }
    parseMulDiv(){
      let left=this.parseUnary();
      while (this.peek() && this.peek().type==='op' && (this.peek().value==='*'||this.peek().value==='/')){
        const op=this.consume().value;
        const right=this.parseUnary();
        left={type:'bin', op, left, right};
      }
      return left;
    }
    parseUnary(){
      const t=this.peek();
      if (t && t.type==='op' && (t.value==='+'||t.value==='-')){
        const op=this.consume().value;
        const operand=this.parseUnary();
        return {type:'unary', op, operand};
      }
      return this.parsePower();
    }
    parsePower(){
      let left=this.parsePostfix();
      const t=this.peek();
      if (t && t.type==='op' && t.value==='^'){
        this.consume();
        const right=this.parseUnary();
        left={type:'bin', op:'^', left, right};
      }
      return left;
    }
    parsePostfix(){
      let node=this.parsePrimary();
      while (true){
        const t=this.peek();
        if (!t) break;
        if (t.type==='op' && t.value==='.'){
          this.consume();
          const id=this.peek();
          if (!id || id.type!=='identifier') throw new Error('Atteso identificatore dopo .');
          this.consume();
          node={type:'member_dot', base:node, prop:id.name};
        } else if (t.type==='op' && t.value==='['){
          this.consume();
          const key=this.parseExpression();
          const closing=this.peek();
          if (!closing || closing.type!=='op' || closing.value!==']') throw new Error('Atteso ]');
          this.consume();
          node={type:'member_bracket', base:node, key};
        } else break;
      }
      return node;
    }
    parsePrimary(){
      const t=this.peek();
      if (!t) throw new Error('Espressione incompleta');
      if (t.type==='number'){ this.consume(); return {type:'number', value:t.value}; }
      if (t.type==='string'){ this.consume(); return {type:'string', value:t.value}; }
      if (t.type==='identifier'){
        const name=t.name;
        this.consume();
        const nxt=this.peek();
        if (nxt && nxt.type==='op' && nxt.value==='('){
          this.consume();
          const args=[];
          if (!(this.peek() && this.peek().type==='op' && this.peek().value===')')){
            while (true){
              args.push(this.parseExpression());
              const sep=this.peek();
              if (sep && sep.type==='op' && sep.value===','){ this.consume(); continue; }
              break;
            }
          }
          const closing=this.peek();
          if (!closing || closing.type!=='op' || closing.value!==')') throw new Error('Atteso )');
          this.consume();
          return {type:'call', name, args};
        }
        return {type:'identifier', name};
      }
      if (t.type==='op' && t.value==='('){
        this.consume();
        const expr=this.parseExpression();
        const closing=this.peek();
        if (!closing || closing.type!=='op' || closing.value!==')') throw new Error('Atteso )');
        this.consume();
        return expr;
      }
      throw new Error('Token inatteso: '+JSON.stringify(t));
    }
  }

  function parse(src){
    if (cache[src]) return cache[src];
    const tokens=tokenize(src);
    const parser=new Parser(tokens);
    const ast=parser.parseExpression();
    if (parser.pos !== tokens.length) throw new Error('Espressione non completa: ' + src);
    cache[src]=ast;
    return ast;
  }

  function evalNode(node, extra){
    switch(node.type){
      case 'number': return node.value;
      case 'string': return node.value;
      case 'identifier': {
        const name=node.name;
        if (name==='gears') return {__type:'gears_proxy'};
        if (name==='axes') return {__type:'axes_proxy'};
        if (name==='pi') return PI;
        if (extra && name in extra) return extra[name];
        if (name in state.params) return state.params[name];
        if (name in M.constVal) return M.constVal[name];
        if (name in MACHINE.consts){
          if (resolving.has(name)) throw new Error('Costante circolare: '+name);
          resolving.add(name);
          try {
            const v = ev(MACHINE.consts[name], extra);
            M.constVal[name]=v;
            return v;
          } finally { resolving.delete(name); }
        }
        throw new Error('Simbolo sconosciuto: '+name);
      }
      case 'member_dot': {
        const base=evalNode(node.base, extra);
        const prop=node.prop;
        if (base && base.__type==='gears_proxy'){
          const g=M.gearBy[prop];
          if (!g) throw new Error('Ingranaggio sconosciuto (o non attivo in questa variante): '+prop);
          return {__type:'gear', id:prop, ref:g};
        }
        if (base && base.__type==='gear'){
          const g=base.ref;
          if (prop==='z') return gTeeth(g);
          if (prop==='m') return gModule(g);
          if (prop==='pr') return gRadius(g);
          if (prop==='d') return 2*gRadius(g);
          throw new Error('Proprietà ingranaggio sconosciuta: '+prop);
        }
        if (base && base.__type==='axes_proxy'){
          const a=M.axisBy[prop];
          if (!a) throw new Error('Asse sconosciuto (o non attivo in questa variante): '+prop);
          return {__type:'axis', id:prop, ref:a};
        }
        if (base && base.__type==='axis'){
          const a=base.ref;
          if (!a.O) throw new NotPlaced(a.id);
          if (prop==='ox') return a.O[0];
          if (prop==='oy') return a.O[1];
          if (prop==='oz') return a.O[2];
if (prop === 'dx') return a.dir[0];
if (prop === 'dy') return a.dir[1];
if (prop === 'dz') return a.dir[2];
          throw new Error('Proprietà asse sconosciuta: '+prop);
        }
        throw new Error('Accesso . non valido');
      }
      case 'member_bracket': {
        const base=evalNode(node.base, extra);
        let keyVal;
        try { keyVal=evalNode(node.key, extra); }
        catch(e){
          if (node.key.type==='identifier') keyVal=node.key.name;
          else throw e;
        }
        const keyStr = typeof keyVal==='string' ? keyVal : String(keyVal);
        if (base && base.__type==='gears_proxy'){
          const g=M.gearBy[keyStr];
          if (!g) throw new Error('Ingranaggio sconosciuto (o non attivo in questa variante): '+keyStr);
          return {__type:'gear', id:keyStr, ref:g};
        }
        if (base && base.__type==='axes_proxy'){
          const a=M.axisBy[keyStr];
          if (!a) throw new Error('Asse sconosciuto (o non attivo in questa variante): '+keyStr);
          return {__type:'axis', id:keyStr, ref:a};
        }
        if (base && base.__type==='gear'){
          const g=base.ref;
          if (keyStr==='z') return gTeeth(g);
          if (keyStr==='m') return gModule(g);
          if (keyStr==='pr') return gRadius(g);
          if (keyStr==='d') return 2*gRadius(g);
          throw new Error('Proprietà ingranaggio sconosciuta: '+keyStr);
        }
        if (base && base.__type==='axis'){
          const a=base.ref;
          if (!a.O) throw new NotPlaced(a.id);
          if (keyStr==='ox') return a.O[0];
          if (keyStr==='oy') return a.O[1];
          if (keyStr==='oz') return a.O[2];
if (keyStr === 'dx') return a.dir[0];
if (keyStr === 'dy') return a.dir[1];
if (keyStr === 'dz') return a.dir[2];
          throw new Error('Proprietà asse sconosciuta: '+keyStr);
        }
        throw new Error('Accesso [] non valido');
      }
      case 'bin': {
        const l=evalNode(node.left, extra);
        const r=evalNode(node.right, extra);
        switch(node.op){
          case '+': return l+r;
          case '-': return l-r;
          case '*': return l*r;
          case '/': return l/r;
          case '^': return Math.pow(l,r);
          default: throw new Error('Operatore sconosciuto: '+node.op);
        }
      }
      case 'unary': {
        const v=evalNode(node.operand, extra);
        return node.op==='+' ? +v : -v;
      }
      case 'call': {
        const fn=FN[node.name];
        if (!fn) throw new Error('Funzione sconosciuta: '+node.name);
        const args=node.args.map(a=>evalNode(a, extra));
        return fn(...args);
      }
      default: throw new Error('Nodo sconosciuto');
    }
  }

  // Valuta un numero o un'espressione. Gli errori vengono arricchiti con l'espressione e con il contesto (CTX.where).
  function ev(e, extra){
    if (typeof e==='number') return e;
    if (typeof e!=='string') throw new Error('valore non valido (atteso un numero o un\'espressione tra virgolette): ' + JSON.stringify(e) + (CTX.where ? '  [' + CTX.where + ']' : ''));
    try { return evalNode(parse(e), extra); }
    catch (err) {
      if (err instanceof NotPlaced) throw err;
      if (!err.__ctx) { err.message += `  ⟵ espressione "${e}"` + (CTX.where ? `  [${CTX.where}]` : ''); err.__ctx = true; }
      throw err;
    }
  }
  return ev;
}

function template(str, ev, extra) {
  return str.replace(/\{([^{}|]+)(?:\|(\d+))?\}/g, (_, e, d) => fmt(ev(e, extra), d === undefined ? 1 : +d));
}

/* >>>>> core/03-registry.js */
/* =====================================================================
   core/03-registry.js
   REGISTRO DEI TIPI: è l'unico punto in cui il nucleo "conosce" i tipi di oggetti.
   ---------------------------------------------------------------------
   Esistono tre famiglie di tipi, ciascuna in una cartella di types/:

     gear   types/gears/<tipo>/    ingranaggi          ("type" in MACHINE.gears, default "spur")
     link   types/links/<tipo>/    vincoli / link      ("type" in MACHINE.links)
     part   types/parts/<forma>/   parti degli assi    ("shape" in axes[].parts)

   Ogni tipo di gear e di link è fatto da DUE file che registrano lo stesso tipo (le due metà vengono fuse):

     create.js   COME SI CREA   geometria, mesh e oggetti Babylon, controlli dell'interfaccia
     solve.js    COME SI RISOLVE   validazione del JSON, calcolo dei parametri, cinematica, aggiornamento

   Per AGGIUNGERE un tipo basta creare la cartella con i suoi file (vedi types/_template e il README):
   quando una macchina usa "type":"nome", il caricatore carica da solo types/<famiglia>/nome/create.js e solve.js.
   Il nucleo non va toccato e nessun elenco va aggiornato.

   ---- fasi (hook) dei link ----------------------------------------------------------------------------
   Un link può definire le funzioni qui sotto (tutte facoltative). Quelle "a collezione" ricevono M e lavorano sui
   propri elementi M[collection]; l'ordine fra tipi diversi nella stessa fase è dato da  order: { fase: numero }.

     collection                 nome dell'array in M che contiene gli elementi risolti (es. 'pinSlots')
     validate(l, w, ctx)        controllo del JSON di UN link (ctx: E, W, ax, axisBy, gearBy, isVec)
     prepareAxes(M, ctx)        prima dell'assegnazione dei riferimenti degli assi
     initThrough(M, ev)         alla fine di initThrough (vincoli degli assi "through")
     resolve(M, ctx)            risoluzione del modello (ctx: ev, vec); usare activeLinks('tipo')
     constraints(M, push, ctx)  equazioni cinematiche  (ctx: n, unit, locked)
     lock(M, w, locked)         vincoli unilaterali (nottolino): true se ha bloccato qualcosa di nuovo
     lockable(M)                quanti vincoli unilaterali può bloccare
     events(M, s, w)            eventi nel passo di integrazione: [{ te, hit() }]
     afterIntegrate(M)          dopo l'integrazione degli angoli
     settle(M)                  dopo una ricostruzione del modello
     afterThroughLine(M, t, cache, lines)   dopo il calcolo di ogni retta "through"
     afterPose(M)               a fine frame, a pose aggiornate
     build(M, ctx)              creazione degli oggetti Babylon (ctx: inGroup)
     panel(M, ctx)              controlli dell'interfaccia (ctx: el, box, explainSoon)
     status(M, w, locked)       righe di testo per lo stato → array di stringhe
     linkedAxes(M)              assi che il link collega al resto → array di assi

   Ordini usati dal nucleo (per inserirsi fra due tipi): constraints: brake 10, mesh 20, hooke 30, ratchet 40,
   geneva 50, pin_slot 60, wheelInput 70, driver 80, input 90, hold 100, rest 110.
   afterIntegrate: geneva 10, hooke 20, updateSpin 25, pin_slot 30.   afterPose: hooke 10, rope 20, brake 30.
   ===================================================================== */
const Registry = (() => {
  const FAMILIES = {
    gear: { dir: 'gears', files: ['create', 'solve'], label: 'ingranaggio' },
    link: { dir: 'links', files: ['create', 'solve'], label: 'link' },
    part: { dir: 'parts', files: ['create'], label: 'parte' }
  };
  const types = { gear: {}, link: {}, part: {} };
  const loading = {};
  const staged = {};                                  // tipi in caricamento: invisibili finché non sono completi (vedi publish)
  const hooks = [];                                   // hook registrati dal nucleo: { phase, order, fn, name }
  const NAME_OK = /^[A-Za-z][A-Za-z0-9_]*$/;          // il nome finisce in un URL: niente "../" né altro

  /* Registra (o completa) un tipo: create.js e solve.js chiamano la stessa funzione e le loro definizioni si fondono. */
  function define(kind, type, impl) {
    if (!NAME_OK.test(type)) throw new Error(`nome di tipo non valido: "${type}"`);
    const key = kind + ':' + type;
    const t = staged[key] || types[kind][type] || (types[kind][type] = { kind, type });
    for (const k of Object.keys(impl)) {
      if (k in t && k !== 'order') console.warn(`[registry] ${kind} "${type}": "${k}" definito due volte (create.js e solve.js)`);
      t[k] = k === 'order' ? Object.assign(t.order || {}, impl.order) : impl[k];
    }
    return t;
  }

  const get = (kind, type) => types[kind][type] || null;
  const names = kind => Object.keys(types[kind]);

  /* Fasi dei link + hook del nucleo, ordinati (a parità di ordine vale l'ordine di registrazione). */
  function entries(phase) {
    const list = [];
    for (const t of Object.values(types.link)) if (typeof t[phase] === 'function') {
      const f = t[phase].bind(t);
      // Un modello costruito prima che il tipo fosse caricato (es. la macchina vecchia che continua ad animarsi mentre se ne
      // carica un'altra) non ha M[collection]: in quel caso il link semplicemente non interviene.
      const fn = t.collection ? (M, ...a) => (M && M[t.collection] ? f(M, ...a) : undefined) : f;
      list.push({ order: (t.order && t.order[phase]) ?? 100, fn, name: 'link:' + t.type });
    }
    for (const h of hooks) if (h.phase === phase) list.push(h);
    return list.sort((a, b) => a.order - b.order);
  }
  const run = (phase, ...args) => { for (const e of entries(phase)) e.fn(...args); };
  const collect = (phase, ...args) => entries(phase).flatMap(e => e.fn(...args) || []);
  const sum = (phase, ...args) => entries(phase).reduce((s, e) => s + (e.fn(...args) || 0), 0);
  const hook = (phase, order, fn, name = 'core') => hooks.push({ phase, order, fn, name });

  /* ---- caricamento automatico dei file di un tipo ------------------------------------------------------ */
  const base = () => (typeof SIM_BASE === 'string' ? SIM_BASE : '');   // cartella di loader.js, impostata dal loader

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`file non trovato o non caricabile: ${url}`));
      document.head.appendChild(s);
    });
  }

  /* Carica i file di un tipo SENZA renderlo visibile: le definizioni vanno in staged[] finché non sono complete. */
  function fetchType(kind, type) {
    if (get(kind, type)) return Promise.resolve();
    const fam = FAMILIES[kind];
    if (!NAME_OK.test(String(type))) return Promise.reject(new Error(`${fam.label}: nome di tipo non valido «${type}» (ammessi lettere, cifre e _)`));
    const key = kind + ':' + type;
    if (!loading[key]) {
      staged[key] = { kind, type };
      loading[key] = (async () => {
        for (const f of fam.files) await loadScript(`${base()}types/${fam.dir}/${type}/${f}.js${typeof SIM_VER !== 'undefined' ? '?v=' + SIM_VER : ''}`);
        if (Object.keys(staged[key]).length <= 2) throw new Error(`i file non registrano il tipo (manca Registry.${kind}('${type}', {...}))`);
      })().catch(e => {
        delete staged[key]; delete loading[key];
        throw new Error(`tipo di ${fam.label} «${type}» sconosciuto: servono i file types/${fam.dir}/${type}/${fam.files.length > 1 ? '{' + fam.files.join(',') + '}' : fam.files[0]}.js (${e.message})`);
      });
    }
    return loading[key];
  }

  /* Rende visibili, tutti insieme e in modo sincrono, i tipi appena caricati. */
  function publish(keys) {
    for (const key of keys) { const t = staged[key]; if (!t) continue; delete staged[key]; types[t.kind][t.type] = t; }
  }

  async function load(kind, type) { await fetchType(kind, type); publish([kind + ':' + type]); }

  /* Carica tutti i tipi che una macchina usa (in TUTTE le varianti: si decide solo dal JSON). I tipi diventano visibili
     solo quando sono arrivati tutti: l'animazione della macchina precedente non vede mai tipi a metà. */
  async function loadFor(machine) {
    const need = new Set();
    for (const g of machine.gears || []) need.add('gear:' + ((g && g.type) || 'spur'));
    for (const l of machine.links || []) if (l && l.type !== undefined) need.add('link:' + l.type);
    for (const a of machine.axes || []) for (const p of (a && a.parts) || []) if (p && p.shape !== undefined) need.add('part:' + p.shape);
    const keys = [...need];
    await Promise.all(keys.map(k => { const i = k.indexOf(':'); return fetchType(k.slice(0, i), k.slice(i + 1)); }));
    publish(keys);
  }

  return {
    gear: (type, impl) => define('gear', type, impl),
    link: (type, impl) => define('link', type, impl),
    part: (type, impl) => define('part', type, impl),
    get, names, types: kind => types[kind], hook, run, collect, sum, entries, load, loadFor
  };
})();

/* >>>>> core/04-geometry.js */
/* =====================================================================
   core/04-geometry.js
   Primitive geometriche CONDIVISE (le geometrie specifiche stanno in types/gears/<tipo>/create.js)
   ===================================================================== */
/* Costanti e profilo dei denti a evolvente: usati da spur, bevel (e da chiunque debba dentare una ruota) */
const PRESSURE = 20 * PI / 180;
const BACKLASH = 0.05;
const inv = a => Math.tan(a) - a;

function toothProfile(z, m, nFlank) {
  const rp = m * z / 2, rb = rp * cos(PRESSURE), ra = rp + m, rf = rp - 1.25 * m;
  const halfBase = PI / (2 * z) + inv(PRESSURE), rStart = Math.max(rb, rf), pitch = 2 * PI / z;
  const r = [], half = [];
  for (let i = 0; i < nFlank; i++) {
    const q = rStart + (ra - rStart) * i / (nFlank - 1);
    r.push(q);
    half.push(halfBase - inv(Math.acos(Math.min(1, rb / q))) - BACKLASH * m / (2 * rp));
  }
  const out = [];
  for (let i = 0; i < nFlank; i++) out.push([r[i], -half[i]]);
  out.push([ra, 0]);
  for (let i = nFlank - 1; i >= 0; i--) out.push([r[i], half[i]]);
  if (rf < rb) out.push([rf, half[0]]);
  out.push([rf, half[0] + (pitch - 2 * half[0]) / 3], [rf, half[0] + (pitch - 2 * half[0]) * 2 / 3]);
  if (rf < rb) out.push([rf, pitch - half[0]]);
  return out;
}

function loft(A, B, capA, capB) {
  const n = A.length, T = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i], [2 * n, j, i], [2 * n + 1, n + i, n + j]);
  }
  return { P: [...A, ...B, capA, capB], T };
}


/* Solido a anelli sovrapposti: usato da worm e wormwheel */
function ringsLoft(rings, capA, capB) {
  const nr = rings.length, n = rings[0].length, P = [], T = [];
  for (const r of rings) P.push(...r);
  const cA = P.length; P.push(capA);
  const cB = P.length; P.push(capB);
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n, a = i * n + j, b = i * n + j2, c = (i + 1) * n + j2, d = (i + 1) * n + j;
    T.push([a, b, c], [a, c, d]);
  }
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    T.push([cA, j2, j], [cB, (nr - 1) * n + j, (nr - 1) * n + j2]);
  }
  return { P, T };
}

/* Solidi semplici: usati dalle parti degli assi (types/parts), dal tipo "cylinder" e dalla piastra dei conici */
function cylinderSolid(r, w0, w1, n = 32, cx = 0, cy = 0) {
  const A = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * PI * i / n, x = cx + r * cos(a), y = cy + r * sin(a);
    A.push([x, y, w0]); B.push([x, y, w1]);
  }
  return loft(A, B, [cx, cy, w0], [cx, cy, w1]);
}

function boxSolid(w0, w1, cx, cy, hx, hy) {
  const q = w => [[cx - hx, cy - hy, w], [cx + hx, cy - hy, w], [cx + hx, cy + hy, w], [cx - hx, cy + hy, w]];
  return loft(q(w0), q(w1), [cx, cy, w0], [cx, cy, w1]);
}

function prismSolid(poly, y0, y1) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cw = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return loft(poly.map(([x, w]) => [x, y0, w]), poly.map(([x, w]) => [x, y1, w]), [cx, y0, cw], [cx, y1, cw]);
}


/* =====================================================================
   FORO CENTRALE DEGLI INGRANAGGI (per l'asse su cui girano / a cui sono fissati)
   ---------------------------------------------------------------------
   boreSolids(solids, bore) fora, lungo l'asse locale z, i solidi { P, T } costruiti dai tipi di ingranaggio: toglie i due tappi che
   chiudono il corpo alle estremità, li sostituisce con corone (bordo del corpo → bordo del foro) e aggiunge la parete del foro.
   È generico: i tipi di ingranaggio non devono sapere nulla del foro. Tappi gestiti:
     · piani (cilindro, ruote dentate, vite...);  · a ventaglio verso un vertice sull'asse, anche a quota variabile (coniche);
     · piani con sezione non "a stella" rispetto al centro (croce di Malta): ponte verso il foro + ear clipping.
   bore = { r, flat, ang, n }:  r = raggio del foro; flat = null (foro circolare) oppure un numero in (0,1) = distanza del lato piano
   dal centro, in frazione di r (foro a "D"); ang = direzione del lato piano (rad, nel riferimento dell'asse).
   Se un solido non è adatto (foro troppo grande, centro sul bordo...) resta com'è e il motivo finisce in `skipped`.
   ===================================================================== */
const BORE_SEGMENTS = 48;

/* Contorno del foro, in senso antiorario: cerchio di raggio r, con un lato piano se flat è in (0,1). `extra` = angoli in più in cui
   mettere un vertice (uno per ogni vertice del bordo del corpo: servono a triangolare la corona senza triangoli rovesciati).
   → [{ x, y, a }], a ∈ [0, 2π) ordinati */
function boreRing(r, flat, ang, n = BORE_SEGMENTS, extra = []) {
  const TAU = 2 * PI, wrap = a => ((a % TAU) + TAU) % TAU;
  const angs = [];
  for (let i = 0; i < n; i++) angs.push(TAU * i / n);
  const cut = typeof flat === 'number' && flat > 0 && flat < 1;
  if (cut) { const h = Math.acos(flat); angs.push(wrap(ang - h), wrap(ang + h)); }          // spigoli esatti del lato piano
  for (const a of extra) angs.push(wrap(a));
  angs.sort((a, b) => a - b);
  const out = [];
  for (const a of angs) {
    if (out.length && a - out[out.length - 1].a < 1e-12) continue;
    let rho = r;
    if (cut) { const c = Math.cos(a - ang); if (c > flat + 1e-12) rho = flat * r / c; }       // punti sul lato piano
    out.push({ x: rho * Math.cos(a), y: rho * Math.sin(a), a });
  }
  if (out.length > 1 && out[0].a + TAU - out[out.length - 1].a < 1e-12) out.pop();
  return out;
}

/* Anello di bordo di un tappo (insieme di triangoli): indici dei vertici in ordine di percorrenza, o null. */
function boreCapLoop(tris) {
  const has = new Set(), next = new Map();
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) has.add(u + ',' + v);
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    if (has.has(v + ',' + u)) continue;                      // spigolo interno: compare nei due versi
    if (next.has(u)) return null;                            // bordo che si tocca: non è un anello semplice
    next.set(u, v);
  }
  if (!next.size) return null;
  const start = next.keys().next().value, loop = [start];
  for (let cur = next.get(start); cur !== start; cur = next.get(cur)) {
    if (cur === undefined || loop.length > next.size) return null;
    loop.push(cur);
  }
  return loop.length === next.size ? loop : null;            // più di un anello (es. corona già forata): non gestito
}

/* Triangolazione per orecchie di un poligono semplice antiorario [[x, y], ...] → [[i, j, k], ...] */
function boreEarClip(poly) {
  const n = poly.length, idx = poly.map((_, i) => i), tris = [], eps = 1e-12;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = 0, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const cr = cross(poly[ia], poly[ib], poly[ic]);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;
      let ok = true;
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], poly[ia], poly[ib], poly[ic])) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat, ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return n >= 3 ? tris : [];
}

/* Ponte fra il bordo esterno O e il foro H (entrambi antiorari, [[x, y], ...]): poligono unico con un "taglio" → lista di [tipo, indice]
   in senso antiorario (il foro percorso in senso orario), o null se non si trova un ponte che non attraversi nulla. */
function boreBridge(O, H) {
  const nO = O.length, nH = H.length;
  const segX = (a, b, c, d) => {                                                 // intersezione propria dei segmenti ab e cd
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
  };
  const ord = O.map((_, i) => i).sort((i, j) => Math.hypot(O[i][0], O[i][1]) - Math.hypot(O[j][0], O[j][1]));
  for (const v of ord.slice(0, 40)) {
    const hs = H.map((_, j) => j).sort((i, j) => Math.hypot(H[i][0] - O[v][0], H[i][1] - O[v][1]) - Math.hypot(H[j][0] - O[v][0], H[j][1] - O[v][1]));
    for (const h of hs.slice(0, 4)) {
      let ok = true;
      for (let k = 0; k < nO && ok; k++) if (k !== v && (k + 1) % nO !== v && segX(O[v], H[h], O[k], O[(k + 1) % nO])) ok = false;
      for (let k = 0; k < nH && ok; k++) if (k !== h && (k + 1) % nH !== h && segX(O[v], H[h], H[k], H[(k + 1) % nH])) ok = false;
      if (!ok) continue;
      const out = [];
      for (let k = 0; k <= v; k++) out.push(['O', k]);
      for (let m = 0; m <= nH; m++) out.push(['H', (h - m + 2 * nH) % nH]);       // il foro in senso orario, tornando a h
      for (let k = v; k < nO; k++) out.push(['O', k]);                            // ... e di nuovo il vertice del ponte, poi il resto
      return out;
    }
  }
  return null;
}

function boreSolid(S, bore) {
  const { P, T } = S, TAU = 2 * PI, fail = why => ({ S, why });
  if (S.noBore) return { S, why: null };                 // solido marcato dal tipo (es. un perno fuori asse): non si fora, senza avvisi
  const used = new Set(); for (const t of T) for (const i of t) used.add(i);
  let zmin = Infinity, zmax = -Infinity;
  for (const i of used) { const z = P[i][2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  if (!(zmax > zmin)) return fail('solido senza spessore');
  const eps = 1e-6 * Math.max(1, zmax - zmin);

  // 1) i due tappi. Prima caso: facce piane alle quote estreme. Altrimenti: ventagli attorno a due vertici sull'asse.
  let lo = [], hi = [], keep = [], hubLo = null, hubHi = null;
  for (const t of T) {
    const z0 = P[t[0]][2];
    if (Math.abs(P[t[1]][2] - z0) < eps && Math.abs(P[t[2]][2] - z0) < eps) {
      if (Math.abs(z0 - zmin) < eps) { lo.push(t); continue; }
      if (Math.abs(z0 - zmax) < eps) { hi.push(t); continue; }
    }
    keep.push(t);
  }
  if (!lo.length || !hi.length) {
    const sc = Math.max(1, zmax - zmin), hubs = [...used].filter(i => Math.abs(P[i][0]) < 1e-9 * sc && Math.abs(P[i][1]) < 1e-9 * sc);
    if (hubs.length !== 2) return fail('non ha due facce che lo chiudono alle estremità');
    hubs.sort((a, b) => P[a][2] - P[b][2]); [hubLo, hubHi] = hubs; lo = []; hi = []; keep = [];
    for (const t of T) {
      const a = t.includes(hubLo), b = t.includes(hubHi);
      if (a && b) return fail('le due facce si toccano');
      (a ? lo : b ? hi : keep).push(t);
    }
  }

  // 2) descrizione di ciascun tappo: anello di bordo antiorario, quota z(x, y) della sua superficie, "a stella" o no
  const wrapPi = d => Math.atan2(Math.sin(d), Math.cos(d));
  const describe = (tris, hub) => {
    const loop = boreCapLoop(tris);
    if (!loop) return { why: 'il bordo di una faccia non è un anello semplice' };
    let area = 0, rmin = Infinity;
    for (let k = 0; k < loop.length; k++) {
      const p = P[loop[k]], q = P[loop[(k + 1) % loop.length]];
      area += p[0] * q[1] - q[0] * p[1]; rmin = Math.min(rmin, Math.hypot(p[0], p[1]));
    }
    if (rmin < 1e-9) return { why: 'il centro sta sul bordo (es. settore dentato)' };
    const s = area > 0 ? 1 : -1, ring = s > 0 ? loop : loop.slice().reverse(), n = ring.length;          // ring: antiorario
    const ang = ring.map(i => Math.atan2(P[i][1], P[i][0]));
    let sweep = 0, star = true; const un = [ang[0]];
    for (let k = 1; k <= n; k++) {
      const d = wrapPi(ang[k % n] - ang[k - 1]); sweep += d;
      if (d < -1e-9) star = false;
      if (k < n) un.push(un[k - 1] + d);
    }
    if (Math.abs(sweep - TAU) > 1e-6) return { why: 'il centro non sta dentro il bordo della faccia' };
    const zs = ring.map(i => P[i][2]), planar = zs.every(z => Math.abs(z - zs[0]) < eps);
    let zAt;
    if (planar) zAt = () => zs[0];
    else if (hub !== null && star) {                                         // ventaglio: interpolazione baricentrica nel triangolo (centro, Ok, Ok+1)
      const zh = P[hub][2];
      zAt = (x, y) => {
        let u = ((Math.atan2(y, x) - un[0]) % TAU + TAU) % TAU + un[0], l = 0, h = n - 1;
        while (l < h) { const m = (l + h + 1) >> 1; if (un[m] <= u) l = m; else h = m - 1; }
        const A = P[ring[l]], B = P[ring[(l + 1) % n]], det = A[0] * B[1] - B[0] * A[1];
        if (Math.abs(det) < 1e-12) return A[2];
        const al = (x * B[1] - B[0] * y) / det, be = (A[0] * y - x * A[1]) / det;
        return zh + al * (A[2] - zh) + be * (B[2] - zh);
      };
    } else return { why: 'una faccia non è piana e non è a ventaglio' };
    return { s, ring, un: star ? un : null, rmin, zAt };
  };
  const cLo = describe(lo, hubLo), cHi = describe(hi, hubHi);
  if (cLo.why || cHi.why) return fail(cLo.why || cHi.why);
  const rmin = Math.min(cLo.rmin, cHi.rmin);
  if (bore.r > 0.85 * rmin) return fail(`foro di raggio ${+bore.r.toFixed(2)} troppo grande per il corpo (raggio minimo ${+rmin.toFixed(2)})`);

  // 3) anello del foro, con un punto per ogni vertice di un bordo "a stella", allo stesso angolo (spostato di poco se più vertici stanno
  //    sullo stesso raggio): fra due raggi consecutivi la fascia si divide in triangoli che non possono risultare rovesciati, perché il
  //    centro sta a sinistra di ogni lato di una sezione a stella.
  const spokes = c => { if (!c.un) return []; const out = []; let prev = -Infinity; for (const a of c.un) { prev = Math.max(a, prev + 2e-6); out.push(prev); } return out; };
  const sLo = spokes(cLo), sHi = spokes(cHi);
  const hr = boreRing(bore.r, bore.flat, bore.ang || 0, bore.n || BORE_SEGMENTS, sLo.concat(sHi)), nH = hr.length;
  const P2 = P.slice(), addHole = c => hr.map(h => P2.push([h.x, h.y, c.zAt(h.x, h.y)]) - 1);
  const Hlo = addHole(cLo), Hhi = addHole(cHi);
  const idxOf = a => {                                                  // indice del punto del foro all'angolo a (ricerca binaria)
    const w = ((a % TAU) + TAU) % TAU; let l = 0, h = nH - 1;
    while (l < h) { const m = (l + h) >> 1; if (hr[m].a < w - 1e-9) l = m + 1; else h = m; }
    return l;
  };

  const annulus = (c, sp, H) => {
    const { ring: O, s } = c, nO = O.length; let out = [];
    if (c.un) {
      const ix = sp.map(idxOf);
      for (let k = 0; k < nO; k++) {
        const k1 = (k + 1) % nO;
        out.push([O[k], O[k1], H[ix[k1]]]);                              // lato del corpo + punto del foro sul raggio successivo
        for (let m = ix[k]; m !== ix[k1]; m = (m + 1) % nH) out.push([O[k], H[(m + 1) % nH], H[m]]);   // ventaglio sul bordo del foro
      }
    } else {                                                             // sezione non a stella: ponte + orecchie
      const bridge = boreBridge(O.map(i => [P[i][0], P[i][1]]), hr.map(h => [h.x, h.y]));
      if (!bridge) return 'non si trova un ponte fra il bordo e il foro';
      const poly = bridge.map(([t, k]) => t === 'O' ? [P[O[k]][0], P[O[k]][1]] : [hr[k].x, hr[k].y]);
      out = boreEarClip(poly).map(t => t.map(q => bridge[q][0] === 'O' ? O[bridge[q][1]] : H[bridge[q][1]]));
    }
    // controllo: triangoli tutti antiorari (in pianta) e area totale = area del corpo − area del foro; altrimenti non si fora
    let tot = 0, aO = 0, aH = 0;
    for (let k = 0; k < nO; k++) { const p = P[O[k]], q = P[O[(k + 1) % nO]]; aO += (p[0] * q[1] - q[0] * p[1]) / 2; }
    for (let k = 0; k < nH; k++) aH += (hr[k].x * hr[(k + 1) % nH].y - hr[(k + 1) % nH].x * hr[k].y) / 2;
    for (const t of out) {
      const [A, B, C] = t.map(x => P2[x]), ar = ((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
      if (ar < -1e-6 * Math.max(1, aO)) return 'triangolo rovesciato (' + (+ar.toFixed(4)) + ')';
      tot += ar;
    }
    if (Math.abs(tot - (aO - aH)) > 1e-6 * Math.max(1, aO)) return 'area ' + (+tot.toFixed(3)) + ' invece di ' + (+(aO - aH).toFixed(3));
    return s > 0 ? out : out.map(([a, b, c2]) => [a, c2, b]);           // stesso verso del tappo originale
  };
  const aLo = annulus(cLo, sLo, Hlo), aHi = annulus(cHi, sHi, Hhi);
  if (typeof aLo === 'string' || typeof aHi === 'string') return fail('triangolazione della corona non valida: ' + (typeof aLo === 'string' ? aLo : aHi));

  // 4) parete del foro: la sua normale deve guardare verso l'asse (fuori dal materiale), nel verso di orientamento del solido
  const ori = cHi.s, wall = [];
  const orient = ([a, b, c]) => {
    const A = P2[a], B = P2[b], C = P2[c], u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
    return (-(n[0] * cx + n[1] * cy)) * ori > 0 ? [a, b, c] : [a, c, b];
  };
  for (let m = 0; m < nH; m++) {
    const m2 = (m + 1) % nH, a = Hlo[m], b = Hlo[m2], c = Hhi[m2], d = Hhi[m];
    wall.push(orient([a, b, c]), orient([a, c, d]));
  }
  return { S: { P: P2, T: keep.concat(aLo, aHi, wall) }, why: null };
}

/* Fora tutti i solidi di un ingranaggio. → { solids, skipped: [motivi per cui qualche solido non è stato forato] } */
function boreSolids(solids, bore) {
  const skipped = [];
  const out = solids.map(S => { const r = boreSolid(S, bore); if (r.why) skipped.push(r.why); return r.S; });
  return { solids: out, skipped };
}

/* >>>>> core/05-state.js */
/* =====================================================================
   core/05-state.js
   Stato dell'interfaccia, inizializzazione dallo stato della macchina, varianti
   ===================================================================== */
const state = {
  variants: {}, params: {}, ctrl: {}, inputs: {},
  brakes: {}, groups: {}, driver: null, direction: 1, current: null, timeScale: 1,
  wheelInputs: {  }, wheelOffsets: { }
};

function getIndependentTuning(g){ return g?.def?.independentTuning ?? g?.independentTuning; }
function getTunableGears(M){ return (M.gears?? Object.values(M.gearBy)).filter(g => getIndependentTuning(g)); }
function ensureWheelState(M) {
  for (const g of getTunableGears(M)) {
console.log("Azzero input di ", g);
    state.wheelInputs[g.id]??= { rpm: 0 };
    state.wheelOffsets[g.id]??= 0;
  }
  // pulizia se togli independentTuning dal JSON
  for (const id of Object.keys(state.wheelInputs)) {
    if (!getIndependentTuning(M.gearBy[id])) {
      delete state.wheelInputs[id];
      delete state.wheelOffsets[id];
    }
  }

console.log(M);
}



/* Azzera tutto ciò che dipende dalla macchina (varianti, cursori, input, freni, gruppi visibili, ruota pilotata, selezione).
   Non tocca direzione e velocità del tempo. Gli oggetti vecchi vengono sostituiti, non modificati: chi li ha salvati può ripristinarli. */
function initStateFromMachine() {
  state.variants = {}; state.params = {}; state.ctrl = {}; state.inputs = {}; state.brakes = {}; state.groups = {};
  state.wheelInputs = {}; state.wheelOffsets = {}; state.driver = null; state.current = null;
  for (const k in MACHINE.variants) state.variants[k] = MACHINE.variants[k].active;
  for (const c of MACHINE.controls) {
    state.ctrl[c.id] = {};
    for (const v in c.ranges) state.ctrl[c.id][v] = c.ranges[v].value;
  }
  for (const inp of MACHINE.inputs) state.inputs[inp.id] = { rpm: 0 };
  state.keyOffset = 0;
  state.declination = 0;
  for (const g of MACHINE.groups) state.groups[g.id] = g.visible !== false;
  syncParams();
}

function syncParams() {
  for (const c of MACHINE.controls) state.params[c.id] = state.ctrl[c.id][c.variantKey ? state.variants[c.variantKey] : 'all'];
}
initStateFromMachine();

function isActive(el) {
  return !el.variant || Object.keys(el.variant).every(k => state.variants[k] === el.variant[k]);
}

/* id dell'ingranaggio a cui punta un meshWith (stringa oppure {id:...}) */
const meshId = g => g.meshWith && typeof g.meshWith === 'object' ? g.meshWith.id : g.meshWith;

/* Link ATTIVI (nella variante corrente) di un dato tipo: i tipi di link la usano nel loro resolve() */
function activeLinks(type) { return (MACHINE.links || []).filter(l => l.type === type && isActive(l)); }

/* >>>>> core/06-validate.js */
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

/* >>>>> core/07-kinematics.js */
/* =====================================================================
   core/07-kinematics.js
   Cinematica dei corpi: velocità angolare assoluta e velocità dell'origine di ogni asse
   ===================================================================== */
/* =====================================================================
   3b. CINEMATICA DEI CORPI (assi con carrier)
   ---------------------------------------------------------------------
   Per ogni asse i la variabile di velocità è  w_i = Ω_i · dir_i  (componente, lungo l'asse, della velocità
   angolare ASSOLUTA del corpo). La velocità angolare assoluta si compone con quella del carrier c:
        Ω_i = Ω_c + s_i · dir_i ,   s_i = w_i − Ω_c·dir_i   (s_i = velocità RELATIVA al carrier)
   quindi Ω_i = Ω_c − dir_i (dir_i·Ω_c) + w_i dir_i.
   Se l'asse è parallelo al carrier (satelliti) Ω_c·dir = w_c e si ritrova la solita formula  s = w − w_c.
   Se è perpendicolare (asse di declinazione) Ω_c·dir = 0 e s = w: la ruota non "sente" la rotazione del carrier.
   Ω_i e la velocità dell'origine v(O_i) sono forme lineari nelle w_k: le memorizziamo come {k: vettore}.
   ===================================================================== */
function buildKinematics(M) {
  const n = M.axes.length, busy = new Set();
  const visit = a => {
    if (a.Om) return;
    if (busy.has(a)) throw new Error(`catena di carrier circolare attorno all'asse "${a.id}"`);
    busy.add(a);
    const c = a.carrier;
    if (!c) { a.Om = { [a.idx]: a.dir }; a.vO = {}; }
    else {
      visit(c);
      const Om = {}, vO = {}, d = V.sub(a.O, c.O);
      for (const k in c.Om) Om[k] = V.sub(c.Om[k], V.mul(a.dir, V.dot(c.Om[k], a.dir)));
      Om[a.idx] = a.dir;
      for (const k in c.vO) vO[k] = c.vO[k].slice();
      for (const k in c.Om) vO[k] = V.add(vO[k] || [0, 0, 0], V.cross(c.Om[k], d));
      a.Om = Om; a.vO = vO;
    }
    busy.delete(a);
  };
  M.axes.forEach(visit);
  // vincolo "debole" rest:"carrier":  s_i = 0  ⇔  w_i − Ω_c·dir_i = 0  (usato solo se nient'altro determina l'asse)
  for (const a of M.axes) {
    a.soft = null;
    if (a.def.rest === 'carrier' && a.carrier) {
      const r = new Array(n).fill(0);
      r[a.idx] = 1;
      for (const k in a.carrier.Om) r[k] -= V.dot(a.carrier.Om[k], a.dir);
      a.soft = r;
    }   else if (a.def.rest === 'world') { const r = new Array(n).fill(0); r[a.idx] = 1; a.soft = r; }
  }
}

/* velocità (come forma lineare nelle w_k) di un punto P solidale al corpo dell'asse a */
function pointVel(a, P) {
  const out = {}, r = V.sub(P, a.O);
  for (const k in a.vO) out[k] = a.vO[k].slice();
  for (const k in a.Om) out[k] = V.add(out[k] || [0, 0, 0], V.cross(a.Om[k], r));
  return out;
}

/* velocità angolare assoluta (vettore) del corpo dell'asse a, dati i w */
function omegaOf(a, w) {
  let o = [0, 0, 0];
  for (const k in a.Om) o = V.add(o, V.mul(a.Om[k], w[k]));
  return o;
}

/* velocità relative al carrier: s_i = w_i − Ω_carrier·dir_i  (per gli assi senza carrier s_i = w_i) */
function relSpins(M, w) {
  return M.axes.map((a, i) => a.carrier ? w[i] - V.dot(omegaOf(a.carrier, w), a.dir) : w[i]);
}


/* >>>>> core/08-axis-constraints.js */
/* =====================================================================
   core/08-axis-constraints.js
   Assi "through", "alignWith", "perpendicularTo", "spinPerpTo", "spinAlignTo": vincoli di posa degli assi
   ===================================================================== */
/* =====================================================================
   3c. ASSI "through": retta che passa SEMPRE per due punti
   ---------------------------------------------------------------------
   "through": [P1, P2]  con P = id di un asse (si usa l'origine di quell'asse, nel punto in cui si trova in quel momento: dipende
   dagli angoli di RA e declinazione) oppure [x,y,z] (punto fisso nel mondo, espressioni ammesse; si valuta dopo tutte le rotazioni).
   Ogni frame: origine = P1, direzione = da P1 verso P2.
   ===================================================================== */
const MAT = {
  rot(k, a) {
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = k;
    return [[t*x*x + c, t*x*y - s*z, t*x*z + s*y], [t*x*y + s*z, t*y*y + c, t*y*z - s*x], [t*x*z - s*y, t*y*z + s*x, t*z*z + c]];
  },
  mul: (A, B) => A.map(r => [0, 1, 2].map(j => r[0]*B[0][j] + r[1]*B[1][j] + r[2]*B[2][j])),
  mulV: (A, v) => A.map(r => r[0]*v[0] + r[1]*v[1] + r[2]*v[2])
};

/* Posa assoluta di un asse guidato dagli ingranaggi dagli angoli correnti a.theta (stessa composizione dei nodi Babylon). */
function axisFrame(a, cache) {
  let f = cache.get(a);
  if (f) return f;
  const Rs = MAT.rot(a.dir, a.theta);
  if (a.carrier) {
    const pc = axisFrame(a.carrier, cache);
    f = { R: MAT.mul(pc.R, Rs), O: V.add(pc.O, MAT.mulV(pc.R, V.sub(a.O, a.carrier.O))), dir: MAT.mulV(pc.R, a.dir) };
  } else f = { R: Rs, O: a.O, dir: a.dir };
  cache.set(a, f);
  return f;
}

function initThrough(M, ev) {
  M.through = [];
  for (const a of M.axes) if (a.def.through) {
    CTX.where = `asse "${a.id}", campo through`;
    const pts = a.def.through.map(q => typeof q === 'string'
      ? { axis: M.axisBy[q] }
      : { fixed: q.map(e => ev(e)) });
    for (const [i, p] of pts.entries()) if (p.fixed) {
      if (!p.fixed.every(Number.isFinite)) throw new Error(`asse "${a.id}": punto fisso non valido ${fmtV(p.fixed)}`);
      // assi da cui dipende il punto fisso (axes.ID.ox/oy/oz): durante la rotazione degli ingranaggi non devono spostarsi
      p.deps = [...new Set([...a.def.through[i].join(' ').matchAll(/axes\s*\.\s*([A-Za-z0-9_]+)\s*\.\s*o[xyz]/g)].map(m => m[1]))].map(id => M.axisBy[id]).filter(Boolean);
    }
    const t = { a, pts, ref: [0, 0, 1] };
    if (a.def.refFrom) {
      t.refFrom = M.axisBy[a.def.refFrom];
      if (!t.refFrom) throw new Error(`asse "${a.id}": refFrom "${a.def.refFrom}" non esiste o non è attivo`);
      step('through', `${a.id}: riferimento stabilizzato dall'asse ${t.refFrom.id}`);
    }

    a.aimed = true;
    M.through.push(t);
    const cache = new Map(), r = solveThrough(t, cache);
    a.O = r.O.slice(); a.dir = r.dir.slice(); a.ref = r.ref.slice(); a.yv = V.cross(a.dir, a.ref);
    step('through', `${a.id}: passa per ${pts.map(p => p.axis ? p.axis.id + ' ' + fmtV(axisFrame(p.axis, cache).O) : fmtV(p.fixed)).join(' e per ')}`);
  }
  // assi "alignWith": mantengono la propria origine (cinematica normale, portati dal loro carrier) ma hanno la direzione di un asse "through"
  M.aligned = [];
  for (const a of M.axes) if (a.def.alignWith) {
    const t = M.through.find(x => x.a.id === a.def.alignWith);
    if (!t) throw new Error(`asse "${a.id}": alignWith "${a.def.alignWith}" non è un asse con through`);
    a.aimed = a.aligned = true;
    a.dir = t.dir.slice(); a.ref = V.unit(V.perp(a.ref, a.dir)); a.yv = V.cross(a.dir, a.ref);   // posa iniziale (bounding box)
    const q = { a, t, ref: a.ref.slice() };
    // Se l'asse è portato da un carrier (es. il tubo sul barilotto), memorizzo il suo riferimento
    // nel sistema del carrier: la rotazione attorno al proprio asse seguirà così rigidamente il
    // carrier, invece dello "spin" apparente del trasporto parallelo lungo la coda.
    if (a.carrier) q.refLocal = a.ref.slice();
    M.aligned.push(q);
    step('allineato', `${a.id}: stessa direzione di ${t.a.id}, origine ${fmtV(a.O)}` + (a.carrier ? `, riferimento ancorato a ${a.carrier.id}` : ''));
  }
  // Assi solidali a una retta ma vincolati a restarle perpendicolari.
  M.perpendicular = [];
for (const a of M.axes) if (a.def.perpendicularTo) {
  const spec = a.def.perpendicularTo;
  const t = M.through.find(x => x.a.id === spec.line);
  const reference = M.axisBy[spec.reference];
  if (!t || !reference) throw new Error(`asse "${a.id}": perpendicularTo richiede una retta through e un asse reference validi`);
  a.aimed = true; a.aligned = true;
  const q = { a, t, reference };
  if (spec.refFrom) {
    const t2 = M.through.find(x => x.a.id === spec.refFrom);
    if (t2) q.refFromLine = t2;
    else {
      const a2 = M.axisBy[spec.refFrom];
      if (!a2) throw new Error(`asse "${a.id}": perpendicularTo.refFrom "${spec.refFrom}" non esiste o non è attivo`);
      q.refFromAxis = a2;
    }
    step('perpendicolare', `${a.id}: perpendicolare a ${t.a.id}, orientamento (ref) da ${spec.refFrom}`);
  } else {
    step('perpendicolare', `${a.id}: perpendicolare a ${t.a.id}, ref dalla verticale ${reference.id}`);
  }
  M.perpendicular.push(q);
}

  // i link possono agganciarsi qui (es. "rail": il binario si appoggia alle rette "through" appena create)
  Registry.run('initThrough', M, ev);
  CTX.where = '';
}

/* Assi "spinPerpTo": ruotano su se stessi (a.theta) in modo che l'asse figlio "axis" (perpendicolare a loro, come il barilotto sulla forcella)
   resti perpendicolare alla retta "line" (la coda). La retta passa per B (sull'asse di rotazione: la rotazione non lo sposta) e per M, quindi
   l'angolo si ricava in forma chiusa:  b(φ) = b0 cosφ + (f × b0) sinφ,  b(φ)·(M−B) = 0. */
function initSpins(M) {
  M.spins = [];
  for (const a of M.axes) if (a.def.spinPerpTo) {
    const sp = a.def.spinPerpTo, t = M.through.find(x => x.a.id === sp.line);
    if (!t) throw new Error(`asse "${a.id}": spinPerpTo.line "${sp.line}" non ha through`);
    M.spins.push({ a, child: M.axisBy[sp.axis], t, prev: 0 });
    step('spin', `${a.id}: ruota su se stesso perché ${sp.axis} resti perpendicolare a ${sp.line}`);
  }
}

function updateSpin(M) {
  if (!M.spins || !M.spins.length) return;
  const lines = [];
  for (const q of M.spins) {
    const keep = q.a.theta;
    q.a.theta = 0;                                              // con rotazione nulla: asse della forcella f, direzione b0 del figlio
    const c0 = new Map(), f = V.unit(axisFrame(q.a, c0).dir), b0 = V.unit(axisFrame(q.child, c0).dir);
    const P0 = q.t.pts[0].axis ? axisFrame(q.t.pts[0].axis, c0).O : q.t.pts[0].fixed;
    const P1 = q.t.pts[1].axis ? axisFrame(q.t.pts[1].axis, c0).O : q.t.pts[1].fixed;
    const c = V.sub(P1, P0), k = V.dot(b0, c), m = V.dot(V.cross(f, b0), c);
    if (Math.hypot(k, m) < 1e-9 * (V.len(c) || 1)) {
      q.a.theta = keep;
      warn('spin', `${q.a.id}: la retta ${q.t.a.id} è parallela all'asse della forcella, l'angolo di rotazione è indeterminato`);
      continue;
    }
    let phi = Math.atan2(-k, m);                                // due soluzioni: φ e φ+π (b e −b): si sceglie la più vicina alla precedente
    const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
    if (Math.abs(wrap(phi + PI - q.prev)) < Math.abs(wrap(phi - q.prev))) phi += PI;
    phi = q.prev + wrap(phi - q.prev);                          // senza salti di 2π
    q.prev = phi; q.a.theta = phi;
    lines.push(`${q.a.id}: ruota su se stessa di ${fmt(wrap(phi) * 180 / PI, 1)}° per tenere ${q.child.id} perpendicolare a ${q.t.a.id}.`);
  }
  M.spinText = lines.join(' ');
}

function solveThrough(t, cache) {
  const P = t.pts.map(p => p.axis ? axisFrame(p.axis, cache).O : p.fixed);
  const d = V.sub(P[1], P[0]), len = V.len(d);
  const dir = len > 1e-9 ? V.mul(d, 1 / len) : (t.dir || [0, 0, 1]);
// Il "ref" della coda (l'orientamento del suo frame attorno alla propria direzione) è derivato
  // dall'asse dichiarato in MACHINE con "refFrom": si prende la direzione CORRENTE di quell'asse
  // (che risente del suo carrier/rotazioni) e la si proietta perpendicolarmente alla coda. In questo
  // modo il frame della coda è ancorato a un vincolo fisico dichiarato nel JSON (la coda è solidale
  // allo specchio, lo specchio è solidale alla verticale) e non alla storia del proprio moto.
  const refSrc = t.refFrom ? V.unit(axisFrame(t.refFrom, cache).dir) : t.ref;
  let ref = V.perp(refSrc, dir);
  if (V.len(ref) < 1e-6) ref = V.perp([1, 0, 0], dir);
  ref = V.unit(ref);
  t.dir = dir; t.ref = ref;
  return { O: P[0], dir, ref, len, P };
}

function setNodePose(a, p) {
  const yv = V.cross(p.dir, p.ref), O = V.toB(p.O), fx = V.toB(p.ref), fy = V.toB(yv), fz = V.toB(p.dir);
  a.node.position.set(O[0], O[1], O[2]);
  a.node.rotationQuaternion = Quat.FromRotationMatrix(BABYLON.Matrix.FromValues(fx[0], fx[1], fx[2], 0, fy[0], fy[1], fy[2], 0, fz[0], fz[1], fz[2], 0, 0, 0, 0, 1));
}

function updateThrough(M) {
  if (!M.through || !M.through.length) return;
  const cache = new Map(), lines = [];
  for (const t of M.through) {
    const r = solveThrough(t, cache);
    setNodePose(t.a, r);
    // i link che dipendono da questa retta (es. i binari) si risolvono subito: le rette through successive possono avere "refFrom" sulla guida
    Registry.run('afterThroughLine', M, t, cache, lines);
    for (const p of t.pts) if (p.deps) {
      const moved = Math.max(0, ...p.deps.map(d => V.len(V.sub(axisFrame(d, cache).O, d.O))));
      p.moved = moved;
     // if (moved > 1e-6) fail('through', `${t.a.id}: il punto fisso dipende da ${p.deps.map(d => d.id).join(', ')}, che si è spostato di ${moved.toFixed(3)} mm durante la rotazione degli ingranaggi: il punto non è fisso, c'è un errore nella definizione`);
    }
    const fx = t.pts.find(p => p.deps);
    lines.push(`${t.a.id}: passa per ${t.pts.map(p => p.axis ? p.axis.id : 'il punto fisso').join(' e per ')}, distanza fra i due punti ${fmt(r.len, 1)} mm.` +
               (fx ? ` Spostamento del punto fisso durante la rotazione: ${fmt(fx.moved || 0, 3)} mm (deve essere 0).` : ''));
  }
  for (const q of M.aligned || []) {
    const f = axisFrame(q.a, cache), dir = q.t.dir;
    let ref;
    if (q.refLocal && q.a.carrier) {
      // Il riferimento dell'asse ruota rigidamente con il carrier (il barilotto): è lui a "portare"
      // l'orientamento del tubo attorno al proprio asse. La direzione invece resta imposta
      // geometricamente dalla coda (alignWith), quindi il riferimento va riportato nel piano
      // perpendicolare alla direzione corrente.
      const carR = axisFrame(q.a.carrier, cache).R;
      ref = V.perp(MAT.mulV(carR, q.refLocal), dir);
      if (V.len(ref) < 1e-6) ref = V.perp(q.ref, dir);
      if (V.len(ref) < 1e-6) ref = V.perp([1, 0, 0], dir);
    } else {
      ref = V.perp(q.ref, dir);
      if (V.len(ref) < 1e-6) ref = V.perp([1, 0, 0], dir);
    }
    ref = V.unit(ref); q.ref = ref;
    setNodePose(q.a, { O: f.O, dir, ref });
    if (q.a.carrier) {
      const cd = V.unit(axisFrame(q.a.carrier, cache).dir), tilt = Math.asin(Math.max(-1, Math.min(1, V.dot(dir, cd)))) * 180 / PI;
      q.tilt = tilt;
      lines.push(`${q.a.id}: coassiale a ${q.t.a.id}; inclinato di ${fmt(Math.abs(tilt), 1)}° rispetto al piano perpendicolare a ${q.a.carrier.id} (con la sola rotazione attorno al barilotto sarebbe 0°).`);
    }
  }
  // L'asse orizzontale dello specchio resta nel centro fisso e si orienta
  // come prodotto vettoriale fra la verticale di riferimento e la coda:
  // così è orizzontale, perpendicolare alla coda e ne segue l'orientamento.
for (const q of M.perpendicular || []) {
  const vertical = V.unit(axisFrame(q.reference, cache).dir);
  const tailDir  = V.unit(q.t.dir);
  let dir = V.cross(vertical, tailDir);
  if (V.len(dir) < 1e-8) dir = q.a.dir.slice();
  dir = V.unit(dir);

  // Riferimento del frame:
  //  – se "refFrom" punta a un asse "through" (tipicamente la coda stessa), uso il suo .ref
  //    (che è già stabile perché quell'asse ha il proprio refFrom);
  //  – se "refFrom" punta a un asse ordinario, uso il suo .ref (o .dir come fallback);
  //  – altrimenti comportamento storico: proiezione della verticale sul piano ⟂ a dir.
  let refSrc;
  if (q.refFromLine)      refSrc = q.refFromLine.ref;
  else if (q.refFromAxis) refSrc = q.refFromAxis.ref || q.refFromAxis.dir;
  else                    refSrc = vertical;

  let ref = V.perp(refSrc, dir);
  if (V.len(ref) < 1e-8) ref = V.perp([0, 1, 0], dir);
  ref = V.unit(ref);

  setNodePose(q.a, { O: q.a.O, dir, ref });
  q.a.dir = dir; q.a.ref = ref; q.a.yv = V.cross(dir, ref);
  lines.push(`${q.a.id}: perpendicolare a ${q.t.a.id}, ref da ${q.refFromLine ? q.refFromLine.a.id : q.refFromAxis ? q.refFromAxis.id : q.reference.id}.`);
}
  M.throughText = lines.join(' ');
}


function initSpinAlign(M) { /* per giunti sferici "dissociati" in due assi ortogonali */
  M.spinAlign = [];

  const sourceVectors = new Set(["ref", "yv"]);
  const targetVectors = new Set(["dir", "ref", "yv"]);

  for (const axis of M.axes) {
    const spec = axis.def.spinAlignTo;
    if (!spec) continue;

    const target = M.axisBy[spec.target];

    if (!target) {
      throw new Error(
        `Asse "${axis.id}": spinAlignTo.target ` +
        `"${spec.target}" non esiste o non è attivo`
      );
    }

    const sourceVector = spec.sourceVector || "yv";
    const targetVector = spec.targetVector || "dir";
    const mode = spec.mode || "parallel";

    if (!sourceVectors.has(sourceVector)) {
      throw new Error(
        `Asse "${axis.id}": sourceVector deve essere "ref" oppure "yv"`
      );
    }

    if (!targetVectors.has(targetVector)) {
      throw new Error(
        `Asse "${axis.id}": targetVector non valido`
      );
    }

    if (!["parallel", "same"].includes(mode)) {
      throw new Error(
        `Asse "${axis.id}": mode deve essere "parallel" oppure "same"`
      );
    }

    if (axis.aimed || axis.aligned) {
      throw new Error(
        `Asse "${axis.id}": spinAlignTo richiede ` +
        `un asse orientabile tramite theta`
      );
    }

    M.spinAlign.push({
      axis,
      target,
      sourceVector,
      targetVector,
      mode
    });
  }
}



function currentWorldVector(axis, property) {
  // Gli assi aimed/aligned hanno già i riferimenti
  // aggiornati nel sistema di coordinate del modello.
  if (axis.aimed || axis.aligned) {
    return V.unit(axis[property]);
  }

  // Per gli altri assi, trasforma il vettore locale
  // nella posa corrente del modello.
  const frame = axisFrame(axis, new Map());

  if (property === "dir") {
    return V.unit(frame.dir);
  }

  return V.unit(MAT.mulV(frame.R, axis[property]));
}

function updateSpinAlign(M)  {  /* Per gestione giunti sferici dissociati */
//console.log("[updateSpinAlign]");
  const wrap = angle =>
    Math.atan2(Math.sin(angle), Math.cos(angle));

  for (const q of M.spinAlign || []) {
//console.log("[updateSpinAlign] vincolo ", q);

    const { axis, target, sourceVector, targetVector, mode } = q;

    const previous = axis.theta || 0;

    // Direzione obiettivo nella posa corrente.
    const targetDir = currentWorldVector(target, targetVector);

    // La sorgente viene valutata con theta = 0:
    // così ricaviamo la direzione di riferimento
    // prima della rotazione attorno all'asse.
    axis.theta = 0;

    const baseFrame = axisFrame(axis, new Map());
    const k = V.unit(baseFrame.dir);

    const sourceDir = V.unit(
      MAT.mulV(baseFrame.R, axis[sourceVector])
    );

    axis.theta = previous;

    // La rotazione attorno a k può allineare soltanto
    // direzioni perpendicolari a k.
    if (Math.abs(V.dot(targetDir, k)) > 1e-4) {
      if (!q.invalidGeometry) {
        warn(
          "spinAlign",
          `${axis.id}: il vettore obiettivo ${target.id}.${targetVector} ` +
          `non è perpendicolare all'asse di rotazione`
        );
        q.invalidGeometry = true;
      }
      continue;
    }

    const sourceProjected = V.perp(sourceDir, k);
    const targetProjected = V.perp(targetDir, k);

    if (
      V.len(sourceProjected) < 1e-8 ||
      V.len(targetProjected) < 1e-8
    ) {
      continue;
    }

    const from = V.unit(sourceProjected);
    const to = V.unit(targetProjected);

    // Angolo che ruota from verso to attorno a k.
    const t1 = Math.atan2(
      V.dot(to, V.cross(k, from)),
      V.dot(from, to)
    );

    // Una relazione "parallel" ammette anche
    // la direzione opposta, separata da 180°.
    const candidates =
      mode === "parallel" ? [t1, t1 + PI] : [t1];

    let best = candidates[0];

    for (const candidate of candidates.slice(1)) {
      if (
        Math.abs(wrap(candidate - previous)) <
        Math.abs(wrap(best - previous))
      ) {
        best = candidate;
      }
    }

    // Aggiorna theta senza salti di 2π.
    axis.theta = previous + wrap(best - previous);

    // Il nodo viene aggiornato subito, come nel codice attuale.
    if (axis.node) {
      axis.node.rotationQuaternion =
        Quat.RotationAxis(axis.axisB, axis.theta);
    }
  }
}


/* updateSpin fa parte della fase afterIntegrate dei link (dopo geneva e hooke, prima di pin_slot) */
Registry.hook('afterIntegrate', 25, M => updateSpin(M), 'updateSpin');

/* >>>>> core/09-resolve.js */
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

/* >>>>> core/10-solver.js */
/* =====================================================================
   core/10-solver.js
   Solutore cinematico: sistema lineare dei vincoli, velocità degli assi, tabella e spiegazione
   ===================================================================== */
/* =====================================================================
   4. CINEMATICA
   ===================================================================== */
function makeSystem(n) {
  const rows = [];
  return {
    lastIndependent: false,
    add(c, b) {
      this.lastIndependent = false;
      c = c.slice();
      const s = Math.max(...c.map(Math.abs)) || 1; for (let j = 0; j < n; j++) c[j] /= s; b /= s;
      for (const r of rows) { const f = c[r.p]; if (Math.abs(f) > 1e-12) { for (let j = 0; j < n; j++) c[j] -= f * r.c[j]; b -= f * r.b; } }
      let p = -1, best = 1e-9;
      for (let j = 0; j < n; j++) if (Math.abs(c[j]) > best) { best = Math.abs(c[j]); p = j; }
      if (p < 0) return Math.abs(b) < 1e-7;
      const d = c[p]; for (let j = 0; j < n; j++) c[j] /= d; b /= d;
      for (const r of rows) { const f = r.c[p]; if (Math.abs(f) > 1e-12) { for (let j = 0; j < n; j++) r.c[j] -= f * c[j]; r.b -= f * b; } }
      rows.push({ p, c, b }); this.lastIndependent = true; return true;
    },
    solve() { const w = new Array(n).fill(0); for (const r of rows) w[r.p] = r.b; return w; },
    rows: () => rows
  };
}
const inputOmega = (ax, st) => ax.cw * st.rpm * PI / 30;

/* Elenco ordinato dei vincoli: i primi hanno la precedenza (quelli dopo, se incompatibili, vengono scartati).
   Le equazioni le forniscono i link (fase "constraints", types/links/<tipo>/solve.js) e i pezzi del nucleo qui sotto,
   fusi per "order": brake 10, presa 20, hooke 30, nottolino 40, geneva 50, pin_slot 60, ruota pilotata 70, driver 80, input 90, hold 100, rest 110. */
function buildConstraints(M, locked) {
  const n = M.axes.length, unit = i => { const r = new Array(n).fill(0); r[i] = 1; return r; };
  const L = [], push = (kind, label, row, b, extra = {}) => L.push({ kind, label, row, b, ...extra });
  Registry.run('constraints', M, push, { n, unit, locked });
  return L;
}

Registry.hook('constraints', 20, (M, push) => {
  for (const m of M.meshes) push('presa', `ingranamento ${m.g.id} ⇄ ${m.p.id}`, m.row, 0);
}, 'presa');

Registry.hook('constraints', 70, (M, push, { unit }) => {
  // data-driven: tutti i gear che dichiarano independentTuning
  for (const gear of getTunableGears(M)) {
    const st = state.wheelInputs[gear.id];
    if (!st) continue;
    push('wheelInput',
      `velocità indipendente ${getIndependentTuning(gear)} [${gear.id}] (asse ${gear.ax.id})`,
      unit(gear.ax.idx),
      gear.ax.cw * st.rpm * PI / 30,
      { axisIdx: gear.ax.idx }
    );
  }
}, 'wheelInput');

Registry.hook('constraints', 80, (M, push, { unit }) => {
  const dg = state.driver && M.gearBy[state.driver.gear];
  if (dg) push('driver', `ruota pilotata ${dg.id} (asse ${dg.ax.id})`, unit(dg.ax.idx), state.driver.w, { axisIdx: dg.ax.idx });
}, 'driver');

Registry.hook('constraints', 90, (M, push, { unit }) => {
  for (const inp of M.inputs) push('input', `input \"${inp.id}\" (asse ${M.axes[inp.idx].id})`, unit(inp.idx), inputOmega(M.axes[inp.idx], state.inputs[inp.id]), { axisIdx: inp.idx });
}, 'input');

Registry.hook('constraints', 100, (M, push, { unit }) => {
  for (const a of M.axes) if (a.def.hold) push('hold', `asse ${a.id} fermo (\"hold\")`, unit(a.idx), 0, { axisIdx: a.idx });
}, 'hold');

Registry.hook('constraints', 110, (M, push) => {
  for (const a of M.axes) if (a.soft) push('rest', a.def.rest === 'world' ? `${a.id} a riposo nel mondo` : `${a.id} a riposo, solidale a ${a.carrier.id}`, a.soft, 0, { axisIdx: a.idx });
}, 'rest');

/* Risolve in ordine; bvals (opzionale) sostituisce i termini noti: serve a calcolare il contributo di ogni ingresso. */
function solveConstraints(M, L, bvals) {
  const sys = makeSystem(M.axes.length);
  L.forEach((c, i) => {
    const ok = sys.add(c.row, bvals ? bvals[i] : c.b);
    c.independent = sys.lastIndependent;
    if (!bvals) c.conflict = !ok;
  });
  return { w: sys.solve(), sys };
}


function solveSpeeds(M) {
  const locked = new Set();
  let L = buildConstraints(M, locked), r = solveConstraints(M, L), w = r.w;
  const limit = Registry.sum('lockable', M);                  // quanti vincoli unilaterali (nottolini) possono bloccarsi
  for (let i = 0; i <= limit; i++) {
    let changed = false;
    for (const e of Registry.entries('lock')) if (e.fn(M, w, locked)) changed = true;
    if (!changed) break;
    L = buildConstraints(M, locked); r = solveConstraints(M, L); w = r.w;
  }
  for (const c of L) if (c.conflict && ['freno', 'driver', 'wheelInput', 'input', 'hold'].includes(c.kind)) warn('cinematica', `vincoli in conflitto: ${c.label} contraddice gli altri vincoli`);
  return { w, locked, cons: L, sys: r.sys };
}

function relationCoeffs(M, outId, insIds) {
  if (!M.axisBy[outId]) throw new Error(`asse di uscita "${outId}" non esiste o non è attivo`);
  return insIds.map((_, k) => {
    const n = M.axes.length, sys = makeSystem(n);
    for (const m of M.meshes) sys.add(m.row, 0);
    insIds.forEach((id, j) => {
      if (!M.axisBy[id]) throw new Error(`asse di ingresso "${id}" non esiste o non è attivo`);
      const r = new Array(n).fill(0); r[M.axisBy[id].idx] = 1; sys.add(r, j === k ? 1 : 0);
    });
    return sys.solve()[M.axisBy[outId].idx];
  });
}

/* ---------- velocità di una ruota rispetto a mondo e a tutti i parent ---------- */
const axName = a => a.id.replace(/^axis_/, '');
const rpmOfW = (a, v) => v * a.cw * 30 / PI;
const fmtRpm = v => { const x = Math.abs(v); return x < 1e-6 ? '0' : (v > 0 ? '↻ ' : '↺ ') + fmt(x, x < 10 ? 4 : x < 1000 ? 2 : 0); };
const chainOf = a => { const o = []; for (let x = a.carrier; x; x = x.carrier) o.push(x); return o; };   // antenati stretti
function commonFrame(a, b) { const cb = new Set(chainOf(b)); for (const x of chainOf(a)) if (cb.has(x)) return x; return null; }   // null = mondo

/* rotazione del corpo di a rispetto al corpo ref (null = mondo): componente lungo l'asse di a e parte ortogonale */
function relToFrame(a, ref, w) {
  const rel = V.sub(omegaOf(a, w), ref ? omegaOf(ref, w) : [0, 0, 0]), raw = V.dot(rel, a.dir);
  return { raw, along: rpmOfW(a, raw), perp: V.len(V.sub(rel, V.mul(a.dir, raw))) * 30 / PI };
}

   function velocityLines(a, w) {
     const out = [{ ref: null, label: 'mondo', ...relToFrame(a, null, w) }], seen = new Set();
     for (const c of chainOf(a)) { seen.add(c); out.push({ ref: c, label: 'vs ' + axName(c), ...relToFrame(a, c, w) }); }
     for (const id of a.def.compare || []) { const c = M.axisBy[id]; if (c && c !== a && !seen.has(c)) out.push({ ref: c, label: 'vs ' + axName(c) + ' (confronto)', ...relToFrame(a, c, w) }); }
     return out;
   }

/* ---------- colonna della tabella ---------- */
function updateTable(w, cons) {
  const direct = {};
  for (const c of cons) if (c.axisIdx !== undefined && c.independent && !direct[c.axisIdx]) direct[c.axisIdx] = c.kind;
  const kindText = { driver: 'imposta (ruota pilotata)', input: 'imposta (input)', hold: 'imposta (hold: ferma)', freno: 'imposta (freno: ferma)', rest: 'a riposo: solidale al carrier' };
  for (const g of M.gears) {
    const row = rowOf[g.id];
    if (!row || row.cells.length < 6) continue;
    let markRef = null, markText = '';
    const k = direct[g.ax.idx];
       if (k) { const rc = k === 'rest' && g.ax.def.rest === 'carrier'; markRef = (rc || (k === 'driver' && g.ax.carrier)) ? g.ax.carrier : null; markText = k === 'rest' ? (rc ? kindText.rest : 'a riposo nel mondo') : kindText[k]; }
    else {
      const src = g.meshInfo ? g : M.gears.find(x => x.ax === g.ax && x.meshInfo);
      if (src) { markRef = src.meshInfo.frame; markText = `rapporto denti con ${src.meshInfo.partner.id}` + (src === g ? '' : ` (via ${src.id}, stesso asse)`); }
    }
    row.cells[5].innerHTML = velocityLines(g.ax, w).map(l => {
      const mk = markText && l.ref === markRef;
      return `<div class="${mk ? 'mk' : ''}">${esc(l.label)}: ${fmtRpm(l.along)}` +
             (l.perp > 1e-6 ? ` <span style="color:var(--bad)">(+⟂ ${fmt(l.perp, 3)})</span>` : '') + (mk ? ' ◀ ' + esc(markText) : '') + '</div>';
    }).join('');
  }
}

/* ---------- spiegazione in console ---------- */
const EXPL = { timer: null };
function explainSoon() { clearTimeout(EXPL.timer); EXPL.timer = setTimeout(explainSpeeds, 150); }

function explainSpeeds() {
  if (!M) return;
  const { w, cons, sys } = solveSpeeds(M);
  updateShowSpeeds();
  const rows = sys.rows(), pivot = new Map(rows.map(r => [r.p, r]));
  const free = M.axes.filter(a => !pivot.has(a.idx) && !a.aimed);
  const L = (...a) => console.log(...a);
  // contributo di ogni ingresso imposto (velocità ≠ 0): il sistema è lineare, quindi w = somma dei contributi
  const contrib = [];
  cons.forEach((c, i) => {
    if (c.b !== 0 && (c.kind === 'driver' || c.kind === 'input')) {
      const bv = cons.map(() => 0); bv[i] = c.b;
      contrib.push({ c, w: solveConstraints(M, cons, bv).w });
    }
  });
  const why = a => {
    const i = a.idx;
    const dir = cons.find(c => c.axisIdx === i && c.independent && c.kind !== 'rest');
    if (dir) return `imposta direttamente: ${dir.label}`;
    const r = pivot.get(i);
    if (!r) return '⚠ GRADO DI LIBERTÀ LIBERO: nessun vincolo la determina, quindi la velocità assoluta è posta a 0';
    const parts = contrib.filter(k => Math.abs(k.w[i]) > 1e-12).map(k => `${k.c.label}: ${fmtRpm(rpmOfW(a, k.w[i]))}`);
    let s = 'ricavata dai vincoli (ingranamenti, ecc.) — ' + (parts.length ? `contributi: ${parts.join(' + ')}` : 'nessun ingresso imposto la muove');
    const fr = free.filter(f => Math.abs(r.c[f.idx]) > 1e-9);
    if (fr.length) s += ` — ⚠ dipende da assi liberi posti a 0: ${fr.map(f => `${f.id} (coeff ${(-r.c[f.idx]).toFixed(3)})`).join(', ')}`; // `
    const rest = cons.find(c => c.axisIdx === i && c.kind === 'rest' && c.independent);
    if (rest) s += ` — fissata per default: ${rest.label}`;
    return s;
  };

  console.groupCollapsed('%c[velocità]%c come si ottiene la velocità di ogni ruota (clic per aprire)', 'color:#d9b45a;font-weight:bold', 'color:inherit');
  L('Vincoli attivi, nell\'ordine in cui vengono applicati (i primi hanno la precedenza):');
  cons.forEach((c, i) => {
    const ax = c.axisIdx !== undefined ? M.axes[c.axisIdx] : null;
    L(`  ${i + 1}. [${c.kind}] ${c.label}` + (ax && c.b !== 0 ? ` = ${fmtRpm(rpmOfW(ax, c.b))} giri/min` : '') +
      (c.independent ? '' : '  → già implicito nei precedenti (nessun effetto)') + (c.conflict ? '  ⚠ IN CONFLITTO con i precedenti' : ''));
  });
  L(free.length ? `⚠ Assi non determinati da nessun vincolo (velocità assoluta posta a 0): ${free.map(a => a.id).join(', ')}. Se uno di questi dovrebbe muoversi, manca un vincolo o un "rest".`
                : 'Tutti gli assi sono determinati dai vincoli.'); // `
  for (const g of M.gears) {
    const a = g.ax, vl = velocityLines(a, w);
    L(`%c${g.id}%c "${g.def.name}" · ${g.type}, z=${g.z}, su ${a.id}` + (a.carrier ? ` (portato da ${chainOf(a).map(c => c.id).join(' → ')})` : ' (asse senza carrier: fisso nel mondo)'),
      'color:#d9b45a;font-weight:bold', 'color:inherit');
    L('    velocità lungo l\'asse: ' + vl.map(l => `${l.label} ${fmtRpm(l.along)}` + (l.perp > 1e-6 ? ` [+⟂ ${fmt(l.perp, 3)}]` : '')).join(' · '));
    L('    asse: ' + why(a));
    if (g.meshInfo) {
      const p = g.meshInfo.partner, f = g.meshInfo.frame, fn = f ? axName(f) : 'mondo';
      const m = M.meshes.find(x => (x.g === g && x.p === p) || (x.g === p && x.p === g));
      const res = m ? m.row.reduce((s, c, k) => s + c * w[k], 0) : NaN;
      L(`    ingranamento con ${p.id} (z ${g.z}:${p.z}): le due velocità sono legate dal rapporto denti, misurate RISPETTO A «${fn}» (il corpo che porta entrambi gli assi). Residuo dell'equazione di presa: ${res.toExponential(2)}`);
      if ((g.ax.carrier || null) === f && (p.ax.carrier || null) === f) {
        const sg = relToFrame(g.ax, f, w), sp = relToFrame(p.ax, f, w), exp = p.z / g.z;
        const got = Math.abs(sp.raw) > 1e-12 ? Math.abs(sg.raw / sp.raw) : null;
        const ok = got === null ? Math.abs(sg.raw) < 1e-12 : Math.abs(got - exp) < 1e-6 * Math.max(1, exp);
        L(`    verifica rispetto a ${fn}: ω_${g.id} = ${fmtRpm(sg.along)}, ω_${p.id} = ${fmtRpm(sp.along)}; |ω_${g.id}/ω_${p.id}| atteso ${p.z}/${g.z} = ${exp.toFixed(5)}, ottenuto ${got === null ? 'n/d (ferme)' : got.toFixed(5)}  ${ok ? '✓' : '✗ ERRORE'}`);
      } else L('    (gli assi non sono portati direttamente dallo stesso corpo: il rapporto va letto sul punto di contatto, vedi il residuo)'); //`
    }
  }
  console.groupEnd();
}

/* >>>>> core/11-scene.js */
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
new BABYLON.HemisphericLight('sky', new V3(0,0,0), scene).intensity = .75;
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

/* >>>>> core/12-ui.js */
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





/* >>>>> core/13-machine-io.js */
/* =====================================================================
   core/13-machine-io.js
   Caricamento della macchina da file (JSON o file macchina), applyMachine
   ===================================================================== */
/* =====================================================================
   7b. CARICAMENTO DELLA MACCHINA DA FILE
   ===================================================================== */
/* Il file può essere JSON puro oppure il file della macchina com'è: "var MACHINE = { ... };" con commenti di riga e di blocco e virgole finali.
   Commenti, virgole finali e il "var MACHINE =" vengono sostituiti da spazi, così le posizioni degli errori restano quelle del file.
   Il testo non viene mai eseguito: è solo JSON.parse (e le espressioni nelle stringhe le valuta il parser interno, non eval). */
function cleanMachineText(src) {
  const n = src.length, out = src.split('');
  const skipString = i => {                     // i punta all'apice di apertura; ritorna l'indice dopo quello di chiusura
    const q = src[i]; i++;
    while (i < n && src[i] !== q && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
    return i + 1;
  };
  for (let i = 0; i < n;) {                      // 1) commenti
    const c = src[i];
    if (c === "'") { const b = src.slice(0, i); throw new Error(`apice singolo alla riga ${b.split('\n').length}, colonna ${i - b.lastIndexOf('\n')}: in JSON le stringhe vogliono i doppi apici`); }
    if (c === '"') i = skipString(i);
    else if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') out[i++] = ' '; }
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2), stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
    } else i++;
  }
  const t = out.join('');
  for (let i = 0; i < n;) {                      // 2) virgole finali (prima di ] o })
    const c = t[i];
    if (c === '"' || c === "'") i = skipString(i);
    else {
      if (c === ',') { let k = i + 1; while (k < n && /\s/.test(t[k])) k++; if (t[k] === ']' || t[k] === '}') out[i] = ' '; }
      i++;
    }
  }
  let text = out.join('');
  const first = text.indexOf('{'), last = text.lastIndexOf('}');   // 3) "var MACHINE =" davanti e ";" dietro
  if (first < 0 || last < first) throw new Error('nel file non c\'è nessun oggetto { … }');
  const blank = x => x.replace(/[^\n]/g, ' '), head = text.slice(0, first), tail = text.slice(last + 1);
  if (head.trim() && !/^\s*(?:(?:var|let|const)\s+)?(?:(?:window|globalThis)\.)?MACHINE\s*=\s*$/.test(head)) throw new Error(`prima dell'oggetto c'è del testo che non è "var MACHINE =": «${head.trim().slice(0, 40)}»`);
  if (tail.replace(/[;\s]/g, '')) throw new Error(`dopo l'oggetto c'è altro testo: «${tail.trim().slice(0, 40)}»`);
  return blank(head) + text.slice(first, last + 1) + blank(tail);
}

function parseMachineText(raw) {
  const text = cleanMachineText(raw.replace(/^\uFEFF/, ' '));
  try { return JSON.parse(text); }
  catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const pos = +m[1], before = text.slice(0, pos), line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
      where = ` (riga ${line}, colonna ${col}: «${(raw.split('\n')[line - 1] || '').trim().slice(0, 70)}»)`;
    }
    throw new Error('JSON non valido: ' + e.message.replace(/ in JSON at position \d+.*$/, '') + where);
  }
}

/* Completa i campi che il motore dà per scontati e controlla i tipi di base; il resto lo controlla validateMachine(). */
function normalizeMachine(m) {
  if (m && typeof m === 'object' && !Array.isArray(m) && !m.axes && m.MACHINE && typeof m.MACHINE === 'object') m = m.MACHINE;   // accetta anche { "MACHINE": {...} }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('il file non contiene un oggetto macchina');
  const out = { title: 'Macchina caricata', show: [], variants: {}, controls: [], consts: {}, axes: [], gears: [], links: [], inputs: [], groups: [], views: [], checks: [], ratios: [], notes: [], ...m };
  for (const k of ['show', 'controls', 'axes', 'gears', 'links', 'inputs', 'groups', 'views', 'checks', 'ratios', 'notes']) if (!Array.isArray(out[k])) throw new Error(`"${k}" deve essere un array`);
  for (const k of ['variants', 'consts']) if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) throw new Error(`"${k}" deve essere un oggetto`);
  if (!out.axes.length) throw new Error('"axes" è vuoto: la macchina non ha assi');
  if (!out.views.length) out.views = [{ id: 'all', label: 'Insieme', auto: true, alpha: 'pi/2-0.7', beta: 1.1, scale: 1.1 }];
  out.title = String(out.title);
  return out;
}

/* Inquadra il modello e ridisegna gli assi X/Y/Z (usata all'avvio e dopo ogni caricamento). */
function fitCameraToModel() {
  const b = modelBounds(), diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  if (!Number.isFinite(diag) || diag <= 0 || diag > 1e7) throw new Error(`Dimensioni del modello non valide (diagonale = ${diag}): controlla i messaggi [mesh]/[verifica]/[ingombro] qui sopra`);
  camera.upperRadiusLimit = diag * 5; camera.maxZ = diag * 20;
  engine.resize();
  goView(MACHINE.views[0]);
  drawAxes(.4 * diag);
  return diag;
}

/* Sostituisce la macchina corrente con `data` (oggetto già letto). Se qualcosa fallisce, rimette la macchina precedente e rilancia l'errore. */
async function applyMachine(data) {
  const next = normalizeMachine(data);
  await Registry.loadFor(next);      // carica i file dei tipi che la nuova macchina usa e che non sono ancora presenti (types/...)
  const old = { machine: MACHINE, state: { ...state }, M };
  try {
    MACHINE = next;
    initStateFromMachine();
    buildStaticPanel();
    rebuild(true, true);
    buildPanel();
    afterRebuild();
    fitCameraToModel();
  } catch (e) {
    MACHINE = old.machine; Object.assign(state, old.state);
    try {
      buildStaticPanel();
      if (M !== old.M) rebuild(true, true);       // il nuovo modello era già stato costruito: si ricostruisce il vecchio
      buildPanel(); afterRebuild();
    } catch (e2) { console.error('[caricamento] impossibile ripristinare la macchina precedente', e2); }
    throw e;
  }
}

function setMachineMsg(text, isError) {
  const m = $('machineMsg'); if (!m) return;
  m.textContent = text; m.style.color = isError ? 'var(--bad)' : 'var(--muted)';
}

async function loadMachineFile(file) {
  setMachineMsg(`Caricamento di «${file.name}»…`);
  try {
    if (file.size > 8e6) throw new Error(`file troppo grande (${(file.size / 1e6).toFixed(1)} MB)`);
    await applyMachine(parseMachineText(await file.text()));
    setMachineMsg(`Caricata «${file.name}»: ${MACHINE.axes.length} assi, ${MACHINE.gears.length} ingranaggi, ${MACHINE.links.length} link.`);
  } catch (e) {
    console.error('[caricamento]', e);
    setMachineMsg(`«${file.name}» non caricato: ${e.message}. La macchina precedente è rimasta attiva (dettagli nel pannello errori / console).`, true);
  }
}

function setupMachineLoader() {
  if (!$('machineLoader')) {                   // se la pagina non ha già i controlli, li crea sotto il titolo
    const box = el('div', { id: 'machineLoader' },
      el('button', { type: 'button', id: 'loadMachineBtn', className: 'sidereal-button', textContent: 'Carica macchina da file…', title: 'Sostituisce la macchina precaricata con quella di un file .json o .js (anche trascinandolo sulla pagina).' }),
      el('button', { type: 'button', id: 'resetMachineBtn', className: 'sidereal-button', textContent: 'Macchina predefinita', title: 'Ricarica la macchina con cui si è aperta la pagina.' }),
      el('input', { type: 'file', id: 'machineFile', accept: '.json,.js,.txt,application/json,text/plain', hidden: true }),
      el('div', { id: 'machineMsg', className: 'small' }));
    box.querySelector('#machineMsg').setAttribute('aria-live', 'polite');
    $('title').insertAdjacentElement('afterend', box);
  }
  const input = $('machineFile');
  $('loadMachineBtn').onclick = () => input.click();
  input.onchange = () => { const f = input.files[0]; input.value = ''; if (f) loadMachineFile(f); };
  $('resetMachineBtn').onclick = async () => {
    try { await applyMachine(JSON.parse(JSON.stringify(DEFAULT_MACHINE))); setMachineMsg('Macchina predefinita ripristinata.'); }
    catch (e) { console.error('[caricamento]', e); setMachineMsg(`Macchina predefinita non ripristinata: ${e.message}`, true); }
  };
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer.files[0]) loadMachineFile(e.dataTransfer.files[0]); });
}

/* >>>>> types/gears/anchor/create.js */
/* types/gears/anchor/create.js
   Ancora Graham (deadbeat) realistica:
   - bracci eleganti
   - pallet con faccia di blocco concentrica (approssimata a più punti)
   - faccia di impulso inclinata
*/
function earClip(poly) {
  const idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const eps = 1e-9;
  const inside = (p, a, b, c) =>
    cross(a,b,p) > eps && cross(b,c,p) > eps && cross(c,a,p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = -1, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length];
      const ib = idx[k];
      const ic = idx[(k + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      const cr = cross(a, b, c);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;
      let ok = true;
      for (const j of idx)
        if (j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c)) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat;
    const ia = idx[(k + idx.length - 1) % idx.length];
    const ib = idx[k];
    const ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function extrudePolygon(poly, w0, w1) {
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i]);
  }
  for (const [a, b, c] of earClip(poly)) {
    T.push([n + a, n + b, n + c], [a, c, b]);
  }
  return { P, T };
}

function discPoly(R, segs = 24) {
  const p = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2 * Math.PI / segs;
    p.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return p;
}

/**
 * Pallet Graham con faccia di blocco concentrica (arco approssimato)
 * e faccia di impulso inclinata.
 */
function palletPoly(armLen, ang, palletW, palletH, isEntry) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = ca, ry = sa;          // radiale
  const tx = -sa, ty = ca;         // tangenziale

  const thick = palletW * 0.7;
  const lockArc = palletH * 0.55;  // lunghezza faccia di blocco
  const impLen  = palletH * 0.50;  // lunghezza faccia di impulso
  const sign = isEntry ? 1 : -1;

  // Approssimazione di un arco concentrico per la locking face
  // (3-4 punti su un raggio leggermente diverso)
  const ptsLocal = [];

  // Lato interno vicino al braccio
  ptsLocal.push([-thick * 0.35, -lockArc * 0.95]);

  // Faccia di blocco (arco → più punti)
  const nArc = 4;
  for (let i = 0; i <= nArc; i++) {
    const t = i / nArc;
    const v = -lockArc + t * lockArc * 1.05;
    // leggero “draw” (sotto-taglio) per simulare la concentrica
    const u = thick * (0.85 + 0.15 * Math.sin(t * Math.PI));
    ptsLocal.push([u, v]);
  }

  // Ginocchio / inizio impulso
  ptsLocal.push([thick * 0.95, 0.05 * palletH]);

  // Faccia di impulso inclinata
  ptsLocal.push([thick * 0.35, impLen]);
  ptsLocal.push([-thick * 0.25, impLen * 0.7]);

  return ptsLocal.map(([u, v]) => {
    const vv = v * sign;
    const x = armLen * rx + u * rx + vv * tx;
    const y = armLen * ry + u * ry + vv * ty;
    return [x, y];
  });
}

function armPoly(ang, armLen, width = 5.0) {
  const r0 = 6.0;
  const half = width / 2;
  const pts = [
    [r0, -half],
    [armLen - 3, -half * 0.75],
    [armLen - 3,  half * 0.75],
    [r0,  half]
  ];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
}

function anchorSolids({ spanDeg, armLen, palletW, palletH, pendLen, bobR, w0, w1, centerAng }) {
  const out = [];
  const span = spanDeg * Math.PI / 180;
  const leftAng  = centerAng - span / 2;
  const rightAng = centerAng + span / 2;
  const midAng  = centerAng;
  const cm = Math.cos(midAng), sm = Math.sin(midAng);

  // Mozzo
  out.push(extrudePolygon(discPoly(7.0, 22), w0, w1));

  // Bracci
  out.push(extrudePolygon(armPoly(leftAng,  armLen), w0, w1));
  out.push(extrudePolygon(armPoly(rightAng, armLen), w0, w1));

  // Pallet
  out.push(extrudePolygon(palletPoly(armLen, leftAng,  palletW, palletH, true),  w0, w1));
  out.push(extrudePolygon(palletPoly(armLen, rightAng, palletW, palletH, false), w0, w1));

  // Asta + bob
  if (pendLen > 0) {
    const rodLocal = [[0, -2.0], [pendLen, -2.0], [pendLen, 2.0], [0, 2.0]];
    const rod = rodLocal.map(([x, y]) => [x * cm - y * sm, x * sm + y * cm]);
    const z0 = w1 + 3;
    const z1 = z0 + 5;
    out.push(extrudePolygon(rod, z0, z1));

    const bob = discPoly(bobR, 28).map(([x, y]) => {
      const xx = x + pendLen;
      return [xx * cm - y * sm, xx * sm + y * cm];
    });
    out.push(extrudePolygon(bob, z0 - 1.5, z1 + 1.5));
  }

  return out;
}

function toRadFromDeg(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v * Math.PI / 180;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s.endsWith('deg')) return parseFloat(s) * Math.PI / 180;
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return n * Math.PI / 180;
  }
  return null;
}

function computeAutoAngle(g) {
  try {
    const model = g.model || g.system || globalThis.model || globalThis.project || globalThis.machine || Registry?.model;
    const axes = model?.axes || g.model?.axes || globalThis.model?.axes || globalThis.project?.axes;
    const gears = model?.gears || [];
    const links = model?.links || [];
    if (!axes) return null;

    const anchorAxisId = g.axis || g.def?.axis || 'anc';
    let driverAxisId = null;

    const myId = g.def?.id || g.id || 'ancora';
    const link = links.find(l => l.driven === myId);
    if (link) {
      const driverGear = gears.find(gg => gg.id === link.driver);
      if (driverGear) driverAxisId = driverGear.axis;
    }
    if (!driverAxisId) driverAxisId = 'esc';

    const aAx = axes.find(a => a.id === anchorAxisId);
    const dAx = axes.find(a => a.id === driverAxisId);
    if (!aAx || !dAx) return null;

    const aPos = aAx.place?.at || [0, 0, 0];
    const dPos = dAx.place?.at || [0, 0, 0];
    return Math.atan2(dPos[1] - aPos[1], dPos[0] - aPos[0]);
  } catch (e) {
    return null;
  }
}

Registry.gear('anchor', {
  noRadiusCheck: true,
  radius: g => (g.armLen ?? 38) + (g.palletW ?? 12),
  solids: g => {
    const span    = g.span    ?? 90;
    const armLen  = g.armLen  ?? 38;
    const palletW = g.palletW ?? 12;
    const palletH = g.palletH ?? 9;
    const pendLen = g.pendLen ?? 160;
    const bobR    = g.bobR    ?? 14;
    const w0 = g.w?.[0] ?? -2;
    const w1 = g.w?.[1] ??  2;

    let raw = g.def?.relPos;
    if (raw === undefined) raw = g.def?.centerAng;
    let centerAng;

    if (typeof raw === 'string' && raw.toLowerCase().trim() === 'auto') {
      centerAng = computeAutoAngle(g);
      if (centerAng === null) centerAng = -Math.PI;
    } else if (raw !== undefined) {
      const r = toRadFromDeg(raw);
      centerAng = r !== null ? r : -Math.PI;
    } else {
      centerAng = computeAutoAngle(g);
      if (centerAng === null) centerAng = -Math.PI;
    }

    return anchorSolids({
      spanDeg: span, armLen, palletW, palletH,
      pendLen, bobR, w0, w1, centerAng
    });
  },
  cacheKey: g => [g.span, g.armLen, g.palletW, g.palletH, g.pendLen, g.bobR, g.def?.relPos, g.def?.centerAng, g.w],
  sigKey:   g => [g.span, g.armLen, g.palletW, g.palletH, g.pendLen, g.bobR, g.def?.relPos, g.def?.centerAng, g.w]
});

/* >>>>> types/gears/anchor/solve.js */
Registry.gear('anchor', {
  validate(g, w, { E, isVec }) {
    if (!g.def) g.def = {};
    if (!g.def.color && !g.color) g.def.color = "#66ccff";
    if (!g.color) g.color = g.def.color;
  },

  resolve(g, { ev }) {
    const evalParam = (val, defVal) => {
      if (val === undefined || val === null) return defVal;
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        try {
          return ev(val); // valuta "pendulumLength" → valore live dello slider
        } catch (e) {
          const parsed = parseFloat(val);
          return isNaN(parsed) ? defVal : parsed;
        }
      }
      return defVal;
    };

    // IMPORTANTE: non sovrascrivere g.def.pendulumLength (deve restare la stringa del controllo)
    // altrimenti al rebuild successivo non viene più rivalutato lo slider.
    const src = g.def || {};
    g.pendLen = evalParam(
      g.pendulumLength ?? src.pendulumLength ?? g.pendLen ?? src.pendLen,
      160
    );
    g.armLen  = evalParam(g.armLen  ?? src.armLen,  38);
    g.span    = evalParam(g.span    ?? src.span,    90);
    g.palletW = evalParam(g.palletW ?? src.palletW, 12);
    g.palletH = evalParam(g.palletH ?? src.palletH,  9);
    g.bobR    = evalParam(g.bobR    ?? src.bobR,    14);
  }
});

/* >>>>> types/gears/anchor_CS/create.js */
/* =====================================================================
   types/gears/anchor_CS/create.js
   Ancora di Graham con pendolo (type "anchor_CS")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
   ---------------------------------------------------------------------
   Pezzi: mozzo, due bracci dritti dal mozzo (lunghezza e apertura regolabili: armLength, armAngle), due pallette (forma calcolata dal link:
   faccia di riposo ad arco centrato sul perno, faccia di impulso inclinata), eventuali raccordi fra punta dei bracci e pallette, asta e
   lente del pendolo. L'asta e la lente stanno in un piano più avanti rispetto alla piastra (rodGap), lungo la retta A→W (verso la ruota,
   cioè verso Z− se l'ancora sta sopra la ruota). Il foro per l'asse (a D, se solidale) lo fa il simulatore sul solo mozzo: gli altri pezzi
   sono marcati noBore.
   ===================================================================== */

/* Triangolazione per orecchie di un poligono semplice antiorario (copia privata di questo tipo). */
function earClip_aCS(poly) {
  const n = poly.length, idx = poly.map((_, i) => i), tris = [], eps = 1e-9;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) > eps && cr(b, c, p) > eps && cr(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = 0, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], c = cr(poly[ia], poly[ib], poly[ic]);
      if (Math.abs(c) < flatV) { flatV = Math.abs(c); flat = k; }
      if (c <= eps) continue;
      let ok = true; for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], poly[ia], poly[ib], poly[ic])) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat, ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return n >= 3 ? tris : [];
}

/* Prisma retto di un poligono fra w0 e w1 lungo l'asse locale z (non viene forato dal simulatore). */
function extrude_aCS(poly, w0, w1) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip_aCS(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T, noBore: true };
}

Registry.gear('anchor_CS', {
  solids(g) {
    const A = g.graham, c = g.anchorCS, [w0, w1] = g.w;
    if (!A || !c) return [cylinderSolid(c ? c.hubR : 5, w0, w1, 32)];             // senza link: solo il mozzo
    const ca = Math.cos(A.deltaA), sa = Math.sin(A.deltaA), loc = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];   // sistema dell'ancora → locale
    const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const bar = (p, q, hw) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * hw, ny = dx / l * hw;
      return [[p[0] - nx, p[1] - ny], [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny], [p[0] + nx, p[1] + ny]].map(loc); };
    const out = [];
    out.push(extrude_aCS(A.entry.map(loc), w0, w1), extrude_aCS(A.exit.map(loc), w0, w1));                      // pallette
    // bracci: estremità posteriori delle pallette (dove il braccio "naturale" le raggiunge) e bracci scelti dall'utente
    const mE = pol(A.rho - A.depth / 2, A.aR + A.arcExtra), mX = pol(A.rho + A.depth / 2, A.aL - A.arcExtra);
    const half = c.armAng != null ? Math.abs(c.armAng) * Math.PI / 360 : A.aR + A.arcExtra;                      // semi-apertura (rad)
    const lE = c.armLen != null ? c.armLen : Math.hypot(mE[0], mE[1]), lX = c.armLen != null ? c.armLen : Math.hypot(mX[0], mX[1]);
    const tE = pol(lE, half), tX = pol(lX, -half);                                                               // punte dei bracci (ingresso a +, uscita a −)
    out.push(extrude_aCS(bar([0, 0], tE, c.armW / 2), w0, w1), extrude_aCS(bar([0, 0], tX, c.armW / 2), w0, w1));
    if (c.armConn) {                                                                                             // raccordi punta del braccio → paletta
      if (Math.hypot(tE[0] - mE[0], tE[1] - mE[1]) > 0.05) out.push(extrude_aCS(bar(tE, mE, c.armW / 2), w0, w1));
      if (Math.hypot(tX[0] - mX[0], tX[1] - mX[1]) > 0.05) out.push(extrude_aCS(bar(tX, mX, c.armW / 2), w0, w1));
    }
    const z0 = w1 + c.rodGap, z1 = z0 + Math.max(1, c.rodW * 0.8), zm = (z0 + z1) / 2;
    out.push(extrude_aCS(bar([0, 0], [A.L, 0], c.rodW / 2), z0, z1));                                           // asta lungo A→W
    const [bx, by] = loc([A.L, 0]), bob = cylinderSolid(c.bobR, zm - c.bobT / 2, zm + c.bobT / 2, 48, bx, by);   // lente
    bob.noBore = true; out.push(bob);
    out.push(cylinderSolid(c.hubR, w0, w1, 48));                                                                 // mozzo (foro per l'asse)
    return out;
  },
  cacheKey: g => [g.graham, g.anchorCS, g.pendLen],
  sigKey: g => []
});

/* >>>>> types/gears/anchor_CS/solve.js */
/* =====================================================================
   types/gears/anchor_CS/solve.js
   Ancora di Graham con pendolo (type "anchor_CS"), da usare con il link "graham_escapement_CS"
   Metà "COME SI RISOLVE" del tipo: validazione e parametri. Il disegno è in create.js; geometria delle pallette e fisica sono nel link.
   ---------------------------------------------------------------------
   JSON:  { "id": "ancora_CS", "type": "anchor_CS", "axis": "...", "pendulumLength": "pendulumLength", "pos": 0, "thickness": 4 }
   Obbligatori:  "pendulumLength" = lunghezza del pendolo, mm (numero o espressione: va bene lo slider);
                 posizione e spessore della piastra dell'ancora ("w" oppure "pos"+"thickness"): di norma nello stesso piano della ruota.
   Facoltativi (numeri o espressioni):
     BRACCI (solo aspetto: non cambiano il funzionamento, che dipende dalle pallette):
       "armLength"    lunghezza dei due bracci dal perno, mm (default: fino alle pallette)
       "armAngle"     angolo di APERTURA totale fra i due bracci, gradi (default: ~106°, fino alle pallette)
       "armWidth"     larghezza dei bracci, mm (3)
       "armConnector" false = niente raccordi fra la punta dei bracci e le pallette (true: se i bracci non arrivano alle pallette,
                      un piccolo raccordo li collega, così l'ancora resta un solo pezzo)
     PENDOLO:  "bobRadius" raggio della lente (10)   "bobThickness" spessore della lente (4)   "rodWidth" larghezza dell'asta (2,4)
     ALTRO:    "hubRadius" raggio del mozzo (5)
               "rodGap" spazio assiale fra piastra e asta del pendolo (1): l'asta sta in un piano più avanti, così non urta la ruota
   Le pallette (forma, posizione, facce di riposo e di impulso) NON si specificano: le calcola il link da raggio, denti e interasse.
   Il pendolo pende lungo la retta fra il perno dell'ancora e il centro della ruota (A→W): con gravità verso Z− l'ancora sta SOPRA
   la ruota (stesse x e y, z maggiore) e gli assi sono orizzontali.
   ===================================================================== */
Registry.gear('anchor_CS', {
  meshWith: [],                // non ingrana
  noRadiusCheck: true,         // il raggio non è un dato di partenza: le pallette stanno dove le mette il link

  radius: () => 10,            // provvisorio

  validate(g, w, { E, isVec }) {
    if (g.pendulumLength === undefined) E(`${w}: manca "pendulumLength" (lunghezza del pendolo, mm)`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
    for (const k of ['pendulumLength', 'bobRadius', 'bobThickness', 'rodWidth', 'armWidth', 'armLength', 'armAngle', 'hubRadius', 'rodGap'])
      if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
    if (g.armConnector !== undefined && typeof g.armConnector !== 'boolean') E(`${w}: "armConnector" deve essere true o false`);
  },

  resolve(g, { ev }) {
    const d = g.def, n = (v, def) => v !== undefined ? ev(v) : def;
    g.pendLen = ev(d.pendulumLength);
    g.anchorCS = { bobR: n(d.bobRadius, 10), bobT: n(d.bobThickness, 4), rodW: n(d.rodWidth, 2.4), armW: n(d.armWidth, 3), hubR: n(d.hubRadius, 5), rodGap: n(d.rodGap, 1),
                   armLen: n(d.armLength, null), armAng: n(d.armAngle, null), armConn: d.armConnector !== false };
    return `, pendolo ${+g.pendLen.toFixed(1)} mm`;
  }
});

/* >>>>> types/gears/bevel/create.js */
/* =====================================================================
   types/gears/bevel/create.js
   Ingranaggio conico (type "bevel")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
function bevelGear(z, m, delta, rho, k0) {
  const R = m * z / 2, wp = R / Math.tan(delta);
  const zVirtual = z / cos(delta), rVirtual = R / cos(delta);
  const prof = toothProfile(zVirtual, m, 8), pitchV = 2 * PI / zVirtual, P = [];
  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / cos(delta);
      const s = r - rVirtual;
      const q = R + s * cos(delta);
      P.push([q * cos(t), q * sin(t), wp - s * sin(delta)]);
    }
  }
  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  return loft(P.map(p => p.map(v => v * k0)), P, [0, 0, k0 * wMean], [0, 0, wMean]);
}

Registry.gear('bevel', {
  solids(g) {
    const out = [bevelGear(g.z, g.m, g.delta, g.rho, g.def.k0 || 0.7)], pl = g.def.plate;
    if (pl) { const wp = g.r / Math.tan(g.delta); out.push(cylinderSolid(pl.k * g.r, wp + pl.from, wp + pl.to, pl.n || 48)); }
    return out;
  },
  cacheKey: g => [g.delta, g.def.plate, g.def.k0],
  markerZ: g => g.r * 0.2              // senza "w" il marker sta a 0,2·r lungo l'asse
});

/* >>>>> types/gears/bevel/solve.js */
/* =====================================================================
   types/gears/bevel/solve.js
   Ingranaggio conico (type "bevel")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('bevel', {
  meshWith: ['bevel'],
  minTeeth: 3,

  validate(g, w, { E, W, isVec, partnerOf }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (g.apexW === undefined) E(`${w}: manca "apexW" (posizione dell'apice lungo l'asse)`);
    if (g.side !== undefined && g.side !== 1 && g.side !== -1) E(`${w}: "side" deve essere 1 oppure -1`);
    if (!g.meshWith && !partnerOf[g.id] && g.delta === undefined) W(`${w}: conico senza ingranaggio accoppiato e senza "delta": userò 45°. Aggiungi "delta": gradi nel JSON`);
  },

  /* Apice del cono e direzione dell'asse (passo 6 di resolveModel). Ritorna un testo per il log. */
  resolve(g, { ev }) {
    g.apexW = ev(g.def.apexW);
    g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    g.e = V.mul(g.ax.dir, g.side);
    return `, apexW=${+g.apexW.toFixed(2)} (apice ${fmtV(g.apex)}), side=${g.side}`;
  },

  /* Semiangolo del cono: dalla coppia, oppure da "delta" del JSON (default 45°). */
  afterPairs(g, { ev }) {
    if (g.partner) {
      const p = g.partner, cs = V.dot(g.e, p.e);
      g.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), p.z / g.z + cs);
      step('conico', `${g.id}: δ=${(g.delta * 180 / PI).toFixed(3)}° calcolato dalla coppia con ${p.id}`);
    }
    // conici senza ingranaggio accoppiato: "delta" in gradi dal JSON (default 45°). Senza questo la geometria diventerebbe NaN.
    if (g.delta === undefined) {
      CTX.where = `conico "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = ev(g.def.delta) * PI / 180;
        step('conico', `${g.id}: nessun ingranaggio accoppiato, uso "delta" del JSON = ${(g.delta * 180 / PI).toFixed(3)}°`);
      } else {
        g.delta = PI / 4;
        warn('conico', `${g.id}: nessun ingranaggio accoppiato e nessun "delta" nel JSON: uso 45° (aggiungi "delta": gradi per evitare questo avviso)`);
      }
    }
  },

  /* Punto di contatto di due conici: sulla bisettrice dei coni. Con altri partner → null (contatto cilindrico). */
  contact(g, p) {
    if (p.type !== 'bevel') return null;
    const gh = V.unit(V.add(V.mul(g.e, Math.sin(p.delta)), V.mul(p.e, Math.sin(g.delta))));
    const apexDist = V.len(V.sub(g.apex, p.apex));
    step('ingranamento', `${g.id} (conico, z=${g.z}, δ=${(g.delta * 180 / PI).toFixed(2)}°) ⇄ ${p.id} (conico, z=${p.z}, δ=${(p.delta * 180 / PI).toFixed(2)}°): distanza fra gli apici ${apexDist.toFixed(3)} mm`);
    if (apexDist > 1e-6) warn('ingranamento', `Coppia conica ${g.id}–${p.id}: gli apici non coincidono (distanza ${apexDist.toFixed(3)} mm): ${g.id} apice ${fmtV(g.apex)}, ${p.id} apice ${fmtV(p.apex)}`);
    return { X: V.add(g.apex, V.mul(gh, g.r / Math.sin(g.delta))), cg: V.unit(V.perp(gh, g.e)), cp: V.unit(V.perp(gh, p.e)) };
  },

  validateModel(g, B) {
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) B(`conico ${g.id}: delta non valido (${g.delta})`);
    if (!g.apex.every(Number.isFinite)) B(`conico ${g.id}: apice non finito`, g.apex);
  }
});

/* >>>>> types/gears/bevel_DS/create.js */
/* =====================================================================
   types/gears/bevel_DS/create.js
   Ingranaggio conico DS (type "bevel_DS")
   Metà "COME SI CREA" del tipo: geometria e mesh.
   La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
function bevelGear(z, m, delta, rho, k0) {
  const R = m * z / 2, wp = R / Math.tan(delta);
  const zVirtual = z / cos(delta), rVirtual = R / cos(delta);
  const prof = toothProfile(zVirtual, m, 8), pitchV = 2 * PI / zVirtual, P = [];
  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / cos(delta);
      const s = r - rVirtual;
      const q = R + s * cos(delta);
      // FIX: wp + s * sin(delta) mette l'apice a z=0 e fa crescere il dente verso +z.
      // Questo allinea perfettamente la mesh visiva con l'apexW calcolato in solve.js.
      P.push([q * cos(t), q * sin(t), wp + s * sin(delta)]);
    }
  }
  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  return loft(P.map(p => p.map(v => v * k0)), P, [0, 0, k0 * wMean], [0, 0, wMean]);
}

Registry.gear('bevel_DS', {
  solids(g) {
    // k0 viene risolto in solve.js: può derivare da "k0", da "thickness", o default 0.7
    const k0 = g.k0 !== undefined ? g.k0 : 0.7;
    const out = [bevelGear(g.z, g.m, g.delta, g.rho, k0)], pl = g.def.plate;
    if (pl) {
      const wp = g.r / Math.tan(g.delta);
      out.push(cylinderSolid(pl.k * g.r, wp + pl.from, wp + pl.to, pl.n || 48));
    }
    return out;
  },
  cacheKey: g => [g.delta, g.def.plate, g.k0, g.def.bore, g.def.flat, g.def.flatAngle],
  markerZ: g => g.r * 0.2
});
/* >>>>> types/gears/bevel_DS/solve.js */
/* =====================================================================
   types/gears/bevel_DS/solve.js
   Ingranaggio conico DS (type "bevel_DS")
   Metà "COME SI RISOLVE": validazione, parametri, cinematica.
   La geometria è in create.js.
   ===================================================================== */

/* Intersezione di due rette 3D. null se parallele o sghembe. */
function bevelIntersectAxes(ax1, ax2, tol = 1e-3) {
  const d1 = V.unit(ax1.dir), d2 = V.unit(ax2.dir);
  const w0 = V.sub(ax1.O, ax2.O);
  const a = V.dot(d1, d1), b = V.dot(d1, d2), c = V.dot(d2, d2);
  const dd = V.dot(d1, w0), ee = V.dot(d2, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-10) return null;
  const t = (b * ee - c * dd) / denom;
  const s = (a * ee - b * dd) / denom;
  const p1 = V.add(ax1.O, V.mul(d1, t));
  const p2 = V.add(ax2.O, V.mul(d2, s));
  if (V.len(V.sub(p1, p2)) > tol) return null;
  return V.mul(V.add(p1, p2), 0.5);
}

/* Calcola l'apice e i denti (se non specificati) per una coppia di conici. */
function resolveBevelPair(g, p) {
  if (g._bpDone && p._bpDone) return;

  // 1. Apice comune (intersezione degli assi)
  let A = bevelIntersectAxes(g.ax, p.ax);
  if (!A) {
    warn('conico', `${g.id}–${p.id}: assi non incidenti, uso l'origine di ${g.id} come apice`);
    A = g.ax.O;
  }

  g.apexW = V.dot(V.sub(A, g.ax.O), g.ax.dir);
  g.apex = A;
  p.apexW = V.dot(V.sub(A, p.ax.O), p.ax.dir);
  p.apex = A;

  // 2. Angolo tra gli assi
  const cs = V.dot(g.e, p.e);
  const cosS = Math.max(-1, Math.min(1, cs));
  const sinS = Math.sqrt(Math.max(0, 1 - cosS * cosS));
  const Sigma = Math.acos(cosS);

  // 3. Determinazione di z (numero di denti)
  const hasPosG = g._pos !== undefined;
  const hasPosP = p._pos !== undefined;
  let calculated = false;

  if (g._teeth === undefined && p._teeth === undefined && hasPosG && hasPosP) {
    const wp_g = g.side * (g._pos - g.apexW);
    const wp_p = p.side * (p._pos - p.apexW);

    if (wp_g > 1e-6 && wp_p > 1e-6 && sinS > 1e-6) {
      const k = wp_g / wp_p;
      // Calcolo z reali
      const tanDg = (1 / k - cosS) / sinS;
      const tanDp = (k - cosS) / sinS;
      const r_g = wp_g * tanDg;
      const r_p = wp_p * tanDp;
      const z_g_real = 2 * r_g / g.m;
      const z_p_real = 2 * r_p / p.m;

      // Arrotondamento a interi
      const z_g = Math.max(3, Math.round(z_g_real));
      const z_p = Math.max(3, Math.round(z_p_real));
      g.z = z_g;
      p.z = z_p;

      // Ricalcolo di delta con z interi
      const u = z_g / z_p;
      const tanDg_new = sinS / (1 / u + cosS);
      const tanDp_new = sinS / (u + cosS);
      g.delta = Math.atan(tanDg_new);
      p.delta = Math.atan(tanDp_new);

      // Ricalcolo della posizione esatta per far toccare le ruote
      const wp_g_new = (g.m * z_g / 2) / tanDg_new;
      const wp_p_new = (p.m * z_p / 2) / tanDp_new;
      g._pos = g.apexW + g.side * wp_g_new;
      p._pos = p.apexW + p.side * wp_p_new;

      calculated = true;
      step('conico', `${g.id}–${p.id}: z=${g.z},${p.z} calcolati da pos (reali ${z_g_real.toFixed(2)}, ${z_p_real.toFixed(2)})`);
    }
  }

  if (!calculated) {
    if (g._teeth !== undefined) g.z = g._teeth;
    if (p._teeth !== undefined) p.z = p._teeth;

    if (g.z !== undefined && p.z !== undefined) {
      const u = g.z / p.z;
      g.delta = Math.atan(sinS / (1 / u + cosS));
      p.delta = Math.atan(sinS / (u + cosS));
    } else {
      warn('conico', `${g.id}–${p.id}: impossibile calcolare i denti. Uso z=20 di default.`);
      g.z = 20; p.z = 20;
      g.delta = Math.atan(sinS / (1 + cosS));
      p.delta = Math.atan(sinS / (1 + cosS));
    }
  }

  g._bpDone = true;
  p._bpDone = true;
}

Registry.gear('bevel_DS', {
  meshWith: ['bevel_DS'],
  minTeeth: 3,

  validate(g, w, { E, W, partnerOf }) {
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (g.side !== undefined && g.side !== 1 && g.side !== -1) {
      E(`${w}: "side" deve essere 1 oppure -1`);
    }
    const hasPartner = !!partnerOf[g.id];
    const hasApexW = g.apexW !== undefined;
    const hasPos = g.pos !== undefined || g.at !== undefined;

    if (hasApexW && hasPos) E(`${w}: specifica "pos" OPPURE "apexW", non entrambi`);
    if (!hasApexW && !hasPos && !hasPartner) E(`${w}: manca "pos" (o "apexW") per definire la posizione`);

    if (g.free !== undefined && typeof g.free !== 'boolean') E(`${w}: "free" deve essere boolean`);
    if (g.bore !== undefined && g.bore !== false) {
      const b = g.bore;
      if (!(typeof b === 'number' || typeof b === 'string' || (typeof b === 'object' && b !== null && b.r !== undefined))) {
        E(`${w}: "bore" deve essere numero, false oppure {r:...}`);
      }
    }
    if (g.flat !== undefined && g.flat !== false) {
      if (typeof g.flat !== 'number' && typeof g.flat !== 'string') {
        E(`${w}: "flat" deve essere numero fra 0 e 1, oppure false`);
      }
    }
    if (g.flatAngle !== undefined && typeof g.flatAngle !== 'number' && typeof g.flatAngle !== 'string') {
      E(`${w}: "flatAngle" deve essere numero (gradi)`);
    }
  },

  resolve(g, { ev }) {
    g.e = V.mul(g.ax.dir, g.side || 1);

    if (g.def.apexW !== undefined) {
      g.apexW = ev(g.def.apexW);
      g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    } else if (g.def.pos !== undefined) {
      g._pos = ev(g.def.pos);
    } else if (g.def.at !== undefined) {
      g._pos = ev(g.def.at);
    }

    if (g.def.k0 !== undefined) g.k0 = ev(g.def.k0);
    if (g.def.thickness !== undefined) g._thickness = ev(g.def.thickness);
    if (g.def.teeth !== undefined) g._teeth = ev(g.def.teeth);

    g.free = g.def.free === true;
    if (g.def.bore !== undefined) {
      const b = g.def.bore;
      if (b === false) g.bore = false;
      else if (typeof b === 'object' && b !== null) g.bore = { r: ev(b.r) };
      else g.bore = ev(b);
    }
    if (g.def.flat !== undefined && g.def.flat !== false) {
      g.flat = ev(g.def.flat);
      g.flatAngle = g.def.flatAngle !== undefined ? ev(g.def.flatAngle) : 0;
    }

    return `, ${g.apexW !== undefined ? 'apexW='+g.apexW.toFixed(2) : (g._pos!==undefined ? 'pos='+g._pos.toFixed(2) : 'auto')}`;
  },

  afterPairs(g) {
    if (g.partner && !g._bpDone) resolveBevelPair(g, g.partner);

    if (g.delta === undefined) {
      CTX.where = `conico "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = g.def.delta * PI / 180;
      } else {
        g.delta = PI / 4;
      }
    }

    if (g.k0 === undefined) {
      if (g._thickness !== undefined && g.z !== undefined && g.delta !== undefined) {
        const wp = (g.m * g.z / 2) / Math.tan(g.delta);
        if (wp > 0) g.k0 = Math.max(0.1, Math.min(0.95, 1 - g._thickness / wp));
      } else {
        g.k0 = 0.7;
      }
    }
  },

  contact(g, p) {
    if (p.type !== 'bevel_DS') return null;
    if (!g.apex || !p.apex) return null;
    const gh = V.unit(V.add(V.mul(g.e, Math.sin(p.delta)), V.mul(p.e, Math.sin(g.delta))));
    const apexDist = V.len(V.sub(g.apex, p.apex));
    if (apexDist > 1e-6) {
      warn('ingranamento', `Coppia conica ${g.id}–${p.id}: gli apici non coincidono (distanza ${apexDist.toFixed(3)} mm)`);
    }
    return {
      X: V.add(g.apex, V.mul(gh, g.r / Math.sin(g.delta))),
      cg: V.unit(V.perp(gh, g.e)),
      cp: V.unit(V.perp(gh, p.e))
    };
  },

  validateModel(g, B) {
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) {
      B(`conico ${g.id}: delta non valido (${g.delta})`);
    }
    if (!g.apex) B(`conico ${g.id}: apice non calcolato`);
    else if (!g.apex.every(Number.isFinite)) B(`conico ${g.id}: apice non finito`);
  }
});
/* >>>>> types/gears/bevel_MT/create.js */
/* =====================================================================
   types/gears/bevel_MT/create.js
   Ingranaggio conico (type "bevel_MT")
   Metà "COME SI CREA": geometria e mesh. La metà "COME SI RISOLVE"
   (validazione, parametri, cinematica) è in bevel_MT/solve.js.
   =====================================================================
   QUESTO È IL FILE ORIGINALE, RIGA PER RIGA, CAMBIA SOLO DA DOVE
   PRENDE I PARAMETRI. Niente base piatta, niente mozzo, niente
   proiezione, niente appiattimento.
   Originale:
     bevelGear(g.z, g.m, g.delta, g.rho, g.def.k0 || 0.7)
     pl = g.def.plate
   Ora:
     bevelMTGear(g.z, g.m, g.delta, g.rho, g.k0)
     pl = g.plate (messa da solve.js, che la calcola da pos+thickness)
   con fallback a g.def.k0 / g.def.plate se solve non è ancora passato.
   Il "centro della conica" NON è un parametro: wMean è la media degli
   Z dei punti P, e i due centri del loft sono [0,0,k0*wMean] e
   [0,0,wMean]. Non c'è niente da calcolare, si ricalcola da solo
   da P. Per questo cambiare la sorgente dei parametri è 2 righe.
   PERCHÉ LA VERSIONE PIATTA NON INGRANAVA:
   Nell'originale a s=0 (punto primitivo) Z = wp = R / tan(delta).
   È lì che i denti delle due ruote si devono incontrare, sullo stesso
   punto del cono primitivo, con i fianchi per l'apice.
   Nella versione piatta avevo messo Z = Z_base = max(Z_conico) = wp +
   1.25*m*sin(delta) per tutta la faccia posteriore, e Z = Z_base -
   thickness per quella anteriore. Quindi a s=0 la Z non era più wp,
   ma wp + 1.25*m*sin(delta) (per m=2, delta=45°: +1.77 mm).
   I denti erano spostati di 1.77 mm lungo l'asse rispetto al cono
   primitivo: passano uno accanto all'altro senza toccarsi, con il
   vuoto che si vede nella foto. Non è un problema di fase, è che
   la geometria non sta più sul cono primitivo.
   TRADE-OFF, DETTO CHIARO:
   - Originale (questo file): ingrana esatto, denti sulla faccia
     conica, nessun bordo extra. MA la base NON è piatta, è conica
     (fan al centro). Per stampare si mette brim / supporti.
   - Base piatta + niente bordo + ingranamento esatto: non si può
     avere tutti e tre con un semplice loft. La base piatta sposta
     i punti fuori dal cono primitivo (e allora non ingrana), oppure
     serve un disco extra che diventa il bordo che non vuoi.
   Se vuoi che ingrani, usa questo file. La base piatta esatta è
   incompatibile con la conica esatta.
   ===================================================================== */
function bevelMTGear(z, m, delta, rho, k0) {
  const R = m * z / 2, wp = R / Math.tan(delta);
  const zVirtual = z / Math.cos(delta), rVirtual = R / Math.cos(delta);
  const prof = toothProfile(zVirtual, m, 8), pitchV = 2 * Math.PI / zVirtual, P = [];
  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / Math.cos(delta);
      const s = r - rVirtual;
      const q = R + s * Math.cos(delta);
      P.push([q * Math.cos(t), q * Math.sin(t), wp - s * Math.sin(delta)]);
    }
  }
  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  return loft(P.map(p => p.map(v => v * k0)), P, [0, 0, k0 * wMean], [0, 0, wMean]);
}

Registry.gear('bevel_MT', {
  solids(g) {
    const k0 = (g.k0 !== undefined && Number.isFinite(g.k0)) ? g.k0 : (g.def && g.def.k0 !== undefined ? g.def.k0 : 0.7);
    const out = [bevelMTGear(g.z, g.m, g.delta, g.rho, k0)];
    const pl = (g.plate !== undefined ? g.plate : (g.def ? g.def.plate : undefined));
    if (pl) { const wp = g.r / Math.tan(g.delta); out.push(cylinderSolid(pl.k * g.r, wp + pl.from, wp + pl.to, pl.n || 48)); }
    return out;
  },
  cacheKey: g => [g.delta, g.k0, g.plate, g.def ? g.def.k0 : null],
  markerZ: g => g.r * 0.2
});

/* >>>>> types/gears/bevel_MT/solve.js */
/* =====================================================================
   types/gears/bevel_MT/solve.js
   Ingranaggio conico (type "bevel_MT")
   Metà "COME SI RISOLVE": validazione, parametri, cinematica.
   Geometria in bevel_MT/create.js. Copia rinominata di "bevel": non
   caricare insieme al vecchio "bevel" se definisce gli stessi helper.
   ---------------------------------------------------------------------
   NOTA RINOMINA: nel JSON le ruote devono avere "type": "bevel_MT"
   (non "bevel"), altrimenti il vecchio tipo "bevel" le prende in carico.
   Anche "meshWith" deve puntare a una ruota bevel_MT.

   CANONICO (quello da usare): per OGNI ruota della coppia
     "axis":      id dell'asse (già esistente)
     "module":    modulo comune m, stesso per le due ruote (es. "module")
     "pos":       coordinata w della prima faccia, come per le cilindriche:
                  la ruota occupa [pos, pos + thickness] lungo il suo asse
     "thickness": spessore assiale della ruota = distanza fra le due facce
     "meshWith":  id dell'altra ruota (su una delle due basta)
   NON dare "teeth", "apexW", "pitchW", "w", "k0": vengono calcolati.
   Solo asse + pos + thickness + modulo. Nessun calcolo da parte tua.

   COSA SIGNIFICANO pos/thickness PER UN CONICO:
   La ruota occupa [pos, pos+thickness] sullo stesso righello w usato per
   le cilindriche (stessa coordinata di "apexW" e delle "parts" degli assi).
   L'apice deve stare FUORI da quell'intervallo, altrimenti la ruota
   attraverserebbe l'apice. La faccia lontana dall'apice è il piano
   primitivo (dove si misura R = m*z/2), la faccia vicina all'apice è la
   faccia anteriore (piccola). Quindi:
     pitchW = estremità lontana dall'apice = pos+thickness se side=+1,
              pos se side=-1
     wp = |pitchW - apexW| = distanza apice -> piano primitivo
     k0 = 1 - thickness/wp  (rapporto omotetia rispetto all'apice)
   "thickness" resta esatto. "pos" invece si può spostare di un poco
   (posShift, in genere < 0.5 mm) per far tornare denti interi: è
   inevitabile con assi fissi, vedi sotto. "k0" si adatta di conseguenza.
   "plate" NON è più un secondo solido separato: il corpo è già pieno
   da faccia a faccia (vedi create.js, versione stampabile). Se lo dai,
   resta solo per compatibilità e viene ignorato per la forma.

   PERCHÉ pos NON PUÒ RESTARE ESATTO CON DENTI INTERI:
   Siano O* intersezione assi, Sigma angolo fra direzioni apice->ruota,
   wp_i, L distanza di cono comune, delta_i semiangolo cono.
   wp_i = L*cos(delta_i), R_i = L*sin(delta_i),
   delta_1+delta_2 = Sigma, R_i = m*z_i/2.
   Con pos+thickness+modulo si ricava una soluzione CONTINUA (z_cont non
   intero). Arrotondando z a interi, la geometria esatta da z interi +
   Sigma + m dà wp_esatto diverso da wp chiesto. Il codice tiene
   "thickness" esatto e sposta TUTTO l'intervallo [pos, pos+thickness]
   di posShift = pos_esatto - pos_chiesto, e ricalcola k0 = 1-thickness/wp_esatto.
   Se posShift è grande, pos/thickness chiesti erano incompatibili con
   denti interi a quel modulo: cambia pos o modulo.

   free / bore (come per "spur", interpretati dal core, non da questo file):
     "free":  false = ruota solidale al suo asse (gira con l'asse),
              true  = ruota libera (può girare indipendente dall'asse).
              Se manca, il core decide il default (come per spur).
     "bore":  false = senza foro; numero o stringa = raggio del foro;
              {r: ...} = foro di raggio r. Stessa forma di spur.
              Il foro viene tagliato dal core, come per spur: qui in
              create.js non si taglia niente, si valida soltanto.
     "flat":  false o numero in [0,1] = lato piatto per incastro sull'asse.
     "flatAngle": gradi del lato piatto. "angle"/"phase": rotazione iniziale.
     "color": colore di disegno, passato attraverso senza validazione.

   COMPATIBILITÀ:
     "w": [w0, w1] è accettato come alias di pos=w0, thickness=w1-w0.
     "pitchW" + "thickness" è accettato come alias: pitchW è l'estremità
     lontana dall'apice (vecchio nome del piano primitivo).
     "pitchW" senza "thickness" è il vecchio modo: thickness si ricava da
     "k0" (default 0.7) e resta k0 esatto invece di thickness esatto.
     "teeth"+"apexW" è il modo esplicito legacy: richiede ancora i calcoli,
     ma accetta anche "thickness" (per ricavare k0) oppure "k0".

   STAMPABILE (create.js): un solo solido chiuso per ruota, con foro
   passante vero. Non due solidi che si intersecano. V-E+F = 0 con foro,
   = 2 senza foro. Ogni spigolo compare esattamente 2 volte.

   ATTENZIONE CORE (06-validate.js): prima di chiamare validate() il core
   deriva "w" da "pos"+"thickness" con normalizeGearGeometry() e lo mette
   sul def come proprietà NON enumerabile (Object.defineProperty con
   enumerable:false). Quindi in validate() sembra che ci siano sia "pos"
   sia "w" anche se nel JSON c'è solo "pos". NON è un errore: è lo stesso
   dato in due forme. Il "w" derivato va ignorato, si usa "pos".
   Solo un "w" enumerabile (scritto davvero nel JSON) conta come "w"
   esplicito, e in quel caso vale "w" come fa il core ("uso w").
   ===================================================================== */

// --- helpers (usano gli stessi globali del resto del file: V, PI) ---

// Intersezione (punti più vicini) di due rette O1+t*d1, O2+s*d2.
function intersectAxesLines_MT(O1, D1, O2, D2) {
  const d1 = V.unit(D1), d2 = V.unit(D2);
  const w0 = V.sub(O1, O2);
  const b = V.dot(d1, d2);           // d1.d1 = d2.d2 = 1 (versori)
  const d = V.dot(d1, w0), e = V.dot(d2, w0);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-12) return { parallel: true };
  const s = (b * e - d) / denom;     // t su asse 1: P1 = O1 + s*d1
  const t = (e - b * d) / denom;     // t su asse 2: P2 = O2 + t*d2
  const P1 = V.add(O1, V.mul(d1, s));
  const P2 = V.add(O2, V.mul(d2, t));
  return {
    parallel: false,
    P1, P2,
    dist: V.len(V.sub(P1, P2)),
    apex: V.mul(V.add(P1, P2), 0.5),
    apexW1: s, apexW2: t
  };
}

// atan con risultato in [0, PI): serve quando delta > 90° (tan < 0).
function atan0PI_MT(tan) {
  let a = Math.atan(tan);
  if (a < 0) a += PI;
  return a;
}

// --- "w" derivato dal core vs "w" esplicito nel JSON ---
// Il core (06-validate.js, normalizeGearGeometry) fa:
//   Object.defineProperty(def, 'w', { value: [pos, pos+thickness], enumerable: false, ... })
// Un "w" scritto nel JSON con JSON.parse è invece enumerabile.
// Quindi: enumerable:false => derivato da pos+thickness, da ignorare.
//          enumerable:true (o senza descriptor) => esplicito, vale "w" come fa il core.
function wIsDerived_MT(obj) {
  if (!obj || obj.w === undefined) return false;
  try {
    const desc = Object.getOwnPropertyDescriptor(obj, 'w');
    return !!desc && desc.enumerable === false;
  } catch (e) { return false; }
}
function hasExplicitW_MT(g, d) {
  for (const o of [g, d]) {
    if (!o || o.w === undefined) continue;
    // In validate() g === def (stesso oggetto). In resolve() g è il wrapper
    // e d è il def: il "w" che conta è quello del def. Il wrapper g.w è
    // già stato messo dal core con vec(def.w), quindi non va usato per
    // decidere esplicito/derivato: si guarda solo il def.
    if (o === g && g !== d) continue;
    if (!wIsDerived_MT(o)) return true;
  }
  return false;
}

// true se questa ruota è in modo automatico (pos/w/pitchW, non teeth/apexW)
function isAutoBevel_MT(g) {
  const d = g.def || g;
  return d.pos !== undefined || d.w !== undefined || d.pitchW !== undefined;
}

// Validazione comune a auto ed esplicito, copiata da spur/solve.js:
// bore / flat / flatAngle / angle / phase, più free.
function validateCommonBevel_MT(g, w, { E }) {
  const d = g.def || g;
  const pick = k => (g[k] !== undefined ? g[k] : d[k]);
  const free = pick('free');
  if (free !== undefined && typeof free !== 'boolean') E(`${w}: "free" deve essere true oppure false`);
  const bore = pick('bore');
  if (bore !== undefined && bore !== false) {
    if (typeof bore === 'number' || typeof bore === 'string') {
      // ok: numero o espressione = raggio del foro (come spur {r:...})
    } else if (typeof bore === 'object' && bore !== null) {
      if (bore.r === undefined) E(`${w}: bore manca "r"`);
    } else {
      E(`${w}: bore deve essere numero, false oppure {r:...}`);
    }
  }
  const flat = pick('flat');
  if (flat !== undefined && flat !== false) {
    if (typeof flat === 'number') {
      if (!(flat >= 0 && flat <= 1)) E(`${w}: flat deve essere numero fra 0 e 1, false`);
    } else if (typeof flat !== 'string') {
      E(`${w}: flat deve essere numero fra 0 e 1, false`);
    }
  }
  const flatAngle = pick('flatAngle');
  if (flatAngle !== undefined && typeof flatAngle !== 'number' && typeof flatAngle !== 'string') {
    E(`${w}: flatAngle deve essere numero (gradi)`);
  }
  const angle = pick('angle');
  if (angle !== undefined && typeof angle !== 'number' && typeof angle !== 'string') {
    E(`${w}: angle deve essere numero (gradi) per rotazione iniziale del gear`);
  }
  const phase = pick('phase');
  if (phase !== undefined && typeof phase !== 'number' && typeof phase !== 'string') {
    E(`${w}: phase deve essere numero (gradi) per rotazione iniziale del gear`);
  }
}

Registry.gear('bevel_MT', {
  meshWith: ['bevel_MT'],
  minTeeth: 3,

  validate(g, w, { E, W, isVec, partnerOf }) {
    const d = g.def || g;
    const pick = k => (g[k] !== undefined ? g[k] : d[k]);
    const teeth = pick('teeth'), module = pick('module'), apexW = pick('apexW');
    const side = pick('side'), pos = pick('pos'), thickness = pick('thickness');
    const pitchW = pick('pitchW'), wv = pick('w'), k0 = pick('k0');
    validateCommonBevel_MT(g, w, { E });

    // --- modo esplicito legacy: teeth + apexW ---
    if (teeth !== undefined || apexW !== undefined) {
      if (pos !== undefined || pitchW !== undefined) E(`${w}: modo esplicito (teeth+apexW): togli "pos"/"pitchW", qui la posizione è "apexW". Per il modo automatico usa pos+thickness senza teeth/apexW`);
      // NOTA: "w" qui non è un errore: può essere il "w" derivato dal core
      // da pos+thickness (ma in esplicito pos non c'è) oppure un "w" esplicito
      // residuo. In esplicito si ignora, la posizione è apexW.
      if (teeth === undefined) E(`${w}: mancano i "teeth"`);
      if (module === undefined) E(`${w}: manca "module"`);
      if (apexW === undefined) E(`${w}: manca "apexW" (posizione dell'apice lungo l'asse)`);
      if (thickness !== undefined && k0 !== undefined) E(`${w}: dai solo "thickness" oppure solo "k0": entrambi definiscono lo spessore (k0 = 1-thickness/wp)`);
      if (typeof thickness === 'number' && thickness <= 0) E(`${w}: "thickness" deve essere > 0`);
      if (side !== undefined && side !== 1 && side !== -1) E(`${w}: "side" deve essere 1 oppure -1`);
      if (!g.meshWith && !partnerOf[g.id] && g.delta === undefined) W(`${w}: conico senza ingranaggio accoppiato e senza "delta": userò 45°. Aggiungi "delta": gradi nel JSON`);
      return;
    }

    // --- modo automatico: pos + thickness (oppure alias w / pitchW) ---
    // "w" derivato dal core (enumerable:false) NON è un secondo input:
    // è la copia di [pos, pos+thickness] che il core ha già calcolato.
    // Solo "w" esplicito (enumerabile) conta come input alternativo.
    const explicitW = hasExplicitW_MT(g, d);
    if (explicitW && (pos !== undefined || thickness !== undefined)) {
      // Il core ha già avvisato ("ci sono sia w sia pos/thickness: uso w").
      // Qui non si dà errore: vale "w", come fa il core.
      W(`${w}: ci sono sia "w" sia "pos"/"thickness": uso "w"`);
    }
    if (explicitW) {
      const okVec = isVec ? isVec(wv, 2) : (Array.isArray(wv) && wv.length === 2);
      if (!okVec) E(`${w}: "w" deve avere 2 elementi [w0, w1]`);
      if (Array.isArray(wv) && wv.length === 2 && typeof wv[0] === 'number' && typeof wv[1] === 'number' && !(wv[1] > wv[0])) E(`${w}: "w" deve avere w1 > w0 (thickness = w1-w0 > 0)`);
    } else if (pitchW !== undefined) {
      // vecchio pitchW: thickness oppure k0 (k0 default 0.7 se mancano entrambi)
      if (pos !== undefined) E(`${w}: dai "pos"+"thickness" oppure "pitchW"+"thickness", non entrambi`);
      if (thickness !== undefined && k0 !== undefined) E(`${w}: dai solo "thickness" oppure solo "k0": entrambi definiscono lo spessore`);
      if (typeof thickness === 'number' && thickness <= 0) E(`${w}: "thickness" deve essere > 0`);
    } else {
      // Caso normale: solo pos+thickness nel JSON (il "w" che si vede qui
      // è quello derivato dal core, non va contato come secondo input).
      if (pos === undefined) E(`${w}: manca "pos" (prima faccia: la ruota occupa [pos, pos+thickness])`);
      if (thickness === undefined) E(`${w}: manca "thickness" (spessore assiale)`);
      if (thickness !== undefined && k0 !== undefined) E(`${w}: dai solo "thickness" oppure solo "k0": "thickness" basta, k0 = 1-thickness/wp verrà calcolato`);
      if (typeof thickness === 'number' && thickness <= 0) E(`${w}: "thickness" deve essere > 0`);
    }
    if (module === undefined) E(`${w}: manca "module" (modulo comune alla coppia)`);
    if (side !== undefined && side !== 1 && side !== -1) E(`${w}: "side" deve essere 1 oppure -1`);
    if (!d.meshWith && !partnerOf[g.id]) E(`${w}: modo automatico: manca "meshWith" con l'altra ruota della coppia`);
  },

  /* Apice del cono e direzione dell'asse (passo 6 di resolveModel). Ritorna un testo per il log. */
  resolve(g, { ev }) {
    const d = g.def || g;
    // pass-through per il core, come per spur: free / bore / flat / ecc.
    g.free = d.free; g.bore = d.bore; g.flat = d.flat;
    g.flatAngle = d.flatAngle; g.angle = d.angle; g.phase = d.phase;
    if (isAutoBevel_MT(g)) {
      // Modo automatico: l'apice non è ancora noto (serve l'altro asse:
      // intersezione). Salvo pos/thickness chiesti, il resto in afterPairs().
      // ATTENZIONE: pos/thickness non devono dipendere da pr/z della coppia
      // stessa, altrimenti è circolare: devono venire da consts / quote assi.
      // Priorità: "w" esplicito (il core dice "uso w") > pos+thickness
      // (il "w" derivato dal core si ignora, è la stessa cosa) > pitchW.
      const explicitW = hasExplicitW_MT(g, d);
      if (explicitW) {
        const w0 = ev(d.w[0]), w1 = ev(d.w[1]);
        g.pos = w0; g.thickness = w1 - w0;
        g._posInput = w0; g._thicknessInput = w1 - w0;
        g._inputForm = 'w'; g._thicknessExact = true;
        g.pitchW = NaN;
        g._k0Input = undefined;
      } else if (d.pos !== undefined) {
        g.pos = ev(d.pos); g.thickness = ev(d.thickness);
        g._posInput = g.pos; g._thicknessInput = g.thickness;
        g._inputForm = 'pos'; g._thicknessExact = true;
        g.pitchW = NaN;
        g._k0Input = undefined;
      } else if (d.w !== undefined) {
        // "w" derivato dal core senza pos (non dovrebbe succedere: il core
        // deriva w solo da pos+thickness). Si usa comunque come [pos, pos+thickness].
        const w0 = ev(d.w[0]), w1 = ev(d.w[1]);
        g.pos = w0; g.thickness = w1 - w0;
        g._posInput = w0; g._thicknessInput = w1 - w0;
        g._inputForm = 'w'; g._thicknessExact = true;
        g.pitchW = NaN;
        g._k0Input = undefined;
      } else { // pitchW (vecchio) + thickness oppure + k0
        g.pitchW = ev(d.pitchW); g._pitchWInput = g.pitchW;
        g._inputForm = 'pitchW';
        if (d.thickness !== undefined) {
          g.thickness = ev(d.thickness); g._thicknessInput = g.thickness;
          g._thicknessExact = true; g._k0Input = undefined;
        } else {
          g.thickness = undefined; g._thicknessInput = undefined;
          g._thicknessExact = false;
          g._k0Input = ev(d.k0 !== undefined ? d.k0 : 0.7);
        }
        g.pos = NaN;
      }
      g.apexW = NaN; g.apex = null;
      if (g.side !== undefined) g.e = V.mul(g.ax.dir, g.side);
      return `, AUTO pos=${Number.isFinite(g.pos) ? g.pos.toFixed(2) : 'pitchW=' + g.pitchW.toFixed(2)} thickness=${g.thickness !== undefined ? g.thickness.toFixed(2) : 'da k0=' + g._k0Input} (apice/denti rimandati alla coppia)`;
    }
    // --- modo esplicito legacy ---
    g.apexW = ev(d.apexW);
    g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    g.e = V.mul(g.ax.dir, g.side);
    if (d.thickness !== undefined) {
      g.thickness = ev(d.thickness); g._thicknessInput = g.thickness;
      g._thicknessExact = true; g._k0Input = undefined;
    } else {
      g.thickness = undefined; g._thicknessInput = undefined;
      g._thicknessExact = false;
      g._k0Input = ev(d.k0 !== undefined ? d.k0 : 0.7);
    }
    g.pos = NaN; g.pitchW = NaN;
    return `, apexW=${+g.apexW.toFixed(2)} (apice ${fmtV(g.apex)}), side=${g.side}`;
  },

  /* Semiangolo del cono: dalla coppia, oppure da "delta" del JSON (default 45°). */
  afterPairs(g, { ev }) {
    // ---------- MODO AUTOMATICO: risolve TUTTA la coppia in una volta ----------
    if (isAutoBevel_MT(g)) {
      if (g._bevelMTAutoSolved) return; // già risolta dalla chiamata dell'altra ruota
      const p = g.partner;
      CTX.where = `coppia conica automatica "${g.id}"`;
      if (!p) throw new Error(`conico automatico ${g.id}: nessun ingranaggio accoppiato (manca "meshWith")`);
      if (!isAutoBevel_MT(p)) throw new Error(`coppia conica mista ${g.id}-${p.id}: o ENTRAMBE le ruote in automatico (pos+thickness) o ENTRAMBE esplicite (teeth+apexW)`);
      if (g._inputForm === undefined || p._inputForm === undefined) throw new Error(`coppia conica automatica ${g.id}-${p.id}: pos/thickness non risolti (resolve() non chiamato?)`);

      // 1. Modulo comune (stesso per le due ruote, altrimenti non ingranano).
      const mG = ev(g.def.module), mP = ev(p.def.module);
      if (!(Number.isFinite(mG) && mG > 0)) throw new Error(`conico automatico ${g.id}: module non valido (${mG})`);
      if (!(Number.isFinite(mP) && mP > 0)) throw new Error(`conico automatico ${p.id}: module non valido (${mP})`);
      if (Math.abs(mG - mP) > 1e-9) throw new Error(`coppia conica ${g.id}-${p.id}: moduli diversi (${mG} vs ${mP}): una coppia conica deve avere lo stesso modulo`);
      const m = mG;

      // 2. Apice = intersezione degli assi. Se gli assi non si intersecano
      //    non esiste una coppia conica (i coni devono condividere l'apice).
      const inter = intersectAxesLines_MT(g.ax.O, g.ax.dir, p.ax.O, p.ax.dir);
      if (inter.parallel) throw new Error(`coppia conica ${g.id}-${p.id}: assi paralleli, non si intersecano: una coppia conica vuole assi incidenti. Se gli assi sono paralleli usa "spur", non "bevel_MT"`);
      if (inter.dist > 1e-6) throw new Error(`coppia conica ${g.id}-${p.id}: gli assi non si intersecano (distanza minima ${inter.dist.toFixed(3)} mm fra ${fmtV(inter.P1)} e ${fmtV(inter.P2)}): sposta un asse finché le rette si incontrano; l'apice deve stare su ENTRAMBE le rette`);
      const apex = inter.apex;
      const apexWG = inter.apexW1, apexWP = inter.apexW2;

      // 3. Per ogni ruota: side, pitchW chiesto, wp chiesto, thickness chiesta.
      //    pos+thickness: l'intervallo [pos, pos+thickness] deve stare tutto
      //    da una parte dell'apice; il piano primitivo è l'estremità lontana.
      //    pitchW+thickness: pitchW è già l'estremità lontana.
      //    pitchW+k0 (vecchio): thickness = wp*(1-k0), k0 resta esatto.
      const prep = (gg, apexW) => {
        const sideDef = gg.def.side;
        let side, pitchWIn, thickIn, thickExact, k0In;
        if (gg._inputForm === 'pos' || gg._inputForm === 'w') {
          const posIn = gg._posInput, th = gg._thicknessInput;
          if (!(th > 0)) throw new Error(`conico automatico ${gg.id}: thickness deve essere > 0 (got ${th})`);
          const a = posIn - apexW, b = posIn + th - apexW;
          if (!(a * b > 0)) throw new Error(`conico automatico ${gg.id}: l'intervallo [pos, pos+thickness] = [${posIn.toFixed(3)}, ${(posIn + th).toFixed(3)}] attraversa l'apice (apexW=${apexW.toFixed(3)}): sposta tutta la ruota da una parte dell'apice`);
          side = sideDef !== undefined ? sideDef : Math.sign(a);
          if (side !== 1 && side !== -1) throw new Error(`conico automatico ${gg.id}: non riesco a dedurre "side"`);
          if (sideDef !== undefined && sideDef !== Math.sign(a)) throw new Error(`conico automatico ${gg.id}: "side"=${sideDef} contraddice pos: l'intervallo sta dalla parte ${Math.sign(a)} dell'apice`);
          pitchWIn = side === 1 ? posIn + th : posIn;
          thickIn = th; thickExact = true; k0In = undefined;
        } else { // pitchW
          pitchWIn = gg._pitchWInput;
          side = sideDef !== undefined ? sideDef : Math.sign(pitchWIn - apexW);
          if (side !== 1 && side !== -1) throw new Error(`conico automatico ${gg.id}: non riesco a dedurre "side": pitchW coincide con apexW`);
          if (sideDef !== undefined && sideDef !== Math.sign(pitchWIn - apexW)) throw new Error(`conico automatico ${gg.id}: "side"=${sideDef} contraddice pitchW`);
          if (gg._thicknessExact) { thickIn = gg._thicknessInput; thickExact = true; k0In = undefined; }
          else { thickIn = undefined; thickExact = false; k0In = gg._k0Input; }
        }
        const wpIn = Math.abs(pitchWIn - apexW);
        if (!(wpIn > 0)) throw new Error(`conico automatico ${gg.id}: pitchW deve stare lontano dall'apice (wp=${wpIn.toFixed(3)} <= 0)`);
        if (thickExact && !(thickIn < wpIn)) throw new Error(`conico automatico ${gg.id}: thickness (${thickIn.toFixed(3)}) >= wp (${wpIn.toFixed(3)}): la faccia anteriore finirebbe sull'apice o oltre (k0 <= 0). Riduci thickness o allontana la ruota dall'apice`);
        if (!thickExact && !(k0In > 0 && k0In < 1)) throw new Error(`conico automatico ${gg.id}: k0 deve stare in (0,1) (got ${k0In})`);
        return { side, pitchWIn, wpIn, thickIn, thickExact, k0In };
      };
      const preG = prep(g, apexWG), preP = prep(p, apexWP);
      g.side = preG.side; p.side = preP.side;
      g.e = V.mul(g.ax.dir, preG.side); p.e = V.mul(p.ax.dir, preP.side);

      // 4. Angolo fra gli assi (fra le direzioni apice -> ruota).
      const cs = Math.max(-1, Math.min(1, V.dot(g.e, p.e)));
      const Sigma = Math.acos(cs);
      if (!(Sigma > 1e-6 && Sigma < PI - 1e-6)) throw new Error(`coppia conica ${g.id}-${p.id}: angolo fra gli assi ${Sigma * 180 / PI}° degenere (assi coincidenti o opposti)`);

      // 5. Soluzione CONTINUA da wp1/wp2 + Sigma:
      //    wp_i = L*cos(delta_i), delta_1+delta_2 = Sigma  =>
      //    tan(delta_1) = (1 - r*cosSigma) / (r*sinSigma),  r = wpG/wpP.
      const r = preG.wpIn / preP.wpIn;
      const tanCont = (1 - r * Math.cos(Sigma)) / (r * Math.sin(Sigma));
      const deltaGCont = atan0PI_MT(tanCont);
      const deltaPCont = Sigma - deltaGCont;
      if (!(deltaGCont > 0 && deltaGCont < Sigma && deltaPCont > 0)) throw new Error(`coppia conica ${g.id}-${p.id}: pos incompatibili con l'angolo fra gli assi (Sigma=${(Sigma * 180 / PI).toFixed(2)}°, wp ${preG.wpIn.toFixed(2)}/${preP.wpIn.toFixed(2)} danno delta=${(deltaGCont * 180 / PI).toFixed(2)}° fuori da (0, Sigma)): avvicina o allontana le ruote dall'apice o cambia l'angolo fra gli assi`);
      const LCont = preG.wpIn / Math.cos(deltaGCont);
      const zGCont = 2 * (LCont * Math.sin(deltaGCont)) / m;
      const zPCont = 2 * (LCont * Math.sin(deltaPCont)) / m;
      step('conico', `${g.id}-${p.id} AUTO continuo: Sigma=${(Sigma * 180 / PI).toFixed(3)}°, apice ${fmtV(apex)}, delta_cont=${(deltaGCont * 180 / PI).toFixed(3)}°/${(deltaPCont * 180 / PI).toFixed(3)}°, z_cont=${zGCont.toFixed(3)}/${zPCont.toFixed(3)}`);

      // 6. Arrotondamento a denti interi + soluzione ESATTA da z interi.
      //    Da z interi: tan(delta_1) = sinSigma / (z_2/z_1 + cosSigma).
      //    thickness resta esatta (oppure k0 resta esatto nel vecchio modo),
      //    pos si sposta di posShift. Vedi header del file.
      const zG = Math.max(3, Math.round(zGCont));
      const zP = Math.max(3, Math.round(zPCont));
      if (zGCont < 3 || zPCont < 3) warn('conico', `coppia ${g.id}-${p.id}: z continuo ${zGCont.toFixed(2)}/${zPCont.toFixed(2)} < 3: forzato a ${zG}/${zP}, lo shift di pos sarà grande`);
      const RG = m * zG / 2, RP = m * zP / 2;
      const tanExact = Math.sin(Sigma) / (RP / RG + Math.cos(Sigma));
      const deltaG = atan0PI_MT(tanExact);
      const deltaP = Sigma - deltaG;
      if (!(deltaG > 0 && deltaG < Sigma && deltaP > 0)) throw new Error(`coppia conica ${g.id}-${p.id}: denti arrotondati ${zG}/${zP} incompatibili con Sigma=${(Sigma * 180 / PI).toFixed(2)}°`);
      const L = RG / Math.sin(deltaG);
      const wpGExact = L * Math.cos(deltaG), wpPExact = L * Math.cos(deltaP);

      // 7. Da wp_esatto a pos_esatto / thickness_esatta / k0_esatto.
      const finish = (gg, pre, apexW, zz, RR, dd, wpEx) => {
        const pitchWEx = apexW + pre.side * wpEx;
        let thickEx, k0Ex, posEx, posIn;
        if (pre.thickExact) {
          thickEx = pre.thickIn;
          k0Ex = 1 - thickEx / wpEx;
          if (!(k0Ex > 0 && k0Ex < 1)) throw new Error(`conico automatico ${gg.id}: thickness (${thickEx.toFixed(3)}) incompatibile con wp esatto (${wpEx.toFixed(3)}): k0 = ${k0Ex.toFixed(3)} fuori da (0,1). Riduci thickness o allontana la ruota dall'apice`);
          posEx = pre.side === 1 ? pitchWEx - thickEx : pitchWEx;
          posIn = gg._inputForm === 'pitchW' ? (pre.side === 1 ? pre.pitchWIn - thickEx : pre.pitchWIn) : gg._posInput;
        } else {
          k0Ex = pre.k0In;
          thickEx = wpEx * (1 - k0Ex);
          posEx = pre.side === 1 ? pitchWEx - thickEx : pitchWEx;
          const thickInCont = pre.wpIn * (1 - k0Ex);
          posIn = gg._inputForm === 'pitchW' ? (pre.side === 1 ? pre.pitchWIn - thickInCont : pre.pitchWIn) : gg._posInput;
        }
        const posShift = posEx - posIn;
        gg.z = zz; gg.m = m; gg.r = RR; gg.pr = RR;
        gg.delta = dd; gg.apexW = apexW; gg.apex = apex;
        gg.pitchW = pitchWEx; gg.pitchWExact = pitchWEx;
        gg.pitchWShift = pitchWEx - pre.pitchWIn;
        gg.pos = posEx; gg.posExact = posEx; gg.posShift = posShift;
        gg._posInput = posIn;
        gg.thickness = thickEx; gg.k0 = k0Ex;
        gg.w = [posEx, posEx + thickEx];
        gg.plate = gg.def.plate !== undefined ? gg.def.plate : { k: 0.85, from: -thickEx, to: 0, n: 48 };
        gg._bevelMTAutoSolved = true;
        return { posEx, posShift, thickEx, k0Ex, pitchWEx };
      };
      const finG = finish(g, preG, apexWG, zG, RG, deltaG, wpGExact);
      const finP = finish(p, preP, apexWP, zP, RP, deltaP, wpPExact);
      step('conico', `${g.id}: z=${zG} (da ${zGCont.toFixed(3)}), delta=${(deltaG * 180 / PI).toFixed(3)}°, R=${RG.toFixed(3)}, apexW=${apexWG.toFixed(3)}, pos ${g._posInput.toFixed(3)} -> ${finG.posEx.toFixed(3)} (shift ${finG.posShift >= 0 ? '+' : ''}${finG.posShift.toFixed(3)}), thickness=${finG.thickEx.toFixed(3)} esatta, k0=${finG.k0Ex.toFixed(3)}`);
      step('conico', `${p.id}: z=${zP} (da ${zPCont.toFixed(3)}), delta=${(deltaP * 180 / PI).toFixed(3)}°, R=${RP.toFixed(3)}, apexW=${apexWP.toFixed(3)}, pos ${p._posInput.toFixed(3)} -> ${finP.posEx.toFixed(3)} (shift ${finP.posShift >= 0 ? '+' : ''}${finP.posShift.toFixed(3)}), thickness=${finP.thickEx.toFixed(3)} esatta, k0=${finP.k0Ex.toFixed(3)}`);
      const tol = Math.max(0.5, 0.25 * m);
      if (Math.abs(finG.posShift) > tol || Math.abs(finP.posShift) > tol) warn('conico', `coppia ${g.id}-${p.id}: per avere denti interi devo spostare le ruote di ${finG.posShift.toFixed(2)}/${finP.posShift.toFixed(2)} mm lungo gli assi (> ${tol.toFixed(2)} mm): pos chieste incompatibili con denti interi a modulo ${m}. Se ti serve una pos esatta, sposta l'altro asse (cambia apice/Sigma) o cambia modulo`);
      return;
    }

    // ---------- MODO ESPLICITO (legacy) ----------
    if (g.partner) {
      const p = g.partner, cs = V.dot(g.e, p.e);
      g.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), p.z / g.z + cs);
      step('conico', `${g.id}: δ=${(g.delta * 180 / PI).toFixed(3)}° calcolato dalla coppia con ${p.id}`);
    }
    // conici senza ingranaggio accoppiato: "delta" in gradi dal JSON (default 45°).
    if (g.delta === undefined) {
      CTX.where = `conico "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = ev(g.def.delta) * PI / 180;
        step('conico', `${g.id}: nessun ingranaggio accoppiato, uso "delta" del JSON = ${(g.delta * 180 / PI).toFixed(3)}°`);
      } else {
        g.delta = PI / 4;
        warn('conico', `${g.id}: nessun ingranaggio accoppiato e nessun "delta" nel JSON: uso 45° (aggiungi "delta": gradi per evitare questo avviso)`);
      }
    }
    // Da delta + z a wp / pitchW / pos / thickness / k0 / plate, come in auto.
    {
      const RR = g.m !== undefined ? g.m * g.z / 2 : g.r;
      const wpEx = RR / Math.tan(g.delta);
      const pitchWEx = g.apexW + g.side * wpEx;
      let thickEx, k0Ex;
      if (g._thicknessExact) { thickEx = g._thicknessInput; k0Ex = 1 - thickEx / wpEx; }
      else { k0Ex = g._k0Input; thickEx = wpEx * (1 - k0Ex); }
      if (!(k0Ex > 0 && k0Ex < 1)) throw new Error(`conico ${g.id}: thickness/k0 incompatibile con wp=${wpEx.toFixed(3)}: k0=${k0Ex.toFixed(3)} fuori da (0,1)`);
      const posEx = g.side === 1 ? pitchWEx - thickEx : pitchWEx;
      g.pitchW = pitchWEx; g.pitchWExact = pitchWEx; g.pitchWShift = 0;
      g.pos = posEx; g.posExact = posEx; g.posShift = 0; g._posInput = posEx;
      g.thickness = thickEx; g.k0 = k0Ex;
      g.w = [posEx, posEx + thickEx];
      g.plate = g.def.plate !== undefined ? g.def.plate : { k: 0.85, from: -thickEx, to: 0, n: 48 };
    }
  },

  /* Punto di contatto di due conici: sulla bisettrice dei coni. Con altri partner → null (contatto cilindrico). */
  contact(g, p) {
    if (p.type !== 'bevel_MT') return null;
    const gh = V.unit(V.add(V.mul(g.e, Math.sin(p.delta)), V.mul(p.e, Math.sin(g.delta))));
    const apexDist = V.len(V.sub(g.apex, p.apex));
    step('ingranamento', `${g.id} (conico, z=${g.z}, δ=${(g.delta * 180 / PI).toFixed(2)}°) ⇄ ${p.id} (conico, z=${p.z}, δ=${(p.delta * 180 / PI).toFixed(2)}°): distanza fra gli apici ${apexDist.toFixed(3)} mm`);
    if (apexDist > 1e-6) warn('ingranamento', `Coppia conica ${g.id}-${p.id}: gli apici non coincidono (distanza ${apexDist.toFixed(3)} mm): ${g.id} apice ${fmtV(g.apex)}, ${p.id} apice ${fmtV(p.apex)}`);
    return { X: V.add(g.apex, V.mul(gh, g.r / Math.sin(g.delta))), cg: V.unit(V.perp(gh, g.e)), cp: V.unit(V.perp(gh, p.e)) };
  },

  validateModel(g, B) {
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) B(`conico ${g.id}: delta non valido (${g.delta})`);
    if (!g.apex.every(Number.isFinite)) B(`conico ${g.id}: apice non finito`, g.apex);
    if (g.k0 !== undefined && !(g.k0 > 0 && g.k0 < 1)) B(`conico ${g.id}: k0 non valido (${g.k0}), deve stare in (0,1)`);
    if (g.thickness !== undefined && !(g.thickness > 0)) B(`conico ${g.id}: thickness non valida (${g.thickness})`);
  }
});

/* >>>>> types/gears/bevel_QW/create.js */
/* =====================================================================
types/gears/bevel_QW/create.js
Ingranaggio conico (type "bevel_QW")
Usa pos e thickness invece di w. Gestisce free e bore.
===================================================================== */

function bevelGear_QW(z, m, delta, rho, pos, thickness, k0) {
  const R = m * z / 2;
  const wp = R / Math.tan(delta);
  const zVirtual = z / cos(delta);
  const rVirtual = R / cos(delta);
  const prof = toothProfile(zVirtual, m, 8);
  const pitchV = 2 * PI / zVirtual;
  const P = [];

  for (let k = 0; k < z; k++) {
    for (const [r, d] of prof) {
      const t = rho + (k * pitchV + d) / cos(delta);
      const s = r - rVirtual;
      const q = R + s * cos(delta);
      const zRel = wp - s * sin(delta);
      P.push([q * cos(t), q * sin(t), zRel]);
    }
  }

  const wMean = P.reduce((a, p) => a + p[2], 0) / P.length;
  const halfThick = thickness / 2;

  const P_inner = P.map(p => [p[0] * k0, p[1] * k0, p[2] * k0]);
  const P_outer = P;

  const zOffset = pos - wMean;
  const P_inner_shifted = P_inner.map(p => [p[0], p[1], p[2] + zOffset - halfThick]);
  const P_outer_shifted = P_outer.map(p => [p[0], p[1], p[2] + zOffset + halfThick]);

  return loft(P_inner_shifted, P_outer_shifted, [0, 0, pos - halfThick], [0, 0, pos + halfThick]);
}

Registry.gear('bevel_QW', {
  solids(g) {
    const pos = g.def.pos !== undefined ? ev(g.def.pos) : 0;
    const thickness = g.def.thickness !== undefined ? ev(g.def.thickness) : 10;
    const k0 = g.def.k0 || 0.7;

    const out = [bevelGear_QW(g.z, g.m, g.delta, g.rho, pos, thickness, k0)];

    const pl = g.def.plate;
    if (pl) {
      out.push(cylinderSolid(pl.k * g.r, pos - thickness/2 + pl.from, pos - thickness/2 + pl.to, pl.n || 48));
    }

    if (g.bore !== undefined && g.bore !== false) {
      const boreR = typeof g.bore === 'object' ? ev(g.bore.r) / 2 : ev(g.bore) / 2;
      if (boreR > 0) {
        const boreSolid = cylinderSolid(boreR, pos - thickness/2 - 1, pos + thickness/2 + 1, 24);
        out.push({ type: 'subtract', solid: boreSolid });
      }
    }

    return out;
  },
  cacheKey: g => [g.delta, g.def.pos, g.def.thickness, g.def.plate, g.def.k0, g.def.bore],
  markerZ: g => {
    const pos = g.def.pos !== undefined ? ev(g.def.pos) : 0;
    return pos + g.r * 0.2;
  }
});
/* >>>>> types/gears/bevel_QW/solve.js */
/* =====================================================================
types/gears/bevel_QW/solve.js
Ingranaggio conico ad AUTO-CALCOLO COMPLETO (type "bevel_QW")
Basta specificare: axis, pos (posizione centro sull'asse), thickness e module.
===================================================================== */

console.log('[bevel_QW] solve.js caricato');

Registry.gear('bevel_QW', {
  meshWith: ['bevel_QW'],  // Può ingranare SOLO con altri bevel_QW
  minTeeth: 3,

  validate(g, w, { E, W, isVec, partnerOf }) {
    if (g.module === undefined) E(`${w}: manca "module"`);

    if (g.pos !== undefined) {
      if (g.thickness === undefined) E(`${w}: manca "thickness" (spessore della ruota)`);
    } else {
      if (g.teeth === undefined) E(`${w}: mancano i "teeth" (oppure fornisci "pos" per l'auto-calcolo)`);
      if (g.apexW === undefined) E(`${w}: manca "apexW" (oppure fornisci "pos" per l'auto-calcolo)`);
    }

    if (g.side !== undefined && g.side !== 1 && g.side !== -1) E(`${w}: "side" deve essere 1 oppure -1`);

    if (g.free !== undefined && typeof g.free !== 'boolean') {
      E(`${w}: "free" deve essere boolean (true/false)`);
    }

    if (g.bore !== undefined && g.bore !== false) {
      const b = g.bore;
      if (typeof b === 'number' || typeof b === 'string') {
        // OK
      } else if (typeof b === 'object' && b !== null) {
        if (b.r === undefined) E(`${w}: bore manca "r"`);
      } else {
        E(`${w}: bore deve essere numero, false oppure {r:...}`);
      }
    }
  },

  resolve(g, { ev }) {
    const pId = g.meshWith || (typeof CTX !== 'undefined' && CTX.gears
      ? Object.keys(CTX.gears).find(id => CTX.gears[id].meshWith === g.id)
      : null);
    const p = pId && typeof CTX !== 'undefined' && CTX.gears ? CTX.gears[pId] : null;

    if (g.def.pos !== undefined && p && p.def && p.def.pos !== undefined) {
      if (g.z !== undefined) {
        return `, pos=${ev(g.def.pos)}, apexW=${+g.apexW.toFixed(2)} (auto-calcolato dal partner), side=${g.side}`;
      }

      const pos_g = ev(g.def.pos);
      const pos_p = ev(p.def.pos);
      const m = ev(g.module);

      const O1 = g.ax.O, d1 = g.ax.dir;
      const O2 = p.ax.O, d2 = p.ax.dir;

      const W1 = V.add(O1, V.mul(d1, pos_g));
      const W2 = V.add(O2, V.mul(d2, pos_p));

      const w0 = V.sub(O1, O2);
      const a = V.dot(d1, d1), b = V.dot(d1, d2), c = V.dot(d2, d2);
      const d_dot = V.dot(d1, w0), e_dot = V.dot(d2, w0);
      const D = a * c - b * b;

      if (Math.abs(D) < 1e-8) {
        throw new Error(`Assi paralleli per coppia conica ${g.id} e ${p.id}. Le ruote coniche richiedono assi concorrenti.`);
      }

      const t1 = (b * e_dot - c * d_dot) / D;
      const t2 = (a * e_dot - b * d_dot) / D;
      const P1 = V.add(O1, V.mul(d1, t1));
      const P2 = V.add(O2, V.mul(d2, t2));
      const dist = V.len(V.sub(P1, P2));

      if (dist > 0.5) {
        throw new Error(`Assi non concorrenti per ${g.id} e ${p.id}: distanza minima ${dist.toFixed(2)} mm.`);
      }

      const apex = V.mul(V.add(P1, P2), 0.5);
      g.apex = apex;
      p.apex = apex;

      const vec1 = V.sub(W1, apex);
      const vec2 = V.sub(W2, apex);
      const L1_signed = V.dot(vec1, d1);
      const L2_signed = V.dot(vec2, d2);

      const L1 = Math.abs(L1_signed);
      const L2 = Math.abs(L2_signed);

      g.side = L1_signed > 0 ? 1 : -1;
      p.side = L2_signed > 0 ? 1 : -1;
      g.e = V.mul(d1, g.side);
      p.e = V.mul(d2, p.side);

      const cosSigma = Math.max(-1, Math.min(1, V.dot(g.e, p.e)));
      const sinSigma = Math.sqrt(Math.max(0, 1 - cosSigma * cosSigma));

      const tanDelta1_geom = (L2 - L1 * cosSigma) / (L1 * sinSigma);
      const tanDelta2_geom = (L1 - L2 * cosSigma) / (L2 * sinSigma);

      const delta1_geom = Math.atan(tanDelta1_geom);
      const delta2_geom = Math.atan(tanDelta2_geom);

      const r1_geom = L1 * Math.tan(delta1_geom);
      const r2_geom = L2 * Math.tan(delta2_geom);

      const minTeeth = Registry.gear('bevel_QW').minTeeth || 3;
      let z1 = Math.max(minTeeth, Math.round(2 * r1_geom / m));
      let z2 = Math.max(minTeeth, Math.round(2 * r2_geom / m));

      const delta1 = Math.atan2(sinSigma, z2 / z1 + cosSigma);
      const delta2 = Math.atan2(sinSigma, z1 / z2 + cosSigma);

      const r1_exact = m * z1 / 2;
      const r2_exact = m * z2 / 2;

      const L1_exact = r1_exact / Math.tan(delta1);
      const L2_exact = r2_exact / Math.tan(delta2);

      g.apexW = pos_g - g.side * L1_exact;
      p.apexW = pos_p - p.side * L2_exact;

      g.z = z1;
      p.z = z2;
      g.delta = delta1;
      p.delta = delta2;

      step('bevel_QW (auto)', `${g.id} e ${p.id}: Apice calcolato in ${fmtV(apex)}.`);
      step('bevel_QW (auto)', `  Posizioni: ${g.id}=${pos_g}, ${p.id}=${pos_p}`);
      step('bevel_QW (auto)', `  Soluzione: z1=${z1}, z2=${z2}, δ1=${(delta1*180/Math.PI).toFixed(2)}°, δ2=${(delta2*180/Math.PI).toFixed(2)}°`);

      const err1 = Math.abs(L1_exact - L1);
      const err2 = Math.abs(L2_exact - L2);
      if (err1 > 0.1 || err2 > 0.1) {
        warn('bevel_QW', `Per rispettare il modulo ${m} e denti interi, la geometria è stata adattata: ${g.id} (ΔL=${err1.toFixed(2)}mm), ${p.id} (ΔL=${err2.toFixed(2)}mm)`);
      }

      return `, pos=${pos_g}, apexW=${+g.apexW.toFixed(2)} (auto), side=${g.side}`;
    }

    g.apexW = ev(g.def.apexW);
    g.apex = V.add(g.ax.O, V.mul(g.ax.dir, g.apexW));
    g.e = V.mul(g.ax.dir, g.side || 1);
    return `, apexW=${+g.apexW.toFixed(2)} (manuale), side=${g.side}`;
  },

  afterPairs(g, { ev }) {
    if (g.partner) {
      const p = g.partner, cs = V.dot(g.e, p.e);
      g.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), p.z / g.z + cs);
      p.delta = Math.atan2(Math.sqrt(Math.max(0, 1 - cs * cs)), g.z / p.z + cs);
    }
    if (g.delta === undefined) {
      CTX.where = `bevel_QW "${g.id}" senza coppia`;
      if (g.def.delta !== undefined) {
        g.delta = ev(g.def.delta) * PI / 180;
      } else {
        g.delta = PI / 4;
        warn('bevel_QW', `${g.id}: nessun ingranaggio accoppiato e nessun "delta": uso 45°`);
      }
    }
  },

  contact(g, p) {
    if (p.type !== 'bevel_QW') return null;  // Solo bevel_QW ↔ bevel_QW
    const gh = V.unit(V.add(V.mul(g.e, Math.sin(p.delta)), V.mul(p.e, Math.sin(g.delta))));
    const apexDist = V.len(V.sub(g.apex, p.apex));

    if (apexDist > 1e-6) {
      warn('ingranamento', `Coppia conica ${g.id}–${p.id}: gli apici non coincidono (distanza ${apexDist.toFixed(3)} mm)`);
    }

    return {
      X: V.add(g.apex, V.mul(gh, g.r / Math.sin(g.delta))),
      cg: V.unit(V.perp(gh, g.e)),
      cp: V.unit(V.perp(gh, p.e))
    };
  },

  validateModel(g, B) {
    if (!(Number.isFinite(g.delta) && g.delta > 0 && g.delta < PI)) B(`bevel_QW ${g.id}: delta non valido (${g.delta})`);
    if (!g.apex.every(Number.isFinite)) B(`bevel_QW ${g.id}: apice non finito`, g.apex);
    if (!Number.isFinite(g.z) || g.z < Registry.gear('bevel_QW').minTeeth) B(`bevel_QW ${g.id}: numero di denti non valido (${g.z})`);
  }
});
/* >>>>> types/gears/cam_CS/create.js */
/* =====================================================================
types/gears/cam_CS/create.js
Camma (type "cam_CS"): profilo definito da una lista di raggi o da segments
Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
===================================================================== */

/* Interpola il raggio per un dato angolo u (in radianti, normalizzato) usando i segments */
function interpolateSegments(angles, radii, u) {
    const m = angles.length;
    // Normalizza u nell'intervallo [angles[0], angles[0] + 2*PI)
    let theta = u % (2 * Math.PI);
    if (theta < 0) theta += 2 * Math.PI;
    
    // Shift rispetto al primo angolo
    let target = theta + angles[0];
    
    // Trova l'intervallo
    for (let i = 0; i < m - 1; i++) {
        if (target >= angles[i] && target <= angles[i+1]) {
            const t = (target - angles[i]) / (angles[i+1] - angles[i]);
            // Per ora usiamo interpolazione lineare tra i segmenti. 
            // Se si desidera una Catmull-Rom su angoli irregolari, andrebbe implementata qui.
            return radii[i] + (radii[i+1] - radii[i]) * t;
        }
    }
    // Fallback (chiusura)
    return radii[m - 1];
}

/* Profilo periodico: n punti [x, y] a angoli phase + i·2π/n (antiorario), nel riferimento locale della camma. */
function camProfile_CS(profileData, n, interp, phase = 0) {
    const P = [];
    
    for (let i = 0; i < n; i++) {
        const angle = phase + 2 * Math.PI * i / n;
        let r;

        if (profileData.type === 'segments') {
            // Interpolazione sui segments (angoli arbitrari)
            r = interpolateSegments(profileData.angles, profileData.radii, angle - phase);
            
            // Se l'utente ha richiesto 'smooth' e ci sono abbastanza punti, 
            // potremmo applicare un filtro o una spline avanzata, ma per angoli non uniformi 
            // l'interpolazione lineare a tratti è la più sicura geometricamente.
        } else {
            // Comportamento legacy (radii equispaziati)
            const radii = profileData.radii;
            const m = radii.length;
            const u = i / n * m;
            const k = Math.floor(u);
            const t = u - k;
            const p0 = radii[(k - 1 + m) % m];
            const p1 = radii[k % m];
            const p2 = radii[(k + 1) % m];
            const p3 = radii[(k + 2) % m];
            
            r = interp === 'linear' 
                ? p1 + (p2 - p1) * t
                : 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);   // Catmull-Rom periodica
        }

        r = Math.max(0.5, r);
        P.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    return P;
}

Registry.gear('cam_CS', {
    solids(g) {
        const c = g.camCS, [w0, w1] = g.w;
        if (!c) return [cylinderSolid(g.r > 0 ? g.r : 10, w0, w1, 64)];
        
        // Genera il poligono a 360 punti per la mesh
        const poly = camProfile_CS(c.profileData, 360, c.interp, c.phase);
        const A = poly.map(([x, y]) => [x, y, w0]);
        const B = poly.map(([x, y]) => [x, y, w1]);
        
        return [loft(A, B, [0, 0, w0], [0, 0, w1])]; // sezione "a stella" rispetto al centro: tappi a ventaglio
    },
    cacheKey: g => [
        g.camCS && [
            g.camCS.profileData.type,
            g.camCS.profileData.radii,
            g.camCS.profileData.angles,
            g.camCS.interp, 
            g.camCS.phase
        ]
    ],
    sigKey: g => []
});
/* >>>>> types/gears/cam_CS/solve.js */
/* =====================================================================
types/gears/cam_CS/solve.js
Camma (type "cam_CS"), da usare con il link "cam_follower_CS"
Metà "COME SI RISOLVE" del tipo: validazione e parametri. Il disegno è in create.js; il contatto col follower è nel link.

Profilo definibile in DUE modi alternativi:
1) "radii": lista di raggi equispaziati in angolo (metodo originale).
2) "segments": lista di oggetti {"x": angolo_in_gradi, "y": raggio_in_mm}, per profili ad angoli arbitrari.

JSON Esempio segments:
{ "id": "camma_CS", "type": "cam_CS", "axis": "...", 
  "segments": [ {"x":0,"y":30}, {"x":90,"y":40}, {"x":180,"y":30}, {"x":270,"y":20} ], 
  "pos": 0, "thickness": 4 }

Facoltativi comuni: "interpolation" ("smooth" o "linear"), "phase" (offset angolare in gradi).
===================================================================== */
Registry.gear('cam_CS', {
    meshWith: [],                // non ingrana
    noRadiusCheck: false,
    
    radius: (g, { ev }) => {
        if (Array.isArray(g.def.segments) && g.def.segments.length) {
            return Math.max(...g.def.segments.map(s => +ev(s.y) || 0));
        }
        if (Array.isArray(g.def.radii) && g.def.radii.length) {
            return Math.max(...g.def.radii.map(r => +ev(r) || 0));
        }
        return 10;
    },

    validate(g, w, { E, isVec }) {
        const hasSeg = Array.isArray(g.segments) && g.segments.length >= 2;
        const hasRad = Array.isArray(g.radii) && g.radii.length >= 3;

        if (!hasSeg && !hasRad) {
            E(`${w}: definire "segments" (almeno 2 punti {x,y}) oppure "radii" (almeno 3 raggi)`);
        } else if (hasSeg && hasRad) {
            E(`${w}: specificare "segments" OPPURE "radii", non entrambi`);
        }

        if (hasSeg) {
            for (let i = 0; i < g.segments.length; i++) {
                const s = g.segments[i];
                if (s === null || typeof s !== 'object') {
                    E(`${w}: "segments[${i}]" deve essere un oggetto {x, y}`); continue;
                }
                if (typeof s.x !== 'number' && typeof s.x !== 'string') E(`${w}: "segments[${i}].x" deve essere un numero o espressione`);
                if (typeof s.y !== 'number' && typeof s.y !== 'string') E(`${w}: "segments[${i}].y" deve essere un numero o espressione`);
            }
        } else if (hasRad) {
            if (!g.radii.every(r => typeof r === 'number' || typeof r === 'string')) {
                E(`${w}: i raggi di "radii" devono essere numeri o espressioni`);
            }
        }

        if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
        if (g.interpolation !== undefined && g.interpolation !== 'smooth' && g.interpolation !== 'linear') {
            E(`${w}: "interpolation" deve essere "smooth" o "linear"`);
        }
        if (g.phase !== undefined && typeof g.phase !== 'number' && typeof g.phase !== 'string') {
            E(`${w}: "phase" deve essere un numero (gradi)`);
        }
    },

    /* Raggi valutati (gli slider possono comparire nelle espressioni) e profilo fisico, usato dal link per il contatto. */
    resolve(g, { ev }) {
        const d = g.def;
        const interp = d.interpolation || 'smooth';
        const phase = (d.phase !== undefined ? ev(d.phase) : 0) * Math.PI / 180;
        
        let profileData;
        let infoStr = '';

        if (Array.isArray(d.segments) && d.segments.length >= 2) {
            // Valuta le espressioni nei segments
            const segs = d.segments.map(s => ({ x: ev(s.x), y: ev(s.y) }));
            
            // Ordina per angolo crescente
            segs.sort((a, b) => a.x - b.x);
            
            if (!segs.every(s => s.y > 0)) throw new Error(`${g.id}: tutti i raggi (y) nei segments devono essere positivi`);

            // Normalizza gli angoli in radianti e gestisci la periodicità
            const angles = segs.map(s => s.x * Math.PI / 180);
            const radii = segs.map(s => s.y);
            
            // Se il profilo non copre esattamente 360° o se l'ultimo punto non coincide col primo, chiudilo
            const totalSpan = angles[angles.length - 1] - angles[0];
            if (Math.abs(totalSpan - 2 * Math.PI) > 1e-6 && Math.abs(totalSpan - 360 * Math.PI / 180) > 1e-6) {
                // Aggiungi implicitamente il primo punto alla fine per garantire la chiusura a 360°
                angles.push(angles[0] + 2 * Math.PI);
                radii.push(radii[0]);
            }

            profileData = { type: 'segments', angles, radii };
            infoStr = `, camma: ${segs.length} segmenti`;
        } else {
            // Comportamento legacy (radii equispaziati)
            const radii = d.radii.map(r => ev(r));
            if (!radii.every(r => r > 0)) throw new Error(`${g.id}: tutti i raggi devono essere positivi`);
            profileData = { type: 'radii', radii };
            infoStr = `, camma: ${radii.length} raggi (${Math.min(...radii)}…${Math.max(...radii)} mm)`;
        }

        const rmax = Math.max(...(profileData.radii));
        g.camCS = { 
            profileData, 
            interp, 
            phase, 
            poly: camProfile_CS(profileData, 720, interp, phase), 
            rmax 
        };
        
        return infoStr;
    }
});
/* >>>>> types/gears/cylinder/create.js */
/* =====================================================================
   types/gears/cylinder/create.js
   Disco/cilindro liscio (type "cylinder")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
Registry.gear('cylinder', {
  solids: g => [cylinderSolid(g.r, g.w[0], g.w[1], g.def.n || 32)],     // cylinderSolid è in core/04-geometry.js
  cacheKey: g => [g.def.n]
});

/* >>>>> types/gears/cylinder/solve.js */
/* =====================================================================
   types/gears/cylinder/solve.js
   Disco/cilindro liscio (type "cylinder")
   Metà "COME SI RISOLVE" del tipo: validazione del JSON, parametri, cinematica. La geometria è in create.js.
   ===================================================================== */
Registry.gear('cylinder', {
  meshWith: [],                // non ingrana: si usa per manovelle, tamburi, dischi pilotati da link (pin_slot, geneva...)

  validate(g, w, { E, isVec }) {
    if (g.r === undefined) E(`${w}: manca "r"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  }
});

/* >>>>> types/gears/escape_wheel_CS/create.js */
/* =====================================================================
   types/gears/escape_wheel_CS/create.js
   Ruota di scappamento (type "escape_wheel_CS")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
   ---------------------------------------------------------------------
   Un solo corpo: corona + denti a sega con gancio, che nascono dalla corona (si sovrappongono alla corona, nessuno è "staccato"),
   razze e mozzo. Il foro dell'asse (a D, se solidale) lo fa il simulatore sul solo mozzo: gli altri pezzi sono marcati noBore.
   La posizione dei denti (fase) la fissa il link: all'avvio un dente poggia sulla paletta d'ingresso.
   ===================================================================== */

/* Triangolazione per orecchie di un poligono semplice antiorario (copia privata di questo tipo). */
function earClip_wCS(poly) {
  const n = poly.length, idx = poly.map((_, i) => i), tris = [], eps = 1e-9;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) > eps && cr(b, c, p) > eps && cr(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = 0, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], c = cr(poly[ia], poly[ib], poly[ic]);
      if (Math.abs(c) < flatV) { flatV = Math.abs(c); flat = k; }
      if (c <= eps) continue;
      let ok = true; for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], poly[ia], poly[ib], poly[ic])) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat, ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return n >= 3 ? tris : [];
}

/* Prisma retto di un poligono fra w0 e w1 lungo l'asse locale z. */
function extrude_wCS(poly, w0, w1) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip_wCS(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T, noBore: true };
}

/* Corona circolare (cilindro cavo) fra rIn e rOut. */
function ring_wCS(rOut, rIn, w0, w1, n) {
  const P = [], T = [];
  for (const [r, z] of [[rOut, w0], [rOut, w1], [rIn, w0], [rIn, w1]]) for (let i = 0; i < n; i++) P.push([r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n), z]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i]);                         // parete esterna
    T.push([2 * n + j, 2 * n + i, 3 * n + j], [2 * n + i, 3 * n + i, 3 * n + j]);   // parete interna
    T.push([n + i, n + j, 3 * n + j], [n + i, 3 * n + j, 3 * n + i]); // faccia superiore
    T.push([i, 2 * n + j, j], [i, 2 * n + i, 2 * n + j]);             // faccia inferiore
  }
  return { P, T, noBore: true };
}

Registry.gear('escape_wheel_CS', {
  solids(g) {
    const W = g.graham, c = g.wheelCS, [w0, w1] = g.w, R = g.r;
    if (!W || !c) return [cylinderSolid(R, w0, w1, 64)];                          // senza link: disco semplice
    const N = W.N, p = 2 * Math.PI / N, Rr = R - c.depth, rIn = Math.max(c.hubR + 1, Rr - c.rimWidth), lead = -c.hook * Math.PI / 180, valley = c.valley * Math.PI / 180;
    const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)], out = [];
    out.push(ring_wCS(Rr, rIn, w0, w1, Math.max(96, N * 4)));                     // corona
    for (let m = 0; m < N; m++) {                                                 // denti: dorso lungo, punta a R, faccia anteriore con gancio
      const t = W.phi0Local + m * p;
      out.push(extrude_wCS([pol(Rr, t - p + lead + valley), pol(R, t), pol(Rr, t + lead), pol(Rr - 1.5, t + lead), pol(Rr - 1.5, t - p + lead + valley)], w0, w1));
    }
    const zm = (w0 + w1) / 2, hz = 0.35 * (w1 - w0), sw = 0.09 * R / 2;            // razze: più sottili della corona
    for (let j = 0; j < c.spokes; j++) {
      const a = W.phi0Local + (j + 0.5) * 2 * Math.PI / c.spokes, e = [Math.cos(a), Math.sin(a)], nn = [-e[1], e[0]], r0 = c.hubR - 1, r1 = rIn + 1;
      out.push(extrude_wCS([[e[0] * r0 - nn[0] * sw, e[1] * r0 - nn[1] * sw], [e[0] * r1 - nn[0] * sw, e[1] * r1 - nn[1] * sw], [e[0] * r1 + nn[0] * sw, e[1] * r1 + nn[1] * sw], [e[0] * r0 + nn[0] * sw, e[1] * r0 + nn[1] * sw]], zm - hz, zm + hz));
    }
    out.push(cylinderSolid(c.hubR, w0, w1, 48));                                  // mozzo: il simulatore ci pratica il foro per l'asse
    return out;
  },
  cacheKey: g => [g.graham, g.wheelCS],
  sigKey: g => []
});

/* >>>>> types/gears/escape_wheel_CS/solve.js */
/* =====================================================================
   types/gears/escape_wheel_CS/solve.js
   Ruota di scappamento (type "escape_wheel_CS"), da usare con il link "graham_escapement_CS"
   Metà "COME SI RISOLVE" del tipo: validazione. Il disegno è in create.js; geometria e fisica del contatto con l'ancora sono nel link.
   ---------------------------------------------------------------------
   JSON:  { "id": "ruota_CS", "type": "escape_wheel_CS", "axis": "...", "r": 30, "teeth": 30, "pos": 0, "thickness": 4 }
   Obbligatori:  "r" = raggio delle punte dei denti (mm), "teeth" = numero di denti (≥ 8), posizione e spessore ("w" oppure "pos"+"thickness").
   Facoltativi (numeri o espressioni):
     "toothDepth"  altezza del dente, mm (0,25·r)         "hook"      gancio della faccia anteriore, gradi (3)
     "valley"      larghezza del fondo fra i denti, gradi (1)   "rimWidth"  larghezza della corona, mm (0,12·r)
     "spokes"      numero di razze (5)                    "hubRadius" raggio del mozzo, mm (0,18·r)
   La ruota gira nel verso positivo dell'asse: è quello giusto per lo scappamento.
   ===================================================================== */
Registry.gear('escape_wheel_CS', {
  meshWith: [],                // non ingrana: la muove un motore (clic sulla ruota + slider) e la regola l'ancora
  minTeeth: 8,

  validate(g, w, { E, isVec }) {
    if (g.r === undefined) E(`${w}: manca "r" (raggio delle punte dei denti)`);
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
    for (const k of ['toothDepth', 'hook', 'valley', 'rimWidth', 'spokes', 'hubRadius'])
      if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
  },

  /* Parametri del disegno già valutati (le espressioni possono usare gli slider). */
  resolve(g, { ev }) {
    const d = g.def, R = g.r, n = (v, def) => v !== undefined ? ev(v) : def;
    g.wheelCS = { depth: n(d.toothDepth, 0.25 * R), hook: n(d.hook, 3), valley: n(d.valley, 1), rimWidth: n(d.rimWidth, 0.12 * R), spokes: Math.round(n(d.spokes, 5)), hubR: n(d.hubRadius, 0.18 * R) };
    return `, scappamento: punte a ${R} mm`;
  }
});

/* >>>>> types/gears/escapement/create.js */
/* types/gears/escapement/create.js
   Ruota di scappamento Graham (deadbeat) realistica:
   - denti uniti al corpo
   - faccia di blocco quasi radiale
   - faccia di impulso inclinata
   - proporzioni tipiche (root ~82% del raggio esterno)
*/
function earClip(poly) {
  const idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const eps = 1e-9;
  const inside = (p, a, b, c) =>
    cross(a,b,p) > eps && cross(b,c,p) > eps && cross(c,a,p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = -1, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length];
      const ib = idx[k];
      const ic = idx[(k + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      const cr = cross(a, b, c);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;
      let ok = true;
      for (const j of idx)
        if (j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c)) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat;
    const ia = idx[(k + idx.length - 1) % idx.length];
    const ib = idx[k];
    const ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function extrudePolygon(poly, w0, w1) {
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j], [i, n + j, n + i]);
  }
  for (const [a, b, c] of earClip(poly)) {
    T.push([n + a, n + b, n + c], [a, c, b]);
  }
  return { P, T };
}

function discPoly(R, segs = 48) {
  const p = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2 * Math.PI / segs;
    p.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return p;
}

/**
 * Profilo continuo Graham.
 * Ogni dente:
 *  - root
 *  - faccia di blocco quasi radiale (leggermente sotto-taglio)
 *  - punta
 *  - faccia di impulso inclinata
 * Proporzioni tipiche: root ≈ 0.82 R, denti più “corti” e pieni.
 */
function escapementProfile(N, R) {
  const pts = [];
  const Rroot = R * 0.82;
  const Rtip  = R;
  const pitch = 2 * Math.PI / N;

  // Larghezza angolare alla base (più piena)
  const baseHalf = pitch * 0.28;
  // Offset faccia di blocco (quasi radiale)
  const lockOff  = pitch * 0.06;
  // Offset faccia di impulso (più lunga e inclinata)
  const impOff   = pitch * 0.32;

  for (let i = 0; i < N; i++) {
    const a = i * pitch;

    // 1. Root sinistro
    pts.push([Rroot * Math.cos(a - baseHalf), Rroot * Math.sin(a - baseHalf)]);

    // 2. Inizio faccia di blocco (quasi radiale)
    pts.push([Rtip * 0.96 * Math.cos(a - lockOff), Rtip * 0.96 * Math.sin(a - lockOff)]);

    // 3. Punta
    pts.push([Rtip * Math.cos(a), Rtip * Math.sin(a)]);

    // 4. Fine faccia di impulso → torna al root
    pts.push([Rroot * Math.cos(a + impOff), Rroot * Math.sin(a + impOff)]);
  }
  return pts;
}

function escapementSolids(N, w0, w1, R) {
  const solids = [];

  // Mozzo / corpo interno
  const Rhub = R * 0.48;
  solids.push(extrudePolygon(discPoly(Rhub, 36), w0, w1));

  // Anello di rinforzo sotto i denti
  const Rring = R * 0.78;
  solids.push(extrudePolygon(discPoly(Rring, 48), w0 * 0.7, w1 * 0.7));

  // Profilo esterno continuo (denti uniti)
  solids.push(extrudePolygon(escapementProfile(N, R), w0, w1));

  return solids;
}

Registry.gear('escapement', {
  noRadiusCheck: true,
  radius: g => (g && g.r) || 30,
  solids: g => {
    const N  = (g.def && (g.def.teeth || g.def.slots)) || 30;
    const R  = (g && g.r) || 30;
    const w0 = (g.w && g.w[0] !== undefined) ? g.w[0] : -2;
    const w1 = (g.w && g.w[1] !== undefined) ? g.w[1] :  2;
    return escapementSolids(N, w0, w1, R);
  },
  cacheKey: g => [g.def && g.def.teeth, g.w, g.r],
  sigKey:   g => [g.def && g.def.teeth, g.w, g.r]
});

/* >>>>> types/gears/escapement/solve.js */
Registry.gear('escapement', {
  meshWith: [],
  noRadiusCheck: true,
  radius: g => (g && g.r) || 30,
  validate(g, w, { E, isVec }) {
    if (!g.w || !isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
    if (!g.def) g.def = {};
    if (!g.def.color && !g.color) g.def.color = "#ffcc00";
    if (!g.color) g.color = g.def.color;
  }
});

/* >>>>> types/gears/follower_CS/create.js */
/* =====================================================================
   types/gears/follower_CS/create.js
   Follower (type "follower_CS")
   Meta "COME SI CREA" del tipo: geometria e mesh. La meta "COME SI RISOLVE"
   (validazione, parametri) e in solve.js.
   Pezzi: mozzo sul fulcro e asta.
   FORMA: dipende solo da g.followerCS.tipPoint, calcolato in solve.js.
   - contact "side1" / "side2": punta piatta, rettangolo
       [0,-hw] - [L,-hw] - [L,hw] - [0,hw]
   - contact "tip": becco. Vertice ESATTAMENTE in tipPoint = [L - tipShift, sideOffset].
       Se sideOffset < 0 il becco sta sotto (foto), se > 0 sta sopra.
       La spezzata e:
         becco sotto (sideOffset < 0):
           [0,-hw] - [L-tip,-hw] - tipPoint - [L,hw] - [0,hw]
         becco sopra (sideOffset > 0):
           [0,hw] - [L-tip,hw] - tipPoint - [L,-hw] - [0,-hw]
       Perche asimmetrica? Perche nella foto il bordo opposto al becco
       arriva fino a L, mentre il bordo dal lato del becco si ferma a L-tip.
       Il vertice della mesh e il punto di contatto: non spostarlo mai qui,
       si sposta solo in solve.js con sideOffset e tipShift.
   La direzione dell'asta (angolo locale) la fissa il link (g.rodLocalCS);
   senza link vale "angle" nel riferimento locale dell'asse.
   Il foro per l'asse (a D, se solidale) lo fa il simulatore sul solo mozzo:
   l'asta e marcata noBore.
   ===================================================================== */

function earClip_fCS(poly) {
  const n = poly.length, idx = poly.map((_, i) => i), tris = [], eps = 1e-9;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) > eps && cr(b, c, p) > eps && cr(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = 0, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], c = cr(poly[ia], poly[ib], poly[ic]);
      if (Math.abs(c) < flatV) { flatV = Math.abs(c); flat = k; }
      if (c <= eps) continue;
      let ok = true; for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(poly[j], poly[ia], poly[ib], poly[ic])) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat, ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return n >= 3 ? tris : [];
}

function extrude_fCS(poly, w0, w1) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip_fCS(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T, noBore: true };
}

Registry.gear('follower_CS', {
  solids(g) {
    const c = g.followerCS, [w0, w1] = g.w;
    if (!c) return [cylinderSolid(5, w0, w1, 32)];
    const a = g.rodLocalCS !== undefined ? g.rodLocalCS : c.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), L = c.L, hw = c.width / 2;
    const tip = c.tip !== undefined ? c.tip : Math.min(Math.max(c.width * 3, 6), L * 0.35);
    const loc = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
    const flat = !!c.flatTip;
    let rod;
    if (flat) {
      rod = [[0, -hw], [L, -hw], [L, hw], [0, hw]].map(loc);
    } else {
      // UNICA fonte di verita: tipPoint da solve.js. Mai usare [L,0] o beakH qui.
      const tp = c.tipPoint || [L, c.sideOffset || 0];
      const tx = tp[0], ty = tp[1];
      const baseX = Math.max(0, L - tip);
      if (ty < 0) {
        // Becco sotto, come in foto: bordo sotto si ferma a baseX, bordo sopra arriva a L
        rod = [[0, -hw], [baseX, -hw], [tx, ty], [L, hw], [0, hw]].map(loc);
      } else {
        // Becco sopra, speculare
        rod = [[0, hw], [baseX, hw], [tx, ty], [L, -hw], [0, -hw]].map(loc);
      }
    }
    return [extrude_fCS(rod, w0, w1), cylinderSolid(c.hubR, w0, w1, 40)];
  },
  cacheKey: g => [g.followerCS, g.rodLocalCS],
  sigKey: g => []
});

/* >>>>> types/gears/follower_CS/solve.js */
/* NOTA BECCO - leggi qui prima di toccare altro:
   Il becco della foto NON e un nuovo tipo di contatto. E contact = "tip"
   con sideOffset diverso da 0 e tipShift piccolo.
   Esempio becco in basso (foto): sideOffset = -12, tipShift = 6
     -> tipPoint = [L - 6, -12] = [172, -12] se L = 178
   Esempio becco in alto: sideOffset = +12, tipShift = 6
   La forma a becco si ottiene SOLO da tipPoint. Non esistono piu
   beakH / beakX / beakW / beakSide: se li vedi in un vecchio file, cancellali.
   Regola d'oro: tipPoint e l'UNICA fonte di verita. create.js lo disegna,
   il link lo usa per il contatto. Non spostarlo mai in un solo posto.
*/
/* =====================================================================
   types/gears/follower_CS/solve.js
   Follower (type "follower_CS"): asta uniforme che ruota attorno a un estremo
   (il suo asse), appoggiata a una camma con la punta oppure con un lato piatto.
   Meta "COME SI RISOLVE" del tipo: validazione e parametri.
   Il disegno e in create.js; dinamica e contatto sono nel link "cam_follower_CS".

   JSON minimo:
   {
     "id": "follower_CS",
     "type": "follower_CS",
     "axis": "...",
     "length": 74,
     "pos": 0,
     "thickness": 4
   }

   OBBLIGATORI:
     "length"    lunghezza dell'asta in mm (dal fulcro al vertice nominale).
     posizione e spessore ("w" oppure "pos"+"thickness").

   FACOLTATIVI (numeri o espressioni, tranne "contact"):
     "angle"      direzione iniziale dell'asta, gradi, rispetto alla retta
                  fulcro verso centro camma (default 0).
     "width"      larghezza dell'asta, mm (4).
     "mass"       massa dell'asta (1).
     "hubRadius"  raggio del mozzo, mm (5).

     "contact"    come segue il profilo:
                    "tip"   = punta (default)
                    "side1" = lato 1 (y = +width/2)
                    "side2" = lato 2 (y = -width/2)
                  Accettati anche 0/1/2 e "punta", "lato1", "lato2".
                  Alias vecchi: "mode" (stessi valori) e "side" (1 oppure -1).

     "sideOffset" OBBLIGATORIO se contact = "tip", e deve essere diverso da 0.
                  Offset laterale della punta rispetto all'asse dell'asta, mm:
                    > 0   punta sul lato locale +Y
                    < 0   punta sul lato locale -Y
                  Con contact "side1"/"side2" viene ignorato.

     "tipShift"   facoltativo, solo se contact = "tip": di quanti mm il vertice
                  della punta ARRETRA lungo l'asse dell'asta (0 = vertice a x = L).
                  E la "punta arretrata": vertice della mesh e punto di contatto
                  si spostano INSIEME, quindi nulla si disallinea.
                  Vincolo: 0 <= tipShift <= L - tip (oltre, il naso sparirebbe).

   PUNTO LOCALE DELLA PUNTA (tipPoint), regola d'oro:
     solve.js lo calcola UNA volta sola e lo salva in g.followerCS.tipPoint:
       contact "tip"    ->  [L - tipShift, sideOffset]
       contact "side*"  ->  [L, 0]  (non usato, la punta e piatta)
     create.js disegna il vertice della mesh ESATTAMENTE in tipPoint;
     il link "cam_follower_CS" calcola il contatto ESATTAMENTE in tipPoint.
     Il vertice della mesh e il punto di contatto: non va mai spostato
     in uno solo dei due posti, altrimenti la camma penetra o si stacca.

   FOLLOWER SOLIDALI: piu follower_CS sullo stesso asse sono un corpo solo
   (si sommano coppie e inerzie, ognuno puo toccare la propria camma); una
   ruota qualsiasi sullo stesso asse segue il follower e trascina, attraverso
   gli ingranamenti, tutto cio che e ingranato con lei.
   ===================================================================== */

Registry.gear('follower_CS', {
    meshWith: [],
    noRadiusCheck: true,

    radius: (g, { ev }) => {
        return g.def.length !== undefined ? ev(g.def.length) : 10;
    },

    validate(g, w, { E, isVec }) {
        if (g.length === undefined) {
            E(`${w}: manca "length" (lunghezza dell'asta, mm)`);
        }

        if (!isVec(g.w, 2)) {
            E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
        }

        for (const k of ['length', 'angle', 'width', 'mass', 'hubRadius', 'sideOffset', 'tipShift']) {
            if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') {
                E(`${w}: "${k}" deve essere un numero o un'espressione`);
            }
        }

        if (g.contact !== undefined && typeof g.contact !== 'string' && typeof g.contact !== 'number') {
            E(`${w}: "contact" deve essere "tip", "side1" oppure "side2" (oppure 0, 1, 2)`);
        }

        if (g.mode !== undefined && typeof g.mode !== 'string' && typeof g.mode !== 'number') {
            E(`${w}: "mode" deve essere "tip", "side1" oppure "side2"`);
        }

        if (
            g.side !== undefined &&
            g.side !== 1 && g.side !== -1 &&
            g.side !== '1' && g.side !== '-1'
        ) {
            E(`${w}: "side" deve essere 1 oppure -1`);
        }
    },

    resolve(g, { ev }) {
        const d = g.def;
        const num = (v, def) => (v !== undefined ? ev(v) : def);

        /* ---- 1. Lunghezza dell'asta ---- */
        const L = ev(d.length);
        if (!(L > 0) || !Number.isFinite(L)) {
            throw new Error(`${g.id}: "length" deve essere positiva e finita`);
        }

        /* ---- 2. Sezione e naso della punta ---- */
        const width = num(d.width, 4);
        const hw = width / 2;
        const tipLen = Math.min(Math.max(width * 3, 6), L * 0.35);

        /* ---- 3. Tipo di contatto: tip / side1 / side2 ---- */
        let contact = 'tip';
        const raw = d.contact !== undefined ? d.contact : d.mode;

        if (raw !== undefined) {
            if (typeof raw === 'number') {
                if (raw === 0) contact = 'tip';
                else if (raw === 1) contact = 'side1';
                else if (raw === 2) contact = 'side2';
                else {
                    throw new Error(`${g.id}: "contact" deve essere "tip", "side1" oppure "side2" (oppure 0, 1, 2)`);
                }
            } else if (typeof raw === 'string') {
                const s = raw.trim().toLowerCase().replace(/\s+/g, '');
                if (s === 'tip' || s === 'punta' || s === '0') contact = 'tip';
                else if (s === 'side1' || s === 'lato1' || s === '1') contact = 'side1';
                else if (s === 'side2' || s === 'lato2' || s === '2') contact = 'side2';
                else {
                    throw new Error(`${g.id}: "contact" deve essere "tip", "side1" oppure "side2"`);
                }
            } else {
                throw new Error(`${g.id}: "contact" deve essere "tip", "side1" oppure "side2"`);
            }
        } else if (d.side !== undefined) {
            if (d.side === 1 || d.side === '1') contact = 'side1';
            else if (d.side === -1 || d.side === '-1') contact = 'side2';
            else {
                throw new Error(`${g.id}: "side" deve essere 1 oppure -1`);
            }
        }

        const side = contact === 'side1' ? 1 : contact === 'side2' ? -1 : 0;
        const flatTip = contact !== 'tip';

        /* ---- 4. sideOffset: con "tip" la punta DEVE sporgere da un lato ---- */
        let sideOffset = 0;

        if (!flatTip) {
            if (d.sideOffset === undefined) {
                throw new Error(
                    `${g.id}: con contact "tip" serve "sideOffset" (mm, diverso da zero): ` +
                    `positivo = lato +Y, negativo = lato -Y`
                );
            }

            sideOffset = ev(d.sideOffset);

            if (!Number.isFinite(sideOffset)) {
                throw new Error(`${g.id}: "sideOffset" deve essere un numero finito`);
            }

            if (!(Math.abs(sideOffset) > 1e-9)) {
                throw new Error(
                    `${g.id}: "sideOffset" non puo essere 0 con contact "tip": ` +
                    `la punta deve sporgere da un lato dell'asta`
                );
            }
        } else {
            // Con i lati, sideOffset e ignorato: lo azzero per non lasciare un valore spurio in g.followerCS.
            sideOffset = 0;
        }

        /* ---- 5. tipShift: arretramento del vertice lungo l'asse ---- */
        let tipShift = 0;

        if (!flatTip && d.tipShift !== undefined) {
            tipShift = ev(d.tipShift);

            if (!Number.isFinite(tipShift)) {
                throw new Error(`${g.id}: "tipShift" deve essere un numero finito`);
            }

            if (!(tipShift >= 0)) {
                throw new Error(`${g.id}: "tipShift" deve essere maggiore o uguale a 0`);
            }

            if (tipShift > L - tipLen) {
                throw new Error(
                    `${g.id}: "tipShift" troppo grande (${+tipShift.toFixed(1)} mm): ` +
                    `il vertice arretrerebbe oltre l'attacco del naso ` +
                    `(massimo ${+(L - tipLen).toFixed(1)} mm)`
                );
            }
        } else {
            // Con i lati, tipShift e ignorato.
            tipShift = 0;
        }

        /* ---- 6. Punto locale della punta: UNICA fonte di verita ---- */
        /* create.js ci disegna il vertice della mesh; il link ci calcola il contatto. */
        const tipPoint = flatTip ? [L, 0] : [L - tipShift, sideOffset];

        /* ---- 7. Parametri passati a create.js e al link ---- */
        const Lside = flatTip ? L : L - tipLen;

        g.followerCS = {
            L,
            angle: num(d.angle, 0),
            width,
            mass: num(d.mass, 1),
            hubR: num(d.hubRadius, 5),
            contact,
            side,
            hw,
            tip: tipLen,
            Lside,
            flatTip,
            sideOffset,
            tipShift,
            tipPoint
        };

        /* ---- 8. Stringa di info per il log ---- */
        const label = contact === 'tip'
            ? 'punta'
            : contact === 'side1'
                ? 'lato 1'
                : 'lato 2';

        const parts = [`follower lungo ${+L.toFixed(1)} mm`, label];

        if (!flatTip) {
            parts.push(`offset ${sideOffset > 0 ? '+' : ''}${+sideOffset.toFixed(2)} mm`);
            if (tipShift > 0) parts.push(`punta arretrata ${+tipShift.toFixed(1)} mm`);
        }

        return `, ${parts.join(', ')}`;
    }
});

/* >>>>> types/gears/geneva_driver/create.js */
/* =====================================================================
   types/gears/geneva_driver/create.js
   Driver di un Geneva (type "geneva_driver"): ruota porta-perno + perno + disco di blocco
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (misure, default) è in solve.js.
   ===================================================================== */

/* Profilo del disco di blocco: raggio in funzione dell'angolo, 360 raggi dal centro, con il perno a 0°.
   Raggio massimo = ρ − gioco (ρ = raggio degli archi concavi della croce, calcolato dal link). Dove la croce passa durante l'ingaggio il
   raggio si riduce: si fa muovere la croce come nel simulatore (il perno resta fisso nel riferimento del driver, il centro della croce gli
   gira intorno) e per ogni raggio si prende la prima intersezione con il contorno della croce, in tutte le posizioni dell'ingaggio. */
function genevaLockProfile(gv, gap) {
  const TAU = 2 * Math.PI, rays = 720;
  if (typeof malteseOutline !== 'function') return new Array(rays).fill(Math.max(0.1, gv.rho - gap));      // croce non caricata: disco pieno
  const poly = malteseOutline(gv.N, gv.a, gv.r, gv.hRaw).poly, nP = poly.length, a = gv.a, r = gv.r;
  // A croce ferma il centro del driver sta in (R, -r) nel riferimento della croce (scanalatura 0 lungo +x): il disco deve restare dentro
  // il poligono reale degli archi (non solo dentro la circonferenza ideale di raggio ρ, di cui il poligono è un'approssimazione).
  const Oc = [Math.sqrt(Math.max(0, a * a - r * r)), -r];
  let rLock = Infinity;
  for (let i = 0; i < nP; i++) {
    const p = poly[i], q = poly[(i + 1) % nP], ex = q[0] - p[0], ey = q[1] - p[1], l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((Oc[0] - p[0]) * ex + (Oc[1] - p[1]) * ey) / l2)) : 0;
    rLock = Math.min(rLock, Math.hypot(Oc[0] - p[0] - t * ex, Oc[1] - p[1] - t * ey));
  }
  const rhoD = Math.max(0.1, Math.min(gv.rho, rLock) - gap), prof = new Array(rays).fill(rhoD);
  const beta = Math.acos(Math.min(1, r / a)), S = 1600, best = new Array(rays).fill(Infinity), X = new Array(nP), Y = new Array(nP);
  for (let k = 0; k <= S; k++) {
    const phi = -beta + 2 * beta * k / S;                                       // rotazione del driver; 0 = perno sulla linea dei centri
    const cx = a * Math.cos(phi), cy = -a * Math.sin(phi);                      // centro della croce, nel riferimento del driver
    const kap = Math.atan2(a * Math.sin(phi), r - a * Math.cos(phi)), c = Math.cos(kap), s = Math.sin(kap);   // la scanalatura 0 punta al perno
    for (let i = 0; i < nP; i++) { X[i] = cx + poly[i][0] * c - poly[i][1] * s; Y[i] = cy + poly[i][0] * s + poly[i][1] * c; }
    for (let i = 0; i < nP; i++) {
      const j = (i + 1) % nP, x1 = X[i], y1 = Y[i], dx = X[j] - x1, dy = Y[j] - y1;
      let a1 = Math.atan2(y1, x1), da = Math.atan2(Y[j], X[j]) - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 3) continue;                                           // lato che passa per il centro del driver: non succede
      const lo = da >= 0 ? a1 : a1 + da, span = Math.abs(da);
      const m0 = Math.ceil((((lo % TAU) + TAU) % TAU) / TAU * rays - 1e-9), m1 = Math.floor((((lo % TAU) + TAU) % TAU + span) / TAU * rays + 1e-9);
      for (let m = m0; m <= m1; m++) {
        const ang = m * TAU / rays, ex = Math.cos(ang), ey = Math.sin(ang), den = ex * dy - ey * dx;
        if (Math.abs(den) < 1e-12) continue;
        const sRay = (x1 * dy - y1 * dx) / den, t = (x1 * ey - y1 * ex) / den;
        if (sRay > 0 && t >= -1e-9 && t <= 1 + 1e-9) {
          // il gioco si misura in perpendicolare al lato, non lungo il raggio: su un lato quasi radiale serve ritirarsi di più (max 5 volte)
          const cand = sRay - gap / Math.max(0.2, Math.abs(den) / Math.hypot(dx, dy)), jj = ((m % rays) + rays) % rays;
          if (cand < best[jj]) best[jj] = cand;
        }
      }
    }
  }
  for (let j = 0; j < rays; j++) prof[j] = Math.max(0.1, Math.min(rhoD, best[j]));
  // filtro di minimo di ±1°: fra due raggi consecutivi il poligono del disco collega punti a raggio molto diverso (bordo quasi radiale
  // dell'incavatura): così l'incavatura si allarga di qualche decimo di millimetro e il disco non può toccare la croce in quel tratto
  return prof.map((_, j) => { let m = Infinity; for (let k = -2; k <= 2; k++) m = Math.min(m, prof[(j + k + rays) % rays]); return m; });
}

Registry.gear('geneva_driver', {
  solids(g) {
    const gv = g.geneva, drv = g.drv, TAU = 2 * Math.PI;
    if (!gv || !gv.a || !drv || !gv.zCross) return [cylinderSolid(g.r > 0 ? g.r : 10, g.w[0], g.w[1], 48)];   // senza link: disco semplice
    const [w0, w1] = g.w, [c0, c1] = gv.zCross, pa = gv.pinAngle || 0;
    const tp = drv.pinThickness !== null ? drv.pinThickness : Math.max(1, 0.5 * (w1 - w0));
    const pw = drv.pinSide > 0 ? [c1 + drv.pinGap, c1 + drv.pinGap + tp] : [c0 - drv.pinGap - tp, c0 - drv.pinGap];      // ruota porta-perno, sfalsata rispetto alla croce
    const px = gv.r * Math.cos(pa), py = gv.r * Math.sin(pa);
    const pin = cylinderSolid(drv.pinD / 2, drv.pinSide > 0 ? c0 : (pw[0] + pw[1]) / 2, drv.pinSide > 0 ? (pw[0] + pw[1]) / 2 : c1, 24, px, py);
    pin.noBore = true;                                                          // il perno è fuori asse: non si fora
    const prof = genevaLockProfile(gv, drv.lockGap), n = prof.length, A = [], B = [];          // n = 720 raggi
    for (let j = 0; j < n; j++) {
      const ang = pa + j * TAU / n, x = prof[j] * Math.cos(ang), y = prof[j] * Math.sin(ang);
      A.push([x, y, w0]); B.push([x, y, w1]);
    }
    return [
      cylinderSolid(g.r, pw[0], pw[1], 72),                                     // ruota porta-perno
      pin,
      loft(A, B, [0, 0, w0], [0, 0, w1])                                        // disco di blocco con l'incavatura, allineato con la croce
    ];
  },
  cacheKey: g => [g.geneva, g.drv],
  sigKey: g => []
});

/* >>>>> types/gears/geneva_driver/solve.js */
/* =====================================================================
   types/gears/geneva_driver/solve.js
   Driver di un Geneva (type "geneva_driver"): ruota porta-perno + perno + disco di blocco
   Metà "COME SI RISOLVE" del tipo: validazione e misure. La geometria è in create.js.
   ---------------------------------------------------------------------
   Si usa come "driver" di un link "geneva", senza specificare dove sta il perno: lo calcola il codice (r = interasse·sin(π/N)).
     { "id":"drv", "type":"geneva_driver", "axis":"asse_manovella" }
     { "type":"geneva", "driver":"drv", "driven":"croce", "slots":7 }
   Il driver è fatto da:
     · ruota porta-perno: raggio poco più grande della distanza del perno dal centro, spostata assialmente rispetto alla croce
       (così non può urtarla);
     · perno: sta nella scanalatura della croce, diametro un po' più piccolo della larghezza della scanalatura;
     · disco di blocco: allineato con la croce, del raggio esatto per entrare negli incavi senza toccarli, con l'incavatura
       dove passano le punte della croce durante l'ingaggio.
   Proprietà facoltative del gear (numeri o espressioni, mm):
     "w" / "pos" + "thickness"   posizione e spessore del disco di blocco (default: quelli della croce)
     "pinThickness"  spessore della ruota porta-perno (default: metà dello spessore del disco di blocco, almeno 1)
     "pinGap"        spazio assiale fra la croce e la ruota porta-perno (default 0,5)
     "pinSide"       1 (default) = ruota porta-perno verso +asse rispetto alla croce, -1 = verso -asse
     "pinDiameter"   diametro del perno (default: 0,9 × larghezza della scanalatura)
     "lockGap"       gioco del disco di blocco rispetto alla croce (default 0,15)
     "r"             raggio della ruota porta-perno (default: distanza del perno + diametro del perno)
   La posizione del perno sul driver si sceglie nel link: "pinAngle" (gradi).
   ===================================================================== */
Registry.gear('geneva_driver', {
  meshWith: [],                // non ingrana: se serve una ruota dentata, se ne mette un'altra sullo stesso asse
  noRadiusCheck: true,         // il raggio vero lo fissa il link geneva (genevaDriver)

  radius: () => 10,            // provvisorio, finché il link non conosce interasse e numero di scanalature

  validate(g, w, { E, isVec }) {
    if (g.w !== undefined && !isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
    if (g.pinSide !== undefined && g.pinSide !== 1 && g.pinSide !== -1) E(`${w}: "pinSide" deve essere 1 oppure -1`);
  },

  /* Chiamato dal link geneva (types/links/geneva/solve.js) quando risolve la coppia: gv = dimensioni del Geneva. */
  genevaDriver(g, gv, { ev }) {
    const d = g.def, num = (v, def) => v !== undefined ? ev(v) : def;
    const pinD = num(d.pinDiameter, 1.8 * gv.h);
    g.drv = {
      pinD,
      pinThickness: num(d.pinThickness, null),                  // il default dipende dallo spessore del disco di blocco: lo decide create.js
      pinGap: num(d.pinGap, 0.5),
      pinSide: d.pinSide === -1 ? -1 : 1,
      lockGap: num(d.lockGap, 0.15)
    };
    g.r = num(d.r, gv.r + pinD);                                // raggio della ruota porta-perno
    if (!g.w && gv.zCross) g.w = gv.zCross.slice();             // disco di blocco allineato con la croce
  }
});

/* >>>>> types/gears/maltese/create.js */
/* =====================================================================
   types/gears/maltese/create.js
   Croce di Malta (type "maltese"), la ruota condotta di un link "geneva"
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
/* ---- Croce di Malta -------------------------------------------------------------------------------------------
   Triangolazione dei contorni: i "coperchi" non si possono fare a ventaglio dal centro (la croce non è una figura "stellata":
   le scanalature coprirebbero i lati), quindi si taglia il poligono per orecchie.                                       */
function earClip(poly) {                       // poly: [[x, y], ...] in senso antiorario, semplice → lista di triangoli [i, j, k]
  const n = poly.length, idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const eps = 1e-9;
  const strictlyInside = (p, a, b, c) => cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;
  while (idx.length > 3) {
    let best = -1, flat = -1, flatV = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic], cr = cross(a, b, c);
      if (Math.abs(cr) < flatV) { flatV = Math.abs(cr); flat = k; }
      if (cr <= eps) continue;                                                  // angolo rientrante o piatto
      let ok = true;
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && strictlyInside(poly[j], a, b, c)) { ok = false; break; }
      if (ok) { best = k; break; }
    }
    const k = best >= 0 ? best : flat;                                          // nessun orecchio: si scarta il vertice più piatto (area ≈ 0) e si prosegue
    const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
    if (best >= 0) tris.push([ia, ib, ic]);
    idx.splice(k, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/* Prisma retto di un poligono (antiorario) tra w0 e w1 lungo l'asse z locale: {P, T} come loft(). */
function extrudePolygon(poly, w0, w1) {
  const n = poly.length, P = [], T = [];
  for (const [x, y] of poly) P.push([x, y, w0]);
  for (const [x, y] of poly) P.push([x, y, w1]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; T.push([i, j, n + j], [i, n + j, n + i]); }
  for (const [a, b, c] of earClip(poly)) T.push([n + a, n + b, n + c], [a, c, b]);
  return { P, T };
}

/* Contorno della croce.  N scanalature, interasse a, raggio del perno r (a·sin(π/N) = r nel Geneva corretto), larghezza scanalatura 2h.
   - punte delle braccia a R = √(a²−r²): è dove il perno entra nella scanalatura (tangente, velocità della croce = 0);
   - fondo della scanalatura: semicerchio di raggio h centrato a distanza a−r dal centro (il perno arriva fino lì);
   - tra due scanalature il bordo è l'arco concavo del disco di blocco della manovella (centro sull'asse della manovella, raggio ρ).
   La scanalatura 0 è lungo +x locale (riferimento dell'asse); le altre a passo 2π/N.                                  */
function malteseOutline(N, a, r, h) {
  const R = Math.sqrt(Math.max(0, a * a - r * r));
  h = Math.min(h, 0.9 * R * Math.sin(Math.PI / N), 0.45 * (a - r));
  const x1 = Math.sqrt(R * R - h * h), xc = a - r;
  const dTip = Math.atan2(h, x1), dMax = Math.PI / N - dTip;
  const rho = Math.sqrt(R * R + a * a - 2 * R * a * Math.cos(dMax));          // disco di blocco: passa per le punte
  const nearR = d => a * Math.cos(d) - Math.sqrt(Math.max(0, rho * rho - a * a * Math.sin(d) ** 2));
  const rot = (x, y, t) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
  const poly = [], nFine = 720, nSemi = 8, ARC_STEP = 3 * Math.PI / 180;     // archi: un punto ogni 3° (visti dal centro del disco di blocco)
  for (let k = 0; k < N; k++) {
    const th = k * 2 * Math.PI / N;
    poly.push(rot(x1, -h, th), rot(xc, -h, th));                               // lato inferiore, dalla punta al fondo
    for (let i = 1; i < nSemi; i++) { const p = -Math.PI / 2 - Math.PI * i / nSemi; poly.push(rot(xc + h * Math.cos(p), h * Math.sin(p), th)); }
    poly.push(rot(xc, h, th), rot(x1, h, th));                                 // lato superiore, dal fondo alla punta
    const psi = th + Math.PI / N;                                              // centro del braccio
    // L'arco è una circonferenza centrata sul centro del driver (O = a·e(psi) nel riferimento della croce). Campionandolo uniformemente
    // nell'angolo visto dal centro della croce, vicino alle punte un lato del poligono copriva fino a ~25° dell'arco e la sua corda
    // entrava nel disco di blocco di mezzo millimetro: si tiene un punto ogni ARC_STEP visto da O.
    const ox = a * Math.cos(psi), oy = a * Math.sin(psi); let lastG = null;
    for (let i = 1; i < nFine; i++) {
      const d = -dMax + 2 * dMax * i / nFine, rr = nearR(d), px = rr * Math.cos(psi + d), py = rr * Math.sin(psi + d), g = Math.atan2(py - oy, px - ox);
      if (lastG === null || Math.abs(Math.atan2(Math.sin(g - lastG), Math.cos(g - lastG))) >= ARC_STEP) { poly.push([px, py]); lastG = g; }
    }
  }
  return { poly, R, rho, h };
}

/* geo = { a, r, s0 } viene dal link "geneva" (g.geneva): interasse, raggio del perno, angolo della scanalatura 0 nel riferimento della croce.
   Senza link si ricava un Geneva coerente da R_out (raggio delle punte) con la scanalatura 0 lungo ref. */
function malteseSolid(N, w0, w1, geo, slotWidth, R_out) {
  let a, r;
  if (geo && geo.a > 0 && geo.r > 0 && geo.r < geo.a) ({ a, r } = geo);
  else { const R = R_out || 50; a = R / Math.cos(Math.PI / N); r = R * Math.tan(Math.PI / N); }
  const R = Math.sqrt(a * a - r * r), s0 = (geo && geo.s0) || 0, c = Math.cos(s0), s = Math.sin(s0);
  const poly = malteseOutline(N, a, r, (slotWidth || 0.12 * R) / 2).poly.map(([x, y]) => [x * c - y * s, x * s + y * c]);   // la scanalatura 0 va dove la cerca il link
  return extrudePolygon(poly, w0, w1);
}

Registry.gear('maltese', {
  solids: g => [malteseSolid(g.def.slots || (g.geneva && g.geneva.N) || 4, g.w[0], g.w[1], g.geneva, g.def.slotWidth, g.r)],
  cacheKey: g => [g.def.slots, g.def.slotWidth, g.geneva],
  sigKey: g => [g.def.slots, g.def.slotWidth, g.geneva]
});

/* >>>>> types/gears/maltese/solve.js */
/* =====================================================================
   types/gears/maltese/solve.js + geneva_driver/solve.js
   ===================================================================== */
Registry.gear('maltese', {
  meshWith: [],
  noRadiusCheck: true,
  radius(g, { module }) {
    if (g.r && g.r > 0) return g.r;
    const N = g.def.slots || 4;
    return module(g) * N * 1.5 || 10;
  },
  validate(g, w, { E, W, isVec }) {
    if (g.slots === undefined) E(`${w}: mancano gli "slots" (numero di scanalature, es. 4)`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (spessore lungo l'asse)`);
    if (g.teeth !== undefined) W(`${w}: la croce di Malta non ha "teeth", verranno ignorati`);
  }
});

Registry.gear('geneva_driver', {
  meshWith: [],
  noRadiusCheck: true,
  radius(g){ if(g.r && g.r>0) return g.r; return 10; },
  validate(g, w, { E, W, isVec }){
    // slots opzionale qui: se manca lo prende dal link geneva o dalla croce collegata
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  }
});

// Se l'utente lascia type "spur" come driver, lo accettiamo come driver geneva
Registry.gear('spur', {
  meshWith: [],
  noRadiusCheck: true,
  radius(g){ if(g.r && g.r>0) return g.r; return 20; },
  validate(g,w,{E,isVec}){
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  }
});
/* >>>>> types/gears/spur/create.js */
/* =====================================================================
   types/gears/spur/create.js
   Ingranaggio cilindrico a denti dritti (type "spur", il tipo di default)
   ===================================================================== */
function spurGear(z, m, rho, w0, w1, degStart, degEnd) {
  const prof = toothProfile(z, m, z > 120 ? 6 : 8), pitch = 2 * PI / z;
  let s, e, sector = false;
  if (degStart !== undefined && degEnd !== undefined) {
    s = degStart * PI / 180;
    e = degEnd * PI / 180;
    if (e <= s) e += 2 * PI;
    if (e - s < 2 * PI - 1e-6) sector = true;
  }
  const A = [], B = [];
  const pushPt = (r, a) => {
    const x = r * cos(a), y = r * sin(a);
    A.push([x, y, w0]); B.push([x, y, w1]);
  };
  if (!sector) {
    for (let k = 0; k < z; k++) for (const [r, d] of prof) pushPt(r, rho + k * pitch + d);
    return loft(A, B, [0, 0, w0], [0, 0, w1]);
  }
  const rbase = prof[0][0];
  pushPt(rbase, s);
  const kLo = Math.floor((s - rho) / pitch) - 1;
  const kHi = Math.ceil((e - rho) / pitch) + 1;
  for (let k = kLo; k <= kHi; k++) {
    for (const [r, d] of prof) {
      const a = rho + k * pitch + d;
      if (a > s + 1e-9 && a < e - 1e-9) pushPt(r, a);
    }
  }
  pushPt(rbase, e);
  pushPt(0, 0);
  return loft(A, B, [0, 0, w0], [0, 0, w1]);
}

Registry.gear('spur', {
  // dichiarato anche qui: se solve.js non si fonde, la presa spur↔spur resta valida
  meshWith: ['spur'],
  solids: g => [spurGear(g.z, g.m, g.rho, g.w[0], g.w[1], g.def.degStart, g.def.degEnd)],
  cacheKey: g => [g.def.degStart, g.def.degEnd],
  sigKey: g => [g.def.degStart, g.def.degEnd]
});

/* >>>>> types/gears/spur/solve.js */
/* types/gears/spur/solve.js - con supporto angle iniziale */
Registry.gear('spur', {
  meshWith: ['spur'],
  minTeeth: 3,

  validate(g, w, { E, isVec }){
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
    if (g.bore!==undefined && g.bore!==false){
      const b=g.bore;
      if (typeof b === 'number' || typeof b === 'string') {
      } else if (typeof b === 'object' && b!==null){
        if(b.r===undefined) E(`${w}: bore manca "r"`);
      } else {
        E(`${w}: bore deve essere numero, false oppure {r:...}`);
      }
    }
    if (g.flat!==undefined && g.flat!==false){
      if(typeof g.flat!=='number' && typeof g.flat!=='string'){
        E(`${w}: flat deve essere numero fra 0 e 1, false`);
      }
    }
    if (g.flatAngle!==undefined && typeof g.flatAngle!=='number' && typeof g.flatAngle!=='string'){
      E(`${w}: flatAngle deve essere numero (gradi)`);
    }
    if (g.angle!==undefined && typeof g.angle!=='number' && typeof g.angle!=='string'){
      E(`${w}: angle deve essere numero (gradi) per rotazione iniziale del gear`);
    }
    if (g.phase!==undefined && typeof g.phase!=='number' && typeof g.phase!=='string'){
      E(`${w}: phase deve essere numero (gradi) per rotazione iniziale del gear`);
    }
  },

  // Aggiunge rotazione iniziale al rho calcolato dal core
  afterPairs: null
});

// Hook nel core: verr� chiamato da 09-resolve.js se esiste angle/phase
/* >>>>> types/gears/worm/create.js */
/* =====================================================================
   types/gears/worm/create.js
   Vite senza fine (type "worm")
   Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri, cinematica) è in solve.js.
   ===================================================================== */
function wormParams(m, q, starts, hand, L) {
  const rp = q * m / 2;
  return { m, rp, ra: rp + m, rr: rp - 1.2 * m, px: PI * m, lead: starts * PI * m, starts, hand, L };
}

function wormRadius(wp, u) {
  const au = Math.abs(u), t = Math.tan(PRESSURE);
  const tipHalf = (wp.px / 2 - 2 * (wp.ra - wp.rp) * t) / 2, rootHalf = (wp.px / 2 + 2 * (wp.rp - wp.rr) * t) / 2;
  if (au <= tipHalf) return wp.ra;
  if (au >= rootHalf) return wp.rr;
  return wp.ra - (au - tipHalf) * (wp.ra - wp.rr) / (rootHalf - tipHalf);
}

function wormSolid(wp, rho, w0, w1) {
  const n = 96, nx = Math.max(2, Math.ceil((w1 - w0) / (wp.px / 20))), wc = (w0 + w1) / 2, k = wp.hand * wp.lead / (2 * PI);
  const rings = [];
  for (let i = 0; i <= nx; i++) {
    const x = w0 + (w1 - w0) * i / nx, ring = [];
    for (let j = 0; j < n; j++) {
      const psi = 2 * PI * j / n;
      let u = x - wc - k * psi; u -= wp.px * Math.round(u / wp.px);
      const r = wormRadius(wp, u), a = rho + psi;
      ring.push([r * cos(a), r * sin(a), x]);
    }
    rings.push(ring);
  }
  return ringsLoft(rings, [0, 0, w0], [0, 0, w1]);
}


Registry.gear('worm', {
  solids: g => [wormSolid(g.wp, g.rho, g.w[0], g.w[1])],
  cacheKey: g => [g.wp]
});

/* >>>>> types/gears/worm/solve.js */
/* =====================================================================
   types/gears/worm/solve.js
   Vite senza fine (type "worm")
   Metà "COME SI RISOLVE" + validazione interasse worm/wheel
   ===================================================================== */
Registry.gear('worm', {
  meshWith: ['wormwheel'],
  toothPhase: false,

  defaultTeeth: (g, ev) => ev(g.def.starts === undefined ? 1 : g.def.starts),
  radius: (g, { ev, teeth, module }) => g.def.q !== undefined ? ev(g.def.q) * module(g) / 2 : teeth(g) * module(g) / 2,
  anchorOffset: (g, { vec }) => { const w = vec(g.def.w); return (w[0] + w[1]) / 2; },

  validate(g, w, { E, isVec }) {
    if (g.q === undefined) E(`${w}: manca "q"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
  },

  resolve(g, { ev }) {
    g.hand = g.def.hand || 1;
    g.wp = wormParams(g.m, ev(g.def.q), g.z, g.hand, g.w[1] - g.w[0]);
    step('vite', `${g.id}: principi=${g.z}, q=${ev(g.def.q)}, rp=${+g.wp.rp.toFixed(3)}, passo=${+g.wp.px.toFixed(3)}`);
  },

  /* Controllo interasse lato vite (simmetrico a quello della ruota) */
  contact(g, p) {
    // g = vite, p = ruota
    const offG = (g.w[0] + g.w[1]) / 2;
    const offP = (p.w[0] + p.w[1]) / 2;
    const Og = V.add(g.ax.O, V.mul(g.ax.dir, offG));
    const Op = V.add(p.ax.O, V.mul(p.ax.dir, offP));
    const delta = V.sub(Op, Og);

    const dotAxes = V.dot(g.ax.dir, p.ax.dir);
    const cross = V.cross(g.ax.dir, p.ax.dir);
    const crossLen = V.len(cross);
    const dist = crossLen < 1e-9 ? V.len(delta) : Math.abs(V.dot(delta, cross)) / crossLen;
    const expected = g.r + p.r; // = m*(q+z2)/2

    // tolleranza: 1% del modulo o 0.05 mm
    const tol = Math.max(0.05, g.m * 0.05);
    step('ingranamento', `${p.id} (ruota z=${p.z}) ⇄ ${g.id} (vite q=${g.wp.q / g.m}): interasse misurato ${dist.toFixed(3)} mm, atteso ${expected.toFixed(3)} mm`);

    if (Math.abs(dotAxes) > 0.02) {
      warn('ingranamento', `Vite ${g.id} – ruota ${p.id}: assi non perpendicolari (dot=${dotAxes.toFixed(3)}), atteso 0`);
    }
    // proiezione del vettore interasse sugli assi deve essere ~0 se gli anchor sono allineati
    const projG = V.dot(delta, g.ax.dir);
    const projP = V.dot(delta, p.ax.dir);
    if (Math.abs(projG) > tol || Math.abs(projP) > tol) {
      warn('ingranamento', `Vite ${g.id} – ruota ${p.id}: anchor disallineati, proiezioni ${projG.toFixed(3)}, ${projP.toFixed(3)} mm`);
    }
    if (Math.abs(dist - expected) > tol) {
      // usa E se vuoi bloccare, W se vuoi solo avvisare
      warn('ingranamento', `⛔ INTERASSE ERRATO Vite ${g.id} – ruota ${p.id}: misurato ${dist.toFixed(3)} mm invece di ${expected.toFixed(3)} mm (q=${g.wp.q / g.m}, z2=${p.z}, m=${g.m}). Correggi la place di axis_worm: dovrebbe essere (q+z2)*m/2 = ${expected.toFixed(3)}`);
    }

    const uc = V.unit(V.perp(V.sub(p.ax.O, g.ax.O), g.ax.dir));
    p.sprime = Math.sign(V.dot(p.ax.dir, V.cross(g.ax.dir, uc))) || 1;
    return { X: Og, cg: uc, cp: V.mul(uc, -1) };
  }
});
/* >>>>> types/gears/wormwheel/create.js */
/* =====================================================================
   types/gears/wormwheel/create.js
   Ruota per vite senza fine (type "wormwheel")

   FIX: il taglio dei denti usa coordinate LOCALI rispetto al centro della
   fascia (zMid), non le z assolute su w0..w1. Così i denti restano nella
   zona di contatto anche se la ruota (o la vite) non è centrata sull'origine
   dell'asse (es. w = [100, 140]).
   ===================================================================== */
const wheelFace = (m, wp) => 1.7 * Math.sqrt(4.5 * m * wp.rp);

function wormWheelSolid(z, m, wp, sg, rho, w0, w1) {
  const rg = z * m / 2, a = wp.rp + rg, t = Math.tan(PRESSURE), e = 0.03 * m;
  const rc = wp.ra + 0.25 * m, rBlank = rg + m;

  // Centro della fascia: il modello di taglio è definito in un sistema
  // centrato sul piano di contatto (z locale = 0), non sull'origine dell'asse.
  const zMid = 0.5 * (w0 + w1);

  const inCutter = (Y, Zc, xt) => {
    const r = Math.hypot(Y, Zc);
    if (r > rc) return false;
    if (r <= wp.rr) return true;
    let u = xt - wp.hand * wp.lead / (2 * PI) * Math.atan2(Zc, Y);
    u -= wp.px * Math.round(u / wp.px);
    return Math.abs(u) <= wp.px / 4 - (r - wp.rp) * t + e;
  };

  // zLocal = coordinata rispetto al piano mediano della fascia (contatto)
  const cut = (r, phiP, zLocal) => {
    const lim = (a - rc) / r;
    if (lim >= 1) return false;
    const Pm = Math.acos(Math.max(-1, lim)), NS = 90;
    for (let s = 0; s <= NS; s++) {
      const Phi = -Pm + 2 * Pm * s / NS, X = sg * r * Math.sin(Phi);
      if (Math.abs(X) > wp.L / 2) continue;
      if (inCutter(a - r * Math.cos(Phi), sg * zLocal, X - sg * rg * (Phi - phiP))) return true;
    }
    return false;
  };

  const nPhi = 40, nZ = 17, pitch = 2 * PI / z, rLo = a - rc - 0.5 * m, table = [];
  for (let iz = 0; iz < nZ; iz++) {
    const zP = w0 + (w1 - w0) * iz / (nZ - 1);
    const zLocal = zP - zMid;           // <-- FIX: taglio in coordinate locali
    const row = [];
    for (let ip = 0; ip < nPhi; ip++) {
      const phiP = pitch * ip / nPhi;
      let r = rBlank;
      if (cut(rBlank, phiP, zLocal)) {
        let lo = rLo, hi = rBlank;
        for (let b = 0; b < 16; b++) {
          const mid = (lo + hi) / 2;
          if (cut(mid, phiP, zLocal)) hi = mid; else lo = mid;
        }
        r = lo;
      }
      row.push(r);
    }
    table.push(row);
  }

  // I rings restano alle z ASSOLUTE (w0..w1) sull'asse della ruota
  const rings = table.map((row, iz) => {
    const zP = w0 + (w1 - w0) * iz / (nZ - 1), ring = [];
    for (let k = 0; k < z; k++) for (let ip = 0; ip < nPhi; ip++) {
      const ang = rho + (k * nPhi + ip) * 2 * PI / (z * nPhi);
      ring.push([row[ip] * cos(ang), row[ip] * sin(ang), zP]);
    }
    return ring;
  });
  return ringsLoft(rings, [0, 0, w0], [0, 0, w1]);
}

Registry.gear('wormwheel', {
  meshWith: ['worm'],
  solids: g => [wormWheelSolid(g.z, g.m, g.partner.wp, g.sprime, g.rho, g.w[0], g.w[1])],
  cacheKey: g => [g.partner && g.partner.wp, g.sprime, g.w && g.w[0], g.w && g.w[1]]
});

/* >>>>> types/gears/wormwheel/solve.js */
/* =====================================================================
   types/gears/wormwheel/solve.js
   Ruota per vite senza fine (type "wormwheel")
   FIX interasse + FIX w non centrato sull'origine
   ===================================================================== */
Registry.gear('wormwheel', {
  meshWith: ['worm'],
  minTeeth: 3,
  toothPhase: false,

  validate(g, w, { E }) {
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!g.meshWith) E(`${w}: una ruota per vite senza fine deve avere meshWith = la vite`);
  },

  /* Larghezza di fascia: dipende dalla vite. Se c'è pos/thickness, centra la fascia lì. */
  afterPairs(g, { ev, vec }) {
    if (!g.partner || g.partner.type !== 'worm') throw new Error(`${g.id}: una ruota per vite deve avere meshWith = una vite`);
    const f = g.def.face !== undefined ? ev(g.def.face) : wheelFace(g.m, g.partner.wp);
    if (g.def.w !== undefined) {
      g.w = vec(g.def.w);
    } else if (g.def.pos !== undefined) {
      const pos = ev(g.def.pos);
      const th = g.def.thickness !== undefined ? ev(g.def.thickness) : f;
      const center = pos + th/2;
      g.w = [center - f/2, center + f/2];
    } else {
      g.w = [-f/2, f/2];
    }
    step('ruota-vite', `${g.id}: larghezza fascia ${f.toFixed(2)} mm, w=[${g.w[0].toFixed(2)}, ${g.w[1].toFixed(2)}]`);
  },

  /* Contatto vite/ruota con controllo interasse robusto */
  contact(g, p) {
    // g = ruota, p = vite
    const offG = (g.w[0] + g.w[1]) / 2;
    const offP = (p.w[0] + p.w[1]) / 2;
    const Og = V.add(g.ax.O, V.mul(g.ax.dir, offG));
    const Op = V.add(p.ax.O, V.mul(p.ax.dir, offP));
    const delta = V.sub(Og, Op);

    const dotAxes = V.dot(g.ax.dir, p.ax.dir);
    const cross = V.cross(g.ax.dir, p.ax.dir);
    const crossLen = V.len(cross);
    const dist = crossLen < 1e-9 ? V.len(delta) : Math.abs(V.dot(delta, cross)) / crossLen;
    const expected = g.r + p.r; // m*(q+z)/2

    const tol = Math.max(0.05, g.m * 0.05);
    step('ingranamento', `${g.id} (ruota z=${g.z}) ⇄ ${p.id} (vite q=${(p.wp.q/g.m).toFixed(1)}): interasse misurato ${dist.toFixed(3)} mm, atteso ${expected.toFixed(3)} mm (m*(q+z)/2)`);

    if (Math.abs(dotAxes) > 0.02) {
      warn('ingranamento', `Vite ${p.id} – ruota ${g.id}: assi non perpendicolari (dot=${dotAxes.toFixed(3)})`);
    }
    const projG = V.dot(delta, g.ax.dir);
    const projP = V.dot(delta, p.ax.dir);
    if (Math.abs(projG) > tol || Math.abs(projP) > tol) {
      warn('ingranamento', `Vite ${p.id} – ruota ${g.id}: anchor disallineati, proiezioni su assi ${projG.toFixed(3)}, ${projP.toFixed(3)} mm`);
    }
    if (Math.abs(dist - expected) > tol) {
      warn('ingranamento', `⛔ INTERASSE ERRATO Vite ${p.id} – ruota ${g.id}: misurato ${dist.toFixed(3)} mm invece di ${expected.toFixed(3)} mm. Formula: a = m*(q+z2)/2 = ${g.m}*(${p.wp.q/g.m}+${g.z})/2`);
    }

    const uc = V.unit(V.perp(V.sub(g.ax.O, p.ax.O), p.ax.dir));
    g.sprime = Math.sign(V.dot(g.ax.dir, V.cross(p.ax.dir, uc))) || 1;
    return { X: V.add(g.ax.O, V.mul(uc, -g.r)), cg: V.mul(uc, -1), cp: uc };
  },

  meshRow(m, n) {
    const row = new Array(n).fill(0);
    row[m.g.ax.idx] += m.g.z;
    row[m.p.ax.idx] += m.p.hand * m.g.sprime * m.p.z;
    return row;
  }
});
/* >>>>> types/links/anchor_escapement/create.js */
/* types/links/anchor_escapement/create.js
   Il link non crea oggetti propri: geometria è già nei gear escapement + anchor
*/
/* >>>>> types/links/anchor_escapement/solve.js */
/* types/links/anchor_escapement/solve.js
   Scappamento Graham
   - Periodo da sqrt(L) (slider lunghezza)
   - Attrito e ampiezza letti live da state.params
   - Rallentatore via slider → state.timeScale
   - Energia solo quando la ruota è driver con velocità > 0
*/
function liveParam(nameOrVal, fallback) {
  // Se è una stringa (id del controllo), leggi il valore live
  if (typeof nameOrVal === 'string') {
    if (typeof state !== 'undefined') {
      // state.params[id] è il valore numerico corrente del controllo
      if (state.params && state.params[nameOrVal] != null) {
        const v = +state.params[nameOrVal];
        if (!isNaN(v)) return v;
      }
      // fallback: state.ctrl[id].all
      if (state.ctrl && state.ctrl[nameOrVal]) {
        const c = state.ctrl[nameOrVal];
        const v = +(typeof c === 'object' ? (c.all ?? c[Object.keys(c)[0]]) : c);
        if (!isNaN(v)) return v;
      }
    }
    const parsed = parseFloat(nameOrVal);
    return isNaN(parsed) ? fallback : parsed;
  }
  if (typeof nameOrVal === 'number' && !isNaN(nameOrVal)) return nameOrVal;
  return fallback;
}

function updateEscapements(M) {
  // --- Rallentatore ---
  // Se c'è un controllo "timeScale" nel JSON, usalo; altrimenti state.timeScale esistente
  if (typeof state !== 'undefined') {
    const ts = liveParam('timeScale', state.timeScale ?? 1);
    state.timeScale = Math.max(0.01, Math.min(5, ts));
  }
  const scale = (typeof state !== 'undefined' && typeof state.timeScale === 'number')
    ? state.timeScale
    : 1;

  let dt = (typeof M.dt === 'number' && M.dt > 0) ? M.dt : (1 / 60);
  dt *= scale;
  if (!(dt > 0)) dt = 1e-6;
  if (dt > 0.05) dt = 0.05;

  const g_mm = 9810;

  for (const gv of M.escapements || []) {
    const axE = gv.g1.ax;
    const axA = gv.g2.ax;
    const N  = gv.N || 30;
    const halfPitch = Math.PI / N;

    // ---------- parametri LIVE ----------
    let L = gv.g2.pendLen;
    if (L == null || !(L > 0)) {
      L = (gv.g2.def && (gv.g2.def.pendulumLength || gv.g2.def.pendLen)) || 160;
    }
    if (typeof L === 'string') L = liveParam(L, 160);
    gv.pendLen = Math.max(20, +L);

    // attrito: dal link ("frictionVal") o default
    const friction = Math.max(0.001, Math.min(0.5,
      liveParam(gv.friction ?? gv.def?.friction ?? 'frictionVal', 0.03)
    ));

    // ampiezza target in gradi → radianti
    const ampDeg = liveParam(gv.amplitude ?? gv.def?.amplitude ?? 'amplitude', 6);
    const targetAmp = Math.max(2, Math.min(20, ampDeg)) * Math.PI / 180;

    const lockAng    = ((gv.def?.lockAngle    ?? 1.5) * Math.PI / 180);
    const impulseAng = ((gv.def?.impulseAngle ?? 4.0) * Math.PI / 180);
    const dropAng    = ((gv.def?.dropAngle    ?? 1.0) * Math.PI / 180);

    if (gv.lastTheta === undefined) {
      gv.lastTheta = axA.theta;
      gv.vel = 0;
      gv.state = 'locked_entry';
      gv.impulse = 0;
      gv.power = 0;
      gv.locked = true;
    }

    const omega0 = Math.sqrt(g_mm / gv.pendLen);
    // damping fortemente influenzato dallo slider attrito
    const damping = 0.008 + friction * 3.5;

    // ---------- potenza e SENSO di rotazione dalla catena ----------
    // Driver valido se è sullo stesso asse dello scappamento OPPURE su un asse
    // collegato via mesh. Il segno viene propagato lungo la catena (rapporto denti).
    let isWheelDriver = false;
    let driverOmegaAbs = 0;
    let driveSign = gv.driveSign || 1; // segno sullo scappamento (+1 / -1)

    if (typeof state !== 'undefined' && state.driver && M.gearBy) {
      const dg = M.gearBy[state.driver.gear];
      const escAxIdx = gv.g1.ax ? gv.g1.ax.idx : -1;
      const rawW = state.driver.w || 0;

      if (dg && dg.ax != null && escAxIdx >= 0 && Math.abs(rawW) > 1e-6) {
        const drvAxIdx = dg.ax.idx;

        // rapporto di trasmissione asse_driver → asse_scappamento
        // costruiamo un grafo con segno: edge (i→j) con fattore k  ⇒  ω_j = k * ω_i
        const factorTo = new Map(); // axisIdx → fattore rispetto al driver
        factorTo.set(drvAxIdx, 1);

        const edges = []; // {a, b, k}  ω_b = k * ω_a
        for (const m of (M.meshes || [])) {
          if (!m.g || !m.p || !m.g.ax || !m.p.ax) continue;
          const z1 = m.g.z || m.g.def?.teeth || 1;
          const z2 = m.p.z || m.p.def?.teeth || 1;
          const i1 = m.g.ax.idx, i2 = m.p.ax.idx;
          // esterna: ω2 = -(z1/z2) ω1
          edges.push({ a: i1, b: i2, k: -(z1 / z2) });
          edges.push({ a: i2, b: i1, k: -(z2 / z1) });
        }
        // solidali sullo stesso asse: fattore 1
        for (const g of (M.gears || [])) {
          if (!g.ax) continue;
          for (const h of (M.gears || [])) {
            if (h !== g && h.ax && h.ax.idx === g.ax.idx) {
              edges.push({ a: g.ax.idx, b: h.ax.idx, k: 1 });
            }
          }
        }

        let changed = true;
        while (changed) {
          changed = false;
          for (const e of edges) {
            if (factorTo.has(e.a) && !factorTo.has(e.b)) {
              factorTo.set(e.b, factorTo.get(e.a) * e.k);
              changed = true;
            }
          }
        }

        if (factorTo.has(escAxIdx) || drvAxIdx === escAxIdx) {
          isWheelDriver = true;
          const fac = factorTo.has(escAxIdx) ? factorTo.get(escAxIdx) : 1;
          const omegaOnEsc = rawW * fac;
          driverOmegaAbs = Math.abs(omegaOnEsc);
          driveSign = omegaOnEsc >= 0 ? 1 : -1;
          gv.driveSign = driveSign;
        }
      }
    }

    if (isWheelDriver && driverOmegaAbs > 1e-4) {
      const targetPower = Math.min(5.5, 0.8 + driverOmegaAbs * 2.5);
      gv.power += (targetPower - gv.power) * Math.min(1, 4 * dt);
    } else {
      gv.power *= Math.max(0, 1 - 8 * dt);
      if (gv.power < 0.05) gv.power = 0;
    }

    // soglie intorno allo zero
    const entryUnlock     = -lockAng;
    const entryImpulseEnd = -lockAng - impulseAng;
    const exitUnlock      = +lockAng;
    const exitImpulseEnd  = +lockAng + impulseAng;
    // softClamp dipende dall'ampiezza target (slider)
    const softClamp = Math.max(targetAmp * 1.6, 12 * Math.PI / 180);

    let shouldAdvance = false;
    let impulseDir = 0;

    if (gv.state === 'locked_entry') {
      if (axA.theta < entryUnlock && gv.power > 0.05) {
        gv.state = 'impulse_entry';
        shouldAdvance = true;
        impulseDir = -1;
      }
    } else if (gv.state === 'impulse_entry') {
      if (axA.theta < entryImpulseEnd - dropAng) {
        gv.state = 'locked_exit';
      }
    } else if (gv.state === 'locked_exit') {
      if (axA.theta > exitUnlock && gv.power > 0.05) {
        gv.state = 'impulse_exit';
        shouldAdvance = true;
        impulseDir = +1;
      }
    } else if (gv.state === 'impulse_exit') {
      if (axA.theta > exitImpulseEnd + dropAng) {
        gv.state = 'locked_entry';
      }
    }

    // Kick di avvio solo con potenza
    if (gv.power > 0.1 && Math.abs(gv.vel) < 0.1 * omega0 && Math.abs(axA.theta) < 2.0 * Math.PI / 180) {
      const kickDir = (gv.state === 'locked_entry' || gv.state === 'impulse_entry') ? -1 : 1;
      gv.vel += kickDir * 1.6 * omega0;
      gv.impulse = kickDir * 1.8 * omega0;
    }

    // motore spento → smorza forte
    if (gv.power < 0.05) {
      gv.vel *= Math.max(0, 1 - 3 * dt);
      gv.impulse = 0;
    }

    // avanzamento + impulso (mirato all'ampiezza target)
    gv.locked = !shouldAdvance;

    if (shouldAdvance && gv.power > 0.05) {
      // scatto dello scappamento nel verso imposto dal driver
      const step = (gv.driveSign || 1) * halfPitch;
      axE.theta += step;

      // Propaga lo scatto a tutti gli assi collegati via mesh (rapporto denti, segno invertito)
      if (M.meshes && M.meshes.length) {
        const dTheta = new Map();
        dTheta.set(axE.idx, step);
        let changed = true;
        while (changed) {
          changed = false;
          for (const m of M.meshes) {
            if (!m.g || !m.p || !m.g.ax || !m.p.ax) continue;
            const i1 = m.g.ax.idx, i2 = m.p.ax.idx;
            const z1 = m.g.z || m.g.def?.teeth || 1;
            const z2 = m.p.z || m.p.def?.teeth || 1;
            // ω2 = - (z1/z2) * ω1  →  Δθ2 = - (z1/z2) * Δθ1
            if (dTheta.has(i1) && !dTheta.has(i2)) {
              dTheta.set(i2, - (z1 / z2) * dTheta.get(i1));
              changed = true;
            } else if (dTheta.has(i2) && !dTheta.has(i1)) {
              dTheta.set(i1, - (z2 / z1) * dTheta.get(i2));
              changed = true;
            }
          }
        }
        for (const [idx, dth] of dTheta) {
          if (idx === axE.idx) continue; // già applicato
          const ax = M.axes[idx];
          if (ax) ax.theta += dth;
        }
      }

      const frNorm = Math.min(1, friction * 5);
      const eff = (1 - frNorm * 0.45);

      const E = 0.5 * gv.vel * gv.vel + omega0 * omega0 * (1 - Math.cos(axA.theta));
      const Etarget = omega0 * omega0 * (1 - Math.cos(targetAmp));
      const deficit = Math.max(0, Etarget - E);

      const boost = Math.sqrt(2 * deficit) * 0.55 * eff;
      const pBoost = gv.power * 0.5 * eff * omega0;
      const dir = impulseDir || (gv.vel >= 0 ? 1 : -1);

      gv.impulse = dir * (0.18 * omega0 + boost + pBoost);
      gv.power = Math.max(0, gv.power - (0.2 + frNorm * 0.15));
    } else {
      gv.impulse *= 0.8;
    }

    // integrazione pendolo
    const alpha = -omega0 * omega0 * Math.sin(axA.theta) - damping * gv.vel + gv.impulse;
    gv.vel += alpha * dt;
    axA.theta += gv.vel * dt;

    if (axA.theta >  softClamp) { axA.theta =  softClamp; gv.vel *= 0.2; }
    if (axA.theta < -softClamp) { axA.theta = -softClamp; gv.vel *= 0.2; }

    gv.lastTheta = axA.theta;
  }
}

Registry.link('anchor_escapement', {
  collection: 'escapements',
  order: { resolve: 20, constraints: 55, afterIntegrate: 10 },

  validate(l, w, { E }) {
    if (!l.driver) E(`${w}: manca "driver" (id della ruota di scappamento)`);
    if (!l.driven) E(`${w}: manca "driven" (id dell’ancora)`);
  },

  resolve(M) {
    for (const l of activeLinks('anchor_escapement')) {
      const g1 = M.gearBy[l.driver];
      const g2 = M.gearBy[l.driven];
      if (!g1) throw new Error(`anchor_escapement: driver "${l.driver}" non trovato`);
      if (!g2) throw new Error(`anchor_escapement: driven "${l.driven}" non trovato`);

      const N = l.teeth || g1.z || (g1.def && (g1.def.teeth || g1.def.z)) || 30;
      const R = g1.r || 30;
      g1.escapement = { R, N };
      g2.escapement = { R, N };
      g1.r = R;

      M.escapements.push({
        def: l, g1, g2, N, R,
        friction: l.friction || 'frictionVal',
        amplitude: l.amplitude || 'amplitude',
        lastTheta: undefined,
        vel: 0,
        state: 'locked_entry',
        impulse: 0,
        power: 0,
        locked: true
      });
    }
  },

  constraints(M, push, { unit }) {
    for (const gv of M.escapements) {
      if (gv.locked !== false) {
        push('anchor_escapement', `bloccato ${gv.g1.id}`, unit(gv.g1.ax.idx), 0, { axisIdx: gv.g1.ax.idx });
      }
    }
  },

  afterIntegrate: M => updateEscapements(M),
  settle:         M => updateEscapements(M)
});

/* >>>>> types/links/brake/create.js */
/* =====================================================================
   types/links/brake/create.js
   Freno (link "brake"): ceppo che ferma un asse
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
Registry.link('brake', {
  order: { build: 10, afterPose: 30 },

  build(M, { inGroup }) {
    for (const b of M.brakes) {
      const s = b.def.shoe, at = V.toB(s.at.map(e => M.ev(e))), rel = V.toB(s.released);
      b.mesh = BABYLON.MeshBuilder.CreateBox('shoe', { width: s.size[0], height: s.size[2], depth: s.size[1] }, scene);
      b.mesh.material = new BABYLON.StandardMaterial('shoeMat', scene); b.mesh.isPickable = false;
      b.engaged = toV3(at); b.released = toV3(V.add(at, rel));
      M.extras.push(b.mesh); inGroup(b.def.group, b.mesh);
      step('scena', `freno su ${b.def.axis}: ceppo creato`);
    }
  },

  /* Casella "freno inserito" nel pannello (contenitore #brakes) */
  panel(M, { el, box, explainSoon }) {
    for (const b of M.brakes) {
      const c = el('input', { type: 'checkbox', checked: !!state.brakes[b.def.axis] });
      c.onchange = () => { state.brakes[b.def.axis] = c.checked; explainSoon(); };
      box.append(el('label', {}, c, ' ' + b.def.label));
    }
  },

  /* A ogni frame: il ceppo sta sull'asse se il freno è inserito, altrimenti si ritrae (e cambia colore) */
  afterPose(M) {
    for (const b of M.brakes) {
      const on = !!state.brakes[b.def.axis];
      b.mesh.position.copyFrom(on ? b.engaged : b.released);
      b.mesh.material.diffuseColor = C3.FromHexString(on ? '#d4262e' : '#6b7280');
    }
  }
});

/* >>>>> types/links/brake/solve.js */
/* =====================================================================
   types/links/brake/solve.js
   Freno (link "brake"): ferma un asse quando è inserito
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('brake', {
  collection: 'brakes',
  order: { constraints: 10, status: 20 },

  validate(l, w, { E, ax, isVec }) {
    ax(l.axis, 'axis');
    if (!l.shoe || !isVec(l.shoe.at, 3) || !isVec(l.shoe.size, 3) || !isVec(l.shoe.released, 3)) E(`${w}: "shoe" richiede at, size e released con 3 elementi ciascuno`);
  },

  resolve(M) {
    for (const l of activeLinks('brake')) {
      CTX.where = `link brake`;
      M.brakes.push({ def: l, idx: M.axisBy[l.axis].idx });
      step('link', `freno su ${l.axis}`);
    }
  },

  /* Freno inserito → velocità dell'asse = 0 (precedenza massima fra i vincoli) */
  constraints(M, push, { unit }) {
    for (const b of M.brakes) if (state.brakes[b.def.axis]) push('freno', `freno su ${b.def.axis}`, unit(b.idx), 0, { axisIdx: b.idx });
  },

  status: M => M.brakes.filter(b => state.brakes[b.def.axis] && b.def.message).map(b => b.def.message)
});

/* >>>>> types/links/cam_follower_CS/create.js */
/* =====================================================================
   types/links/cam_follower_CS/create.js
   Camma e follower (link "cam_follower_CS")
   Metà "COME SI CREA" del link: oggetti grafici. Camma e follower li disegnano i gear cam_CS e follower_CS; qui c'è solo la molla
   (una spezzata a zig-zag fra i due assi, aggiornata a ogni frame; blu se tesa, rossa se compressa).
   ===================================================================== */
const SPRING_SEGMENTS = 14;
const SPRING_RADIUS = 1;
const SPRING_TESSELLATION = 6;
const COLOR_COMPRESSED = BABYLON.Color3.FromHexString('#0000ff'); // rosso
const COLOR_TENSED = BABYLON.Color3.FromHexString('#ff0000');    // blu

Registry.link('cam_follower_CS', {
  order: { build: 100, afterPose: 100 },

  build(M, { inGroup }) {
    for (const G of (M.camGroupsCS || [])) for (const s of G.springs) {
      const pts = Array.from({ length: SPRING_SEGMENTS + 1 }, () => new BABYLON.Vector3(0, 0, 0));
      s.mesh = BABYLON.MeshBuilder.CreateTube('molla_CS', {
        path: pts,
        radius: SPRING_RADIUS,
        tessellation: SPRING_TESSELLATION,
        updatable: true
      }, scene);
      s.mesh.isPickable = false;

      const mat = new BABYLON.StandardMaterial('molla_mat_' + s.mesh.uniqueId, scene);
      mat.diffuseColor = COLOR_TENSED.clone();
      mat.emissiveColor = COLOR_TENSED.clone();
      s.mesh.material = mat;

      M.extras.push(s.mesh); inGroup(s.link.group, s.mesh);
    }
  },

  afterPose(M) {
    for (const G of (M.camGroupsCS || [])) for (const s of G.springs) if (s.mesh) {
      const world = (e, th) => { const p = CamCS.endPos(e, th); return V.add(V.add(V.add(G.axF.O, V.mul(G.X, p[0])), V.mul(G.Y, p[1])), V.mul(G.k, e.axial)); };
      const a = world(s.a, G.st.th), b = world(s.b, G.st.th), d = V.sub(b, a), len = V.len(d);
      if (len < 1e-6) continue;
      const u = V.mul(d, 1 / len), side = V.unit(V.cross(G.k, u)), N = SPRING_SEGMENTS, amp = Math.min(2.5, len * 0.08), pts = [];
      for (let i = 0; i <= N; i++) {
        let p = V.add(a, V.mul(u, len * i / N));
        if (i > 0 && i < N) p = V.add(p, V.mul(side, (i % 2 ? 1 : -1) * amp));
        pts.push(toV3(V.toB(p)));
      }
      BABYLON.MeshBuilder.CreateTube(null, { path: pts, instance: s.mesh }, scene);

      // Interpolazione colore: 0 = compressa (rosso), 1 = tesa (blu)
      const ratio = Math.max(0, Math.min(2, len / s.L0)); // clamp tra 0 e 2
      const t = ratio / 2; // normalizza tra 0 e 1
      const color = BABYLON.Color3.Lerp(COLOR_COMPRESSED, COLOR_TENSED, t);

      s.mesh.material.diffuseColor = color;
      s.mesh.material.emissiveColor = color;
    }
  }
});
/* >>>>> types/links/cam_follower_CS/solve.js */
/* =====================================================================
   types/links/cam_follower_CS/solve.js
   Camma e follower (link "cam_follower_CS"): il follower e un'asta uniforme che ruota attorno a un estremo, sempre soggetta alla gravita,
   con la punta oppure con un lato piatto appoggiato al profilo di una camma; molla lineare facoltativa.
   Meta "COME SI RISOLVE" del link: validazione, dinamica, contatto, molla. Il disegno della molla e in create.js.
   ---------------------------------------------------------------------
   JSON:   { "type": "cam_follower_CS", "cam": "<gear cam_CS>", "follower": "<gear follower_CS>" }
   Facoltativi:
     "gravityDir"  direzione della gravita, [x,y,z] (default [0,0,-1])      "gravity"  intensita, mm/s2 (9810)
     "damping"     attrito viscoso sul fulcro, 1/s (0,05)
     "spring"      molla LINEARE fra due assi:  { "a": "<id asse>", "b": "<id asse>", "k": rigidezza, "length": lunghezza a riposo (mm),
                   "damping": smorzamento (0) }   Almeno uno dei due assi deve essere solidale sul follower (axes[].carrier = asse del
                   follower), a distanza x dal fulcro; l'altro puo essere fisso o solidale su un altro corpo (in quel caso conta la sua
                   posizione a inizio frame). La molla lavora SOLO A TRAZIONE: sotto la lunghezza a riposo e lasca e non spinge (nemmeno smorza).
                   Unita: la forza, a molla tesa, e k*(lunghezza meno lunghezza a riposo), con le stesse unita della massa
                   ("mass" del follower, 1): per fare un confronto, il peso dell'asta e mass*gravity (mm/s2).
     "cam" si puo omettere: il follower oscilla libero sotto gravita e molla.
   Contatto (parametro del follower, vedere follower_CS):
     "contact": "tip" = punta, "side1" = lato 1 (y = +hw), "side2" = lato 2 (y = -hw). Se omesso, "tip".
     Se contact e "tip", la punta locale e tipPoint = [L - tipShift, sideOffset], NON [L, 0] e NON [L, sideOffset].
     Il becco della foto e questo: sideOffset negativo, tipShift piccolo.
     Non esistono piu beakH / beakX / beakW / beakSide.
     Se contact non e "tip", la punta del follower diventa piatta invece che a punta, e il lato utile e lungo L, non L - tip.
     Per i lati, il contatto e il lato piatto da s = 0 a s = L, spostato di width/2 dalla mezzeria.
     Tangenza del lato, versione veloce: la distanza con segno da una retta e lineare lungo ogni spigolo, quindi il minimo sulla camma
     e sempre in un vertice. Basta una passata sui vertici con due prodotti scalari, senza campionare il segmento e senza segSeg.
   Molla, asse sul follower con un solo numero:
     nell'asse con carrier = asse del follower, metti "dist": <mm>. E la distanza del punto dal fulcro, lungo l'asta, a th = 0.
     Esempio: { "id": "asse_molla_follower_CS", "dir": [0,1,0], "carrier": "asse_follower_CS", "dist": 35, "place": {"at": [0,0,0]} }
     Se c'e "dist", "place" e ignorato e puo essere un segnaposto. Se non c'e "dist", vale "place.at" come prima.
   Come funziona: il punto di contatto non puo entrare nel profilo (contatto unilaterale, risolto a sotto-passi con impulsi sulla
   normale). Se la camma si abbassa piu in fretta di quanto il follower possa cadere (gravita + molla), il follower si stacca: non ci
   sono fermi. La camma e mossa da un motore (clic + slider) e non e frenata dal follower. Follower e ruote solidali sullo stesso asse
   sono un corpo solo; la velocita di quell'asse viene imposta al solutore, cosi gli ingranaggi collegati seguono.
   Gli assi di camma, follower e molla devono essere paralleli; il piano del meccanismo e quello normale agli assi.
   ===================================================================== */

const CamCS = (() => {
  const PI = Math.PI, DEG = PI / 180;
  const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

  /* Distanza con segno di un punto da un poligono antiorario (positiva fuori) e normale verso l'esterno. */
  function sdPoly(pt, poly) {
    let best = Infinity, bx = 0, by = 0, nx = 0, ny = 0, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
      let t = l2 ? ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const cx = a[0] + t * abx, cy = a[1] + t * aby, dd = Math.hypot(pt[0] - cx, pt[1] - cy);
      if (dd < best) { best = dd; bx = pt[0] - cx; by = pt[1] - cy; const l = Math.sqrt(l2) || 1; nx = aby / l; ny = -abx / l; }
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    const n = best > 1e-9 ? (inside ? [-bx / best, -by / best] : [bx / best, by / best]) : [nx, ny];
    return { d: inside ? -best : best, n };
  }

  function pointSeg(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
    let t = l2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * abx, a[1] + t * aby];
    return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), t };
  }

  /* Posizione (piano, relativa al fulcro) di un estremo della molla con il follower all'angolo th. */
  const endPos = (e, th) => e.kind === 'body' ? rot(e.rel, th) : e.pos;

  /* Coppia della molla sul fulcro. Molla SOLO A TRAZIONE: con len <= L0 e lasca e non da forza; con len > L0 la forza sull'estremo a e
     k*(len - L0)*d verso b piu lo smorzamento lungo la molla, ma non diventa mai una spinta (f >= 0). */
  function springTorque(G, th, w) {
    let tau = 0;
    for (const s of G.springs) {
      const pa = endPos(s.a, th), pb = endPos(s.b, th), dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
      if (len < 1e-9 || len <= s.L0) continue; // lasca: la molla non spinge
      const d = [dx / len, dy / len];
      const va = s.a.kind === 'body' ? [-w * pa[1], w * pa[0]] : [0, 0], vb = s.b.kind === 'body' ? [-w * pb[1], w * pb[0]] : [0, 0];
      const f = Math.max(0, s.k * (len - s.L0) + s.c * ((vb[0] - va[0]) * d[0] + (vb[1] - va[1]) * d[1])); // solo trazione
      const Fa = [f * d[0], f * d[1]];
      if (s.a.kind === 'body') tau += cross(pa, Fa);
      if (s.b.kind === 'body') tau += cross(pb, [-Fa[0], -Fa[1]]);
    }
    return tau;
  }

  /* Contatti di ogni braccio con la propria camma, all'angolo th del follower e angoli camma ths[i]. Punta oppure lato, secondo c.contact. */
  function contactsAt(G, th, ths, skin) {
    const out = [];
    G.contacts.forEach((c, i) => {
      const arm = G.arms[c.arm], ang = arm.phi + th;
      if (c.contact === 'side1' || c.contact === 'side2') {
        const dir = [Math.cos(ang), Math.sin(ang)], perp = [-dir[1], dir[0]];
        const nSide = [perp[0] * c.side, perp[1] * c.side];
        const off = [perp[0] * c.side * c.hw, perp[1] * c.side * c.hw];
        const A = off, B = [dir[0] * c.Lside + off[0], dir[1] * c.Lside + off[1]];
        const toCam = p => rot(rot([p[0] - c.Crel[0], p[1] - c.Crel[1]], -ths[i]), c.eps);
        const fromCamPoint = q => { const v = rot(rot(q, -c.eps), ths[i]); return [v[0] + c.Crel[0], v[1] + c.Crel[1]]; };
        const fromCamVec = q => rot(rot(q, -c.eps), ths[i]);
        const A_cam = toCam(A), B_cam = toCam(B);
        if (pointSeg([0, 0], A_cam, B_cam).d > c.rmax + skin + 1) return;
        const dir_cam = rot(rot(dir, -ths[i]), c.eps);
        const nSide_cam = rot(rot(nSide, -ths[i]), c.eps);
        let bestD = Infinity, bestS = 0;
        for (let k = 0; k < c.poly.length; k++) {
          const p = c.poly[k];
          const dx = p[0] - A_cam[0], dy = p[1] - A_cam[1];
          const s = dx * dir_cam[0] + dy * dir_cam[1];
          if (s < 0 || s > c.Lside) continue;
          const d = dx * nSide_cam[0] + dy * nSide_cam[1];
          if (d < bestD) { bestD = d; bestS = s; }
        }
        if (bestD <= skin) {
          let sMin = bestS, sMax = bestS;
          for (let k = 0; k < c.poly.length; k++) {
            const p = c.poly[k];
            const dx = p[0] - A_cam[0], dy = p[1] - A_cam[1];
            const s = dx * dir_cam[0] + dy * dir_cam[1];
            if (s < 0 || s > c.Lside) continue;
            const d = dx * nSide_cam[0] + dy * nSide_cam[1];
            if (d < bestD + 0.05) { if (s < sMin) sMin = s; if (s > sMax) sMax = s; }
          }
          const n = fromCamVec([-nSide_cam[0], -nSide_cam[1]]);
          const pushAt = s => {
            const pF_cam = [A_cam[0] + dir_cam[0] * s, A_cam[1] + dir_cam[1] * s];
            const pC_cam = [pF_cam[0] + nSide_cam[0] * bestD, pF_cam[1] + nSide_cam[1] * bestD];
            const pF = fromCamPoint(pF_cam), pC = fromCamPoint(pC_cam);
            const vcam = [-c.wC * (pC[1] - c.Crel[1]), c.wC * (pC[0] - c.Crel[0])];
            out.push({ i, d: bestD, tip: pF, pF, pC, n, J: cross(pF, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
          };
          if (sMax - sMin > 1) { pushAt(sMin); pushAt(sMax); } else { pushAt(bestS); }
          return;
        }
        for (const E_cam of [A_cam, B_cam]) {
          const r = sdPoly(E_cam, c.poly);
          if (r.d <= skin) {
            const n = fromCamVec(r.n);
            const pF = fromCamPoint(E_cam);
            const pC_cam = [E_cam[0] - r.n[0] * r.d, E_cam[1] - r.n[1] * r.d];
            const pC = fromCamPoint(pC_cam);
            const vcam = [-c.wC * (pC[1] - c.Crel[1]), c.wC * (pC[0] - c.Crel[0])];
            out.push({ i, d: r.d, tip: pF, pF, pC, n, J: cross(pF, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
          }
        }
      } else {
        // Punta: UNICA fonte di verita = tipPoint da solve.js (include tipShift e sideOffset)
        // Mai usare [L,0] qui, mai usare beakH/beakX: quelli erano il vecchio modello e sono stati cancellati.
        const tp = c.tipPoint || [arm.L, 0];
        const tip = [tp[0] * Math.cos(ang) - tp[1] * Math.sin(ang), tp[0] * Math.sin(ang) + tp[1] * Math.cos(ang)];
        const dx = tip[0] - c.Crel[0], dy = tip[1] - c.Crel[1];
        if (Math.hypot(dx, dy) > c.rmax + skin + 1) return;
        const q = rot(rot([dx, dy], -ths[i]), c.eps), r = sdPoly(q, c.poly);
        if (r.d > skin) return;
        const n = rot(rot(r.n, -c.eps), ths[i]), vcam = [-c.wC * (tip[1] - c.Crel[1]), c.wC * (tip[0] - c.Crel[0])];
        out.push({ i, d: r.d, tip, n, J: cross(tip, n), vcamN: n[0] * vcam[0] + n[1] * vcam[1], lam: 0 });
      }
    });
    return out;
  }

  function substep(G, st, h, ths) {
    let tau = 0;
    for (const a of G.arms) { const ux = Math.cos(a.phi + st.th), uy = Math.sin(a.phi + st.th); tau += a.m * (a.L / 2) * (ux * G.g[1] - uy * G.g[0]); }
    tau += springTorque(G, st.th, st.w) - G.damping * G.I * st.w;
    st.w += tau / G.I * h;
    const skin = 0.05 + 1.5 * (Math.abs(st.w) * G.Lmax + G.vcamMax) * h, cons = contactsAt(G, st.th, ths, skin);
    for (let it = 0; it < 4; it++) for (const c of cons) {
      const vn = c.J * st.w - c.vcamN;
      let dl = -(vn + c.d / h) / (c.J * c.J / G.I); const nl = Math.max(0, c.lam + dl); dl = nl - c.lam; c.lam = nl;
      st.w += c.J * dl / G.I;
    }
    st.th += st.w * h;
  }

  /* Avanza di dt secondi (gli angoli delle camme variano linearmente nel frame: velocita wC, angolo finale thC1). */
  function advance(G, st, dt) {
    const n = Math.min(4000, Math.max(1, Math.ceil(dt / 2e-4))), h = dt / n, ths = G.contacts.map(() => 0);
    G.vcamMax = Math.max(0, ...G.contacts.map(c => Math.abs(c.wC) * c.rmax));
    for (let i = 0; i < n; i++) {
      G.contacts.forEach((c, k) => { ths[k] = c.thC1 - c.wC * (dt - (i + 0.5) * h); });
      substep(G, st, h, ths); st.t += h;
    }
    const fin = contactsAt(G, st.th, G.contacts.map(c => c.thC1), 0.05);
    st.touch = fin.some(c => c.d < 0.02);
  }

  /* Se all'inizio un punto di contatto e dentro una camma, ruota nel verso che aumenta la distanza minima finche sta fuori. Vale per punta e lati. */
  function depenetrate(G, st) {
    const ths = G.contacts.map(c => c.thC1);
    const minD = () => { const cs = contactsAt(G, st.th, ths, 1e9); return cs.length ? Math.min(...cs.map(c => c.d)) : 1e9; };
    const inside = () => contactsAt(G, st.th, ths, 0.02).some(c => c.d < 0.02);
    if (!inside()) return;
    const step = 0.1 * DEG;
    for (let i = 0; i < 3600 && inside(); i++) {
      const d0 = minD();
      st.th += step; const dP = minD(); st.th -= step;
      st.th -= step; const dM = minD(); st.th += step;
      if (dP >= dM && dP > d0) st.th += step;
      else if (dM > d0) st.th -= step;
      else break;
    }
    st.w = 0;
  }

  const newState = () => ({ th: 0, w: 0, t: 0, touch: false, frameDone: true, lastTh: 0, fresh: true });
  return { advance, depenetrate, newState, sdPoly, rot, cross, contactsAt, springTorque, endPos, PI, DEG };
})();

/* Stato fisico che sopravvive alle ricostruzioni del modello (slider, varianti), per asse del follower. */
const CamStore_CS = new Map();

Registry.link('cam_follower_CS', {
  collection: 'camFollowersCS',
  order: { constraints: 5, afterIntegrate: 100 },

  validate(l, w, { E, axisBy, gearBy, isVec }) {
    const gf = gearBy[l.follower], gc = l.cam !== undefined ? gearBy[l.cam] : null;
    if (!gf) E(`${w}: follower "${l.follower}" non esiste o non e attivo`);
    else if ((gf.type || 'spur') !== 'follower_CS') E(`${w}: follower "${l.follower}" deve essere di tipo follower_CS`);
    if (l.cam !== undefined) {
      if (!gc) E(`${w}: cam "${l.cam}" non esiste o non e attivo`);
      else if ((gc.type || 'spur') !== 'cam_CS') E(`${w}: cam "${l.cam}" deve essere di tipo cam_CS`);
    }
    const par = (a, b, what) => { if (a && b && V.dot(V.unit(a.dir), V.unit(b.dir)) < 0.9999) E(`${w}: ${what} deve avere asse parallelo e con lo stesso verso dell'asse del follower`); };
    const axF = gf && axisBy[gf.axis];
    if (gc && axF) { const axC = axisBy[gc.axis]; if (axC === axF) E(`${w}: camma e follower devono stare su assi diversi`); par(axC, axF, `la camma "${l.cam}"`); }
    if (l.gravityDir !== undefined && !isVec(l.gravityDir, 3)) E(`${w}: "gravityDir" deve avere 3 elementi [x, y, z]`);
    for (const k of ['gravity', 'damping']) if (l[k] !== undefined && typeof l[k] !== 'number' && typeof l[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
    if (l.spring !== undefined) {
      const s = l.spring;
      if (typeof s !== 'object' || s === null) E(`${w}: "spring" deve essere un oggetto { a, b, k, length }`);
      else {
        for (const k of ['k', 'length']) if (s[k] === undefined) E(`${w}: spring.${k} e obbligatorio`);
        for (const k of ['k', 'length', 'damping']) if (s[k] !== undefined && typeof s[k] !== 'number' && typeof s[k] !== 'string') E(`${w}: spring.${k} deve essere un numero o un'espressione`);
        const A = axisBy[s.a], B = axisBy[s.b];
        if (!A) E(`${w}: spring.a "${s.a}" non esiste o non e attivo`);
        if (!B) E(`${w}: spring.b "${s.b}" non esiste o non e attivo`);
        if (A && B && gf) {
          par(A, axF, `l'asse della molla "${s.a}"`); par(B, axF, `l'asse della molla "${s.b}"`);
          const onF = ax => ax && (ax === axF || ax.carrier === gf.axis);
          if (!onF(A) && !onF(B)) E(`${w}: almeno uno dei due assi della molla deve essere solidale sul follower (axes[].carrier = "${gf.axis}"), a distanza dal fulcro`);
          if (onF(A) && onF(B)) E(`${w}: i due assi della molla sono entrambi sul follower: la molla non farebbe nulla`);
        }
      }
    }
  },

  resolve(M, { ev, vec }) {
    M.camGroupsCS = [];
    const byAxis = new Map();
    for (const l of activeLinks('cam_follower_CS')) {
      CTX.where = `link cam_follower_CS ${l.cam || '-'} / ${l.follower}`;
      const num = (v, d) => v !== undefined ? ev(v) : d;
      const gf = M.gearBy[l.follower], axF = gf.ax, gc = l.cam !== undefined ? M.gearBy[l.cam] : null, axC = gc ? gc.ax : null;
      let G = byAxis.get(axF);
      if (!G) {
        const k = V.unit(axF.dir), gW = V.unit(l.gravityDir !== undefined ? vec(l.gravityDir) : [0, 0, -1]), gp = V.sub(gW, V.mul(k, V.dot(gW, k)));
        if (V.len(gp) < 0.2) throw new Error(`cam/follower: la gravita e quasi parallela all'asse del follower: gli assi devono essere orizzontali (es. dir [0,1,0] se la gravita e verso Z-)`);
        const Y = V.unit(V.mul(gp, -1)), X = V.cross(Y, k), gmag = num(l.gravity, 9810) * V.len(gp);
        G = { axF, iF: axF.idx, k, X, Y, g: [0, -gmag], damping: num(l.damping, 0.05), arms: [], contacts: [], springs: [], links: [] };
        G.plane = v => [V.dot(v, X), V.dot(v, Y)];
        for (const g of M.gears) if (g.type === 'follower_CS' && g.ax === axF) {
          const f = g.followerCS, hw = f.hw !== undefined ? f.hw : f.width / 2, tipLen = f.tip !== undefined ? f.tip : Math.min(Math.max(f.width * 3, 6), f.L * 0.35);
          const Lside = f.Lside !== undefined ? f.Lside : (f.flatTip ? f.L : f.L - tipLen), contact = f.contact || 'tip', side = f.side !== undefined ? f.side : (contact === 'side1' ? 1 : contact === 'side2' ? -1 : 0);
          G.arms.push({ gear: g, L: f.L, m: f.mass, phi: 0, angle: f.angle, hw, tip: tipLen, Lside, contact, side, flatTip: !!f.flatTip, tipPoint: f.tipPoint, sideOffset: f.sideOffset || 0, tipShift: f.tipShift || 0 });
        }
        byAxis.set(axF, G); M.camGroupsCS.push(G);
      }
      const arm = G.arms.findIndex(a => a.gear === gf);
      if (gc) {
        const Crel = G.plane(V.sub(axC.O, axF.O)), eps = Math.atan2(V.dot(G.X, axC.yv), V.dot(G.X, axC.ref));
        const phiPc = Math.atan2(Crel[1], Crel[0]);
        G.arms[arm].phi = phiPc + G.arms[arm].angle * PI / 180; G.arms[arm].hasCam = true;
        const a0 = G.arms[arm];
        G.contacts.push({ arm, Crel, eps, poly: gc.camCS.poly, rmax: gc.camCS.rmax, axC, iC: axC.idx, thC1: axC.theta, wC: 0, contact: a0.contact, side: a0.side, hw: a0.hw, Lside: a0.Lside, flatTip: a0.flatTip, tipPoint: a0.tipPoint });
      }
      if (l.spring) {
        const s = l.spring, endOf = id => {
          const ax = M.axisBy[id];
          let dist = null;
          if (ax) {
            if (typeof ax.dist === 'number') dist = ax.dist;
            else if (ax.def && typeof ax.def.dist === 'number') dist = ax.def.dist;
            else if (typeof ax.place === 'number') dist = ax.place;
            else if (ax.place && typeof ax.place.dist === 'number') dist = ax.place.dist;
            else if (ax.def && typeof ax.def.place === 'number') dist = ax.def.place;
            else if (typeof ax.dist === 'string' && !Number.isNaN(Number(ax.dist))) dist = Number(ax.dist);
            else if (ax.def && typeof ax.def.dist === 'string' && !Number.isNaN(Number(ax.def.dist))) dist = Number(ax.def.dist);
          }
          if (dist !== null && (ax === axF || ax.carrier === axF || ax.carrier === gf.axis)) {
            let phiArm = G.arms[arm] ? G.arms[arm].phi : 0;
            if (G.arms[arm] && !G.arms[arm].hasCam) phiArm = G.arms[arm].angle * PI / 180;
            const rel = [dist * Math.cos(phiArm), dist * Math.sin(phiArm)];
            let axial = 0;
            try { axial = V.dot(V.sub(ax.O, axF.O), G.k); } catch (e) { axial = 0; }
            const world = V.add(axF.O, V.add(V.add(V.mul(G.X, rel[0]), V.mul(G.Y, rel[1])), V.mul(G.k, axial)));
            ax.O = world;
            return { ax, axial, kind: 'body', rel };
          }
          const axial = V.dot(V.sub(ax.O, axF.O), G.k), p = G.plane(V.sub(ax.O, axF.O));
          if (ax === axF) return { ax, axial, kind: 'body', rel: [0, 0] };
          if (ax.carrier === axF) return { ax, axial, kind: 'body', rel: p };
          return { ax, axial, kind: 'fixed', pos: p };
        };
        G.springs.push({ a: endOf(s.a), b: endOf(s.b), k: ev(s.k), L0: ev(s.length), c: num(s.damping, 0), link: l });
      }
      G.links.push({ def: l, gf, gc });
    }
    for (const G of M.camGroupsCS) {
      for (const a of G.arms) if (!a.hasCam) a.phi = a.angle * PI / 180;
      G.I = G.arms.reduce((s, a) => s + a.m * a.L * a.L / 3, 0); G.Lmax = Math.max(...G.arms.map(a => a.L)); G.vcamMax = 0;
      for (const a of G.arms) { const eps = Math.atan2(V.dot(G.X, G.axF.yv), V.dot(G.X, G.axF.ref)); a.gear.rodLocalCS = a.phi + eps; }
      const key = G.axF.id, prev = CamStore_CS.get(key), sig = [G.arms.length, +G.I.toFixed(3), G.contacts.length, G.contacts.map(c => `${c.contact}:${c.side}:${c.hw.toFixed(2)}:${c.Lside.toFixed(1)}:${c.flatTip ? 1 : 0}:${c.tipPoint ? c.tipPoint[0].toFixed(1) + ',' + c.tipPoint[1].toFixed(1) : 'none'}`).join(',')].join('|');
      if (prev && prev.sig === sig) G.st = prev.st; else { G.st = CamCS.newState(); CamStore_CS.set(key, { sig, st: G.st }); }
      G.needSync = true;
      M.camFollowersCS.push(...G.links.map(x => ({ def: x.def, G })));
      step('cam/follower', `asse ${key}: ${G.arms.length} braccio/i (L=${G.arms.map(a => +a.L.toFixed(1)).join(', ')} mm), ${G.contacts.length} camma/e, ${G.springs.length} molla/e, inerzia ${G.I.toFixed(1)}`);
    }
  },

  /* A ricostruzione finita: allinea lo stato fisico agli angoli degli assi (che la ricostruzione conserva) e, se serve, solleva il punto di contatto. */
  settle(M) {
    for (const G of (M.camGroupsCS || [])) if (G.needSync) {
      const st = G.st, same = !st.fresh && Math.abs(G.axF.theta - st.th) < 1e-6;
      G.contacts.forEach(c => { c.thC1 = c.axC.theta; c.wC = 0; });
      if (st.fresh) { st.th = 0; st.w = 0; G.axF.theta = 0; CamCS.depenetrate(G, st); G.axF.theta = st.th; st.fresh = false; }
      else if (!same) { st.th = G.axF.theta; st.w = 0; CamCS.depenetrate(G, st); G.axF.theta = st.th; }
      st.lastTh = st.th; st.frameDone = true; G.needSync = false;
    }
  },

  /* All'inizio del frame: velocita delle camme (le da il solutore: clic + slider) e controllo di modifiche esterne all'angolo. */
  events(M, s, w) {
    for (const G of (M.camGroupsCS || [])) {
      for (const c of G.contacts) c.wC = w[c.iC];
      const st = G.st;
      if (st.frameDone) { st.frameDone = false; if (Math.abs(G.axF.theta - st.lastTh) > 1e-9) { st.th = G.axF.theta; st.w = 0; } }
    }
    return [];
  },

  /* Una volta per frame, dopo l'integrazione degli assi: la dinamica del follower sostituisce l'angolo dell'asse. */
  afterIntegrate(M) {
    const dt = typeof M.dt === 'number' ? M.dt : Math.min(engine.getDeltaTime() / 1000, 0.05) * state.timeScale;
    for (const G of (M.camGroupsCS || [])) {
      const st = G.st;
      for (const c of G.contacts) c.thC1 = c.axC.theta;
      if (dt > 0) {
        const cache = new Map();
        for (const s of G.springs) for (const e of [s.a, s.b]) if (e.kind === 'moving') e.pos = G.plane(V.sub(axisFrame(e.ax, cache).O, G.axF.O));
        CamCS.advance(G, st, dt);
      }
      G.axF.theta = st.th; st.lastTh = st.th; st.frameDone = true;
    }
  },

  /* La velocita dell'asse del follower e il risultato della dinamica: si impone al solutore (priorita alta), cosi le ruote solidali
     e tutto cio che e ingranato con loro seguono il follower. */
  constraints(M, push, { unit }) {
    for (const G of (M.camGroupsCS || [])) push('cam_follower', `follower su ${G.axF.id}`, unit(G.iF), G.st.w, { axisIdx: G.iF });
  },

  linkedAxes: M => (M.camGroupsCS || []).flatMap(G => [G.axF, ...G.contacts.map(c => c.axC), ...G.springs.flatMap(s => [s.a.ax, s.b.ax])]),

  status(M) {
    const lines = [];
    for (const G of (M.camGroupsCS || [])) {
      const st = G.st, deg = (st.th * 180 / PI).toFixed(1).replace('.', ',');
      if (G.contacts.length) {
        const c0 = G.contacts[0], label = c0.contact === 'side1' ? 'lato 1' : c0.contact === 'side2' ? 'lato 2' : 'punta';
        lines.push(`Follower ${G.axF.id}: angolo ${deg}°, ${st.touch ? `appoggiato alla camma (${label})` : 'staccato dalla camma'}`);
      }
    }
    return lines;
  }
});
/* >>>>> types/links/geneva/create.js */
/* =====================================================================
   types/links/geneva/create.js
   Dopo la modifica la ruota pilota è composta da due ruote solidali:
   - disco piccolo di blocco (settore) sullo stesso piano della croce
   - disco grande che porta il pin, sfalsato lungo l'asse
   La geometria è creata dal gear di tipo "geneva_driver" (o "spur" se usato in geneva).
   Il link stesso non crea oggetti propri.
   ===================================================================== */
// Il link non crea oggetti propri: la croce è gear "maltese", la manovella è gear "geneva_driver"
/* >>>>> types/links/geneva/solve.js */
/* =====================================================================
   types/links/geneva/solve.js
   Croce di Malta (link "geneva"): moto intermittente fra manovella con perno e croce
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
/* ---- geneva: stato geometrico corrente ---------------------------------------------------------------------------
   Tutto nel piano perpendicolare agli assi, con i riferimenti correnti (carrier compresi). Ritorna:
     engaged  perno entro R dal centro della croce (dentro una scanalatura)
     phi      angolo (attorno all'asse della croce, da ref a theta=0) della direzione centro croce → perno
     psi      idem per la direzione centro croce → centro manovella
     ratio    dφ/dθ_manovella: rapporto istantaneo tra le velocità relative di croce e manovella (con segno)                 */
function genevaState(gv) {
  const cache = new Map(), f1 = axisFrame(gv.g1.ax, cache), f2 = axisFrame(gv.g2.ax, cache);
  const k1 = V.unit(f1.dir), k2 = V.unit(f2.dir), C1 = f1.O, C2 = f2.O;
  const P = gv.pinAxis ? axisFrame(gv.pinAxis, cache).O : V.add(C1, V.mul(MAT.mulV(f1.R, gv.pinLocal || gv.g1.ax.ref), gv.rPin));
  const flat = v => V.sub(v, V.mul(k2, V.dot(v, k2)));
  const v = flat(V.sub(P, C2)), u = flat(V.sub(C1, C2)), dist = V.len(v);
  const ref0 = gv.g2.ax.carrier ? MAT.mulV(axisFrame(gv.g2.ax.carrier, cache).R, gv.g2.ax.ref) : gv.g2.ax.ref;   // riferimento dell'asse senza il suo theta
  const yv0 = V.cross(k2, ref0);
  const ang = x => Math.atan2(V.dot(yv0, x), V.dot(ref0, x));
  const vel = flat(V.cross(k1, V.sub(P, C1)));                                  // dP/dθ1
  const ratio = dist > 1e-9 ? V.dot(k2, V.cross(v, vel)) / (dist * dist) : 0;
  return { engaged: dist < gv.R * (1 - 1e-12), dist, phi: ang(v), psi: ang(u), ratio };
}

/* Posizione della croce: durante l'ingaggio segue il perno (la scanalatura scelta è quella più vicina all'angolo attuale),
   fuori riposa nella posizione di blocco più vicina (un braccio verso la manovella). Si chiama dopo l'integrazione degli angoli. */
function updateGenevas(M) {
  for (const gv of M.genevas || []) {
    const st = genevaState(gv), ax = gv.g2.ax, pitch = 2 * PI / gv.N;
    const target = st.engaged ? st.phi - gv.slotAngle : st.psi + PI / gv.N - gv.slotAngle;
    ax.theta = target + pitch * Math.round((ax.theta - target) / pitch);
  }
}

const gWrap = x => Math.atan2(Math.sin(x), Math.cos(x));

/* Distanza angolare (lungo il verso della manovella) al prossimo ingresso/uscita del perno dal settore d'ingaggio */
function genevaEdgeDist(gv, alpha, dir) {
  if (!Number.isFinite(gv.thetaLine) || !Number.isFinite(gv.beta)) return Infinity;
  const u = gWrap(alpha - gv.thetaLine), b = gv.beta, eps = 1e-10;
  if (Math.abs(Math.abs(u) - b) <= eps) {
    const entrySide = (u * dir) < 0;
    if (entrySide && gv.engaged) return 2 * b;
    if (!entrySide && !gv.engaged) return 2 * PI - 2 * b;
    return 0;
  }
  let best = Infinity;
  for (const e of [gv.thetaLine - b, gv.thetaLine + b]) {
    let q = dir * gWrap(e - alpha);
    if (q <= 0) q += 2 * PI;
    best = Math.min(best, q);
  }
  return best;
}

/* Dimensioni del Geneva (stesse formule di malteseOutline in types/gears/maltese/create.js):
   R = raggio delle punte della croce, h = semilarghezza della scanalatura (limitata come nella croce),
   rho = raggio degli archi concavi della croce = raggio del disco di blocco del driver. */
function genevaDims(N, a, r, hRaw) {
  const R = Math.sqrt(Math.max(0, a * a - r * r));
  const h = Math.min(hRaw, 0.9 * R * Math.sin(PI / N), 0.45 * (a - r));
  const x1 = Math.sqrt(R * R - h * h), dTip = Math.atan2(h, x1), dMax = PI / N - dTip;
  return { R, h, rho: Math.sqrt(R * R + a * a - 2 * R * a * Math.cos(dMax)) };
}

// ---- 7c. link geneva (meccanismo Croce di Malta)
/* { "type":"geneva", "driver":<ruota con il perno>, "driven":<croce>, "slots":N,
     "pinAxis":<asse del perno> | "pinRadius":mm | (niente: lo calcola il codice), "pinAngle":gradi, "slotAxis":<asse> }
   Senza pinAxis né pinRadius il raggio del perno è r = interasse·sin(π/N): lo fissa il codice, non l'utente. "pinAngle" (gradi, default 0) è
   la posizione del perno nel riferimento del driver. Se il driver è di tipo "geneva_driver" (types/gears/geneva_driver) il link gli passa
   interasse, raggio del perno, raggio di blocco ρ, larghezza della scanalatura e posizione assiale della croce: il driver si disegna da solo
   (ruota porta-perno, perno e disco di blocco).
   Geneva corretto: raggio del perno r = a·sin(π/N) (a = interasse). Il perno entra nella scanalatura quando la sua distanza dal centro della
   croce scende sotto R = √(a²−r²); lì la velocità della croce è zero, quindi l'ingaggio è continuo. Fuori da quel settore la croce è bloccata.
   Le fasi (quale scanalatura, dove la croce riposa) si ricavano dalla geometria ogni frame (updateGenevas), non dal valore iniziale di theta. */
Registry.link('geneva', {
  collection: 'genevas',
  order: { resolve: 20, constraints: 50, afterIntegrate: 10 },

  validate(l, w, { E, W, axisBy, gearBy }) {
    const dGear = gearBy[l.driver], sGear = gearBy[l.driven];
    if (!dGear) E(`${w}: driver "${l.driver}" non esiste o non è attivo`);
    else if (!sGear) E(`${w}: driven "${l.driven}" non esiste o non è attivo`);
    else if (dGear === sGear) E(`${w}: driver e driven devono essere diversi`);
    if (l.pinAxis && !axisBy[l.pinAxis]) E(`${w}: pinAxis "${l.pinAxis}" non esiste o non è attivo`);
    if (l.slots === undefined) W(`${w}: manca "slots", uso 4 (default)`);
    if (l.pinAngle !== undefined && typeof l.pinAngle !== 'number' && typeof l.pinAngle !== 'string') E(`${w}: "pinAngle" deve essere un numero (gradi)`);
    if (l.pinAxis && dGear && dGear.type === 'geneva_driver') W(`${w}: il driver "${l.driver}" è di tipo geneva_driver e disegna già il perno: togli "pinAxis" (il perno lo calcola il codice)`);
  },

  resolve(M, { ev }) {
  for (const l of activeLinks('geneva')) {
    CTX.where = `link geneva ${l.driver} → ${l.driven}`;
    const g1 = M.gearBy[l.driver], g2 = M.gearBy[l.driven];
    if (!g1) throw new Error(`geneva: driver "${l.driver}" non esiste`);
    if (!g2) throw new Error(`geneva: driven "${l.driven}" non esiste`);
    const k1 = V.unit(g1.ax.dir), k2 = V.unit(g2.ax.dir);
    if (V.len(V.cross(k1, k2)) > 1e-6) throw new Error(`geneva: gli assi di ${g1.ax.id} e ${g2.ax.id} devono essere paralleli`);

    const pinAxis = l.pinAxis ? M.axisBy[l.pinAxis] : null;
    if (l.pinAxis && !pinAxis) throw new Error(`geneva: pinAxis "${l.pinAxis}" non esiste`);
    const N = l.slots || g2.def.slots || 4;
    const d = V.len(V.perp(V.sub(g2.ax.O, g1.ax.O), k1));
    // raggio del perno: dall'asse del perno, oppure "pinRadius", oppure calcolato: interasse·sin(π/N) (Geneva corretto)
    const rPin = pinAxis ? V.len(V.perp(V.sub(pinAxis.O, g1.ax.O), k1)) : (l.pinRadius !== undefined ? ev(l.pinRadius) : d * Math.sin(PI / N));
    if (!(rPin > 1e-6)) throw new Error(`geneva: raggio del perno nullo (pinAxis coincide con l'asse di ${l.driver}?)`);
    if (!(rPin < d)) throw new Error(`geneva: il perno (${rPin.toFixed(2)} mm) deve stare più vicino all'asse della manovella dell'interasse (${d.toFixed(2)} mm)`);

    const rExp = d * Math.sin(PI / N);
    if (Math.abs(rPin - rExp) > 2e-3 * d) {
      warn('geneva', `${g1.id} → ${g2.id}: geometria non coerente con ${N} scanalature. Serve raggio perno = interasse·sin(π/${N}): ` +
        `con interasse ${d.toFixed(3)} mm il perno dovrebbe stare a ${rExp.toFixed(3)} mm (ora ${rPin.toFixed(3)}), ` +
        `oppure con perno a ${rPin.toFixed(3)} mm l'interasse dovrebbe essere ${(rPin / Math.sin(PI / N)).toFixed(3)} mm. ` +
        `Così la croce scatta all'ingresso del perno e il perno non entra nelle scanalature.`);
    }
    const R = Math.sqrt(d * d - rPin * rPin);
    let slotAngle = 0;
    if (l.slotAxis && M.axisBy[l.slotAxis]) {
      const sa = M.axisBy[l.slotAxis];
      slotAngle = Math.atan2(V.dot(sa.dir, g2.ax.yv), V.dot(sa.dir, g2.ax.ref));
    }
    // --- FIX terza correzione: iniziali per sub-stepping ---
    const relPerp = V.perp(V.sub(g2.ax.O, g1.ax.O), g1.ax.dir);
    const dx = V.dot(relPerp, g1.ax.ref);
    const dy = V.dot(relPerp, g1.ax.yv);
    let initialPinAngle = 0;
    if (pinAxis) {
      const pinRel = V.perp(V.sub(pinAxis.O, g1.ax.O), g1.ax.dir);
      initialPinAngle = Math.atan2(V.dot(pinRel, g1.ax.yv), V.dot(pinRel, g1.ax.ref));
    }
    // senza pinAxis il perno sta a "pinAngle" gradi dal riferimento del driver (default 0)
    const pinAngle = pinAxis ? 0 : (l.pinAngle !== undefined ? ev(l.pinAngle) : 0) * PI / 180;
    if (!pinAxis) initialPinAngle = pinAngle;
    const pinLocal = pinAxis ? null : V.add(V.mul(g1.ax.ref, Math.cos(pinAngle)), V.mul(g1.ax.yv, Math.sin(pinAngle)));
    const thetaLine = Math.atan2(dy, dx);
    const beta = Math.acos(Math.min(1, rPin / d));

    g2.geneva = { a: +d.toFixed(6), r: +rPin.toFixed(6), N, s0: +slotAngle.toFixed(6) };
    g2.r = R;
    // dati per il driver: dimensioni del Geneva e posizione assiale della croce nel riferimento del driver
    const hRaw = (g2.def.slotWidth !== undefined ? ev(g2.def.slotWidth) : 0.12 * R) / 2, dims = genevaDims(N, d, rPin, hRaw);
    const off = V.dot(V.sub(g2.ax.O, g1.ax.O), k1), sgn = V.dot(k2, k1);
    const zCross = g2.w ? [off + g2.w[0] * sgn, off + g2.w[1] * sgn].sort((p, q) => p - q) : null;
    g1.geneva = { driver: true, a: +d.toFixed(6), r: +rPin.toFixed(6), N, R, hRaw, h: dims.h, rho: dims.rho, pinAngle, zCross };
    const gi = Registry.get('gear', g1.type);
    if (gi && gi.genevaDriver) gi.genevaDriver(g1, g1.geneva, { ev });             // il tipo del driver fissa raggio e spessore
    M.genevas.push({ def: l, g1, g2, pinAxis, pinLocal, rPin, d, R, N, slotAngle, initialPinAngle, thetaLine, beta, engaged: false });
    const rho = typeof malteseOutline === 'function' ? malteseOutline(N, d, rPin, 1e-3).rho : NaN;   // malteseOutline: types/gears/maltese/create.js
    step('geneva', `${g1.id} → ${g2.id}: perno a ${rPin.toFixed(3)} mm, interasse ${d.toFixed(3)} mm, ${N} scanalature, ingaggio entro ${R.toFixed(3)} mm dal centro della croce (±${((PI / 2 - PI / N) * 180 / PI).toFixed(1)}° di manovella)${Number.isFinite(rho) ? `; disco di blocco ρ ≈ ${rho.toFixed(2)} mm` : ''}`);
  }
  },

  /* Ingaggiato: s_croce = (dφ/dθ)·s_manovella. Fuori dal settore la croce è bloccata (velocità relativa al suo carrier nulla).
     Sta prima di ruota pilotata, input, hold e rest: è un accoppiamento meccanico, deve battere un "input" a 0 giri/min sulla manovella. */
  constraints(M, push, { unit }) {
    for (const gv of M.genevas) {
      const st = genevaState(gv);
      const rel = a => { const r = unit(a.idx); if (a.carrier) for (const k in a.carrier.Om) r[k] -= V.dot(a.carrier.Om[k], a.dir); return r; };
      const r1 = rel(gv.g1.ax), r2 = rel(gv.g2.ax);
      if (st.engaged) push('geneva', `geneva ${gv.g1.id} → ${gv.g2.id} (perno nella scanalatura, rapporto ${st.ratio.toFixed(4)})`, r2.map((x, i) => x - st.ratio * r1[i]), 0);
      else push('geneva', `geneva ${gv.g2.id} bloccata (perno fuori dalle scanalature)`, r2, 0, { axisIdx: gv.g2.ax.idx });
    }
  },

  /* Sotto-passi di integrazione: l'ingresso/uscita del perno dal settore è un evento che spezza il passo */
  events(M, s) {
    const out = [];
    for (const gv of M.genevas) {
      const rate = s[gv.g1.ax.idx];
      if (Math.abs(rate) < 1e-12) continue;
      if (!Number.isFinite(gv.initialPinAngle)) continue;
      const alpha = gv.g1.ax.theta + gv.initialPinAngle;
      const dist = genevaEdgeDist(gv, alpha, Math.sign(rate));
      out.push({ te: dist / Math.abs(rate), hit: () => { gv.engaged = !gv.engaged; } });
    }
    return out;
  },

  // riallineamento esatto della croce alla geometria (dopo l'integrazione e dopo ogni ricostruzione)
  afterIntegrate: M => updateGenevas(M),
  settle: M => updateGenevas(M)
});

/* >>>>> types/links/graham_escapement_CS/create.js */
/* =====================================================================
   types/links/graham_escapement_CS/create.js
   Scappamento di Graham (link "graham_escapement_CS")
   Metà "COME SI CREA" del link: oggetti grafici. Il link non crea oggetti propri: ruota e ancora (con pallette, asta e lente)
   le disegnano i gear escape_wheel_CS e anchor_CS, sulla base dei dati che il link calcola in solve.js.
   ===================================================================== */

/* >>>>> types/links/graham_escapement_CS/solve.js */
/* =====================================================================
   types/links/graham_escapement_CS/solve.js
   Scappamento di Graham (dead-beat) fra una ruota di scappamento e un'ancora con pendolo (link "graham_escapement_CS")
   Metà "COME SI RISOLVE" del link: validazione, geometria, fisica dei contatti. Il disegno sta nei gear (escape_wheel_CS, anchor_CS).
   ---------------------------------------------------------------------
   JSON:   { "type": "graham_escapement_CS", "wheel": "<gear escape_wheel_CS>", "anchor": "<gear anchor_CS>" }
   Facoltativi (numeri o espressioni):
     "gravityDir"      direzione della gravità, [x,y,z] (default [0,0,-1]: verso Z−). Il pendolo pende lungo la gravità: l'ancora deve
                       stare SOPRA la ruota (lungo Z) e gli assi di ruota e ancora devono essere orizzontali (es. dir [0,1,0])
     "span"            denti abbracciati dall'ancora (n+½, default 7,5): fissa l'interasse ideale = R / cos(π·span/N)
     "lock"            corsa di blocco prima del rilascio, gradi (0,5)
     "lift"            angolo di impulso dell'ancora, gradi (2,5)
     "impulseFraction" quota di mezzo passo che la ruota avanza durante l'impulso (0,5)
     "arcExtra"        estensione delle facce di riposo oltre l'ampiezza, gradi (8)
     "palletDepth"     spessore delle pallette, mm (0,07·R)
     "damping"         smorzamento del pendolo, 1/s (0,05)
     "motorStiffness"  rigidezza del motore (0,04): coppia = rigidezza · (velocità comandata − velocità della ruota)
     "motorTorqueMax"  coppia massima del motore (0,08): satura l'ampiezza quando lo si accelera troppo
     "wheelInertia"    inerzia della ruota rispetto a quella del pendolo (1e-4)
     "gravity"         intensità, mm/s² (9810)
   Come funziona (niente è "finto"): la ruota è un corpo rigido con la coppia di un motore che vuole farla girare alla velocità
   comandata (clic sulla ruota + slider della velocità). Le punte dei denti non possono entrare nelle pallette; si risolve il
   contatto a ogni passo (impulsi sulla normale delle facce). Riposo, impulso e caduta vengono da soli dalla forma di denti e
   pallette; l'ampiezza del pendolo è un risultato dell'energia ricevuta e dell'attrito; la velocità media della ruota la decide
   il pendolo. Il pendolo parte da solo con una piccola spinta iniziale data dal codice (mai dall'utente).
   Il verso giusto del motore è quello positivo (rotazione positiva attorno all'asse).
   ===================================================================== */

/* Tutto in un unico oggetto per non sporcare lo spazio globale. */
const GrahamCS = (() => {
  const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
  const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

  /* Piano del meccanismo: origine nel centro W della ruota, asse Y verso il perno A dell'ancora, asse X = k × (A→W) (destra);
     la ruota gira in senso antiorario (positivo). Sistema dell'ancora: x' = da A verso W, y' = a destra, angoli antiorari. */
  function geometry(o) {
    const R = o.R, N = o.N, D = o.D, p = TAU / N;
    const gamma = Math.acos(R / D), rho = R * Math.tan(gamma), eps = PI / 2 - gamma;
    const mu = o.lock * DEG, lam = o.lift * DEG, dphi = o.impulseFraction * p / 2, arcExtra = o.arcExtra * DEG, depth = o.palletDepth;
    const TR = [R * Math.sin(gamma), R * Math.cos(gamma)], TL = [-TR[0], TR[1]];                 // punti di riposo: ingresso a destra, uscita a sinistra
    const toAnchor = (q, th) => rot([-(q[1] - D), q[0]], -th);                                    // piano → sistema ancora (ancora ruotata di th)
    const aR = eps, aL = -eps;
    const eE = toAnchor(rot(TR, dphi), mu + lam), eX = toAnchor(rot(TL, dphi), -(mu + lam));      // fine delle facce di impulso
    const arc = (r, a0, a1) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / DEG)), out = []; for (let i = 0; i <= n; i++) out.push(polar(r, a0 + (a1 - a0) * i / n)); return out; };
    const e0 = aR + arcExtra, e1 = aR - mu, x0 = aL - arcExtra, x1 = aL + mu;
    // paletta d'ingresso: materiale DENTRO l'arco di riposo (il dente arriva da fuori); paletta d'uscita: materiale FUORI (il dente arriva da dentro)
    const entry = [...arc(rho, e0, e1), eE, polar(rho - depth, e1), ...arc(rho - depth, e1, e0)];
    const exit = [...arc(rho, x0, x1), eX, polar(rho + depth, x1), ...arc(rho + depth, x1, x0)];
    const area = P => { let s = 0; for (let i = 0; i < P.length; i++) s += cross(P[i], P[(i + 1) % P.length]); return s / 2; };
    const ccw = P => area(P) > 0 ? P : P.slice().reverse();
    return { R, N, D, p, gamma, rho, eps, mu, lam, dphi, arcExtra, depth, aR, aL, entry: ccw(entry), exit: ccw(exit), toAnchor, phi0: PI / 2 - gamma };
  }

  /* Distanza con segno di un punto da un poligono antiorario (positiva fuori) e normale verso l'esterno. */
  function sdPoly(pt, poly) {
    let best = Infinity, bx = 0, by = 0, nx = 0, ny = 0, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
      let t = l2 ? ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const cx = a[0] + t * abx, cy = a[1] + t * aby, dd = Math.hypot(pt[0] - cx, pt[1] - cy);
      if (dd < best) { best = dd; bx = pt[0] - cx; by = pt[1] - cy; const l = Math.sqrt(l2) || 1; nx = aby / l; ny = -abx / l; }
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    const n = best > 1e-9 ? (inside ? [-bx / best, -by / best] : [bx / best, by / best]) : [nx, ny];
    return { d: inside ? -best : best, n };
  }

  /* Un passo di dinamica di durata h: motore sulla ruota, gravità e attrito sul pendolo, contatti punta-dente / paletta. */
  function substep(P, st, h, cmd) {
    const G = P.G, w0sq = P.g / P.L;
    const tq = Math.max(-P.tauMax, Math.min(P.tauMax, P.kappa * (cmd - st.wW)));
    st.wW += tq / P.Iw * h;
    st.wA += (-w0sq * Math.sin(st.thA - P.thEq) - P.damping * st.wA) * h;                        // thEq: angolo d'equilibrio (pendolo lungo la gravità)
    const cons = [];
    for (let k = 0; k < G.N; k++) {
      const ang = G.phi0 + k * G.p + st.thW, tip = [G.R * Math.cos(ang), G.R * Math.sin(ang)];
      if (Math.hypot(tip[0], tip[1] - G.D) > G.rho + G.depth + 4) continue;
      const qa = G.toAnchor(tip, st.thA);
      for (let pi = 0; pi < 2; pi++) {
        const r = sdPoly(qa, pi ? G.exit : G.entry); if (r.d > 0.05) continue;
        const nP = rot([r.n[1], -r.n[0]], st.thA), ra = [tip[0], tip[1] - G.D];
        cons.push({ pal: pi, d: r.d, Jw: cross(tip, nP), Ja: -cross(ra, nP), lam: 0 });
      }
    }
    for (let it = 0; it < 6; it++) for (const c of cons) {
      const kk = c.Jw * c.Jw / P.Iw + c.Ja * c.Ja, vn = c.Jw * st.wW + c.Ja * st.wA;
      let dl = -(vn + c.d / h) / kk; const nl = Math.max(0, c.lam + dl); dl = nl - c.lam; c.lam = nl;
      st.wW += c.Jw * dl / P.Iw; st.wA += c.Ja * dl;
    }
    let hold = 0, holdPal = -1; for (const c of cons) if (c.lam > hold) { hold = c.lam; holdPal = c.pal; }
    st.holding = hold > 0 ? holdPal : -1;
    st.thW += st.wW * h; st.thA += st.wA * h;
  }

  /* Avanza di dt secondi; gestisce anche la spinta iniziale e le statistiche (ampiezza, periodo). */
  function advance(P, st, dt, cmdRaw) {
    const cmd = Math.max(0, cmdRaw), n = Math.min(4000, Math.max(1, Math.ceil(dt / 2e-4))), h = dt / n;
    for (let i = 0; i < n; i++) {
      substep(P, st, h, cmd);
      st.t += h;
      // statistiche: passaggi per zero di theta_a (da negativo a positivo) → periodo; picchi → ampiezza
      st.peak = Math.max(st.peak, Math.abs(st.thA));
      if (st.prevSign <= 0 && st.thA > 0) { if (st.lastZero !== null) st.period = st.t - st.lastZero; st.lastZero = st.t; st.amp = st.peak; st.peak = 0; }
      if (st.thA !== 0) st.prevSign = Math.sign(st.thA);
      // spinta iniziale: ruota ferma contro una paletta, pendolo fermo vicino al centro, motore acceso
      const stalled = cmd > 0.05 && Math.abs(st.wA) < 0.03 && Math.abs(st.thA) < P.stallAngle;
      st.idle = stalled ? st.idle + h : 0;
      if (st.idle > 0.4 && st.t - st.lastKick > 3 && st.holding >= 0) {
        st.wA += (st.holding === 0 ? 1 : -1) * P.kick; st.lastKick = st.t; st.idle = 0; st.kicks++;
      }
    }
  }

  const newState = () => ({ thW: 0, wW: 0, thA: 0, wA: 0, t: 0, holding: -1, idle: 0, lastKick: -10, kicks: 0, peak: 0, amp: 0, period: 0, lastZero: null, prevSign: 0, frameDone: true, lastW: 0, lastA: 0, cmd: 0 });
  const resetStats = st => { st.amp = 0; st.period = 0; st.peak = 0; st.lastZero = null; st.prevSign = 0; st.idle = 0; st.lastKick = -10; st.holding = -1; };
  return { geometry, sdPoly, advance, newState, resetStats, PI, DEG };
})();

/* Stato fisico che sopravvive alle ricostruzioni del modello (slider, varianti), per chiave ruota|ancora. */
const GrahamStore_CS = new Map();

Registry.link('graham_escapement_CS', {
  collection: 'grahams',
  order: { afterIntegrate: 100 },

  validate(l, w, { E, W, axisBy, gearBy, isVec }) {
    const gw = gearBy[l.wheel], ga = gearBy[l.anchor];
    if (!gw) E(`${w}: wheel "${l.wheel}" non esiste o non è attivo`);
    else if ((gw.type || 'spur') !== 'escape_wheel_CS') E(`${w}: wheel "${l.wheel}" deve essere di tipo escape_wheel_CS`);
    if (!ga) E(`${w}: anchor "${l.anchor}" non esiste o non è attivo`);
    else if ((ga.type || 'spur') !== 'anchor_CS') E(`${w}: anchor "${l.anchor}" deve essere di tipo anchor_CS`);
    if (gw && ga) {
      const a1 = axisBy[gw.axis], a2 = axisBy[ga.axis];
      if (a1 && a2 && (a1 === a2 || V.dot(V.unit(a1.dir), V.unit(a2.dir)) < 0.9999)) E(`${w}: gli assi di ruota e ancora devono essere paralleli, distinti e con lo stesso verso`);
    }
    if (l.gravityDir !== undefined && !isVec(l.gravityDir, 3)) E(`${w}: "gravityDir" deve avere 3 elementi [x, y, z]`);
    for (const k of ['span', 'lock', 'lift', 'impulseFraction', 'arcExtra', 'palletDepth', 'damping', 'motorStiffness', 'motorTorqueMax', 'wheelInertia', 'gravity'])
      if (l[k] !== undefined && typeof l[k] !== 'number' && typeof l[k] !== 'string') E(`${w}: "${k}" deve essere un numero o un'espressione`);
  },

  resolve(M, { ev, vec }) {
    for (const l of activeLinks('graham_escapement_CS')) {
      CTX.where = `link graham_escapement_CS ${l.wheel} / ${l.anchor}`;
      const gw = M.gearBy[l.wheel], ga = M.gearBy[l.anchor], axW = gw.ax, axA = ga.ax, k = V.unit(axW.dir);
      const num = (v, d) => v !== undefined ? ev(v) : d;
      const R = gw.r, N = gw.z, rel = V.sub(axW.O, axA.O), D = V.len(V.perp(rel, k));
      if (!(R > 0) || !(N >= 8)) throw new Error(`${l.wheel}: servono "r" (raggio delle punte) e almeno 8 "teeth"`);
      if (!(D > R * 1.0001)) throw new Error(`scappamento: l'interasse (${D.toFixed(2)} mm) deve essere maggiore del raggio della ruota (${R} mm)`);
      const span = num(l.span, 7.5), Dideal = R / Math.cos(PI * span / N);
      if (Math.abs(D - Dideal) > 0.01 * Dideal) {
        const teeth = N * Math.acos(R / D) / PI;
        warn('scappamento', `${l.wheel}/${l.anchor}: interasse ${D.toFixed(2)} mm, ma per ${span} denti abbracciati serve ${Dideal.toFixed(2)} mm (con questo interasse l'ancora ne abbraccia ${teeth.toFixed(2)}): le due semi-battute risultano disuguali`);
      }
      const uDown = V.unit(V.perp(rel, k)), vX = V.cross(k, uDown);
      // gravità: il pendolo ha l'equilibrio quando l'asta (lungo A→W) è parallela alla gravità proiettata sul piano del meccanismo
      const gW = V.unit(l.gravityDir !== undefined ? vec(l.gravityDir) : [0, 0, -1]), gp = V.sub(gW, V.mul(k, V.dot(gW, k)));
      if (V.len(gp) < 0.2) throw new Error(`scappamento: la gravità è quasi parallela all'asse della ruota: gli assi devono essere orizzontali (es. dir [0,1,0] se la gravità è verso Z−)`);
      const thEq = Math.atan2(V.dot(vX, gp), V.dot(uDown, gp));
      if (Math.abs(thEq) > PI / 180) warn('scappamento', `${l.wheel}/${l.anchor}: la retta fra i centri non è parallela alla gravità (scarto ${(thEq * 180 / PI).toFixed(1)}°): il pendolo non pende lungo A→W e il meccanismo non è simmetrico. Con gravità verso Z− l'ancora deve stare sopra la ruota (stessa x e y, z maggiore) e gli assi devono essere orizzontali`);
      const epsW = Math.atan2(V.dot(vX, axW.yv), V.dot(vX, axW.ref));               // angolo locale (ruota) dell'asse X del piano
      const deltaA = Math.atan2(V.dot(uDown, axA.yv), V.dot(uDown, axA.ref));       // angolo locale (ancora) della direzione A→W
      const geoOpt = { R, N, D, lock: num(l.lock, 0.5), lift: num(l.lift, 2.5), impulseFraction: num(l.impulseFraction, 0.5), arcExtra: num(l.arcExtra, 8), palletDepth: num(l.palletDepth, 0.07 * R) };
      const G = GrahamCS.geometry(geoOpt);
      const L = ga.pendLen;
      if (!(L > 0)) throw new Error(`${l.anchor}: manca la lunghezza del pendolo ("pendulumLength")`);
      // dati per il disegno dei due gear (angoli locali: piano → locale)
      gw.graham = { N, R, phi0Local: G.phi0 + epsW, epsW };
      ga.graham = { entry: G.entry, exit: G.exit, rho: G.rho, depth: G.depth, arcExtra: G.arcExtra, aR: G.aR, aL: G.aL, deltaA, L, D };
      const P = { G, L, g: num(l.gravity, 9810), thEq, damping: num(l.damping, 0.05), kappa: num(l.motorStiffness, 0.04), tauMax: num(l.motorTorqueMax, 0.08),
                  Iw: num(l.wheelInertia, 1e-4), stallAngle: (G.mu + G.lam) * 0.8 };
      P.kick = Math.sqrt(P.g / L) * (G.mu + G.lam) * 1.8;                           // velocità angolare per superare l'impulso di ~1,8 volte
      const key = `${l.wheel}|${l.anchor}`, prev = GrahamStore_CS.get(key);
      const sig = [R, N, +D.toFixed(4)].join('|');
      let st; if (prev && prev.sig === sig) st = prev.st; else { st = GrahamCS.newState(); GrahamStore_CS.set(key, { sig, st }); st.fresh = true; }
      M.grahams.push({ def: l, gw, ga, axW, axA, iW: axW.idx, iA: axA.idx, P, G, st, key, needSync: true });
      step('scappamento', `Graham ${l.wheel}/${l.anchor}: R=${R} mm, ${N} denti, interasse ${D.toFixed(2)} mm, ρ=${G.rho.toFixed(2)} mm, pendolo ${L} mm (T≈${(2 * PI * Math.sqrt(L / P.g)).toFixed(2)} s), scarto dalla gravità ${(thEq * 180 / PI).toFixed(2)}°`);
    }
  },

  /* A ricostruzione finita: riallinea lo stato fisico agli angoli degli assi (che la ricostruzione conserva). */
  settle(M) {
    for (const gv of M.grahams) if (gv.needSync) {
      const st = gv.st, same = !st.fresh && Math.abs(gv.axW.theta - st.thW) < 1e-6 && Math.abs(gv.axA.theta - st.thA) < 1e-6;
      if (st.fresh) { st.thW = 0; st.thA = 0; st.wW = 0; st.wA = 0; gv.axW.theta = 0; gv.axA.theta = 0; st.fresh = false; GrahamCS.resetStats(st); }
      else if (!same) { st.thW = gv.axW.theta; st.thA = gv.axA.theta; st.wW = 0; st.wA = 0; GrahamCS.resetStats(st); }
      st.lastW = st.thW; st.lastA = st.thA; st.frameDone = true; gv.needSync = false;
    }
  },

  /* All'inizio di ogni frame: velocità comandata alla ruota (il risultato del solutore: clic sulla ruota + slider) e controllo
     di modifiche esterne agli angoli. Non produce eventi. */
  events(M, s, w) {
    for (const gv of M.grahams) {
      const st = gv.st; st.cmd = w[gv.iW];
      if (st.frameDone) {
        st.frameDone = false;
        if (Math.abs(gv.axW.theta - st.lastW) > 1e-9) { st.thW = gv.axW.theta; st.wW = 0; }
        if (Math.abs(gv.axA.theta - st.lastA) > 1e-9) { st.thA = gv.axA.theta; st.wA = 0; }
      }
    }
    return [];
  },

  /* Una volta per frame, dopo l'integrazione degli assi: la dinamica del meccanismo sostituisce gli angoli di ruota e ancora. */
  afterIntegrate(M) {
    const dt = typeof M.dt === 'number' ? M.dt : Math.min(engine.getDeltaTime() / 1000, 0.05) * state.timeScale;     // come nel ciclo di animazione
    for (const gv of M.grahams) {
      const st = gv.st; if (dt > 0) GrahamCS.advance(gv.P, st, dt, st.cmd);
      gv.axW.theta = st.thW; gv.axA.theta = st.thA; st.lastW = st.thW; st.lastA = st.thA; st.frameDone = true;
    }
  },

  linkedAxes: M => M.grahams.flatMap(g => [g.axW, g.axA]),

  status(M) {
    const lines = [];
    for (const gv of M.grahams) {
      const st = gv.st, deg = x => (x * 180 / PI).toFixed(1).replace('.', ',');
      if (st.cmd < -1e-9) lines.push(`Scappamento ${gv.def.anchor}: il motore gira nel verso sbagliato (serve velocità positiva)`);
      else if (st.cmd > 1e-9 || st.amp > 0.002) lines.push(`Scappamento Graham: ampiezza ±${deg(st.amp)}°, periodo ${st.period ? st.period.toFixed(2).replace('.', ',') : '–'} s, ruota ${st.period ? deg(2 * PI / gv.G.N / st.period) : '–'}°/s`);
    }
    return lines;
  }
});

/* >>>>> types/links/hooke/create.js */
/* =====================================================================
   types/links/hooke/create.js
   Snodo di Hooke (link "hooke"): crociera e forcelle
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
function createHooke(
    M,
    axis1,
    axis2,
    axis1side = 1,
    axis2side = 1,
    axis1rotate = false,
    leaderAxis = null,
    armDef = null
) {
    const arm = {
        r: armDef?.r ?? 2.3,
        len: armDef?.len ?? 13
    };

    const { r, len } = arm;
    const sceneRef = scene;

    // --------------------------------------------------
    // Utility geometriche
    // --------------------------------------------------

    const V3B = (v) => {
        const b = V.toB(v);
        return toV3(b);
    };

    const worldCenter = (v) => V3B(v);

// Estremi del cilindro che rappresenta l'albero.
// Se ci sono altri cilindri, ad esempio i marker, viene scelto
// quello con la maggiore estensione lungo Z.
const getAxisBounds = (axis) => {
    let shaft = null;

    for (const p of axis.def.parts || []) {
        if (
            !isActive(p) ||
            p.shape !== "cylinder" ||
            !Array.isArray(p.w)
        ) {
            continue;
        }

        // Risolve anche estremi espressi con formule o variabili.
        const { key } = resolvePart(p, M.ev);

        if (!Array.isArray(key.w) || key.w.length < 2) {
            continue;
        }

        const z0 = Number(key.w[0]);
        const z1 = Number(key.w[1]);

        if (!Number.isFinite(z0) || !Number.isFinite(z1)) {
            continue;
        }

        const candidate = {
            minZ: Math.min(z0, z1),
            maxZ: Math.max(z0, z1),
            length: Math.abs(z1 - z0)
        };

        if (!shaft || candidate.length > shaft.length) {
            shaft = candidate;
        }
    }

    if (!shaft || shaft.length < 1e-8) {
        throw new Error(
            `Impossibile trovare il cilindro dell'albero ${axis.id}`
        );
    }

    return {
        minZ: shaft.minZ,
        maxZ: shaft.maxZ
    };
};


// Coordinata lungo l'albero del punto di intersezione.
const shaftCoordinate = (axis, point) => {
    return V.dot(
        V.sub(point, axis.O),
        V.unit(axis.dir)
    );
};


// Sceglie automaticamente l'estremità più vicina
// al punto d'intersezione degli assi.
const getSideZ = (axis, intersection) => {
    const { minZ, maxZ } = getAxisBounds(axis);
    const centerZ = shaftCoordinate(axis, intersection);

    const distanceMin = Math.abs(centerZ - minZ);
    const distanceMax = Math.abs(centerZ - maxZ);

    return distanceMin <= distanceMax ? minZ : maxZ;
};

    const getWorldMatrix = (node) => {
        node.computeWorldMatrix(true);
        return node.getWorldMatrix();
    };

    const worldToLocal = (node, worldPoint) => {
        const inv = getWorldMatrix(node).clone();
        inv.invert();

        return BABYLON.Vector3.TransformCoordinates(worldPoint, inv);
    };

    const makeBox = (name, dimensions, parent, position, color) => {
        const mesh = BABYLON.MeshBuilder.CreateBox(
            name,
            dimensions,
            sceneRef
        );

        mesh.material = material(color);
        mesh.parent = parent;
        mesh.position.copyFrom(position);
        mesh.isPickable = false;

        return mesh;
    };

    // --------------------------------------------------
    // Punto di intersezione / minima distanza
    // --------------------------------------------------

    const getIntersection = (O1, D1, O2, D2) => {
        const w0 = V.sub(O1, O2);

        const a = V.dot(D1, D1);
        const b = V.dot(D1, D2);
        const c = V.dot(D2, D2);
        const d = V.dot(D1, w0);
        const e = V.dot(D2, w0);

        const denom = a * c - b * b;

        if (Math.abs(denom) < 1e-8) {
            // Assi paralleli: non esiste un'intersezione unica.
            // Usiamo il punto sull'asse 1 più vicino all'asse 2.
            const t = a > 1e-8 ? -d / a : 0;
            return V.add(O1, V.mul(D1, t));
        }

        const t = (b * e - c * d) / denom;
        const u = (a * e - b * d) / denom;

        const P1 = V.add(O1, V.mul(D1, t));
        const P2 = V.add(O2, V.mul(D2, u));

        return V.mul(V.add(P1, P2), 0.5);
    };

    const center = getIntersection(
        axis1.O, axis1.dir,
        axis2.O, axis2.dir
    );

// --------------------------------------------------
// DIREZIONE DEI DUE PERNI DELLA CROCIERA
// --------------------------------------------------

const d1 = V.unit(axis1.dir);
const d2 = V.unit(axis2.dir);

// Direzione del perno associato al primo albero.
const bendRaw = V.perp(d2, d1);

if (V.len(bendRaw) < 1e-8) {
    throw new Error(
        `Impossibile orientare lo snodo di Hooke: ` +
        `gli assi ${axis1.id} e ${axis2.id} sono paralleli`
    );
}

const pinDir1 = V.unit(bendRaw);

// Direzione del perno associato al secondo albero.
// È la stessa direzione usata da orientCross per yp.
const pinDir2 = V.unit(V.cross(d1, pinDir1));

    const centerWorld = worldCenter(center);
    const jointName = `hooke_${axis1.id}_${axis2.id}`;

    // --------------------------------------------------
    // CROCIERA CENTRALE
    // --------------------------------------------------

    const cross = new BABYLON.TransformNode(
        `cross_${axis1.id}_${axis2.id}`,
        sceneRef
    );

    cross.position.copyFrom(centerWorld);
    cross.rotationQuaternion = BABYLON.Quaternion.Identity();

    // Due perni ortogonali nel riferimento della crociera.
    // I cilindri sono centrati nel punto d'intersezione.
    const crossArm1 = BABYLON.MeshBuilder.CreateCylinder(
        `${jointName}_pin1`,
        {
            height: 2 * len,
            diameter: 2 * r,
            tessellation: 24
        },
        sceneRef
    );

    crossArm1.material = material("#00ff00");
    crossArm1.parent = cross;
    crossArm1.isPickable = false;

    const crossArm2 = BABYLON.MeshBuilder.CreateCylinder(
        `${jointName}_pin2`,
        {
            height: 2 * len,
            diameter: 2 * r,
            tessellation: 24
        },
        sceneRef
    );

    crossArm2.material = material("#00ff00");
    crossArm2.rotation.z = Math.PI / 2;
    crossArm2.parent = cross;
    crossArm2.isPickable = false;

    const core = BABYLON.MeshBuilder.CreateBox(
        `${jointName}_core`,
        { size: 2 * r },
        sceneRef
    );

    core.material = material("#ffff00");
    core.parent = cross;
    core.isPickable = false;

    // --------------------------------------------------
    // CREA UNA FORCELLA SULL'ESTREMITÀ SCELTA
    // --------------------------------------------------

const createYoke = (axis, pinDir, suffix, color) => {
    if (!axis.frame) {
        throw new Error(
            `L'asse ${axis.id} non possiede axis.frame`
        );
    }

    // Estremità dell'albero più vicina alla crociera.
    const endZ = getSideZ(axis, center);

    const yoke = new BABYLON.TransformNode(
        `yoke${suffix}_${axis.id}`,
        sceneRef
    );

    yoke.parent = axis.frame;
    yoke.position.set(0, 0, endZ);

    // --------------------------------------------------
    // ROTAZIONE AUTOMATICA ATTORNO ALL'ALBERO
    // --------------------------------------------------

    // Gli assi locali X e Y del frame corrispondono
    // rispettivamente a axis.ref e axis.yv.
    const localX = V.dot(pinDir, axis.ref);
    const localY = V.dot(pinDir, axis.yv);

    // Orienta l'asse X della forcella lungo il perno.
    const roll = Math.atan2(localY, localX);

    yoke.rotationQuaternion =
        BABYLON.Quaternion.RotationAxis(
            BABYLON.Axis.Z,
            roll
        );

    // Distanza assiale tra l'estremità e la crociera.
    const dz = shaftCoordinate(axis, center) - endZ;

    // --------------------------------------------------
    // GEOMETRIA DELLA FORCELLA: INVARIATA
    // --------------------------------------------------

    const forkLength = Math.max(r, Math.abs(dz));
    const middleZ = dz / 2;

    const forkOffset = 2.5 * r;
    const forkThickness = 1.5 * r;
    const forkWidth = 5 * r;

    const forkLeft = makeBox(
        `fork${suffix}Left_${axis.id}`,
        {
            width: forkThickness,
            height: forkWidth,
            depth: forkLength + 10
        },
        yoke,
        new BABYLON.Vector3(
            -2 * forkOffset,
            0,
            middleZ
        ),
        color
    );

    const forkRight = makeBox(
        `fork${suffix}Right_${axis.id}`,
        {
            width: forkThickness,
            height: forkWidth,
            depth: forkLength + 10
        },
        yoke,
        new BABYLON.Vector3(
            2 * forkOffset,
            0,
            middleZ
        ),
        color
    );

    const forkBase = makeBox(
        `fork${suffix}Base_${axis.id}`,
        {
            width: 4 * forkOffset + forkThickness,
            height: forkWidth,
            depth: 2 * r
        },
        yoke,
        new BABYLON.Vector3(0, 0, 0),
        color
    );

    return {
        yoke,
        forkLeft,
        forkRight,
        forkBase
    };
};

const result1 = createYoke(
    axis1,
    pinDir1,
    "1",
    "#2f6fe0"
);

const result2 = createYoke(
    axis2,
    pinDir2,
    "2",
    "#d4262e"
);

    return {
        cross,
        yoke1: result1.yoke,
        yoke2: result2.yoke
    };
}

function orientCross(h, phi) {
  const psi = hookePsi(h, phi), din = M.axes[h.inIdx].dir, yp = V.cross(din, h.bend);
  const A = V.add(V.mul(h.bend, cos(phi)), V.mul(yp, sin(phi)));
  const e1 = V.sub(V.mul(h.bend, h.cb), V.mul(din, h.sb));
  const B = V.add(V.mul(e1, -sin(psi)), V.mul(yp, cos(psi)));
  const nn = V.cross(A, B), a = V.toB(A), b = V.toB(B), c = V.toB(nn);
  h.cross.rotationQuaternion = Quat.FromRotationMatrix(BABYLON.Matrix.FromValues(
    a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, 0, 0, 0, 1));
}

Registry.link('hooke', {
  order: { build: 40, afterPose: 10 },

  build(M, { inGroup }) {
    for (const h of M.hookes) {
      const axis1 = M.axes[h.inIdx];
      const axis2 = M.axes[h.outIdx];

      // NOTA: h.def.arm finisce nel parametro "axis1side" di createHooke (come nel codice originale), quindi le
      // dimensioni della crociera restano quelle di default (r=2.3, len=13). Per usarle davvero servirebbe passare
      // h.def.arm come ultimo parametro (armDef): non l'ho cambiato per non alterare l'aspetto delle macchine esistenti.
      const result = createHooke(M, axis1, axis2, h.def.arm);

      h.cross = result.cross;
      h.yoke1 = result.yoke1;
      h.yoke2 = result.yoke2;
      M.nodes.push(result.cross, result.yoke1, result.yoke2);
      inGroup(h.def.group, result.cross);
      inGroup(h.def.group, result.yoke1);
      inGroup(h.def.group, result.yoke2);
      step('scena', `snodo di Hooke ${h.def.input} → ${h.def.output}: crociera e forcelle create`);
    }
  },

  afterPose(M) {
    for (const h of M.hookes) orientCross(h, M.axes[h.inIdx].theta);
  }
});

/* >>>>> types/links/hooke/solve.js */
/* =====================================================================
   types/links/hooke/solve.js
   Snodo di Hooke (link "hooke"): rapporto di trasmissione variabile fra due assi incidenti
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
const hookeRatio = (h, theta) => (1 - h.sb * h.sb * cos(theta) ** 2) / h.cb;
function hookePsi(h, phi) {
  const p = Math.atan2(sin(phi), h.cb * cos(phi));
  return p + 2 * PI * Math.round((phi - p) / (2 * PI));
}

Registry.link('hooke', {
  collection: 'hookes',
  order: { constraints: 30, afterIntegrate: 20, status: 30 },

  validate(l, w, { E, ax }) {
    ax(l.input, 'input'); ax(l.output, 'output');
    if (!l.arm) E(`${w}: manca "arm"`);
  },

  /* Prima dei riferimenti di default: i riferimenti dei due assi devono essere coerenti con la crociera. */
  prepareAxes(M) {
    for (const l of activeLinks('hooke')) {
      CTX.where = `link hooke ${l.input} → ${l.output}`;
      const ai = M.axisBy[l.input], ao = M.axisBy[l.output];
      const bend = V.unit(V.perp(ao.dir, ai.dir)), pinB = V.cross(ai.dir, bend);
      ai.ref = ai.ref || V.unit(V.cross(bend, ai.dir));
      ao.ref = ao.ref || V.unit(V.cross(pinB, ao.dir));
    }
  },

  resolve(M) {
    for (const l of activeLinks('hooke')) {
      CTX.where = `link hooke`;
      const ai = M.axisBy[l.input], ao = M.axisBy[l.output], cb = V.dot(ai.dir, ao.dir);
      M.hookes.push({ def: l, inIdx: ai.idx, outIdx: ao.idx, cb, sb: Math.sqrt(1 - cb * cb), bend: V.unit(V.perp(ao.dir, ai.dir)) });
      step('link', `snodo di Hooke: ${l.input} → ${l.output}, angolo ${(Math.acos(cb) * 180 / PI).toFixed(2)}°`);
    }
  },

  constraints(M, push, { n }) {
    for (const h of M.hookes) {
      const r = new Array(n).fill(0); r[h.inIdx] = 1; r[h.outIdx] = -hookeRatio(h, M.axes[h.inIdx].theta);
      push('hooke', `snodo ${M.axes[h.inIdx].id} → ${M.axes[h.outIdx].id}`, r, 0);
    }
  },

  /* Angolo dell'asse condotto: ψ = atan2(sin φ, cos β · cos φ) */
  afterIntegrate(M) {
    for (const h of M.hookes) M.axes[h.outIdx].theta = hookePsi(h, M.axes[h.inIdx].theta);
  },

  status(M, w) {
    const lines = [], E = 1e-9;
    for (const h of M.hookes) if (Math.abs(w[h.inIdx]) > E) lines.push(template(h.def.message, M.ev, { beta: Math.acos(h.cb) * 180 / PI, lo: h.cb, hi: 1 / h.cb }));
    return lines;
  },

  linkedAxes: M => M.hookes.flatMap(h => [M.axes[h.inIdx], M.axes[h.outIdx]])
});

/* >>>>> types/links/pin_slot/create.js */
/* =====================================================================
   types/links/pin_slot/create.js
   Perno in scanalatura (link "pin_slot", meccanismo dell'Antikythera)
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
// Il link non crea oggetti propri: il perno è l'asse "pinAxis" (con le sue parti) e il disco è un gear "cylinder" o simile.

/* >>>>> types/links/pin_slot/solve.js */
/* =====================================================================
   types/links/pin_slot/solve.js
   Perno in scanalatura (link "pin_slot"): il perno della ruota 1 scorre nella scanalatura della ruota 2
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('pin_slot', {
  collection: 'pinSlots',
  order: { resolve: 10, constraints: 60, afterIntegrate: 30 },

  validate(l, w, { E, axisBy, gearBy }) {
    const dGear = gearBy[l.driver], sGear = gearBy[l.driven];
    if (!dGear) E(`${w}: driver "${l.driver}" non esiste o non è attivo`);
    else if (!sGear) E(`${w}: driven "${l.driven}" non esiste o non è attivo`);
    else if (dGear === sGear) E(`${w}: driver e driven devono essere diversi`);
    else {
      const d1 = axisBy[dGear.axis], d2 = axisBy[sGear.axis];
      if (d1 && d2 && Math.abs(Math.abs(V.dot(d1.dir, d2.dir)) - 1) > 1e-6)
        E(`${w}: gli assi di ${l.driver} e ${l.driven} devono essere paralleli`);
    }
    if (l.pinAxis) {
      const pa = axisBy[l.pinAxis];
      if (!pa) E(`${w}: pinAxis "${l.pinAxis}" non esiste o non è attivo`);
      else if (dGear && pa.carrier !== dGear.axis)
        E(`${w}: pinAxis "${l.pinAxis}" deve avere carrier = "${dGear.axis}"`);
    } else if (l.pinRadius === undefined) {
      E(`${w}: specificare "pinAxis" oppure "pinRadius"`);
    }
  },

  // ---- risoluzione geometrica (meccanismo Antikythera e simili)
  resolve(M, { ev }) {
  for (const l of activeLinks('pin_slot')) {
    CTX.where = `link pin_slot ${l.driver} → ${l.driven}`;
    const g1 = M.gearBy[l.driver], g2 = M.gearBy[l.driven];
    if (!g1) throw new Error(`pin_slot: driver "${l.driver}" non esiste`);
    if (!g2) throw new Error(`pin_slot: driven "${l.driven}" non esiste`);

    let rPin, pinAxis = null;
    if (l.pinAxis) {
      pinAxis = M.axisBy[l.pinAxis];
      if (!pinAxis) throw new Error(`pin_slot: pinAxis "${l.pinAxis}" non esiste`);
      rPin = V.len(V.perp(V.sub(pinAxis.O, g1.ax.O), g1.ax.dir));
      if (rPin < 1e-6) throw new Error(`pin_slot: pinAxis coincide con l'asse di ${l.driver}`);
    } else {
      rPin = ev(l.pinRadius);
    }

  let slotAngle = 0;
  if (l.slotAngle !== undefined) {
    slotAngle = ev(l.slotAngle) * PI / 180;
  } else if (l.slotAxis && M.axisBy[l.slotAxis]) {
    const sa = M.axisBy[l.slotAxis];
    // Proietta la direzione dello slot nel piano (ref, yv) di K2
    slotAngle = Math.atan2(V.dot(sa.dir, g2.ax.yv), V.dot(sa.dir, g2.ax.ref));
  }
    const carrier = commonFrame(g1.ax, g2.ax);
    if (g1.ax.carrier !== g2.ax.carrier) {
      warn('pin_slot', `${g1.id} e ${g2.id} hanno carrier diversi: la cinematica potrebbe essere inaccurata`);
    }

    const relPerp = V.perp(V.sub(g2.ax.O, g1.ax.O), g1.ax.dir);
    const d = V.len(relPerp);
    if (d < 1e-6) throw new Error(`pin_slot: gli assi di ${l.driver} e ${l.driven} coincidono`);
    const dx = V.dot(relPerp, g1.ax.ref);
    const dy = V.dot(relPerp, g1.ax.yv);

    let initialPinAngle = 0;
    if (pinAxis) {
      const pinRel = V.perp(V.sub(pinAxis.O, g1.ax.O), g1.ax.dir);
      initialPinAngle = Math.atan2(V.dot(pinRel, g1.ax.yv), V.dot(pinRel, g1.ax.ref));
    }

    M.pinSlots.push({
      def: l, g1, g2, rPin, slotAngle, carrier,
      dx, dy, d, initialPinAngle, pinAxis,
      slotAxis: l.slotAxis ? M.axisBy[l.slotAxis] : null
    });
    step('pin_slot', `${g1.id} → ${g2.id}: rPin=${rPin.toFixed(3)}, d=${d.toFixed(3)}, slotAngle=${(slotAngle*180/PI).toFixed(2)}°`);
  }
  },

  /* Vincolo cinematico: s2 = rapporto · s1, con rapporto istantaneo dalla posizione del perno */
  constraints(M, push, { n }) {
    for (const ps of M.pinSlots) {
      const row = new Array(n).fill(0);
      const alpha1 = ps.g1.ax.theta + ps.initialPinAngle;
      const A = ps.rPin * Math.cos(alpha1) - ps.dx;
      const B = ps.rPin * Math.sin(alpha1) - ps.dy;
      const den = A * A + B * B;
      if (den < 1e-20) {
        warn('pin_slot', `${ps.g1.id} → ${ps.g2.id}: pin a C₂, vincolo saltato`);
        continue;
      }
      const ratio = ps.rPin * (A * Math.cos(alpha1) + B * Math.sin(alpha1)) / den;

      row[ps.g2.ax.idx] += 1;
      row[ps.g1.ax.idx] -= ratio;
      if (ps.carrier) {
        for (const k in ps.carrier.Om) {
          const proj1 = V.dot(ps.carrier.Om[k], ps.g1.ax.dir);
          const proj2 = V.dot(ps.carrier.Om[k], ps.g2.ax.dir);
          row[+k] += -proj2 + ratio * proj1;
        }
      }
      push('pin_slot', `pin_slot ${ps.g1.id} → ${ps.g2.id} (rapporto ${ratio.toFixed(4)})`, row, 0);
    }
  },

  /* Posizione della ruota 2 dalla geometria del perno, senza salti di 2π */
  afterIntegrate(M) {
    for (const ps of M.pinSlots) {
      const alpha1 = ps.g1.ax.theta + ps.initialPinAngle;
      const A = ps.rPin * Math.cos(alpha1) - ps.dx;
      const B = ps.rPin * Math.sin(alpha1) - ps.dy;
      if (A * A + B * B < 1e-20) continue;
      const curA2 = ps.g2.ax.theta + ps.slotAngle;
      let target = Math.atan2(B, A);
      while (target - curA2 > PI) target -= 2 * PI;
      while (target - curA2 < -PI) target += 2 * PI;
      ps.g2.ax.theta = target - ps.slotAngle;
    }
  }
});

/* >>>>> types/links/rail/create.js */
/* =====================================================================
   types/links/rail/create.js
   Binario (link "rail"): marker del punto d'intersezione
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
Registry.link('rail', {
  order: { build: 30 },

  build(M, { inGroup }) {
    for (const q of M.rails) if (q.def.marker) {            // "marker": true (o il raggio in mm) → sferetta sul punto d'intersezione del binario
      q.marker = BABYLON.MeshBuilder.CreateSphere('rail_marker', { diameter: 2 * (q.def.marker === true ? 6 : +q.def.marker) }, scene);
      q.marker.material = markerMat; q.marker.isPickable = false;
      M.extras.push(q.marker); inGroup(q.def.group, q.marker);
      step('scena', `binario ${q.a.id}: marker dell'intersezione creato`);
    }
  }
});

/* >>>>> types/links/rail/solve.js */
/* =====================================================================
   types/links/rail/solve.js
   Binario (link "rail"): una guida passa per un punto fisso e interseca sempre un altro asse
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
/* Risolve un binario. Piano π = (P, retta di A); la guida è la perpendicolare a g (la retta T) in P dentro π:  b = n × g,  n = y × (O_A − P).
   Orientata verso il punto d'intersezione X = P + t·b = O_A + s·y  (t = distanza da P lungo la guida, s = posizione su A). */
function solveRail(q, cache) {
  const P = q.a.O, g = V.unit(q.t.dir);
  const fs = axisFrame(q.slider, cache), y = V.unit(fs.dir), d = V.sub(fs.O, P);
  let n = V.cross(y, d), degenerate = false;
  if (V.len(n) < 1e-9 * (V.len(d) || 1)) { n = V.cross(y, g); degenerate = true; }   // P sta sulla retta di A: piano (A, T)
  let b = V.cross(n, g);
  if (V.len(b) < 1e-9 * (V.len(n) || 1)) return q.last ? { ...q.last, stale: true } : null;  // T perpendicolare al piano: indeterminato, si tiene l'ultima posa
  b = V.unit(b);
  const bxy = V.cross(b, y), den = V.dot(bxy, bxy);
  let X = null, t = NaN, s = NaN, resid = NaN;
  if (den > 1e-12) {
    t = V.dot(V.cross(d, y), bxy) / den;
    s = V.dot(V.cross(d, b), bxy) / den;
    if (t < 0) { b = V.mul(b, -1); t = -t; }                       // la guida punta verso l'intersezione
    X = V.add(P, V.mul(b, t));
    resid = V.len(V.sub(X, V.add(fs.O, V.mul(y, s))));
  } else if (V.dot(b, q.prev) < 0) b = V.mul(b, -1);                // guida parallela ad A: nessuna intersezione, si tiene il verso precedente
  q.prev = b;
  q.last = { b, g, X, t, s, resid, degenerate, perp: V.dot(b, g) };
  return q.last;
}

function applyRail(q, r) {
  if (!r) return;
  setNodePose(q.a, { O: q.a.O, dir: r.b, ref: r.g });               // ref = coda (⟂ a b): la posa attorno a b è liscia
  q.a.dir = r.b.slice(); q.a.ref = r.g.slice(); q.a.yv = V.cross(q.a.dir, q.a.ref);
  if (q.marker && r.X) { const p = V.toB(r.X); q.marker.position.set(p[0], p[1], p[2]); q.marker.setEnabled(true); }
  else if (q.marker) q.marker.setEnabled(false);
}


Registry.link('rail', {
  collection: 'rails',

  validate(l, w, { E, ax, axisBy }) {
    ax(l.guide, 'guide'); ax(l.slider, 'slider');
    if (l.guide !== undefined && l.guide === l.slider) E(`${w}: guide e slider devono essere assi diversi`);
    if (!(axisBy[l.perpendicularTo] && axisBy[l.perpendicularTo].through !== undefined)) E(`${w}: "perpendicularTo" deve riferire un asse con "through" (qui: "${l.perpendicularTo}")`);
    if (axisBy[l.guide] && (axisBy[l.guide].through !== undefined || axisBy[l.guide].alignWith !== undefined)) E(`${w}: la guida "${l.guide}" non può avere "through" né "alignWith" (la sua direzione la calcola il binario)`);
  },

  /* Chiamato alla fine di initThrough: il binario si appoggia alle rette "through" appena create. */
  initThrough(M, ev) {
    /* Binari ("rail"): link { "type":"rail", "guide": B, "slider": A, "perpendicularTo": T }.
       B passa per il proprio punto fisso P (la sua origine) e viene orientata ogni frame in modo che:
         1. intersechi sempre la retta di A (B giace nel piano che contiene P e la retta di A);
         2. sia perpendicolare in P alla retta T (di norma la coda, un asse "through").
       Il punto d'intersezione X non è un dato: si calcola e cambia di continuo (A scorre lungo B), quindi non servono "estremità". */
    M.rails = [];
    for (const l of MACHINE.links) if (l.type === 'rail' && isActive(l)) {
      CTX.where = `link rail ${l.guide} su ${l.slider}`;
      const a = M.axisBy[l.guide], slider = M.axisBy[l.slider], t = M.through.find(x => x.a.id === l.perpendicularTo);
      if (!a || !slider || !t) throw new Error(`link rail: guide "${l.guide}", slider "${l.slider}" e perpendicularTo "${l.perpendicularTo}" (asse con through) devono esistere`);
      const k = M.perpendicular.findIndex(q => q.a === a);
      if (k >= 0) { M.perpendicular.splice(k, 1); warn('rail', `${a.id}: il binario sostituisce il suo "perpendicularTo"`); }
      a.aimed = a.aligned = true;
      M.rails.push({ a, slider, t, def: l, prev: V.mul(V.unit(a.dir), l.sign < 0 ? -1 : 1) });
      step('rail', `${a.id}: passa per ${fmtV(a.O)}, interseca sempre ${slider.id} ed è perpendicolare a ${t.a.id}`);
    }
  },

  /* Chiamato per ogni retta "through" dentro updateThrough: i binari che dipendono da questa retta si risolvono subito. */
  afterThroughLine(M, t, cache, lines) {
    // le rette through successive possono avere "refFrom" sulla guida: per questo si risolve subito
    for (const q of M.rails) if (q.t === t) {
      const rr = solveRail(q, cache); applyRail(q, rr);
      if (!rr) { lines.push(`${q.a.id}: binario indeterminato (la retta ${t.a.id} è perpendicolare al piano di ${q.slider.id}), tenuta l'ultima posizione.`); continue; }
      lines.push(`${q.a.id}: binario su ${q.slider.id}, ` + (rr.X
        ? `intersezione a ${fmt(rr.t, 1)} mm da P e a ${fmt(rr.s, 1)} mm dall'origine di ${q.slider.id} (residuo ${rr.resid.toExponential(1)}), ` : `nessuna intersezione (parallela a ${q.slider.id}), `)
        + `angolo con ${t.a.id} ${fmt(Math.acos(Math.max(-1, Math.min(1, rr.perp))) * 180 / PI, 2)}°` + (rr.degenerate ? ' [P su ' + q.slider.id + ': piano da ' + t.a.id + ']' : '') + '.');
    }
  }
});

/* >>>>> types/links/ratchet/create.js */
/* =====================================================================
   types/links/ratchet/create.js
   Nottolino (link "ratchet")
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
// Il nottolino è un vincolo puramente cinematico: non ha parte grafica né controlli.

/* >>>>> types/links/ratchet/solve.js */
/* =====================================================================
   types/links/ratchet/solve.js
   Nottolino (link "ratchet"): trascina in un verso, ruota libera nell'altro
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('ratchet', {
  collection: 'ratchets',
  order: { constraints: 40, status: 10 },

  validate(l, w, { W, ax }) {
    ax(l.driver, 'driver'); ax(l.driven, 'driven');
    for (const k of ['drives', 'winding', 'freewheel', 'blocks']) if (!l.messages || l.messages[k] === undefined) W(`${w}: manca messages.${k}`);
  },

  resolve(M) {
    for (const l of activeLinks('ratchet')) {
      CTX.where = `link ratchet`;
      M.ratchets.push({ def: l, driver: M.axisBy[l.driver].idx, driven: M.axisBy[l.driven].idx, sign: l.sign || 1 });
      step('link', `nottolino: ${l.driver} → ${l.driven}`);
    }
  },

  /* Vincolo unilaterale: se, ignorandolo, la ruota condotta andrebbe "contro" il nottolino, lo si blocca (accoppia le due velocità). */
  lockable: M => M.ratchets.length,
  lock(M, w, locked) {
    let changed = false;
    for (const rt of M.ratchets) if (!locked.has(rt) && rt.sign * (w[rt.driven] - w[rt.driver]) < -1e-9) { locked.add(rt); changed = true; }
    return changed;
  },
  constraints(M, push, { n, locked }) {
    for (const rt of locked) if (rt.def && rt.def.type === 'ratchet') {
      const r = new Array(n).fill(0); r[rt.driven] = 1; r[rt.driver] = -1;
      push('nottolino', `nottolino ${M.axes[rt.driver].id} → ${M.axes[rt.driven].id} (bloccato)`, r, 0);
    }
  },

  status(M, w, locked) {
    const lines = [], E = 1e-9;
    for (const r of M.ratchets) {
      const wd = w[r.driver], wa = w[r.driven], m = r.def.messages;
      if (locked.has(r)) lines.push(r.sign * wd > E ? m.drives : m.blocks);
      else if (Math.abs(wd) > E && Math.abs(wa) < E) lines.push(m.winding);
      else if (Math.abs(wa) > E && Math.abs(wd) < E) lines.push(m.freewheel);
    }
    return lines;
  },

  linkedAxes: M => M.ratchets.flatMap(r => [M.axes[r.driver], M.axes[r.driven]])
});

/* >>>>> types/links/rod_GK/create.js */
/* =====================================================================
   types/links/rod_GK/create.js
   Asta a lunghezza fissa (spinta/tiro su un bilanciere)
   ===================================================================== */
Registry.link('rod_GK', {
  order: { build: 30 },

  build(M, { inGroup }) {
    for (const q of M.rods_GK || []) {
      if (q.def && q.def.marker) {
        const r = q.def.marker === true ? 4 : +q.def.marker;
        q.marker = BABYLON.MeshBuilder.CreateSphere('rod_GK_marker', { diameter: 2 * r }, scene);
        q.marker.material = markerMat;
        q.marker.isPickable = false;
        M.extras.push(q.marker);
        inGroup(q.def.group, q.marker);
      }

      if (q.wantRodVisual) {
        const rodMat = new BABYLON.StandardMaterial('rod_GK_rodMat', scene);
        rodMat.diffuseColor = BABYLON.Color3.FromHexString('#e67e22');
        rodMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        const tess = (q.def && q.def.rodSides !== undefined) ? +q.def.rodSides : 8;
        const diam = (q.def && q.def.rodDiameter !== undefined) ? +q.def.rodDiameter : 2.8;
        q.rodMesh = BABYLON.MeshBuilder.CreateCylinder('rod_GK_rod', {
          height: 1, diameter: diam, tessellation: tess
        }, scene);
        q.rodMesh.material = rodMat;
        q.rodMesh.isPickable = false;
        q.rodMesh.setEnabled(false);
        M.extras.push(q.rodMesh);
        inGroup(q.def && q.def.group, q.rodMesh);
      }

      const fromId  = q.from  && q.from.id  ? q.from.id  : '?';
      const pivotId = q.pivot && q.pivot.id ? q.pivot.id : '?';
      step('scena', `rod_GK ${fromId} → pivot ${pivotId}: build ok`);
    }
  }
});

/* >>>>> types/links/rod_GK/solve.js */
/* =====================================================================
   types/links/rod_GK/solve.js
   Asta a lunghezza fissa: collega un punto guida a un punto su un bilanciere.

   I due meccanismi restano separati:
     - slider_GK  posiziona il pistone (e i suoi follower)
     - rod_GK     legge un punto sul pistone (o su qualunque asse) e risolve
                  l'angolo del bilanciere

   JSON:
     { "type": "rod_GK",
       "from":    "axis_Pistone",     // asse da cui parti (es. pistone)
       "fromAt":  [0, 0, 10],         // punto LOCALE su from [ref, yv, dir]
       "pivot":   "axis_Rocker",      // bilanciere (ruota attorno a dir)
       "pivotAt": [0, -40, 0],        // punto di attacco LOCALE sul bilanciere
                                      //   [ref, yv, dir] a theta = 0
       "length":  55,                 // lunghezza asta
       "rod":     "axis_Spinta",      // opzionale: asse visuale dell'asta
       "marker":  true
     }

   Non serve più un asse "to" / RockerPin per il vincolo.
   Se vuoi un perno visuale sul bilanciere, metti una part su pivot
   oppure un asse con carrier = pivot e place all'offset desiderato
   (non lo tocchiamo).
   ===================================================================== */

function rodrigues(k, theta, v) {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const kxv = V.cross(k, v);
  const kdo = V.dot(k, v);
  return V.add(V.add(V.mul(v, ct), V.mul(kxv, st)), V.mul(k, kdo * (1 - ct)));
}

function frameBasis(a, cache) {
  const f = axisFrame(a, cache);
  const dir = V.unit(f.dir);
  // ref/yv a theta=0 (non ruotati): li prendiamo dall'asse come definiti al resolve
  let ref0 = a._rodRef0 || a.ref || V.anyPerp(dir);
  ref0 = V.unit(V.perp(ref0, dir));
  if (V.len(ref0) < 1e-8) ref0 = V.anyPerp(dir);
  let yv0 = a._rodYv0 || a.yv || V.cross(dir, ref0);
  yv0 = V.unit(V.perp(yv0, dir));
  if (V.len(yv0) < 1e-8) yv0 = V.cross(dir, ref0);
  return { O: f.O, dir, ref0: V.unit(ref0), yv0: V.unit(yv0) };
}

/** Punto locale [x,y,z] nel basis (ref0,yv0,dir), poi ruotato di theta attorno a dir */
function bodyPoint(basis, at, theta) {
  const loc = V.add(
    V.add(V.mul(basis.ref0, at[0]), V.mul(basis.yv0, at[1])),
    V.mul(basis.dir, at[2])
  );
  return V.add(basis.O, theta ? rodrigues(basis.dir, theta, loc) : loc);
}

function solveRodGK(q, cache) {
  // --- punto guida (from) ---
  // from può essere aimed (pistone): usiamo O/dir/ref aggiornati
  const fFrom = axisFrame(q.from, cache);
  const dirF = V.unit(fFrom.dir);
  let refF = q.from.ref ? V.unit(V.perp(q.from.ref, dirF)) : V.anyPerp(dirF);
  if (V.len(refF) < 1e-8) refF = V.anyPerp(dirF);
  let yvF = q.from.yv ? V.unit(V.perp(q.from.yv, dirF)) : V.cross(dirF, refF);
  if (V.len(yvF) < 1e-8) yvF = V.cross(dirF, refF);
  const F = V.add(fFrom.O,
    V.add(V.mul(refF, q.fromAt[0]),
      V.add(V.mul(yvF, q.fromAt[1]), V.mul(dirF, q.fromAt[2]))));

  // --- bilanciere ---
  const basis = frameBasis(q.pivot, cache);
  const O = basis.O;
  const k = basis.dir;
  const loc0 = V.add(
    V.add(V.mul(basis.ref0, q.pivotAt[0]), V.mul(basis.yv0, q.pivotAt[1])),
    V.mul(basis.dir, q.pivotAt[2])
  );
  // componente nel piano ⟂ k (il moto del punto di attacco)
  const loc = V.perp(loc0, k);
  const R = V.len(loc);
  const axial = V.dot(loc0, k);       // eventuale offset lungo l'asse (costante)

  if (R < 1e-9) {
    return q.last ? { ...q.last, stale: true } : null;
  }

  const FO = V.sub(F, O);
  const Fperp = V.perp(FO, k);
  const d = V.len(Fperp);
  // lunghezza efficace nel piano: la distanza 3D tiene conto anche del dislivello assiale
  const dAx = V.dot(FO, k) - axial;
  const Lplane2 = q.length * q.length - dAx * dAx;
  if (Lplane2 < 0) {
    return q.last ? { ...q.last, stale: true } : null;
  }
  const Lplane = Math.sqrt(Lplane2);

  if (d < 1e-9) {
    return q.last ? { ...q.last, stale: true } : null;
  }

  const cosAlpha = (d * d + R * R - Lplane * Lplane) / (2 * d * R);
  if (cosAlpha < -1.001 || cosAlpha > 1.001) {
    return q.last ? { ...q.last, stale: true } : null;
  }
  const cA = Math.max(-1, Math.min(1, cosAlpha));
  const alpha = Math.acos(cA);

  const u = V.unit(Fperp);
  const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
  const locU = V.unit(loc);
  const angLoc0 = Math.atan2(V.dot(V.cross(u, locU), k), V.dot(u, locU));

  // theta tale che angolo di loc ruotato = ±alpha rispetto a u
  const th1 = wrap(alpha - angLoc0);
  const th2 = wrap(-alpha - angLoc0);

  let theta;
  if (q.prevTheta == null || !Number.isFinite(q.prevTheta)) {
    theta = Math.abs(th1) <= Math.abs(th2) ? th1 : th2;
  } else {
    const d1 = Math.abs(wrap(th1 - q.prevTheta));
    const d2 = Math.abs(wrap(th2 - q.prevTheta));
    theta = d1 <= d2 ? th1 : th2;
  }
  theta = q.prevTheta != null ? q.prevTheta + wrap(theta - q.prevTheta) : theta;
  q.prevTheta = theta;

  const P = bodyPoint(basis, q.pivotAt, theta);

  const rodVec = V.sub(P, F);
  const rodLen = V.len(rodVec);
  const rodDir = rodLen > 1e-9 ? V.mul(rodVec, 1 / rodLen) : [0, 0, 1];
  let rodRef = V.perp(k, rodDir);
  if (V.len(rodRef) < 1e-8) rodRef = V.anyPerp(rodDir);
  rodRef = V.unit(rodRef);

  q.last = { F, P, O, theta, rodDir, rodRef, resid: Math.abs(rodLen - q.length), stale: false };
  return q.last;
}

function applyRodGK(q, r) {
  if (!r) return;

  // solo l'angolo del bilanciere: la gerarchia Babylon (parts, eventuali carrier)
  // ruota da sola con theta
  q.pivot.theta = r.theta;

  // aggiorna il quaternion del nodo pivot (non è aimed)
  if (q.pivot.node && q.pivot.axisB) {
    q.pivot.node.rotationQuaternion = Quat.RotationAxis(q.pivot.axisB, r.theta);
  }

  if (q.rod) {
    q.rod.O = r.F.slice();
    q.rod.dir = r.rodDir.slice();
    q.rod.ref = r.rodRef.slice();
    q.rod.yv = V.cross(r.rodDir, r.rodRef);
    setNodePose(q.rod, { O: r.F, dir: r.rodDir, ref: r.rodRef });
  }

  if (q.marker) {
    const p = V.toB(r.P);
    q.marker.position.set(p[0], p[1], p[2]);
    q.marker.setEnabled(true);
  }

  if (q.rodMesh) {
    const mid = V.mul(V.add(r.F, r.P), 0.5);
    const len = Math.max(V.len(V.sub(r.P, r.F)), 1e-6);
    const yM = r.rodDir, xM = r.rodRef, zM = V.cross(xM, yM);
    const xB = V.toB(xM), yB = V.toB(yM), zB = V.toB(zM);
    const p = V.toB(mid);
    q.rodMesh.position.set(p[0], p[1], p[2]);
    q.rodMesh.rotationQuaternion = Quat.FromRotationMatrix(
      BABYLON.Matrix.FromValues(
        xB[0], xB[1], xB[2], 0,
        yB[0], yB[1], yB[2], 0,
        zB[0], zB[1], zB[2], 0,
        0, 0, 0, 1
      )
    );
    q.rodMesh.scaling.set(1, len, 1);
    q.rodMesh.setEnabled(true);
  }
}


Registry.link('rod_GK', {
  collection: 'rods_GK',
  order: { afterIntegrate: 50 },

  validate(l, w, { E, ax, isVec }) {
    ax(l.from,  'from');
    ax(l.pivot, 'pivot');
    if (l.rod) ax(l.rod, 'rod');
    if (l.from === l.pivot) E(`${w}: from e pivot devono essere assi diversi`);
    if (l.fromAt  !== undefined && !isVec(l.fromAt,  3)) E(`${w}: "fromAt" deve avere 3 elementi`);
    if (l.pivotAt !== undefined && !isVec(l.pivotAt, 3)) E(`${w}: "pivotAt" deve avere 3 elementi`);
    // "to" è accettato ma ignorato (retrocompatibilità): non serve più
  },

  resolve(M, { ev, vec }) {
    for (const l of MACHINE.links) {
      if (l.type !== 'rod_GK' || !isActive(l)) continue;
      CTX.where = `link rod_GK ${l.from} → pivot ${l.pivot}`;

      const from  = M.axisBy[l.from];
      const pivot = M.axisBy[l.pivot];
      const rod   = l.rod ? M.axisBy[l.rod] : null;

      if (!from)  throw new Error(`rod_GK: from "${l.from}" non esiste`);
      if (!pivot) throw new Error(`rod_GK: pivot "${l.pivot}" non esiste`);
      if (l.rod && !rod) throw new Error(`rod_GK: rod "${l.rod}" non esiste`);

      let length;
      if (l.length !== undefined) {
        length = ev(l.length);
        if (!Number.isFinite(length) || length <= 0)
          throw new Error(`rod_GK: "length" non valida (${l.length})`);
      } else {
        length = 50;
        step('rod_GK', `length non specificata, uso ${length} mm`);
      }

      const fromAt  = l.fromAt  !== undefined ? vec(l.fromAt)  : [0, 0, 0];
      const pivotAt = l.pivotAt !== undefined ? vec(l.pivotAt) : [0, 1, 0];

      // congela il basis a theta=0 del pivot
      const dir = V.unit(pivot.dir);
      let ref0 = pivot.ref ? V.unit(V.perp(pivot.ref, dir)) : V.anyPerp(dir);
      if (V.len(ref0) < 1e-8) ref0 = V.anyPerp(dir);
      let yv0 = pivot.yv ? V.unit(V.perp(pivot.yv, dir)) : V.cross(dir, ref0);
      if (V.len(yv0) < 1e-8) yv0 = V.cross(dir, ref0);
      pivot._rodRef0 = V.unit(ref0);
      pivot._rodYv0  = V.unit(yv0);

      // raggio del punto di attacco nel piano
      const loc = V.add(
        V.add(V.mul(pivot._rodRef0, pivotAt[0]), V.mul(pivot._rodYv0, pivotAt[1])),
        V.mul(dir, pivotAt[2])
      );
      const R = V.len(V.perp(loc, dir));
      if (R < 1e-3)
        warn('rod_GK', `pivotAt quasi sull'asse di ${pivot.id}: raggio ${fmt(R, 3)} mm — il bilanciere non può ruotare utilmente`);

      if (rod) rod.aimed = true;

      const wantRodVisual = !rod && l.rodVisual !== false;

      M.rods_GK.push({
        def: l,
        from, pivot, rod,
        length, fromAt, pivotAt,
        wantRodVisual,
        prevTheta: pivot.theta || 0,
        last: null,
        rodMesh: null,
        marker: null
      });

      step('rod_GK',
        `L=${fmt(length, 1)} mm · from=${from.id} at [${fromAt.map(x => fmt(x, 1)).join(',')}]` +
        ` · pivot=${pivot.id} at [${pivotAt.map(x => fmt(x, 1)).join(',')}] r=${fmt(R, 1)} mm` +
        (rod ? ` · rod=${rod.id}` : ''));
    }
  },

  afterIntegrate(M) {
    if (!M.rods_GK || !M.rods_GK.length) return;
    const cache = new Map();
    for (const q of M.rods_GK) {
      const r = solveRodGK(q, cache);
      applyRodGK(q, r);
    }
  },

  afterPose(M) {
    if (!M.rods_GK || !M.rods_GK.length) return;
    const cache = new Map();
    for (const q of M.rods_GK) {
      const r = solveRodGK(q, cache);
      applyRodGK(q, r);
    }
  }
});

/* >>>>> types/links/rope/create.js */
/* =====================================================================
   types/links/rope/create.js
   Fune con peso (link "rope"): si avvolge su un asse
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
Registry.link('rope', {
  order: { build: 20, afterPose: 20 },

  build(M, { inGroup }) {
    for (const r of M.ropes) {
      r.rope = BABYLON.MeshBuilder.CreateCylinder('rope', { height: 1, diameter: 4, tessellation: 12 }, scene);
      r.weight = BABYLON.MeshBuilder.CreateCylinder('weight', { height: 30, diameter: 24, tessellation: 24 }, scene);
      r.rope.material = material('#5a4630'); r.weight.material = material('#6b7280');
      r.rope.isPickable = r.weight.isPickable = false; r.top = V.toB(r.at);
      M.extras.push(r.rope, r.weight); inGroup(r.def.group, r.rope); inGroup(r.def.group, r.weight);
      step('scena', `fune su ${r.def.axis}: fune e peso creati`);
    }
  },

  /* A ogni frame: la lunghezza della fune segue l'angolo dell'asse (len0 + raggio·θ, fra min e max) */
  afterPose(M) {
    for (const r of M.ropes) {
      const len = Math.min(r.def.max, Math.max(r.def.min, r.def.len0 + r.radius * M.axes[r.idx].theta));
      r.rope.scaling.y = len;
      r.rope.position.set(r.top[0], r.top[1] - len / 2, r.top[2]);
      r.weight.position.set(r.top[0], r.top[1] - len - 15, r.top[2]);
    }
  }
});

/* >>>>> types/links/rope/solve.js */
/* =====================================================================
   types/links/rope/solve.js
   Fune con peso (link "rope")
   Metà "COME SI RISOLVE" del link: validazione, risoluzione, cinematica. Gli oggetti grafici sono in create.js.
   ===================================================================== */
Registry.link('rope', {
  collection: 'ropes',

  validate(l, w, { E, ax, isVec }) {
    ax(l.axis, 'axis');
    if (!isVec(l.at, 3)) E(`${w}: "at" deve avere 3 elementi`);
    for (const k of ['radius', 'len0', 'min', 'max']) if (l[k] === undefined) E(`${w}: manca "${k}"`);
  },

  // la fune non impone vincoli cinematici: la sua lunghezza dipende solo dall'angolo dell'asse
  resolve(M, { ev, vec }) {
    for (const l of activeLinks('rope')) {
      CTX.where = `link rope`;
      M.ropes.push({ def: l, idx: M.axisBy[l.axis].idx, at: vec(l.at), radius: ev(l.radius) });
      step('link', `fune su ${l.axis}`);
    }
  }
});

/* >>>>> types/links/slider_GK/create.js */
/* =====================================================================
   types/links/slider_GK/create.js
   Biella-manovella + pistone (link "slider_GK")
   Metà "COME SI CREA": marker + eventuale biella visuale di default.
   Se nel link è presente "rod", la geometria della biella è nelle parts
   di quell'asse e qui non si crea alcun mesh della biella.
   ===================================================================== */
Registry.link('slider_GK', {
  order: { build: 30 },

  build(M, { inGroup }) {
    for (const q of M.sliders_GK || []) {
      if (q.def.marker) {
        const r = q.def.marker === true ? 4 : +q.def.marker;
        q.marker = BABYLON.MeshBuilder.CreateSphere('slider_GK_marker', { diameter: 2 * r }, scene);
        q.marker.material = markerMat;
        q.marker.isPickable = false;
        M.extras.push(q.marker);
        inGroup(q.def.group, q.marker);
      }

      // biella di default solo se non c'è un asse "rod" dedicato
      if (q.wantRodVisual) {
        const rodMat = new BABYLON.StandardMaterial('slider_GK_rodMat', scene);
        rodMat.diffuseColor = BABYLON.Color3.FromHexString('#27ae60');
        rodMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        const tess = (q.def.rodSides !== undefined) ? +q.def.rodSides : 6;
        const diam = (q.def.rodDiameter !== undefined) ? +q.def.rodDiameter : 3.2;
        q.rodMesh = BABYLON.MeshBuilder.CreateCylinder('slider_GK_rod', {
          height: 1,
          diameter: diam,
          tessellation: tess
        }, scene);
        q.rodMesh.material = rodMat;
        q.rodMesh.isPickable = false;
        q.rodMesh.setEnabled(false);
        M.extras.push(q.rodMesh);
        inGroup(q.def.group, q.rodMesh);
      }

      step('scena', `slider_GK ${q.crankPin.id}→${q.pistonPin.id}: build ok` +
        (q.rod ? ` (biella = asse ${q.rod.id})` : q.wantRodVisual ? ' (biella visuale default)' : ''));
    }
  }
});

/* >>>>> types/links/slider_GK/solve.js */
/* =====================================================================
   types/links/slider_GK/solve.js
   Biella-manovella + pistone in cilindro (slider-crank)
   ---------------------------------------------------------------------
   JSON:
     { "type": "slider_GK",
       "crankPin":  "axis_Biella",
       "pistonPin": "axis_Pistone_Orizz",
       "cylinder":  "axis_Pistone_Vert",
       "length":    120,
       "piston":    "axis_Pistone",
       "rod":       "axis_Rod",
       "crankOffset": 0,
       "pistonOffset": 0,
       "followers": [                    // assi trasportati dal pistone
         { "axis": "axis_Attacco", "at": [0, 0, 10] }
       ],
       "marker": true
     }

   "followers": ogni asse elencato viene posizionato ogni frame solidale al
   pistone. "at" è il punto locale sul pistone [ref, yv, dir] che diventa
   l'origine del follower. Il follower mantiene la dir del pistone (guida).
   ===================================================================== */

function solveSliderGK(q, cache) {
  const fPin = axisFrame(q.crankPin, cache);
  const pinDir = V.unit(fPin.dir);
  const C = V.add(fPin.O, V.mul(pinDir, q.crankOffset));

  const Q = q.cylinder.O;
  const u = V.unit(q.cylinder.dir);
  const L = q.length;

  const d = V.sub(Q, C);
  const b = 2 * V.dot(d, u);
  const c = V.dot(d, d) - L * L;
  const disc = b * b - 4 * c;

  if (disc < -1e-8) {
    return q.last ? { ...q.last, stale: true } : null;
  }

  const sqrtD = Math.sqrt(Math.max(0, disc));
  const s1 = (-b + sqrtD) / 2;
  const s2 = (-b - sqrtD) / 2;

  let s;
  if (q.prevS == null || !Number.isFinite(q.prevS)) {
    s = s1 >= s2 ? s1 : s2;
  } else {
    s = Math.abs(s1 - q.prevS) <= Math.abs(s2 - q.prevS) ? s1 : s2;
  }
  q.prevS = s;

  const P = V.add(Q, V.mul(u, s));

  let ref = q.prevRef ? V.perp(q.prevRef, pinDir) : V.anyPerp(pinDir);
  if (V.len(ref) < 1e-8) ref = V.anyPerp(pinDir);
  ref = V.unit(ref);
  q.prevRef = ref;

  const rodVec = V.sub(P, C);
  const rodLen = V.len(rodVec);
  const rodDir = rodLen > 1e-9 ? V.mul(rodVec, 1 / rodLen) : (q.last && q.last.rodDir ? q.last.rodDir : [0, 0, 1]);

  let rodRef = V.perp(pinDir, rodDir);
  if (V.len(rodRef) < 1e-8) rodRef = V.anyPerp(rodDir);
  rodRef = V.unit(rodRef);

  q.last = {
    C, P, s,
    pinDir, ref,
    rodDir, rodRef,
    resid: Math.abs(rodLen - L),
    stale: false
  };
  return q.last;
}

function applySliderGK(q, r) {
  if (!r) return;

  // --- perno del pistone ---
  const pinO = V.sub(r.P, V.mul(r.pinDir, q.pistonOffset));
  q.pistonPin.O   = pinO.slice();
  q.pistonPin.dir = r.pinDir.slice();
  q.pistonPin.ref = r.ref.slice();
  q.pistonPin.yv  = V.cross(r.pinDir, r.ref);
  setNodePose(q.pistonPin, { O: pinO, dir: r.pinDir, ref: r.ref });

  // --- corpo del pistone ---
  const pDir = V.unit(q.cylinder.dir);
  let pRef = V.perp(r.ref, pDir);
  if (V.len(pRef) < 1e-8) pRef = V.anyPerp(pDir);
  pRef = V.unit(pRef);
  const pYv = V.cross(pDir, pRef);

  if (q.piston) {
    q.piston.O   = r.P.slice();
    q.piston.dir = pDir.slice();
    q.piston.ref = pRef.slice();
    q.piston.yv  = pYv.slice();
    setNodePose(q.piston, { O: r.P, dir: pDir, ref: pRef });
  }

  // --- follower: assi solidali al pistone ---
  // origine = P + ref·atx + yv·aty + dir·atz  (at nel frame del pistone)
  for (const f of q.followers) {
    const at = f.at;
    const O = V.add(r.P,
      V.add(V.mul(pRef, at[0]),
        V.add(V.mul(pYv, at[1]), V.mul(pDir, at[2]))));
    f.axis.O   = O.slice();
    f.axis.dir = pDir.slice();
    f.axis.ref = pRef.slice();
    f.axis.yv  = pYv.slice();
    setNodePose(f.axis, { O, dir: pDir, ref: pRef });
  }

  // --- asse biella ---
  if (q.rod) {
    q.rod.O   = r.C.slice();
    q.rod.dir = r.rodDir.slice();
    q.rod.ref = r.rodRef.slice();
    q.rod.yv  = V.cross(r.rodDir, r.rodRef);
    setNodePose(q.rod, { O: r.C, dir: r.rodDir, ref: r.rodRef });
  }

  if (q.marker) {
    const p = V.toB(r.P);
    q.marker.position.set(p[0], p[1], p[2]);
    q.marker.setEnabled(true);
  }

  if (q.rodMesh) {
    const mid = V.mul(V.add(r.C, r.P), 0.5);
    const len = Math.max(V.len(V.sub(r.P, r.C)), 1e-6);
    const yM = r.rodDir, xM = r.rodRef, zM = V.cross(xM, yM);
    const xB = V.toB(xM), yB = V.toB(yM), zB = V.toB(zM);
    const p  = V.toB(mid);
    q.rodMesh.position.set(p[0], p[1], p[2]);
    q.rodMesh.rotationQuaternion = Quat.FromRotationMatrix(
      BABYLON.Matrix.FromValues(
        xB[0], xB[1], xB[2], 0,
        yB[0], yB[1], yB[2], 0,
        zB[0], zB[1], zB[2], 0,
        0, 0, 0, 1
      )
    );
    q.rodMesh.scaling.set(1, len, 1);
    q.rodMesh.setEnabled(true);
  }
}


Registry.link('slider_GK', {
  collection: 'sliders_GK',
  order: { afterIntegrate: 40 },

  validate(l, w, { E, ax, axisBy, isVec }) {
    ax(l.crankPin,  'crankPin');
    ax(l.pistonPin, 'pistonPin');
    ax(l.cylinder,  'cylinder');
    if (l.piston) ax(l.piston, 'piston');
    if (l.rod)    ax(l.rod,    'rod');

    if (l.crankPin === l.pistonPin) E(`${w}: crankPin e pistonPin devono essere assi diversi`);
    if (l.crankPin === l.cylinder)  E(`${w}: crankPin e cylinder devono essere assi diversi`);
    if (l.pistonPin === l.cylinder) E(`${w}: pistonPin e cylinder devono essere assi diversi`);

    if (l.followers) {
      if (!Array.isArray(l.followers)) E(`${w}: "followers" deve essere un array`);
      for (const [i, f] of l.followers.entries()) {
        if (!f || typeof f !== 'object') E(`${w}: followers[${i}] non valido`);
        ax(f.axis, `followers[${i}].axis`);
        if (f.at !== undefined && !isVec(f.at, 3)) E(`${w}: followers[${i}].at deve avere 3 elementi`);
      }
    }

    const pp = axisBy[l.pistonPin];
    if (pp && (pp.through !== undefined || pp.alignWith !== undefined))
      E(`${w}: pistonPin "${l.pistonPin}" non può avere "through" né "alignWith"`);
    if (l.piston) {
      const pis = axisBy[l.piston];
      if (pis && (pis.through !== undefined || pis.alignWith !== undefined))
        E(`${w}: piston "${l.piston}" non può avere "through" né "alignWith"`);
    }
    if (l.rod) {
      const rd = axisBy[l.rod];
      if (rd && (rd.through !== undefined || rd.alignWith !== undefined))
        E(`${w}: rod "${l.rod}" non può avere "through" né "alignWith"`);
    }
  },

  resolve(M, { ev, vec }) {
    for (const l of MACHINE.links) {
      if (l.type !== 'slider_GK' || !isActive(l)) continue;
      CTX.where = `link slider_GK ${l.crankPin} → ${l.pistonPin}`;

      const crankPin  = M.axisBy[l.crankPin];
      const pistonPin = M.axisBy[l.pistonPin];
      const cylinder  = M.axisBy[l.cylinder];
      const piston    = l.piston ? M.axisBy[l.piston] : null;
      const rod       = l.rod    ? M.axisBy[l.rod]    : null;

      if (!crankPin)  throw new Error(`slider_GK: crankPin "${l.crankPin}" non esiste`);
      if (!pistonPin) throw new Error(`slider_GK: pistonPin "${l.pistonPin}" non esiste`);
      if (!cylinder)  throw new Error(`slider_GK: cylinder "${l.cylinder}" non esiste`);
      if (l.piston && !piston) throw new Error(`slider_GK: piston "${l.piston}" non esiste`);
      if (l.rod && !rod)       throw new Error(`slider_GK: rod "${l.rod}" non esiste`);

      let length;
      if (l.length !== undefined) {
        length = ev(l.length);
        if (!Number.isFinite(length) || length <= 0)
          throw new Error(`slider_GK: "length" non valida (${l.length})`);
      } else {
        length = V.len(V.sub(pistonPin.O, crankPin.O));
        if (length < 1e-3) length = 100;
        step('slider_GK', `length non specificata, usata distanza iniziale ${fmt(length, 2)} mm`);
      }

      const crankOffset  = l.crankOffset  !== undefined ? ev(l.crankOffset)  : 0;
      const pistonOffset = l.pistonOffset !== undefined ? ev(l.pistonOffset) : 0;

      const followers = [];
      for (const f of (l.followers || [])) {
        const ax = M.axisBy[f.axis];
        if (!ax) throw new Error(`slider_GK: follower "${f.axis}" non esiste`);
        ax.aimed = true;
        followers.push({
          axis: ax,
          at: f.at !== undefined ? vec(f.at) : [0, 0, 0]
        });
      }

      const wantRodVisual = !rod && l.rodVisual !== false;

      pistonPin.aimed = true;
      if (piston) piston.aimed = true;
      if (rod)    rod.aimed = true;

      M.sliders_GK.push({
        def: l,
        crankPin, pistonPin, cylinder, piston, rod,
        length, crankOffset, pistonOffset,
        followers,
        wantRodVisual,
        prevS: null,
        prevRef: null,
        last: null,
        rodMesh: null,
        marker: null
      });

      step('slider_GK',
        `biella L=${fmt(length, 1)} mm · crankPin=${crankPin.id} · pistonPin=${pistonPin.id} · guida=${cylinder.id}` +
        (piston ? ` · pistone=${piston.id}` : '') +
        (rod ? ` · rod=${rod.id}` : wantRodVisual ? ' · rodVisual' : '') +
        (followers.length ? ` · followers=[${followers.map(f => f.axis.id).join(',')}]` : '') +
        ` · crankOffset=${fmt(crankOffset, 1)}`);
    }
  },

  afterIntegrate(M) {
    if (!M.sliders_GK || !M.sliders_GK.length) return;
    const cache = new Map();
    for (const q of M.sliders_GK) {
      const r = solveSliderGK(q, cache);
      applySliderGK(q, r);
    }
  },

  afterPose(M) {
    if (!M.sliders_GK || !M.sliders_GK.length) return;
    const cache = new Map();
    for (const q of M.sliders_GK) {
      const r = solveSliderGK(q, cache);
      applySliderGK(q, r);
    }
  }
});

/* >>>>> types/parts/box/create.js */
/* =====================================================================
   types/parts/box/create.js
   Parte "box"
   Forma di una parte degli assi (axes[].parts[].shape). Un solo file: una parte non ha cinematica, solo geometria.
   ===================================================================== */
Registry.part('box', {
  validate(pt, pw, { E, isVec }) {
    if (!isVec(pt.w, 2)) E(`${pw}: "w" deve avere 2 elementi`);
    if (!isVec(pt.half, 2)) E(`${pw}: "half" deve avere 2 elementi`);
  },
  solid: k => boxSolid(k.w[0], k.w[1], k.at[0], k.at[1], k.half[0], k.half[1])
});

/* >>>>> types/parts/cylinder/create.js */
/* types/parts/cylinder/create.js - pieno / cavo / D con orientamento */
function circle(r,n, ang0){
  const pts=[];
  const a0 = ang0||0;
  for(let i=0;i<n;i++){ const a=a0+2*Math.PI*i/n; pts.push([r*Math.cos(a), r*Math.sin(a)]); }
  return pts;
}
function dCircle(r, flat, n){
  if(!flat) return circle(r,n,0);
  let depth=flat.depth, dist=flat.dist, angDeg=flat.angle!=null?flat.angle:(flat.ang!=null?flat.ang:0);
  // ang in gradi da JSON, convertiamo in rad
  const ang0 = angDeg * Math.PI/180;
  let d = (dist!=null)?dist : (depth!=null)? r-depth : r;
  if(d>=r-1e-9) return circle(r,n,ang0);
  if(d<=-r) return [];
  const a0=Math.asin(Math.max(-1,Math.min(1,d/r)));
  const start=Math.PI - a0, end=2*Math.PI + a0;
  const m=Math.max(n,24);
  const pts=[];
  for(let i=0;i<m;i++){ const ang=start + (end-start)*i/(m-1) + ang0; pts.push([r*Math.cos(ang), r*Math.sin(ang)]); }
  return pts;
}
function wallMesh(outer, inner, w0, w1){
  const P=[], T=[];
  const n=outer.length;
  const Aout = outer.map(p=>[p[0],p[1],w0]);
  const Bout = outer.map(p=>[p[0],p[1],w1]);
  P.push(...Aout, ...Bout);
  for(let i=0;i<n;i++){ const j=(i+1)%n; T.push([i, j, n+j]); T.push([i, n+j, n+i]); }
  if(inner){
    const Ain = inner.map(p=>[p[0],p[1],w0]);
    const Bin = inner.map(p=>[p[0],p[1],w1]);
    const base=P.length;
    P.push(...Ain, ...Bin);
    for(let i=0;i<n;i++){ const j=(i+1)%n; T.push([base+i, base+n+i, base+n+j]); T.push([base+i, base+n+j, base+j]); }
  }
  return {P,T};
}
function ringCapMesh(outer, inner, w){
  const P=[], T=[];
  const n=outer.length;
  const O = outer.map(p=>[p[0],p[1],w]);
  const I = inner.map(p=>[p[0],p[1],w]);
  P.push(...O, ...I);
  for(let i=0;i<n;i++){ const j=(i+1)%n; T.push([i, j, n+j]); T.push([i, n+j, n+i]); }
  return {P,T};
}

Registry.part('cylinder', {
  validate(pt, pw, { E, isVec }){
    if(pt.r===undefined) E(`${pw}: manca "r"`);
    if(!isVec(pt.w,2)) E(`${pw}: "w" deve avere 2 elementi`);
  },
  solid: k => {
    const r=k.r, w0=k.w[0], w1=k.w[1], n=k.n||32;
    const flat=k.flat||null;

    let innerR=null;
    if(k.hollow!==undefined && k.hollow!==null){
      if(typeof k.hollow==='number') innerR=k.hollow;
      else if(typeof k.hollow==='object'){
        if(k.hollow.r!==undefined) innerR=k.hollow.r;
        else if(k.hollow.thickness!==undefined) innerR=r-k.hollow.thickness;
      }
    }

    if(innerR && innerR>0 && innerR<r-1e-6){
      // per cavo, angolo del D non ha senso, ma se c'� flat lo usiamo come D cavo
      let outer, inner;
      if(flat && flat.depth){
        outer = dCircle(r, flat, n);
        inner = dCircle(innerR, flat, n);
      }else{
        const ang0 = (flat && (flat.angle!=null||flat.ang!=null)) ? (flat.angle!=null?flat.angle:flat.ang)*Math.PI/180 : 0;
        outer = circle(r,n,ang0);
        inner = circle(innerR,n,ang0);
      }
      const walls = wallMesh(outer, inner, w0, w1);
      const cap0 = ringCapMesh(outer, inner, w0);
      const cap1 = ringCapMesh(outer, inner, w1);
      const P=[...walls.P, ...cap0.P, ...cap1.P];
      const off1=walls.P.length, off2=off1+cap0.P.length;
      const T=[...walls.T, ...cap0.T.map(t=>t.map(i=>i+off1)), ...cap1.T.map(t=>t.map(i=>i+off2))];
      return {P,T};
    }

    if(flat){
      const prof = dCircle(r, flat, n);
      if(prof.length){
        const A=prof.map(p=>[p[0],p[1],w0]);
        const B=prof.map(p=>[p[0],p[1],w1]);
        return loft(A,B,[0,0,w0],[0,0,w1]);
      }
    }

    return cylinderSolid(r, w0, w1, n, k.at?k.at[0]:0, k.at?k.at[1]:0);
  }
});
/* >>>>> types/parts/prism/create.js */
/* =====================================================================
   types/parts/prism/create.js
   Parte "prism"
   Forma di una parte degli assi (axes[].parts[].shape). Un solo file: una parte non ha cinematica, solo geometria.
   ===================================================================== */
Registry.part('prism', {
  validate(pt, pw, { E }) {
    if (!Array.isArray(pt.poly) || pt.poly.length < 3) E(`${pw}: "poly" deve avere almeno 3 punti`);
  },
  solid: k => prismSolid(k.poly, k.y[0], k.y[1])
});

/* >>>>> core/14-main.js */
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
