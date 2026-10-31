/* =====================================================================
   core/07-kinematics.js
   Cinematica dei corpi: velocità angolare assoluta e velocità dell'origine di ogni asse
   ===================================================================== */
/* =====================================================================
   3b. CINEMATICA DEI CORPI (assi con carrier)
   ---------------------------------------------------------------------
   Per ogni asse i la variabile di velocità è  w_i = Ω_i · dir_i  (componente, lungo l'asse, della velocità
   angolare ASSOLUTA del corpo). La velocità angolare assoluta si compone con quella del carrier c:
        Ω_i = Ω_c + s_i · dir_i ,   s_i = w_i − Ω_c·dir_i   (s_i = velocità RELATIVA al carrier)
   quindi Ω_i = Ω_c − dir_i (dir_i·Ω_c) + w_i dir_i.
   Se l'asse è parallelo al carrier (satelliti) Ω_c·dir = w_c e si ritrova la solita formula  s = w − w_c.
   Se è perpendicolare (asse di declinazione) Ω_c·dir = 0 e s = w: la ruota non "sente" la rotazione del carrier.
   Ω_i e la velocità dell'origine v(O_i) sono forme lineari nelle w_k: le memorizziamo come {k: vettore}.
   ===================================================================== */
function buildKinematics(M) {
  const n = M.axes.length, busy = new Set();
  const visit = a => {
    if (a.Om) return;
    if (busy.has(a)) throw new Error(`catena di carrier circolare attorno all'asse "${a.id}"`);
    busy.add(a);
    const c = a.carrier;
    if (!c) { a.Om = { [a.idx]: a.dir }; a.vO = {}; }
    else {
      visit(c);
      const Om = {}, vO = {}, d = V.sub(a.O, c.O);
      for (const k in c.Om) Om[k] = V.sub(c.Om[k], V.mul(a.dir, V.dot(c.Om[k], a.dir)));
      Om[a.idx] = a.dir;
      for (const k in c.vO) vO[k] = c.vO[k].slice();
      for (const k in c.Om) vO[k] = V.add(vO[k] || [0, 0, 0], V.cross(c.Om[k], d));
      a.Om = Om; a.vO = vO;
    }
    busy.delete(a);
  };
  M.axes.forEach(visit);
  // vincolo "debole" rest:"carrier":  s_i = 0  ⇔  w_i − Ω_c·dir_i = 0  (usato solo se nient'altro determina l'asse)
  for (const a of M.axes) {
    a.soft = null;
    if (a.def.rest === 'carrier' && a.carrier) {
      const r = new Array(n).fill(0);
      r[a.idx] = 1;
      for (const k in a.carrier.Om) r[k] -= V.dot(a.carrier.Om[k], a.dir);
      a.soft = r;
    }   else if (a.def.rest === 'world') { const r = new Array(n).fill(0); r[a.idx] = 1; a.soft = r; }
  }
}

/* velocità (come forma lineare nelle w_k) di un punto P solidale al corpo dell'asse a */
function pointVel(a, P) {
  const out = {}, r = V.sub(P, a.O);
  for (const k in a.vO) out[k] = a.vO[k].slice();
  for (const k in a.Om) out[k] = V.add(out[k] || [0, 0, 0], V.cross(a.Om[k], r));
  return out;
}

/* velocità angolare assoluta (vettore) del corpo dell'asse a, dati i w */
function omegaOf(a, w) {
  let o = [0, 0, 0];
  for (const k in a.Om) o = V.add(o, V.mul(a.Om[k], w[k]));
  return o;
}

/* velocità relative al carrier: s_i = w_i − Ω_carrier·dir_i  (per gli assi senza carrier s_i = w_i) */
function relSpins(M, w) {
  return M.axes.map((a, i) => a.carrier ? w[i] - V.dot(omegaOf(a.carrier, w), a.dir) : w[i]);
}

