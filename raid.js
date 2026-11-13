'use strict';
/* Core RAID logic: level data, capacity maths, block layout, failure simulation, recommendations. */

const LEVELS = {
  0:  { id: 0,  name: 'RAID 0',  title: 'Striping',            minDisks: 2, striping: true,  mirroring: false, parity: 0, color: 'blue',
        summary: 'Splits data into blocks and stores them across all disks. Fastest, but no redundancy.',
        points: ['No redundancy', 'High speed, less safe'],
        capacity: '100%', tolerance: '0 disks', performance: 'Very High', bestFor: 'Speed' },
  1:  { id: 1,  name: 'RAID 1',  title: 'Mirroring',           minDisks: 2, striping: false, mirroring: true,  parity: 0, color: 'green',
        summary: 'Keeps an exact copy of the data on another disk. Simple and reliable.',
        points: ['High reliability', '50% of space usable (2 disks)'],
        capacity: '50%', tolerance: '1 disk', performance: 'Lower', bestFor: 'Data safety' },
  5:  { id: 5,  name: 'RAID 5',  title: 'Striping + Parity',   minDisks: 3, striping: true,  mirroring: false, parity: 1, color: 'purple',
        summary: 'Data and parity are striped across disks. A good balance of speed, space and safety.',
        points: ['Survives 1 disk failure', 'Good balance of performance and reliability'],
        capacity: '(N-1)/N', tolerance: '1 disk', performance: 'Balanced', bestFor: 'Balanced' },
  6:  { id: 6,  name: 'RAID 6',  title: 'Double Parity',       minDisks: 4, striping: true,  mirroring: false, parity: 2, color: 'orange',
        summary: 'Two independent parity blocks per stripe. Survives two disk failures.',
        points: ['Survives 2 disk failures', 'More protection, less usable space'],
        capacity: '(N-2)/N', tolerance: '2 disks', performance: 'Moderate', bestFor: 'High safety' },
  10: { id: 10, name: 'RAID 10', title: 'Stripe + Mirror',     minDisks: 4, striping: true,  mirroring: true,  parity: 0, color: 'yellow',
        summary: 'Stripes across mirrored pairs. High performance and reliability.',
        points: ['Can survive multiple failures (one per pair)', 'Needs an even number of disks'],
        capacity: '50%', tolerance: 'Multiple', performance: 'High', bestFor: 'Performance + Safety' }
};

function parseLevel(level) {
  const l = Number(level);
  if (!LEVELS[l]) throw new Error('Unsupported RAID level. Use 0, 1, 5, 6 or 10.');
  return l;
}

function parseDisks(level, disks) {
  const n = Number(disks);
  const min = LEVELS[level].minDisks;
  if (!Number.isInteger(n) || n < min) throw new Error(`RAID ${level} needs at least ${min} disks.`);
  if (n > 16) throw new Error('This tool supports up to 16 disks.');
  if (level === 10 && n % 2 !== 0) throw new Error('RAID 10 needs an even number of disks.');
  return n;
}

function faultTolerance(level, n) {
  if (level === 0) return { guaranteed: 0, maximum: 0 };
  if (level === 1) return { guaranteed: n - 1, maximum: n - 1 };
  if (level === 5) return { guaranteed: 1, maximum: 1 };
  if (level === 6) return { guaranteed: 2, maximum: 2 };
  return { guaranteed: 1, maximum: n / 2 }; // RAID 10: one per mirrored pair
}

function calculate(level, disks, sizeGB) {
  level = parseLevel(level);
  const n = parseDisks(level, disks);
  const size = Number(sizeGB);
  if (!(size > 0)) throw new Error('Disk size must be a positive number.');
  const usableDisks = { 0: n, 1: 1, 5: n - 1, 6: n - 2, 10: n / 2 }[level];
  return {
    level, disks: n, diskSizeGB: size,
    rawGB: n * size,
    usableGB: usableDisks * size,
    efficiencyPercent: Math.round((usableDisks / n) * 1000) / 10,
    faultTolerance: faultTolerance(level, n)
  };
}

