// Painel admin (sem build: JavaScript puro). Fala com admin/index.ts em /admin/api/* com o cabeçalho x-admin: 1.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch('/admin/api' + path, { ...opts, headers: { 'x-admin': '1', 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Falha (${r.status})`);
  return body;
}
const say = (el, text, error = false) => { el.textContent = text; el.classList.toggle('error', error); };
const fmtUp = (ms) => { if (!ms) return '—'; const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`; };
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// ---------------- navegação ----------------
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'view-' + view;
  for (const a of document.querySelectorAll('#side a[data-view]')) a.classList.toggle('on', a.dataset.view === view);
  if (view === 'account') loadAccounts();
  else if (view === 'world') loadRates();
  else if (view === 'database') loadDb();
  else if (view === 'items') loadItems();
  else if (view === 'skills') loadSkills();
  else if (view === 'loadtest') loadLoadtest(true);
  else refresh();
}
addEventListener('hashchange', () => show(location.hash.slice(1) || 'dashboard'));

// ---------------- dashboard ----------------
const samples = []; // { t, msgs, players }
let lastCounts = null, lastLog = 0;
const STATUS_TXT = { parado: 'parado', iniciando: 'iniciando…', rodando: 'rodando', parando: 'parando…', compilando: 'compilando…', erro: 'parou com erro' };

async function refresh() {
  let s;
  try { s = await api('/status?since=' + lastLog); } catch (e) { say($('dashMsg'), 'Painel sem resposta: ' + e.message, true); return; }
  const g = s.game, db = s.db;
  const running = g.status === 'rodando';
  // contadores → mensagens por segundo
  const now = Date.now(), total = g.msgIn + g.msgOut;
  let rate = 0;
  if (lastCounts && running && total >= lastCounts.total) rate = (total - lastCounts.total) / ((now - lastCounts.t) / 1000);
  lastCounts = running ? { t: now, total } : null;
  samples.push({ t: now, msgs: rate, players: g.players.length });
  if (samples.length > 90) samples.shift();

  $('sPlayers').textContent = g.players.length;
  $('sServices').textContent = `${(running ? 1 : 0) + (db.ok ? 1 : 0)}/2`;
  $('sConns').textContent = g.connections;
  $('sUptime').textContent = fmtUp(g.uptimeMs);
  $('sStatus').textContent = STATUS_TXT[g.status] || g.status;

  const gd = $('svcGame').querySelector('.dot');
  gd.className = 'dot' + (running ? ' up' : ['iniciando', 'parando', 'compilando'].includes(g.status) ? ' wait' : '');
  $('gPort').textContent = ':' + g.port;
  $('gLat').textContent = g.latencyMs != null ? g.latencyMs + ' ms' : '—';
  $('gRam').textContent = g.rssMb != null ? g.rssMb + ' MB' : '—';
  $('gUp').textContent = fmtUp(g.uptimeMs);
  $('gPid').textContent = g.pid ?? '—';
  $('gSess').textContent = running ? g.sessions : '—';
  $('gMsg').textContent = running ? rate.toFixed(1) : '—';
  $('gMobs').textContent = running ? g.mobs : '—';
  const dd = $('svcDb').querySelector('.dot');
  dd.className = 'dot' + (db.ok ? ' up' : '');
  $('dLat').textContent = db.ok ? db.latencyMs + ' ms' : 'fora do ar';
  $('dSize').textContent = db.ok ? db.sizeMb + ' MB' : '—';
  $('dAcc').textContent = db.ok ? db.accounts : '—';
  $('dChar').textContent = db.ok ? db.characters : '—';

  $('btnStart').disabled = !!g.pid || g.status === 'compilando';
  $('btnStop').disabled = !g.pid || g.status === 'parando';
  $('btnRestart').disabled = !g.pid || g.status !== 'rodando';
  $('btnBuild').disabled = g.status === 'compilando';
  if (!g.distReady && !g.pid) say($('dashMsg'), 'O jogo ainda não foi compilado: clique em "Compilar" antes de iniciar.', true);

  $('onlineRows').innerHTML = g.players.length
    ? g.players.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.level}</td><td>#${p.accountId}</td><td>${p.p[0].toFixed(0)}, ${p.p[2].toFixed(0)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="empty">${running ? 'Ninguém online.' : 'Servidor do jogo parado.'}</td></tr>`;

  if (s.logs.length) {
    const box = $('logBox');
    for (const l of s.logs) {
      const line = document.createElement('span');
      line.className = l.src;
      line.textContent = `[${new Date(l.t).toLocaleTimeString('pt-BR')}] ${l.src === 'jogo' ? '' : l.src + ': '}${l.text}\n`;
      box.appendChild(line);
      lastLog = Math.max(lastLog, l.t);
    }
    while (box.childNodes.length > 600) box.removeChild(box.firstChild);
    if ($('logFollow').checked) box.scrollTop = box.scrollHeight;
  }
  drawChart();
}

