document.getElementById('year').textContent = new Date().getFullYear();

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* revela secoes ao rolar */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* emblema interativo: tilt 3D + brilho seguindo o mouse */
const hero = document.getElementById('hero');
const emblemWrap = document.getElementById('emblem-wrap');
const emblem = document.getElementById('emblem');
const heroGlow = document.getElementById('hero-glow');

if (hero && emblem && heroGlow) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  hero.addEventListener('pointermove', e => {
    if (prefersReducedMotion) return;
    const rect = hero.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    heroGlow.style.left = `${px * 100}%`;
    heroGlow.style.top = `${py * 100}%`;
    heroGlow.style.opacity = '1';

    const wrapRect = emblemWrap.getBoundingClientRect();
    const ex = (e.clientX - wrapRect.left) / wrapRect.width - 0.5;
    const ey = (e.clientY - wrapRect.top) / wrapRect.height - 0.5;
    const rotY = Math.max(-1, Math.min(1, ex)) * 22;
    const rotX = Math.max(-1, Math.min(1, ey)) * -22;
    emblem.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.05)`;
  });

  hero.addEventListener('pointerleave', () => {
    heroGlow.style.opacity = '0.6';
    emblem.style.transform = 'rotateX(0deg) rotateY(0deg) scale(1)';
  });
}

/* nav mobile toggle */
const navToggle = document.getElementById('nav-toggle');
const nav = document.getElementById('nav');
navToggle.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
  navToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
});
nav.querySelectorAll('a:not(#account-link)').forEach(link => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

/* auth overlay */
const accountLink = document.getElementById('account-link');
const authOverlay = document.getElementById('auth-overlay');
const authClose = document.getElementById('auth-close');
const authTabs = document.getElementById('auth-tabs');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const painel = document.getElementById('painel');

let currentUser = null;

function openAuth() {
  authOverlay.hidden = false;
}
function closeAuth() {
  authOverlay.hidden = true;
  document.getElementById('login-msg').textContent = '';
  document.getElementById('register-msg').textContent = '';
}

accountLink.addEventListener('click', e => {
  e.preventDefault();
  if (currentUser) {
    logout();
  } else {
    openAuth();
  }
});
authClose.addEventListener('click', closeAuth);
authOverlay.addEventListener('click', e => { if (e.target === authOverlay) closeAuth(); });

authTabs.addEventListener('click', e => {
  const btn = e.target.closest('.auth-tab');
  if (!btn) return;
  authTabs.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  loginForm.hidden = tab !== 'login';
  registerForm.hidden = tab !== 'register';
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const msg = document.getElementById('login-msg');
  msg.textContent = '';
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pass }) });
  if (res.ok) {
    closeAuth();
    loginForm.reset();
    refreshAccount();
  } else {
    msg.textContent = 'usuário ou senha incorretos';
  }
});

registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('reg-user').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const msg = document.getElementById('register-msg');
  msg.textContent = '';
  const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pass }) });
  if (res.ok) {
    closeAuth();
    registerForm.reset();
    refreshAccount();
  } else {
    const data = await res.json().catch(() => ({}));
    msg.textContent = data.error || 'erro ao criar conta';
  }
});

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  refreshAccount();
}

async function refreshAccount() {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (data.authenticated) {
    currentUser = data;
    accountLink.textContent = `Sair (${data.username})`;
  } else {
    currentUser = null;
    accountLink.textContent = 'Entrar';
  }
  painel.hidden = !(currentUser && currentUser.role === 'admin');
  if (!painel.hidden) {
    loadPosts();
    loadUsers();
  }
}

/* feed publico */
function renderFeed(posts) {
  const feed = document.getElementById('feed');
  if (!posts.length) {
    feed.innerHTML = '<div class="feed-empty">nenhum comunicado publicado ainda</div>';
    return;
  }
  feed.innerHTML = posts.map(p => `
    <div class="feed-item">
      <div class="date">${fmtDate(p.created_at)}</div>
      <div>
        ${p.tag ? `<span class="tag-pill">${esc(p.tag)}</span>` : ''}
        <h4>${esc(p.title)}</h4>
        <p>${esc(p.body)}</p>
      </div>
    </div>
  `).join('');
}

async function loadPublicFeed() {
  try {
    const res = await fetch('/api/posts');
    renderFeed(await res.json());
  } catch {
    document.getElementById('feed').innerHTML = '<div class="feed-empty">não foi possível carregar os comunicados</div>';
  }
}

/* painel adm: posts */
let editingId = null;
const fTitle = document.getElementById('f-title');
const fTag = document.getElementById('f-tag');
const fBody = document.getElementById('f-body');
const saveBtn = document.getElementById('save-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const formMsg = document.getElementById('form-msg');

function resetForm() {
  editingId = null;
  fTitle.value = '';
  fTag.value = '';
  fBody.value = '';
  saveBtn.textContent = 'Publicar';
  cancelEditBtn.hidden = true;
}
cancelEditBtn.addEventListener('click', resetForm);

saveBtn.addEventListener('click', async () => {
  const title = fTitle.value.trim();
  const tag = fTag.value.trim();
  const body = fBody.value.trim();
  formMsg.textContent = '';
  if (!title || !body) {
    formMsg.textContent = 'título e conteúdo são obrigatórios';
    return;
  }
  const url = editingId ? `/api/posts/${editingId}` : '/api/posts';
  const method = editingId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, tag, body }) });
  if (res.ok) {
    resetForm();
    loadPosts();
    loadPublicFeed();
  } else {
    formMsg.textContent = 'erro ao salvar';
  }
});

async function loadPosts() {
  const res = await fetch('/api/posts');
  const posts = await res.json();
  const list = document.getElementById('posts-list');
  if (!posts.length) {
    list.innerHTML = '<p class="empty-hint">nenhuma publicação ainda</p>';
    return;
  }
  list.innerHTML = posts.map(p => `
    <div class="list-row">
      <div>
        <h4>${esc(p.title)}</h4>
        <p>${esc(p.body)}</p>
      </div>
      <div class="list-actions">
        <button class="btn-secondary" data-edit="${p.id}">Editar</button>
        <button class="btn-danger" data-del="${p.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = posts.find(p => p.id === Number(btn.dataset.edit));
      editingId = post.id;
      fTitle.value = post.title;
      fTag.value = post.tag || '';
      fBody.value = post.body;
      saveBtn.textContent = 'Salvar edição';
      cancelEditBtn.hidden = false;
      painel.scrollIntoView({ behavior: 'smooth' });
    });
  });

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta publicação?')) return;
      await fetch(`/api/posts/${btn.dataset.del}`, { method: 'DELETE' });
      loadPosts();
      loadPublicFeed();
    });
  });
}

/* painel adm: usuarios */
async function loadUsers() {
  const res = await fetch('/api/users');
  if (!res.ok) return;
  const users = await res.json();
  const list = document.getElementById('users-list');
  if (!users.length) {
    list.innerHTML = '<p class="empty-hint">nenhum usuário cadastrado</p>';
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="list-row">
      <div>
        <h4>${esc(u.username)}${u.role === 'admin' ? '<span class="role-pill">ADM</span>' : ''}</h4>
        <p>cadastrado em ${fmtDate(u.created_at)}</p>
      </div>
      <div class="list-actions">
        ${u.role !== 'admin' ? `<button class="btn-danger" data-deluser="${u.id}">Excluir</button>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-deluser]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir este usuário?')) return;
      await fetch(`/api/users/${btn.dataset.deluser}`, { method: 'DELETE' });
      loadUsers();
    });
  });
}

refreshAccount();
loadPublicFeed();
