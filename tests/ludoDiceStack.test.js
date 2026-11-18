// تجميع النرد (diceStack) — node --test tests/ludoDiceStack.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../utils/ludoEngine');

const { HOME, BASE } = L.constants;

const dice = (...values) => {
    let i = 0;
    return () => {
        if (i >= values.length) throw new Error('انتهت قيم النرد في الاختبار');
        return values[i++];
    };
};

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return 1 + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 6);
    };
}

const game = (opts = {}, mode = 'classic') => L.createGame({
    players: [{ id: 'a' }, { id: 'b' }], mode, now: 0,
    options: { diceStack: true, rerollsPerPlayer: 0, ...opts }
});

test('الستّ يرمي مرة أخرى وتتجمّع الرميات — قطعتان تخرجان بستّين', () => {
    let s = game();
    const rolls = dice(6, 6, 3);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.equal(s.phase, 'roll');
    assert.deepEqual(s.pool, [6]);
    assert.equal(s.turn, 0);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.deepEqual(s.pool, [6, 6]);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.equal(s.phase, 'move');
    assert.deepEqual(s.pool, [6, 6, 3]);
    // القيمة المكرّرة تُعرض مرة لكل قطعة، و3 بلا حركة الآن
    assert.deepEqual(s.legalMoves.map(m => [m.token, m.die]), [[0, 6], [1, 6], [2, 6], [3, 6]]);

    s = L.move(s, { playerId: 'a', token: 0, die: 6 }).state;
    assert.equal(s.phase, 'move');
    assert.deepEqual(s.pool, [6, 3]);
    assert.ok(s.legalMoves.some(m => m.token === 0 && m.die === 3));
    s = L.move(s, { playerId: 'a', token: 1, die: 6 }).state;
    assert.deepEqual(s.seats[0].tokens.slice(0, 2), [0, 0]);
    s = L.move(s, { playerId: 'a', token: 0, die: 3 }).state;
    assert.deepEqual(s.seats[0].tokens, [3, 0, BASE, BASE]);
    assert.equal(s.turn, 1, 'صُرفت الرميات ← الدور للخصم');
    assert.deepEqual(s.pool, []);
});

test('ثلاث ستات تُسقط الدور وتُفرغ المجموعة', () => {
    let s = game();
    const rolls = dice(6, 6, 6);
    for (let i = 0; i < 3; i++) s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.equal(s.turn, 1);
    assert.deepEqual(s.pool, []);
});

test('لا حركة لأي رمية ← ينتقل الدور', () => {
    let s = game();
    s = L.roll(s, { playerId: 'a', rollDie: dice(4) }).state;
    assert.equal(s.turn, 1);
    assert.equal(s.phase, 'roll');
});

test('حركة بلا تحديد الرمية (عميل قديم) تأخذ أول رمية تصلح', () => {
    let s = game();
    const rolls = dice(6, 2);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    s = L.move(s, { playerId: 'a', token: 0 }).state;
    assert.equal(s.seats[0].tokens[0], 0);
    assert.deepEqual(s.pool, [2]);
});

test('رمية لا حركة لها الآن تصير ممكنة بعد خروج قطعة', () => {
    let s = game({}, 'quick');
    s.seats[0].tokens = [53, BASE];
    // 53 لا تتحرك بـ 6 ولا بـ 4 (تتجاوز البيت)؛ القاعدة تخرج بالستّ ثم تُصرف الـ 4 عليها
    const rolls = dice(6, 4);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.deepEqual(s.pool, [6, 4]);
    assert.deepEqual(s.legalMoves.map(m => [m.token, m.die]), [[1, 6]]);
    s = L.move(s, { playerId: 'a', token: 1, die: 6 }).state;
    assert.deepEqual(s.legalMoves.map(m => [m.token, m.die]), [[1, 4]]);
});

test('الأكل يمنح رمية بعد صرف المجموعة', () => {
    let s = game();
    // a (أحمر) على 9، b (أصفر) على المربع العام 12 = موضعه 38 (بداية الأصفر 26) — مربع غير آمن
    s.seats[0].tokens = [9, BASE, BASE, BASE];
    s.seats[1].tokens = [38, BASE, BASE, BASE];
    s = L.roll(s, { playerId: 'a', rollDie: dice(3) }).state;
    const r = L.move(s, { playerId: 'a', token: 0, die: 3 });
    s = r.state;
    assert.equal(r.events[0].captured.length, 1);
    assert.equal(r.events[0].extraTurn, true);
    assert.equal(s.turn, 0);
    assert.equal(s.phase, 'roll');
    assert.deepEqual(s.pool, []);
});

test('الوصول للبيت وسط المجموعة: يكمل الصرف ثم رمية مستحقّة', () => {
    let s = game({}, 'quick');
    s.seats[0].tokens = [50, 20];
    const rolls = dice(6, 2);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    s = L.move(s, { playerId: 'a', token: 0, die: 6 }).state;
    assert.equal(s.seats[0].tokens[0], HOME);
    assert.equal(s.phase, 'move', 'بقيت رمية 2');
    s = L.move(s, { playerId: 'a', token: 1, die: 2 }).state;
    assert.equal(s.turn, 0);
    assert.equal(s.phase, 'roll', 'رمية مستحقّة بعد الوصول');
});

