import {
  parseTextureFileName,
  groupIntoTextureSets,
  slotForType,
} from './parse.js';
import type { ParsedTexture } from './types.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const samples = [
  'Set3_hotelBed2_base_BaseColor-2048x2048.png',
  'Set3_hotelBed2_ns_handles_Normal-2048x2048.png',
  'Set3_hotelBed2_base_AO-2048x2048.png',
  'Set3_hotelBed2_base_AmbientOcclusion-2048x2048.png',
  'Set3_hotelBed2_base_Specular-2048x2048.png',
  'Set3_hotelBed2_base_Diffuse-2048x2048.png',
  'Set3_hotelBed2_base_Roughness-2048x2048.png',
  'paisley1_PBR_BaseColor-2048x2048.png',
  'paisley1_PBR_AO-2048x2048.png',
];

const a = parseTextureFileName(samples[0], 'hotelBed2');
assert(a?.textureType === 'BaseColor', 'BaseColor');

const ao = parseTextureFileName(samples[2], 'hotelBed2');
assert(ao?.textureType === 'AO', 'AO type');
assert(slotForType('AmbientOcclusion') === 'AO', 'AmbientOcclusion → AO');

const amb = parseTextureFileName(samples[3], 'hotelBed2');
assert(amb?.textureType === 'AmbientOcclusion', 'AmbientOcclusion type');

const spec = parseTextureFileName(samples[4], 'hotelBed2');
assert(spec?.textureType === 'Specular', 'Specular from Instamat');
assert(slotForType('Specular') === 'Specular', 'Specular is archive slot');

const diff = parseTextureFileName(samples[5], 'hotelBed2');
assert(diff?.textureType === 'Diffuse', 'Diffuse recognized');
assert(slotForType('Diffuse') === null, 'Diffuse not an input slot');

assert(
  parseTextureFileName(samples[6], 'hotelBed2') === null,
  'Roughness ignored'
);

// Materialize-style: no materialName segment
const mz = parseTextureFileName(samples[7], 'PBR');
assert(mz, 'Materialize BaseColor');
assert(mz.textureSetID === 'paisley1', `set ${mz.textureSetID}`);
assert(mz.meshName === 'PBR', 'mesh PBR');
assert(mz.materialName === 'paisley1', 'material defaults to set id');
assert(mz.textureType === 'BaseColor', 'type');

const mzAo = parseTextureFileName(samples[8], 'PBR');
assert(mzAo?.textureType === 'AO', 'Materialize AO');

const textures: ParsedTexture[] = [a, ao, amb, spec].map((t) => ({
  ...t!,
  filePath: t!.fileName,
}));
const sets = groupIntoTextureSets(textures);
assert(sets.length === 1, 'one set');
const baseMat = sets[0].materials.get('base');
assert(baseMat?.AO, 'AO stored');
assert(baseMat?.Specular, 'Specular stored for archive');

console.log('All parse tests passed.');
