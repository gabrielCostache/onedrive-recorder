const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/app-config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const clientId = process.env.ONEDRIVE_CLIENT_ID || config.clientId;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId || '')) {
  console.error('Build de distribuție oprit: configurează o singură dată Application client ID în src/app-config.json sau ONEDRIVE_CLIENT_ID. Utilizatorii nu trebuie să configureze acest ID. Vezi README.');
  process.exit(1);
}
if (config.clientId !== clientId) fs.writeFileSync(file, JSON.stringify({ clientId }, null, 2) + '\n');
console.log('Configurarea Microsoft este inclusă în build. Înregistrarea aplicației și permisiunile trebuie verificate cu un cont real.');
