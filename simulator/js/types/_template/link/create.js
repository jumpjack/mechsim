/* =====================================================================
   TEMPLATE per un nuovo tipo di LINK — metà "COME SI CREA"
   Copia types/_template/link in types/links/<nome> e sostituisci NOME. Nel JSON: { "type": "<nome>", ... }.
   Se il link non ha parti grafiche lascia questo file con solo il commento.
   ===================================================================== */
Registry.link('NOME', {
  order: { build: 100, afterPose: 100 },      // posizione fra i tipi di link (vedi core/03-registry.js)

  // oggetti Babylon. ctx.inGroup(gruppo, oggetto) li lega al gruppo nel pannello. Aggiungere gli oggetti a M.extras (o M.nodes).
  build(M, { inGroup }) {
    for (const x of M.NOMEs) { /* x.mesh = BABYLON.MeshBuilder.Create...(...); M.extras.push(x.mesh); */ }
  },

  // controlli nel pannello (contenitore #brakes). ctx: el(tag, props, ...figli), box, explainSoon
  // panel(M, { el, box, explainSoon }) { },

  // a ogni frame, a pose aggiornate
  // afterPose(M) { },
});
