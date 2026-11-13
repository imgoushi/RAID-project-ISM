'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const raid = require('./backend/raid');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) { req.destroy(); reject(new Error('Body too large')); } });
  req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body.')); } });
});

async function api(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && url.pathname === '/api/levels') return json(res, 200, Object.values(raid.LEVELS));
    if (req.method === 'GET' && url.pathname === '/api/calculate') return json(res, 200, raid.calculate(q.level, q.disks, q.size));
    if (req.method === 'GET' && url.pathname === '/api/layout') return json(res, 200, raid.layout(q.level, q.disks, q.rows));
    if (req.method === 'POST' && url.pathname === '/api/simulate') {
      const b = await readBody(req); return json(res, 200, raid.simulate(b.level, b.disks, b.failed));
    }
    if (req.method === 'POST' && url.pathname === '/api/recommend') return json(res, 200, raid.recommend(await readBody(req)));
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  serveStatic(req, res, url);
}).listen(PORT, () => console.log(`RAID Explorer running at http://localhost:${PORT}`));
