// MatchHala - Mobile API v2
// هذا الملف يحتوي فقط على الـ endpoints الجديدة أو المعدلة في v2
// أي endpoint غير موجود هنا → يُستخدم من v1 تلقائياً
//
// كيف تضيف endpoint جديد أو تعدل موجود:
// 1. انسخ الـ handler من mobile.js
// 2. عدّل عليه هنا
// 3. التطبيقات القديمة (v1) لن تتأثر
//
// مثال:
// router.get('/home', protect, async (req, res) => {
//     // نسخة v2 محسنة من /home
// });

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/auth');

// ============================================
// v2 Endpoints — الجديدة أو المعدلة فقط
// ============================================

// مثال: GET /home — يمكن إضافة حقول جديدة في v2 بدون كسر v1
// router.get('/home', protect, async (req, res) => {
//     // v2 response with new fields
// });

// --- أضف endpoints v2 هنا ---


module.exports = router;
