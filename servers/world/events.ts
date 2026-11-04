import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../common/config';
import { DAY_MS, gameHour } from '../../shared/gameclock';

/**
 * Eventos por horário, hora do jogo, clima e quests, definidos em `data/events.json` (editável à mão; o servidor relê o arquivo
 * quando ele muda, sem reiniciar).
 *
 *   { "weather": { "worlds": ["WdMadrigal"], "rainChance": 20, "checkMinutes": 10, "rainMinutes": [5, 12] },
 *     "events": [ {
 *       "id": "boss_noite",                 identificador único
 *       "name": "Chefe da noite",           (só para o log / //evento)
 *       "enabled": true,                    false = fica no arquivo mas não dispara (opcional)
 *       "when": { ...um gatilho... },       sem "when" = só roda por //evento run <id> ou por recompensa de quest
 *       "do": [ ...ações, em ordem... ]
 *   } ] }
 *
 * Gatilhos ("when"), um por evento:
 *   { "time": "20:30", "days": ["sab", "dom"] }   horário do relógio do servidor (hora local da máquina); days opcional (dom seg ter qua qui sex sab)
 *   { "gameHour": 19 }                             hora do jogo (relógio de dia e noite de shared/gameclock.ts) — dispara quando vira essa hora
 *   { "every": 30 }                                a cada N minutos de relógio
 *   { "weather": "rain" }                          quando começa a chover ("clear" = quando para)
 *
 * Ações ("do"):
 *   { "announce": "texto", "loops": 2 }            letreiro no meio da tela para todos (e no chat)
 *   { "wait": 10 }                                 espera N segundos antes da próxima ação
 *   { "summon": { "mob": "MI_CLOCKWORK1", "world": "DuClockwork", "point": "cw_chefe", "count": 1, "unique": true } }
 *                                                  invoca monstros (não renascem) no ponto marcado no editor (ou "at": [x, z]);
 *                                                  unique: não invoca se já há um vivo desse monstro no mapa
 *   { "rates": { "exp": 2, "drop": 1.5, "penya": 1 }, "minutes": 30 }   multiplica as taxas do servidor por um tempo
 *   { "weather": "rain", "minutes": 10 }          liga / desliga a chuva ("clear")
 *   { "give": { "item": "II_...", "count": 1, "world": "WdMadrigal" } }  dá o item a todos online (no mapa, se informado)
 *   { "event": "outro_id" }                        dispara outro evento
 */
export type Trigger =
  | { time: { h: number; m: number }; days: number[] | null }
  | { gameHour: number }
  | { every: number }
  | { weather: 'rain' | 'clear' };

export type Action =
  | { announce: string; loops: number }
  | { wait: number }
  | { summon: { mob: string; world: string | null; point: string | null; at: [number, number] | null; count: number; unique: boolean } }
  | { rates: { exp: number; drop: number; penya: number }; minutes: number }
  | { weather: 'rain' | 'clear'; minutes: number }
  | { give: { item: string; count: number; world: string | null } }
  | { event: string };

export interface EventDef { id: string; name: string; when: Trigger | null; do: Action[] }
export interface WeatherConfig { worlds: string[]; rainChance: number; checkMinutes: number; rainMinutes: [number, number] }

export const EVENTS_FILE = path.join(ROOT, 'data', 'events.json');
const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const num = (v: unknown, d: number, lo = 0, hi = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function parseTrigger(w: Record<string, unknown>): Trigger {
  if (typeof w.time === 'string') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(w.time.trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`horário inválido "${w.time}" (use HH:MM)`);
    const days = Array.isArray(w.days) ? w.days.map((d) => (typeof d === 'number' ? d : DAYS.indexOf(String(d).toLowerCase().slice(0, 3)))).filter((d) => d >= 0 && d <= 6) : null;
    return { time: { h: Number(m[1]), m: Number(m[2]) }, days: days?.length ? days : null };
  }
  if (w.gameHour !== undefined) return { gameHour: num(w.gameHour, 0, 0, 24) % 24 };
  if (w.every !== undefined) return { every: num(w.every, 30, 1, 1440) };
  if (w.weather === 'rain' || w.weather === 'clear') return { weather: w.weather };
  throw new Error('gatilho desconhecido (use time, gameHour, every ou weather)');
}

