// اختبار تكامل كشف العُري (utils/nudity): الخدمة الحقيقية (nsfwjs/WASM) + mongod مؤقت.
// node --test tests/nudityGuard.integration.test.js   (يُتخطّى إن لم يتوفر mongod)
// لا صور حساسة في الاختبار: «المنع» يُختبر بعتبة منخفضة جداً على صورة عادية.

process.env.NSFW_PORT = '5199';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const mongoose = require('mongoose');

const hasMongod = spawnSync('which', ['mongod']).status === 0;
const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nudity-test-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudity-img-'));
let mongod;

const nudity = require('../utils/nudity');

const health = () => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 5199, path: '/health' }, (res) => { res.resume(); resolve(res.statusCode === 200); })
        .on('error', () => resolve(false));
});

async function makeImage(name) {
    const p = path.join(tmp, name);
    await require('sharp')({ create: { width: 400, height: 300, channels: 3, background: '#3a6ea5' } }).jpeg().toFile(p);
    return p;
}

test('كشف العُري: تمرير، منع، وفشل مفتوح', { skip: !hasMongod && 'mongod غير متوفر' }, async (t) => {
    mongod = spawn('mongod', ['--dbpath', dbPath, '--port', '27098', '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
        try { await mongoose.connect('mongodb://127.0.0.1:27098/nuditytest', { serverSelectionTimeoutMS: 300 }); break; }
        catch { await new Promise(r => setTimeout(r, 200)); }
    }
    nudity.startService();
    for (let i = 0; i < 60 && !(await health()); i++) await new Promise(r => setTimeout(r, 500));
    assert.ok(await health(), 'الخدمة لم تجهز');
    const userId = new mongoose.Types.ObjectId();
    const BlockedImage = require('../models/BlockedImage');

    await t.test('صورة عادية تمرّ', async () => {
        const img = await makeImage('plain.jpg');
        const r = await nudity.checkImageFile(img);
        assert.equal(r.checked, true);
        assert.equal(r.nude, false);
        assert.ok(r.scores.neutral > 0.5 || r.scores.drawing > 0.5, JSON.stringify(r.scores));
        assert.equal(await nudity.blockIfNude({ filePath: img, userId, source: 'story' }), null);
        assert.ok(fs.existsSync(img), 'الصورة المسموحة لا تُحذف');
    });

    await t.test('فوق العتبة: تُمنع وتُحفظ للمراجعة', async () => {
        process.env.NSFW_BLOCK_THRESHOLD = '0.000001';
        const img = await makeImage('flagged.jpg');
        const refusal = await nudity.blockIfNude({ filePath: img, userId, source: 'profile' });
        delete process.env.NSFW_BLOCK_THRESHOLD;
        assert.equal(refusal.status, 422);
        assert.equal(refusal.body.code, 'IMAGE_NUDITY_BLOCKED');
        assert.ok(!fs.existsSync(img), 'المرفوع يُحذف');
        const doc = await BlockedImage.findOne({ user: userId }).lean();
        assert.equal(doc.source, 'profile');
        assert.equal(doc.status, 'pending');
        const saved = nudity.blockedFilePath(doc.file);
        assert.ok(saved && fs.existsSync(saved), 'نسخة المراجعة محفوظة');
        fs.unlinkSync(saved);
    });

    await t.test('مطفأ أو الخدمة غائبة: يمرّ بلا فحص', async () => {
        const img = await makeImage('off.jpg');
        process.env.NSFW_CHECK = '0';
        assert.deepEqual(await nudity.checkImageFile(img), { checked: false, nude: false });
        delete process.env.NSFW_CHECK;
        const saved = process.env.NSFW_PORT;
        // مسار الملف غير موجود ← خطأ داخلي ← يمرّ (لا يعطّل النشر)
        const r = await nudity.checkImageFile(path.join(tmp, 'missing.jpg'));
        assert.equal(r.checked, false);
        process.env.NSFW_PORT = saved;
    });

    await t.test('اسم ملف بمسار ملتوٍ مرفوض', () => {
        assert.equal(nudity.blockedFilePath('../../etc/passwd'), null);
        assert.equal(nudity.blockedFilePath('a/b.jpg'), null);
    });
});

test.after(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongod) { const exited = new Promise(r => mongod.once('exit', r)); mongod.kill(); await exited; }
    fs.rmSync(dbPath, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    // الخدمة ابنة لهذه العملية — تموت معها (disconnect)
    setTimeout(() => process.exit(0), 300).unref();
});
