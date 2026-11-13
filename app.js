'use strict';
const $ = s => document.querySelector(s);
const state = { failed: new Set() };

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fmt = gb => gb >= 1000 ? (gb / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' TB' : gb + ' GB';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// Decorative hero disks
(function heroDisks() {
  const wrap = $('#heroDisks');
  [[0,0,0,1],[0,0,1,0],[0,1,0,0],[1,0,0,0]].forEach((pattern, i) => {
    const d = el('div', 'hd'); d.style.animationDelay = i * 0.12 + 's';
    pattern.forEach(p => d.appendChild(el('b', p ? 'p' : '')));
    wrap.appendChild(d);
  });
})();

// Levels + comparison table
async function loadLevels() {
  try {
    const levels = await api('/api/levels');
    const cards = $('#levelCards'); cards.textContent = '';
    levels.forEach(l => {
      const c = el('article', 'card c-' + l.color);
      c.append(el('h3', '', l.name), el('p', 'sub', l.title), el('p', '', l.summary));
      const ul = el('ul'); l.points.forEach(p => ul.appendChild(el('li', '', p))); c.appendChild(ul);
      cards.appendChild(c);
    });
    const yn = v => (v ? 'Yes' : 'No');
    const rows = [
      ['Data striping', l => yn(l.striping)], ['Mirroring', l => yn(l.mirroring)],
      ['Parity', l => l.parity ? `Yes (${l.parity})` : 'No'], ['Min disks', l => l.minDisks],
      ['Usable capacity', l => l.capacity], ['Fault tolerance', l => l.tolerance],
      ['Performance', l => l.performance], ['Best for', l => l.bestFor]
    ];
    const t = $('#compareTable'); t.textContent = '';
    const head = el('tr'); head.appendChild(el('th', '', 'Feature'));
    levels.forEach(l => head.appendChild(el('th', '', l.name)));
    t.appendChild(el('thead')).appendChild(head);
    const body = el('tbody');
    rows.forEach(([name, fn]) => {
      const tr = el('tr'); tr.appendChild(el('td', '', name));
      levels.forEach(l => tr.appendChild(el('td', '', String(fn(l)))));
      body.appendChild(tr);
    });
    t.appendChild(body);
  } catch (e) {
    $('#levelCards').textContent = 'Could not load RAID levels. Is the server running? (' + e.message + ')';
  }
}

// Disk lab
function labParams() {
  return { level: +$('#level').value, disks: +$('#disks').value, size: +$('#size').value };
}

function syncDiskLimits() {
  const mins = { 0: 2, 1: 2, 5: 3, 6: 4, 10: 4 };
  const { level } = labParams();
  const range = $('#disks');
  range.min = mins[level];
  let v = +range.value;
  if (v < mins[level]) v = mins[level];
  if (level === 10 && v % 2) v += 1;
  range.step = level === 10 ? 2 : 1;
  range.value = Math.min(v, +range.max);
  $('#disksOut').textContent = range.value;
}

async function renderLab() {
  const err = $('#labError'); err.hidden = true;
  const { level, disks, size } = labParams();
  try {
    const [lay, calc, sim] = await Promise.all([
      api(`/api/layout?level=${level}&disks=${disks}&rows=4`),
      api(`/api/calculate?level=${level}&disks=${disks}&size=${size}`),
      post('/api/simulate', { level, disks, failed: [...state.failed].filter(i => i < disks) })
    ]);
    const arr = $('#array'); arr.textContent = '';
    for (let d = 0; d < disks; d++) {
      const b = el('button', 'disk' + (state.failed.has(d) ? ' failed' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', state.failed.has(d));
      b.setAttribute('aria-label', `Disk ${d + 1}, ${state.failed.has(d) ? 'failed' : 'healthy'}. Click to toggle.`);
      b.appendChild(el('h4', '', 'Disk ' + (d + 1)));
      lay.grid.forEach(row => b.appendChild(el('span', 'blk ' + row[d].type, row[d].label)));
      b.addEventListener('click', () => { state.failed.has(d) ? state.failed.delete(d) : state.failed.add(d); renderLab(); });
      arr.appendChild(b);
    }
    const s = $('#stats'); s.textContent = '';
    [['Raw capacity', fmt(calc.rawGB)], ['Usable', fmt(calc.usableGB)], ['Efficiency', calc.efficiencyPercent + '%'],
     ['Guaranteed survivable failures', calc.faultTolerance.guaranteed], ['Best-case failures', calc.faultTolerance.maximum]]
      .forEach(([k, v]) => { s.appendChild(el('dt', '', k)); s.appendChild(el('dd', '', String(v))); });
    const st = $('#status');
    st.textContent = sim.message;
    st.className = 'status ' + (!sim.survives ? 'bad' : sim.degraded ? 'warn' : 'ok');
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
  }
}

$('#level').addEventListener('change', () => { state.failed.clear(); syncDiskLimits(); renderLab(); });
$('#disks').addEventListener('input', () => { $('#disksOut').textContent = $('#disks').value; state.failed.clear(); renderLab(); });
$('#size').addEventListener('input', renderLab);
$('#reset').addEventListener('click', () => { state.failed.clear(); renderLab(); });

// Chooser
$('#chooser').addEventListener('submit', async () => {
  const out = $('#answer'); out.textContent = '';
  try {
    const r = await post('/api/recommend', {
      priority: document.querySelector('input[name=priority]:checked').value,
      multiFailure: $('#multi').checked,
      disks: $('#haveDisks').value || null
    });
    const wrap = el('div', 'cards');
    r.picks.forEach(l => {
      const c = el('article', 'card c-' + l.color);
      c.append(el('h3', '', l.name + ': ' + l.title), el('p', '', l.summary), el('p', '', `Min disks: ${l.minDisks}. Usable: ${l.capacity}. Tolerates: ${l.tolerance}.`));
      wrap.appendChild(c);
    });
    out.append(el('p', '', r.why));
    if (r.note) out.appendChild(el('p', 'error', r.note));
    out.append(wrap, el('p', 'reminder', r.reminder));
  } catch (e) { out.appendChild(el('p', 'error', e.message)); }
});

loadLevels();
syncDiskLimits();
renderLab();
