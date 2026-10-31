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
