// اختبارات محرّك هلا لودو — node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../utils/ludoEngine');

const { HOME, BASE } = L.constants;

// نرد من قائمة ثابتة
const dice = (...values) => {
    let i = 0;
    return () => {
        if (i >= values.length) throw new Error('انتهت قيم النرد في الاختبار');
        return values[i++];
    };
};

// مولّد عشوائي بذرة (mulberry32) للمحاكاة القابلة للتكرار
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

const two = () => L.createGame({ players: [{ id: 'a' }, { id: 'b' }], now: 0 });
const four = (mode = 'classic') =>
    L.createGame({ players: ['a', 'b', 'c', 'd'].map(id => ({ id })), mode, now: 0 });

// يضع حالة مباشرة للاختبار (موضع القطع)
const withTokens = (state, map) => {
    const s = structuredClone(state);
    for (const [id, tokens] of Object.entries(map)) s.seats.find(x => x.id === id).tokens = tokens;
    return s;
};

test('الإنشاء: لاعبان بلونين متقابلين وكل القطع في القاعدة', () => {
    const g = two();
    assert.deepEqual(g.seats.map(s => s.color), ['red', 'yellow']);
    assert.ok(g.seats.every(s => s.tokens.length === 4 && s.tokens.every(p => p === BASE)));
    assert.equal(g.phase, 'roll');
    assert.throws(() => L.createGame({ players: [{ id: 'a' }] }), { code: 'BAD_PLAYERS' });
    assert.throws(() => L.createGame({ players: [{ id: 'a' }, { id: 'a' }] }), { code: 'BAD_PLAYERS' });
    assert.throws(() => L.createGame({ players: [{ id: 'a' }, { id: 'b' }], mode: 'teams' }), { code: 'BAD_PLAYERS' });
    assert.equal(L.createGame({ players: [{ id: 'a' }, { id: 'b' }], mode: 'quick' }).seats[0].tokens.length, 2);
});

test('بلا 6 لا خروج من القاعدة والدور ينتقل', () => {
    const { state, events } = L.roll(two(), { playerId: 'a', rollDie: dice(3) });
    assert.equal(events[0].noMoves, true);
    assert.equal(state.seats[state.turn].id, 'b');
    assert.equal(state.phase, 'roll');
});

test('ليس دورك + نسخة قديمة + مرحلة خاطئة', () => {
    const g = two();
    assert.throws(() => L.roll(g, { playerId: 'b', rollDie: dice(6) }), { code: 'NOT_YOUR_TURN' });
    assert.throws(() => L.roll(g, { playerId: 'a', rollDie: dice(6), expectVersion: 5 }), { code: 'STALE_VERSION' });
    assert.throws(() => L.move(g, { playerId: 'a', token: 0 }), { code: 'NOT_MOVE_PHASE' });
});

test('6 تُخرج قطعة وتمنح رمية إضافية', () => {
    let { state } = L.roll(two(), { playerId: 'a', rollDie: dice(6) });
    assert.equal(state.phase, 'move');
    assert.equal(state.legalMoves.length, 4);
    ({ state } = L.move(state, { playerId: 'a', token: 0 }));
    assert.equal(state.seats[0].tokens[0], 0);
    assert.equal(state.lastAction.extraTurn, true);
    assert.equal(state.seats[state.turn].id, 'a');
});

test('المُدخل لا يتغيّر (دوال صرفة)', () => {
    const g = two();
    const snapshot = JSON.stringify(g);
    L.roll(g, { playerId: 'a', rollDie: dice(6) });
    assert.equal(JSON.stringify(g), snapshot);
});

test('حركة غير مسموحة تُرفض', () => {
    let g = withTokens(two(), { a: [0, BASE, BASE, BASE] });
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(3) }));
    assert.deepEqual(g.legalMoves.map(m => m.token), [0]);
    assert.throws(() => L.move(g, { playerId: 'a', token: 1 }), { code: 'ILLEGAL_MOVE' });
});

