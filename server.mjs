import { createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const { MONITOR_USERNAME: username, MONITOR_PASSWORD: password } = process.env;
if (!username || /[:\r\n]/.test(username) || !password || password.length < 16) {
  throw new Error('Set MONITOR_USERNAME and a MONITOR_PASSWORD of at least 16 characters.');
}

const hash = value => createHash('sha256').update(value).digest();
const expected = hash(username + ':' + password);
const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.MONITOR_DATA_DIR ?? 'private-data');
const archive = join(dataDir, 'archive.json');
const snapshotFile = join(dataDir, 'readings.json');
const config = JSON.parse(await readFile('stations.json', 'utf8'));
const index = await readFile('dist/index.html');
const run = promisify(execFile);
const types = { js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
let collecting = false;
let snapshot;

async function readSnapshot() {
  try {
    return JSON.parse(await readFile(snapshotFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { collectedAt: null, stations: config.map(station => ({ ...station, readings: [] })) };
  }
}

function send(response, status, type, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

const plain = 'text/plain; charset=utf-8';
const server = createServer(async (request, response) => {
  const header = request.headers.authorization ?? '';
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(header);
  if (!match || !timingSafeEqual(hash(Buffer.from(match[1], 'base64')), expected)) {
    return send(response, 401, plain, 'Sign in to Enviro Monitor.', {
      'WWW-Authenticate': 'Basic realm="Enviro Monitor", charset="UTF-8"',
    });
  }
  if (request.method !== 'GET') return send(response, 405, plain, 'Method not allowed', { Allow: 'GET' });
  try {
    const url = new URL(request.url, 'http://localhost');
    const stationId = url.searchParams.get('station');
    if ((url.pathname === '/' || url.pathname === '/readings.json') &&
        stationId !== null && !config.some(station => station.id === stationId)) {
      return send(response, 404, plain, 'Station not found.');
    }
    if (url.pathname === '/') return send(response, 200, 'text/html; charset=utf-8', index);
    if (url.pathname === '/readings.json') {
      const saved = snapshot ?? await readSnapshot();
      const active = new Set(config.map(station => station.id));
      const byId = new Map(saved.stations.filter(station => active.has(station.id)).map(station => [station.id, station]));
      const stations = config.filter(station => !stationId || station.id === stationId).map(station => ({
        ...byId.get(station.id), ...station, readings: byId.get(station.id)?.readings ?? [],
      }));
      return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ collectedAt: saved.collectedAt, stations }));
    }
    const asset = /^\/assets\/([a-zA-Z0-9_.-]+\.(js|css))$/.exec(url.pathname);
    if (asset) {
      const path = join('dist', 'assets', asset[1]);
      const file = await stat(path).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (file?.isFile()) return send(response, 200, types[asset[2]], await readFile(path));
    }
    return send(response, 404, plain, 'Page not found.');
  } catch (error) {
    console.error(error.message);
    return send(response, 500, plain, 'Dashboard request failed.');
  }
});

async function collect() {
  if (collecting) return;
  collecting = true;
  try {
    const { stdout, stderr } = await run(process.execPath, ['scripts/collect.mjs', archive, snapshotFile], { timeout: 60_000 });
    if (stdout) console.log(stdout.trim());
    if (stderr) console.warn(stderr.trim());
    snapshot = await readSnapshot();
  } catch (error) {
    console.error('Collection failed:', error.message);
  } finally {
    collecting = false;
  }
}

server.listen(port, '0.0.0.0', () => {
  console.log('Enviro Monitor listening on port ' + port);
  void collect();
});
setInterval(collect, 10 * 60_000);
