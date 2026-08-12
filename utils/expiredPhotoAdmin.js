// HalaChat - كشف الصور المؤقتة المنتهية للإشراف
//
// الصورة المؤقتة (disappearing) تُبطَل بعد المشاهدة: mediaUrl = null والملف
// يُنقل إلى /uploads/_expired خارج المسارات العامة. النتيجة أن الصورة كانت
// تختفي أيضاً من لوحة تحكم الأدمن فلا يبقى للإشراف أي دليل.
//
// هذا الـ helper يضيف — لردود الأدمن فقط — رابطاً بديلاً يقرأ من الأرشيف.

// ✅ يضيف adminMediaUrl للرسائل التي أرشفت صورتها المؤقتة
function withExpiredPhotoForAdmin(message) {
    if (!message) return message;
    const obj = typeof message.toObject === 'function' ? message.toObject() : { ...message };
    const d = obj.disappearing;
    if (d?.enabled) {
        obj.isDisappearingPhoto = true;
        if (d.destroyed && d.archivedPath) {
            obj.isExpiredPhoto = true;
            obj.adminMediaUrl = `/api/messages/${obj._id}/expired-photo`;
        }
    }
    return obj;
}

module.exports = { withExpiredPhotoForAdmin };
