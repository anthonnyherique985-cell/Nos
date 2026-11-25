const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'data', 'site.db');
const db = new DatabaseSync(DB_PATH);

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

// migra bancos de versoes antigas: sessions sem user_id, ou tabela "admins" antiga
if (tableExists('sessions') && !columnExists('sessions', 'user_id')) {
  db.exec('DROP TABLE sessions');
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tag TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

if (tableExists('admins')) {
  const legacyAdmins = db.prepare('SELECT * FROM admins').all();
  for (const a of legacyAdmins) {
    const already = db.prepare('SELECT id FROM users WHERE username = ?').get(a.user);
    if (!already) {
      db.prepare('INSERT INTO users (username, salt, hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(a.user, a.salt, a.hash, 'admin', new Date().toISOString());
    }
  }
  db.exec('DROP TABLE admins');
}

function hashPassword(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}

function createUser(username, pass, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(pass, salt);
  const createdAt = new Date().toISOString();
  return db.prepare('INSERT INTO users (username, salt, hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, salt, hash, role, createdAt);
}

function ensureDefaultAdmin() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get();
  if (row.c === 0) {
    const user = process.env.ADMIN_USER || 'no$$';
    const pass = process.env.ADMIN_PASS || '$$$';
    createUser(user, pass, 'admin');
    console.log(`Conta ADM criada -> usuario: ${user} | senha: ${pass} (troque depois)`);
  }
}
ensureDefaultAdmin();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(row.user_id);
  return user || null;
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';').map(p => p.trim());
  for (const p of parts) {
    const [k, ...v] = p.split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('nao encontrado');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const USERNAME_RE = /^[a-zA-Z0-9_$.\-]{3,32}$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/register' && req.method === 'POST') {
    try {
      const { username, pass } = await readBody(req);
      if (!username || !pass || !USERNAME_RE.test(username) || pass.length < 3) {
        return sendJson(res, 400, { error: 'usuario (3-32 caracteres) e senha (min 3) sao obrigatorios' });
      }
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) return sendJson(res, 409, { error: 'usuario ja existe' });
      const info = createUser(username, pass, 'user');
      const token = createSession(Number(info.lastInsertRowid));
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict`);
      return sendJson(res, 201, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: 'requisicao invalida' });
    }
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const { username, pass } = await readBody(req);
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
      if (!row) return sendJson(res, 401, { error: 'credenciais invalidas' });
      const hash = hashPassword(pass || '', row.salt);
      if (hash !== row.hash) return sendJson(res, 401, { error: 'credenciais invalidas' });
      const token = createSession(row.id);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict`);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: 'requisicao invalida' });
    }
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = getCookie(req, 'session');
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    const token = getCookie(req, 'session');
    const user = getSessionUser(token);
    if (!user) return sendJson(res, 200, { authenticated: false });
    return sendJson(res, 200, { authenticated: true, username: user.username, role: user.role });
  }

  if (pathname === '/api/users' && req.method === 'GET') {
    const token = getCookie(req, 'session');
    const user = getSessionUser(token);
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'acesso negado' });
    const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id DESC').all();
    return sendJson(res, 200, rows);
  }

  if (pathname === '/api/posts' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM posts ORDER BY id DESC').all();
    return sendJson(res, 200, rows);
  }

  if (pathname === '/api/posts' && req.method === 'POST') {
    const token = getCookie(req, 'session');
    const user = getSessionUser(token);
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'acesso negado' });
    try {
      const { title, body, tag } = await readBody(req);
      if (!title || !body) return sendJson(res, 400, { error: 'titulo e conteudo sao obrigatorios' });
      const createdAt = new Date().toISOString();
      const info = db.prepare('INSERT INTO posts (title, body, tag, created_at) VALUES (?, ?, ?, ?)').run(title, body, tag || null, createdAt);
      return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
    } catch (e) {
      return sendJson(res, 400, { error: 'requisicao invalida' });
    }
  }

  const postIdMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (postIdMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const token = getCookie(req, 'session');
    const user = getSessionUser(token);
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'acesso negado' });
    const id = Number(postIdMatch[1]);
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM posts WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
    try {
      const { title, body, tag } = await readBody(req);
      if (!title || !body) return sendJson(res, 400, { error: 'titulo e conteudo sao obrigatorios' });
      db.prepare('UPDATE posts SET title = ?, body = ?, tag = ? WHERE id = ?').run(title, body, tag || null, id);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: 'requisicao invalida' });
    }
  }

  const userIdMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userIdMatch && req.method === 'DELETE') {
    const token = getCookie(req, 'session');
    const user = getSessionUser(token);
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'acesso negado' });
    const id = Number(userIdMatch[1]);
    if (id === user.id) return sendJson(res, 400, { error: 'nao pode excluir a propria conta' });
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/') return serveStatic(req, res, path.join(PUBLIC_DIR, 'index.html'));

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('proibido');
  }
  return serveStatic(req, res, filePath);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NO$ rodando em http://localhost:${PORT}`));
