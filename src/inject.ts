import path from 'node:path';
import sharp from 'sharp';
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { MaterialTextures, TextureSet } from './types.js';

function createIO(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

function findMaterial(
  materials: Material[],
  materialName: string
): Material | null {
  const exact = materials.find((m) => m.getName() === materialName);
  if (exact) return exact;

  const lower = materialName.toLowerCase();
  const ci = materials.find((m) => m.getName().toLowerCase() === lower);
  if (ci) return ci;

  // Blender duplicates: "cushions.001"
  const prefix = materials.find((m) => {
    const n = m.getName().toLowerCase();
    return n === lower || n.startsWith(lower + '.');
  });
  return prefix ?? null;
}

/**
 * Second Life's Material uploader silently drops 16-bit PNGs.
 * Instamat often exports Normal/ORM as 16-bit — convert everything to 8-bit PNG.
 */
async function loadTextureImage(
  document: Document,
  filePath: string,
  name: string,
  opts: { keepAlpha: boolean }
) {
  const meta = await sharp(filePath).metadata();
  let pipeline = sharp(filePath);

  if (!opts.keepAlpha) {
    pipeline = pipeline.removeAlpha();
  }

  // Force 8-bit PNG regardless of source depth (8 or 16).
  const png = await pipeline.png({ bitdepth: 8, compressionLevel: 8 }).toBuffer();

  if (meta.depth === 'ushort' || meta.depth === 'float') {
    console.log(
      `    ↓ ${path.basename(filePath)}: ${meta.depth} → 8-bit PNG (${png.byteLength} bytes)`
    );
  }

  return document
    .createTexture(name)
    .setImage(new Uint8Array(png))
    .setMimeType('image/png');
}

async function injectMaterialMaps(
  document: Document,
  material: Material,
  maps: MaterialTextures,
  setId: string
): Promise<void> {
  const label = `${setId}_${maps.materialName}`;

  if (maps.BaseColor) {
    const tex = await loadTextureImage(
      document,
      maps.BaseColor.filePath,
      `${label}_BaseColor`,
      { keepAlpha: true }
    );
    material.setBaseColorTexture(tex);
  }

  if (maps.ORM) {
    const orm = await loadTextureImage(
      document,
      maps.ORM.filePath,
      `${label}_ORM`,
      { keepAlpha: false }
    );
    // glTF metallicRoughness: G=roughness, B=metallic (matches ORM packing).
    material.setMetallicRoughnessTexture(orm);
    // ORM R channel = occlusion — reuse same texture for AO.
    material.setOcclusionTexture(orm);
    material.setMetallicFactor(1);
    material.setRoughnessFactor(1);
  }

  if (maps.Normal) {
    const tex = await loadTextureImage(
      document,
      maps.Normal.filePath,
      `${label}_Normal`,
      { keepAlpha: false }
    );
    material.setNormalTexture(tex);
  }

  if (maps.Emissive) {
    const tex = await loadTextureImage(
      document,
      maps.Emissive.filePath,
      `${label}_Emissive`,
      { keepAlpha: true }
    );
    material.setEmissiveTexture(tex);
    // Ensure emissive is visible if factor was zeroed.
    const [r, g, b] = material.getEmissiveFactor();
    if (r === 0 && g === 0 && b === 0) {
      material.setEmissiveFactor([1, 1, 1]);
    }
  }
}

export interface InjectResult {
  outputPath: string;
  materialsInjected: string[];
  warnings: string[];
  glbMaterialNames: string[];
}

/**
 * Load master GLB (optional) and inject textures for one texture set.
 * When masterGlbPath is null, builds a materials-only GLB (no source mesh required).
 * Writes <meshName>_<textureSetID>.glb into outDir.
 */
export async function injectTextureSet(
  masterGlbPath: string | null,
  set: TextureSet,
  outDir: string
): Promise<InjectResult> {
  const io = createIO();
  const document = masterGlbPath
    ? await io.read(masterGlbPath)
    : createMaterialsOnlyDocument(
        [...set.materials.values()].map((m) => m.materialName)
      );

  const root = document.getRoot();
  const materials = root.listMaterials();
  const glbMaterialNames = materials.map((m) => m.getName());

  const warnings: string[] = [];
  const materialsInjected: string[] = [];

  if (!masterGlbPath) {
    warnings.push(
      `No master GLB for mesh "${set.meshName}" — created materials-only GLB`
    );
  }

  if (materials.length === 0) {
    warnings.push(
      'Master GLB has no materials. Creating materials from texture filenames.'
    );
    for (const maps of set.materials.values()) {
      const mat = document.createMaterial(maps.materialName);
      await injectMaterialMaps(document, mat, maps, set.textureSetID);
      materialsInjected.push(maps.materialName);
    }
  } else {
    for (const maps of set.materials.values()) {
      let mat = findMaterial(materials, maps.materialName);
      if (!mat && !masterGlbPath) {
        // Materials-only doc should already have slots; create if missing.
        mat = document.createMaterial(maps.materialName);
      }
      if (!mat) {
        warnings.push(
          `No GLB material matching "${maps.materialName}" — skipped. ` +
            `GLB materials: [${glbMaterialNames.join(', ')}]`
        );
        continue;
      }
      await injectMaterialMaps(document, mat, maps, set.textureSetID);
      materialsInjected.push(maps.materialName);
    }

    if (masterGlbPath) {
      for (const mat of materials) {
        const name = mat.getName();
        const matched = [...set.materials.values()].some(
          (m) => findMaterial([mat], m.materialName) !== null
        );
        if (!matched) {
          warnings.push(
            `GLB material "${name}" has no textures in set "${set.textureSetID}"`
          );
        }
      }
    }
  }

  if (materialsInjected.length === 0) {
    throw new Error(
      `No materials were injected for set "${set.textureSetID}". ` +
        `Check that material names in filenames match GLB material slots.\n` +
        `Texture materials: [${[...set.materials.values()].map((m) => m.materialName).join(', ')}]\n` +
        `GLB materials: [${glbMaterialNames.join(', ')}]`
    );
  }

  const outName = `${set.meshName}_${set.textureSetID}.glb`;
  const outputPath = path.join(outDir, outName);
  await io.write(outputPath, document);

  return { outputPath, materialsInjected, warnings, glbMaterialNames };
}

/** In-memory materials-only GLB document (tiny placeholder mesh + named materials). */
export function createMaterialsOnlyDocument(materialNames: string[]): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const mesh = document.createMesh('materials');

  const names = materialNames.length > 0 ? materialNames : ['Material'];

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const mat = document
      .createMaterial(name)
      .setBaseColorFactor([0.8, 0.8, 0.8, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1);

    // Offset each tiny triangle so prims are distinct.
    const ox = i * 2;
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(
        new Float32Array([ox, 0, 0, ox + 1, 0, 0, ox, 1, 0])
      )
      .setBuffer(buffer);
    const indices = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint16Array([0, 1, 2]))
      .setBuffer(buffer);

    mesh.addPrimitive(
      document
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setIndices(indices)
        .setMaterial(mat)
    );
  }

  const node = document.createNode('root').setMesh(mesh);
  document.createScene('scene').addChild(node);
  return document;
}

/** Build a tiny placeholder GLB with named materials (for testing / texture-only packs). */
export async function createPlaceholderGlb(
  outPath: string,
  materialNames: string[]
): Promise<void> {
  const document = createMaterialsOnlyDocument(materialNames);
  const io = createIO();
  await io.write(outPath, document);
}