function drawChart() {
  const c = $('chart'), dpr = devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const max = Math.max(2, ...samples.map((s) => Math.max(s.msgs, s.players)));
  const top = Math.ceil(max * 1.15);
  g.strokeStyle = '#1f2b40'; g.fillStyle = '#5d6c84'; g.font = '11px system-ui'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ((h - pad.t - pad.b) * i) / 4;
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    const v = top - (top * i) / 4;
    g.fillText(top < 8 ? v.toFixed(1) : String(Math.round(v)), 4, y + 4);
  }
  const plot = (key, color) => {
    if (samples.length < 2) return;
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    samples.forEach((s, i) => {
      const x = pad.l + ((w - pad.l - pad.r) * (i + (90 - samples.length))) / 89;
      const y = pad.t + (h - pad.t - pad.b) * (1 - s[key] / top);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  };
  plot('msgs', '#2dd4bf');
  plot('players', '#a78bfa');
  $('chartNote').textContent = samples.length < 2 ? 'aguardando dados…' : 'últimos 3 minutos';
}

async function action(path, label) {
  say($('dashMsg'), label + '…');
  try { await api(path, { method: 'POST' }); say($('dashMsg'), label + ': ok.'); } catch (e) { say($('dashMsg'), e.message, true); }
  refresh();
}
$('btnStart').onclick = () => action('/game/start', 'Iniciando o servidor');
$('btnStop').onclick = () => { if (confirm('Parar o servidor do jogo? Quem estiver online será desconectado.')) action('/game/stop', 'Parando o servidor'); };
$('btnRestart').onclick = () => { if (confirm('Reiniciar o servidor do jogo? Quem estiver online será desconectado.')) action('/game/restart', 'Reiniciando o servidor'); };
$('btnBuild').onclick = () => action('/game/build', 'Compilação iniciada (acompanhe nos logs)');
$('btnRefresh').onclick = refresh;
setInterval(() => { if (!$('view-dashboard').hidden && !document.hidden) refresh(); }, 2000);

// ---------------- contas ----------------
const acc = { page: 1, size: 25, user: '', nick: '', total: 0 };
async function loadAccounts() {
  const q = new URLSearchParams({ page: acc.page, size: acc.size, user: acc.user, nick: acc.nick });
  let r;
  try { r = await api('/accounts?' + q); } catch (e) { say($('accMsg'), e.message, true); return; }
  acc.total = r.total;
  const pages = Math.max(1, Math.ceil(r.total / r.size));
  $('pgInfo').textContent = `Página ${r.page} de ${pages} · ${r.total} conta(s)`;
  $('pgPrev').disabled = r.page <= 1;
  $('pgNext').disabled = r.page >= pages;
  if (!r.rows.length) { $('accRows').innerHTML = '<tr><td colspan="7" class="empty">Nenhuma conta encontrada.</td></tr>'; return; }
  const now = Date.now();
  $('accRows').innerHTML = r.rows.map((a) => {
    const banned = a.blockedUntil && new Date(a.blockedUntil).getTime() > now;
    const level = a.characters.length ? Math.max(...a.characters.map((c) => c.level)) : '—';
    const banTxt = banned ? `<span class="badge ban" title="até ${fmtDate(a.blockedUntil)}">${new Date(a.blockedUntil).getFullYear() >= 2100 ? 'permanente' : 'até ' + fmtDate(a.blockedUntil)}</span>` : '—';
    return `<tr>
      <td><b>${esc(a.username)}</b>${a.hasPassword ? '' : ' <span class="dim" title="sem senha do jogo web">(sem senha)</span>'}<br><small class="dim">criada ${fmtDate(a.createdAt)} · último login ${fmtDate(a.lastLoginAt)}</small></td>
      <td class="tags">${a.characters.map((c) => `<span>${esc(c.name)}</span>`).join('') || '<span class="dim">—</span>'}</td>
      <td>${a.authority === 'Z' ? '<span class="badge adm">Dono</span>' : a.authority !== 'F' ? '<span class="badge adm">GM</span>' : 'Jogador'}</td>
      <td>${level}</td>
      <td>${a.online ? `<span class="badge on">${esc(a.online)}</span>` : '<span class="dim">offline</span>'}</td>
      <td>${banTxt}</td>
      <td class="acts">
        <button class="btn sm" data-act="kick" data-id="${a.id}" data-name="${esc(a.username)}" ${a.online ? '' : 'disabled'}>Kick</button>
        ${banned ? `<button class="btn sm ok" data-act="unban" data-id="${a.id}" data-name="${esc(a.username)}">Desbanir</button>`
                 : `<button class="btn sm stop" data-act="ban" data-id="${a.id}" data-name="${esc(a.username)}">Banir</button>`}
        <button class="btn sm" data-act="password" data-id="${a.id}" data-name="${esc(a.username)}">Senha</button>
      </td></tr>`;
  }).join('');
}

function ask(dlg, who) {
  dlg.querySelector('.who').textContent = who;
  return new Promise((resolve) => { dlg.onclose = () => resolve(dlg.returnValue === 'ok'); dlg.returnValue = ''; dlg.showModal(); });
}

$('accRows').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id, name = b.dataset.name;
  try {
    if (b.dataset.act === 'kick') {
      const r = await api(`/accounts/${id}/kick`, { method: 'POST' });
      say($('accMsg'), `${name}: ${r.kicked} conexão(ões) derrubada(s).`);
    } else if (b.dataset.act === 'ban') {
      if (!(await ask($('dlgBan'), name))) return;
      const r = await api(`/accounts/${id}/ban`, { method: 'POST', body: JSON.stringify({ days: Number($('banDays').value) }) });
      say($('accMsg'), `${name} banido ${Number($('banDays').value) ? 'até ' + fmtDate(r.until) : 'permanentemente'}${r.kicked ? ' e desconectado' : ''}.`);
    } else if (b.dataset.act === 'unban') {
      await api(`/accounts/${id}/unban`, { method: 'POST' });
      say($('accMsg'), `${name} desbanido.`);
    } else if (b.dataset.act === 'password') {
      $('newPass').value = '';
      if (!(await ask($('dlgPass'), name))) return;
      await api(`/accounts/${id}/password`, { method: 'POST', body: JSON.stringify({ password: $('newPass').value }) });
      say($('accMsg'), `Senha de ${name} alterada.`);
    }
  } catch (e) { say($('accMsg'), e.message, true); }
  loadAccounts();
});

$('searchForm').onsubmit = (ev) => { ev.preventDefault(); acc.user = $('qUser').value.trim(); acc.nick = $('qNick').value.trim(); acc.page = 1; loadAccounts(); };
$('btnClear').onclick = () => { $('qUser').value = $('qNick').value = ''; acc.user = acc.nick = ''; acc.page = 1; loadAccounts(); };
$('btnSync').onclick = loadAccounts;
$('pgPrev').onclick = () => { acc.page--; loadAccounts(); };
$('pgNext').onclick = () => { acc.page++; loadAccounts(); };
$('pgSize').onchange = () => { acc.size = Number($('pgSize').value); acc.page = 1; loadAccounts(); };
$('createForm').onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    await api('/accounts', { method: 'POST', body: JSON.stringify({ username: $('cUser').value, password: $('cPass').value, nickname: $('cNick').value, authority: $('cAuth').value }) });
    say($('accMsg'), `Conta ${$('cUser').value} criada.`);
    $('createForm').reset();
    loadAccounts();
  } catch (e) { say($('accMsg'), e.message, true); }
};
$('unbanForm').onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    const r = await api('/accounts/unban-by-name', { method: 'POST', body: JSON.stringify({ name: $('unbanName').value }) });
    say($('accMsg'), `Ban removido: ${r.usernames.join(', ')}.`);
    $('unbanName').value = '';
    loadAccounts();
  } catch (e) { say($('accMsg'), e.message, true); }
};

// ---------------- world: taxas do servidor ----------------
async function loadRates() {
  try {
    const r = await api('/rates');
    $('rExp').value = r.rates.exp; $('rPenya').value = r.rates.penya; $('rDrop').value = r.rates.drop;
    $('rFile').textContent = r.file;
  } catch (e) { say($('worldMsg'), e.message, true); }
}
$('ratesForm').onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    const r = await api('/rates', { method: 'PUT', body: JSON.stringify({ exp: $('rExp').value, penya: $('rPenya').value, drop: $('rDrop').value }) });
    say($('worldMsg'), `Taxas salvas: EXP ${r.rates.exp}x · Penya ${r.rates.penya}x · Drop ${r.rates.drop}x. O jogo aplica em até 2 segundos.`);
  } catch (e) { say($('worldMsg'), e.message, true); }
};

