import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import stationConfig from '../stations.json';
import { aqi, createReport, dailyGroups, day, format, localDate, metricIndices, metrics, readingValue, stats } from './data.js';
import './style.css';

const timeLabel = time => new Date(time).toLocaleString();
const linkedStation = new URLSearchParams(window.location.search).get('station');
const stationFallback = stationConfig.filter(station => !linkedStation || station.id === linkedStation).map(station => ({ ...station, readings: [] }));
const ranges = [1, 7, 30];

function MetricCard({ station, metric, onHistory }) {
  const [name, unit] = metrics[metric];
  const value = readingValue(station, station.readings.at(-1), metric);
  const recent = station.readings.filter(row => row.time >= Date.now() - day);
  const [min, max, avg] = stats(station, recent, metric);
  return <div className={metric === aqi ? 'metric aqi' : 'metric'}>
    <span>{name}</span>
    <strong>{format(value, metric)} <small>{unit}</small></strong>
    <p>Min {format(min, metric)} · Max {format(max, metric)} · Avg {format(avg, metric)}</p>
    <button className="text-button" onClick={onHistory}>View history</button>
  </div>;
}

function Overview({ stations, openHistory }) {
  return <div className="station-list">{stations.map(station => {
    const last = station.readings.at(-1);
    const state = station.unavailable ? 'Logger request failed' : !last
      ? 'Waiting for readings' : Date.now() - last.time > 30 * 60_000 ? 'Stale reading' : 'Latest reading';
    return <section key={station.id} className="panel">
      <div className="station-heading">
        <div>
          <p className="muted">Logger {station.id} · {station.channels} parameters</p>
          <h2>{station.name}</h2>
        </div>
        <p className={'station-status ' + (state === 'Latest reading' ? '' : 'warning')}>
          {state}{last ? ' · ' + timeLabel(last.time) : ''}
        </p>
      </div>
      <div className="metrics">{metricIndices(station).map(metric =>
        <MetricCard key={metric} station={station} metric={metric} onHistory={() => openHistory(station.id, metric)} />
      )}</div>
    </section>;
  })}</div>;
}

function Chart({ station, metric, period, mode }) {
  const end = Date.now();
  const start = end - period * day;
  const rows = station.readings.filter(row => row.time >= start && row.time <= end);
  const [lowest, highest, average, count] = stats(station, rows, metric);
  if (!count) return <p className="empty">No readings for this sensor in the selected range.</p>;

  const bins = Array.from({ length: 72 }, () => []);
  for (const row of rows) {
    const index = Math.min(bins.length - 1, Math.floor((row.time - start) / (end - start) * bins.length));
    bins[index].push(row);
  }
  const points = bins.map(bin => stats(station, bin, metric)[2]);
  const low = mode === 'bar' ? Math.min(0, lowest) : lowest;
  const high = mode === 'bar' ? Math.max(0, highest) : highest;
  const min = low === high ? low - 1 : low;
  const max = low === high ? high + 1 : high;
  const x = index => 65 + (index + 0.5) * 810 / bins.length;
  const y = value => 230 - (value - min) * 200 / (max - min);
  const ticks = [0, 1, 2, 3, 4].map(index => min + (max - min) * index / 4);
  return <>
    <p className="muted">{count} readings · Min {format(lowest, metric)} · Max {format(highest, metric)} · Avg {format(average, metric)}</p>
    <svg viewBox="0 0 900 270" className="chart" role="img" aria-label={metrics[metric][0] + ' history'}>
      {ticks.map(value => <g key={value}>
        <line x1="62" x2="880" y1={y(value)} y2={y(value)} className="grid-line" />
        <text x="55" y={y(value) + 4} textAnchor="end">{Number(value.toFixed(2))}</text>
      </g>)}
      {points.map((value, i) => {
        if (value === null) return null;
        const label = timeLabel(start + i * (end - start) / bins.length) + ' · ' + format(value, metric);
        if (mode === 'bar') return <rect key={i} x={x(i) - 4} width="8"
          y={Math.min(y(value), y(0))} height={Math.max(1, Math.abs(y(value) - y(0)))} className="point"><title>{label}</title></rect>;
        return <g key={i}>
          {i > 0 && points[i - 1] !== null && <line x1={x(i - 1)} y1={y(points[i - 1])} x2={x(i)} y2={y(value)} className="series" />}
          <circle className="point" cx={x(i)} cy={y(value)} r="3.5"><title>{label}</title></circle>
        </g>;
      })}
      <text x="62" y="255">{timeLabel(start)}</text>
      <text x="880" y="255" textAnchor="end">{timeLabel(end)}</text>
    </svg>
  </>;
}

