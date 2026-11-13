// MatchHala - أحداث سوكت هلا لودو (على اتصال Socket.IO نفسه الذي تستعمله المحادثات)
//
// كل حدث من التطبيق يُرسل ack: { ok: true, ...data } أو { ok: false, code, message }.
// التحديثات تصل كل اللاعبين عبر غرف user:<id> (تعبر نسخ الـ cluster بمحوّل Redis):
//   ludo:match-found  بدأت مباراة (من الطابور/الغرفة/ضدّ الكمبيوتر)
//   ludo:state        حالة جديدة بعد كل فعل + events للحركات
//   ludo:ended        النتيجة والترتيب
//   ludo:room         تحديث غرفة الانتظار الخاصة (أو closed)
//   ludo:emote        عبارة/ملصق جاهز من لاعب
//   ludo:queue-dropped  أُخرج من الطابور (رصيده لم يعد يكفي رسوم الدوري)
//
// ⚠️ لا نصّ حرّ: العبارات والملصقات معرّفات من قائمة ثابتة، والنصّ نفسه في التطبيق.

const service = require('./service');
const lobby = require('./lobby');
const store = require('./store');

// العبارات (16) وملصقات الشخصيات (12) وملصقات الكلمات (6) — دليل التصميم
const PHRASES = Array.from({ length: 16 }, (_, i) => `phrase_${i + 1}`);
const FREE_STICKERS = ['laugh', 'angry', 'cry', 'shocked', 'challenge', 'wink', 'sleepy', 'thinking'];
const PREMIUM_STICKERS = ['cool', 'love', 'party', 'scared'];   // لمشتركي هلا+
const WORD_STICKERS = ['word_challenge', 'word_hurry', 'word_masterstroke', 'word_watch_me', 'word_what_luck', 'word_got_it'];
const EMOTES = new Set([...PHRASES, ...FREE_STICKERS, ...PREMIUM_STICKERS, ...WORD_STICKERS]);
const EMOTE_COOLDOWN_MS = 2000;
// انقطاع عابر (تبديل شبكة) لا يُعلَن: ننتظر قليلاً ثم نتأكد أنه لم يعد
const OFFLINE_GRACE_MS = Number(process.env.LUDO_OFFLINE_GRACE_MS) || 3000;

const isPremium = (user) =>
    !!user?.isPremium && (!user.premiumExpiresAt || new Date(user.premiumExpiresAt) > new Date());

function errorPayload(e) {
    if (e && e.code && e.status && e.status < 500) {
        return { ok: false, code: e.code, message: e.message };
    }
    console.error('ludo socket error:', e?.code || '', e?.message);
    return { ok: false, code: e?.code || 'SERVER_ERROR', message: 'تعذّر تنفيذ الطلب — حاول مجدداً' };
}

