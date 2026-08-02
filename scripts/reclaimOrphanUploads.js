#!/usr/bin/env node
/**
 * استرجاع مساحة الملفات اليتيمة في uploads/.
 *
 * الملف "يتيم" إذا لم يَرِد اسمه في أي مستند بقاعدة البيانات — أي أن الرسالة
 * أو المحادثة التي كانت تحتويه حُذفت، بينما بقي الملف على القرص. لا يوجد أي
 * تنظيف تلقائي للملفات حالياً، فتراكمت.
 *
 * الأمان:
 *   - وضع المعاينة هو الافتراضي؛ الحذف يحتاج --apply صراحةً.
 *   - لا يُحذف شيء فوراً: تُنقل الملفات إلى uploads/_reclaimed/<تاريخ>/ ثم
 *     تُحذف نهائياً بعد --quarantine-days (افتراضياً 30) في تشغيلة لاحقة.
 *     أي أن نافذة التراجع = 30 يوماً بعد 90 يوماً من اليُتم.
 *   - تُستثنى الملفات الأحدث من --min-age-days (افتراضياً 90) حتى لا تُمَس
 *     ملفات رفعت للتو ولم يُكتب مستندها بعد.
 *   - يُبنى مرجع الأسماء من كل المجموعات، لا من messages فقط، حتى لا تُمَس
 *     أدلة البلاغات والمخالفات.
 *
 * الاستخدام:
 *   node scripts/reclaimOrphanUploads.js                    # معاينة
 *   node scripts/reclaimOrphanUploads.js --min-age-days=180 # معاينة أكثر تحفظاً
 *   node scripts/reclaimOrphanUploads.js --apply            # تنفيذ فعلي
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const UPLOADS = path.join(__dirname, '../uploads');
const SCAN_DIRS = ['messages', 'audio'];
const MEDIA_RE = /\.(webp|jpe?g|png|gif|mp3|m4a|aac|wav|ogg|mp4|webm)$/i;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MIN_AGE_DAYS = Number(
  (args.find((a) => a.startsWith('--min-age-days=')) || '').split('=')[1] || 90
);
// كم يبقى الملف في الحجر قبل الحذف النهائي
const QUARANTINE_DAYS = Number(
  (args.find((a) => a.startsWith('--quarantine-days=')) || '').split('=')[1] || 30
);

const MONGO =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/matchhala';

const gb = (b) => (b / 1e9).toFixed(2);

async function buildReferenceSet(db) {
  const referenced = new Set();
  const addIfMedia = (v) => {
    if (typeof v === 'string' && MEDIA_RE.test(v)) {
      referenced.add(path.basename(v.split('?')[0]));
    }
  };
  const walk = (val, depth = 0) => {
    if (val == null || depth > 5) return;
    if (typeof val === 'string') return addIfMedia(val);
    if (Array.isArray(val)) return val.forEach((v) => walk(v, depth + 1));
    if (typeof val === 'object') {
      for (const v of Object.values(val)) walk(v, depth + 1);
    }
  };

  // مسح كل المجموعات غير عملي: swipes وحدها 18 مليون مستند و notifications
  // 2.6 مليون، ولا تحمل وسائط إطلاقاً. نقتصر على ما قد يشير لملف، ونستخدم
  // projection على الكبيرة منها.
  //
  // ⚠️ إن أُضيف حقل وسائط لمجموعة جديدة، أضفها هنا — وإلا ستُعتبر ملفاتها
  //    يتيمة وتُنقل إلى الحجر.
  const SOURCES = [
    { name: 'messages', projection: { mediaUrl: 1, mediaCapture: 1, content: 1 } },
    { name: 'users', projection: { profileImage: 1, photos: 1, verificationPhoto: 1 } },
    { name: 'reports', projection: null },
    { name: 'violations', projection: null },
    { name: 'appeals', projection: null },
    { name: 'flaggedmessages', projection: null },
    { name: 'sensitivecontentreveals', projection: null },
    { name: 'officialwarnings', projection: null },
    { name: 'spamreports', projection: null },
  ];

  for (const { name, projection } of SOURCES) {
    if (!(await db.listCollections({ name }).hasNext())) {
      console.log(`  تحذير: المجموعة '${name}' غير موجودة — تخطٍّ`);
      continue;
    }
    const before = referenced.size;
    const cursor = projection
      ? db.collection(name).find({}, { projection })
      : db.collection(name).find({});
    for await (const doc of cursor) walk(doc);
    console.log(`  ${name.padEnd(24)} +${referenced.size - before}`);
  }
  return referenced;
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * إفراغ الحجر القديم — بدونه تتراكم مجلدات _reclaimed/ ولا تتحرر المساحة
 * فعلياً أبداً. الملفات تكون قد أمضت QUARANTINE_DAYS يوماً بعد أن أمضت
 * MIN_AGE_DAYS يوماً يتيمة، فنافذة التراجع واسعة.
 */
