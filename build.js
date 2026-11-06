'use strict';
// Inlines the engine, opening table and UI script into one self-contained dist/index.html.
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const out = read('web/template.html')
  .replace('/*__ENGINE__*/', () => read('src/engine.js') + '\n' + read('src/openings.js'))
  .replace('/*__APP__*/', () => read('web/app.js'));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), out);
console.log('Wrote dist/index.html (' + out.length + ' bytes)');