test('الأكل يعيد قطعة الخصم للقاعدة ويمنح رمية إضافية', () => {
    // الأحمر في المربع العام 5 والأصفر (بداية 26) على المربع العام 10 = موضعه 36
    let g = withTokens(two(), { a: [5, BASE, BASE, BASE], b: [36, BASE, BASE, BASE] });
    assert.equal(L.globalSquare('yellow', 36), 10);
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(5) }));
    ({ state: g } = L.move(g, { playerId: 'a', token: 0 }));
    assert.equal(g.seats[1].tokens[0], BASE);
    assert.deepEqual(g.lastAction.captured, [{ playerId: 'b', token: 0, from: 36 }]);
    assert.equal(g.lastAction.extraTurn, true);
});

test('لا أكل على مربع آمن (النجمة)', () => {
    // النجمة في المربع العام 8. الأصفر عليه = موضع 34
    let g = withTokens(two(), { a: [3, BASE, BASE, BASE], b: [34, BASE, BASE, BASE] });
    assert.ok(L.isSafeSquare(8));
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(5) }));
    ({ state: g } = L.move(g, { playerId: 'a', token: 0 }));
    assert.equal(g.seats[1].tokens[0], 34);
    assert.equal(g.lastAction.captured.length, 0);
});

test('ممرّ البيت خاص: لا أكل فيه', () => {
    // قطعتان في ممرّي بيتين مختلفين — لا مربع عام لهما
    assert.equal(L.globalSquare('red', 53), null);
});

test('البيت بالعدد المضبوط فقط', () => {
    let g = withTokens(two(), { a: [54, BASE, BASE, BASE] });
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(3) }));
    assert.equal(g.lastAction.noMoves, true);       // 54+3 > 56
    g = withTokens(two(), { a: [54, BASE, BASE, BASE] });
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(2) }));
    ({ state: g } = L.move(g, { playerId: 'a', token: 0 }));
    assert.equal(g.seats[0].tokens[0], HOME);
    assert.equal(g.lastAction.extraTurn, true);       // الوصول للبيت يمنح رمية
});

test('ثلاث ستات متتالية تُسقط الدور', () => {
    let g = withTokens(two(), { a: [0, BASE, BASE, BASE] });
    for (let i = 0; i < 2; i++) {
        ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(6) }));
        ({ state: g } = L.move(g, { playerId: 'a', token: 0 }));
    }
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(6) }));
    assert.equal(g.lastAction.forfeit, 'three_sixes');
    assert.equal(g.seats[g.turn].id, 'b');
});

test('6 بلا حركة ممكنة تبقى رمية إضافية', () => {
    let g = withTokens(two(), { a: [HOME, HOME, HOME, 53] });
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(6) }));
    assert.equal(g.lastAction.noMoves, true);
    assert.equal(g.seats[g.turn].id, 'a');
});

test('الفوز: آخر قطعة تصل البيت تنهي المباراة', () => {
    let g = withTokens(two(), { a: [HOME, HOME, HOME, 55] });
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(1) }));
    ({ state: g } = L.move(g, { playerId: 'a', token: 3 }));
    assert.equal(g.phase, 'ended');
    assert.deepEqual(g.winners, ['a']);
    assert.deepEqual(L.ranking(g).map(r => r.id), ['a', 'b']);
    assert.throws(() => L.roll(g, { playerId: 'b', rollDie: dice(6) }), { code: 'GAME_ENDED' });
});