// ---------------- world: anúncio para todos ----------------
$('annText').oninput = () => {
  const t = $('annText').value.trim();
  $('annPreview').textContent = t || 'Prévia da mensagem';
  $('annCount').textContent = $('annText').value.length;
};
$('announceForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const text = $('annText').value.trim();
  if (!text) return;
  try {
    if ($('annLoop').checked) {
      // em loop: o painel manda agora e repete sozinho, mesmo com esta página fechada
      const r = await api('/announce/loop', { method: 'POST', body: JSON.stringify({ text, loops: Number($('annLoops').value), every: Number($('annEvery').value) }) });
      annRender(r);
      say($('worldMsg'), `Mensagem em loop a cada ${$('annEvery').selectedOptions[0].textContent}.` + (r.sent == null ? ' (O jogo não respondeu agora; tenta de novo no próximo intervalo.)' : ` Enviada agora para ${r.sent} jogador(es).`));
      return;
    }
    const r = await api('/announce', { method: 'POST', body: JSON.stringify({ text, loops: Number($('annLoops').value) }) });
    say($('worldMsg'), r.sent ? `Mensagem enviada para ${r.sent} jogador(es) online.` : 'Mensagem enviada, mas ninguém está online agora.');
    $('annText').value = ''; $('annText').oninput();
  } catch (e) { say($('worldMsg'), e.message, true); }
};

