// GET /api/admin/audit — سجلّ إجراءات المشرفين (للوحة). القراءة نفسها لا تُسجَّل (GET).
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AdminAuditLog = require('../models/AdminAuditLog');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect, adminOnly);

// @query page, limit (≤100), target (معرّف المستخدم المستهدف), admin (معرّف المشرف), failed=1
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
        const filter = {};
        const isId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);
        if (isId(req.query.target)) filter.targetId = req.query.target;
        if (isId(req.query.admin)) filter.admin = req.query.admin;
        if (req.query.failed === '1') filter.status = { $gte: 400 };

        const [rows, total] = await Promise.all([
            AdminAuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AdminAuditLog.countDocuments(filter)
        ]);
        // اسم الحساب المستهدف (إن كان مستخدماً) — دفعة واحدة
        const ids = [...new Set(rows.map(r => r.targetId && String(r.targetId)).filter(Boolean))];
        const targets = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean() : [];
        const nameById = new Map(targets.map(u => [String(u._id), u.name]));
        const data = rows.map(r => ({ ...r, targetName: r.targetId ? (nameById.get(String(r.targetId)) || null) : null }));

        const admins = await AdminAuditLog.aggregate([
            { $group: { _id: '$admin', name: { $last: '$adminName' }, n: { $sum: 1 } } },
            { $sort: { n: -1 } }, { $limit: 20 }
        ]);
        res.json({ success: true, data, total, page, limit, admins });
    } catch (error) {
        console.error('admin audit list error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