test('الانسحاب: في لاعبَين يفوز الآخر، وفي أربعة تستمر المباراة', () => {
    let { state } = L.leave(two(), { playerId: 'a' });
    assert.equal(state.phase, 'ended');
    assert.deepEqual(state.winners, ['b']);

    let g = withTokens(four(), { a: [10, BASE, BASE, BASE] });
    ({ state: g } = L.leave(g, { playerId: 'a' }));
    assert.equal(g.phase, 'roll');
    assert.equal(g.seats[g.turn].id, 'b');              // كان دور المنسحب
    assert.ok(g.seats[0].tokens.every(p => p === BASE));
    const r = L.ranking(g);
    assert.equal(r[r.length - 1].id, 'a');
    assert.equal(r[r.length - 1].left, true);
    assert.throws(() => L.leave(g, { playerId: 'a' }), { code: 'ALREADY_OUT' });
});

test('الفرق: الشريك لا يُؤكل، والفريق يفوز حين يُنهي الاثنان', () => {
    // a (أحمر) و c (أصفر) فريق واحد. c على المربع العام 10 = موضعه 36
    let g = withTokens(four('teams'), { a: [5, BASE, BASE, BASE], c: [36, BASE, BASE, BASE] });
    assert.equal(g.seats[0].team, g.seats[2].team);
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(5) }));
    ({ state: g } = L.move(g, { playerId: 'a', token: 0 }));
    assert.equal(g.seats[2].tokens[0], 36);

    g = withTokens(four('teams'), { a: [HOME, HOME, HOME, 55], c: [HOME, HOME, HOME, HOME] });
    g.seats[2].status = 'finished';
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(1) }));
    ({ state: g } = L.move(g, { playerId: 'a', token: 3 }));
    assert.equal(g.phase, 'ended');
    assert.deepEqual(g.winners.sort(), ['a', 'c']);
});

test('المهلة: البوت يكمل الدور، وبعد 3 أدوار فائتة يتولّى اللاعب', () => {
    let g = two();
    const rnd = seeded(7);
    for (let i = 1; i <= 3; i++) {
        // نوصل الدور لـ a ثم نتركه تنتهي مهلته
        while (g.seats[g.turn].id !== 'a') ({ state: g } = L.autoStep(g, { rollDie: rnd, now: 0 }));
        const r = L.handleTimeout(g, { rollDie: rnd, now: 0 });
        g = r.state;
        if (g.phase === 'ended') return;
        assert.equal(g.seats[0].missed, i);
        assert.equal(g.seats[0].isBot, i >= 3);
        if (i === 3) assert.ok(r.events.some(e => e.type === 'taken_over'));
    }
});

test('البوت يفضّل الأكل', () => {
    let g = withTokens(two(), { a: [5, 20, BASE, BASE], b: [36, BASE, BASE, BASE] });
    ({ state: g } = L.roll(g, { playerId: 'a', rollDie: dice(5) }));
    assert.equal(L.chooseBotMove(g).token, 0);
});

// ── محاكاة: آلاف المباريات بالبوتات — تنتهي دائماً وتحافظ على الثوابت ──
function simulate(mode, playerCount, seed) {
    const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, isBot: true }));
    let g = L.createGame({ players, mode, now: 0 });
    const rnd = seeded(seed);
    let steps = 0;
    while (g.phase !== 'ended') {
        ({ state: g } = L.autoStep(g, { rollDie: rnd, now: 0 }));
        if (++steps > 20000) throw new Error(`لم تنتهِ المباراة (seed ${seed})`);
        for (const s of g.seats) {
            for (const p of s.tokens) assert.ok(p >= BASE && p <= HOME, `موضع خارج النطاق ${p}`);
        }
        assert.ok(g.seats[g.turn].status === 'active' || g.phase === 'ended');
    }
    return { g, steps };
}

test('محاكاة 3000 مباراة بكل الأنماط تنتهي بفائز', () => {
    const cases = [['classic', 2], ['classic', 4], ['quick', 2], ['quick', 4], ['teams', 4]];
    let total = 0;
    for (const [mode, n] of cases) {
        for (let seed = 1; seed <= 600; seed++) {
            const { g, steps } = simulate(mode, n, seed * 31 + n);
            assert.ok(g.winners && g.winners.length >= 1);
            total += steps;
        }
    }
    assert.ok(total > 0);
});
