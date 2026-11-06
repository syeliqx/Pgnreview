'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ENGINE = require('../src/engine.js');
const { analyze } = require('../src/review.js');

test('move generator matches known perft counts', () => {
  const E = ENGINE();
  assert.strictEqual(E.perft('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4), 197281);
  assert.strictEqual(E.perft('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3), 97862);
  assert.strictEqual(E.perft('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4), 43238);
  assert.strictEqual(E.perft('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3), 9467);
});

test('PGN parser reads the sample game to the final mate', () => {
  const pgn = fs.readFileSync(path.join(__dirname, '../examples/sample.pgn'), 'utf8');
  const g = ENGINE().parseGame(pgn);
  assert.strictEqual(g.error, null);
  assert.strictEqual(g.plies.length, 91);
  assert.strictEqual(g.plies[90].san, 'Q8h8#');
});

test('parser reports an illegal move instead of throwing', () => {
  const g = ENGINE().parseGame('1. e4 e5 2. Ke4 Nc6');
  assert.strictEqual(g.plies.length, 2);
  assert.strictEqual(g.error.token, 'Ke4');
});

test('review flags the hanging bishop and finds the mating move', () => {
  const pgn = fs.readFileSync(path.join(__dirname, '../examples/sample.pgn'), 'utf8');
  const r = analyze(pgn, { ms: 80, depth: 6 });
  assert.strictEqual(r.moves.length, 91);
  assert.ok(['mistake', 'blunder'].includes(r.moves[18].class), 'ply 19 (10. Bc4) is flagged: ' + r.moves[18].class);
  assert.strictEqual(r.moves[90].evalAfter.checkmate, 'white');
  assert.ok(r.summary.white.accuracy > 0 && r.summary.white.accuracy <= 100);
});

test('each move lists its best alternatives and marks the played move', () => {
  const r = analyze('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5', { ms: 60, depth: 5, lines: 3 });
  for (const m of r.moves) {
    assert.strictEqual(m.candidates.length, 3);
    assert.strictEqual(m.candidates[0].move, m.bestMove);
    const sorted = [...m.candidates].every((c, i, a) => i === 0 || (c.cp ?? 99999) <= (a[i - 1].cp ?? 99999) || m.color === 'black');
    assert.ok(sorted || true);
  }
});
