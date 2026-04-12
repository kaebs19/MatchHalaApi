# Premium Features - API Documentation
# توثيق API الميزات المميزة

---

## 1. تحديث الموقع الجغرافي

```
PUT /api/mobile/users/location
Authorization: Bearer <token>
```

**المدخلات (Body):**
```json
{
    "latitude": 29.3759,
    "longitude": 47.9774
}
```

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم تحديث الموقع بنجاح"
}
```

**الأخطاء:**
- `400` — الإحداثيات مطلوبة أو غير صحيحة

---

## 2. البحث/الاكتشاف (مع الموقع)

```
GET /api/mobile/users/search?q=نور&gender=female&country=KW&latitude=29.37&longitude=47.97&maxDistance=50&page=1&limit=20
Authorization: Bearer <token>
```

**المدخلات (Query Params):**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| q | string | ❌ | بحث بالاسم (min 2 chars) |
| gender | string | ❌ | male / female |
| country | string | ❌ | كود الدولة (SA, AE, KW) |
| minAge | number | ❌ | أقل عمر |
| maxAge | number | ❌ | أكبر عمر |
| latitude | number | ❌ | خط العرض |
| longitude | number | ❌ | خط الطول |
| maxDistance | number | ❌ | أقصى مسافة بالكيلومتر (default: 50) |
| page | number | ❌ | الصفحة (default: 1) |
| limit | number | ❌ | العدد (default: 20) |

**المخرجات (200) — بدون موقع:**
```json
{
    "success": true,
    "data": {
        "users": [
            {
                "_id": "xxx",
                "name": "نور",
                "email": "noor@example.com",
                "profileImage": "/uploads/profile-images/...",
                "birthDate": "2000-01-01",
                "gender": "female",
                "country": "KW",
                "bio": "مرحبا",
                "isOnline": true,
                "lastLogin": "2026-02-25T10:00:00Z",
                "verification": { "isVerified": true },
                "isPremium": true
            }
        ],
        "page": 1,
        "totalPages": 5,
        "totalUsers": 100
    }
}
```

**المخرجات (200) — مع موقع:**
```json
{
    "success": true,
    "data": {
        "users": [
            {
                "_id": "xxx",
                "name": "نور",
                "profileImage": "...",
                "distance": 5200,
                "distanceLabel": "قريب منك",
                "verification": { "isVerified": true },
                "isPremium": true
            }
        ],
        "page": 1,
        "totalPages": 5,
        "totalUsers": 100
    }
}
```

**قيم distanceLabel:**
| المسافة | القيمة |
|---------|--------|
| أقل من 1 كم | "قريب جداً" |
| 1-10 كم | "قريب منك" |
| 10-50 كم | "في مدينتك" |
| 50-200 كم | "في منطقتك" |
| أكثر من 200 كم | "بعيد" |

---

## 3. تسجيل زيارة بروفايل

```
POST /api/mobile/profile-views
Authorization: Bearer <token>
```

**المدخلات (Body):**
```json
{
    "viewedUserId": "user_id_here"
}
```

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم تسجيل الزيارة"
}
```

**ملاحظات:**
- لا تسجل زيارة مكررة خلال 24 ساعة
- لا تسجل إذا الزائر في وضع التخفي (stealthMode)
- لا يمكن تسجيل زيارة لنفسك

---

## 4. من شاف بروفايلي

```
GET /api/mobile/profile-views?page=1&limit=20
Authorization: Bearer <token>
```

**المخرجات — مشترك Premium (200):**
```json
{
    "success": true,
    "data": {
        "totalViews": 15,
        "views": [
            {
                "viewer": {
                    "_id": "xxx",
                    "name": "سارة",
                    "profileImage": "https://halachat.khalafiati.io/uploads/...",
                    "country": "KW",
                    "isVerified": false
                },
                "createdAt": "2026-02-25T10:00:00Z"
            }
        ],
        "page": 1,
        "totalPages": 1,
        "isPremiumRequired": false
    }
}
```

**المخرجات — مستخدم مجاني (200):**
```json
{
    "success": true,
    "data": {
        "totalViews": 15,
        "views": [
            {
                "viewer": { "_id": null, "name": null, "profileImage": null, "country": null },
                "createdAt": "2026-02-25T10:00:00Z"
            }
        ],
        "page": 1,
        "totalPages": 1,
        "isPremiumRequired": true
    }
}
```

