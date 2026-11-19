/* NOTA BECCO - leggi qui prima di toccare altro:
   Il becco della foto NON e un nuovo tipo di contatto. E contact = "tip"
   con sideOffset diverso da 0 e tipShift piccolo.
   Esempio becco in basso (foto): sideOffset = -12, tipShift = 6
     -> tipPoint = [L - 6, -12] = [172, -12] se L = 178
   Esempio becco in alto: sideOffset = +12, tipShift = 6
   La forma a becco si ottiene SOLO da tipPoint. Non esistono piu
   beakH / beakX / beakW / beakSide: se li vedi in un vecchio file, cancellali.
   Regola d'oro: tipPoint e l'UNICA fonte di verita. create.js lo disegna,
   il link lo usa per il contatto. Non spostarlo mai in un solo posto.
*/
/* =====================================================================
   types/gears/follower_CS/solve.js
   Follower (type "follower_CS"): asta uniforme che ruota attorno a un estremo
   (il suo asse), appoggiata a una camma con la punta oppure con un lato piatto.
   Meta "COME SI RISOLVE" del tipo: validazione e parametri.
   Il disegno e in create.js; dinamica e contatto sono nel link "cam_follower_CS".

   JSON minimo:
   {
     "id": "follower_CS",
     "type": "follower_CS",
     "axis": "...",
     "length": 74,
     "pos": 0,
     "thickness": 4
   }

   OBBLIGATORI:
     "length"    lunghezza dell'asta in mm (dal fulcro al vertice nominale).
     posizione e spessore ("w" oppure "pos"+"thickness").

   FACOLTATIVI (numeri o espressioni, tranne "contact"):
     "angle"      direzione iniziale dell'asta, gradi, rispetto alla retta
                  fulcro verso centro camma (default 0).
     "width"      larghezza dell'asta, mm (4).
     "mass"       massa dell'asta (1).
     "hubRadius"  raggio del mozzo, mm (5).

     "contact"    come segue il profilo:
                    "tip"   = punta (default)
                    "side1" = lato 1 (y = +width/2)
                    "side2" = lato 2 (y = -width/2)
                  Accettati anche 0/1/2 e "punta", "lato1", "lato2".
                  Alias vecchi: "mode" (stessi valori) e "side" (1 oppure -1).

     "sideOffset" OBBLIGATORIO se contact = "tip", e deve essere diverso da 0.
                  Offset laterale della punta rispetto all'asse dell'asta, mm:
                    > 0   punta sul lato locale +Y
                    < 0   punta sul lato locale -Y
                  Con contact "side1"/"side2" viene ignorato.

     "tipShift"   facoltativo, solo se contact = "tip": di quanti mm il vertice
                  della punta ARRETRA lungo l'asse dell'asta (0 = vertice a x = L).
                  E la "punta arretrata": vertice della mesh e punto di contatto
                  si spostano INSIEME, quindi nulla si disallinea.
                  Vincolo: 0 <= tipShift <= L - tip (oltre, il naso sparirebbe).

   PUNTO LOCALE DELLA PUNTA (tipPoint), regola d'oro:
     solve.js lo calcola UNA volta sola e lo salva in g.followerCS.tipPoint:
       contact "tip"    ->  [L - tipShift, sideOffset]
       contact "side*"  ->  [L, 0]  (non usato, la punta e piatta)
     create.js disegna il vertice della mesh ESATTAMENTE in tipPoint;
     il link "cam_follower_CS" calcola il contatto ESATTAMENTE in tipPoint.
     Il vertice della mesh e il punto di contatto: non va mai spostato
     in uno solo dei due posti, altrimenti la camma penetra o si stacca.

   FOLLOWER SOLIDALI: piu follower_CS sullo stesso asse sono un corpo solo
   (si sommano coppie e inerzie, ognuno puo toccare la propria camma); una
   ruota qualsiasi sullo stesso asse segue il follower e trascina, attraverso
   gli ingranamenti, tutto cio che e ingranato con lei.
   ===================================================================== */

