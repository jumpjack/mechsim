/* types/parts/cylinder/create.js - pieno / cavo / D con orientamento */
function circle(r,n, ang0){
  const pts=[];
  const a0 = ang0||0;
  for(let i=0;i<n;i++){ const a=a0+2*Math.PI*i/n; pts.push([r*Math.cos(a), r*Math.sin(a)]); }
  return pts;
}
function dCircle(r, flat, n){
  if(!flat) return circle(r,n,0);
  let depth=flat.depth, dist=flat.dist, angDeg=flat.angle!=null?flat.angle:(flat.ang!=null?flat.ang:0);
  // ang in gradi da JSON, convertiamo in rad
  const ang0 = angDeg * Math.PI/180;
  let d = (dist!=null)?dist : (depth!=null)? r-depth : r;
  if(d>=r-1e-9) return circle(r,n,ang0);
  if(d<=-r) return [];
  const a0=Math.asin(Math.max(-1,Math.min(1,d/r)));
  const start=Math.PI - a0, end=2*Math.PI + a0;
  const m=Math.max(n,24);
  const pts=[];
  for(let i=0;i<m;i++){ const ang=start + (end-start)*i/(m-1) + ang0; pts.push([r*Math.cos(ang), r*Math.sin(ang)]); }
  return pts;
}
function wallMesh(outer, inner, w0, w1){
  const P=[], T=[];
  const n=outer.length;
  const Aout = outer.map(p=>[p[0],p[1],w0]);
  const Bout = outer.map(p=>[p[0],p[1],w1]);
  P.push(...Aout, ...Bout);
  for(let i=0;i<n;i++){ const j=(i+1)%n; T.push([i, j, n+j]); T.push([i, n+j, n+i]); }
  if(inner){
    const Ain = inner.map(p=>[p[0],p[1],w0]);
    const Bin = inner.map(p=>[p[0],p[1],w1]);
    const base=P.length;
    P.push(...Ain, ...Bin);
    for(let i=0;i<n;i++){ const j=(i+1)%n; T.push([base+i, base+n+i, base+n+j]); T.push([base+i, base+n+j, base+j]); }
  }
  return {P,T};
}
function ringCapMesh(outer, inner, w){
  const P=[], T=[];
  const n=outer.length;
  const O = outer.map(p=>[p[0],p[1],w]);
  const I = inner.map(p=>[p[0],p[1],w]);
  P.push(...O, ...I);
  for(let i=0;i<n;i++){ const j=(i+1)%n; T.push([i, j, n+j]); T.push([i, n+j, n+i]); }
  return {P,T};
}

Registry.part('cylinder', {
  validate(pt, pw, { E, isVec }){
    if(pt.r===undefined) E(`${pw}: manca "r"`);
    if(!isVec(pt.w,2)) E(`${pw}: "w" deve avere 2 elementi`);
  },
  solid: k => {
    const r=k.r, w0=k.w[0], w1=k.w[1], n=k.n||32;
    const flat=k.flat||null;

    let innerR=null;
    if(k.hollow!==undefined && k.hollow!==null){
      if(typeof k.hollow==='number') innerR=k.hollow;
      else if(typeof k.hollow==='object'){
        if(k.hollow.r!==undefined) innerR=k.hollow.r;
        else if(k.hollow.thickness!==undefined) innerR=r-k.hollow.thickness;
      }
    }

    if(innerR && innerR>0 && innerR<r-1e-6){
      // per cavo, angolo del D non ha senso, ma se c'è flat lo usiamo come D cavo
      let outer, inner;
      if(flat && flat.depth){
        outer = dCircle(r, flat, n);
        inner = dCircle(innerR, flat, n);
      }else{
        const ang0 = (flat && (flat.angle!=null||flat.ang!=null)) ? (flat.angle!=null?flat.angle:flat.ang)*Math.PI/180 : 0;
        outer = circle(r,n,ang0);
        inner = circle(innerR,n,ang0);
      }
      const walls = wallMesh(outer, inner, w0, w1);
      const cap0 = ringCapMesh(outer, inner, w0);
      const cap1 = ringCapMesh(outer, inner, w1);
      const P=[...walls.P, ...cap0.P, ...cap1.P];
      const off1=walls.P.length, off2=off1+cap0.P.length;
      const T=[...walls.T, ...cap0.T.map(t=>t.map(i=>i+off1)), ...cap1.T.map(t=>t.map(i=>i+off2))];
      return {P,T};
    }

    if(flat){
      const prof = dCircle(r, flat, n);
      if(prof.length){
        const A=prof.map(p=>[p[0],p[1],w0]);
        const B=prof.map(p=>[p[0],p[1],w1]);
        return loft(A,B,[0,0,w0],[0,0,w1]);
      }
    }

    return cylinderSolid(r, w0, w1, n, k.at?k.at[0]:0, k.at?k.at[1]:0);
  }
});