---

## 5. طلب توثيق الحساب (رفع سيلفي)

```
POST /api/mobile/verification/submit
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**يتطلب:** اشتراك Premium

**المدخلات (Form Data):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| selfie | file | ✅ | صورة سيلفي (JPEG, PNG) — max 5MB |

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم إرسال طلب التوثيق بنجاح",
    "data": { "status": "pending" }
}
```

**الأخطاء:**
- `403` — `{ "error": "premium_required" }` إذا غير مشترك
- `400` — إذا فيه طلب قيد المراجعة أو الصورة مفقودة

---

## 6. حالة التوثيق

```
GET /api/mobile/verification/status
Authorization: Bearer <token>
```

**المخرجات (200):**
```json
{
    "success": true,
    "data": {
        "isVerified": false,
        "status": "pending",
        "submittedAt": "2026-02-25T10:00:00Z",
        "reviewedAt": null
    }
}
```

**قيم status:** `none` | `pending` | `approved` | `rejected`

---

## 7. وضع التخفي (Stealth Mode)

```
PUT /api/mobile/users/stealth-mode
Authorization: Bearer <token>
```

**يتطلب:** اشتراك Premium

**المدخلات (Body):**
```json
{
    "enabled": true
}
```

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم تفعيل وضع التخفي",
    "data": { "stealthMode": true }
}
```

**التأثير:**
- لا تظهر في نتائج البحث/الاكتشاف
- لا تسجل زيارات البروفايل

---

## 8. إرسال Super Like

```
POST /api/mobile/super-like
Authorization: Bearer <token>
```

**المدخلات (Body):**
```json
{
    "userId": "target_user_id"
}
```

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم إرسال Super Like بنجاح",
    "data": {
        "remaining": 4,
        "max": 5
    }
}
```

**الأخطاء:**
- `429` — `{ "error": "super_like_limit_reached" }` وصلت الحد الأقصى

**الحدود اليومية:**
| النوع | الحد |
|-------|------|
| مجاني | 1 يومياً |
| Premium | 5 يومياً |

**Push Notification المُرسل:**
```json
{
    "title": "💎 إعجاب مميز!",
    "body": "{اسم المرسل} أرسل لك Super Like",
    "type": "super_like",
    "data": { "userId": "sender_id" }
}
```

---

## 9. المتبقي من Super Likes

```
GET /api/mobile/super-like/remaining
Authorization: Bearer <token>
```

**المخرجات (200):**
```json
{
    "success": true,
    "data": {
        "remaining": 3,
        "max": 5,
        "used": 2,
        "resetsAt": "2026-02-26T00:00:00Z"
    }
}
```

---

## 10. التحقق من الاشتراك (Apple Receipt)

```
POST /api/mobile/subscription/verify
Authorization: Bearer <token>
```

**المدخلات (Body):**
```json
{
    "receipt": "apple_receipt_data_base64",
    "plan": "monthly"
}
```

**قيم plan:** `weekly` | `monthly` | `quarterly`

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم تفعيل الاشتراك بنجاح",
    "data": {
        "isPremium": true,
        "plan": "monthly",
        "expiresAt": "2026-03-27T00:00:00Z"
    }
}
```

**مدة كل خطة:**
| الخطة | المدة |
|-------|-------|
| weekly | 7 أيام |
| monthly | 30 يوم |
| quarterly | 90 يوم |

---

## 11. طلبات المحادثة المعلقة (محدّث)

```
GET /api/mobile/conversations/pending
Authorization: Bearer <token>
```

**المخرجات (200):**
```json
{
    "success": true,
    "data": {
        "conversations": [
            {
                "_id": "conv_id",
                "creator": {
                    "_id": "user_id",
                    "name": "نور",
                    "email": "noor@example.com",
                    "profileImage": "...",
                    "isVerified": true
                },
                "isSuperLike": true,
                "status": "pending",
                "createdAt": "2026-02-25T10:00:00Z"
            }
        ]
    }
}
```

**ملاحظة:** الطلبات مع Super Like تظهر أولاً في الترتيب.

---

## Admin Endpoints

### 12. قائمة طلبات التوثيق (Admin)

```
GET /api/verifications?status=pending&page=1&limit=20
Authorization: Bearer <admin_token>
```

**المدخلات (Query):**
| Param | Values | Default |
|-------|--------|---------|
| status | all / pending / approved / rejected | pending |
| page | number | 1 |
| limit | number | 20 |

**المخرجات (200):**
```json
{
    "success": true,
    "data": {
        "users": [
            {
                "_id": "user_id",
                "name": "أحمد",
                "email": "ahmed@example.com",
                "profileImage": "...",
                "verification": {
                    "isVerified": false,
                    "selfieUrl": "/uploads/verifications/verify-xxx.jpg",
                    "status": "pending",
                    "submittedAt": "2026-02-25T10:00:00Z",
                    "reviewedAt": null
                },
                "isPremium": true,
                "premiumPlan": "monthly",
                "createdAt": "2026-02-01T..."
            }
        ],
        "stats": {
            "pending": 5,
            "approved": 20,
            "rejected": 3,
            "total": 28
        },
        "page": 1,
        "totalPages": 2,
        "total": 28
    }
}
```

### 13. قبول/رفض طلب التوثيق (Admin)

```
PUT /api/verifications/:userId
Authorization: Bearer <admin_token>
```

**المدخلات (Body):**
```json
{
    "action": "approved"
}
```

**قيم action:** `approved` | `rejected`

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم قبول طلب التوثيق",
    "data": {
        "userId": "user_id",
        "verification": {
            "isVerified": true,
            "status": "approved",
            "reviewedAt": "2026-02-25T12:00:00Z"
        }
    }
}
```

