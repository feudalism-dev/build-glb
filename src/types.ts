/** Maps that go into the PBR GLB. */
export const PBR_TEXTURE_TYPES = ['BaseColor', 'Normal', 'ORM', 'Emissive'] as const;
export type PbrTextureType = (typeof PBR_TEXTURE_TYPES)[number];

/**
 * Extra Instamat maps:
 * - AO / AmbientOcclusion → used to bake Diffuse (BaseColor × AO)
 * - Specular → Instamat glossiness export; archived only (not put in GLB)
 */
export const EXTRA_INPUT_TYPES = ['AO', 'AmbientOcclusion', 'Specular'] as const;

/** Baked outputs — ignored if already present so re-runs don't loop. */
export const GENERATED_TYPES = ['Diffuse'] as const;

/** All filename type segments the parser recognizes. */
export const TEXTURE_TYPES = [
  ...PBR_TEXTURE_TYPES,
  'AO',
  'AmbientOcclusion',
  'Specular',
  ...GENERATED_TYPES,
] as const;

export type TextureType =
  | PbrTextureType
  | 'AO'
  | 'AmbientOcclusion'
  | 'Specular'
  | 'Diffuse';

export interface ParsedTexture {
  filePath: string;
  fileName: string;
  textureSetID: string;
  meshName: string;
  materialName: string;
  textureType: TextureType;
  resolution: string;
}

/** All maps for one material within a texture set. */
export interface MaterialTextures {
  materialName: string;
  BaseColor?: ParsedTexture;
  Normal?: ParsedTexture;
  ORM?: ParsedTexture;
  Emissive?: ParsedTexture;
  AO?: ParsedTexture;
  /** Instamat glossiness/specular export — archived, not injected into GLB. */
  Specular?: ParsedTexture;
}

/** One Instamat texture set for one mesh. */
export interface TextureSet {
  textureSetID: string;
  meshName: string;
  materials: Map<string, MaterialTextures>;
}

export interface ProcessResult {
  textureSetID: string;
  meshName: string;
  outputGlb: string;
  archiveFolder: string;
  materialsInjected: string[];
  derivedTextures: string[];
  warnings: string[];
}
