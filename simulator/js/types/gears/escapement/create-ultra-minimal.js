/* types/gears/escapement/create.js - ULTRA MINIMALE DISCO - se anche questo fallisce il problema e' altrove */
function extrudeDisc(R,w0,w1,segs){
  const P=[],T=[];
  for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs; P.push([R*Math.cos(a),R*Math.sin(a),w0]);}
  for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs; P.push([R*Math.cos(a),R*Math.sin(a),w1]);}
  for(let i=0;i<segs;i++){const j=(i+1)%segs; T.push([i,j,segs+j],[i,segs+j,segs+i]);}
  for(let i=1;i<segs-1;i++){T.push([0,i,i+1],[segs,segs+i+1,segs+i]);}
  return{P,T};
}
Registry.gear('escapement', {
  noRadiusCheck:true,
  radius(g){ return 30; },
  solids: g=>{
    const w0=g.w[0], w1=g.w[1];
    return [extrudeDisc(30,w0,w1,32)];
  },
  cacheKey:g=>[g.w],
  sigKey:g=>[g.w]
});