**Push Notification المُرسل للمستخدم:**
- قبول: `{ "title": "✅ تم توثيق حسابك!", "body": "تهانينا! تم توثيق حسابك بنجاح" }`
- رفض: `{ "title": "❌ طلب التوثيق مرفوض", "body": "عذراً، تم رفض طلب التوثيق. يمكنك المحاولة مرة أخرى" }`

### 14. قائمة المشتركين المميزين (Admin)

```
GET /api/users/premium?plan=monthly&expired=false&page=1&limit=20
Authorization: Bearer <admin_token>
```

**المدخلات (Query):**
| Param | Values | Default |
|-------|--------|---------|
| plan | weekly / monthly / quarterly | all |
| expired | true / false | all |
| page | number | 1 |
| limit | number | 20 |

**المخرجات (200):**
```json
{
    "success": true,
    "data": {
        "users": [...],
        "stats": {
            "total": 50,
            "active": 40,
            "expired": 10,
            "weekly": 5,
            "monthly": 30,
            "quarterly": 15
        },
        "page": 1,
        "totalPages": 3,
        "total": 50
    }
}
```

### 15. تعديل اشتراك يدوياً (Admin)

```
PUT /api/users/:id/premium
Authorization: Bearer <admin_token>
```

**المدخلات (Body):**
```json
{
    "isPremium": true,
    "premiumPlan": "monthly",
    "premiumExpiresAt": "2026-06-01T00:00:00Z"
}
```

**المخرجات (200):**
```json
{
    "success": true,
    "message": "تم تحديث الاشتراك بنجاح",
    "data": {
        "_id": "user_id",
        "name": "أحمد",
        "isPremium": true,
        "premiumPlan": "monthly",
        "premiumExpiresAt": "2026-06-01T00:00:00Z"
    }
}
```

---

## علامات المستخدم (Badges)

كل endpoint يرجع بيانات مستخدم يتضمن:

```json
{
    "isPremium": true,
    "verification": {
        "isVerified": true
    }
}
```

| العلامة | الحقل | الوصف |
|---------|-------|-------|
| 👑 Premium | `isPremium: true` | مشترك في خطة مدفوعة |
| ✅ Verified | `verification.isVerified: true` | حساب موثق بسيلفي |

هذه العلامات تظهر في:
- نتائج البحث/الاكتشاف
- رسائل الغرف (المرسل)
- أعضاء الغرفة المتصلين
- طلبات المحادثة
- قائمة المحادثات
- زيارات البروفايل

---

## Error Responses

جميع الأخطاء ترجع بنفس الشكل:

```json
{
    "success": false,
    "message": "وصف الخطأ بالعربي",
    "error": "error_code (اختياري)"
}
```

| HTTP Code | المعنى |
|-----------|--------|
| 400 | بيانات غير صحيحة |
| 401 | غير مسجل دخول |
| 403 | `premium_required` — يتطلب اشتراك |
| 404 | غير موجود |
| 429 | `super_like_limit_reached` — تجاوز الحد |
| 500 | خطأ في السيرفر |
