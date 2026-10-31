var MACHINE = {
  title: 'Macchina di prova',
  variants: { drive: { label: 'Comando', options: { a: 'A', b: 'B' }, active: 'a' } },
  consts: { m: 2, zA: 20 },
  controls: [],
  groups: [{ id: 'g1', label: 'Gruppo 1' }],
  views: [{ id: 'all', label: 'Insieme', auto: true, alpha: 'pi/2-0.7', beta: 1.1, scale: 1.1 }],
  ratios: [{ from: 'ax_in', to: 'ax_out', text: 'rapporto {r|3}' }],
  inputs: [
    { id: 'in_in', axis: 'ax_in', label: 'Ingresso' }, { id: 'in_crank', axis: 'ax_crank', label: 'Manovella' },
    { id: 'in_k1', axis: 'ax_k1', label: 'K1' }, { id: 'in_h1', axis: 'ax_h1', label: 'H1' },
    { id: 'in_r1', axis: 'ax_r1', label: 'R1' }, { id: 'in_w', axis: 'ax_w', label: 'Vite' },
    { id: 'in_c', axis: 'ax_c', label: 'C' }, { id: 'in_spin', axis: 'ax_spin', label: 'Spin' }, { id: 'in_drum', axis: 'ax_drum', label: 'Tamburo' }
  ],
  axes: [
    // --- coppia cilindrica + ruota libera
    { id: 'ax_in',  name: 'in',  dir: [0, 0, 1], place: { at: [0, 0, 0] }, color: '#8899aa', group: 'g1',
      parts: [{ shape: 'cylinder', r: 2, w: [-10, 30] }, { shape: 'box', w: [0, 2], half: [3, 3] }, { shape: 'prism', poly: [[0, 0], [4, 0], [2, 4]], y: [-1, 1] }] },
    { id: 'ax_out', name: 'out', dir: [0, 0, 1], place: { byMesh: 'g_b', dir: [1, 0, 0] }, color: '#aa8899', parts: [{ shape: 'cylinder', r: 2, w: [-10, 30] }] },
    // --- coppia conica: asse C con apice in comune con D
    { id: 'ax_c', name: 'c', dir: [0, 0, 1], place: { at: [0, 120, 0] }, color: '#99aa88', parts: [{ shape: 'cylinder', r: 2, w: [-10, 40] }] },
    { id: 'ax_d', name: 'd', dir: [1, 0, 0], place: { byApex: 'g_c' }, color: '#aa9988', parts: [{ shape: 'cylinder', r: 2, w: [-10, 60] }] },
    // --- vite senza fine
    { id: 'ax_w', name: 'vite', dir: [1, 0, 0], place: { at: [0, 260, 0] }, color: '#7788aa', parts: [{ shape: 'cylinder', r: 2, w: [-30, 40] }] },
    { id: 'ax_ww', name: 'ruota vite', dir: [0, 0, 1], place: { byMesh: 'g_ww', dir: [0, 1, 0] }, color: '#88aa77', parts: [{ shape: 'cylinder', r: 2, w: [-20, 20] }] },
    // --- croce di Malta (N=4, interasse 50, perno a 50*sin(pi/4))
    { id: 'ax_crank', name: 'manovella', dir: [0, 0, 1], place: { at: [200, 0, 0] }, color: '#aaaa66', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
    { id: 'ax_pin', name: 'perno', dir: [0, 0, 1], carrier: 'ax_crank', place: { at: [200 + 35.355339059, 0, 0] }, color: '#cc3333', parts: [{ shape: 'cylinder', r: 2, w: [0, 12] }] },
    { id: 'ax_mal', name: 'croce', dir: [0, 0, 1], place: { at: [250, 0, 0] }, color: '#66aaaa', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
    // --- pin_slot
    { id: 'ax_k1', name: 'k1', dir: [0, 0, 1], place: { at: [200, 120, 0] }, color: '#aa66aa', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
    { id: 'ax_kp', name: 'perno k', dir: [0, 0, 1], carrier: 'ax_k1', place: { at: [215, 120, 0] }, color: '#cc3333', parts: [{ shape: 'cylinder', r: 1.5, w: [0, 10] }] },
    { id: 'ax_k2', name: 'k2', dir: [0, 0, 1], place: { at: [240, 120, 0] }, color: '#66aa66', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
    // --- snodo di Hooke
    { id: 'ax_h1', name: 'h1', dir: [0, 0, 1], place: { at: [350, 0, 0] }, color: '#8888cc', parts: [{ shape: 'cylinder', r: 3, w: [-60, 0] }] },
    { id: 'ax_h2', name: 'h2', dir: [0.5, 0, 0.8660254037844386], place: { at: [350, 0, 0] }, color: '#cc8888', parts: [{ shape: 'cylinder', r: 3, w: [0, 60] }] },
    // --- nottolino + freno + fune
    { id: 'ax_r1', name: 'r1', dir: [0, 0, 1], place: { at: [350, 120, 0] }, color: '#99cc99', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
    { id: 'ax_r2', name: 'r2', dir: [0, 0, 1], place: { at: [400, 120, 0] }, color: '#cc9999', parts: [{ shape: 'cylinder', r: 2, w: [-10, 20] }] },
    { id: 'ax_drum', name: 'tamburo', dir: [0, 1, 0], place: { at: [350, 220, 0] }, color: '#99cccc', parts: [{ shape: 'cylinder', r: 12, w: [-10, 10] }] },
    // --- through + binario
    { id: 'ax_tail', name: 'coda', dir: [0, 0, 1], place: { at: [0, -200, 0] }, through: [[0, -200, 0], [100, -150, 30]], color: '#ccaa55', parts: [{ shape: 'cylinder', r: 1, w: [0, 100] }] },
    { id: 'ax_spin', name: 'giro', dir: [0, 0, 1], place: { at: [150, -200, 0] }, color: '#55aacc', parts: [{ shape: 'cylinder', r: 1, w: [0, 10] }] },
    { id: 'ax_slide', name: 'cursore', dir: [0, 1, 0], carrier: 'ax_spin', place: { at: [180, -200, 0] }, color: '#55ccaa', parts: [{ shape: 'cylinder', r: 1, w: [0, 30] }] },
    { id: 'ax_guide', name: 'guida', dir: [1, 0, 0], place: { at: [60, -250, 0] }, color: '#aa55cc', parts: [{ shape: 'cylinder', r: 1, w: [0, 30] }] }
  ],
  gears: [
    { id: 'g_a', name: 'A', axis: 'ax_in',  teeth: 'zA', module: 'm', w: [0, 6], meshWith: 'g_b', label: 'A' },
    { id: 'g_b', name: 'B', axis: 'ax_out', teeth: 30,   module: 'm', w: [0, 6], meshWith: 'g_a', label: 'B' },
    { id: 'g_a2', name: 'A2 libero', axis: 'ax_in', teeth: 16, module: 2, w: [10, 14], free: true, color: '#44aa44', marker: { radius: 2, color: '#00aa00' }, label: 'A2' },
    { id: 'g_a2b', name: 'A2 compagno', axis: 'ax_out', teeth: 24, module: 2, w: [10, 14], meshWith: 'g_a2', label: 'A2b' },
    { id: 'g_c', name: 'C conico', type: 'bevel', axis: 'ax_c', teeth: 20, module: 2, apexW: 20, meshWith: 'g_d', label: 'C' },
    { id: 'g_d', name: 'D conico', type: 'bevel', axis: 'ax_d', teeth: 30, module: 2, apexW: 0, label: 'D', meshWith: 'g_c' },
    { id: 'g_e', name: 'E conico solo', type: 'bevel', axis: 'ax_d', teeth: 12, module: 2, apexW: 0, delta: 40, side: -1, plate: { k: 0.8, from: -4, to: 0 }, label: 'E', variant: { drive: 'b' } },
    { id: 'g_worm', name: 'Vite', type: 'worm', axis: 'ax_w', q: 8, module: 2, w: [-20, 30], hand: 1, label: 'V' },
    { id: 'g_ww', name: 'Ruota vite', type: 'wormwheel', axis: 'ax_ww', teeth: 24, module: 2, meshWith: 'g_worm', label: 'RV' },
    { id: 'g_crank', name: 'Manovella', type: 'cylinder', axis: 'ax_crank', r: 40, w: [0, 4], label: 'M' },
    { id: 'g_mal', name: 'Croce', type: 'maltese', axis: 'ax_mal', slots: 4, w: [0, 4], label: 'MC' },
    { id: 'g_k1', name: 'K1', type: 'cylinder', axis: 'ax_k1', r: 20, w: [0, 4], label: 'K1' },
    { id: 'g_k2', name: 'K2', type: 'cylinder', axis: 'ax_k2', r: 20, w: [0, 4], label: 'K2' },
    { id: 'g_h1', name: 'H1', type: 'cylinder', axis: 'ax_h1', r: 10, w: [-30, -20], label: 'H1' },
    { id: 'g_r1', name: 'R1', type: 'spur', axis: 'ax_r1', teeth: 20, module: 2, w: [0, 4], label: 'R1', degStart: 0, degEnd: 270 },
    { id: 'g_r2', name: 'R2', type: 'spur', axis: 'ax_r2', teeth: 20, module: 2, w: [0, 4], label: 'R2' },
    { id: 'g_drum', name: 'Tamburo', type: 'cylinder', axis: 'ax_drum', r: 12, w: [-10, 10], label: 'T' }
  ],
  links: [
    { type: 'geneva', driver: 'g_crank', driven: 'g_mal', pinAxis: 'ax_pin', slots: 4 },
    { type: 'pin_slot', driver: 'g_k1', driven: 'g_k2', pinAxis: 'ax_kp', slotAngle: 0 },
    { type: 'hooke', input: 'ax_h1', output: 'ax_h2', arm: {}, message: 'angolo {beta|1}' },
    { type: 'ratchet', driver: 'ax_r1', driven: 'ax_r2', sign: 1, messages: { drives: 'trascina', winding: 'carica', freewheel: 'ruota libera', blocks: 'blocca' } },
    { type: 'brake', axis: 'ax_r2', label: 'Freno r2', message: 'freno r2 inserito', shoe: { at: [400, 140, 0], size: [10, 6, 10], released: [20, 0, 0] } },
    { type: 'rope', axis: 'ax_drum', at: [350, 220, 14], radius: 12, len0: 100, min: 10, max: 200 },
    { type: 'rail', guide: 'ax_guide', slider: 'ax_slide', perpendicularTo: 'ax_tail', marker: true }
  ]
};
