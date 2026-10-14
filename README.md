# OneDrive Recorder · 0.3

Aplicație desktop pentru capturarea ecranului și a microfonului, cu salvare directă într-un folder local sincronizat de OneDrive. Recorder nu cere cont Microsoft în aplicație, Client ID, client secret sau integrare Microsoft Graph.

## Cum funcționează

1. Instalează și configurează aplicația OneDrive oficială pe calculator. Autentificarea se face în OneDrive, în afara Recorder.
2. La prima pornire, alege folderul OneDrive sincronizat. Recorder verifică dacă folderul există și poate scrie și șterge un fișier temporar.
3. Selectează un ecran sau o fereastră, scrie un titlu și pornește înregistrarea.
4. La oprire, fișierul WebM este finalizat și salvat direct în folderul selectat. Numele este curățat pentru Windows/macOS/Linux și include o parte unică pentru a evita suprascrierile.
5. Pentru share, apasă **Partajează în OneDrive**. Recorder selectează fișierul în Explorer/Finder; folosește comanda **Share / Partajare** oferită de OneDrive ca să alegi audiența și să copiezi linkul.

OneDrive gestionează sincronizarea și crearea linkului. Recorder poate confirma salvarea locală, dar nu poate confirma când fișierul a ajuns în cloud și nu poate crea automat un link de share fără o integrare Microsoft autorizată.

## Păstrarea configurării

Folderul ales și istoricul Recorder sunt păstrate în profilul Windows al utilizatorului, în `%APPDATA%\OneDrive Recorder`. Aceste date rămân acolo dacă muți sau redenumești fișierul `.exe`; nu muta și nu șterge folderul de date dacă vrei să păstrezi istoricul.

Recorder păstrează calea exactă a folderului video. Dacă redenumești sau muți acel folder în Explorer, alege din nou folderul cu butonul **Folder OneDrive**. Istoricul rămâne, dar clipurile vechi vor continua să indice locația lor precedentă.

## Dezvoltare

Necesită Node.js 24 și npm:

```sh
npm ci
npm run check
npm test
npm run test:desktop
npm start
```

Testul desktop folosește Electron real și un flux video sintetic, cu folder temporar. Nu accesează un cont Microsoft real și nu validează sincronizarea OneDrive ori generarea reală a linkului.

Build pentru un singur executabil Windows portabil:

```sh
npm run dist -- --win --x64 --publish never
```

Rezultatul este `dist/OneDrive-Recorder-0.3.0-portable.exe`. Nu necesită instalare separată; setările și istoricul sunt persistente în profilul Windows de mai sus.

Build-uri opționale pentru celelalte platforme:

```sh
npm run dist -- --mac --publish never
npm run dist -- --linux --x64 --publish never
```

Folosește runner-ele native pentru fiecare sistem de operare. Semnarea Windows și semnarea/notarizarea macOS nu sunt configurate. Workflowul GitHub Actions poate construi instalatoarele fără secrete sau variabile Client ID.

## Fișiere și recuperare

Înregistrările noi se salvează în folderul OneDrive ales, nu într-o copie ascunsă în directorul aplicației. Biblioteca Recorder ține metadatele în profilul local al aplicației. Dacă schimbi folderul, fișierele vechi rămân în locul în care au fost înregistrate.

Dacă folderul dispare, devine read-only sau discul rămâne fără spațiu, Recorder afișează o eroare și păstrează fișierul parțial când sistemul permite. O înregistrare întreruptă poate să nu fie redabilă.

Recorder nu detectează starea reală de sincronizare. Folderul ales trebuie să fie cel sincronizat de clientul OneDrive; alegerea unui folder obișnuit permite înregistrarea locală, dar nu îl va încărca în cloud. Pe Linux este necesar un client de sincronizare compatibil instalat separat.

## Limite curente

- Formatul de înregistrare este WebM; compatibilitatea playerului OneDrive poate varia. Dacă OneDrive nu redă fișierul, descarcă-l sau convertește-l separat.
- Share-ul se finalizează în interfața OneDrive. Recorder nu controlează audiența, permisiunile sau copierea linkului.
- Captura reală a ecranului și microfonului, clipurile lungi și permisiunile sistemului trebuie validate pe fiecare platformă înainte de distribuirea largă.
- Nu sunt incluse camera în bulină, sunetul sistemului, editarea clipurilor, transcrierea sau auto-update.
