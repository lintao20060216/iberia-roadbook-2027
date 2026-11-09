import { mkdir, readFile, writeFile } from 'node:fs/promises';

const files = {
  '/': 'index.html',
  '/style.css': 'style.css',
  '/app.js': 'app.js',
  '/map.js': 'map.js',
  '/places.js': 'places.js',
  '/world.json': 'world.json',
  '/vendor/maplibre-gl.js': 'maplibre-gl.js',
  '/vendor/maplibre-gl.css': 'maplibre-gl.css',
  '/vendor/maplibre-license.txt': 'maplibre-license.txt'
};
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const assets = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([route, file]) => [route, await read(file)])
));
const worker = await Promise.all(['places.js', 'planner.js', 'worker.js'].map(read));
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await writeFile(new URL('dist/worker.js', import.meta.url),
  'const assets=' + JSON.stringify(assets) + ';\n' + worker.join('\n'));
