'use strict';
const assert = require('assert');
const r = require('./raid');

assert.strictEqual(r.calculate(5, 4, 1000).usableGB, 3000);
assert.strictEqual(r.calculate(6, 4, 1000).usableGB, 2000);
assert.strictEqual(r.calculate(10, 4, 1000).efficiencyPercent, 50);
assert.strictEqual(r.calculate(0, 2, 500).usableGB, 1000);
assert.throws(() => r.calculate(5, 2, 1000));
assert.throws(() => r.calculate(10, 5, 1000));
assert.strictEqual(r.simulate(5, 4, [0]).survives, true);
assert.strictEqual(r.simulate(5, 4, [0, 1]).survives, false);
assert.strictEqual(r.simulate(10, 4, [0, 2]).survives, true);
assert.strictEqual(r.simulate(10, 4, [0, 1]).survives, false);
assert.strictEqual(r.simulate(6, 4, [1, 2]).survives, true);
r.layout(5, 4, 4).grid.forEach(row => assert.strictEqual(row.filter(c => c.type === 'parity').length, 1));
assert.strictEqual(r.recommend({ priority: 'performance' }).picks[0].id, 0);
assert.deepStrictEqual(r.recommend({ priority: 'balanced', multiFailure: false }).picks.map(p => p.id), [5, 10]);
console.log('All RAID tests passed.');