Registry.gear('follower_CS', {
    meshWith: [],
    noRadiusCheck: true,

    radius: (g, { ev }) => {
        return g.def.length !== undefined ? ev(g.def.length) : 10;
    },

    validate(g, w, { E, isVec }) {
        if (g.length === undefined) {
            E(`${w}: manca "length" (lunghezza dell'asta, mm)`);
        }

        if (!isVec(g.w, 2)) {
            E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
        }

        for (const k of ['length', 'angle', 'width', 'mass', 'hubRadius', 'sideOffset', 'tipShift']) {
            if (g[k] !== undefined && typeof g[k] !== 'number' && typeof g[k] !== 'string') {
                E(`${w}: "${k}" deve essere un numero o un'espressione`);
            }
        }

        if (g.contact !== undefined && typeof g.contact !== 'string' && typeof g.contact !== 'number') {
            E(`${w}: "contact" deve essere "tip", "side1" oppure "side2" (oppure 0, 1, 2)`);
        }

        if (g.mode !== undefined && typeof g.mode !== 'string' && typeof g.mode !== 'number') {
            E(`${w}: "mode" deve essere "tip", "side1" oppure "side2"`);
        }

        if (
            g.side !== undefined &&
            g.side !== 1 && g.side !== -1 &&
            g.side !== '1' && g.side !== '-1'
        ) {
            E(`${w}: "side" deve essere 1 oppure -1`);
        }
    },

    resolve(g, { ev }) {
        const d = g.def;
        const num = (v, def) => (v !== undefined ? ev(v) : def);

        /* ---- 1. Lunghezza dell'asta ---- */
        const L = ev(d.length);
        if (!(L > 0) || !Number.isFinite(L)) {
            throw new Error(`${g.id}: "length" deve essere positiva e finita`);
        }

        /* ---- 2. Sezione e naso della punta ---- */
        const width = num(d.width, 4);
        const hw = width / 2;
        const tipLen = Math.min(Math.max(width * 3, 6), L * 0.35);

        /* ---- 3. Tipo di contatto: tip / side1 / side2 ---- */
        let contact = 'tip';
        const raw = d.contact !== undefined ? d.contact : d.mode;

        if (raw !== undefined) {
            if (typeof raw === 'number') {
                if (raw === 0) contact = 'tip';
                else if (raw === 1) contact = 'side1';
                else if (raw === 2) contact = 'side2';
                else {
                    throw new Error(`${g.id}: "contact" deve essere "tip", "side1" oppure "side2" (oppure 0, 1, 2)`);
                }
            } else if (typeof raw === 'string') {
                const s = raw.trim().toLowerCase().replace(/\s+/g, '');
                if (s === 'tip' || s === 'punta' || s === '0') contact = 'tip';
                else if (s === 'side1' || s === 'lato1' || s === '1') contact = 'side1';
                else if (s === 'side2' || s === 'lato2' || s === '2') contact = 'side2';
                else {
                    throw new Error(`${g.id}: "contact" deve essere "tip", "side1" oppure "side2"`);
                }
            } else {
                throw new Error(`${g.id}: "contact" deve essere "tip", "side1" oppure "side2"`);
            }
        } else if (d.side !== undefined) {
            if (d.side === 1 || d.side === '1') contact = 'side1';
            else if (d.side === -1 || d.side === '-1') contact = 'side2';
            else {
                throw new Error(`${g.id}: "side" deve essere 1 oppure -1`);
            }
        }

        const side = contact === 'side1' ? 1 : contact === 'side2' ? -1 : 0;
        const flatTip = contact !== 'tip';

        /* ---- 4. sideOffset: con "tip" la punta DEVE sporgere da un lato ---- */
        let sideOffset = 0;

        if (!flatTip) {
            if (d.sideOffset === undefined) {
                throw new Error(
                    `${g.id}: con contact "tip" serve "sideOffset" (mm, diverso da zero): ` +
                    `positivo = lato +Y, negativo = lato -Y`
                );
            }

            sideOffset = ev(d.sideOffset);

            if (!Number.isFinite(sideOffset)) {
                throw new Error(`${g.id}: "sideOffset" deve essere un numero finito`);
            }

            if (!(Math.abs(sideOffset) > 1e-9)) {
                throw new Error(
                    `${g.id}: "sideOffset" non puo essere 0 con contact "tip": ` +
                    `la punta deve sporgere da un lato dell'asta`
                );
            }
        } else {
            // Con i lati, sideOffset e ignorato: lo azzero per non lasciare un valore spurio in g.followerCS.
            sideOffset = 0;
        }

        /* ---- 5. tipShift: arretramento del vertice lungo l'asse ---- */
        let tipShift = 0;

        if (!flatTip && d.tipShift !== undefined) {
            tipShift = ev(d.tipShift);

            if (!Number.isFinite(tipShift)) {
                throw new Error(`${g.id}: "tipShift" deve essere un numero finito`);
            }

            if (!(tipShift >= 0)) {
                throw new Error(`${g.id}: "tipShift" deve essere maggiore o uguale a 0`);
            }

            if (tipShift > L - tipLen) {
                throw new Error(
                    `${g.id}: "tipShift" troppo grande (${+tipShift.toFixed(1)} mm): ` +
                    `il vertice arretrerebbe oltre l'attacco del naso ` +
                    `(massimo ${+(L - tipLen).toFixed(1)} mm)`
                );
            }
        } else {
            // Con i lati, tipShift e ignorato.
            tipShift = 0;
        }

        /* ---- 6. Punto locale della punta: UNICA fonte di verita ---- */
        /* create.js ci disegna il vertice della mesh; il link ci calcola il contatto. */
        const tipPoint = flatTip ? [L, 0] : [L - tipShift, sideOffset];

        /* ---- 7. Parametri passati a create.js e al link ---- */
        const Lside = flatTip ? L : L - tipLen;

        g.followerCS = {
            L,
            angle: num(d.angle, 0),
            width,
            mass: num(d.mass, 1),
            hubR: num(d.hubRadius, 5),
            contact,
            side,
            hw,
            tip: tipLen,
            Lside,
            flatTip,
            sideOffset,
            tipShift,
            tipPoint
        };

        /* ---- 8. Stringa di info per il log ---- */
        const label = contact === 'tip'
            ? 'punta'
            : contact === 'side1'
                ? 'lato 1'
                : 'lato 2';

        const parts = [`follower lungo ${+L.toFixed(1)} mm`, label];

        if (!flatTip) {
            parts.push(`offset ${sideOffset > 0 ? '+' : ''}${+sideOffset.toFixed(2)} mm`);
            if (tipShift > 0) parts.push(`punta arretrata ${+tipShift.toFixed(1)} mm`);
        }

        return `, ${parts.join(', ')}`;
    }
});