function parseAction(a: Record<string, unknown>): Action {
  if (typeof a.announce === 'string') return { announce: a.announce.slice(0, 200), loops: num(a.loops, 1, 1, 10) };
  if (a.wait !== undefined) return { wait: num(a.wait, 1, 0, 3600) };
  if (a.summon && typeof a.summon === 'object') {
    const s = a.summon as Record<string, unknown>;
    if (typeof s.mob !== 'string') throw new Error('summon precisa de "mob"');
    const at = Array.isArray(s.at) && s.at.length === 2 ? ([num(s.at[0], 0), num(s.at[1], 0)] as [number, number]) : null;
    return { summon: { mob: s.mob, world: typeof s.world === 'string' ? s.world : null, point: typeof s.point === 'string' ? s.point : null, at, count: num(s.count, 1, 1, 50), unique: !!s.unique } };
  }
  if (a.rates && typeof a.rates === 'object') {
    const r = a.rates as Record<string, unknown>;
    return { rates: { exp: num(r.exp, 1, 0.1, 1000), drop: num(r.drop, 1, 0.1, 1000), penya: num(r.penya, 1, 0.1, 1000) }, minutes: num(a.minutes, 10, 1, 1440) };
  }
  if (a.weather === 'rain' || a.weather === 'clear') return { weather: a.weather, minutes: num(a.minutes, 10, 1, 1440) };
  if (a.give && typeof a.give === 'object') {
    const g = a.give as Record<string, unknown>;
    if (typeof g.item !== 'string') throw new Error('give precisa de "item"');
    return { give: { item: g.item, count: num(g.count, 1, 1, 9999), world: typeof g.world === 'string' ? g.world : null } };
  }
  if (typeof a.event === 'string') return { event: a.event };
  throw new Error('ação desconhecida: ' + JSON.stringify(a).slice(0, 80));
}

/** o que os eventos precisam do servidor do jogo (o realtime.ts entrega) */
export interface EventHost {
  announce(text: string, loops: number): void;
  /** invoca monstros; devolve o aviso de erro (ou null) */
  summon(s: { mob: string; world: string | null; point: string | null; at: [number, number] | null; count: number; unique: boolean }): string | null;
  boost(r: { exp: number; drop: number; penya: number }, ms: number): void;
  /** dá o item a todos online; devolve para quantos */
  give(item: string, count: number, world: string | null): number;
  /** hora do jogo fixada por GM (o relógio parado), null = andando */
  fixedHour(): number | null;
  /** o clima de um mundo mudou (manda aos jogadores dele) */
  weatherChanged(world: string, kind: 'rain' | 'clear'): void;
}

const DEFAULT_WEATHER: WeatherConfig = { worlds: [], rainChance: 0, checkMinutes: 10, rainMinutes: [5, 12] };

export class EventScheduler {
  private events = new Map<string, EventDef>();
  private weatherCfg: WeatherConfig = { ...DEFAULT_WEATHER };
  private mtime = -1;
  private checkedAt = 0;
  /** chuva por mundo: até quando (ms) */
  private rain = new Map<string, number>();
  private lastFired = new Map<string, string>();
  private nextWeatherCheck = 0;
  private timer: NodeJS.Timeout | null = null;
  private timeouts = new Set<NodeJS.Timeout>();

  constructor(private host: EventHost, private log: (t: string) => void = console.log) {}

  start() {
    this.refresh();
    this.nextWeatherCheck = Date.now() + this.weatherCfg.checkMinutes * 60_000;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts.clear();
  }

