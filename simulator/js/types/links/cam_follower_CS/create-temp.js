/* =====================================================================
   types/links/cam_follower_CS/create.js
   Camma e follower (link "cam_follower_CS")
   Metà "COME SI CREA" del link: oggetti grafici. Camma e follower li disegnano i gear cam_CS e follower_CS; qui c'è solo la molla
   (una spezzata a zig-zag fra i due assi, aggiornata a ogni frame; blu se tesa, rossa se compressa).
   ===================================================================== */
const SPRING_SEGMENTS = 14;
const SPRING_RADIUS = 1;
const SPRING_TESSELLATION = 6;
const COLOR_COMPRESSED = BABYLON.Color3.FromHexString('#0000ff'); // rosso
const COLOR_TENSED = BABYLON.Color3.FromHexString('#ff0000');    // blu

Registry.link('cam_follower_CS', {
  order: { build: 100, afterPose: 100 },

  build(M, { inGroup }) {
    for (const G of (M.camGroupsCS || [])) for (const s of G.springs) {
      const pts = Array.from({ length: SPRING_SEGMENTS + 1 }, () => new BABYLON.Vector3(0, 0, 0));
      s.mesh = BABYLON.MeshBuilder.CreateTube('molla_CS', {
        path: pts,
        radius: SPRING_RADIUS,
        tessellation: SPRING_TESSELLATION,
        updatable: true
      }, scene);
      s.mesh.isPickable = false;

      const mat = new BABYLON.StandardMaterial('molla_mat_' + s.mesh.uniqueId, scene);
      mat.diffuseColor = COLOR_TENSED.clone();
      mat.emissiveColor = COLOR_TENSED.clone();
      s.mesh.material = mat;

      M.extras.push(s.mesh); inGroup(s.link.group, s.mesh);
    }
  },

  afterPose(M) {
    for (const G of (M.camGroupsCS || [])) for (const s of G.springs) if (s.mesh) {
      const world = (e, th) => { const p = CamCS.endPos(e, th); return V.add(V.add(V.add(G.axF.O, V.mul(G.X, p[0])), V.mul(G.Y, p[1])), V.mul(G.k, e.axial)); };
      const a = world(s.a, G.st.th), b = world(s.b, G.st.th), d = V.sub(b, a), len = V.len(d);
      if (len < 1e-6) continue;
      const u = V.mul(d, 1 / len), side = V.unit(V.cross(G.k, u)), N = SPRING_SEGMENTS, amp = Math.min(2.5, len * 0.08), pts = [];
      for (let i = 0; i <= N; i++) {
        let p = V.add(a, V.mul(u, len * i / N));
        if (i > 0 && i < N) p = V.add(p, V.mul(side, (i % 2 ? 1 : -1) * amp));
        pts.push(toV3(V.toB(p)));
      }
      BABYLON.MeshBuilder.CreateTube(null, { path: pts, instance: s.mesh }, scene);

      // Interpolazione colore: 0 = compressa (rosso), 1 = tesa (blu)
      const ratio = Math.max(0, Math.min(2, len / s.L0)); // clamp tra 0 e 2
      const t = ratio / 2; // normalizza tra 0 e 1
      const color = BABYLON.Color3.Lerp(COLOR_COMPRESSED, COLOR_TENSED, t);

      s.mesh.material.diffuseColor = color;
      s.mesh.material.emissiveColor = color;
    }
  }
});