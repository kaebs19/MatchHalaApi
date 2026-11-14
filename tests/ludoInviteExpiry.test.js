// ⏳ انتهاء دعوة لودو بلا ردّ ← expired + «فاتك تحدّي» للمستلم (push) و«انتهت دعوتك» للمرسل (حفظ فقط)، مرة واحدة
// node --test tests/ludoInviteExpiry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const zset = new Map();
require('../utils/redisClient').getClient = async () => ({
    zAdd: async (k, { score, value }) => zset.set(value, score),
    zRangeByScore: async (k, min, max) => [...zset].filter(([, s]) => s <= max).map(([v]) => v),
    zRem: async (k, v) => (zset.delete(v) ? 1 : 0)
});
require('../utils/socketPresence').isUserSocketConnected = async () => false;

const A = '64b000000000000000000001', B = '64b000000000000000000002';
const MSG = '64b0000000000000000000aa', CONV = '64b0000000000000000000cc';
const Message = require('../models/Message');
let doc = { _id: MSG, conversation: CONV, game: { kind: 'ludo', status: 'pending', players: [A, B] } };
Message.findById = () => ({ select: () => ({ lean: async () => doc }) });
Message.findOneAndUpdate = (f, u) => ({
    select: () => ({ lean: async () => {
        if (doc.game.status !== f['game.status']) return null;
        doc = { ...doc, game: { ...doc.game, status: u.$set['game.status'] } };
        return doc;
    } })
});
require('../models/User').find = () => ({ select: () => ({ lean: async () => [
    { _id: A, name: 'سارة', gender: 'female' }, { _id: B, name: 'فهد', gender: 'male' }
] }) });
const sent = [];
require('../services/pushNotificationService').sendNotificationToUser = async (to, copy, data, save, opts) => {
    sent.push({ to: String(to), title: copy.title, type: data.type, push: opts?.push });
};

const games = require('../routes/mobile/games');

test('دعوة حلّ موعدها: expired + إشعاران، والكنس الثاني لا يكرّر', async () => {
    zset.set(MSG, Date.now() - 1000);
    assert.equal(await games.sweepExpiredInvites(), 1);
    assert.equal(doc.game.status, 'expired');
    const missed = sent.find(s => s.type === 'ludo_missed');
    const expired = sent.find(s => s.type === 'ludo_expired');
    assert.equal(missed.to, B);
    assert.match(missed.title, /فاتك تحدّي سارة/);
    assert.equal(missed.push, true);
    assert.equal(expired.to, A);
    assert.match(expired.title, /انتهت دعوتك لـفهد/);
    assert.equal(expired.push, false);
    assert.equal(await games.sweepExpiredInvites(), 0);
    assert.equal(sent.length, 2);
});

test('دعوة قُبلت قبل موعدها: لا شيء', async () => {
    doc = { ...doc, game: { ...doc.game, status: 'playing' } };
    zset.set(MSG, Date.now() - 1000);
    assert.equal(await games.sweepExpiredInvites(), 0);
    assert.equal(sent.length, 2);
});
