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
          return ev(val); // Valuta la stringa (es. "pendulumLength") tramite l'evaluator del motore
        } catch (e) {
          const parsed = parseFloat(val);
          return isNaN(parsed) ? defVal : parsed;
        }
      }
      return defVal;
    };

    // Assegna e salva i valori risolti sull'ingranaggio g
    g.pendLen = evalParam(g.def?.pendulumLength ?? g.def?.pendLen, 160);
    g.armLen  = evalParam(g.def?.armLen, 38);
    g.span    = evalParam(g.def?.span, 90);
    g.palletW = evalParam(g.def?.palletW, 10);
    g.palletH = evalParam(g.def?.palletH, 8);
    g.bobR    = evalParam(g.def?.bobR, 14);
  }
});