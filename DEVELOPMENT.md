# Continuarea dezvoltării

## Stare la 14 octombrie 2026

Sursele actuale sunt prototipul 0.2 cu integrare Microsoft Graph. Client ID-ul este gol; autentificarea reală și distribuția 0.2 nu sunt activate. Testele folosesc servicii Microsoft simulate. Pachetele 0.1 sunt prototipuri mai vechi, nesemnate, și nu corespund surselor actuale.

## Ultima decizie a utilizatorului — de implementat

- Eliminăm necesitatea unui Client ID și a autentificării Microsoft în Recorder.
- La prima pornire, utilizatorul alege un folder local din OneDrive-ul său sincronizat.
- Păstrăm folderul în configurația locală și îl reutilizăm după repornire.
- Utilizatorul poate da un titlu înregistrării; fișierele trebuie să aibă nume valide pe toate platformele, fără suprascrierea clipurilor cu același titlu.
- La Stop, clipul se salvează automat în folderul ales. Clientul OneDrive gestionează sincronizarea; Recorder nu poate confirma încărcarea în cloud doar din salvarea locală.
- Dacă folderul nu mai este disponibil sau nu permite scrierea, afișăm o eroare clară și păstrăm înregistrarea recuperabilă.
- Permitem schimbarea folderului din setări, când nu se înregistrează.
- Nu promitem un link automat individual fără integrarea Graph. Partajarea rămâne prin OneDrive.
- Pe Linux trebuie o soluție de sincronizare compatibilă instalată separat.

Această migrare NU este implementată. README descrie încă fluxul Graph existent. Trebuie actualizate UI, IPC, persistența, testele, documentația și verificarea de build care cere Client ID.

## Pornire pe alt desktop

Instalează Git și Node.js 24, clonează repositoryul și rulează din rădăcina lui:

```sh
npm ci
npm run setup
npm run check
npm test
npm start
```

`npm run test:desktop` verifică fluxul în Electron cu video sintetic. Capturile generate merg în `test-results/desktop/` (ignorat de Git). Capturile istorice sunt în `docs/screenshots/`.

După modificări: `git add`, `git commit`, `git push`. Pe celălalt calculator: `git pull`, apoi `npm ci` dacă s-au schimbat dependențele.

## Verificări și limite cunoscute

Anterior au trecut verificarea sintactică, 17 teste unitare și testul desktop pe macOS. Nu sunt validate login/upload reale, captură fizică de lungă durată sau rulare Windows/Linux. Buildurile Windows NSIS și Linux AppImage pe Mac ARM au eșuat din cauza instrumentelor de ambalare; folosim runner-ele native din workflow pentru builduri ulterioare. Semnarea și notarizarea nu sunt configurate.

Repositoryul conține sursele, lockfile, teste, workflow, documentație și capturi. `node_modules` se reinstalează; directoarele de aplicații dezarhivate și cache-urile de build sunt regenerabile și nu se versioneză. Nu transferăm tokenuri, sesiuni, parole sau înregistrări personale.
