#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { analyze } = require('../src/review.js');

const HELP = `pgn-review: grade every move of a chess game

Usage:
  pgn-review <file.pgn | ->  [--ms 400] [--depth 9] [--lines 3] [--json] [--all]

  file.pgn   path to a PGN file, or "-" to read stdin
  --ms N     time per position in milliseconds (default 400)
  --depth N  maximum search depth (default 9)
  --lines N  best moves to list per position (default 3)
  --json     print the full review as JSON
  --all      in text mode, list every move (default: inaccuracies and worse)
`;

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) { process.stdout.write(HELP); process.exit(args.length ? 0 : 1); }
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) || def : def; };
const file = args.find((a, i) => (a === '-' || !a.startsWith('--')) && !['--ms', '--depth', '--lines'].includes(args[i - 1]));
let pgn;
try { pgn = fs.readFileSync(file === '-' ? 0 : file, 'utf8'); }
catch (e) { process.stderr.write('Cannot read ' + file + ': ' + e.message + '\n'); process.exit(1); }

const ms = flag('--ms', 400), depth = flag('--depth', 9), lines = flag('--lines', 3);
let result;
try {
  result = analyze(pgn, {
    ms, depth, lines,
    onProgress: (d, t) => { if (process.stderr.isTTY) process.stderr.write('\rAnalyzing ' + d + '/' + t); }
  });
} catch (e) { process.stderr.write('\n' + e.message + '\n'); process.exit(1); }
if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');

if (args.includes('--json')) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exit(0); }

const h = result.headers, S = result.summary;
const fmt = e => e.checkmate ? '#' : e.mate !== null ? (e.mate > 0 ? 'M' : '-M') + Math.abs(e.mate) : (e.cp >= 0 ? '+' : '-') + (Math.abs(e.cp) / 100).toFixed(1);
console.log((h.White || 'White') + ' vs ' + (h.Black || 'Black') + (h.Result ? '  (' + h.Result + ')' : ''));
if (result.opening) console.log('Opening: ' + result.opening);
console.log('Accuracy  white ' + S.white.accuracy + '  black ' + S.black.accuracy + '   avg centipawn loss  ' + S.white.averageCentipawnLoss + ' / ' + S.black.averageCentipawnLoss);
console.log('');
const show = m => process.argv.includes('--all') || ['inaccuracy', 'mistake', 'blunder'].includes(m.class);
for (const m of result.moves.filter(show)) {
  const label = m.moveNumber + (m.color === 'white' ? '.' : '...') + ' ' + m.san;
  console.log(label.padEnd(14) + m.class.padEnd(11) + fmt(m.evalAfter).padStart(6) + (m.bestMoveSan && m.bestMoveSan !== m.san ? '   better: ' + m.bestMoveSan : ''));
  console.log('    best moves: ' + m.candidates.map(c => c.san + ' ' + fmt({ cp: c.cp, mate: c.mate }) + (c.played ? '*' : '')).join('  ') + (m.candidates.some(c => c.played) ? '' : '   (played ' + m.san + ' is not among them)'));
}
if (result.parseError) console.log('\nStopped at ply ' + result.parseError.ply + ': "' + result.parseError.token + '" is not legal there.');
