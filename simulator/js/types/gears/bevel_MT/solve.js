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