function purgeExpiredQuarantine() {
  const root = path.join(UPLOADS, '_reclaimed');
  if (!fs.existsSync(root)) return { dirs: 0, bytes: 0 };

  const cutoff = Date.now() - QUARANTINE_DAYS * 864e5;
  let dirs = 0;
  let bytes = 0;

  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    // اسم المجلد هو تاريخ الحجر — أوثق من mtime الذي يتغيّر بأي لمسة
    const stamped = Date.parse(name);
    if (Number.isNaN(stamped) || stamped > cutoff) continue;

    for (const f of listFiles(dir)) bytes += fs.statSync(f).size;
    if (APPLY) fs.rmSync(dir, { recursive: true, force: true });
    dirs++;
  }
  return { dirs, bytes };
}

(async () => {
  console.log(
    `الوضع: ${APPLY ? 'تنفيذ فعلي' : 'معاينة فقط'} | الحد الأدنى للعمر: ${MIN_AGE_DAYS} يوم | الحجر: ${QUARANTINE_DAYS} يوم`
  );

  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;

  console.log('بناء مرجع الأسماء من قاعدة البيانات...');
  const referenced = await buildReferenceSet(db);
  console.log(`  أسماء مرجعية: ${referenced.size}`);

  if (referenced.size === 0) {
    console.error('توقّف: مجموعة المراجع فارغة — هذا يعني خطأ اتصال لا قرصاً نظيفاً.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const cutoff = Date.now() - MIN_AGE_DAYS * 864e5;
  const stamp = new Date().toISOString().slice(0, 10);
  const quarantine = path.join(UPLOADS, '_reclaimed', stamp);

  let totalCandidates = 0;
  let totalBytes = 0;

  for (const dir of SCAN_DIRS) {
    const files = listFiles(path.join(UPLOADS, dir));
    let n = 0;
    let bytes = 0;

    for (const file of files) {
      const name = path.basename(file);
      if (referenced.has(name)) continue;

      const st = fs.statSync(file);
      if (st.mtimeMs > cutoff) continue; // حديث جداً — اتركه

      n++;
      bytes += st.size;

      if (APPLY) {
        const dest = path.join(quarantine, dir, name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(file, dest);
      }
    }

    console.log(
      `  ${dir.padEnd(10)} ${String(n).padStart(6)} ملف   ${gb(bytes).padStart(6)} GB`
    );
    totalCandidates += n;
    totalBytes += bytes;
  }

  console.log(`\nالإجمالي: ${totalCandidates} ملف، ${gb(totalBytes)} GB`);
  if (APPLY) {
    console.log(`نُقلت إلى: ${quarantine}`);
  } else {
    console.log('لم يُمَس شيء. أضف --apply للتنفيذ.');
  }

  const purged = purgeExpiredQuarantine();
  if (purged.dirs > 0) {
    console.log(
      `${APPLY ? 'حُذف نهائياً' : 'مرشّح للحذف النهائي'}: ${purged.dirs} مجلد حجر أقدم من ${QUARANTINE_DAYS} يوم، ${gb(purged.bytes)} GB`
    );
  } else {
    console.log(`لا يوجد حجر أقدم من ${QUARANTINE_DAYS} يوم بعد.`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