function registerLudoHandlers(io, socket) {
    const userId = socket.userId;

    // يغلّف كل معالج: ack مضمون، وأخطاء موحّدة
    const on = (event, handler) => {
        socket.on(event, async (payload, ack) => {
            if (typeof payload === 'function') { ack = payload; payload = {}; }
            const reply = typeof ack === 'function' ? ack : () => {};
            try {
                const data = await handler(payload || {});
                reply({ ok: true, ...(data || {}) });
            } catch (e) {
                reply(errorPayload(e));
            }
        });
    };

    // ── الدخول ──
    on('ludo:queue:join', ({ mode, size, league }) => lobby.joinQueue(userId, { mode, size, league }));
    on('ludo:queue:leave', () => lobby.leaveQueue(userId));
    on('ludo:solo', async ({ mode, size }) => ({ game: await lobby.startSolo(userId, { mode, size }) }));
    on('ludo:room:create', async ({ mode, size }) => ({ room: await lobby.createRoom(userId, { mode, size }) }));
    on('ludo:room:join', ({ code }) => lobby.joinRoom(userId, code));
    on('ludo:room:start', ({ code }) => lobby.startRoom(userId, code));
    on('ludo:room:leave', () => lobby.leaveRoom(userId));

    // ── الرصيد والدوريات ──
    on('ludo:wallet', () => lobby.walletInfo(userId));
    on('ludo:wallet:claim', () => lobby.claimDaily(userId));
    on('ludo:store', () => lobby.storeInfo(userId));
    on('ludo:store:buy-coins', ({ packId }) => lobby.buyCoins(userId, packId));
    on('ludo:store:purchase', ({ signedTransaction }) => lobby.redeemPurchase(userId, signedTransaction));
    on('ludo:ad:start', () => lobby.adStart(userId));
    on('ludo:ad:claim', ({ token }) => lobby.adClaim(userId, token));
    on('ludo:leaderboard', () => lobby.leaderboard(userId));
    on('ludo:prize:seen', () => lobby.prizeSeen(userId));

    // ── المباراة ──
    // back: شاشة المباراة أمامه ← يستعيد مقعده إن كان البوت تولّاه
    on('ludo:resume', async ({ back }) => ({ game: await service.playerReturn(userId, { reclaim: back === true }) }));
    on('ludo:roll', async ({ gameId, version }) =>
        ({ game: await service.playerRoll(userId, gameId, version) }));
    on('ludo:move', async ({ gameId, token, version }) =>
        ({ game: await service.playerMove(userId, gameId, Number(token), version) }));
    on('ludo:reroll', async ({ gameId, version }) =>
        ({ game: await service.playerReroll(userId, gameId, version) }));
    on('ludo:boost', async ({ gameId }) => ({ game: await service.playerBoost(userId, gameId) }));
    on('ludo:pass', async ({ gameId, version }) =>
        ({ game: await service.playerPass(userId, gameId, version) }));
    on('ludo:leave', async ({ gameId }) => ({ game: await service.playerLeave(userId, gameId) }));

    // ── العبارات والملصقات ──
    let lastEmoteAt = 0;
    // to (اختياري): لاعب في المباراة تُوجَّه له العبارة/الملصق (الضغط على صورته) — يراها الجميع
    on('ludo:emote', async ({ gameId, emote, to }) => {
        if (!EMOTES.has(emote)) {
            const e = new Error('عبارة غير معروفة'); e.code = 'BAD_EMOTE'; e.status = 400; throw e;
        }
        if (PREMIUM_STICKERS.includes(emote) && !isPremium(socket.user)) {
            const e = new Error('هذا الملصق لمشتركي هلا+'); e.code = 'PREMIUM_REQUIRED'; e.status = 403; throw e;
        }
        const now = Date.now();
        if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) {
            const e = new Error('انتظر قليلاً'); e.code = 'EMOTE_COOLDOWN'; e.status = 429; throw e;
        }
        const record = await store.getGame(String(gameId));
        if (!record || !record.meta.players.some(p => p.id === userId && !p.isBot)) {
            const e = new Error('لست في هذه المباراة'); e.code = 'NOT_IN_GAME'; e.status = 403; throw e;
        }
        // الهدف يجب أن يكون لاعباً آخر في المباراة نفسها (بوت أو إنسان) — وإلا تُرسل للجميع بلا هدف
        const target = typeof to === 'string' && to !== userId && record.meta.players.some(p => p.id === to) ? to : null;
        lastEmoteAt = now;
        const rooms = record.meta.players.filter(p => !p.isBot).map(p => `user:${p.id}`);
        io.to(rooms).emit('ludo:emote', { gameId: record.id, playerId: userId, emote, at: now, ...(target ? { to: target } : {}) });
        return {};
    });

    // اتصال جديد لمن له مباراة جارية ← لم يعد «منقطعاً» عند خصمه (قراءة واحدة رخيصة من Redis لكل اتصال)
    store.getUserGame(userId)
        .then(gameId => (gameId ? service.setPresence(userId, true) : null))
        .catch(() => {});

    // انقطاع: المؤقّت يكمل الأدوار (بمهلة أقصر للمنقطع)، والعودة بـ ludo:resume.
    // والطابور وغرفة الانتظار لا يبقيان لمن خرج.
    socket.on('disconnect', async () => {
        try {
            // ⚠️ كل انقطاع لكل مستخدم يمرّ هنا — لا نسأل الـ cluster (fetchSockets) إلا لمن
            //    ينتظر في طابور/غرفة أو له مباراة جارية (ثلاث قراءات رخيصة من Redis)
            const [entry, room, gameId] = await Promise.all([
                store.getQueueEntry(userId), store.getUserRoom(userId), store.getUserGame(userId)
            ]);
            if (!entry && !room && !gameId) return;
            const connected = async () => (await io.in(`user:${userId}`).fetchSockets()).length > 0;
            if (await connected()) return;           // ما زال متصلاً من جهاز/نسخة أخرى
            if (entry) await lobby.leaveQueue(userId);
            if (room) await lobby.leaveRoom(userId);
            if (gameId) {
                const timer = setTimeout(async () => {
                    try {
                        if (!(await connected())) await service.setPresence(userId, false);
                    } catch (e) { /* قفل مشغول أو Redis — المهلة الكاملة تبقى */ }
                }, OFFLINE_GRACE_MS);
                timer.unref?.();
            }
        } catch (e) { /* Redis غير متاح — تنتهي صلاحية المفاتيح وحدها */ }
    });
}

module.exports = { registerLudoHandlers, EMOTES };
