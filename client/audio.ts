/**
 * Sons do jogo (.wav do cliente original). Nada é baixado antes de precisar: o primeiro `play(id)` pede o arquivo ao servidor
 * (`/snd/<arquivo>`, cache de 1 ano no navegador), decodifica uma vez e guarda o AudioBuffer; depois toca de graça. O servidor só entrega
 * arquivos. O navegador só libera áudio depois de um clique/tecla — o primeiro som antes disso é descartado em silêncio.
 * `/gapi/sounds` traz o mapa id → arquivo (defineSound.h + sound.inc).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private map: Record<number, string> | null = null;
  private mapLoading: Promise<void> | null = null;
  private buffers = new Map<number | string, Promise<AudioBuffer | null>>();
  /** quantos tocam ao mesmo tempo (evita estourar com muita luta junto) e o mesmo som não repete antes de 60 ms */
  private playing = 0;
  private last = new Map<number | string, number>();
  volume = 0.5;
  /** onde está o ouvinte (jogador) — sons mais longe ficam mais baixos */
  listener: () => [number, number, number] | null = () => null;

  constructor() {
    try { const v = Number(localStorage.getItem('flyff.volume')); if (Number.isFinite(v) && localStorage.getItem('flyff.volume') !== null) this.volume = Math.min(1, Math.max(0, v)); } catch { /* padrão */ }
    // o contexto só pode iniciar após um gesto do usuário
    const unlock = () => { this.ensure()?.resume().catch(() => {}); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.gain) this.gain.gain.value = this.volume;
    try { localStorage.setItem('flyff.volume', String(this.volume)); } catch { /* ignora */ }
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    } catch { this.ctx = null; }
    return this.ctx;
  }

  private loadMap() {
    this.mapLoading ??= fetch('/gapi/sounds').then((r) => (r.ok ? r.json() : {})).then((j) => { this.map = j as Record<number, string>; }).catch(() => { this.map = {}; });
    return this.mapLoading;
  }

  /** `id` = SND_* (pelo mapa do servidor) ou o nome do .wav direto (som de um efeito, mdlDyna.inc) */
  private buffer(id: number | string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      p = (async () => {
        if (typeof id === 'number') await this.loadMap();
        const file = typeof id === 'string' ? id : this.map?.[id];
        const ctx = this.ctx;
        if (!file || !ctx) return null;
        try {
          const r = await fetch('/snd/' + encodeURIComponent(file));
          if (!r.ok) return null;
          return await ctx.decodeAudioData(await r.arrayBuffer());
        } catch { return null; }
      })();
      this.buffers.set(id, p);
    }
    return p;
  }

  /** toca o som `id` (SND_*, ou o nome do .wav); `at` = posição FlyFF de quem faz o som (distância baixa o volume) */
  play(id: number | string | undefined, at?: [number, number, number] | null, vol = 1) {
    if (id === undefined || id === '' || (typeof id === 'number' && id < 0) || !this.volume) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') { ctx?.resume().catch(() => {}); return; } // ainda sem gesto do usuário
    const now = performance.now();
    if (now - (this.last.get(id) ?? 0) < 60 || this.playing >= 12) return;
    this.last.set(id, now);
    let v = vol;
    const me = this.listener();
    if (at && me) v *= Math.max(0, 1 - Math.hypot(at[0] - me[0], at[2] - me[2]) / 70);
    if (v <= 0.02) return;
    void this.buffer(id).then((buf) => {
      if (!buf || !this.gain) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = v;
      src.connect(g).connect(this.gain);
      this.playing++;
      src.onended = () => { this.playing--; };
      src.start();
    });
  }
}
