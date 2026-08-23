import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import {
  discoverMeshNames,
  masterGlbForMesh,
  meshNameFromGlb,
  parseTextureFileNameAuto,
} from './parse.js';
import { listPendingSetIds, processFolder } from './process.js';

export interface WatchOptions {
  folder: string;
  /** Seconds of quiet after last matching write before processing. Default 45. */
  debounceSeconds?: number;
  archive?: boolean;
}

interface PendingSet {
  textureSetID: string;
  meshName: string;
  timer: NodeJS.Timeout | null;
  lastChange: number;
}

/**
 * Watch Exports for Instamat/Materialize PNGs.
 * Master .glb is optional — materials-only GLBs are built when absent.
 * On startup, existing texture sets are processed immediately.
 */
export function watchFolder(options: WatchOptions): void {
  const folder = path.resolve(options.folder);
  const debounceMs = Math.max(5, options.debounceSeconds ?? 45) * 1000;
  const pending = new Map<string, PendingSet>();
  let ready = false;

  console.log(`Watching: ${folder}`);
  console.log(`Debounce: ${debounceMs / 1000}s after last texture write per set`);
  console.log('Master GLB optional (materials-only GLB if missing).');
  console.log('Press Ctrl+C to stop.\n');

  const schedule = (textureSetID: string, meshName: string) => {
    const key = `${textureSetID}::${meshName}`;
    let entry = pending.get(key);
    if (!entry) {
      entry = { textureSetID, meshName, timer: null, lastChange: Date.now() };
      pending.set(key, entry);
    }
    entry.lastChange = Date.now();
    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(() => {
      void runSet(textureSetID, meshName);
    }, debounceMs);

    const waitSec = Math.round(debounceMs / 1000);
    console.log(
      `… set "${textureSetID}" (${meshName}) — will build in ${waitSec}s if quiet`
    );
  };

  const runSet = async (textureSetID: string, meshName: string) => {
    const key = `${textureSetID}::${meshName}`;
    const entry = pending.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    pending.delete(key);

    try {
      const master = masterGlbForMesh(folder, meshName);
      console.log(
        `\n▶ Building set "${textureSetID}" for ${meshName}` +
          (master ? ` (master: ${path.basename(master)})` : ' (materials-only)') +
          '…'
      );
      const results = await processFolder({
        folder,
        textureSetID,
        meshName,
        archive: options.archive !== false,
      });
      for (const r of results) {
        console.log(`✔ Done: ${r.outputGlb}`);
      }
    } catch (err) {
      console.error(`✖ Failed building "${textureSetID}":`, (err as Error).message);
    }
  };

  const processExistingNow = async () => {
    try {
      const meshNames = discoverMeshNames(folder);
      if (meshNames.length === 0) {
        console.log('No pending texture sets in folder. Waiting for new exports…\n');
        return;
      }

      const jobs: Array<{ meshName: string; setId: string }> = [];
      for (const meshName of meshNames) {
        for (const setId of listPendingSetIds(folder, meshName)) {
          jobs.push({ meshName, setId });
        }
      }

      if (jobs.length === 0) {
        console.log('No pending texture sets in folder. Waiting for new exports…\n');
        return;
      }

      console.log(
        `Found ${jobs.length} existing set(s) across mesh tag(s) [${meshNames.join(', ')}] — processing now…`
      );
      for (const job of jobs) {
        const key = `${job.setId}::${job.meshName}`;
        const entry = pending.get(key);
        if (entry?.timer) clearTimeout(entry.timer);
        pending.delete(key);
        await runSet(job.setId, job.meshName);
      }
      console.log('\nStartup processing finished. Watching for new exports…\n');
    } catch (err) {
      console.log(
        `No processable files yet (${(err as Error).message}). Waiting for exports…\n`
      );
    }
  };

  const onFile = (filePath: string) => {
    if (!ready) return;

    const name = path.basename(filePath);
    if (!name.toLowerCase().endsWith('.png')) return;

    const parsed = parseTextureFileNameAuto(name, folder);
    if (!parsed) return;

    console.log(`+ ${name}`);
    schedule(parsed.textureSetID, parsed.meshName);
  };

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  const watcher = chokidar.watch(folder, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    depth: 0,
    persistent: true,
  });

  watcher.on('add', onFile);
  watcher.on('change', onFile);

  watcher.on('add', (filePath) => {
    if (!ready) return;
    if (!filePath.toLowerCase().endsWith('.glb')) return;
    const base = path.basename(filePath);
    const meshName = meshNameFromGlb(filePath);
    // Ignore our own outputs: mesh_set.glb when mesh.glb is the master naming
    if (!masterGlbForMesh(folder, meshName) && base !== `${meshName}.glb`) {
      // Could be an output GLB landing briefly before archive — ignore if not exact master name
      if (base.includes('_') && base.endsWith('.glb')) {
        return;
      }
    }
    console.log(`+ ${base} (master mesh detected — scanning pending sets)`);
    try {
      for (const id of listPendingSetIds(folder, meshName)) {
        schedule(id, meshName);
      }
    } catch (err) {
      console.warn((err as Error).message);
    }
  });

  watcher.on('ready', () => {
    ready = true;
    void processExistingNow();
  });

  watcher.on('error', (err) => {
    console.error('Watcher error:', err);
  });
}
