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
