#!/bin/bash
# ⛔ معطّل عمداً — 2026-08-04
#
# كان هذا السكربت يستهدف 72.61.102.206، وهي نسخة مجمّدة بقاعدة بيانات قديمة
# ونginx معطّل، لا الإنتاج. تشغيله كان ينتهي بـ "Deployment Complete" ويعرض
# pm2 سليماً بينما الإنتاج لم يتغيّر — فشل صامت بمظهر نجاح.
#
# النشر الصحيح: git push origin main
#   origin = contabo:/var/www/matchhala-api.git (109.123.250.125)
#   مستودع مجرّد فيه post-receive يعمل كل شيء تلقائياً:
#   checkout → npm ci عند تغيّر package → بناء react-admin عند تغيّر مصدره → pm2 restart
#
# للتحقّق من وصول النشر:
#   curl -s https://matchhala.chathala.com/api/health
#   قارن حقل commit بـ git rev-parse --short HEAD

echo "⛔ هذا السكربت معطّل — كان ينشر على الخادم الخطأ."
echo ""
echo "   استخدم:  git push origin main"
echo "   وتحقّق:  curl -s https://matchhala.chathala.com/api/health"
echo ""
exit 1
