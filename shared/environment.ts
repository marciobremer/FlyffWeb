import { Color, Vector3 } from 'three';
import type { WldInfo } from './formats/wld';
import type { Continent } from './formats/rgn';

/** Cores horárias de CWorld::s_light (WorldEnvironment.cpp): r1,g1,b1 = névoa/difusa; r2,g2,b2 = ambiente. */
const S_LIGHT: number[][] = [
  [0.4, 0.4, 0.5, 0.3, 0.3, 0.4], [0.4, 0.4, 0.5, 0.3, 0.3, 0.4], [0.4, 0.4, 0.5, 0.3, 0.3, 0.4], [0.4, 0.4, 0.5, 0.3, 0.3, 0.4],
  [0.4, 0.4, 0.5, 0.3, 0.3, 0.4], [0.4, 0.4, 0.5, 0.3, 0.3, 0.4], [0.5, 0.5, 0.6, 0.4, 0.4, 0.4], [0.7, 0.7, 0.7, 0.5, 0.5, 0.5],
  [0.8, 0.8, 0.8, 0.5, 0.5, 0.5], [0.9, 0.9, 0.9, 0.5, 0.5, 0.5], [1, 1, 1, 0.5, 0.5, 0.5], [1, 1, 1, 0.6, 0.6, 0.6],
  [1, 1, 1, 0.6, 0.6, 0.6], [1, 1, 1, 0.6, 0.6, 0.6], [1, 1, 1, 0.6, 0.6, 0.6], [1, 1, 1, 0.5, 0.5, 0.5],
  [0.9, 0.9, 0.9, 0.5, 0.5, 0.5], [0.9, 0.6, 0.2, 0.5, 0.5, 0.4], [0.6, 0.6, 0.4, 0.4, 0.4, 0.4], [0.5, 0.5, 0.4, 0.4, 0.4, 0.4],
  [0.45, 0.45, 0.4, 0.35, 0.35, 0.35], [0.43, 0.43, 0.5, 0.33, 0.33, 0.3], [0.41, 0.41, 0.5, 0.31, 0.31, 0.3], [0.4, 0.4, 0.5, 0.3, 0.3, 0.4],
];

export interface Environment {
  fog: Color;
  diffuse: Color;
  ambient: Color;
  /** direção para a qual a luz viaja, no espaço FlyFF (D3D) */
  direction: Vector3;
  fogStart: number;
  fogEnd: number;
  continent: Continent | null;
}

/**
 * `CWorld::UpdateContinent`: primeiro continente com C_useEnvir que contém (x, z) (teste par/ímpar de raios).
 */
export function findContinent(continents: Continent[], x: number, z: number): Continent | null {
  for (const c of continents) {
    if (!c.useEnvir || c.vertices.length < 3) continue;
    let counter = 0;
    let p1 = c.vertices[0];
    for (let j = 1; j <= c.vertices.length; j++) {
      const p2 = c.vertices[j % c.vertices.length];
      if (z > Math.min(p1[2], p2[2]) && z <= Math.max(p1[2], p2[2]) && x <= Math.max(p1[0], p2[0]) && p1[2] !== p2[2]) {
        const xi = ((z - p1[2]) * (p2[0] - p1[0])) / (p2[2] - p1[2]) + p1[0];
        if (p1[0] === p2[0] || x <= xi) counter++;
      }
      p1 = p2;
    }
    if (counter % 2 !== 0) return c;
  }
  return null;
}

const hexRgb = (v: number) => new Color(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);

/** `CWorld::_setLight` / `_setFog` (WorldEnvironment.cpp). `hour` em horas decimais (0..24). */
export function computeEnvironment(wld: WldInfo, continent: Continent | null, hour: number): Environment {
  if (continent?.useEnvir) {
    const d = continent.diffuse, a = continent.ambient;
    const sun = new Vector3(0, 0.5, 0.5).normalize();
    return {
      fog: new Color(d[0], d[1], d[2]),
      diffuse: new Color(Math.min(1, d[0] * 1.2), Math.min(1, d[1] * 1.2), Math.min(1, d[2] * 1.2)),
      ambient: new Color(a[0] * 0.8, a[1] * 0.8, a[2] * 0.8),
      direction: sun.negate(),
      fogStart: continent.fogStart, fogEnd: continent.fogEnd, continent,
    };
  }
  if (wld.indoor) {
    const dl = wld.diffuse, am = wld.ambient;
    const d = hexRgb(dl), a = hexRgb(am);
    return {
      fog: d.clone(),
      diffuse: new Color(d.r + 0.1, d.g + 0.1, d.b + 0.1),
      ambient: a.multiplyScalar(0.9),
      direction: new Vector3(...wld.lightDir),
      fogStart: wld.fog.start, fogEnd: wld.fog.end, continent: null,
    };
  }
  // exterior: interpola s_light[hora-1] com a hora anterior pelos minutos
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h), min = Math.floor((h - hh) * 60);
  let idx = hh - 1;
  if (idx < 0) idx = 0;
  if (idx > 23) idx = 23;
  const prev = S_LIGHT[idx - 1 === -1 ? 23 : idx - 1], cur = S_LIGHT[idx];
  const mix = (i: number) => prev[i] + (cur[i] - prev[i]) * (min / 60);
  const c1 = new Color(mix(0), mix(1), mix(2)), c2 = new Color(mix(3), mix(4), mix(5));
  // vetor do sol (a fórmula original quase não varia com a hora: o sol fica praticamente a pino)
  const temp2 = hh >= 1 && hh <= 6 ? 24 + hh : hh;
  const sunAngle = temp2 * 24 * 60 * 0.00015 - 90 + 180; // graus
  const a = (sunAngle * Math.PI) / 180;
  return {
    fog: c1.clone(),
    diffuse: new Color(Math.min(1, c1.r * 1.1), Math.min(1, c1.g * 1.1), Math.min(1, c1.b * 1.1)),
    ambient: c2.multiplyScalar(0.9),
    // D3DXVec3TransformCoord((0,0,1), RotationX(a)) com vetor-linha = (0, -sin a, cos a)
    direction: new Vector3(0, -Math.sin(a), Math.cos(a)),
    fogStart: wld.fog.start, fogEnd: wld.fog.end, continent: null,
  };
}

/** Horários do skybox: 3 texturas (dia, entardecer, noite) com fusão por hora (CSkybox::Render). */
export function skyBlend(hour: number): { index: number; alpha: number }[] {
  const h = Math.floor(((hour % 24) + 24) % 24), m = Math.floor((hour - Math.floor(hour)) * 60);
  if (h < 6) return [{ index: 2, alpha: 1 }];
  if (h === 6) return [{ index: 2, alpha: 1 - m / 59 }, { index: 0, alpha: m / 59 }];
  if (h < 17) return [{ index: 0, alpha: 1 }];
  if (h === 17 || h === 18) {
    const mm = h === 17 ? m : m + 60;
    return [{ index: 0, alpha: 1 - mm / 119 }, { index: 1, alpha: mm / 119 }];
  }
  if (h === 19) return [{ index: 1, alpha: 1 - m / 59 }, { index: 2, alpha: m / 59 }];
  return [{ index: 2, alpha: 1 }];
}
