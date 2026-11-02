import net from 'node:net';

/**
 * Cliente do link com o Game Server em Rust (game-server/, protocolo em docs/ARQUITETURA.md §5 e game-server/src/protocol.rs):
 * TCP em loopback, quadros `u32` BE + JSON. Conecta, faz o `hello` com o segredo e reconecta sozinho com espera crescente.
 * Enquanto não está `up`, o Node simula os mobs ele mesmo (rollback automático).
 */
export interface RustLinkHandlers {
  onMessage(msg: any): void;
  /** quadro cru do Rust: JSON já pronto para o cliente `conn` (o Node só repassa os bytes) */
  onRaw(conn: number, payload: Buffer): void;
  onUp(): void;
  onDown(): void;
}

export const LINK_VERSION = 1;

export class RustLink {
  up = false;
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private delay = 500;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private host: string, private port: number, private secret: string, private h: RustLinkHandlers) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const s = net.connect(this.port, this.host);
    this.sock = s;
    s.setNoDelay(true);
    s.on('connect', () => this.write({ k: 'hello', secret: this.secret, version: LINK_VERSION }));
    s.on('data', (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      while (this.buf.length >= 4 && this.buf.length >= 4 + this.buf.readUInt32BE(0)) {
        const n = this.buf.readUInt32BE(0);
        // byte 1 = quadro cru [1][conn u32][JSON do cliente]; qualquer outro começa com '{' (JSON do link)
        if (n >= 5 && this.buf[4] === 1) {
          const conn = this.buf.readUInt32BE(5), payload = this.buf.subarray(9, 4 + n);
          this.buf = this.buf.subarray(4 + n);
          this.h.onRaw(conn, payload);
          continue;
        }
        let msg: any;
        try { msg = JSON.parse(this.buf.subarray(4, 4 + n).toString()); } catch { s.destroy(); return; }
        this.buf = this.buf.subarray(4 + n);
        if (msg.k === 'hello_ok') { this.up = true; this.delay = 500; this.h.onUp(); }
        else if (msg.k === 'error') console.error('rust-link:', msg.error);
        else this.h.onMessage(msg);
      }
    });
    s.on('error', () => { /* o 'close' trata */ });
    s.on('close', () => {
      const was = this.up;
      this.up = false;
      this.sock = null;
      this.buf = Buffer.alloc(0);
      if (was) { console.error('rust-link: caiu — o Node assume os mobs até reconectar'); this.h.onDown(); }
      if (!this.closed) {
        this.timer = setTimeout(() => this.connect(), this.delay);
        this.delay = Math.min(10_000, this.delay * 2);
      }
    });
  }

  private write(v: unknown) {
    const s = this.sock;
    if (!s || s.destroyed) return false;
    const b = Buffer.from(JSON.stringify(v));
    const h = Buffer.allocUnsafe(4);
    h.writeUInt32BE(b.length);
    s.write(Buffer.concat([h, b]));
    return true;
  }

  /** envia depois do hello; false se o link não está de pé */
  send(v: unknown) { return this.up && this.write(v); }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.sock?.destroy();
  }
}
