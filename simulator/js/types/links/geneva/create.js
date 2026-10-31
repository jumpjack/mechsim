/* =====================================================================
   types/links/geneva/create.js
   Dopo la modifica la ruota pilota è composta da due ruote solidali:
   - disco piccolo di blocco (settore) sullo stesso piano della croce
   - disco grande che porta il pin, sfalsato lungo l'asse
   La geometria è creata dal gear di tipo "geneva_driver" (o "spur" se usato in geneva).
   Il link stesso non crea oggetti propri.
   ===================================================================== */
// Il link non crea oggetti propri: la croce è gear "maltese", la manovella è gear "geneva_driver"