// اختبار تكامل القصص التفاعلية: الاستطلاع، «اسألني»، والجمهور (الأصدقاء فقط)
// node --test tests/storyInteractive.integration.test.js
// يشغّل mongod مؤقتاً (مجلد مؤقت، منفذ 27099) — يُتخطّى إن لم يتوفر mongod محلياً.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const hasMongod = spawnSync('which', ['mongod']).status === 0;
const PORT = 27099;
const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'story-test-'));
let mongod;

// المستخدم الحالي يُختار بترويسة x-test-user بدل التوكن
const auth = require('../middleware/auth');
auth.protect = async (req, res, next) => {
    const User = require('../models/User');
    req.user = await User.findById(req.headers['x-test-user']);
    if (!req.user) return res.status(401).json({ success: false });
    next();
};

const mongoose = require('mongoose');
const express = require('express');

let server, base, User, Friendship, ids = {};

function call(method, url, { user, json, form } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { 'x-test-user': String(user) };
        let body = null;
        if (json) { body = Buffer.from(JSON.stringify(json)); headers['content-type'] = 'application/json'; }
        if (form) {
            const boundary = '----t' + Date.now();
            const parts = [];
            for (const [k, v] of Object.entries(form)) {
                if (Buffer.isBuffer(v)) {
                    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), v, Buffer.from('\r\n'));
                } else {
                    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
                }
            }
            parts.push(Buffer.from(`--${boundary}--\r\n`));
            body = Buffer.concat(parts);
            headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
        }
        if (body) headers['content-length'] = body.length;
        const req = http.request(base + url, { method, headers }, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

test('القصص التفاعلية والجمهور', { skip: !hasMongod && 'mongod غير متوفر' }, async (t) => {
    mongod = spawn('mongod', ['--dbpath', dbPath, '--port', String(PORT), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
        try { await mongoose.connect(`mongodb://127.0.0.1:${PORT}/storytest`, { serverSelectionTimeoutMS: 300 }); break; }
        catch { await new Promise(r => setTimeout(r, 200)); }
    }
    User = require('../models/User');
    Friendship = require('../models/Friendship');
    const mk = (name) => User.collection.insertOne({ name, email: `${name}@t.t`, isActive: true, blockedUsers: [], createdAt: new Date() }).then(r => r.insertedId);
    ids.owner = await mk('owner');
    ids.friend = await mk('friend');
    ids.stranger = await mk('stranger');
    await Friendship.create({ requester: ids.owner, recipient: ids.friend, status: 'accepted' });

    const app = express();
    app.use(express.json());
    app.use('/api/mobile', require('../routes/mobile/stories'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/mobile`;

    const png = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#a33' } }).png().toBuffer();
    const pollJSON = JSON.stringify({ question: 'قهوة أم شاي؟', options: ['قهوة', 'شاي'], x: 0.5, y: 0.6, size: 0.7 });

    await t.test('نشر قصة باستطلاع و«اسألني» للجميع', async () => {
        const r = await call('POST', '/stories', { user: ids.owner, form: {
            image: png, poll: pollJSON, askBox: JSON.stringify({ prompt: 'اسألني أي شيء', x: 0.5, y: 0.3, size: 0.7 })
        } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const s = r.body.data.story;
        assert.deepEqual(s.poll.counts, [0, 0]);
        assert.equal(s.askBox.prompt, 'اسألني أي شيء');
        assert.equal(s.audience, 'everyone');
        ids.storyPoll = s._id;
    });

    await t.test('نصّ ترويج في الاستطلاع يرفض القصة', async () => {
        const r = await call('POST', '/stories', { user: ids.owner, form: {
            image: png, poll: JSON.stringify({ question: 'ضيفني سناب abc_123', options: ['نعم', 'لا'], x: 0.5, y: 0.5, size: 0.6 })
        } });
        assert.equal(r.status, 422);
        assert.equal(r.body.code, 'STORY_TEXT_BLOCKED');
    });

    await t.test('استطلاع ناقص يُرفض', async () => {
        const r = await call('POST', '/stories', { user: ids.owner, form: {
            image: png, poll: JSON.stringify({ question: 'س', options: ['أ'], x: 0.5, y: 0.5, size: 0.6 })
        } });
        assert.equal(r.status, 400);
    });

    await t.test('قصة للأصدقاء فقط', async () => {
        const r = await call('POST', '/stories', { user: ids.owner, form: { image: png, audience: 'friends' } });
        assert.equal(r.status, 201);
        assert.equal(r.body.data.story.audience, 'friends');
        ids.storyFriends = r.body.data.story._id;
    });

    await t.test('الغريب لا يرى قصة الأصدقاء، والصديق يراها', async () => {
        const s1 = await call('GET', `/users/${ids.owner}/stories`, { user: ids.stranger });
        assert.deepEqual(s1.body.data.stories.map(s => s._id), [ids.storyPoll]);
        const s2 = await call('GET', `/users/${ids.owner}/stories`, { user: ids.friend });
        assert.equal(s2.body.data.stories.length, 2);
        // قبل التصويت: بلا أعداد
        const poll = s2.body.data.stories.find(s => s._id === ids.storyPoll).poll;
        assert.equal(poll.counts, undefined);
        assert.equal(poll.myVote, null);

        const st = await call('POST', '/stories/status', { user: ids.stranger, json: { userIds: [String(ids.owner)] } });
        assert.equal(st.body.data.statuses[String(ids.owner)].count, 1);
        const sf = await call('POST', '/stories/status', { user: ids.friend, json: { userIds: [String(ids.owner)] } });
        assert.equal(sf.body.data.statuses[String(ids.owner)].count, 2);

        const v = await call('POST', `/stories/${ids.storyFriends}/view`, { user: ids.stranger });
        assert.equal(v.status, 404);
        const v2 = await call('POST', `/stories/${ids.storyFriends}/view`, { user: ids.friend });
        assert.equal(v2.status, 200);
    });

    await t.test('التصويت مرة واحدة والأعداد بعده', async () => {
        const a = await call('POST', `/stories/${ids.storyPoll}/poll`, { user: ids.stranger, json: { option: 1 } });
        assert.equal(a.status, 200);
        assert.deepEqual(a.body.data, { counts: [0, 1], myVote: 1 });
        const again = await call('POST', `/stories/${ids.storyPoll}/poll`, { user: ids.stranger, json: { option: 0 } });
        assert.deepEqual(again.body.data, { counts: [0, 1], myVote: 1 });
        const b = await call('POST', `/stories/${ids.storyPoll}/poll`, { user: ids.friend, json: { option: 0 } });
        assert.deepEqual(b.body.data.counts, [1, 1]);
        const own = await call('POST', `/stories/${ids.storyPoll}/poll`, { user: ids.owner, json: { option: 0 } });
        assert.equal(own.status, 400);
        const after = await call('GET', `/users/${ids.owner}/stories`, { user: ids.stranger });
        const p = after.body.data.stories[0].poll;
        assert.deepEqual(p.counts, [1, 1]);
        assert.equal(p.myVote, 1);
        const mine = await call('GET', `/users/${ids.owner}/stories`, { user: ids.owner });
        assert.deepEqual(mine.body.data.stories.find(s => s._id === ids.storyPoll).poll.counts, [1, 1]);
    });

    await t.test('الردّ على قصة الأصدقاء ممنوع للغريب', async () => {
        const { buildStoryRef } = require('../utils/storyReply');
        assert.equal(await buildStoryRef(ids.storyFriends, ids.owner, ids.stranger), null);
        assert.ok(await buildStoryRef(ids.storyFriends, ids.owner, ids.friend));
    });
});

test.after(async () => {
    server?.close();
    await mongoose.disconnect().catch(() => {});
    if (mongod) { const exited = new Promise(r => mongod.once('exit', r)); mongod.kill(); await exited; }
    // ملفات القصص المرفوعة أثناء الاختبار
    const dir = path.join(__dirname, '..', 'uploads', 'ephemeral');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (f.startsWith('story-') && fs.statSync(path.join(dir, f)).mtimeMs > Date.now() - 120000) fs.unlinkSync(path.join(dir, f));
    }
    fs.rmSync(dbPath, { recursive: true, force: true });
});
