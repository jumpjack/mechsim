/* =====================================================================
types/gears/cam_CS/create.js
Camma (type "cam_CS"): profilo definito da una lista di raggi o da segments
Metà "COME SI CREA" del tipo: geometria e mesh. La metà "COME SI RISOLVE" (validazione, parametri) è in solve.js.
===================================================================== */

/* Interpola il raggio per un dato angolo u (in radianti, normalizzato) usando i segments */
function interpolateSegments(angles, radii, u) {
    const m = angles.length;
    // Normalizza u nell'intervallo [angles[0], angles[0] + 2*PI)
    let theta = u % (2 * Math.PI);
    if (theta < 0) theta += 2 * Math.PI;
    
    // Shift rispetto al primo angolo
    let target = theta + angles[0];
    
    // Trova l'intervallo
    for (let i = 0; i < m - 1; i++) {
        if (target >= angles[i] && target <= angles[i+1]) {
            const t = (target - angles[i]) / (angles[i+1] - angles[i]);
            // Per ora usiamo interpolazione lineare tra i segmenti. 
            // Se si desidera una Catmull-Rom su angoli irregolari, andrebbe implementata qui.
            return radii[i] + (radii[i+1] - radii[i]) * t;
        }
    }
    // Fallback (chiusura)
    return radii[m - 1];
}

/* Profilo periodico: n punti [x, y] a angoli phase + i·2π/n (antiorario), nel riferimento locale della camma. */
function camProfile_CS(profileData, n, interp, phase = 0) {
    const P = [];
    
    for (let i = 0; i < n; i++) {
        const angle = phase + 2 * Math.PI * i / n;
        let r;

        if (profileData.type === 'segments') {
            // Interpolazione sui segments (angoli arbitrari)
            r = interpolateSegments(profileData.angles, profileData.radii, angle - phase);
            
            // Se l'utente ha richiesto 'smooth' e ci sono abbastanza punti, 
            // potremmo applicare un filtro o una spline avanzata, ma per angoli non uniformi 
            // l'interpolazione lineare a tratti è la più sicura geometricamente.
        } else {
            // Comportamento legacy (radii equispaziati)
            const radii = profileData.radii;
            const m = radii.length;
            const u = i / n * m;
            const k = Math.floor(u);
            const t = u - k;
            const p0 = radii[(k - 1 + m) % m];
            const p1 = radii[k % m];
            const p2 = radii[(k + 1) % m];
            const p3 = radii[(k + 2) % m];
            
            r = interp === 'linear' 
                ? p1 + (p2 - p1) * t
                : 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);   // Catmull-Rom periodica
        }

        r = Math.max(0.5, r);
        P.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    return P;
}

Registry.gear('cam_CS', {
    solids(g) {
        const c = g.camCS, [w0, w1] = g.w;
        if (!c) return [cylinderSolid(g.r > 0 ? g.r : 10, w0, w1, 64)];
        
        // Genera il poligono a 360 punti per la mesh
        const poly = camProfile_CS(c.profileData, 360, c.interp, c.phase);
        const A = poly.map(([x, y]) => [x, y, w0]);
        const B = poly.map(([x, y]) => [x, y, w1]);
        
        return [loft(A, B, [0, 0, w0], [0, 0, w1])]; // sezione "a stella" rispetto al centro: tappi a ventaglio
    },
    cacheKey: g => [
        g.camCS && [
            g.camCS.profileData.type,
            g.camCS.profileData.radii,
            g.camCS.profileData.angles,
            g.camCS.interp, 
            g.camCS.phase
        ]
    ],
    sigKey: g => []
});