  private refresh() {
    const now = Date.now();
    if (now - this.checkedAt < 2000) return;
    this.checkedAt = now;
    let m = 0;
    try { m = fs.statSync(EVENTS_FILE).mtimeMs; } catch { /* sem arquivo: sem eventos */ }
    if (m === this.mtime) return;
    this.mtime = m;
    this.events.clear();
    let raw: { weather?: Record<string, unknown>; events?: unknown[] } | null = null;
    try { raw = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); } catch (e) { if (m) console.warn('Eventos: data/events.json inválido:', (e as Error).message); }
    const w = raw?.weather ?? {};
    const rm = Array.isArray(w.rainMinutes) ? w.rainMinutes : [];
    this.weatherCfg = {
      worlds: Array.isArray(w.worlds) ? w.worlds.filter((x): x is string => typeof x === 'string') : [], rainChance: num(w.rainChance, 0, 0, 100), checkMinutes: num(w.checkMinutes, 10, 1, 1440),
      rainMinutes: [num(rm[0], 5, 1, 1440), Math.max(num(rm[0], 5, 1, 1440), num(rm[1], 12, 1, 1440))],
    };
    for (const j of raw?.events ?? []) {
      const e = j as Record<string, unknown>;
      if (e?.enabled === false) continue;
      try {
        const id = String(e.id ?? '');
        if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) throw new Error(`id inválido "${id}"`);
        this.events.set(id, { id, name: String(e.name ?? id), when: e.when && typeof e.when === 'object' ? parseTrigger(e.when as Record<string, unknown>) : null, do: (Array.isArray(e.do) ? e.do : []).map((a) => parseAction(a as Record<string, unknown>)) });
      } catch (err) { console.warn(`Eventos: "${String((e as { id?: unknown })?.id)}": ${(err as Error).message}`); }
    }
    this.log(`Eventos: ${this.events.size} carregado(s), chuva em ${this.weatherCfg.worlds.join(', ') || 'nenhum mapa'}.`);
  }

  list() { this.refresh(); return [...this.events.values()]; }
  isRaining(world: string) { return (this.rain.get(world) ?? 0) > Date.now(); }
  weatherOf(world: string): 'rain' | 'clear' { return this.isRaining(world) ? 'rain' : 'clear'; }

  /** liga/desliga a chuva de um mundo (ou de todos os do clima) por `minutes` */
  setWeather(kind: 'rain' | 'clear', minutes: number, world?: string) {
    this.refresh();
    for (const w of world ? [world] : this.weatherCfg.worlds) {
      const was = this.isRaining(w);
      if (kind === 'rain') this.rain.set(w, Date.now() + minutes * 60_000); else this.rain.delete(w);
      if (was !== (kind === 'rain')) this.changed(w, kind);
    }
  }

  private changed(world: string, kind: 'rain' | 'clear') {
    this.host.weatherChanged(world, kind);
    for (const e of this.events.values()) if (e.when && 'weather' in e.when && e.when.weather === kind) this.run(e.id, `clima ${kind} em ${world}`);
  }

  /** roda um evento pelo id (gatilho, //evento ou quest); devolve false se não existe */
  run(id: string, why = 'manual'): boolean {
    this.refresh();
    const e = this.events.get(id);
    if (!e) return false;
    this.log(`Evento "${e.id}" (${why})`);
    this.exec(e, 0);
    return true;
  }

  private exec(e: EventDef, from: number) {
    for (let i = from; i < e.do.length; i++) {
      const a = e.do[i];
      if ('wait' in a) {
        const t = setTimeout(() => { this.timeouts.delete(t); this.exec(e, i + 1); }, a.wait * 1000);
        this.timeouts.add(t);
        return;
      }
      try { this.act(a); } catch (err) { console.warn(`Evento "${e.id}":`, (err as Error).message); }
    }
  }

  private act(a: Action) {
    if ('announce' in a) this.host.announce(a.announce, a.loops);
    else if ('summon' in a) { const why = this.host.summon(a.summon); if (why) console.warn(`Evento: ${why}`); }
    else if ('rates' in a) this.host.boost(a.rates, a.minutes * 60_000);
    else if ('weather' in a) this.setWeather(a.weather, a.minutes);
    else if ('give' in a) this.host.give(a.give.item, a.give.count, a.give.world);
    else if ('event' in a) this.run(a.event, 'encadeado');
  }

  private tick() {
    this.refresh();
    const now = Date.now(), d = new Date(now);
    // chuva ao acaso nos mapas do clima: acaba sozinha; a cada `checkMinutes` pode começar uma
    for (const [w, until] of [...this.rain]) if (until <= now) { this.rain.delete(w); this.changed(w, 'clear'); }
    if (now >= this.nextWeatherCheck) {
      this.nextWeatherCheck = now + this.weatherCfg.checkMinutes * 60_000;
      const [lo, hi] = this.weatherCfg.rainMinutes;
      for (const w of this.weatherCfg.worlds) if (!this.isRaining(w) && Math.random() * 100 < this.weatherCfg.rainChance) this.setWeather('rain', lo + Math.random() * (hi - lo), w);
    }
    const fixed = this.host.fixedHour();
    for (const e of this.events.values()) {
      const t = e.when;
      if (!t) continue;
      let key: string | null = null;
      if ('time' in t) { if (d.getHours() === t.time.h && d.getMinutes() === t.time.m && (!t.days || t.days.includes(d.getDay()))) key = d.toDateString() + ' ' + d.getHours() + ':' + d.getMinutes(); }
      else if ('gameHour' in t) { const h = Math.floor(gameHour(now)); if (fixed === null && h % 24 === t.gameHour) key = Math.floor(now / DAY_MS) + ':' + h; }
      else if ('every' in t) key = String(Math.floor(now / (t.every * 60_000)));
      if (key === null || this.lastFired.get(e.id) === key) continue;
      const first = !this.lastFired.has(e.id);
      this.lastFired.set(e.id, key);
      // "every" e "gameHour" não disparam na hora em que o servidor sobe (só nas viradas seguintes)
      if (first && ('every' in t || 'gameHour' in t)) continue;
      this.run(e.id, 'horário');
    }
  }
}
