import './dialog.css';

/**
 * Pergunta no visual do jogo, centralizada na tela (no lugar do confirm() do navegador). Bloqueia o resto até responder:
 * Enter confirma, Esc ou clicar fora cancela. Resolve true (confirmou) ou false.
 */
export function gameConfirm(text: string, okLabel = 'OK', danger = true, cancelLabel = 'Cancelar'): Promise<boolean> {
  return new Promise((resolve) => {
    const veil = document.createElement('div');
    veil.className = 'gd-veil';
    const box = document.createElement('div');
    box.className = 'gd-box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', text);
    const msg = document.createElement('p');
    msg.textContent = text;
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = `gm-btn${danger ? ' danger' : ''}`; ok.textContent = okLabel;
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'gm-btn'; cancel.textContent = cancelLabel;
    const row = document.createElement('div');
    row.append(ok, cancel);
    box.append(msg, row);
    veil.append(box);
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); veil.remove(); resolve(v); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      else e.stopPropagation(); // com a pergunta aberta, as teclas não chegam ao jogo (WASD, atalhos…)
    };
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) finish(false); });
    document.body.appendChild(veil);
    cancel.focus();
  });
}
