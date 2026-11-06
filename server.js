#!/usr/bin/env node
'use strict';
// Small local HTTP API. No dependencies.
//   POST /analyze   {"pgn": "...", "ms": 300, "depth": 8}  ->  review JSON
//   GET  /health    ->  {"ok":true}
//   GET  /          ->  the web page, if you have run `npm run build`
const http = require('http');
const fs = require('fs');
const path = require('path');
const { analyze } = require('./src/review.js');

const PORT = Number(process.env.PORT || process.argv[2]) || 8787;
const HOST = process.env.HOST || '127.0.0.1';      // local only unless you change it
const MAX_BODY = 1024 * 1024;                       // 1 MB
const MAX_PLIES_MS = 600000;                        // cap total engine time per request (10 min)

const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url === '/') {
    const f = path.join(__dirname, 'dist', 'index.html');
    if (!fs.existsSync(f)) return send(res, 404, { error: 'Run "npm run build" to create dist/index.html' });
    return send(res, 200, fs.readFileSync(f), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && url === '/analyze') {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { send(res, 413, { error: 'Body too large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (e) { return send(res, 400, { error: 'Body must be JSON: {"pgn": "..."}' }); }
      if (!body || typeof body.pgn !== 'string' || !body.pgn.trim()) return send(res, 400, { error: 'Missing "pgn" string' });
      const ms = Math.min(5000, Math.max(50, Number(body.ms) || 300));
      const depth = Math.min(14, Math.max(1, Number(body.depth) || 8));
      // rough guard: positions * ms must stay within the cap
      const positions = (body.pgn.match(/[a-hKQRBNO][\w=+#-]*/g) || []).length;
      if (positions * ms > MAX_PLIES_MS) return send(res, 413, { error: 'Game too long for that "ms" setting' });
      try { send(res, 200, analyze(body.pgn, { ms, depth, lines: Math.min(6, Math.max(1, Number(body.lines) || 3)) })); }
      catch (e) { send(res, 422, { error: e.message }); }
    });
    return;
  }
  send(res, 404, { error: 'Not found' });
}).listen(PORT, HOST, () => console.log('pgn-review API on http://' + HOST + ':' + PORT));
