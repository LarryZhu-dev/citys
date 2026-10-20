'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Bind the exported PCK to its reviewed source and runtime artwork. Original
// generation sheets and editor caches are deliberately outside the export.
function sourceDigest(project) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.godot' || entry.name === 'sources') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:gd|gdshader|tscn|tres|godot|cfg|json|png|webp|otf|ttf|import)$/.test(entry.name)) files.push(file);
    }
  }
  walk(project);
  const digest = crypto.createHash('sha256');
  for (const file of files.sort()) {
    digest.update(path.relative(project, file).split(path.sep).join('/') + '\0');
    digest.update(crypto.createHash('sha256').update(fs.readFileSync(file)).digest());
  }
  return digest.digest('hex');
}

module.exports = { sourceDigest };
