#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { resolveExportsFolder } from './config.js';
import { processFolder } from './process.js';
import { watchFolder } from './watch.js';
import { createPlaceholderGlb } from './inject.js';
import {
  discoverMeshNames,
  findMasterGlb,
  groupIntoTextureSets,
  listMaterialNames,
  masterGlbForMesh,
  scanTextures,
} from './parse.js';

const FOLDER_HELP =
  'Exports folder (else INSTAMAT_EXPORTS env, else exports-path.txt, else ./Exports)';

const program = new Command();

program
  .name('build-glb')
  .description(
    'Build PBR material GLBs from Instamat/Materialize texture exports for Second Life (master mesh GLB optional)'
  )
  .version('1.0.0');

program
  .command('build')
  .description('Process all texture sets currently in the folder (one-shot)')
  .option('-f, --folder <path>', FOLDER_HELP)
  .option('-s, --set <textureSetID>', 'Only process this texture set ID')
  .option('-m, --mesh <meshName>', 'Only process this mesh tag (e.g. hotelBed2 or PBR)')
  .option('--no-archive', 'Leave files in place (do not move into subfolder)')
  .action(
    async (opts: {
      folder?: string;
      set?: string;
      mesh?: string;
      archive: boolean;
    }) => {
      try {
        const folder = resolveExportsFolder(opts.folder);
        console.log(`Exports folder: ${folder}`);
        const results = await processFolder({
          folder,
          textureSetID: opts.set,
          meshName: opts.mesh,
          archive: opts.archive,
        });
        console.log(`\nFinished ${results.length} set(s).`);
        for (const r of results) {
          console.log(`  ${r.outputGlb}`);
        }
      } catch (err) {
        console.error(`\nError: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  );

program
  .command('watch')
  .description('Watch the Exports folder and auto-build when a texture set finishes')
  .option('-f, --folder <path>', FOLDER_HELP)
  .option(
    '-d, --debounce <seconds>',
    'Quiet period after last texture write before building',
    '45'
  )
  .option('--no-archive', 'Leave files in place (do not move into subfolder)')
  .action((opts: { folder?: string; debounce: string; archive: boolean }) => {
    const folder = resolveExportsFolder(opts.folder);
    console.log(`Exports folder: ${folder}`);
    watchFolder({
      folder,
      debounceSeconds: Number(opts.debounce),
      archive: opts.archive,
    });
  });

program
  .command('make-placeholder')
  .description(
    'Create a minimal master GLB with material slots inferred from textures already in the folder'
  )
  .option('-f, --folder <path>', FOLDER_HELP)
  .option('-n, --name <meshName>', 'Mesh / GLB name (required)')
  .action(async (opts: { folder?: string; name?: string }) => {
    try {
      const folder = resolveExportsFolder(opts.folder);
      const meshName = opts.name;
      if (!meshName) {
        throw new Error('Pass --name <meshName> (e.g. hotelBed2)');
      }

      try {
        const existing = findMasterGlb(folder);
        console.warn(
          `⚠ A GLB already exists (${path.basename(existing)}). ` +
            `Placeholder not written. Remove it first if you want a new placeholder.`
        );
        return;
      } catch {
        // no glb — good
      }

      const textures = scanTextures(folder, meshName);
      if (textures.length === 0) {
        throw new Error(`No textures matching mesh "${meshName}" in ${folder}`);
      }
      const sets = groupIntoTextureSets(textures);
      const names = new Set<string>();
      for (const set of sets) {
        for (const n of listMaterialNames(set)) names.add(n);
      }
      const materialNames = [...names];

      const outPath = path.join(folder, `${meshName}.glb`);
      await createPlaceholderGlb(outPath, materialNames);
      console.log(
        `Created placeholder ${path.basename(outPath)} with ${materialNames.length} materials:`
      );
      for (const n of materialNames) console.log(`  - ${n}`);
      console.log(`\nRun: npm run build`);
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('inspect')
  .description('List detected texture sets without writing')
  .option('-f, --folder <path>', FOLDER_HELP)
  .action((opts: { folder?: string }) => {
    try {
      const folder = resolveExportsFolder(opts.folder);
      console.log(`Exports folder: ${folder}`);
      const meshNames = discoverMeshNames(folder);
      if (meshNames.length === 0) {
        console.log('No texture sets found.');
        return;
      }
      for (const meshName of meshNames) {
        const master = masterGlbForMesh(folder, meshName);
        console.log(
          `\nMesh tag: ${meshName}` +
            (master ? ` (master: ${path.basename(master)})` : ' (materials-only)')
        );
        const textures = scanTextures(folder, meshName);
        const sets = groupIntoTextureSets(textures);
        for (const set of sets) {
          console.log(`  Set: ${set.textureSetID}`);
          for (const mat of set.materials.values()) {
            const maps = [
              'BaseColor',
              'Normal',
              'ORM',
              'Emissive',
              'AO',
              'Specular',
            ]
              .filter((t) => mat[t as keyof typeof mat])
              .join(', ');
            console.log(`    ${mat.materialName}: ${maps}`);
          }
        }
      }
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

if (process.argv.length <= 2) {
  program.help();
} else {
  program.parse();
}