/** Build a stripe-by-stripe block layout. grid[row][disk] = { label, type } */
function layout(level, disks, rows = 4) {
  level = parseLevel(level);
  const n = parseDisks(level, disks);
  rows = Math.min(Math.max(Number(rows) || 4, 1), 8);
  let d = 1;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array(n);
    if (level === 0) {
      for (let i = 0; i < n; i++) row[i] = { label: 'A' + d++, type: 'data' };
    } else if (level === 1) {
      for (let i = 0; i < n; i++) row[i] = { label: 'A' + (r + 1), type: i === 0 ? 'data' : 'mirror' };
    } else if (level === 5) {
      const p = n - 1 - (r % n);
      for (let i = 0; i < n; i++) row[i] = i === p ? { label: 'P' + (r + 1), type: 'parity' } : { label: 'A' + d++, type: 'data' };
    } else if (level === 6) {
      const p = n - 1 - (r % n), q = (p + 1) % n;
      for (let i = 0; i < n; i++) {
        if (i === p) row[i] = { label: 'P' + (r + 1), type: 'parity' };
        else if (i === q) row[i] = { label: 'Q' + (r + 1), type: 'parity2' };
        else row[i] = { label: 'A' + d++, type: 'data' };
      }
    } else {
      for (let k = 0; k < n; k += 2) {
        const label = 'A' + d++;
        row[k] = { label, type: 'data' };
        row[k + 1] = { label, type: 'mirror' };
      }
    }
    grid.push(row);
  }
  return { level, disks: n, rows, grid };
}

/** Does the array keep its data if the given disk indexes (0-based) fail? */
function simulate(level, disks, failed) {
  level = parseLevel(level);
  const n = parseDisks(level, disks);
  const set = [...new Set((failed || []).map(Number))];
  if (set.some(i => !Number.isInteger(i) || i < 0 || i >= n)) throw new Error('Failed disk index out of range.');
  let survives;
  if (level === 0) survives = set.length === 0;
  else if (level === 1) survives = set.length < n;
  else if (level === 5) survives = set.length <= 1;
  else if (level === 6) survives = set.length <= 2;
  else {
    survives = true;
    for (let k = 0; k < n; k += 2) if (set.includes(k) && set.includes(k + 1)) survives = false;
  }
  let message;
  if (set.length === 0) message = 'All disks healthy.';
  else if (survives) message = (level === 5 || level === 6)
    ? 'Data is safe. Missing blocks are rebuilt from the remaining data and parity.'
    : 'Data is safe. Every block still has a surviving copy.';
  else message = 'Array failed. Too many disks are lost for this RAID level, so data is gone. Restore from backup.';
  return { level, disks: n, failed: set.sort((a, b) => a - b), survives, degraded: survives && set.length > 0, message };
}

/** Selection flow from the poster: main need -> level(s). */
function recommend({ priority, multiFailure, disks }) {
  if (!['performance', 'reliability', 'balanced'].includes(priority)) throw new Error('priority must be performance, reliability or balanced.');
  const nDisks = disks === undefined || disks === '' || disks === null ? null : Number(disks);
  if (nDisks !== null && (!Number.isInteger(nDisks) || nDisks < 2)) throw new Error('disks must be a whole number of at least 2.');
  let picks, why;
  if (priority === 'performance') {
    picks = [0]; why = 'RAID 0 gives the best speed and full capacity, but one failed disk loses everything. Keep backups.';
  } else if (priority === 'reliability') {
    picks = multiFailure ? [6] : [1, 6];
    why = multiFailure ? 'RAID 6 survives any two disk failures.' : 'RAID 1 is the simplest safe option; RAID 6 saves space on larger arrays.';
  } else {
    picks = multiFailure ? [6, 10] : [5, 10];
    why = multiFailure ? 'RAID 6 or RAID 10 balance speed with protection against several failures.' : 'RAID 5 balances speed, space and safety; RAID 10 trades space for speed and faster rebuilds.';
  }
  let note = null;
  if (nDisks !== null) {
    const fit = picks.filter(l => nDisks >= LEVELS[l].minDisks && (l !== 10 || nDisks % 2 === 0));
    if (fit.length === 0) {
      const need = Math.min(...picks.map(l => LEVELS[l].minDisks));
      note = `With ${nDisks} disks, none of the best matches fit. You need at least ${need}.`;
    } else if (fit.length < picks.length) {
      note = `Only ${fit.map(l => 'RAID ' + l).join(', ')} fit ${nDisks} disks.`;
      picks = fit;
    }
  }
  return { picks: picks.map(l => LEVELS[l]), why, note, reminder: 'RAID is not a backup. Always keep a separate backup strategy.' };
}

module.exports = { LEVELS, calculate, layout, simulate, recommend };
