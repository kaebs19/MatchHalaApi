// 🛡️ خدمة كشف العُري — عملية مستقلة يشغّلها instance 0 (utils/nudity/index.js → startService)
//
// لماذا عملية مستقلة: النموذج (nsfwjs MobileNetV2Mid على TensorFlow.js/WASM) يأخذ ~200MB؛ داخل كل نسخة من
// نسخ PM2 الأربع كان سيدفعها فوق حدّ max_memory_restart (1G) فتُعاد باستمرار. هنا نسخة واحدة على 127.0.0.1.
// تموت مع أبيها (disconnect) وتُعاد مع كل نشر لأن instance 0 يُعاد.
//
// POST /classify  — الجسم: بكسلات RGB خام 224×224×3 (يجهّزها المتصل بـ sharp) ← { scores: { porn, hentai, sexy, neutral, drawing } }

const http = require('http');
const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-wasm');
const nsfw = require('nsfwjs');

const PORT = parseInt(process.env.NSFW_PORT, 10) || 5099;
const SIZE = 224;
const EXPECTED = SIZE * SIZE * 3;
let model = null;

process.on('disconnect', () => process.exit(0));

async function loadModel() {
    await tf.setBackend('wasm');
    await tf.ready();
    model = await nsfw.load('MobileNetV2Mid');
    // تسخين: أول تصنيف أبطأ بكثير
    const warm = tf.zeros([SIZE, SIZE, 3], 'int32');
    await model.classify(warm);
    warm.dispose();
}

async function classify(buffer) {
    const img = tf.tensor3d(new Uint8Array(buffer), [SIZE, SIZE, 3], 'int32');
    try {
        const preds = await model.classify(img, 5);
        const scores = {};
        for (const p of preds) scores[p.className.toLowerCase()] = Math.round(p.probability * 1000) / 1000;
        return scores;
    } finally {
        img.dispose();
    }
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(model ? 200 : 503).end(model ? 'ok' : 'loading');
        return;
    }
    if (req.method !== 'POST' || req.url !== '/classify') { res.writeHead(404).end(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size <= EXPECTED) chunks.push(c); });
    req.on('end', async () => {
        if (!model) { res.writeHead(503).end(JSON.stringify({ error: 'loading' })); return; }
        if (size !== EXPECTED) { res.writeHead(400).end(JSON.stringify({ error: 'size' })); return; }
        try {
            const scores = await classify(Buffer.concat(chunks));
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ scores }));
        } catch (e) {
            res.writeHead(500).end(JSON.stringify({ error: e.message }));
        }
    });
});

// أثناء reload تبقى النسخة القديمة ممسكة بالمنفذ ثوانيَ — نعيد المحاولة بدل الموت
let attempts = 0;
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempts++ < 30) {
        setTimeout(() => server.listen(PORT, '127.0.0.1'), 2000);
        return;
    }
    console.error('🛡️ خدمة كشف العُري:', e.message);
    process.exit(1);
});

loadModel()
    .then(() => {
        server.listen(PORT, '127.0.0.1', () => console.log(`🛡️ خدمة كشف العُري جاهزة على 127.0.0.1:${PORT}`));
    })
    .catch((e) => {
        console.error('🛡️ تعذّر تحميل نموذج كشف العُري:', e.message);
        process.exit(1);
    });
