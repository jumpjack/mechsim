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
