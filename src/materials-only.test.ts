import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { discoverMeshNames, parseTextureFileNameAuto } from './parse.js';
import { processFolder } from './process.js';

const dir = path.resolve('test-fixtures/materials-only');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const w = 32;
const h = 32;

async function png(name: string, rgb: { r: number; g: number; b: number }) {
  await sharp({
    create: { width: w, height: h, channels: 3, background: rgb },
  })
    .png()
    .toFile(path.join(dir, name));
}

// Generic Materialize-style set: mesh tag = PBR, no master GLB
await png('RedBrick_PBR_default_BaseColor-32x32.png', { r: 180, g: 60, b: 40 });
await png('RedBrick_PBR_default_Normal-32x32.png', { r: 128, g: 128, b: 255 });
await png('RedBrick_PBR_default_ORM-32x32.png', { r: 255, g: 128, b: 0 });
await png('RedBrick_PBR_default_AO-32x32.png', { r: 200, g: 200, b: 200 });
await png('RedBrick_PBR_default_Specular-32x32.png', { r: 220, g: 220, b: 220 });

const auto = parseTextureFileNameAuto('RedBrick_PBR_default_BaseColor-32x32.png', dir);
if (!auto || auto.meshName !== 'PBR' || auto.textureSetID !== 'RedBrick') {
  throw new Error(`auto parse failed: ${JSON.stringify(auto)}`);
}

const meshes = discoverMeshNames(dir);
if (!meshes.includes('PBR')) throw new Error(`expected PBR in ${meshes}`);

const results = await processFolder({ folder: dir, archive: true });
if (results.length !== 1) throw new Error(`expected 1 result, got ${results.length}`);

const out = results[0]!;
const expectedGlb = path.join(dir, 'PBR_RedBrick', 'PBR_RedBrick.glb');
if (!fs.existsSync(expectedGlb)) {
  throw new Error(`missing output GLB at ${expectedGlb}`);
}
const pbrDir = path.join(dir, 'PBR_RedBrick', 'pbr_textures');
const blinnDir = path.join(dir, 'PBR_RedBrick', 'Blinn-Phong_textures');
if (!fs.existsSync(path.join(pbrDir, 'RedBrick_PBR_default_BaseColor-32x32.png'))) {
  throw new Error('BaseColor not in pbr_textures');
}
if (!fs.existsSync(path.join(blinnDir, 'RedBrick_PBR_default_Diffuse-32x32.png'))) {
  throw new Error('Diffuse not in Blinn-Phong_textures');
}
if (!fs.existsSync(path.join(blinnDir, 'RedBrick_PBR_default_Normal-32x32.png'))) {
  throw new Error('Normal copy missing from Blinn-Phong_textures');
}
if (!fs.existsSync(path.join(blinnDir, 'RedBrick_PBR_default_Specular-32x32.png'))) {
  throw new Error('Specular missing from Blinn-Phong_textures');
}
const aoRoot = path.join(dir, 'PBR_RedBrick', 'RedBrick_PBR_default_AO-32x32.png');
if (!fs.existsSync(aoRoot)) throw new Error('AO should stay at archive root');

console.log('Materials-only (no master GLB) test passed.');
console.log('  ', out.outputGlb);
