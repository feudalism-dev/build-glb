import path from 'node:path';
import sharp from 'sharp';
import type { TextureSet } from './types.js';

function outputName(
  setId: string,
  meshName: string,
  materialName: string,
  resolution: string
): string {
  return `${setId}_${meshName}_${materialName}_Diffuse-${resolution}.png`;
}

/**
 * Diffuse = BaseColor RGB × AO grayscale (alpha preserved from BaseColor).
 * Classic Blinn-Phong bake used in Second Life.
 */
async function makeDiffuse(
  baseColorPath: string,
  aoPath: string,
  outPath: string
): Promise<void> {
  const baseMeta = await sharp(baseColorPath).metadata();
  const width = baseMeta.width ?? 0;
  const height = baseMeta.height ?? 0;
  if (!width || !height) {
    throw new Error(`Could not read size of BaseColor: ${baseColorPath}`);
  }

  const { data: baseData, info: baseInfo } = await sharp(baseColorPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: aoData } = await sharp(aoPath)
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(baseData.length);
  const channels = baseInfo.channels; // 4 after ensureAlpha
  const pixels = width * height;

  for (let i = 0; i < pixels; i++) {
    const ao = aoData[i]! / 255;
    const o = i * channels;
    out[o] = Math.round(baseData[o]! * ao);
    out[o + 1] = Math.round(baseData[o + 1]! * ao);
    out[o + 2] = Math.round(baseData[o + 2]! * ao);
    out[o + 3] = baseData[o + 3]!;
  }

  await sharp(out, {
    raw: { width, height, channels: 4 },
  })
    .png({ bitdepth: 8, compressionLevel: 8 })
    .toFile(outPath);
}

/**
 * For each material with BaseColor + AO, write a Diffuse PNG into outDir.
 * Specular/glossiness comes from Instamat — we do not generate it.
 * Does not modify the PBR GLB.
 */
export async function generateBlinnPhongMaps(
  set: TextureSet,
  outDir: string
): Promise<{ generated: string[]; warnings: string[] }> {
  const generated: string[] = [];
  const warnings: string[] = [];

  const mats = [...set.materials.values()];
  const anyAO = mats.some((m) => m.AO);

  if (!anyAO) {
    console.log('  (No AO maps found — skipping Diffuse bake)');
    return { generated, warnings };
  }

  for (const mat of mats) {
    if (mat.BaseColor && mat.AO) {
      const fileName = outputName(
        set.textureSetID,
        set.meshName,
        mat.materialName,
        mat.BaseColor.resolution
      );
      const outPath = path.join(outDir, fileName);
      await makeDiffuse(mat.BaseColor.filePath, mat.AO.filePath, outPath);
      generated.push(outPath);
      console.log(`  + Diffuse  ${fileName}`);
    } else if (mat.AO && !mat.BaseColor) {
      warnings.push(
        `Material "${mat.materialName}" has AO but no BaseColor — skipped Diffuse`
      );
    } else if (mat.BaseColor && !mat.AO) {
      warnings.push(
        `Material "${mat.materialName}" has no AO — skipped Diffuse`
      );
    }
  }

  return { generated, warnings };
}
