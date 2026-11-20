// node --test tests/admobReport.test.js — تجميع صفوف تقرير AdMob (بلا شبكة)
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('../utils/admobReport');

const row = (date, unit, { e = 0, i = 0, rq = 0, mt = 0, c = 0 } = {}, pf = 'IOS') => ({
    dimensionValues: { DATE: { value: date }, AD_UNIT: { value: unit, displayLabel: 'x' }, FORMAT: { value: 'BANNER' }, PLATFORM: { value: pf } },
    metricValues: {
        ESTIMATED_EARNINGS: { microsValue: String(Math.round(e * 1e6)) },
        IMPRESSIONS: { integerValue: String(i) }, AD_REQUESTS: { integerValue: String(rq) },
        MATCHED_REQUESTS: { integerValue: String(mt) }, CLICKS: { integerValue: String(c) }
    }
});

test('المدى الحالي والسابق والأيام والوحدات والنسب', () => {
    const today = new Date(Date.UTC(2026, 10, 20));
    const banner = 'ca-app-pub-8219247197168750/4959452092';
    const rows = [
        row('20261120', banner, { e: 2, i: 1000, rq: 2000, mt: 1500, c: 10 }),
        row('20261118', 'ca-app-pub-8219247197168750/2689698627', { e: 1, i: 500, rq: 500, mt: 400, c: 5 }, 'ANDROID'),
        row('20261112', banner, { e: 5, i: 2000 })   // المدى السابق (7 أيام قبله)
    ];
    const r = aggregate(rows, { days: 7, today });
    assert.equal(r.totals.earnings, 3);
    assert.equal(r.totals.impressions, 1500);
    assert.equal(r.totals.ecpm, 2);                 // 3 / 1500 × 1000
    assert.equal(r.totals.matchRate, 76);           // 1900 / 2500
    assert.equal(r.totals.ctr, 1);                  // 15 / 1500
    assert.equal(r.previous.earnings, 5);
    assert.equal(r.byDay.length, 7);
    assert.equal(r.byDay[6].date, '2026-11-20');
    assert.equal(r.byDay[6].earnings, 2);
    assert.equal(r.byUnit[0].name, 'بانر (الاكتشاف + البحث)');
    assert.deepEqual(r.byPlatform.map(p => p.platform), ['IOS', 'ANDROID']);
});

test('بلا صفوف: أصفار بلا قسمة على صفر', () => {
    const r = aggregate([], { days: 14, today: new Date() });
    assert.equal(r.totals.ecpm, 0);
    assert.equal(r.totals.matchRate, 0);
    assert.equal(r.byDay.length, 14);
});
