# Continuarea dezvoltării

## Starea la 14 octombrie 2026

Versiunea 0.3 elimină autentificarea MSAL, Microsoft Graph, cerința Client ID și uploadul pornit de Recorder. Destinația este acum un folder local ales de utilizator; aplicația verifică scrierea, salvează înregistrarea acolo și oferă o acțiune care selectează fișierul în managerul de fișiere pentru partajarea OneDrive. Buildul Windows folosește formatul portabil cu un singur `.exe`.

Nu există verificare de sincronizare în cloud sau generare automată de link. Acestea necesită o integrare Microsoft autorizată. Utilizatorul configurează clientul OneDrive oficial pe dispozitiv și gestionează share-ul prin comenzile acestuia.

## Pornire

Instalează Git și Node.js 24, apoi rulează din rădăcina repositoryului:

```sh
npm ci
npm run check
npm test
npm run test:desktop
npm start
```

Testul desktop folosește Electron și MediaRecorder reale cu un flux sintetic. Folderul de test este temporar; testul nu se conectează la OneDrive.

## Verificări și limite

Înregistrările noi sunt scrise în destinația selectată, cu nume sigur și sufix unic. Configurația stabilă și metadatele bibliotecii sunt păstrate în `%APPDATA%\OneDrive Recorder`, indiferent de locația/numele executabilului. La prima pornire după migrare, aplicația copiază configul și biblioteca veche fără să șteargă sursa. Înregistrările vechi rămân în directorul lor local și nu sunt mutate automat.

Faviconul și marcajul de brand folosesc `src/french-bulldog-camera.svg`: față de bulldog francez tigrat gri, cu cameră și LED roșu animat.

Nu sunt încă validate pe acest checkout autentificarea și sincronizarea unui client OneDrive real, permisiunile/captura fizică pe Windows/Linux/macOS sau clipurile lungi. Pentru distribuție, folosește runner-ele native din GitHub Actions; semnarea Windows și notarizarea macOS trebuie configurate separat dacă sunt necesare.

## Repository

`src/` conține aplicația. `test/` conține testele helper-ilor locali și testul desktop. `docs/screenshots/` păstrează capturile istorice, unele din versiunea 0.2 și nu reflectă onboarding-ul 0.3. `node_modules/`, `dist/` și `test-results/` se regenerează și nu se versioneză.
