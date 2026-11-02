/* types/gears/spur/solve.js - con supporto angle iniziale */
Registry.gear('spur', {
  meshWith: ['spur'],
  minTeeth: 3,

  validate(g, w, { E, isVec }){
    if (g.teeth === undefined) E(`${w}: mancano i "teeth"`);
    if (g.module === undefined) E(`${w}: manca "module"`);
    if (!isVec(g.w, 2)) E(`${w}: "w" deve avere 2 elementi`);
    if (g.bore!==undefined && g.bore!==false){
      const b=g.bore;
      if (typeof b === 'number' || typeof b === 'string') {
      } else if (typeof b === 'object' && b!==null){
        if(b.r===undefined) E(`${w}: bore manca "r"`);
      } else {
        E(`${w}: bore deve essere numero, false oppure {r:...}`);
      }
    }
    if (g.flat!==undefined && g.flat!==false){
      if(typeof g.flat!=='number' && typeof g.flat!=='string'){
        E(`${w}: flat deve essere numero fra 0 e 1, false`);
      }
    }
    if (g.flatAngle!==undefined && typeof g.flatAngle!=='number' && typeof g.flatAngle!=='string'){
      E(`${w}: flatAngle deve essere numero (gradi)`);
    }
    if (g.angle!==undefined && typeof g.angle!=='number' && typeof g.angle!=='string'){
      E(`${w}: angle deve essere numero (gradi) per rotazione iniziale del gear`);
    }
    if (g.phase!==undefined && typeof g.phase!=='number' && typeof g.phase!=='string'){
      E(`${w}: phase deve essere numero (gradi) per rotazione iniziale del gear`);
    }
  },

  // Aggiunge rotazione iniziale al rho calcolato dal core
  afterPairs: null
});

// Hook nel core: verrà chiamato da 09-resolve.js se esiste angle/phase