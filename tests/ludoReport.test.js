// بلاغ من دردشة مباراة هلا لودو ← بلاغ عادي بآخر رسائل اللاعب دليلاً، مرة لكل مُبلِّغ/لاعب/مباراة
// node --test tests/ludoReport.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../utils/ludo/store');
const games = new Map();
store.getGame = async (id) => games.get(id) || null;

const redisKeys = new Set();
const redisClient = require('../utils/redisClient');
redisClient.getClient = async () => ({
    set: async (k, v, o) => { if (o?.NX && redisKeys.has(k)) return null; redisKeys.add(k); return 'OK'; }
});

const Report = require('../models/Report');
const created = [];
Report.create = async (doc) => { created.push(doc); return doc; };

const chat = require('../utils/ludo/chat');

const A = '64b000000000000000000001', B = '64b000000000000000000002';
games.set('g1', {
    id: 'g1',
    meta: {
        players: [{ id: A, isBot: false, name: 'أ' }, { id: B, isBot: false, name: 'ب' }, { id: 'bot:1', isBot: true }],
        chat: [
            { playerId: B, text: 'كلام مسيء', at: Date.now() - 2000 },
            { playerId: A, text: 'أهلاً', at: Date.now() - 1000 },
            { playerId: B, text: 'ثاني', at: Date.now() }
        ]
    }
});

test('البلاغ يُنشئ بلاغاً بآخر رسائل اللاعب المُبلَّغ عنه وحده، مرة واحدة', async () => {
    const r = await chat.report(A, 'g1', B, 'harassment');
    assert.equal(r.already, false);
    assert.equal(created.length, 1);
    const doc = created[0];
    assert.equal(doc.type, 'user');
    assert.equal(String(doc.reportedUser), B);
    assert.equal(doc.priority, 'high');
    assert.match(doc.description, /كلام مسيء/);
    assert.match(doc.description, /ثاني/);
    assert.doesNotMatch(doc.description, /أهلاً/);

    const again = await chat.report(A, 'g1', B, 'spam');
    assert.equal(again.already, true);
    assert.equal(created.length, 1);
});

test('يُرفض: سبب غير معروف، البوت، نفسه، ومن ليس في المباراة', async () => {
    await assert.rejects(chat.report(A, 'g1', B, 'xx'), { code: 'BAD_REPORT' });
    await assert.rejects(chat.report(A, 'g1', 'bot:1', 'spam'), { code: 'BAD_REPORT' });
    await assert.rejects(chat.report(A, 'g1', A, 'spam'), { code: 'BAD_REPORT' });
    await assert.rejects(chat.report('64b000000000000000000009', 'g1', B, 'spam'), { code: 'NOT_IN_GAME' });
});
