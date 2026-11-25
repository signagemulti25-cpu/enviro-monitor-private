export const metrics = [
  ['Temperature', '°C', 1],
  ['Humidity', '%', 1],
  ['PM2.5', 'µg/m³', 0],
  ['PM10', 'µg/m³', 0],
  ['NO₂', 'ppm', 2],
  ['SO₂', 'ppm', 2],
  ['CO', 'ppm', 2],
  ['AQI', '', 0],
];

export const day = 86_400_000;
export const aqi = 7;

export function metricIndices(station) {
  return station.channels === 5 ? [0, 1, 2, 3, aqi] : metrics.map((_, i) => i);
}

export function readingValue(station, row, metric) {
  if (station.channels === 5 && metric >= 4) {
    return metric === aqi ? row?.channels[4] ?? null : null;
  }
  return row?.channels[metric] ?? null;
}

export function stats(station, rows, metric) {
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const value = readingValue(station, row, metric);
    if (value === null) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    total += value;
    count++;
  }
  return count ? [min, max, total / count, count] : [null, null, null, 0];
}

export function localDate(time) {
  const date = new Date(time);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function dailyGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const date = localDate(row.time);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(row);
  }
  return groups;
}

export function format(value, metric) {
  return value === null ? '—' : value.toFixed(metrics[metric][2]);
}

const metricNames = metrics.map(([name, unit]) => unit ? name + ' (' + unit + ')' : name);
const protect = value => /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
const csvField = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';

export function createReport(stations, from, to, daily) {
  const fields = daily
    ? ['Local date', ...metricNames.flatMap(name => ['Min', 'Max', 'Average', 'Sample count'].map(stat => name + ' ' + stat))]
    : ['Local time', 'UTC timestamp', 'Reading ID', ...metricNames];
  const rows = [['Station', 'Logger ID', ...fields]];
  for (const station of stations) {
    const readings = station.readings.filter(row => {
      const date = localDate(row.time);
      return date >= from && date <= to;
    });
    const prefix = [protect(station.name), station.id];
    if (daily) {
      for (const [date, records] of dailyGroups(readings)) {
        const values = metrics.flatMap((_, i) => {
          const values = stats(station, records, i);
          if (values[2] !== null) values[2] = Number(values[2].toFixed(3));
          return values;
        });
        rows.push([...prefix, date, ...values]);
      }
    } else {
      for (const row of readings) {
        rows.push([
          ...prefix, new Date(row.time).toLocaleString(), new Date(row.time).toISOString(),
          protect(row.id), ...metrics.map((_, i) => readingValue(station, row, i)),
        ]);
      }
    }
  }
  return rows.length === 1 ? null : '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
