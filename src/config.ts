import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILENAME = 'exports-path.txt';

/**
 * Resolve the Instamat/Materialize Exports folder.
 * Priority:
 * 1. Explicit CLI value (already passed by commander when user sets -f)
 * 2. INSTAMAT_EXPORTS environment variable
 * 3. exports-path.txt next to package.json / cwd
 * 4. ./Exports under the current working directory
 */
export function resolveExportsFolder(cliFolder?: string): string {
  if (cliFolder && cliFolder.trim().length > 0) {
    return path.resolve(cliFolder.trim());
  }

  const fromEnv = process.env.INSTAMAT_EXPORTS;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv.trim());
  }

  const configPath = path.resolve(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(configPath)) {
    const line = fs
      .readFileSync(configPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'));
    if (line) return path.resolve(line);
  }

  return path.resolve(process.cwd(), 'Exports');
}

export { CONFIG_FILENAME };
