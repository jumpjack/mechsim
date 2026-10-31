/* Elenco dei file del NUCLEO, in ordine di caricamento.
   I tipi (types/gears, types/links, types/parts) NON si elencano qui: si caricano da soli quando la macchina li usa. */
var SIM_CORE = [
  'core/01-utils.js',
  'core/02-expression.js',
  'core/03-registry.js',
  'core/04-geometry.js',
  'core/05-state.js',
  'core/06-validate.js',
  'core/07-kinematics.js',
  'core/08-axis-constraints.js',
  'core/09-resolve.js',
  'core/10-solver.js',
  'core/11-scene.js',
  'core/12-ui.js',
  'core/13-machine-io.js',
  'core/14-main.js'          // l'ultimo: avvia il modello
];
