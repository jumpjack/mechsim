/* Punto d'ingresso. Nella pagina HTML, al posto di <script src="script_2.js">, va messo (dopo la definizione di MACHINE e
   di Babylon, e dopo gli script che definiscono step/warn/fail/reportError/CTX/DBG/seenMsgs):

       <script src="js/loader.js"></script>

   Carica il nucleo nell'ordine di manifest.js; i tipi li carica poi il Registry, se servono. Funziona anche aprendo
   la pagina da file:// (nessun modulo ES, nessun fetch). */
(function () {
  const me = document.currentScript;
  const base = me && me.src ? me.src.replace(/[^/]*$/, '') : 'js/';          // cartella di questo file
  window.SIM_BASE = base;
  window.SIM_VER = Date.now();                                                // cambia a ogni caricamento: il browser non usa copie vecchie dei file

  const load = src => new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = base + src + '?v=' + SIM_VER; s.async = false;                                      // classico, in ordine
    s.onload = ok;
    s.onerror = () => ko(new Error(`impossibile caricare ${base}${src}`));
    document.head.appendChild(s);
  });

  (async () => {
    await load('manifest.js');
    for (const f of SIM_CORE) await load(f);
  })().catch(e => {
    console.error('[loader]', e);
    document.body.insertAdjacentHTML('afterbegin', `<pre style="color:#c00;white-space:pre-wrap">Errore di caricamento: ${String(e.message).replace(/</g, '&lt;')}</pre>`);
  });
})();
