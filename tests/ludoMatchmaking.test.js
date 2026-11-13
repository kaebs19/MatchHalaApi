// خوارزمية مطابقة الدوري (رسوم ← مستوى ← الأقرب) — دالة صرفة
// node --test tests/ludoMatchmaking.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGroups } = require('../utils/ludo/matchmaking');

const W = { sameFee: 6000, level: 12000, botFill: 20000 };
const NOW = 1_000_000;
const e = (userId, fee, waitedMs, level = 0, blocked = []) => ({ userId, fee, level, blocked, joinedAt: NOW - waitedMs });
const plan = (entries, size = 2, fillBots = false) =>
    planGroups(entries, { size, now: NOW, windows: W, fillBots }).map(g => ({ ids: g.members.map(m => m.userId).sort(), fee: g.fee }));

test('نفس الرسوم تُطابَق فوراً، ورسوم مختلفة لا تُجمع في الثواني الأولى', () => {
    assert.deepEqual(plan([e('a', 10000, 1000), e('b', 10000, 0)]), [{ ids: ['a', 'b'], fee: 10000 }]);
    assert.deepEqual(plan([e('a', 10000, 1000), e('b', 100000, 0)]), []);
});

test('سيناريو المالك: 10K ينتظر و100K بدأ للتوّ — لا يُنزَّل صاحب 100K قبل نافذته', () => {
    // صاحب 10K انتظر 15ث (نافذة «الأقرب») لكن صاحب 100K بدأ للتوّ ← لا مطابقة بعد
    assert.deepEqual(plan([e('a', 10000, 15000), e('b', 100000, 1000)]), []);
    // انتظر صاحب 100K أيضاً حتى نافذة «الأقرب» ← يلعبان بالأدنى (10K)
    assert.deepEqual(plan([e('a', 10000, 15000), e('b', 100000, 13000)]), [{ ids: ['a', 'b'], fee: 10000 }]);
});

test('المستوى: بعد نافذة الرسوم يُطابَق نفس المستوى برسوم مختلفة، وغيره ينتظر نافذة «الأقرب»', () => {
    // صاحب الأعلى رسوماً في نافذة المستوى (8ث): نفس المستوى ← نعم
    assert.deepEqual(plan([e('a', 1000, 8000, 1), e('b', 10000, 8000, 1)]), [{ ids: ['a', 'b'], fee: 1000 }]);
    // مستوى مختلف ← لا حتى نافذة «الأقرب»
    assert.deepEqual(plan([e('a', 1000, 8000, 0), e('b', 10000, 8000, 2)]), []);
    assert.deepEqual(plan([e('a', 1000, 13000, 0), e('b', 10000, 13000, 2)]), [{ ids: ['a', 'b'], fee: 1000 }]);
});

test('الأولوية: نفس الرسوم قبل غيرها، ثم الأقرب مستوىً، ثم الأقرب رسوماً', () => {
    // الأقدم a (10K، انتظر طويلاً) — أمامه c بنفس رسومه وb أقرب مستوىً برسوم أخرى ← c
    const r = plan([e('a', 10000, 15000, 1), e('b', 1000, 14000, 1), e('c', 10000, 2000, 2)]);
    assert.deepEqual(r[0], { ids: ['a', 'c'], fee: 10000 });
    // لا أحد بنفس الرسوم: 1K و100K كلاهما بعيد عن 10K بالنسبة نفسها ← الأقرب مستوىً يُختار
    const r2 = plan([e('a', 10000, 15000, 1), e('b', 1000, 14000, 0), e('c', 100000, 14000, 1)]);
    assert.deepEqual(r2[0], { ids: ['a', 'c'], fee: 10000 });
});

test('أربعة لاعبين: تُجمع المجموعة المتوافقة كلها وتلعب بالأدنى، والحظر يمنع الجمع', () => {
    const r = plan([e('a', 1000, 15000), e('b', 10000, 15000), e('c', 10000, 15000), e('d', 1000, 15000)], 4);
    assert.deepEqual(r, [{ ids: ['a', 'b', 'c', 'd'], fee: 1000 }]);
    assert.deepEqual(plan([e('a', 1000, 1000, 0, ['b']), e('b', 1000, 0)]), []);
});

test('البوت: من انتظر المهلة كاملة تكتمل مجموعته ببوت برسومه', () => {
    assert.deepEqual(plan([e('a', 100000, 21000)], 2, true), [{ ids: ['a'], fee: 100000 }]);
    assert.deepEqual(plan([e('a', 100000, 19000)], 2, true), []);
});

test('حسابان على الجهاز نفسه لا يتقابلان أبداً — ولا بعد نافذة «الأقرب»', () => {
    const dev = (id, fee, waited, devices) => ({ ...e(id, fee, waited), devices });
    assert.deepEqual(plan([dev('a', 1000, 15000, ['k:1']), dev('b', 1000, 15000, ['k:1', 'v:9'])]), []);
    // ثالث على جهاز آخر يُطابَق مع أحدهما
    const r = plan([dev('a', 1000, 15000, ['k:1']), dev('b', 1000, 14000, ['k:1']), dev('c', 1000, 1000, ['k:2'])]);
    assert.deepEqual(r, [{ ids: ['a', 'c'], fee: 1000 }]);
    // البوت يكمل لصاحب الجهاز المكرّر
    assert.deepEqual(plan([dev('a', 1000, 21000, ['k:1']), dev('b', 1000, 21000, ['k:1'])], 2, true),
        [{ ids: ['a'], fee: 1000 }, { ids: ['b'], fee: 1000 }]);
});