// ---------------- world: slots de mensagens guardadas e loop ----------------
let annSlots = [];
function annRender(st) {
  annSlots = st.slots || [];
  const box = $('annSlots');
  box.replaceChildren();
  annSlots.forEach((t, i) => {
    const b = document.createElement('div');
    b.className = 'ann-slot' + (t ? ' full' : '');
    b.tabIndex = 0;
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', t ? `Usar mensagem guardada ${i + 1}: ${t}` : `Slot ${i + 1} vazio`);
    const h = document.createElement('b'); h.textContent = `SLOT ${i + 1}`;
    b.append(h, document.createTextNode(t || 'vazio — arraste o texto aqui'));
    if (t) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'Apagar este slot'; x.setAttribute('aria-label', `Apagar slot ${i + 1}`);
      x.onclick = (e) => { e.stopPropagation(); annSetSlot(i, ''); };
      b.append(x);
    }
    const use = () => { if (!t) return; $('annText').value = t; $('annText').oninput(); $('annText').focus(); };
    b.onclick = use;
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); use(); } };
    b.ondragover = (e) => { e.preventDefault(); b.classList.add('over'); };
    b.ondragleave = () => b.classList.remove('over');
    b.ondrop = (e) => { e.preventDefault(); b.classList.remove('over'); const txt = (e.dataTransfer.getData('text/plain') || '').replace(/\s+/g, ' ').trim().slice(0, 200); if (txt) annSetSlot(i, txt); };
    box.append(b);
  });
  const loop = st.loop;
  $('annStop').hidden = !loop;
  $('annLoopState').textContent = loop ? `Em loop: "${loop.text}" — a cada ${loop.every} min${st.nextAt ? `, próxima às ${new Date(st.nextAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.` : '';
}
async function annSetSlot(i, text) {
  const slots = [...annSlots]; slots[i] = text;
  try { annRender(await api('/announce/slots', { method: 'PUT', body: JSON.stringify({ slots }) })); } catch (e) { say($('worldMsg'), e.message, true); }
}
$('annPreview').ondragstart = (e) => {
  const t = $('annText').value.trim();
  if (!t) { e.preventDefault(); return; }
  e.dataTransfer.setData('text/plain', t);
  e.dataTransfer.effectAllowed = 'copy';
};
$('annStop').onclick = async () => {
  try { annRender(await api('/announce/loop', { method: 'DELETE' })); say($('worldMsg'), 'Loop parado.'); } catch (e) { say($('worldMsg'), e.message, true); }
};
api('/announce/state').then(annRender).catch(() => {});

show(location.hash.slice(1) || 'dashboard');


// ---------------- database: backup, baixar, apagar, restaurar e zerar ----------------
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
let dbState = null;
async function loadDb() {
  try { dbState = await api('/db'); } catch (e) {
    // painel aberto antes da atualização: a página é nova mas o servidor do painel ainda é o antigo (sem as rotas do banco)
    const old = /Rota desconhecida/.test(e.message);
    $('dbDot').className = 'dot';
    $('dbStatusText').textContent = old ? 'O painel precisa ser reiniciado para usar esta página: feche a janela do painel e abra de novo (.Iniciar Servidor.bat).' : 'Sem resposta do painel: ' + e.message;
    for (const id of ['cnSave', 'dbInstallBtn', 'dbBackupBtn', 'dbResetBtn']) $(id).disabled = true;
    say($('dbMsg'), '');
    return;
  }
  const s = dbState;
  const ok = s.health.state === 'ok';
  $('dbDot').className = 'dot' + (ok ? ' up' : '');
  $('dbStatusText').textContent = ok ? `Banco "${s.database}" conectado (${s.connection.user}@${s.connection.host}:${s.connection.port}).`
    : s.health.message + (s.health.state === 'missing' ? ' Use "2. Instalar banco zerado".' : s.health.state === 'auth' ? ' Confira o usuário e a senha em "1. Conexão" (ou instale o banco).' : '');
  $('dbName').textContent = s.database; $('dbUserName').textContent = s.user;
  // conexão: preenche (sem a senha) e trava o que vem do ambiente (Docker)
  const c = s.connection;
  for (const [id, k] of [['cnHost', 'host'], ['cnPort', 'port'], ['cnDb', 'database'], ['cnUser', 'user']]) {
    if (document.activeElement !== $(id)) $(id).value = c[k];
    $(id).disabled = !!c.fixed[k];
  }
  $('cnInfo').textContent = (c.hasPassword ? 'Senha salva.' : 'Nenhuma senha salva para este usuário.') + (Object.values(c.fixed).some(Boolean) ? ' Campos travados vêm das variáveis de ambiente (PG*).' : '');
  $('cnSave').disabled = s.gameRunning || s.siteRunning;
  $('dbInstallBtn').disabled = s.gameRunning || s.siteRunning;
  $('dbConnForm').classList.toggle('attention', s.health.state === 'auth');
  $('dbInstallForm').classList.toggle('attention', s.health.state === 'missing');
  $('dbBackupBtn').disabled = !ok;
  $('dbTools').textContent = s.tools.pgDump && s.tools.pgRestore ? 'Ferramentas do PostgreSQL encontradas (pg_dump / pg_restore).' : 'pg_dump/pg_restore não encontrados: instale o PostgreSQL ou ponha a pasta bin no PATH.';
  const busy = !ok || s.gameRunning || s.siteRunning || s.others.length > 0;
  $('dbInUse').textContent = !ok ? 'Travado: o banco não está acessível.' : s.gameRunning || s.siteRunning ? 'Travado: o servidor do jogo está rodando (Dashboard → Parar).' : s.others.length ? 'Travado: banco em uso por ' + s.others.join(', ') + '.' : 'Banco livre: pode zerar.';
  $('dbInUse').classList.toggle('bad', busy);
  $('dbResetBtn').disabled = busy;
  $('dbRows').innerHTML = s.backups.length
    ? s.backups.map((b) => `<tr><td class="dbname">${esc(b.name)}</td><td>${fmtDate(b.date)}</td><td>${fmtSize(b.size)}</td><td><div class="dbacts">
        <button class="btn sm" data-dl="${esc(b.name)}">⬇ Baixar</button>
        <button class="btn sm stop" data-restore="${esc(b.name)}" ${busy ? 'disabled title="Pare o servidor do jogo antes"' : ''}>Restaurar</button>
        <button class="btn sm" data-del="${esc(b.name)}">Apagar</button></div></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Nenhum backup ainda.</td></tr>';
}
$('dbRefresh').addEventListener('click', () => { say($('dbMsg'), ''); loadDb(); });
$('dbBackupForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('dbBackupBtn');
  btn.disabled = true; say($('dbMsg'), 'Fazendo backup…');
  try {
    const b = await api('/db/backup', { method: 'POST', body: JSON.stringify({ label: $('dbLabel').value }) });
    $('dbLabel').value = '';
    say($('dbMsg'), `Backup criado: ${b.name} (${fmtSize(b.size)}).`);
  } catch (e) { say($('dbMsg'), e.message, true); }
  btn.disabled = false; loadDb();
});
$('dbRows').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.dl) {
    // o download também passa pelo cabeçalho x-admin: baixa como blob e entrega pelo navegador
    try {
      const r = await fetch('/admin/api/db/backups/' + encodeURIComponent(t.dataset.dl), { headers: { 'x-admin': '1' } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Falha (${r.status})`);
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: t.dataset.dl });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { say($('dbMsg'), e.message, true); }
  } else if (t.dataset.del) {
    if (!confirm(`Apagar o backup ${t.dataset.del}? Não tem como desfazer.`)) return;
    try { await api('/db/backups/' + encodeURIComponent(t.dataset.del), { method: 'DELETE' }); say($('dbMsg'), 'Backup apagado.'); } catch (e) { say($('dbMsg'), e.message, true); }
    loadDb();
  } else if (t.dataset.restore) {
    const name = t.dataset.restore, dlg = $('dlgRestore');
    dlg.querySelector('.who').textContent = name;
    $('restoreConfirm').value = '';
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'ok') return;
      if ($('restoreConfirm').value.trim() !== name) { say($('dbMsg'), 'O nome digitado não confere: nada foi restaurado.', true); return; }
      say($('dbMsg'), 'Restaurando… (não feche o painel)');
      try {
        const r = await api('/db/restore', { method: 'POST', body: JSON.stringify({ name, confirm: name }) });
        say($('dbMsg'), `Restaurado ${name}. O estado anterior ficou salvo em ${r.backup.name}.`);
      } catch (e) { say($('dbMsg'), e.message, true); }
      loadDb();
    }, { once: true });
  }
});
$('dbResetForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if ($('dbResetConfirm').value.trim() !== 'ZERAR') { say($('dbMsg'), 'Digite ZERAR (em maiúsculas) para confirmar.', true); return; }
  const btn = $('dbResetBtn');
  btn.disabled = true; say($('dbMsg'), 'Zerando o banco… (não feche o painel)');
  try {
    const r = await api('/db/reset', { method: 'POST', body: JSON.stringify({ confirm: 'ZERAR' }) });
    $('dbResetConfirm').value = '';
    say($('dbMsg'), `Banco zerado (${r.migrations} migrações aplicadas). O estado anterior ficou salvo em ${r.backup.name}. Crie as contas de novo em Account.`);
  } catch (e) { say($('dbMsg'), e.message, true); }
  loadDb();
});

$('dbInstallForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('dbInstallBtn'), log = $('insLog');
  btn.disabled = true; say($('dbMsg'), 'Instalando o banco…'); log.hidden = true;
  try {
    const r = await api('/db/install', { method: 'POST', body: JSON.stringify({
      adminUser: $('insAdmin').value, adminPassword: $('insAdminPass').value,
      ownerUser: $('insOwner').value, ownerPassword: $('insOwnerPass').value }) });
    log.textContent = r.steps.join('\n'); log.hidden = false;
    say($('dbMsg'), `Banco instalado (${r.migrations} migrações).${r.ownerId ? ' Conta de dono criada.' : ' Crie as contas em Account.'}`);
  } catch (e) { say($('dbMsg'), e.message, true); }
  $('insAdminPass').value = ''; $('insOwnerPass').value = '';
  btn.disabled = false; loadDb();
});

$('dbConnForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('cnSave');
  btn.disabled = true; say($('dbMsg'), 'Salvando e testando a conexão…');
  try {
    const r = await api('/db/connection', { method: 'PUT', body: JSON.stringify({ host: $('cnHost').value, port: Number($('cnPort').value), database: $('cnDb').value, user: $('cnUser').value, password: $('cnPass').value }) });
    $('cnPass').value = '';
    say($('dbMsg'), r.health.state === 'ok' ? 'Conexão salva e funcionando.' : 'Conexão salva, mas: ' + r.health.message, r.health.state !== 'ok' && r.health.state !== 'missing');
  } catch (e) { say($('dbMsg'), e.message, true); }
  btn.disabled = false; loadDb();
});


// ---------------- items: lista, copiar ID, editar, criar, remover ----------------
let itMeta = null, itPage = 1, itTotal = 0, itTimer = 0, itEditing = null;
const iconUrl = (f) => (f ? '/admin/icons/' + encodeURIComponent(f) : '');
const nameOf = (list, v) => (list.find((x) => x[0] === v) || [, ''])[1];
const shortName = (s) => String(s).replace(/^(IK[123]|PARTS|ITEM_GRADE|JOB|WT)_/, '');
async function itLoadMeta() {
  if (itMeta) return itMeta;
  itMeta = await api('/items/meta');
  const fill = (sel, list, keep) => { for (const [v, n] of list) sel.insertAdjacentHTML('beforeend', `<option value="${v}">${esc(shortName(n))}</option>`); if (keep !== undefined) sel.value = keep; };
  fill($('itK1'), itMeta.ik1); fill($('itParts'), itMeta.parts); fill($('itGrade'), itMeta.grade);
  const opts = (list, none) => (none ? `<option value="${none[0]}">${none[1]}</option>` : '') + list.map(([v, n]) => `<option value="${v}">${esc(shortName(n))}</option>`).join('');
  $('ie_kind1').innerHTML = opts(itMeta.ik1, [0, '—']); $('ie_kind2').innerHTML = opts(itMeta.ik2, [0, '—']); $('ie_kind3').innerHTML = opts(itMeta.ik3, [0, '—']);
  $('ie_parts').innerHTML = opts(itMeta.parts, [-1, 'Não equipa']); $('ie_ignorePart').innerHTML = opts(itMeta.parts, [-1, 'Nenhuma']);
  $('ie_sex').innerHTML = opts(itMeta.sex); $('ie_job').innerHTML = opts(itMeta.job, [-1, 'Qualquer']); $('ie_weaponType').innerHTML = opts(itMeta.wt, [0, '—']);
  $('ie_handed').innerHTML = opts(itMeta.handed); $('ie_grade').innerHTML = opts(itMeta.grade); $('ie_element').innerHTML = opts(itMeta.element);
  $('ie_fx').innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="fxrow"><select data-fx="${i}" aria-label="Bônus ${i + 1}">${opts(itMeta.dst, [0, '— nenhum —'])}</select><input data-fxv="${i}" type="number" aria-label="Valor do bônus ${i + 1}" /></div>`).join('');
  return itMeta;
}
async function loadItems() {
  try { await itLoadMeta(); } catch (e) { say($('itMsg'), e.message, true); return; }
  const size = Number($('itSize').value);
  const qs = new URLSearchParams({ q: $('itQ').value, k1: $('itK1').value, parts: $('itParts').value, grade: $('itGrade').value, custom: $('itCustom').value, page: itPage, size });
  let r;
  try { r = await api('/items?' + qs); } catch (e) { say($('itMsg'), e.message, true); return; }
  itTotal = r.total;
  const pages = Math.max(1, Math.ceil(r.total / size));
  $('itInfo').textContent = `Página ${itPage} de ${pages} · ${r.total.toLocaleString('pt-BR')} item(ns)`;
  $('itPrev').disabled = itPage <= 1; $('itNext').disabled = itPage >= pages;
  $('itRows').innerHTML = r.rows.length ? r.rows.map((d) => `<tr class="${d.status === 'removido' ? 'removido' : ''}">
      <td class="ic">${d.icon ? `<img class="ic" src="${iconUrl(d.icon)}" alt="" loading="lazy" />` : ''}</td>
      <td><button class="idbtn" data-copy="${d.id}" title="Copiar o ID (ex.: /ci ${d.id} no servidor local)">${d.id}</button></td>
      <td class="itname"><b>${esc(d.name)}${d.status ? `<span class="badge ${d.status}">${d.status}</span>` : ''}</b><small>${esc(d.symbol)}</small></td>
      <td class="itdesc">${esc(d.desc)}</td>
      <td class="itkind">${esc(shortName(nameOf(itMeta.ik3, d.kind3) || nameOf(itMeta.ik2, d.kind2) || ''))}${d.parts >= 0 ? ' · ' + esc(shortName(nameOf(itMeta.parts, d.parts))) : ''}</td>
      <td>${d.level || ''}</td>
      <td><button class="btn sm" data-edit="${d.id}">Editar</button></td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">Nenhum item encontrado.</td></tr>';
}
const itReload = (resetPage = true) => { if (resetPage) itPage = 1; clearTimeout(itTimer); itTimer = setTimeout(loadItems, 200); };
$('itFilter').addEventListener('submit', (e) => { e.preventDefault(); itReload(); });
$('itQ').addEventListener('input', () => itReload());
for (const id of ['itK1', 'itParts', 'itGrade', 'itCustom', 'itSize']) $(id).addEventListener('change', () => itReload());
$('itPrev').addEventListener('click', () => { if (itPage > 1) { itPage--; loadItems(); } });
$('itNext').addEventListener('click', () => { itPage++; loadItems(); });
$('itRows').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.copy) {
    // copia o ID (para usar no /ci do servidor local)
    try { await navigator.clipboard.writeText(t.dataset.copy); } catch { const ta = Object.assign(document.createElement('textarea'), { value: t.dataset.copy }); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    t.classList.add('ok'); const old = t.textContent; t.textContent = 'copiado!';
    setTimeout(() => { t.classList.remove('ok'); t.textContent = old; }, 900);
  } else if (t.dataset.edit) openItem(Number(t.dataset.edit));
});

const IE_FIELDS = ['name', 'desc', 'icon', 'look', 'kind1', 'kind2', 'kind3', 'parts', 'ignorePart', 'sex', 'job', 'level', 'abilityMin', 'abilityMax', 'attackSpeed', 'weaponType', 'handed', 'grade', 'element', 'packMax', 'cost', 'shopAble'];
const NUMERIC = new Set(['kind1', 'kind2', 'kind3', 'parts', 'ignorePart', 'sex', 'job', 'level', 'abilityMin', 'abilityMax', 'attackSpeed', 'weaponType', 'handed', 'grade', 'element', 'packMax', 'cost', 'shopAble']);
function readForm() {
  const out = {};
  for (const k of IE_FIELDS) { const v = $('ie_' + k).value; out[k] = NUMERIC.has(k) ? Number(v) : v; }
  out.fx = [];
  for (let i = 0; i < 6; i++) { const k = Number(document.querySelector(`[data-fx="${i}"]`).value), v = Number(document.querySelector(`[data-fxv="${i}"]`).value); if (k > 0) out.fx.push([k, v]); }
  return out;
}
/** marca em amarelo o que difere do original */
function markChanged() {
  const o = itEditing?.original;
  for (const k of IE_FIELDS) $('ie_' + k).classList.toggle('changed', !!o && String(o[k] ?? '') !== String($('ie_' + k).value));
  const now = JSON.stringify(readForm().fx);
  $('ie_fx').classList.toggle('changed', !!o && JSON.stringify(o.fx) !== now);
  $('ieIcon').src = iconUrl($('ie_icon').value.trim());
}
async function openItem(id) {
  try { await itLoadMeta(); itEditing = await api('/items/' + id); } catch (e) { say($('itMsg'), e.message, true); return; }
  const d = itEditing.item;
  $('ieTitle').textContent = `${d.name}`;
  $('ieSub').textContent = `ID ${d.id} · ${d.symbol}${itEditing.status ? ' · ' + itEditing.status : ''}`;
  for (const k of IE_FIELDS) { const el = $('ie_' + k); el.value = d[k] ?? ''; if (el.tagName === 'SELECT' && el.value === '' && d[k] !== undefined) el.insertAdjacentHTML('beforeend', `<option value="${d[k]}">${d[k]}</option>`), (el.value = d[k]); }
  for (let i = 0; i < 6; i++) { const f = d.fx[i]; document.querySelector(`[data-fx="${i}"]`).value = f ? f[0] : 0; document.querySelector(`[data-fxv="${i}"]`).value = f ? f[1] : ''; }
  $('ieRestore').hidden = !(itEditing.status === 'editado' || itEditing.status === 'removido');
  $('ieDelete').textContent = itEditing.status === 'novo' ? 'Excluir item novo' : 'Remover do jogo';
  $('ieDelete').hidden = itEditing.status === 'removido';
  markChanged();
  $('dlgItem').showModal();
}
$('itForm').addEventListener('input', markChanged);
$('itForm').addEventListener('change', markChanged);
$('ieSave').addEventListener('click', async () => {
  try {
    const r = await api('/items/' + itEditing.item.id, { method: 'PUT', body: JSON.stringify(readForm()) });
    $('dlgItem').close();
    say($('itMsg'), `Item ${itEditing.item.id} salvo${r.status ? ' (' + r.status + ')' : ' (igual ao original)'}. Clique em "Aplicar no jogo" para valer no servidor.`);
    loadItems();
  } catch (e) { alert(e.message); }
});
$('ieRestore').addEventListener('click', async () => {
  if (!confirm('Voltar este item ao original do Spec_Item?')) return;
  try { await api(`/items/${itEditing.item.id}/restore`, { method: 'POST' }); $('dlgItem').close(); say($('itMsg'), 'Item voltou ao original.'); loadItems(); } catch (e) { alert(e.message); }
});
$('ieDelete').addEventListener('click', async () => {
  const novo = itEditing.status === 'novo';
  if (!confirm(novo ? 'Excluir este item novo? Não tem como desfazer.' : 'Remover este item do jogo? (dá para desfazer em "Só removidos" → Voltar ao original)')) return;
  try { await api('/items/' + itEditing.item.id, { method: 'DELETE' }); $('dlgItem').close(); say($('itMsg'), novo ? 'Item excluído.' : 'Item removido do jogo.'); loadItems(); } catch (e) { alert(e.message); }
});
$('itNew').addEventListener('click', () => { $('niSymbol').value = ''; $('niName').value = ''; $('niBase').value = ''; $('dlgNewItem').returnValue = ''; $('dlgNewItem').showModal(); });
$('dlgNewItem').addEventListener('close', async () => {
  if ($('dlgNewItem').returnValue !== 'ok') return;
  try {
    const r = await api('/items', { method: 'POST', body: JSON.stringify({ symbol: $('niSymbol').value, name: $('niName').value, base: $('niBase').value }) });
    say($('itMsg'), `Item criado com o ID ${r.id}.`);
    await openItem(r.id);
    loadItems();
  } catch (e) { say($('itMsg'), e.message, true); }
});
$('itApply').addEventListener('click', async () => {
  if (!confirm('Reiniciar o servidor do jogo agora para valer as mudanças dos itens? Quem estiver online é desconectado.')) return;
  try { await api('/game/restart', { method: 'POST' }); say($('itMsg'), 'Servidor do jogo reiniciando com os itens novos.'); } catch (e) { say($('itMsg'), e.message, true); }
});

// ---------------- teste de carga: bots no jogo (admin/loadtest.ts) ----------------
let ltState = null;
/** resultado antigo aberto em "Ver" (null = o teste atual / último) */
let ltOpen = null;
const ltMs = (v) => (v == null ? '—' : Math.round(v) + ' ms');
const ltScenario = (o) => o ? `${{ walk: 'andando', 'walk-chat': 'andando + chat', idle: 'parados' }[o.behavior] || o.behavior}, raio ${o.spread} u` : '—';

async function loadLoadtest(withHistory = false) {
  let s;
  try { s = await api('/loadtest' + (withHistory ? '?history=1' : '')); } catch (e) {
    say($('ltMsg'), /Rota desconhecida/.test(e.message) ? 'O painel precisa ser reiniciado para usar esta página: feche a janela do painel e abra de novo (.Iniciar Servidor.bat).' : 'Sem resposta do painel: ' + e.message, true);
    return;
  }
  const wasRunning = ltState && ltState.status !== 'parado';
  ltState = s;
  const running = s.status !== 'parado';
  $('ltStart').disabled = running || !s.gameRunning;
  $('ltStop').disabled = s.status !== 'rodando';
  $('ltRemove').disabled = running || !s.botAccounts;
  for (const el of $('ltForm').elements) el.disabled = running;
  $('ltBotAcc').textContent = s.botAccounts == null ? '' : s.botAccounts ? `${s.botAccounts} contas de bot no banco agora` : 'nenhuma criada ainda';
  if (!s.gameRunning && !running && !$('ltMsg').textContent) say($('ltMsg'), 'Inicie o servidor do jogo (Dashboard → Iniciar) para testar.', true);
  if (running) ltOpen = null;
  if (!ltOpen) ltRender({ samples: s.samples, summary: s.summary, options: s.options, limits: s.limits, live: running });
  const box = $('ltLog'), follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  box.textContent = s.logs.map((l) => `[${new Date(l.t).toLocaleTimeString('pt-BR')}] ${l.text}`).join('\n');
  if (follow) box.scrollTop = box.scrollHeight;
  if (wasRunning && !running) { say($('ltMsg'), 'Teste concluído' + (s.lastResult ? ` — salvo em data/loadtests/${s.lastResult}.` : '.')); loadLoadtest(true); }
  if (s.history) ltHistory(s.history);
}

function ltRender(r) {
  const S = r.samples || [], last = S[S.length - 1], L = r.limits || { lagP99: 50, rttP95: 150, gapP95: 200 }, o = r.options;
  const mark = (el, v, lim) => { el.classList.toggle('bad', v != null && v > lim); };
  $('ltBots').textContent = last ? last.bots : '—';
  $('ltBotsSub').textContent = o ? `de ${o.count} · ${ltScenario(o)}` : 'nenhum teste ainda';
  $('ltLag').textContent = ltMs(last?.lagP99); mark($('ltLag'), last?.lagP99, L.lagP99);
  $('ltLagSub').textContent = `limite ${L.lagP99} ms · máx. ${ltMs(last?.lagMax)}`;
  $('ltRtt').textContent = ltMs(last?.rttP95); mark($('ltRtt'), last?.rttP95, L.rttP95);
  $('ltRttSub').textContent = `limite ${L.rttP95} ms`;
  $('ltCpu').textContent = last?.cpu != null ? last.cpu + '%' : '—';
  $('ltCpu').classList.toggle('warn', (last?.cpu ?? 0) > 80);
  $('ltCpuSub').textContent = '100% = um núcleo inteiro (o jogo usa um)';
  $('ltConn').textContent = last ? last.connected : '—';
  $('ltFail').textContent = last ? last.failed : '—';
  $('ltRx').textContent = last ? (last.rxKBps / 1024).toFixed(1) + ' MB/s (' + Math.round(last.rxKBps * 8 / 1024) + ' Mbit/s)' : '—';
  $('ltSrvOut').textContent = last?.srvMsgOut != null ? last.srvMsgOut + '/s' : '—';
  $('ltRtt50').textContent = ltMs(last?.rttP50);
  $('ltGap').textContent = ltMs(last?.gapP95);
  $('ltRam').textContent = last?.rssMb != null ? last.rssMb + ' MB' : '—';
  $('ltBotLag').textContent = ltMs(last?.botLag);
  $('ltBotLag').classList.toggle('ltbad', (last?.botLag ?? 0) > 50);
  $('ltPulls').textContent = last ? last.pulls : '—';
  $('ltTime').textContent = last ? `${Math.round(last.at / 1000)} s${o ? ' de ' + o.duration + ' s' : ''}` : '—';

  // veredito
  const v = $('ltVerdict'), sm = r.summary;
  v.hidden = !sm;
  if (sm) {
    const bad = sm.degradedAt != null;
    v.classList.toggle('bad', bad);
    const botsBusy = sm.worst.botLag > 50 ? `<p>⚠️ A máquina dos bots também ficou sobrecarregada (atraso de até ${sm.worst.botLag} ms): parte da piora pode ser dela. Use menos threads de bots ou outra máquina.</p>` : '';
    const fails = sm.failed ? `<p>${sm.failed} bots falharam ao entrar ou caíram (veja o registro).</p>` : '';
    const head = r.live ? (bad ? `Degradou com ~${sm.degradedAt} bots (teste ainda rodando)` : `Rodando: sem degradar até agora, com ${sm.peakJoined} bots`)
      : bad ? `Degradou com ~${sm.degradedAt} bots` : `Aguentou ${sm.peakJoined} bots sem degradar${sm.stoppedEarly ? ' (teste interrompido)' : ''}`;
    v.innerHTML = `<h4 class="${bad ? 'ltbad' : 'ltok'}">${bad ? '✗' : '✓'} ${esc(head)}</h4>`
      + (bad ? `<p>Motivo: ${esc(sm.degradedWhy)}. Funcionou bem até <b>${sm.maxOkBots}</b> bots.</p>` : '')
      + `<p>Piores valores: event loop ${sm.worst.lagP99} ms · RTT p95 ${sm.worst.rttP95} ms · intervalo dos 'states' ${sm.worst.gapP95} ms · CPU ${sm.worst.cpu}% · RAM ${sm.worst.rssMb} MB · ${sm.worst.rxMBps} MB/s para os bots.</p>`
      + fails + botsBusy;
  }

  const span = Math.max(o ? o.duration * 1000 : 0, last?.at ?? 0, 10_000);
  ltChart($('ltChart1'), S, span, [
    { key: 'bots', color: '#a78bfa', axis: 'l' },
    { key: (s) => s.rxKBps / 1024, color: '#2dd4bf', axis: 'r' },
  ]);
  ltChart($('ltChart2'), S, span, [
    { key: 'lagP99', color: '#f5a524', axis: 'l' },
    { key: 'rttP95', color: '#2dd4bf', axis: 'l' },
    { key: 'gapP95', color: '#38bdf8', axis: 'l' },
  ], [L.lagP99, L.rttP95, L.gapP95]);
  $('ltNote1').textContent = $('ltNote2').textContent = S.length ? (r.live ? 'ao vivo' : r.file ? 'teste de ' + fmtDate(r.startedAt) : 'último teste') : 'sem dados';
}

/** linhas ao longo do tempo do teste; eixo esquerdo e (opcional) direito com escalas próprias; `limits` = linhas tracejadas */
function ltChart(c, S, span, series, limits = []) {
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pad = { l: 40, r: 40, t: 8, b: 18 };
  const val = (s, k) => (typeof k === 'function' ? k(s) : s[k]);
  const top = (axis) => Math.max(1, ...series.filter((x) => x.axis === axis).flatMap((x) => S.map((s) => val(s, x.key) ?? 0)), ...(axis === 'l' ? limits : [])) * 1.15;
  const tops = { l: top('l'), r: top('r') };
  const X = (at) => pad.l + ((w - pad.l - pad.r) * at) / span, Y = (v, axis) => pad.t + (h - pad.t - pad.b) * (1 - v / tops[axis]);
  g.strokeStyle = '#1f2b40'; g.fillStyle = '#5d6c84'; g.font = '11px system-ui'; g.lineWidth = 1;
  const fmt = (v) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1));
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ((h - pad.t - pad.b) * i) / 4;
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    g.fillText(fmt(tops.l - (tops.l * i) / 4), 4, y + 4);
    if (series.some((x) => x.axis === 'r')) g.fillText(fmt(tops.r - (tops.r * i) / 4), w - pad.r + 4, y + 4);
  }
  g.fillText(Math.round(span / 1000) + ' s', w - pad.r - 26, h - 4);
  g.setLineDash([5, 4]); g.strokeStyle = '#e5484d';
  for (const lim of limits) { g.beginPath(); g.moveTo(pad.l, Y(lim, 'l')); g.lineTo(w - pad.r, Y(lim, 'l')); g.stroke(); }
  g.setLineDash([]);
  for (const sr of series) {
    g.strokeStyle = sr.color; g.lineWidth = 2; g.beginPath();
    let on = false;
    for (const s of S) {
      const v = val(s, sr.key);
      if (v == null) { on = false; continue; }
      if (on) g.lineTo(X(s.at), Y(v, sr.axis)); else g.moveTo(X(s.at), Y(v, sr.axis));
      on = true;
    }
    g.stroke();
  }
  // segundos com algum limite estourado: marca vermelha embaixo
  g.fillStyle = 'rgb(229 72 77 / .6)';
  for (const s of S) if (!s.ok) g.fillRect(X(s.at) - 2, h - pad.b, 4, 3);
}

function ltHistory(list) {
  $('ltRows').innerHTML = list.length ? list.map((r) => {
    const sm = r.summary, o = r.options, okRun = sm.degradedAt == null;
    return `<tr><td>${fmtDate(r.startedAt)}</td><td>${sm.peakJoined}/${o.count}</td><td>${esc(ltScenario(o))}, ${o.duration} s</td>
      <td class="${okRun ? 'ltok' : ''}">${okRun ? '✓ ' + sm.peakJoined : sm.maxOkBots}</td>
      <td class="${okRun ? '' : 'ltbad'}">${okRun ? '—' : '~' + sm.degradedAt}</td>
      <td>${sm.worst.lagP99} / ${sm.worst.rttP95} ms</td><td>${sm.worst.cpu}% / ${sm.worst.rssMb} MB</td>
      <td><div class="dbacts"><button class="btn sm" data-ltview="${esc(r.file)}">Ver</button><button class="btn sm" data-ltdel="${esc(r.file)}">Apagar</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">Nenhum teste ainda.</td></tr>';
}

$('ltRows').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.ltview) {
      const r = await api('/loadtest/results/' + b.dataset.ltview);
      ltOpen = b.dataset.ltview;
      ltRender({ ...r, live: false, file: ltOpen });
      say($('ltMsg'), `Mostrando o teste de ${fmtDate(r.startedAt)}. Inicie um teste novo para voltar ao vivo.`);
      scrollTo({ top: 0, behavior: 'smooth' });
    } else if (b.dataset.ltdel && confirm('Apagar este resultado?')) {
      await api('/loadtest/results/' + b.dataset.ltdel, { method: 'DELETE' });
      if (ltOpen === b.dataset.ltdel) ltOpen = null;
      loadLoadtest(true);
    }
  } catch (e) { say($('ltMsg'), e.message, true); }
});
for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => {
  const [n, ramp, dur] = b.dataset.preset.split(',');
  $('ltCount').value = n; $('ltRamp').value = ramp; $('ltDuration').value = dur;
});
$('ltStart').addEventListener('click', async () => {
  if (!$('ltForm').reportValidity()) return;
  const n = Number($('ltCount').value);
  if (n >= 300 && !confirm(`Colocar ${n} bots no servidor? Jogadores de verdade online vão ver os bots e sentir o peso do teste.`)) return;
  ltOpen = null;
  say($('ltMsg'), 'Preparando as contas de bot e as sessões…');
  try {
    await api('/loadtest/start', { method: 'POST', body: JSON.stringify({
      count: n, ramp: Number($('ltRamp').value), duration: Number($('ltDuration').value), behavior: $('ltBehavior').value,
      spread: Number($('ltSpread').value), center: [Number($('ltX').value), Number($('ltZ').value)], workers: Number($('ltWorkers').value),
    }) });
    say($('ltMsg'), 'Teste rodando.');
  } catch (e) { say($('ltMsg'), e.message, true); }
  loadLoadtest();
});
$('ltStop').addEventListener('click', async () => {
  try { await api('/loadtest/stop', { method: 'POST' }); say($('ltMsg'), 'Parando: os bots estão saindo…'); } catch (e) { say($('ltMsg'), e.message, true); }
  loadLoadtest();
});
$('ltRemove').addEventListener('click', async () => {
  if (!confirm('Apagar todas as contas de bot (lt_bot0001…) e os personagens delas? Os resultados dos testes continuam guardados.')) return;
  try { const r = await api('/loadtest/bots', { method: 'DELETE' }); say($('ltMsg'), `${r.removed} contas de bot apagadas.`); } catch (e) { say($('ltMsg'), e.message, true); }
  loadLoadtest();
});
setInterval(() => { if (!$('view-loadtest').hidden && !document.hidden) loadLoadtest(); }, 1000);

