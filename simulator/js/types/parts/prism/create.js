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
