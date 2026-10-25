// Inspeção rápida de um modelo Mvr_<nome>.o3d/.chr:  npx tsx tests/_m.ts <nome>
import fs from 'node:fs';
import path from 'node:path';
import { parseO3d } from '../shared/formats/o3d';
import { parseChr, parseAni } from '../shared/formats/chr';
const R = path.resolve(import.meta.dirname, '..', process.env.FLYFF_RESOURCE ?? 'original/Resource', 'Data/Model') + path.sep;
const ab = (p: string) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const name = process.argv[2];
const o = parseO3d(ab(R + `Mvr_${name}.o3d`)); const c = parseChr(ab(R + `Mvr_${name}.chr`));
console.log('o3d ver',o.version,'frames',o.frameCount,'bones',o.boneCount,'parts',o.parts.map(p=>[p.skinned,p.usedBones.length,p.positions.length/3,p.parentType,p.parentId,p.textures[0]]));
console.log('chr ver',c.version,'bones',c.bones.length, c.bones.slice(0,6).map(b=>[b.name,b.parentId]));
for (const f of fs.readdirSync(R).filter(f=>f.toLowerCase().startsWith(`mvr_${name.toLowerCase()}_`)&&f.endsWith('.ani'))) {
  const a=parseAni(ab(R+f));
  const mism=a.parents.map((p,i)=>p!==c.bones[i]?.parentId?i:-1).filter(i=>i>=0);
  console.log(f,'frames',a.frameCount,'bones',a.boneCount,'per',a.perSlerp,'parentMismatch',mism.length, 'animatedBones',a.frames.filter(x=>x).length);
}
