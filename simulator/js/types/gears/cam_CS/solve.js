/* =====================================================================
types/gears/cam_CS/solve.js
Camma (type "cam_CS"), da usare con il link "cam_follower_CS"
Metà "COME SI RISOLVE" del tipo: validazione e parametri. Il disegno è in create.js; il contatto col follower è nel link.

Profilo definibile in DUE modi alternativi:
1) "radii": lista di raggi equispaziati in angolo (metodo originale).
2) "segments": lista di oggetti {"x": angolo_in_gradi, "y": raggio_in_mm}, per profili ad angoli arbitrari.

JSON Esempio segments:
{ "id": "camma_CS", "type": "cam_CS", "axis": "...", 
  "segments": [ {"x":0,"y":30}, {"x":90,"y":40}, {"x":180,"y":30}, {"x":270,"y":20} ], 
  "pos": 0, "thickness": 4 }

Facoltativi comuni: "interpolation" ("smooth" o "linear"), "phase" (offset angolare in gradi).
===================================================================== */
Registry.gear('cam_CS', {
    meshWith: [],                // non ingrana
    noRadiusCheck: false,
    
    radius: (g, { ev }) => {
        if (Array.isArray(g.def.segments) && g.def.segments.length) {
            return Math.max(...g.def.segments.map(s => +ev(s.y) || 0));
        }
        if (Array.isArray(g.def.radii) && g.def.radii.length) {
            return Math.max(...g.def.radii.map(r => +ev(r) || 0));
        }
        return 10;
    },

    validate(g, w, { E, isVec }) {
        const hasSeg = Array.isArray(g.segments) && g.segments.length >= 2;
        const hasRad = Array.isArray(g.radii) && g.radii.length >= 3;

        if (!hasSeg && !hasRad) {
            E(`${w}: definire "segments" (almeno 2 punti {x,y}) oppure "radii" (almeno 3 raggi)`);
        } else if (hasSeg && hasRad) {
            E(`${w}: specificare "segments" OPPURE "radii", non entrambi`);
        }

        if (hasSeg) {
            for (let i = 0; i < g.segments.length; i++) {
                const s = g.segments[i];
                if (s === null || typeof s !== 'object') {
                    E(`${w}: "segments[${i}]" deve essere un oggetto {x, y}`); continue;
                }
                if (typeof s.x !== 'number' && typeof s.x !== 'string') E(`${w}: "segments[${i}].x" deve essere un numero o espressione`);
                if (typeof s.y !== 'number' && typeof s.y !== 'string') E(`${w}: "segments[${i}].y" deve essere un numero o espressione`);
            }
        } else if (hasRad) {
            if (!g.radii.every(r => typeof r === 'number' || typeof r === 'string')) {
                E(`${w}: i raggi di "radii" devono essere numeri o espressioni`);
            }
        }

        if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi (oppure "pos" e "thickness")`);
        if (g.interpolation !== undefined && g.interpolation !== 'smooth' && g.interpolation !== 'linear') {
            E(`${w}: "interpolation" deve essere "smooth" o "linear"`);
        }
        if (g.phase !== undefined && typeof g.phase !== 'number' && typeof g.phase !== 'string') {
            E(`${w}: "phase" deve essere un numero (gradi)`);
        }
    },

    /* Raggi valutati (gli slider possono comparire nelle espressioni) e profilo fisico, usato dal link per il contatto. */
    resolve(g, { ev }) {
        const d = g.def;
        const interp = d.interpolation || 'smooth';
        const phase = (d.phase !== undefined ? ev(d.phase) : 0) * Math.PI / 180;
        
        let profileData;
        let infoStr = '';

        if (Array.isArray(d.segments) && d.segments.length >= 2) {
            // Valuta le espressioni nei segments
            const segs = d.segments.map(s => ({ x: ev(s.x), y: ev(s.y) }));
            
            // Ordina per angolo crescente
            segs.sort((a, b) => a.x - b.x);
            
            if (!segs.every(s => s.y > 0)) throw new Error(`${g.id}: tutti i raggi (y) nei segments devono essere positivi`);

            // Normalizza gli angoli in radianti e gestisci la periodicità
            const angles = segs.map(s => s.x * Math.PI / 180);
            const radii = segs.map(s => s.y);
            
            // Se il profilo non copre esattamente 360° o se l'ultimo punto non coincide col primo, chiudilo
            const totalSpan = angles[angles.length - 1] - angles[0];
            if (Math.abs(totalSpan - 2 * Math.PI) > 1e-6 && Math.abs(totalSpan - 360 * Math.PI / 180) > 1e-6) {
                // Aggiungi implicitamente il primo punto alla fine per garantire la chiusura a 360°
                angles.push(angles[0] + 2 * Math.PI);
                radii.push(radii[0]);
            }

            profileData = { type: 'segments', angles, radii };
            infoStr = `, camma: ${segs.length} segmenti`;
        } else {
            // Comportamento legacy (radii equispaziati)
            const radii = d.radii.map(r => ev(r));
            if (!radii.every(r => r > 0)) throw new Error(`${g.id}: tutti i raggi devono essere positivi`);
            profileData = { type: 'radii', radii };
            infoStr = `, camma: ${radii.length} raggi (${Math.min(...radii)}…${Math.max(...radii)} mm)`;
        }

        const rmax = Math.max(...(profileData.radii));
        g.camCS = { 
            profileData, 
            interp, 
            phase, 
            poly: camProfile_CS(profileData, 720, interp, phase), 
            rmax 
        };
        
        return infoStr;
    }
});