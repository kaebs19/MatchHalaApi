// MatchHala - ملفات الملصقات: تُعاد ترميزاً WebP شفافاً ≤512 باسم عشوائي في uploads/stickers

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const STICKER_DIR = path.join(__dirname, '..', 'uploads', 'stickers');
const STICKER_EDGE = 512;

fs.mkdirSync(STICKER_DIR, { recursive: true });

async function saveStickerFile(input) {
    const fileName = `st-${crypto.randomBytes(12).toString('hex')}.webp`;
    await sharp(input)
        .resize({ width: STICKER_EDGE, height: STICKER_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(path.join(STICKER_DIR, fileName));
    return `/uploads/stickers/${fileName}`;
}

function removeStickerFile(imageUrl) {
    if (!imageUrl) return;
    fs.promises.unlink(path.join(STICKER_DIR, path.basename(imageUrl))).catch(() => {});
}

module.exports = { saveStickerFile, removeStickerFile };
