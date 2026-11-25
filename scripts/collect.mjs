import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const archivePath = process.argv[2] ?? '.enviro-archive.json';
const publicPath = process.argv[3] ?? 'public/readings.json';
const dayMs = 86_400_000;
const retentionDays = 30;
const stations = JSON.parse(await readFile('stations.json', 'utf8'));
if (!Array.isArray(stations) || stations.length < 1 || stations.length > 10 ||
    stations.some(station => !station ||
      typeof station.id !== 'string' || !/^\d{1,20}$/.test(station.id) ||
      typeof station.name !== 'string' || !station.name.trim() ||
      ![5, 8].includes(station.channels)) ||
    new Set(stations.map(station => station.id)).size !== stations.length) {
  throw new Error('Set one to ten unique numeric logger IDs, names, and channel counts in stations.json.');
}

let archive = {};
try {
  archive = JSON.parse(await readFile(archivePath, 'utf8'));
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
    throw new Error('The archive must contain an object keyed by logger ID.');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const draft = path + '.tmp';
  await writeFile(draft, JSON.stringify(value) + '\n');
  await rename(draft, path);
}

async function fetchReading({ id }) {
  const origin = process.env.ENVIRO_LOGGER_ORIGIN ?? 'https://dataloggersindia.org';
  const url = new URL('/api/logger_log/' + id, origin);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const { status, data } = await response.json();
  const seconds = Number(data?.time);
  const readingId = String(data?.id ?? '');
  if (String(status) !== '200' || String(data?.logger_id) !== id ||
      !readingId || !Number.isSafeInteger(seconds) || seconds <= 0 ||
      !Number.isFinite(new Date(seconds * 1000).getTime())) {
    throw new Error('Invalid logger response');
  }
  const channels = Array.from({ length: 8 }, (_, index) => {
    const channel = data['ch' + (index + 1)];
    if (typeof channel !== 'number' && typeof channel !== 'string') return null;
    if (String(channel).trim() === '') return null;
    const numeric = Number(channel);
    return Number.isFinite(numeric) ? numeric : null;
  });
  return { id: readingId, time: seconds * 1000, channels };
}

const cutoff = Date.now() - retentionDays * dayMs;
const published = await Promise.all(stations.map(async station => {
  const { id } = station;
  const saved = archive[id] ?? [];
  let latest;
  let unavailable = false;

  try {
    latest = await fetchReading(station);
    console.log('Fetched logger ' + id);
  } catch (error) {
    console.warn('Logger %s: %s', id, error.message);
    unavailable = true;
  }

  const records = new Map(saved.map(row => [row.id, row]));
  if (latest) records.set(latest.id, latest);
  const sorted = [...records.values()].sort((a, b) => a.time - b.time);
  const readings = sorted.filter(row => row.time >= cutoff);
  // Keep the last available reading even if the station has stopped sending.
  if (!readings.length && sorted.length) readings.push(sorted.at(-1));
  archive[id] = readings;
  return { ...station, unavailable, readings };
}));

await writeJson(archivePath, archive);
await writeJson(publicPath, { collectedAt: Date.now(), stations: published });
