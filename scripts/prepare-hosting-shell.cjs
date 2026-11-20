'use strict';

const { renameSync, statSync } = require('node:fs');
const path = require('node:path');

function prepareHostingShell(directory) {
  if (!directory) throw new Error('Hosting resource directory is required.');
  const index = path.join(directory, 'index.html');
  const shell = path.join(directory, 'app-shell.html');
  // Hosting gives a root index precedence over rewrites. The renamed file
  // is still served directly to account routes and the template fetch.
  try {
    renameSync(index, shell);
  } catch (error) {
    if (error.code !== 'ENOENT' || !statSync(shell, { throwIfNoEntry: false })?.isFile()) throw error;
  }
}

if (require.main === module) prepareHostingShell(process.argv[2]);

module.exports = { prepareHostingShell };
