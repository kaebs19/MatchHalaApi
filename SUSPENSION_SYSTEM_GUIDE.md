# نظام التعليق التدريجي — دليل التحديث والاختبار
> MatchHala API — Updated: 02/04/2026

---

## 1. الملفات المُعدّلة

| الملف | التعديل |
|-------|---------|
| `models/User.js` | إضافة `suspension.level`, `totalSuspensions`, `history[]` |
| `middleware/auth.js` | إضافة `level` و `violationCount` في response 403 |
| `routes/users.js` | دعم `'auto'`, `'3d'` + endpoint `reports-count` |
| `routes/mobile.js` | التعليق التلقائي بعد 5 بلاغات |
| `react-admin/src/services/api.js` | إضافة `getUserReportsCount()` |
| `react-admin/src/pages/UserDetail.js` | سجل التعليقات + مستوى + بلاغات |
| `react-admin/src/pages/UserDetail.css` | تنسيقات القسم الجديد |

---

## 2. خطوات تحديث السيرفر (Deployment)

### الخطوة 1: رفع الكود على GitHub
```bash
cd /Volumes/me/API/01/MatchHalaApi
git add .
git commit -m "feat: نظام التعليق التدريجي + التعليق التلقائي بعد 5 بلاغات"
git push origin main
```

### الخطوة 2: تحديث Backend على السيرفر
```bash
# من جهازك المحلي
./deploy.sh
```

أو يدوياً:
```bash
ssh root@72.61.102.206

cd /var/www/MatchHalaApi/backend
git pull origin main

cd /var/www/MatchHalaApi
rsync -av --exclude='node_modules' --exclude='.env' --exclude='.git' --exclude='uploads' backend/ ./

npm install --production
pm2 restart matchhala-api

# تحقق من الحالة
pm2 logs matchhala-api --lines 20
```

### الخطوة 3: بناء ونشر لوحة التحكم
```bash
# محلياً — بناء React Admin
cd /Volumes/me/API/01/MatchHalaApi/react-admin
npm run build

# رفع البناء للسيرفر
scp -r build/ root@72.61.102.206:/var/www/MatchHalaApi/react-admin/build/
```

أو على السيرفر مباشرة:
```bash
ssh root@72.61.102.206
cd /var/www/MatchHalaApi/react-admin
npm install
npm run build
```

### الخطوة 4: التحقق
```bash
# تحقق أن الـ API شغّال
curl -s https://matchhala.chathala.com/api/settings | head -c 100

# تحقق أن لوحة التحكم شغّالة
curl -s -o /dev/null -w "%{http_code}" https://matchhala.chathala.com/admin
# يجب أن يرجع 200
```

---

## 3. الاختبار اليدوي

### ملاحظة مهمة
- لا حاجة لتشغيل migration — MongoDB schema-less، الحقول الجديدة تُضاف تلقائياً
- المستخدمين الحاليين سيكون عندهم `suspension.level = 0` و `history = []` بشكل افتراضي

---

### اختبار 1: تعليق يدوي من الأدمن (المستوى 1 — 24 ساعة)

**من لوحة التحكم:**
1. ادخل `/admin` → Users → اختر مستخدم تجريبي
2. اضغط تبويب "إجراءات الأدمن"
3. تحقق من ظهور بطاقات جديدة:
   - "مستوى التعليق" مع شريط بصري (○○○○○)
   - "البلاغات" مع عدد المبلّغين
4. اضغط "تعليق المستخدم"
5. تحقق من ظهور:
   - اقتراح "المستوى التالي: 1 (24 ساعة)"
   - قائمة بها "تلقائي" كخيار أول
6. اختر "تلقائي" → أدخل سبب → اضغط "تعليق"
7. تحقق:
   - ✅ الشريط البصري أصبح (●○○○○)
   - ✅ "المستوى 1 / 5"
   - ✅ ظهور سجل التعليقات مع "أدمن" كمصدر

**أو عبر curl:**
```bash
# استبدل TOKEN و USER_ID
TOKEN="your_admin_token"
USER_ID="target_user_id"

# تعليق تلقائي (المستوى التالي)
curl -X PUT https://matchhala.chathala.com/api/users/$USER_ID/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"duration": "auto", "reason": "اختبار التعليق التدريجي"}'
```

**النتيجة المتوقعة:**
```json
{
  "success": true,
  "message": "تم تعليق [الاسم] لمدة 24 ساعة (المستوى 1)",
  "data": {
    "user": {
      "suspension": {
        "isSuspended": true,
        "level": 1,
        "totalSuspensions": 1,
        "history": [{ "level": 1, "source": "admin", ... }]
      }
    }
  }
}
```

---

### اختبار 2: إلغاء التعليق + تعليق تاني (المستوى 2 — 48 ساعة)

