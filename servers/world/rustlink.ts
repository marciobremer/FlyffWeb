import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * Cliente do link com o Game Server em Rust (game-server/, protocolo em docs/ARQUITETURA.md §5 e game-server/src/protocol.rs):
 * TCP em loopback, quadros `u32` BE + JSON. Conecta, faz o `hello` com o segredo e reconecta sozinho com espera crescente.
 * Enquanto não está `up`, o Node simula os mobs ele mesmo (rollback automático).
 */
export interface RustLinkHandlers {
  onMessage(msg: any): void;
  /** quadro cru do Rust: JSON já pronto para o cliente `conn` (o Node só repassa os bytes) */
  onRaw(conn: number, payload: Buffer): void;
  /** mensagem de um navegador conectado direto ao Rust (quadro cru, byte 2): JSON do cliente para o `ws` */
  onWsMessage(ws: number, payload: Buffer): void;
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
        if (n >= 5 && this.buf[4] === 2) {
          const ws = this.buf.readUInt32BE(5), payload = this.buf.subarray(9, 4 + n);
          this.buf = this.buf.subarray(4 + n);
          this.h.onWsMessage(ws, payload);
          continue;
        }
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

  /** JSON pronto para o navegador `ws` (quadro cru, byte 3): o Rust escreve no WebSocket dele */
  sendWs(ws: number, payload: string | Buffer) {
    const s = this.sock;
    if (!this.up || !s || s.destroyed) return false;
    const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
    const h = Buffer.allocUnsafe(9);
    h.writeUInt32BE(body.length + 5, 0); h[4] = 3; h.writeUInt32BE(ws, 5);
    s.write(h); s.write(body); // dois writes no mesmo tick: o Node junta no mesmo pacote
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

/**
 * "WebSocket virtual": um navegador conectado no servidor WS do Rust, visto pelo resto do Node como um `ws`.
 * `send` vai pelo link, as mensagens do navegador chegam como evento 'message', 'close' quando ele desconecta.
 * Só implementa o que o realtime.ts usa (send, close, terminate, ping/pong, readyState).
 */
export class LinkSocket extends EventEmitter {
  /** mesmos valores do WebSocket: 1 = OPEN, 3 = CLOSED */
  readyState = 1;
  constructor(readonly id: number, private link: RustLink, readonly ip: string) { super(); }
  send(data: string | Buffer) { if (this.readyState === 1) this.link.sendWs(this.id, data); }
  close() { this.shutdown(); }
  terminate() { this.shutdown(); }
  /** a vida da conexão é vigiada pelo Rust (ping/pong dele): aqui só confirma */
  ping() { process.nextTick(() => this.emit('pong')); }
  private shutdown() {
    if (this.readyState !== 1) return;
    this.link.send({ k: 'ws_close', ws: this.id });
    this.closed();
  }
  /** o navegador (ou o link) foi embora */
  closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
}
