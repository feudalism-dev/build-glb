import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  discoverMeshNames,
  groupIntoTextureSets,
  masterGlbForMesh,
  scanTextures,
  summarizeSet,
  validateTextureSet,
} from './parse.js';
import { injectTextureSet } from './inject.js';
import { generateBlinnPhongMaps } from './blinnphong.js';
import type { ProcessResult, TextureSet } from './types.js';

export interface ProcessOptions {
  folder: string;
  /** Only process this textureSetID (optional). */
  textureSetID?: string;
  /** Only process this meshName tag (optional), e.g. hotelBed2 or PBR. */
  meshName?: string;
  /** Move textures + output GLB into a subfolder after success. Default true. */
  archive?: boolean;
  /** Keep master mesh GLB in the Exports root. Default true. */
  keepMaster?: boolean;
}

const PBR_ARCHIVE_SLOTS = ['BaseColor', 'Normal', 'ORM', 'Emissive'] as const;
const BLINN_ARCHIVE_SLOTS = ['Specular'] as const;

const PBR_SUBDIR = 'pbr_textures';
const BLINN_SUBDIR = 'Blinn-Phong_textures';

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function moveFile(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV' || code === 'EPERM') {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
}

async function copyFile(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

function archiveFolderName(set: TextureSet): string {
  return `${set.meshName}_${set.textureSetID}`;
}

/**
 * Archive layout:
 *   <mesh>_<set>/
 *     <mesh>_<set>.glb
 *     *AO* / *AmbientOcclusion*   (top level)
 *     pbr_textures/               BaseColor, Normal, ORM, Emissive
 *     Blinn-Phong_textures/       Diffuse, Specular, copy of Normal
 */
async function archiveSet(
  folder: string,
  set: TextureSet,
  outputGlb: string,
  derivedTextures: string[]
): Promise<{ destDir: string; derivedInArchive: string[] }> {
  const destDir = path.join(folder, archiveFolderName(set));
  const pbrDir = path.join(destDir, PBR_SUBDIR);
  const blinnDir = path.join(destDir, BLINN_SUBDIR);
  await ensureDir(pbrDir);
  await ensureDir(blinnDir);

  const moved = new Set<string>();
  const derivedInArchive: string[] = [];

  for (const mat of set.materials.values()) {
    const ao = mat.AO;
    if (!ao || moved.has(ao.filePath) || !fs.existsSync(ao.filePath)) continue;
    await moveFile(ao.filePath, path.join(destDir, ao.fileName));
    moved.add(ao.filePath);
  }

  for (const mat of set.materials.values()) {
    for (const key of PBR_ARCHIVE_SLOTS) {
      const tex = mat[key];
      if (!tex || moved.has(tex.filePath) || !fs.existsSync(tex.filePath)) continue;
      const dest = path.join(pbrDir, tex.fileName);
      await moveFile(tex.filePath, dest);
      moved.add(tex.filePath);

      if (key === 'Normal') {
        await copyFile(dest, path.join(blinnDir, tex.fileName));
      }
    }
  }

  for (const mat of set.materials.values()) {
    for (const key of BLINN_ARCHIVE_SLOTS) {
      const tex = mat[key];
      if (!tex || moved.has(tex.filePath) || !fs.existsSync(tex.filePath)) continue;
      await moveFile(tex.filePath, path.join(blinnDir, tex.fileName));
      moved.add(tex.filePath);
    }
  }

  for (const derived of derivedTextures) {
    if (!fs.existsSync(derived) || moved.has(derived)) continue;
    const dest = path.join(blinnDir, path.basename(derived));
    if (path.resolve(derived) !== path.resolve(dest)) {
      await moveFile(derived, dest);
    }
    moved.add(derived);
    derivedInArchive.push(dest);
  }

  if (fs.existsSync(outputGlb)) {
    const dest = path.join(destDir, path.basename(outputGlb));
    if (path.resolve(outputGlb) !== path.resolve(dest)) {
      await moveFile(outputGlb, dest);
    }
  }

  return { destDir, derivedInArchive };
}

async function processMesh(
  folder: string,
  meshName: string,
  options: ProcessOptions
): Promise<ProcessResult[]> {
  const masterGlb = masterGlbForMesh(folder, meshName);
  if (masterGlb) {
    console.log(`Master GLB: ${path.basename(masterGlb)} (meshName="${meshName}")`);
  } else {
    console.log(
      `No master GLB for meshName="${meshName}" — will build materials-only GLB(s)`
    );
  }

  const textures = scanTextures(folder, meshName);
  if (textures.length === 0) {
    return [];
  }

  let sets = groupIntoTextureSets(textures);
  if (options.textureSetID) {
    sets = sets.filter((s) => s.textureSetID === options.textureSetID);
  }

  const archive = options.archive !== false;
  const results: ProcessResult[] = [];

  for (const set of sets) {
    console.log(`\nProcessing ${summarizeSet(set)}`);
    const setWarnings = validateTextureSet(set);
    for (const w of setWarnings) console.warn(`  ⚠ ${w}`);

    const injected = await injectTextureSet(masterGlb, set, folder);
    for (const w of injected.warnings) console.warn(`  ⚠ ${w}`);

    console.log(
      `  Injected ${injected.materialsInjected.length} material(s) → ${path.basename(injected.outputPath)}`
    );

    const derived = await generateBlinnPhongMaps(set, folder);
    for (const w of derived.warnings) console.warn(`  ⚠ ${w}`);
    if (derived.generated.length > 0) {
      console.log(`  Baked ${derived.generated.length} Diffuse map(s)`);
    }

    let archiveFolder = '';
    let finalGlb = injected.outputPath;
    let finalDerived = derived.generated;
    if (archive) {
      const archived = await archiveSet(
        folder,
        set,
        injected.outputPath,
        derived.generated
      );
      archiveFolder = archived.destDir;
      finalGlb = path.join(archiveFolder, path.basename(injected.outputPath));
      finalDerived = archived.derivedInArchive;
      console.log(`  Archived → ${path.basename(archiveFolder)}/`);
      console.log(`    ${PBR_SUBDIR}/  ${BLINN_SUBDIR}/  (AO + GLB at root)`);
    }

    results.push({
      textureSetID: set.textureSetID,
      meshName: set.meshName,
      outputGlb: finalGlb,
      archiveFolder,
      materialsInjected: injected.materialsInjected,
      derivedTextures: finalDerived,
      warnings: [...setWarnings, ...injected.warnings, ...derived.warnings],
    });
  }

  return results;
}

export async function processFolder(
  options: ProcessOptions
): Promise<ProcessResult[]> {
  const folder = path.resolve(options.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`Folder does not exist: ${folder}`);
  }

  const meshNames = options.meshName
    ? [options.meshName]
    : discoverMeshNames(folder);

  if (meshNames.length === 0) {
    throw new Error(
      `No Instamat/Materialize textures found in:\n  ${folder}\n` +
        `Expected: <textureSetID>_<meshName>_<material>_<BaseColor|Normal|ORM|Emissive|AO|Specular>[_-]<WxH>.png\n` +
        `Use meshName "PBR" for generic materials, or a model name for mesh-specific sets.`
    );
  }

  const results: ProcessResult[] = [];
  for (const meshName of meshNames) {
    const meshResults = await processMesh(folder, meshName, options);
    results.push(...meshResults);
  }

  if (options.textureSetID && results.length === 0) {
    throw new Error(`No textures found for textureSetID "${options.textureSetID}"`);
  }

  if (results.length === 0) {
    throw new Error(`No processable texture sets found in:\n  ${folder}`);
  }

  return results;
}

/** Return texture set IDs currently sitting (unarchived) in the folder for a mesh. */
export function listPendingSetIds(folder: string, meshName: string): string[] {
  const textures = scanTextures(folder, meshName);
  const sets = groupIntoTextureSets(textures);
  return sets.map((s) => s.textureSetID);
}
