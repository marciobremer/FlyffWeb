import { OT } from '../shared/formats/types';
import type { WorldView } from '../shared/world';

/**
 * Pets coletores (item IK3_PET do Titanium): o pet anda atrás do dono e, quando o servidor manda ('petGo'), corre até o item
 * no chão e volta. São mobs "externos" do MoverManager com id negativo (-id do dono), sem nome e sem clique.
 * O servidor é quem pega o item; aqui é só o desenho.
 */
interface Pet { mover: number; pos: [number, number]; h: number; go: { x: number; z: number; until: number } | null; s: string }

/** distância atrás do dono; corre mais rápido que o dono para alcançar */
const FOLLOW = 1.6, SPEED = 9;
/** parado, só sai andando quando fica tanto além da distância de seguir */
const RESTART = 0.8;

export class Pets {
  private list = new Map<number, Pet>();
  constructor(private view: WorldView, private ownerPos: (id: number) => [number, number, number] | null) {}

  /** o pet do jogador `owner` apareceu (mover = MI_*) ou sumiu (0) */
  set(owner: number, mover: number) {
    const old = this.list.get(owner);
    if (old?.mover === mover) return;
    this.view.moverMgr.removeExternal(-owner);
    if (!mover) { this.list.delete(owner); return; }
    const p = this.ownerPos(owner);
    this.list.set(owner, { mover, pos: p ? [p[0] + 1, p[2] + 1] : [0, 0], h: 0, go: null, s: 'stand' });
  }

  /** o pet de `owner` vai buscar o item em (x, z) e chega em `ms` */
  go(owner: number, x: number, z: number, ms: number) {
    const p = this.list.get(owner);
    if (p) p.go = { x, z, until: performance.now() + ms };
  }

  clear() { for (const owner of [...this.list.keys()]) this.set(owner, 0); }

  update(dt: number) {
    const mm = this.view.moverMgr, d = this.view.data;
    if (!d) return;
    for (const [owner, p] of this.list) {
      const o = this.ownerPos(owner);
      const has = mm.externalInfo(-owner);
      if (!o) { if (has) mm.removeExternal(-owner); continue; } // dono fora da vista: o pet some junto
      if (!has) {
        // (re)aparece: ao chamar, ao trocar de mapa ou depois de limpar os mobs
        const entry = d.dynaModels.get(`${OT.MOVER}:${p.mover}`);
        if (!entry) continue;
        if (Math.hypot(p.pos[0] - o[0], p.pos[1] - o[2]) > 20) p.pos = [o[0] + 1, o[2] + 1];
        mm.addExternal(-owner, entry, p.pos[0], p.pos[1], p.h, 'stand', null, 1000, true);
        p.s = 'stand';
      }
      if (p.go && performance.now() > p.go.until + 300) p.go = null;
      let tx: number, tz: number, stop: number;
      if (p.go) { tx = p.go.x; tz = p.go.z; stop = 0.2; } else { tx = o[0]; tz = o[2]; stop = FOLLOW; }
      const dx = tx - p.pos[0], dz = tz - p.pos[1], dist = Math.hypot(dx, dz);
      if (dist > 40) { p.pos = [o[0] + 1, o[2] + 1]; continue; } // ficou muito longe (teleporte): reaparece ao lado
      // parado só volta a andar quando o dono se afasta um pouco (sem isso alterna andar/parado a cada passinho do dono)
      if (p.s === 'stand' ? dist > stop + (p.go ? 0 : RESTART) : dist > stop + 0.05) {
        const step = Math.min(dist - stop, (p.go ? SPEED : Math.max(SPEED * 0.6, dist * 2)) * dt);
        p.pos = [p.pos[0] + (dx / dist) * step, p.pos[1] + (dz / dist) * step];
        p.h = (Math.atan2(dx, -dz) * 180) / Math.PI;
        p.s = 'run';
      } else p.s = 'stand';
      const s = p.s;
      mm.moveExternal(-owner, p.pos[0], p.pos[1], p.h, s);
    }
  }
}
