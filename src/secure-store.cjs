const fs = require('node:fs');
const path = require('node:path');
function createSecureStore(directory, safeStorage, platform = process.platform) {
  function available() {
    return safeStorage.isEncryptionAvailable() && (platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
  }
  return {
    available,
    read(name) {
      if (!available()) return null;
      try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(directory, name)))); }
      catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Sesiunea salvată nu poate fi deschisă. Reconectează contul Microsoft.'); }
    },
    write(name, value) {
      if (!available()) return false;
      const file = path.join(directory, name);
      fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file); return true;
    },
    remove(name) { fs.rmSync(path.join(directory, name), { force: true }); }
  };
}
module.exports = { createSecureStore };
