/* =====================================================================
   types/links/hooke/create.js
   Snodo di Hooke (link "hooke"): crociera e forcelle
   Metà "COME SI CREA" del link: oggetti Babylon e controlli. La metà "COME SI RISOLVE" (validazione, cinematica) è in solve.js.
   ===================================================================== */
function createHooke(
    M,
    axis1,
    axis2,
    axis1side = 1,
    axis2side = 1,
    axis1rotate = false,
    leaderAxis = null,
    armDef = null
) {
    const arm = {
        r: armDef?.r ?? 2.3,
        len: armDef?.len ?? 13
    };

    const { r, len } = arm;
    const sceneRef = scene;

    // --------------------------------------------------
    // Utility geometriche
    // --------------------------------------------------

    const V3B = (v) => {
        const b = V.toB(v);
        return toV3(b);
    };

    const worldCenter = (v) => V3B(v);

// Estremi del cilindro che rappresenta l'albero.
// Se ci sono altri cilindri, ad esempio i marker, viene scelto
// quello con la maggiore estensione lungo Z.
const getAxisBounds = (axis) => {
    let shaft = null;

    for (const p of axis.def.parts || []) {
        if (
            !isActive(p) ||
            p.shape !== "cylinder" ||
            !Array.isArray(p.w)
        ) {
            continue;
        }

        // Risolve anche estremi espressi con formule o variabili.
        const { key } = resolvePart(p, M.ev);

        if (!Array.isArray(key.w) || key.w.length < 2) {
            continue;
        }

        const z0 = Number(key.w[0]);
        const z1 = Number(key.w[1]);

        if (!Number.isFinite(z0) || !Number.isFinite(z1)) {
            continue;
        }

        const candidate = {
            minZ: Math.min(z0, z1),
            maxZ: Math.max(z0, z1),
            length: Math.abs(z1 - z0)
        };

        if (!shaft || candidate.length > shaft.length) {
            shaft = candidate;
        }
    }

    if (!shaft || shaft.length < 1e-8) {
        throw new Error(
            `Impossibile trovare il cilindro dell'albero ${axis.id}`
        );
    }

    return {
        minZ: shaft.minZ,
        maxZ: shaft.maxZ
    };
};


// Coordinata lungo l'albero del punto di intersezione.
const shaftCoordinate = (axis, point) => {
    return V.dot(
        V.sub(point, axis.O),
        V.unit(axis.dir)
    );
};


// Sceglie automaticamente l'estremità più vicina
// al punto d'intersezione degli assi.
const getSideZ = (axis, intersection) => {
    const { minZ, maxZ } = getAxisBounds(axis);
    const centerZ = shaftCoordinate(axis, intersection);

    const distanceMin = Math.abs(centerZ - minZ);
    const distanceMax = Math.abs(centerZ - maxZ);

    return distanceMin <= distanceMax ? minZ : maxZ;
};

    const getWorldMatrix = (node) => {
        node.computeWorldMatrix(true);
        return node.getWorldMatrix();
    };

    const worldToLocal = (node, worldPoint) => {
        const inv = getWorldMatrix(node).clone();
        inv.invert();

        return BABYLON.Vector3.TransformCoordinates(worldPoint, inv);
    };

    const makeBox = (name, dimensions, parent, position, color) => {
        const mesh = BABYLON.MeshBuilder.CreateBox(
            name,
            dimensions,
            sceneRef
        );

        mesh.material = material(color);
        mesh.parent = parent;
        mesh.position.copyFrom(position);
        mesh.isPickable = false;

        return mesh;
    };

    // --------------------------------------------------
    // Punto di intersezione / minima distanza
    // --------------------------------------------------

    const getIntersection = (O1, D1, O2, D2) => {
        const w0 = V.sub(O1, O2);

        const a = V.dot(D1, D1);
        const b = V.dot(D1, D2);
        const c = V.dot(D2, D2);
        const d = V.dot(D1, w0);
        const e = V.dot(D2, w0);

        const denom = a * c - b * b;

        if (Math.abs(denom) < 1e-8) {
            // Assi paralleli: non esiste un'intersezione unica.
            // Usiamo il punto sull'asse 1 più vicino all'asse 2.
            const t = a > 1e-8 ? -d / a : 0;
            return V.add(O1, V.mul(D1, t));
        }

        const t = (b * e - c * d) / denom;
        const u = (a * e - b * d) / denom;

        const P1 = V.add(O1, V.mul(D1, t));
        const P2 = V.add(O2, V.mul(D2, u));

        return V.mul(V.add(P1, P2), 0.5);
    };

    const center = getIntersection(
        axis1.O, axis1.dir,
        axis2.O, axis2.dir
    );

// --------------------------------------------------
// DIREZIONE DEI DUE PERNI DELLA CROCIERA
// --------------------------------------------------

const d1 = V.unit(axis1.dir);
const d2 = V.unit(axis2.dir);

// Direzione del perno associato al primo albero.
const bendRaw = V.perp(d2, d1);

if (V.len(bendRaw) < 1e-8) {
    throw new Error(
        `Impossibile orientare lo snodo di Hooke: ` +
        `gli assi ${axis1.id} e ${axis2.id} sono paralleli`
    );
}

const pinDir1 = V.unit(bendRaw);

// Direzione del perno associato al secondo albero.
// È la stessa direzione usata da orientCross per yp.
const pinDir2 = V.unit(V.cross(d1, pinDir1));

    const centerWorld = worldCenter(center);
    const jointName = `hooke_${axis1.id}_${axis2.id}`;

    // --------------------------------------------------
    // CROCIERA CENTRALE
    // --------------------------------------------------

    const cross = new BABYLON.TransformNode(
        `cross_${axis1.id}_${axis2.id}`,
        sceneRef
    );

    cross.position.copyFrom(centerWorld);
    cross.rotationQuaternion = BABYLON.Quaternion.Identity();

    // Due perni ortogonali nel riferimento della crociera.
    // I cilindri sono centrati nel punto d'intersezione.
    const crossArm1 = BABYLON.MeshBuilder.CreateCylinder(
        `${jointName}_pin1`,
        {
            height: 2 * len,
            diameter: 2 * r,
            tessellation: 24
        },
        sceneRef
    );

    crossArm1.material = material("#00ff00");
    crossArm1.parent = cross;
    crossArm1.isPickable = false;

    const crossArm2 = BABYLON.MeshBuilder.CreateCylinder(
        `${jointName}_pin2`,
        {
            height: 2 * len,
            diameter: 2 * r,
            tessellation: 24
        },
        sceneRef
    );

    crossArm2.material = material("#00ff00");
    crossArm2.rotation.z = Math.PI / 2;
    crossArm2.parent = cross;
    crossArm2.isPickable = false;

    const core = BABYLON.MeshBuilder.CreateBox(
        `${jointName}_core`,
        { size: 2 * r },
        sceneRef
    );

    core.material = material("#ffff00");
    core.parent = cross;
    core.isPickable = false;

    // --------------------------------------------------
    // CREA UNA FORCELLA SULL'ESTREMITÀ SCELTA
    // --------------------------------------------------

const createYoke = (axis, pinDir, suffix, color) => {
    if (!axis.frame) {
        throw new Error(
            `L'asse ${axis.id} non possiede axis.frame`
        );
    }

    // Estremità dell'albero più vicina alla crociera.
    const endZ = getSideZ(axis, center);

    const yoke = new BABYLON.TransformNode(
        `yoke${suffix}_${axis.id}`,
        sceneRef
    );

    yoke.parent = axis.frame;
    yoke.position.set(0, 0, endZ);

    // --------------------------------------------------
    // ROTAZIONE AUTOMATICA ATTORNO ALL'ALBERO
    // --------------------------------------------------

    // Gli assi locali X e Y del frame corrispondono
    // rispettivamente a axis.ref e axis.yv.
    const localX = V.dot(pinDir, axis.ref);
    const localY = V.dot(pinDir, axis.yv);

    // Orienta l'asse X della forcella lungo il perno.
    const roll = Math.atan2(localY, localX);

    yoke.rotationQuaternion =
        BABYLON.Quaternion.RotationAxis(
            BABYLON.Axis.Z,
            roll
        );

    // Distanza assiale tra l'estremità e la crociera.
    const dz = shaftCoordinate(axis, center) - endZ;

    // --------------------------------------------------
    // GEOMETRIA DELLA FORCELLA: INVARIATA
    // --------------------------------------------------

    const forkLength = Math.max(r, Math.abs(dz));
    const middleZ = dz / 2;

    const forkOffset = 2.5 * r;
    const forkThickness = 1.5 * r;
    const forkWidth = 5 * r;

    const forkLeft = makeBox(
        `fork${suffix}Left_${axis.id}`,
        {
            width: forkThickness,
            height: forkWidth,
            depth: forkLength + 10
        },
        yoke,
        new BABYLON.Vector3(
            -2 * forkOffset,
            0,
            middleZ
        ),
        color
    );

    const forkRight = makeBox(
        `fork${suffix}Right_${axis.id}`,
        {
            width: forkThickness,
            height: forkWidth,
            depth: forkLength + 10
        },
        yoke,
        new BABYLON.Vector3(
            2 * forkOffset,
            0,
            middleZ
        ),
        color
    );

    const forkBase = makeBox(
        `fork${suffix}Base_${axis.id}`,
        {
            width: 4 * forkOffset + forkThickness,
            height: forkWidth,
            depth: 2 * r
        },
        yoke,
        new BABYLON.Vector3(0, 0, 0),
        color
    );

    return {
        yoke,
        forkLeft,
        forkRight,
        forkBase
    };
};

const result1 = createYoke(
    axis1,
    pinDir1,
    "1",
    "#2f6fe0"
);

const result2 = createYoke(
    axis2,
    pinDir2,
    "2",
    "#d4262e"
);

    return {
        cross,
        yoke1: result1.yoke,
        yoke2: result2.yoke
    };
}

