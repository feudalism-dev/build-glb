import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATED_TYPES,
  TEXTURE_TYPES,
  type ParsedTexture,
  type TextureSet,
  type TextureType,
  type MaterialTextures,
} from './types.js';

/**
 * Instamat / Materialize naming (supports underscore or hyphen before resolution):
 *   <textureSetID>_<meshName>_<materialName>_<textureType>[_-]<resolution>.png
 *   <textureSetID>_<meshName>_<textureType>[_-]<resolution>.png   (no material; Materialize)
 *
 * When materialName is omitted, it defaults to textureSetID.
 * meshName is an organizer tag: a model name (hotelBed2) or "PBR" for generic materials.
 * A master .glb is optional — when absent, a materials-only GLB is synthesized.
 */
const TYPE_ALT = TEXTURE_TYPES.join('|');
const TYPE_SUFFIX_RE = new RegExp(
  `_(${TYPE_ALT})[-_](\\d+x\\d+)\\.png$`,
  'i'
);

/** Exact master mesh file for a meshName, if present: <meshName>.glb */
export function masterGlbForMesh(
  folder: string,
  meshName: string
): string | null {
  const p = path.join(folder, `${meshName}.glb`);
  return fs.existsSync(p) ? p : null;
}

/**
 * @deprecated Prefer masterGlbForMesh + discoverMeshNames.
 * Kept for callers that expect a single required GLB.
 */
export function findMasterGlb(folder: string): string {
  const meshNames = discoverMeshNames(folder);
  for (const mesh of meshNames) {
    const glb = masterGlbForMesh(folder, mesh);
    if (glb) return glb;
  }
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const glbs = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.glb'))
    .map((e) => e.name);
  if (glbs.length === 1) return path.join(folder, glbs[0]);
  if (glbs.length === 0) {
    throw new Error(`No .glb file found in folder:\n  ${folder}`);
  }
  throw new Error(
    `Multiple .glb files found (expected one master mesh):\n` +
      glbs.map((c) => `  - ${c}`).join('\n')
  );
}

export function meshNameFromGlb(glbPath: string): string {
  return path.basename(glbPath, path.extname(glbPath));
}

/**
 * Possible single-segment meshName values embedded in a texture filename.
 * Supports both:
 *   set_mesh_mat_TYPE-res  → mesh can be any middle segment
 *   set_mesh_TYPE-res      → mesh is the last segment before TYPE
 */
export function meshCandidatesFromFileName(fileName: string): string[] {
  const m = fileName.match(TYPE_SUFFIX_RE);
  if (!m || m.index === undefined) return [];
  const body = fileName.slice(0, m.index);
  const parts = body.split('_').filter((p) => p.length > 0);
  if (parts.length < 2) return [];

  const out: string[] = [];
  // With material: set_mesh_mat... → mesh indices 1 .. length-2
  for (let i = 1; i <= parts.length - 2; i++) {
    out.push(parts[i]!);
  }
  // Without material: set_mesh → mesh is last segment
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    if (!out.includes(last)) out.push(last);
  }
  return out;
}

/**
 * Parse a texture filename without a pre-known meshName.
 * Prefers a meshName that has a matching .glb in folder, then shortest textureSetID
 * (so hotelBed2 wins over a false "ns" split of ns_handles).
 */
export function parseTextureFileNameAuto(
  fileName: string,
  folder?: string
): ParsedTexture | null {
  const candidates = meshCandidatesFromFileName(fileName);
  let best: ParsedTexture | null = null;

  for (const mesh of candidates) {
    const parsed = parseTextureFileName(fileName, mesh);
    if (!parsed) continue;

    const hasGlb = folder ? masterGlbForMesh(folder, mesh) !== null : false;
    const bestHasGlb =
      best && folder ? masterGlbForMesh(folder, best.meshName) !== null : false;

    if (!best) {
      best = parsed;
      continue;
    }
    if (hasGlb && !bestHasGlb) {
      best = parsed;
      continue;
    }
    if (
      hasGlb === bestHasGlb &&
      parsed.textureSetID.length < best.textureSetID.length
    ) {
      best = parsed;
    }
  }

  return best;
}

/**
 * Discover meshName tags present in PNG filenames (e.g. hotelBed2, PBR).
 * Uses greedy coverage so "hotelBed2" wins over a false "ns" candidate.
 */
export function discoverMeshNames(folder: string): string[] {
  const pngs = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .map((e) => e.name);

  const candidateScores = new Map<string, number>();
  for (const f of pngs) {
    for (const mesh of meshCandidatesFromFileName(f)) {
      if (parseTextureFileName(f, mesh)) {
        candidateScores.set(mesh, (candidateScores.get(mesh) ?? 0) + 1);
      }
    }
  }

  const ranked = [...candidateScores.entries()].sort((a, b) => {
    const aGlb = masterGlbForMesh(folder, a[0]) ? 1 : 0;
    const bGlb = masterGlbForMesh(folder, b[0]) ? 1 : 0;
    if (bGlb !== aGlb) return bGlb - aGlb;
    return b[1] - a[1];
  });

  const assigned = new Set<string>();
  const selected: string[] = [];

  for (const [mesh] of ranked) {
    const claimed = pngs.filter((f) => {
      if (assigned.has(f)) return false;
      const p = parseTextureFileName(f, mesh);
      if (!p) return false;
      if ((GENERATED_TYPES as readonly string[]).includes(p.textureType)) return false;
      return true;
    });
    if (claimed.length === 0) continue;
    selected.push(mesh);
    for (const f of claimed) assigned.add(f);
  }

  return selected;
}

