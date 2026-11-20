// اختبار تكامل «لست مهتماً» في البحث: الإخفاء دائم، القائمة، والتراجع.
// node --test tests/searchHidden.integration.test.js   (يُتخطّى إن لم يتوفر mongod)

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const hasMongod = spawnSync('which', ['mongod']).status === 0;
const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'search-hidden-'));
let mongod, server, base;

const auth = require('../middleware/auth');
auth.protect = async (req, res, next) => {
    const User = require('../models/User');
    req.user = await User.findById(req.headers['x-test-user']);
    if (!req.user) return res.status(401).json({ success: false });
    next();
};

const mongoose = require('mongoose');
const express = require('express');

function call(method, url, user) {
    return new Promise((resolve, reject) => {
        const req = http.request(base + url, { method, headers: { 'x-test-user': String(user) } }, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
        });
        req.on('error', reject);
        req.end();
    });
}

test('«لست مهتماً» في البحث', { skip: !hasMongod && 'mongod غير متوفر' }, async (t) => {
    mongod = spawn('mongod', ['--dbpath', dbPath, '--port', '27097', '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
        try { await mongoose.connect('mongodb://127.0.0.1:27097/hiddentest', { serverSelectionTimeoutMS: 300 }); break; }
        catch { await new Promise(r => setTimeout(r, 200)); }
    }
    const User = require('../models/User');
    await User.init().catch(() => {});
    const mk = (name) => User.collection.insertOne({
        name, email: `${name}@t.t`, isActive: true, blockedUsers: [], gender: 'male', country: 'SA',
        birthDate: new Date('2000-01-01'), lastLogin: new Date(), createdAt: new Date()
    }).then(r => String(r.insertedId));
    const me = await mk('me');
    const a = await mk('alpha');
    const b = await mk('beta');

    const app = express();
    app.use(express.json());
    app.use('/api/mobile', require('../routes/mobile/users'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/mobile`;

    const ids = async () => {
        const r = await call('GET', '/users/search?limit=50', me);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const list = r.body.data?.users || r.body.data || [];
        return list.map(u => String(u._id || u.id));
    };

    await t.test('قبل الإخفاء يظهر الاثنان', async () => {
        const found = await ids();
        assert.ok(found.includes(a) && found.includes(b), found.join(','));
    });

    await t.test('الإخفاء دائم ويختفي من البحث', async () => {
        assert.equal((await call('POST', `/search/hidden/${a}`, me)).status, 200);
        assert.equal((await call('POST', `/search/hidden/${a}`, me)).status, 200); // مرتين = سجلّ واحد
        const found = await ids();
        assert.ok(!found.includes(a) && found.includes(b));
        const doc = await User.findById(me).select('searchHiddenUsers').lean();
        assert.equal(doc.searchHiddenUsers.length, 1);
    });

    await t.test('القائمة والتراجع', async () => {
        const list = await call('GET', '/search/hidden', me);
        assert.deepEqual(list.body.data.users.map(u => String(u._id)), [a]);
        assert.equal(list.body.data.users[0].name, 'alpha');
        assert.equal((await call('DELETE', `/search/hidden/${a}`, me)).status, 200);
        assert.ok((await ids()).includes(a));
        assert.equal((await call('GET', '/search/hidden', me)).body.data.users.length, 0);
    });

    await t.test('معرّفات غير صالحة', async () => {
        assert.equal((await call('POST', '/search/hidden/xyz', me)).status, 400);
        assert.equal((await call('POST', `/search/hidden/${me}`, me)).status, 400);
    });
});

test.after(async () => {
    server?.close();
    await mongoose.disconnect().catch(() => {});
    if (mongod) { const exited = new Promise(r => mongod.once('exit', r)); mongod.kill(); await exited; }
    fs.rmSync(dbPath, { recursive: true, force: true });
});
