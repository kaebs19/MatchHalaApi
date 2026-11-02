// استيراد ملصقات دفعة واحدة: node scripts/importStickers.js <مجلد>
// كل مجلد فرعي فئة (01_اسم_الفئة) وكل ملف WebP/PNG ملصق. لا يكرّر فئة موجودة بالاسم نفسه.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Sticker = require('../models/Sticker');
const StickerCategory = require('../models/StickerCategory');
const { saveStickerFile } = require('../utils/stickerFiles');

(async () => {
    const root = process.argv[2];
    if (!root) throw new Error('حدّد المجلد');
    await mongoose.connect(process.env.MONGODB_URI);

    const folders = fs.readdirSync(root, { withFileTypes: true })
        .filter(e => e.isDirectory()).map(e => e.name).sort();
    let order = await StickerCategory.countDocuments();

    for (const folder of folders) {
        const name = folder.replace(/^\d+_/, '').replace(/_/g, ' ');
        if (await StickerCategory.exists({ name })) {
            console.log(`تخطّي «${name}»: موجودة`);
            continue;
        }
        const category = await StickerCategory.create({ name, order: order++ });
        const files = fs.readdirSync(path.join(root, folder)).filter(f => /\.(webp|png)$/i.test(f)).sort();
        for (const [index, file] of files.entries()) {
            const imageUrl = await saveStickerFile(path.join(root, folder, file));
            await Sticker.create({ category: category._id, imageUrl, order: index });
        }
        console.log(`«${name}»: ${files.length}`);
    }
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