test('إعادة الرمي تستبدل آخر رمية ولا تُتاح بعد الصرف', () => {
    let s = game({ rerollsPerPlayer: 1 });
    const rolls = dice(6, 2, 5);
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    s = L.roll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.equal(s.canReroll, true);
    s = L.reroll(s, { playerId: 'a', rollDie: rolls }).state;
    assert.deepEqual(s.pool, [6, 5]);
    s = L.move(s, { playerId: 'a', token: 0, die: 6 }).state;
    assert.equal(s.canReroll, false);
});

test('محاكاة: مباريات كاملة بالبوت بلا أخطاء', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const rollDie = seeded(seed);
        let s = L.createGame({
            players: [{ id: 'a', isBot: true }, { id: 'b', isBot: true }, { id: 'c', isBot: true }, { id: 'd', isBot: true }],
            mode: seed % 2 ? 'quick' : 'classic',
            options: { diceStack: true }
        });
        let steps = 0;
        while (s.phase !== 'ended') {
            s = L.autoStep(s, { rollDie, now: steps }).state;
            assert.ok(++steps < 20000, 'حلقة لا تنتهي');
            assert.ok((s.pool || []).length <= 2 || s.phase !== 'roll' || s.pool.every(d => d === 6));
        }
        assert.ok(s.winners.length >= 1);
    }
});

test('publicState يعرض المجموعة والعلم', () => {
    let s = game();
    s = L.roll(s, { playerId: 'a', rollDie: dice(6) }).state;
    const p = L.publicState(s);
    assert.equal(p.diceStack, true);
    assert.deepEqual(p.pool, [6]);
    assert.deepEqual(L.publicState(L.createGame({ players: [{ id: 'a' }, { id: 'b' }] })).diceStack, false);
});

// ───── الحاجز ─────
const blockGame = (mode = 'classic') => L.createGame({
    players: [{ id: 'a' }, { id: 'b' }], mode, now: 0,
    options: { diceStack: true, blocks: true, rerollsPerPlayer: 0 }
});

test('الحاجز: لا يتجاوزه الخصم ولا يقف عليه', () => {
    let s = blockGame();
    // b (أصفر) قطعتان على موضع 30 = مربع عام 4 (غير آمن)؛ a (أحمر) على 1
    s.seats[1].tokens = [30, 30, BASE, BASE];
    s.seats[0].tokens = [1, BASE, BASE, BASE];
    assert.equal(L.globalSquare('yellow', 30), 4);
    assert.deepEqual(L.legalMovesFor(s, 0, 2), [{ token: 0, from: 1, to: 3 }], 'قبل الحاجز مسموح');
    assert.deepEqual(L.legalMovesFor(s, 0, 3), [], 'الوقوف على الحاجز ممنوع');
    assert.deepEqual(L.legalMovesFor(s, 0, 5), [], 'التجاوز ممنوع');
});

test('الحاجز: صاحبه يمرّ، والمربع الآمن لا حاجز فيه، وبلا الخيار لا حواجز', () => {
    let s = blockGame();
    s.seats[0].tokens = [4, 4, 1, BASE];
    assert.ok(L.legalMovesFor(s, 0, 5).some(m => m.token === 2), 'قطعتي تمرّ بحاجزي');
    s.seats[1].tokens = [34, 34, BASE, BASE];          // الأصفر 34 = مربع 8 (نجمة آمنة)
    s.seats[0].tokens = [5, BASE, BASE, BASE];
    assert.equal(L.legalMovesFor(s, 0, 4).length, 1);
    let old = L.createGame({ players: [{ id: 'a' }, { id: 'b' }], options: { diceStack: true } });
    old.seats[1].tokens = [30, 30, BASE, BASE];
    old.seats[0].tokens = [1, BASE, BASE, BASE];
    assert.equal(L.legalMovesFor(old, 0, 5).length, 1);
});

test('الحاجز: البوت يكوّنه، ومحاكاة كاملة بلا أخطاء', () => {
    let s = blockGame();
    s.seats[0].isBot = true;
    s.seats[0].tokens = [12, 9, BASE, BASE];   // 9+3 = 12 ← حاجز مع القطعة الأولى؛ 12+3 = 15 تقدّم فقط
    s.seats[1].tokens = [BASE, BASE, BASE, BASE];
    s = L.roll(s, { playerId: 'a', rollDie: dice(3), auto: true }).state;
    assert.equal(L.chooseBotMove(s).token, 1, 'يلحق بقطعته ليكوّن حاجزاً');
    for (let seed = 1; seed <= 30; seed++) {
        const rollDie = seeded(seed * 7);
        let g = L.createGame({
            players: [{ id: 'a', isBot: true }, { id: 'b', isBot: true }, { id: 'c', isBot: true }, { id: 'd', isBot: true }],
            mode: seed % 2 ? 'quick' : 'classic', options: { diceStack: true, blocks: true }
        });
        let steps = 0;
        while (g.phase !== 'ended') {
            g = L.autoStep(g, { rollDie, now: steps }).state;
            assert.ok(++steps < 30000, 'حلقة لا تنتهي');
        }
    }
});
