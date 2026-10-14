# OneDrive Recorder · 0.2

Aplicație desktop pentru înregistrare și partajare video prin propriul OneDrive. Acceptă conturi Microsoft personale și de serviciu, fără cont separat în Recorder și fără listă de organizații aprobate.

**Stare:** codul versiunii 0.2 și testele sunt actualizate. Conectarea reală nu este încă activată: lipsește Application client ID-ul aplicației. Pachetele 0.1 din `dist/` sunt prototipurile vechi și nu includ acest flux; nu sunt pachete 0.2 pentru distribuție.

## Experiența utilizatorului

1. La prima pornire apare **Conectează OneDrive**. Studioul nu este disponibil înainte de configurare.
2. Utilizatorul alege contul personal sau de serviciu în browserul Microsoft. Nu introduce parole sau identificatoare tehnice în Recorder.
3. Alege un folder din propriul OneDrive sau creează unul nou. Aplicația verifică dreptul de salvare și de ștergere cu un fișier temporar, pe care îl elimină înainte de confirmare.
4. Se deschide studioul: ecran/fereastră, microfon opțional, pauză și oprire.
5. La oprire, copia locală rămâne pe disc și începe automat uploadul în folderul ales. Destinația este legată de fiecare înregistrare; schimbarea folderului nu mută înregistrările deja create.
6. După upload, utilizatorul alege audiența și copiază linkul. Conturile de serviciu pot avea opțiunile „Doar organizația” și „Oricine are linkul”; pentru conturile personale apare doar „Oricine are linkul”. Politicile Microsoft 365 pot bloca o opțiune de partajare.

La pornirile următoare, aplicația încearcă să restaureze contul și folderul. Din **Cont și folder OneDrive** se poate schimba folderul sau deconecta contul. Biblioteca locală afișată este legată de cont; fișierele vechi rămân pe disc la deconectare. Aceasta nu este o măsură de izolare între utilizatori ai aceluiași cont de sistem de operare.

## Configurare făcută o singură dată de editor

O aplicație publică ce accesează OneDrive are nevoie de propria înregistrare Microsoft. Utilizatorii finali **nu** au nevoie să înregistreze aplicații, să furnizeze Tenant ID-uri sau să introducă un Client ID.

