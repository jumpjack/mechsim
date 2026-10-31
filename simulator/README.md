# Simulatore di meccanismi — struttura a file

`script_2.js` (circa 4000 righe) è stato diviso in un **nucleo** (parte generica) e in **tipi** (un tipo per cartella).
Il comportamento è identico all'originale: lo verifica il test in `test/` (vedi sotto).

## Uso

Nella pagina HTML, al posto di `<script src="script_2.js">`:

```html
<script src="js/loader.js"></script>
```

Resta tutto il resto (Babylon, `MACHINE`, e gli script che definiscono `step`, `warn`, `fail`, `reportError`, `CTX`, `DBG`, `seenMsgs`).
Funziona anche aprendo la pagina da `file://`. L'avvio è asincrono: prima si caricano i file dei tipi che la macchina usa.

Per pubblicare **un file solo**: `node tools/bundle.js` → `dist/simulatore.js` (nucleo + tutti i tipi, nessun caricamento dinamico).

## Struttura

```
js/
  loader.js  manifest.js        caricano il nucleo (manifest.js = elenco ordinato dei file del nucleo)
  core/
    01-utils  02-expression     utilità, vettori, valutatore delle espressioni
    03-registry                 REGISTRO DEI TIPI (leggere il commento in testa: elenca tutte le fasi dei link)
    04-geometry                 primitive geometriche condivise (loft, toothProfile, cylinderSolid...)
    05-state  06-validate       stato dell'interfaccia; validazione generica del JSON
    07-kinematics  08-axis-constraints   cinematica dei corpi; assi through / alignWith / perpendicularTo / spin
    09-resolve  10-solver       risoluzione del modello; sistema dei vincoli e velocità
    11-scene  12-ui  13-machine-io  14-main    scena Babylon, interfaccia, caricamento macchine, avvio e animazione
  types/
    gears/<tipo>/create.js + solve.js     spur  bevel  cylinder  worm  wormwheel  maltese
    links/<tipo>/create.js + solve.js     ratchet  brake  rope  hooke  pin_slot  geneva  rail
    parts/<forma>/create.js               cylinder  box  prism   (le parti degli assi: solo geometria)
    _template/                            modelli da copiare per un nuovo tipo
tools/bundle.js    test/
```

In ogni tipo, **create.js = come si crea** (geometria, mesh, oggetti Babylon, controlli) e
**solve.js = come si risolve** (validazione del JSON, parametri, cinematica). Le due metà si fondono in un unico tipo.
Esempio: `types/gears/spur/create.js` contiene `spurGear()`, `types/gears/bevel/create.js` contiene `bevelGear()`.

## Aggiungere un tipo

1. Copiare `js/types/_template/gear` (o `link`) in `js/types/gears/<nome>` (o `links/<nome>`) e sostituire `NOME`.
2. Scrivere `"type": "<nome>"` nel JSON della macchina.

Fine: nessun elenco da aggiornare e nessun file del nucleo da toccare. Quando la macchina usa il tipo, il registro carica
da solo `create.js` e `solve.js`; se mancano, l'errore indica quali file servono. (Con il bundle basta rilanciare `tools/bundle.js`.)

Un browser non può leggere il contenuto di una cartella: per questo i tipi si deducono dal JSON della macchina (e dal bundler)
invece che da una scansione. I nomi di tipo ammettono solo lettere, cifre e `_`: finiscono in un URL.
I file di tipi diversi condividono lo stesso spazio globale: le funzioni di aiuto vanno chiamate con un prefisso del tipo (`hexDiscSolid`, non `solid`).

### Cosa può definire un tipo di ingranaggio (tutto facoltativo salvo `meshWith`, se deve ingranare)
create.js: `solids(g)`, `cacheKey(g)`, `sigKey(g)`, `markerZ(g)`.
solve.js: `meshWith`, `minTeeth`, `noRadiusCheck`, `toothPhase`, `validate`, `defaultTeeth`, `radius`, `anchorOffset`, `resolve`, `afterPairs`, `contact`, `meshRow`, `validateModel`.

### Cosa può definire un tipo di link
`collection`, `order`, `validate`, `prepareAxes`, `initThrough`, `resolve`, `constraints`, `lock`/`lockable`, `events`,
`afterIntegrate`, `settle`, `afterThroughLine`, `afterPose`, `build`, `panel`, `status`, `linkedAxes`.
Ognuno è una "fase" in cui il link si inserisce; `order` decide la posizione rispetto agli altri (tabella degli ordini in `core/03-registry.js`).

## Verifica

`test/` contiene una macchina che usa **tutti** i tipi e un confronto numerico fra l'originale e la versione nuova
(assi, ingranaggi, checksum delle mesh, equazioni, velocità, angoli dopo 300 frame con croce di Malta, nottolino, freno, fune, snodo, binario,
cambio di variante, ricarica). Risultato: 0 differenze, sia caricando i file che con il bundle.

```
npm install babylonjs jsdom
cp /percorso/script_2.js test/
cd test
node run.js orig /tmp/orig.json ; node run.js new /tmp/new.json ; python3 compare.py /tmp/orig.json /tmp/new.json
```

### Caricare una macchina mentre un'altra gira
`test/apply-while-running.js` copre questo caso: i tipi nuovi si caricano in modo asincrono mentre il modello precedente continua ad animarsi.
Il registro rende visibile un tipo solo quando tutti i file caricati insieme sono arrivati, e non chiama mai un link su un modello che non ha la sua collezione.
`node test/apply-while-running.js test/machine_min.js <tua macchina>.js`

## Differenze rispetto all'originale

- Avvio asincrono (carica i tipi). `applyMachine()` ora è `async`.
- Le tre `createParallel(...)` del siderostato in fondo a `core/14-main.js` partono solo se il modello è stato costruito (prima, un errore all'avvio fermava tutto). Andrebbero spostate nel file della macchina.
- Il raggio `q·m/2` (vite) è ora nel tipo `worm`, non più valido per qualunque tipo con `q`.

## Cose notate nel codice originale, lasciate com'erano

- Snodo di Hooke: `h.def.arm` finisce nel parametro sbagliato di `createHooke`, quindi le dimensioni della crociera restano quelle di default (commento in `types/links/hooke/create.js`).
- Un ingranaggio libero (`free`) senza `color` proprio va in errore: l'asse virtuale non eredita il colore dell'asse ospite.
- Se la **vite** dichiara `meshWith` verso la ruota (invece della ruota verso la vite), il contatto viene calcolato come fra ruote cilindriche. Dichiararlo sulla ruota.