// ---------------- skills: modo auto/manual e lista por classe ----------------
var skJob = 0; // var: o show() inicial roda antes deste trecho
const skIcon = (f) => (f ? '/admin/skill-icons/' + encodeURIComponent(f) : '');
const fmtN = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
async function loadSkills(job = skJob || 0) {
  let r;
  try { r = await api('/skills?job=' + job); } catch (e) { say($('skMsg'), e.message, true); return; }
  skJob = r.job;
  for (const i of document.querySelectorAll('input[name=skMode]')) i.checked = i.value === r.mode;
  $('skTabs').innerHTML = r.jobs.map((j) => `<button class="sktab${j.id === r.job ? ' on' : ''}" role="tab" data-job="${j.id}">${esc(j.name)} <small>${j.count}</small></button>`).join('');
  skList = r.skills;
  $('skGrid').innerHTML = r.skills.length ? r.skills.map((s, i) => `<div class="skcell" data-i="${i}" tabindex="0">
      <img src="${skIcon(s.icon)}" alt="" width="40" height="40" /><span class="skname">${esc(s.name)}</span><span class="dim">Nv. ${s.req} · máx. ${s.max}</span></div>`).join('')
    : '<p class="empty">Esta classe não tem skills.</p>';
}
var skList = [];
$('skTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-job]'); if (b) loadSkills(Number(b.dataset.job)); });
for (const i of document.querySelectorAll('input[name=skMode]')) i.addEventListener('change', async () => {
  try { const r = await api('/skills/mode', { method: 'PUT', body: JSON.stringify({ mode: i.value }) }); say($('skMsg'), r.mode === 'auto' ? 'Auto-skill ligado: as skills abrem sozinhas ao chegar no nível.' : 'Manual-skill ligado: o jogador distribui os pontos.'); }
  catch (e) { say($('skMsg'), e.message, true); loadSkills(); }
});
function skTipHtml(s) {
  const rows = s.levels.map((l, n) => {
    const fx = l.fx.map((f) => `${esc(f.dst)} ${f.val > 0 ? '+' : ''}${f.val}`).join(', ');
    return `<tr><td>${n + 1}</td><td>${l.mp || ''}</td><td>${l.fp || ''}</td><td>${l.cd ? fmtN(l.cd) + 's' : ''}</td><td>${l.max ? l.min + '–' + l.max : ''}</td><td>${l.time ? fmtN(l.time) + 's' : ''}</td><td>${fx}</td></tr>`;
  }).join('');
  return `<div class="skth"><img src="${skIcon(s.icon)}" alt="" width="40" height="40" /><div><b>${esc(s.name)}</b><br><span class="dim">${esc(s.symbol)} · ${esc(s.kind)}</span></div></div>
    <p>${esc(s.desc) || '<span class="dim">Sem descrição.</span>'}</p>
    <p class="dim">${esc(s.type)} · pede nível ${s.req} · máx. ${s.max} · ${s.cost} ponto(s) por nível${s.pre.length ? ' · pede ' + s.pre.map((p) => esc(p.name) + ' Nv. ' + p.lv).join(', ') : ''}</p>
    <table><thead><tr><th>Nv</th><th>MP</th><th>FP</th><th>Espera</th><th>Dano</th><th>Duração</th><th>Efeito</th></tr></thead><tbody>${rows}</tbody></table>`;
}
const skTip = $('skTip');
function skMove(ev) {
  const w = skTip.offsetWidth, h = skTip.offsetHeight;
  skTip.style.left = Math.max(8, Math.min(ev.clientX + 16, innerWidth - w - 8)) + 'px';
  skTip.style.top = Math.max(8, Math.min(ev.clientY + 16, innerHeight - h - 8)) + 'px';
}
$('skGrid').addEventListener('mouseover', (ev) => {
  const c = ev.target.closest('.skcell');
  if (!c) return;
  skTip.innerHTML = skTipHtml(skList[Number(c.dataset.i)]);
  skTip.hidden = false; skMove(ev);
});
$('skGrid').addEventListener('mousemove', (ev) => { if (!skTip.hidden) skMove(ev); });
$('skGrid').addEventListener('mouseout', (ev) => { if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest('.skcell')) skTip.hidden = true; });
