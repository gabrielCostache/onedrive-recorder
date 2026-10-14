// Test-only native dialog and shell hooks for the desktop smoke test.
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
const main = path.resolve(__dirname, '../../src/main.cjs');
global.recorderFixture = { folder: process.env.RECORDER_TEST_FOLDER, shownFile: '' };
Module._load = function(request, parent, isMain) {
  if (parent?.filename === main && request === 'electron') {
    const electron = originalLoad.apply(this, arguments);
    electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [global.recorderFixture.folder] });
    electron.shell.showItemInFolder = file => { global.recorderFixture.shownFile = file; };
    return electron;
  }
  return originalLoad.apply(this, arguments);
};
require(main);
