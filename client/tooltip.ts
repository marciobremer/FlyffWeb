/**
 * Dicas (tooltips) no padrão do jogo: tudo o que tem o atributo `title` (botões, linhas das lojas, rótulos…) deixa de mostrar a dica
 * simples do navegador (caixa escura) e mostra a mesma caixa das dicas de item — fundo claro, borda laranja e a fonte do jogo.
 * A primeira linha vai em negrito (nome); as outras (separadas por quebra de linha no `title`) em texto normal.
 * O atributo é guardado enquanto o mouse está em cima e devolvido ao sair, então quem lê/atualiza o `title` não percebe.
 */
export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'item-tip native-tip';
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let cur: Element | null = null, saved = '';

  const place = (e: { clientX: number; clientY: number }) => {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, e.clientX + 16))}px`;
    tip.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, e.clientY + 18))}px`;
  };
  const hide = () => {
    if (cur && saved && !cur.hasAttribute('title')) cur.setAttribute('title', saved);
    cur = null; saved = ''; tip.hidden = true;
  };
  const show = (text: string, e: PointerEvent) => {
    tip.replaceChildren();
    text.split('\n').forEach((line, i) => {
      const l = document.createElement('div');
      l.textContent = line;
      if (i === 0) l.className = 'tip-name';
      tip.appendChild(l);
    });
    tip.hidden = false;
    place(e);
  };

  document.addEventListener('pointerover', (e) => {
    const target = e.target as Element | null;
    if (!target || !(target instanceof Element)) return;
    if (cur?.contains(target)) return; // ainda dentro do mesmo elemento
    hide();
    const el = target.closest('[title]');
    const text = el?.getAttribute('title')?.trim();
    if (!el || !text) return;
    cur = el; saved = text;
    el.removeAttribute('title'); // sem a dica nativa do navegador
    show(text, e);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!cur) return;
    if (!cur.isConnected) { hide(); return; }
    if (!tip.hidden) place(e);
  }, true);
  document.addEventListener('pointerout', (e) => { if (cur && !cur.contains(e.relatedTarget as Node | null)) hide(); }, true);
  document.addEventListener('pointerdown', () => { tip.hidden = true; }, true);
}
