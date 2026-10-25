/**
 * Atualização do jogo: compara o script que está rodando (`/assets/game-<hash>.js`, o nome muda a cada build) com o do build
 * atual no servidor (`/gapi/version`). Com versão nova: fora do jogo (login/seleção) recarrega sozinho; dentro do jogo mostra
 * um aviso com botão — assim ninguém fica numa versão velha só porque deixou a aba aberta ou o navegador guardou a página.
 * Confere a cada CHECK_MS, quando a aba volta a ficar visível e quando a conexão com o servidor volta.
 */
const CHECK_MS = 60_000;

/** script de entrada deste carregamento (vazio em desenvolvimento, sem build: aí não confere nada) */
const running = (): string => {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/game-"]');
  return s ? new URL(s.src, location.href).pathname : '';
};

export class VersionWatcher {
  private mine = running();
  private banner: HTMLElement | null = null;
  private busy = false;

  /** `inGame()`: true dentro do mundo (aí só avisa; fora dele recarrega sozinho) */
  constructor(private inGame: () => boolean) {
    if (!this.mine) return;
    setInterval(() => void this.check(), CHECK_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void this.check(); });
  }

  /** confere agora (ex.: a conexão com o servidor voltou — pode ter sido reiniciado com um build novo) */
  async check() {
    if (!this.mine || this.busy) return;
    this.busy = true;
    try {
      const r = await fetch('/gapi/version', { cache: 'no-store' });
      const v = r.ok ? ((await r.json()) as { game?: string }).game : '';
      if (v && new URL(v, location.href).pathname !== this.mine) this.newVersion();
    } catch { /* servidor fora do ar: tenta de novo depois */ }
    finally { this.busy = false; }
  }

  private newVersion() {
    if (!this.inGame()) { location.reload(); return; }
    if (this.banner) return;
    const b = document.createElement('div');
    b.className = 'update-banner';
    b.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = 'Nova versão do jogo disponível.';
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'Atualizar agora';
    go.addEventListener('click', () => location.reload());
    b.append(text, go);
    document.body.append(b);
    this.banner = b;
  }
}
