/**
 * هلا لودو — هل البوت عادل في الدوري؟ (قراءة فقط)
 *
 *   node scripts/ludoBotReport.js [أيام=14]
 *
 * مباريات الدوري التي اكتملت ببوتات (الطابور لم يجد خصماً بشرياً): نسبة فوز البشر لكل دوري وتركيبة.
 * المرجع العادل: إنسان ضدّ بوت واحد 50%، ضدّ ثلاثة 25%. أقلّ بوضوح = البوت يأكل رسوم الدوري ← خفّف chooseBotMove.
 * المباريات التي تولّى فيها البوت إنساناً (takenOver) أو انسحب فيها أحد تُعدّ منفصلة — لا تقيس قوة البوت.
 */
const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('../config/database');

async function main() {
    const days = Number(process.argv[2]) || 14;
    await connectDB();
    const LudoMatch = require('../models/LudoMatch');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await LudoMatch.aggregate([
        { $match: { endedAt: { $gte: since }, league: { $ne: null } } },
        { $project: {
            league: 1,
            humans: { $size: { $filter: { input: '$players', cond: { $eq: ['$$this.isBot', false] } } } },
            bots: { $size: { $filter: { input: '$players', cond: { $eq: ['$$this.isBot', true] } } } },
            humanWon: { $gt: [{ $size: { $ifNull: ['$winners', []] } }, 0] },
            disrupted: { $anyElementTrue: { $map: { input: '$players', in: { $or: ['$$this.left', '$$this.takenOver'] } } } }
        } },
        { $group: {
            _id: { league: '$league', humans: '$humans', bots: '$bots', disrupted: '$disrupted' },
            games: { $sum: 1 },
            humanWins: { $sum: { $cond: ['$humanWon', 1, 0] } }
        } },
        { $sort: { '_id.disrupted': 1, '_id.bots': -1, '_id.league': 1 } }
    ]);
    console.log(`مباريات الدوري آخر ${days} يوماً (منذ ${since.toISOString().slice(0, 10)})\n`);
    if (rows.length === 0) console.log('لا بيانات بعد.');
    for (const r of rows) {
        const { league, humans, bots, disrupted } = r._id;
        if (bots === 0) continue;
        const fair = Math.round((humans / (humans + bots)) * 100);
        const pct = Math.round((r.humanWins / r.games) * 100);
        const flag = disrupted ? '(انسحاب/تولّي — لا تقيس البوت)' : (r.games < 30 ? '(عيّنة صغيرة)' : (pct < fair - 8 ? '⚠️ البوت أقوى من العادل' : ''));
        console.log(`${league.padEnd(7)} ${humans} إنسان × ${bots} بوت: ${r.games} مباراة · فوز البشر ${pct}% (العادل ${fair}%) ${flag}`);
    }
    const human = rows.filter(r => r._id.bots === 0).reduce((a, r) => a + r.games, 0);
    console.log(`\nمباريات دوري بين بشر فقط: ${human}`);
    await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
