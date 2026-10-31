/* =====================================================================
   types/parts/cylinder/create.js
   Parte "cylinder"
   Forma di una parte degli assi (axes[].parts[].shape). Un solo file: una parte non ha cinematica, solo geometria.
   ===================================================================== */
Registry.part('cylinder', {
  validate(pt, pw, { E, isVec }) {
    if (pt.r === undefined) E(`${pw}: manca "r"`);
    if (!isVec(pt.w, 2)) E(`${pw}: "w" deve avere 2 elementi`);
  },
  solid: k => cylinderSolid(k.r, k.w[0], k.w[1], k.n, k.at[0], k.at[1])      // cylinderSolid: core/04-geometry.js
});