În [Microsoft Entra admin center](https://entra.microsoft.com/):

1. **App registrations → New registration**. Nume: de exemplu `OneDrive Recorder`.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (`AzureADandPersonalMicrosoftAccount`).
3. **Authentication → Add a platform → Mobile and desktop applications**, cu redirect URI **`http://localhost`**. Fluxul folosește authorization code + PKCE și un port local aleator; nu înregistra fiecare port separat.
4. **API permissions → Microsoft Graph → Delegated permissions → Files.ReadWrite**. Nu se utilizează permisiuni application/daemon.
5. Copiază **Application (client) ID** în `src/app-config.json`:

```json
{ "clientId": "ID-ul-real-al-aplicației-Microsoft" }
```

Nu crea și nu încorpora un client secret. Aplicația desktop este un public client. Nu mai folosim device-code login; utilizatorul se autentifică în browser și revine în aplicație.

La build poți furniza alternativ variabila `ONEDRIVE_CLIENT_ID`; scriptul o include în configurația pachetului. Verificarea de build validează formatul ID-ului, nu dovedește că înregistrarea și permisiunile Microsoft sunt corecte. Fără un ID configurat, buildul de distribuție se oprește cu un mesaj explicit.

Pe organizațiile care cer consimțământ administrativ sau publisher verification, aceste reguli Microsoft rămân aplicabile. Aplicația nu adaugă restricții de domeniu și nu ocolește politicile contului Microsoft.

Surse: [tipurile de cont acceptate](https://learn.microsoft.com/en-us/entra/identity-platform/howto-modify-supported-accounts), [redirect URI localhost](https://learn.microsoft.com/entra/identity-platform/reply-url), [publisher verification și consent](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview).

## Dezvoltare și build

Necesită Node.js 24 și npm:

```sh
npm ci
npm run setup
npm start
```

În modul dezvoltare, dacă ID-ul lipsește, există o opțiune **Configurare pentru dezvoltator**. Aceasta nu este disponibilă în pachetele instalate și nu este fluxul pentru colegi. Configurarea de dezvoltare se păstrează doar în profilul local; pentru distribuție, ID-ul trebuie inclus prin `src/app-config.json` sau variabila de build.

După configurare:

```sh
npm run dist -- --win --x64 --publish never
npm run dist -- --mac --publish never
npm run dist -- --linux --x64 --publish never
```

Formate configurate: Windows NSIS `.exe`, macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`. Buildul macOS folosește arhitectura gazdei; `--x64` și `--arm64` pot fi cerute explicit.

Workflowul `.github/workflows/build.yml` folosește runner-e native Windows/macOS/Linux. Configurează variabila de repository `ONEDRIVE_CLIENT_ID`, pune proiectul ca rădăcină a repositoryului și pornește workflowul **Build desktop installers**. Workflowul este inclus, dar nu a fost publicat sau rulat pe GitHub în această sesiune.

Semnarea Windows și semnarea/notarizarea macOS rămân de configurat pentru distribuție. Nu este inclus un mecanism de auto-update.

## Stabilitate și păstrarea datelor

- Fragmentele video sunt scrise pe disc în timpul capturii; la final, fișierul este sincronizat pe disc înainte de upload.
- Înainte de înregistrare se verifică spațiul liber. Dacă discul nu mai poate ține pasul, înregistrarea se oprește și este marcată ca parțială.
- Un upload folosește un nume unic și nu suprascrie automat un fișier existent cu altă dimensiune.
- La erori temporare se verifică progresul confirmat de OneDrive. Se reia din poziția confirmată, cu încercări limitate și intervale de așteptare. Pierderea răspunsului final este tratată prin verificarea fișierului deja finalizat, pentru a evita duplicatele.
- La eșec, apare **Reîncearcă**, iar copia locală este păstrată. Sesiunile de upload se păstrează criptat când sistemul oferă un mecanism sigur. La expirarea unei sesiuni, se poate porni o sesiune nouă.
- Închiderea normală este blocată cât timp se înregistrează, se configurează sau se încarcă un fișier. Autentificarea poate fi anulată și are timeout.
- Un crash al interfeței închide fișierul activ, îl marchează ca întrerupt și recreează fereastra. Înregistrările parțiale nu sunt încărcate automat.
- Contul sau folderul nu poate fi schimbat în timpul unei înregistrări ori al unui upload. Înregistrările sunt legate de contul și destinația originale.

Sursa protocolului de reluare: [Microsoft Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).

## Protejarea sesiunii

MSAL gestionează tokenurile Microsoft. Cache-ul este stocat prin Electron `safeStorage`, folosind protecția disponibilă în sistemul de operare. Pe Linux, backendurile `basic_text` și `unknown` sunt refuzate pentru persistență; când criptarea sigură nu este disponibilă, tokenurile rămân doar în memorie, iar aplicația explică necesitatea reconectării după repornire.

Tokenurile și URL-urile preautorizate de upload nu sunt trimise interfeței. Cache-ul de autentificare este eliminat la deconectare. URL-urile sesiunilor de upload sunt criptate și pot rămâne pentru reluarea unei înregistrări după reconectarea aceluiași cont. Fișierele video locale nu sunt criptate de Recorder; au protecțiile contului de sistem de operare.

Autentificarea folosește browserul sistemului, PKCE, un `state` aleator verificat și un listener legat numai de loopback. Callbackurile invalide sunt respinse. Nu se deschid URL-uri arbitrare în browser.

Electron folosește sandbox și context isolation. IPC verifică fereastra și cadrul expeditorului. Interfața este locală, cu Content Security Policy și navigare externă blocată.

## Verificări efectuate

```sh
npm run check
npm test
npm run test:desktop
```

Au trecut 17 teste automate pentru autentificare/cancel/timeout, PKCE/state, criptare disponibilă sau indisponibilă, upload în fragmente, reluare, răspuns final pierdut, quota, acces refuzat, conflicte de fișier, partajare, paginare și verificarea destinației.

Testul desktop rulează Electron și MediaRecorder reale cu video sintetic. Verifică:

- blocarea studioului și a comenzilor IPC înainte de conectare și alegerea folderului;
- anularea autentificării și refuzul unui folder fără drept de scriere;
- înregistrare, pauză/continuare, WebM pe disc și redare locală;
- upload automat, eșec și retry;
- restaurarea sesiunii după repornire și separarea bibliotecilor între conturi;
- recuperarea după un crash provocat al rendererului.

**Limita testelor:** Microsoft Graph, conturile și serviciul de criptare al sistemului sunt simulate în testul desktop, printr-un fișier exclus din pachetele de distribuție. Testele unitare de autentificare folosesc un callback HTTP local real și un endpoint de token simulat. Nu s-a testat încă autentificarea și uploadul cu un cont Microsoft real. Captura ecranului/microfonului fizic, sesiunile lungi și rularea pe Windows/Linux trebuie verificate înainte de un pilot.

## Limite funcționale

Prima versiune folosește WebM. Playerul local este verificat; redarea în browserul OneDrive nu este confirmată și poate necesita descărcarea fișierului. Exportul MP4 rămâne un pas necesar dacă testele de compatibilitate cu OneDrive îl cer pentru experiența dorită.

Nu sunt încă incluse camera în bulină, sunetul sistemului, tăierea videoclipurilor, transcrierea, comentariile sau un player web propriu. După închidere forțată, recuperarea/redarea unui fișier video parțial nu este garantată.

Pe macOS sunt necesare permisiunile Screen Recording și Microphone. Pe Linux/Wayland, selecția depinde de portalul sistemului și PipeWire. Nu există o garanție de „zero glitch-uri”; această versiune este pentru validare, nu o versiune deja verificată pentru distribuție largă.

Înregistrările vechi din 0.1 nu au asocierea sigură cont-destinație introdusă în 0.2 și nu sunt afișate sau încărcate automat. Fișierele lor rămân în directorul de date al aplicației.