function orientCross(h, phi) {
  const psi = hookePsi(h, phi), din = M.axes[h.inIdx].dir, yp = V.cross(din, h.bend);
  const A = V.add(V.mul(h.bend, cos(phi)), V.mul(yp, sin(phi)));
  const e1 = V.sub(V.mul(h.bend, h.cb), V.mul(din, h.sb));
  const B = V.add(V.mul(e1, -sin(psi)), V.mul(yp, cos(psi)));
  const nn = V.cross(A, B), a = V.toB(A), b = V.toB(B), c = V.toB(nn);
  h.cross.rotationQuaternion = Quat.FromRotationMatrix(BABYLON.Matrix.FromValues(
    a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, 0, 0, 0, 1));
}

Registry.link('hooke', {
  order: { build: 40, afterPose: 10 },

  build(M, { inGroup }) {
    for (const h of M.hookes) {
      const axis1 = M.axes[h.inIdx];
      const axis2 = M.axes[h.outIdx];

      // NOTA: h.def.arm finisce nel parametro "axis1side" di createHooke (come nel codice originale), quindi le
      // dimensioni della crociera restano quelle di default (r=2.3, len=13). Per usarle davvero servirebbe passare
      // h.def.arm come ultimo parametro (armDef): non l'ho cambiato per non alterare l'aspetto delle macchine esistenti.
      const result = createHooke(M, axis1, axis2, h.def.arm);

      h.cross = result.cross;
      h.yoke1 = result.yoke1;
      h.yoke2 = result.yoke2;
      M.nodes.push(result.cross, result.yoke1, result.yoke2);
      inGroup(h.def.group, result.cross);
      inGroup(h.def.group, result.yoke1);
      inGroup(h.def.group, result.yoke2);
      step('scena', `snodo di Hooke ${h.def.input} → ${h.def.output}: crociera e forcelle create`);
    }
  },

  afterPose(M) {
    for (const h of M.hookes) orientCross(h, M.axes[h.inIdx].theta);
  }
});
