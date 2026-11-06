# pgn-review

Review a chess game from its PGN: every move is graded (best, excellent, good, book, inaccuracy, mistake, blunder), with an evaluation graph, accuracy scores and a small opening explorer.

It ships three ways to run the same engine, with **no dependencies**:

| Use | How |
| --- | --- |
| Web page | `npm start`, then open http://127.0.0.1:8787 (or open `dist/index.html` after `npm run build`) |
| Command line | `node bin/pgn-review.js examples/sample.pgn` |
| HTTP API / Node module | `node server.js`, or `require('./src/review.js')` |

Requires Node 18 or newer.

## Command line

```
node bin/pgn-review.js game.pgn [--ms 400] [--depth 9] [--json] [--all]
cat game.pgn | node bin/pgn-review.js -
```

## HTTP API

The server listens on `127.0.0.1:8787` by default (change with `PORT` and `HOST`). It has no authentication, so keep it on localhost unless you put something in front of it.

```
curl -X POST http://127.0.0.1:8787/analyze \
  -H 'content-type: application/json' \
  -d '{"pgn": "1. e4 e5 2. Nf3 Nc6", "ms": 300, "depth": 8}'
```

Request: `pgn` (one game), optional `ms` (50 to 5000 per position) and `depth` (1 to 14).
Response: `headers`, `opening`, `parseError`, `engine`, `summary` (per side: `accuracy`, `averageCentipawnLoss`, `counts`) and `moves[]` with `san`, `uci`, `class`, `evalBefore`, `evalAfter`, `bestMove`, `bestMoveSan`, `winChanceBefore`, `winChanceAfter`, `centipawnLoss`, `accuracy`. Evaluations are from White's point of view: `{cp, mate}` where `mate` is a signed number of moves.

## Node module

```js
const { analyze } = require('./src/review.js');
const review = analyze(pgnText, { ms: 300, depth: 8 });
```

## How it works, and its limits

- The engine is a small alpha-beta searcher over a 0x88 board (`src/engine.js`). It is tested against standard perft counts, but it is **not Stockfish**. At the default setting it searches roughly 6 plies, so it catches hanging pieces and short tactics but can miss deeper ideas. Results can vary slightly between runs because search is time-limited.
- Move grades use win-probability loss, and accuracy uses a logistic win-percentage model. These formulas are published by Lichess; this project reimplements them from the published description and does not use any Lichess code.
- The opening table (`src/openings.js`) is a short hand-written list, not a full opening database.
- `web/app.js` and `src/review.js` contain parallel grading code. If you change thresholds, change both.

## Best moves per position

Every position gets its top N moves (default 3, set with the Lines menu, `--lines`, or `lines` in the API). The web page shows them under the board with the move that was actually played marked, and draws them as numbered arrows. In JSON each move has a `candidates` array for the position it was played from.

## Explorer and playing moves

The Explorer tab lists the top moves for whatever position is on the board, automatically. Tap a piece, then a square, to play your own move (pawns promote to a queen); this starts a variation with its own top moves. Use the back and forward buttons to step through it, or "Back to game". "Search deeper" runs a longer 6-move search for the current position.

## Optional AI coach

The engine and review run fully offline in the browser. For plain-English explanations, tap AI, pick a provider (OpenAI-compatible including OpenRouter, Groq, DeepSeek, Ollama and LM Studio via a base URL; Anthropic; or Google Gemini), enter a model and key, then tap "Explain this position with AI". The key is kept in this browser's local storage and sent only to that provider. It works from the downloaded HTML file or your own server; sandboxed hosted pages may block outside requests.

## Tests

`npm test` runs perft checks, PGN parsing and an end-to-end review of `examples/sample.pgn`.

## License

MIT, see `LICENSE`. This project is not affiliated with Chess.com or Lichess.
The web page loads two fonts (Bricolage Grotesque and IBM Plex, both SIL Open Font License) from Google Fonts at view time; they are not bundled in this repository.

## Live page

Once GitHub Pages is switched on (Settings, Pages, branch `main`, folder `/ (root)`), the app is at https://syeliqx.github.io/pgn-review/ . `index.html` in the repo root is the built single-file app; rebuild it with `node build.js` and copy `dist/index.html` over it after changing `web/` or `src/`.
