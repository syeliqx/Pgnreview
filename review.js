'use strict';
// Full-game review: runs the engine over every position and grades each move.
// Used by the CLI (bin/pgn-review.js) and the HTTP API (server.js).
const ENGINE = require('./engine.js');
const BOOK_LINES = require('./openings.js');

const MATE = 30000;
const skey = s => s.replace(/[+#!?]/g, '');
const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const capv = w => Math.max(-1000, Math.min(1000, w));

const ROOT = { kids: {}, name: null };
for (const [mv, name] of BOOK_LINES) {
  let nd = ROOT;
  for (const t of mv.split(' ')) nd = nd.kids[t] || (nd.kids[t] = { kids: {}, name: null });
  nd.name = name;
}

// Convert a side-to-move engine result into a white-perspective evaluation.
function normEval(r, fen) {
  const stm = fen.split(' ')[1] === 'b' ? -1 : 1;
  if (r.terminal) {
    const winner = r.mate ? -stm : 0;
    return { w: winner * MATE, mate: r.mate ? winner : null, terminal: true, mated: r.mate, best: null, bestSan: null, depth: 0, lines: [] };
  }
  let mate = null;
  if (Math.abs(r.score) >= MATE - 200) {
    const d = MATE - Math.abs(r.score);
    mate = (r.score > 0 ? stm : -stm) * Math.max(1, Math.ceil(d / 2));
  }
  const lines = (r.lines || []).map(l => {
    let lm = null;
    if (Math.abs(l.score) >= MATE - 200) lm = (l.score > 0 ? stm : -stm) * Math.max(1, Math.ceil((MATE - Math.abs(l.score)) / 2));
    return { move: l.move, san: l.san, w: l.score * stm, mate: lm };
  });
  return { w: r.score * stm, mate, best: r.move, bestSan: r.san, depth: r.depth, lines };
}
const publicEval = e => e.terminal
  ? { cp: 0, mate: null, checkmate: e.mated ? (e.mate > 0 ? 'white' : 'black') : null }
  : { cp: e.mate === null ? e.w : null, mate: e.mate };

/**
 * @param {string} pgn  a single game in PGN (headers optional)
 * @param {{ms?:number, depth?:number, onProgress?:(done:number,total:number)=>void}} opts
 *   ms     time budget per position in milliseconds (default 400)
 *   depth  maximum search depth in plies (default 9)
 *   lines  how many best moves to report per position (1 to 6, default 3)
 */
function analyze(pgn, opts) {
  opts = opts || {};
  const ms = opts.ms || 400, depth = opts.depth || 9;
  const nLines = Math.max(1, Math.min(6, opts.lines || 3));
  const E = ENGINE();
  const game = E.parseGame(pgn);
  if (!game.plies.length) {
    throw new Error(game.error && game.error.empty ? 'No moves found in PGN' : 'Could not read move 1: ' + game.error.token);
  }
  const n = game.plies.length;

  // opening book walk
  const book = [true], open = [null];
  let nd = ROOT, name = null;
  for (let k = 0; k < n; k++) {
    nd = nd ? (nd.kids[skey(game.plies[k].san)] || null) : null;
    book.push(!!nd);
    if (nd && nd.name) name = nd.name;
    open.push(name);
  }

  // engine pass
  const evals = [];
  for (let k = 0; k <= n; k++) {
    evals.push(normEval(E.top(game.fens[k], ms, depth, nLines), game.fens[k]));
    if (opts.onProgress) opts.onProgress(k + 1, n + 1);
  }

  // grading
  const side = { white: { n: 0, acc: 0, cp: 0, counts: {} }, black: { n: 0, acc: 0, cp: 0, counts: {} } };
  const moves = game.plies.map((pl, k) => {
    const e0 = evals[k], e1 = evals[k + 1], c = pl.color;
    const b0 = capv(c * e0.w), b1 = capv(c * e1.w);
    const w0 = winPct(b0), w1 = winPct(b1);
    let drop = Math.max(0, w0 - w1), cpLoss = Math.max(0, b0 - b1);
    let cls;
    if (book[k + 1]) cls = 'book';
    else if (pl.legalCount === 1) cls = 'forced';
    else if (pl.uci === e0.best || drop <= 0.2) cls = 'best';
    else cls = drop <= 1.5 ? 'excellent' : drop < 5 ? 'good' : drop < 10 ? 'inaccuracy' : drop < 20 ? 'mistake' : 'blunder';
    if (cls === 'book') { drop = 0; cpLoss = 0; }
    const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
    const s = side[c === 1 ? 'white' : 'black'];
    s.n++; s.acc += acc; s.cp += cpLoss; s.counts[cls] = (s.counts[cls] || 0) + 1;
    return {
      ply: k + 1,
      moveNumber: game.firstFull + Math.floor((k + (game.plies[0].color === -1 ? 1 : 0)) / 2),
      color: c === 1 ? 'white' : 'black',
      san: pl.san, uci: pl.uci,
      class: cls,
      evalBefore: publicEval(e0),
      evalAfter: publicEval(e1),
      bestMove: e0.best, bestMoveSan: e0.bestSan,
      candidates: e0.lines.map(l => ({ move: l.move, san: l.san, cp: l.mate === null ? l.w : null, mate: l.mate, played: l.move === pl.uci })),
      winChanceBefore: +w0.toFixed(1), winChanceAfter: +w1.toFixed(1),
      centipawnLoss: Math.round(cpLoss),
      accuracy: +acc.toFixed(1),
      opening: open[k + 1]
    };
  });
  const summary = {};
  for (const c of ['white', 'black']) {
    const s = side[c];
    summary[c] = {
      player: game.hdr[c === 'white' ? 'White' : 'Black'] || null,
      accuracy: s.n ? +(s.acc / s.n).toFixed(1) : null,
      averageCentipawnLoss: s.n ? Math.round(s.cp / s.n) : null,
      counts: s.counts
    };
  }
  return {
    headers: game.hdr,
    opening: open[n],
    parseError: game.error,
    engine: { name: 'pgn-review built-in', msPerPosition: ms, maxDepth: depth, lines: nLines },
    summary,
    moves
  };
}

module.exports = { analyze, winPct };
