// MatchHala - StoryView Model
// مشاهدة قصة: صفّ واحد لكل (قصة، مشاهد). تُحذف مع انتهاء القصة.

const mongoose = require('mongoose');

const storyViewSchema = new mongoose.Schema({
    story: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    viewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // وضع التخفي أو مشرف — لا تظهر لصاحب القصة ولا تُعدّ
    isHidden: { type: Boolean, default: false },
    viewedAt: { type: Date, default: Date.now },
    // أول لقطة شاشة لهذا المشاهد — تُعدّ مرة واحدة (لا تكرار بلقطات متتالية)
    screenshotAt: { type: Date, default: null },
    // تفاعل المشاهد (إيموجي من قائمة ثابتة) — واحد لكل مشاهد، يُستبدل أو يُزال
    reaction: { type: String, default: null },
    reactedAt: { type: Date, default: null }
}, { timestamps: false });

storyViewSchema.index({ story: 1, viewer: 1 }, { unique: true });
storyViewSchema.index({ story: 1, viewedAt: -1 });
// «هل شاهدتُ قصص فلان؟» لشريط الأصدقاء
storyViewSchema.index({ viewer: 1, owner: 1 });

module.exports = mongoose.model('StoryView', storyViewSchema);
