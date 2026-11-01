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