```bash
# إلغاء التعليق
curl -X PUT https://matchhala.chathala.com/api/users/$USER_ID/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"duration": "unsuspend"}'

# تعليق مرة ثانية (auto = المستوى 2)
curl -X PUT https://matchhala.chathala.com/api/users/$USER_ID/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"duration": "auto", "reason": "اختبار المستوى الثاني"}'
```

**النتيجة المتوقعة:**
- المستوى = 2، المدة = 48 ساعة
- السجل = 2 إدخالات

---

### اختبار 3: التعليق التلقائي (5 بلاغات)

**الخطوة 1:** إلغاء التعليق أولاً
```bash
curl -X PUT https://matchhala.chathala.com/api/users/$USER_ID/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"duration": "unsuspend"}'
```

**الخطوة 2:** أرسل 5 بلاغات من 5 مستخدمين مختلفين
```bash
# كرر مع 5 توكنات مختلفة (USER_TOKEN_1 ... USER_TOKEN_5)
for i in 1 2 3 4 5; do
  curl -X POST https://matchhala.chathala.com/api/mobile/reports \
    -H "Authorization: Bearer $USER_TOKEN_$i" \
    -H "Content-Type: application/json" \
    -d "{\"reportedUser\": \"$USER_ID\", \"reason\": \"spam\", \"description\": \"اختبار بلاغ $i\"}"
  echo ""
done
```

**النتيجة المتوقعة:**
- بعد البلاغ الخامس → المستخدم يُعلّق تلقائياً
- المستوى = التالي بعد المستوى الحالي
- السجل يحتوي إدخال مع `source: "auto"`
- المستخدم المعلّق يتلقى إشعار push

---

### اختبار 4: فحص response التطبيق (iOS)

بعد تعليق المستخدم، أي طلب API منه يرجع:

```bash
curl -X GET https://matchhala.chathala.com/api/auth/me \
  -H "Authorization: Bearer $SUSPENDED_USER_TOKEN"
```

**النتيجة المتوقعة (403):**
```json
{
  "success": false,
  "message": "تم تعليق حسابك حتى 2026-04-03T08:00:00.000Z",
  "code": "ACCOUNT_SUSPENDED",
  "data": {
    "reason": "تعليق تلقائي - بلاغات متعددة من مستخدمين مختلفين",
    "suspendedUntil": "2026-04-03T08:00:00.000Z",
    "level": 3,
    "violationCount": 5
  }
}
```

---

### اختبار 5: endpoint عدد البلاغات

```bash
curl -X GET https://matchhala.chathala.com/api/users/$USER_ID/reports-count \
  -H "Authorization: Bearer $TOKEN"
```

**النتيجة المتوقعة:**
```json
{
  "success": true,
  "data": {
    "uniqueReporters": 5,
    "totalReports": 7,
    "pendingReports": 5,
    "autoSuspendThreshold": 5
  }
}
```

---

### اختبار 6: واجهة iOS

1. افتح التطبيق بحساب معلّق
2. تحقق من ظهور:
   - ✅ أيقونة القفل مع الدرع الأحمر
   - ✅ "تم تعليق حسابك"
   - ✅ "الحساب معلّق. متبقي X يوم"
   - ✅ بطاقة المعلومات (السبب + الرفع التلقائي + الشروط + عدد البلاغات)
   - ✅ الآية القرآنية
   - ✅ بطاقات التواصل (Instagram + Email)
   - ✅ زر "إعادة المحاولة" (مخفي للدائم)
3. انتظر حتى تنتهي المدة → اضغط "إعادة المحاولة"
4. تحقق من ظهور toast "مرحباً بعودتك!"

---

### اختبار 7: التدرج الكامل (Full Cycle)

| الخطوة | الإجراء | المستوى | المدة |
|--------|---------|---------|-------|
| 1 | تعليق auto | 1 | 24h |
| 2 | إلغاء + تعليق auto | 2 | 48h |
| 3 | إلغاء + تعليق auto | 3 | 3d |
| 4 | إلغاء + تعليق auto | 4 | 7d |
| 5 | إلغاء + تعليق auto | 5 | دائم |

- في المستوى 5: لا يظهر زر "إعادة المحاولة" في iOS
- في لوحة التحكم: يظهر تحذير "المستوى التالي دائم!"

---

## 4. Rollback (التراجع)

إذا حدثت مشكلة:
```bash
ssh root@72.61.102.206
cd /var/www/MatchHalaApi/backend
git revert HEAD
cd /var/www/MatchHalaApi
rsync -av --exclude='node_modules' --exclude='.env' --exclude='.git' --exclude='uploads' backend/ ./
pm2 restart matchhala-api
```

الحقول الجديدة في MongoDB لن تسبب مشاكل حتى لو تراجعت — الكود القديم يتجاهلها.