export function parseTextureFileName(
  fileName: string,
  meshName: string
): ParsedTexture | null {
  if (!fileName.toLowerCase().endsWith('.png')) return null;

  const escapedMesh = escapeRegExp(meshName);

  // With material: set_mesh_mat_TYPE-res
  const withMat = fileName.match(
    new RegExp(
      `^(.+)_${escapedMesh}_(.+)_(${TYPE_ALT})[-_](\\d+x\\d+)\\.png$`,
      'i'
    )
  );
  if (withMat) {
    const textureType = normalizeTextureType(withMat[3]!);
    if (!textureType) return null;
    return {
      filePath: '',
      fileName,
      textureSetID: withMat[1]!,
      meshName,
      materialName: withMat[2]!,
      textureType,
      resolution: withMat[4]!,
    };
  }

  // Without material (Materialize): set_mesh_TYPE-res → material defaults to set ID
  const noMat = fileName.match(
    new RegExp(
      `^(.+)_${escapedMesh}_(${TYPE_ALT})[-_](\\d+x\\d+)\\.png$`,
      'i'
    )
  );
  if (noMat) {
    const textureType = normalizeTextureType(noMat[2]!);
    if (!textureType) return null;
    const textureSetID = noMat[1]!;
    return {
      filePath: '',
      fileName,
      textureSetID,
      meshName,
      materialName: textureSetID,
      textureType,
      resolution: noMat[3]!,
    };
  }

  return null;
}

/** Canonical slot on MaterialTextures (AmbientOcclusion → AO). */
export function slotForType(
  type: TextureType
): keyof Omit<MaterialTextures, 'materialName'> | null {
  if (type === 'AmbientOcclusion') return 'AO';
  if (type === 'Diffuse') return null;
  if (
    type === 'BaseColor' ||
    type === 'Normal' ||
    type === 'ORM' ||
    type === 'Emissive' ||
    type === 'AO' ||
    type === 'Specular'
  ) {
    return type;
  }
  return null;
}

function normalizeTextureType(raw: string): TextureType | null {
  const hit = TEXTURE_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return hit ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scanTextures(folder: string, meshName: string): ParsedTexture[] {
  const files = fs.readdirSync(folder, { withFileTypes: true });
  const out: ParsedTexture[] = [];
  const skipped: string[] = [];

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;
    const parsed = parseTextureFileName(entry.name, meshName);
    if (!parsed) {
      skipped.push(entry.name);
      continue;
    }
    // Ignore previously baked Diffuse/Specular so re-runs don't confuse them.
    if ((GENERATED_TYPES as readonly string[]).includes(parsed.textureType)) {
      continue;
    }
    parsed.filePath = path.join(folder, entry.name);
    out.push(parsed);
  }

  if (skipped.length > 0) {
    console.warn(
      `⚠ Skipped ${skipped.length} PNG(s) that did not match naming pattern for mesh "${meshName}":`
    );
    for (const s of skipped.slice(0, 8)) console.warn(`    ${s}`);
    if (skipped.length > 8) console.warn(`    ... and ${skipped.length - 8} more`);
  }

  return out;
}

export function groupIntoTextureSets(textures: ParsedTexture[]): TextureSet[] {
  const sets = new Map<string, TextureSet>();

  for (const tex of textures) {
    const slot = slotForType(tex.textureType);
    if (!slot) continue;

    const key = `${tex.textureSetID}::${tex.meshName}`;
    let set = sets.get(key);
    if (!set) {
      set = {
        textureSetID: tex.textureSetID,
        meshName: tex.meshName,
        materials: new Map(),
      };
      sets.set(key, set);
    }

    const matKey = tex.materialName.toLowerCase();
    let mat = set.materials.get(matKey);
    if (!mat) {
      mat = { materialName: tex.materialName };
      set.materials.set(matKey, mat);
    } else if (mat.materialName !== tex.materialName) {
      if (tex.textureType === 'BaseColor') mat.materialName = tex.materialName;
    }

    const existing = mat[slot];
    if (existing && existing.fileName !== tex.fileName) {
      console.warn(
        `⚠ Duplicate ${slot} for material "${mat.materialName}" in set "${tex.textureSetID}"; using ${tex.fileName}`
      );
    }
    mat[slot] = tex;
  }

  return [...sets.values()];
}

export function validateTextureSet(set: TextureSet): string[] {
  const warnings: string[] = [];
  for (const mat of set.materials.values()) {
    const missing: string[] = [];
    if (!mat.BaseColor) missing.push('BaseColor');
    if (!mat.Normal) missing.push('Normal');
    if (!mat.ORM) missing.push('ORM');
    if (missing.length > 0) {
      warnings.push(
        `Material "${mat.materialName}" missing: ${missing.join(', ')}`
      );
    }
  }
  return warnings;
}

export function listMaterialNames(set: TextureSet): string[] {
  return [...set.materials.values()].map((m) => m.materialName);
}

export function summarizeSet(set: TextureSet): string {
  const mats = [...set.materials.values()];
  const maps = mats.reduce((n, m) => {
    let c = 0;
    if (m.BaseColor) c++;
    if (m.Normal) c++;
    if (m.ORM) c++;
    if (m.Emissive) c++;
    if (m.AO) c++;
    if (m.Specular) c++;
    return n + c;
  }, 0);
  const ao = mats.filter((m) => m.AO).length;
  const spec = mats.filter((m) => m.Specular).length;
  const extras =
    ao || spec ? ` (AO×${ao}, Specular×${spec})` : '';
  return `${set.textureSetID} / ${set.meshName}: ${mats.length} materials, ${maps} textures${extras}`;
}

export type { MaterialTextures };
