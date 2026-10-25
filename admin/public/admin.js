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
      <td>${a.authority === 'Z' ? '<span class="badge adm">Admin</span>' : 'Jogador'}</td>
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
