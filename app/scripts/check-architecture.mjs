import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeArchitecture } from './architecture/analyze.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = new Map();
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(tsx?|mjs|css)$/.test(file))
      sources.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
  }
}
for (const directory of ['app', 'components', 'features', 'lib', 'scripts'])
  walk(directory);
const { errors, warnings } = analyzeArchitecture(sources, (file) =>
  fs.existsSync(path.join(root, file)),
);
if (warnings.length)
  console.warn('CSS breakpoint review (advisory):\n' + warnings.join('\n'));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture checked: ${sources.size} files, no runtime cycles, boundary violations or duplicate/shadowed CSS rules. ${warnings.length} breakpoint advisories.`,
  );
