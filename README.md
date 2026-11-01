# mechsim

<img width="678" height="398" alt="image" src="https://github.com/user-attachments/assets/f759c520-070b-48da-826d-e29343bd3db3" />


# Simulatore cinematico

[DEMO](https://jumpjack.github.io/mechsim/simulator/index.html)

## Introduzione

Iniziato come semplice esperimento per vedere se l'Intelligenza Artificiale poteva aiutarmi a creare gli ingranaggi per la mia riproduzione del siderostato di Foucault, questo codice dopo solo pochi giorni di vibe coding è diventato lungo 4000 righe e in grado di simulare i meccanismi più strani: non solo semplici ingranaggi e perni, ma anche giunti cardanici, strani giunti che non so se abbiano un nome ma hanno 3 gradi di libertà (scorrimento, rotazione1, rotazione2), e, man mano che il vibe coding andava avanti, anche il curioso meccanismo pin-slot della macchina di Antykythera, la coppia "geneva drive" o "croce di malta", lo scappamento di un orologio...

Adesso che l'IA (principalmente Claude Sonnet 5.5 free, ma con l'aiuto di molte altre durante la ricarica dei crediti gratuiti) è riuscita a riorganizzare il singolo file di 4000 righe in tanti piccoli file, in teoria dovrebbe essere possibile per qualunque IA avanzata aggiungere meccanismi aggiungendo file create.js e solve.js nelle cartelle types.

## Funzionamento

Il simulatore si apre con una macchina di default dotata di una sola ruota alla base del tamburo: è un eliostato di Foucault "primo tipo", serve solo a mostrare il complicato meccanismo di controllo dello specchio; poi però si può caricare una qualunque "macchina" descritta in un file .json opportunamente formattato. Le macchine sono disponibili nella cartella machines; adesso sto cercando di far scrivere all'IA un manuale su come compilare il proprio file-macchina.

## Estensione

Nella cartella types ci sono le cartelle gears, links e parts: per aggiungere un nuovo elemento bisogna aggiungere una nuova cartella in gears, ed eventualmente in links, se si tratta di elementi collegati tra loro, contenente i due file create.js (per creare il solido visibile) e solve.js (per calcolare come l'oggetto si muove). Non ho idea di come funzionino questi file, prodotti al 100% dall'IA, quindi al momento l'unico modo che conosco per aggiungere nuovi elementi è passare all'IA lo zip dell'intero progetto ( si può fare con Claude Sonnet 5.5, ma gratis funziona solo per una decina di minuti ogni 5 ore, o con Grok), e chiedergli di aggiungere qualcosa: penserà lei automaticamente a fornire i file necessari.