function History({ stations, stationId, setStationId, metric, setMetric }) {
  const [period, setPeriod] = useState(7);
  const [mode, setMode] = useState('line');
  const station = stations.find(item => item.id === stationId) ?? stations[0];
  const available = metricIndices(station);
  const selected = available.includes(metric) ? metric : aqi;
  const rows = station.readings.filter(row => row.time >= Date.now() - period * day);
  return <section className="panel">
    <div className="controls">
      <label>Station<select value={station.id} onChange={e => setStationId(e.target.value)}>
        {stations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Sensor<select value={selected} onChange={e => setMetric(Number(e.target.value))}>
        {available.map(index => <option key={index} value={index}>{metrics[index][0]}</option>)}
      </select></label>
      <label>Range<select value={period} onChange={e => setPeriod(Number(e.target.value))}>
        {ranges.map(value => <option key={value} value={value}>{value === 1 ? '24 hours' : value + ' days'}</option>)}
      </select></label>
      <label>View<select value={mode} onChange={e => setMode(e.target.value)}>
        <option value="line">Line</option><option value="bar">Bars</option><option value="daily">Daily summary</option>
      </select></label>
    </div>
    {mode === 'daily' ? <div className="table-scroll"><table>
      <thead><tr><th scope="col">Date</th><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Average</th><th scope="col">Samples</th></tr></thead>
      <tbody>{[...dailyGroups(rows)].reverse().map(([date, readings]) => {
        const [min, max, avg, count] = stats(station, readings, selected);
        return <tr key={date}><th scope="row">{date}</th>
          <td>{format(min, selected)}</td><td>{format(max, selected)}</td>
          <td>{format(avg, selected)}</td><td>{count}</td></tr>;
      })}{!rows.length && <tr><td colSpan="5">No collected readings in this range.</td></tr>}</tbody>
    </table></div> : <Chart station={station} metric={selected} period={period} mode={mode} />}
  </section>;
}

function Reports({ stations }) {
  const [stationId, setStationId] = useState('');
  const [from, setFrom] = useState(() => localDate(Date.now() - 6 * day));
  const [to, setTo] = useState(() => localDate(Date.now()));
  const [mode, setMode] = useState('raw');
  const [message, setMessage] = useState('');
  function download(event) {
    event.preventDefault();
    const targets = stationId ? stations.filter(station => station.id === stationId) : stations;
    const csv = createReport(targets, from, to, mode === 'daily');
    if (!csv) return setMessage('No saved readings match this date range.');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'enviro-' + mode + '-' + (stationId || 'all') + '-' + from + '-to-' + to + '.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('CSV download started.');
  }
  return <form className="panel" onSubmit={download}>
    <div className="controls">
      <label>Station<select value={stationId} onChange={e => setStationId(e.target.value)}>
        <option value="">All stations</option>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
      </select></label>
      <label>From<input type="date" value={from} max={to} required onChange={e => setFrom(e.target.value)} /></label>
      <label>To<input type="date" value={to} min={from} required onChange={e => setTo(e.target.value)} /></label>
      <label>Report<select value={mode} onChange={e => setMode(e.target.value)}>
        <option value="raw">Raw readings</option><option value="daily">Daily summary</option>
      </select></label>
      <button className="primary" type="submit">Download CSV</button>
    </div>
    {message && <p role="status">{message}</p>}
  </form>;
}

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('Overview');
  const [stationId, setStationId] = useState(linkedStation || stationConfig[0].id);
  const [metric, setMetric] = useState(aqi);
  const load = useCallback(async signal => {
    setLoading(true);
    try {
      const url = new URL('readings.json', document.baseURI);
      if (linkedStation) url.searchParams.set('station', linkedStation);
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('No published snapshot');
      const data = await response.json();
      if (!Array.isArray(data.stations) || !data.stations.length) throw new Error('Invalid snapshot');
      setSnapshot(data);
      setLoadError('');
    } catch (error) {
      if (!signal?.aborted) setLoadError('Could not load station readings. Try Refresh or check the server logs.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  const stations = snapshot?.stations ?? stationFallback;
  return <>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">≋</span> Enviro Monitor</div>
      <nav aria-label="Dashboard">{['Overview', 'History', 'Reports'].map(item =>
        <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>{item}</button>
      )}</nav>
    </header>
    <main>
      <div className="page-heading">
        <div><h1>{view === 'Overview' ? 'Station overview' : view === 'History' ? 'Reading history' : 'Export reports'}</h1>
          <p className="muted">{stations.length} {stations.length === 1 ? 'station' : 'stations'}
            {snapshot?.collectedAt ? ' · Collected ' + timeLabel(snapshot.collectedAt) : ''}
          </p></div>
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {loadError && <p className="notice" role="status">{loadError}</p>}
      {view === 'Overview' && <Overview stations={stations} openHistory={(id, index) => {
        setStationId(id); setMetric(index); setView('History');
      }} />}
      {view === 'History' && <History stations={stations} stationId={stationId} setStationId={setStationId} metric={metric} setMetric={setMetric} />}
      {view === 'Reports' && <Reports stations={stations} />}
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
