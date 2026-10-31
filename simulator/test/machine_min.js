var MACHINE = { title: 'minima', axes: [
  { id: 'a1', name: 'a1', dir: [0,0,1], place: { at: [0,0,0] }, color: '#8899aa', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
  { id: 'a2', name: 'a2', dir: [0,0,1], place: { byMesh: 'g2', dir: [1,0,0] }, color: '#aa8899', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] } ],
  gears: [ { id: 'g1', name: 'G1', axis: 'a1', teeth: 20, module: 2, w: [0,6], meshWith: 'g2', label: 'G1' }, { id: 'g2', name: 'G2', axis: 'a2', teeth: 30, module: 2, w: [0,6], meshWith: 'g1', label: 'G2' } ],
  links: [], groups: [], controls: [], views: [{ id: 'all', label: 'Insieme', auto: true, alpha: 1, beta: 1.1, scale: 1.1 }], variants: {}, consts: {}, ratios: [], inputs: [{ id: 'i1', axis: 'a1', label: 'in' }] };
