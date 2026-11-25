const loginView = document.getElementById('login-view');
const dashView = document.getElementById('dash-view');
let editingId = null;

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showDash() {
  loginView.style.display = 'none';
  dashView.style.display = 'block';
  loadPosts();
}

function showLogin() {
  loginView.style.display = 'block';
  dashView.style.display = 'none';
}

fetch('/api/me').then(r => r.json()).then(d => d.authenticated ? showDash() : showLogin());

document.getElementById('login-btn').addEventListener('click', async () => {
  const user = document.getElementById('user').value.trim();
  const pass = document.getElementById('pass').value;
  const msg = document.getElementById('login-msg');
  msg.textContent = '';
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass }) });
  if (res.ok) showDash();
  else msg.textContent = 'usuário ou senha incorretos';
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

function resetForm() {
  editingId = null;
  document.getElementById('f-title').value = '';
  document.getElementById('f-tag').value = '';
  document.getElementById('f-body').value = '';
  document.getElementById('save-btn').textContent = 'Publicar';
  document.getElementById('cancel-edit-btn').style.display = 'none';
}

document.getElementById('cancel-edit-btn').addEventListener('click', resetForm);

document.getElementById('save-btn').addEventListener('click', async () => {
  const title = document.getElementById('f-title').value.trim();
  const tag = document.getElementById('f-tag').value.trim();
  const body = document.getElementById('f-body').value.trim();
  const msg = document.getElementById('form-msg');
  msg.textContent = '';
  if (!title || !body) {
    msg.textContent = 'título e conteúdo são obrigatórios';
    return;
  }
  const url = editingId ? `/api/posts/${editingId}` : '/api/posts';
  const method = editingId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, tag, body }) });
  if (res.ok) {
    resetForm();
    loadPosts();
  } else {
    msg.textContent = 'erro ao salvar';
  }
});

async function loadPosts() {
  const res = await fetch('/api/posts');
  const posts = await res.json();
  const list = document.getElementById('posts-list');
  if (!posts.length) {
    list.innerHTML = '<p style="color:var(--muted)">nenhuma publicação ainda</p>';
    return;
  }
  list.innerHTML = posts.map(p => `
    <div class="post-row">
      <div>
        <h4>${esc(p.title)}</h4>
        <p>${esc(p.body)}</p>
      </div>
      <div class="post-actions">
        <button class="secondary" data-edit="${p.id}">Editar</button>
        <button class="danger" data-del="${p.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = posts.find(p => p.id === Number(btn.dataset.edit));
      editingId = post.id;
      document.getElementById('f-title').value = post.title;
      document.getElementById('f-tag').value = post.tag || '';
      document.getElementById('f-body').value = post.body;
      document.getElementById('save-btn').textContent = 'Salvar edição';
      document.getElementById('cancel-edit-btn').style.display = 'inline-block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta publicação?')) return;
      await fetch(`/api/posts/${btn.dataset.del}`, { method: 'DELETE' });
      loadPosts();
    });
  });
}
