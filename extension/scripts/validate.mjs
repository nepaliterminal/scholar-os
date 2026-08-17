import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

async function exists(relativePath) {
  try {
    await access(join(root, relativePath));
    return true;
  } catch {
    failures.push(`Missing referenced file: ${relativePath}`);
    return false;
  }
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) failures.push('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) failures.push('manifest version must use x.y.z');

const manifestFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []),
].filter(Boolean);

for (const file of new Set(manifestFiles)) await exists(file);

for (const htmlFile of ['popup.html', 'blocked.html', 'options.html']) {
  if (!(await exists(htmlFile))) continue;
  const html = await readFile(join(root, htmlFile), 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^(?:https?:|#|data:)/.test(value));
  for (const reference of references) await exists(reference);
  if (/<script(?![^>]*\bsrc=)/i.test(html)) failures.push(`${htmlFile} contains inline JavaScript, which Manifest V3 blocks`);
}

if (!manifest.permissions?.includes('declarativeNetRequest')) {
  failures.push('declarativeNetRequest permission is required for focus blocking');
}
if (!manifest.permissions?.includes('storage')) {
  failures.push('storage permission is required for persistent sessions');
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Validated Study Session OS ${manifest.version}: ${new Set(manifestFiles).size} manifest resources and 3 extension pages.`);
