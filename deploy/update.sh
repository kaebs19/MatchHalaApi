#!/bin/bash
# ==============================================
# HalaChat - Update Script
# سكربت تحديث التطبيق على السيرفر
#
# الاستخدام:
#   bash /var/www/HalaChat/deploy/update.sh           # تحديث كامل (backend + frontend)
#   bash /var/www/HalaChat/deploy/update.sh backend   # تحديث backend فقط
#   bash /var/www/HalaChat/deploy/update.sh frontend  # تحديث frontend فقط
#   bash /var/www/HalaChat/deploy/update.sh check     # فحص فقط بدون تحديث
#
# ملاحظة: البناء يتم محلياً ويُرفع على GitHub
#         السيرفر لا يستطيع البناء بسبب نقص الذاكرة
# ==============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="/var/www/HalaChat"
UPDATE_TYPE="${1:-all}"

echo ""
echo -e "${CYAN}=============================================="
echo "   HalaChat - Update Script"
echo "==============================================${NC}"
echo ""

# ------------------------------------------
# التحقق من المسار
# ------------------------------------------
if [ ! -d "$APP_DIR" ]; then
    echo -e "${RED}[ERROR]${NC} المجلد $APP_DIR غير موجود!"
    exit 1
fi

cd "$APP_DIR"

# ------------------------------------------
# وضع الفحص فقط
# ------------------------------------------
if [ "$UPDATE_TYPE" = "check" ]; then
    echo -e "${BLUE}[CHECK]${NC} فحص حالة التطبيق..."
    echo ""

    echo -e "${CYAN}── آخر 5 commits ──${NC}"
    git log --oneline -5
    echo ""

    echo -e "${CYAN}── حالة PM2 ──${NC}"
    pm2 status
    echo ""

    echo -e "${CYAN}── hash الفرونتند ──${NC}"
    ls frontend/build/static/js/main.*.js 2>/dev/null || echo "لا يوجد build"
    echo ""

    echo -e "${CYAN}── مسار nginx ──${NC}"
    grep -E "root |alias " /etc/nginx/sites-enabled/halachat 2>/dev/null || echo "ملف nginx غير موجود"
    echo ""

    echo -e "${CYAN}── هل يوجد تحديثات جديدة؟ ──${NC}"
    git fetch origin main --quiet
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo -e "${GREEN}✓ السيرفر محدّث — لا يوجد تحديثات جديدة${NC}"
    else
        echo -e "${YELLOW}⚠ يوجد تحديثات جديدة لم تُطبّق!${NC}"
        echo -e "  المحلي:  $LOCAL"
        echo -e "  الريموت: $REMOTE"
        echo ""
        echo "التحديثات الجديدة:"
        git log --oneline HEAD..origin/main
    fi
    echo ""
    exit 0
fi

# ------------------------------------------
# حفظ الحالة قبل التحديث
# ------------------------------------------
OLD_COMMIT=$(git rev-parse --short HEAD)
OLD_BUILD=$(ls frontend/build/static/js/main.*.js 2>/dev/null | head -1)

echo -e "${BLUE}[INFO]${NC} الحالة الحالية: commit ${OLD_COMMIT}"

# ------------------------------------------
# 1. سحب التحديثات من GitHub
# ------------------------------------------
echo -e "\n${BLUE}[1/4]${NC} سحب التحديثات من GitHub..."
git pull origin main

NEW_COMMIT=$(git rev-parse --short HEAD)
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    echo -e "${YELLOW}[INFO]${NC} لا يوجد تحديثات جديدة (commit ${NEW_COMMIT})"

    if [ "$UPDATE_TYPE" = "all" ]; then
        echo -e "${GREEN}[DONE]${NC} التطبيق محدّث بالفعل!"
        exit 0
    fi
fi

echo -e "${GREEN}[OK]${NC} تم التحديث: ${OLD_COMMIT} → ${NEW_COMMIT}"

# ------------------------------------------
# 2. تحديث Backend
# ------------------------------------------
if [ "$UPDATE_TYPE" = "all" ] || [ "$UPDATE_TYPE" = "backend" ]; then
    echo -e "\n${BLUE}[2/4]${NC} تثبيت تبعيات Backend..."
    cd "$APP_DIR/backend"
    npm install --production --quiet 2>/dev/null
    echo -e "${GREEN}[OK]${NC} تبعيات Backend محدّثة"
    cd "$APP_DIR"
fi

# ------------------------------------------
# 3. التحقق من Frontend build
# ------------------------------------------
if [ "$UPDATE_TYPE" = "all" ] || [ "$UPDATE_TYPE" = "frontend" ]; then
    echo -e "\n${BLUE}[3/4]${NC} التحقق من Frontend build..."
    NEW_BUILD=$(ls frontend/build/static/js/main.*.js 2>/dev/null | head -1)

    if [ ! -f "$NEW_BUILD" ]; then
        echo -e "${RED}[ERROR]${NC} لا يوجد build! تأكد من بناء الفرونتند محلياً ورفعه"
        echo "  على جهازك المحلي نفّذ:"
        echo "    cd frontend && npm run build && cd .."
        echo "    git add frontend/build/ && git commit -m 'rebuild frontend' && git push"
        exit 1
    fi

    if [ "$OLD_BUILD" != "$NEW_BUILD" ]; then
        echo -e "${GREEN}[OK]${NC} Frontend build جديد: $(basename $NEW_BUILD)"
    else
        echo -e "${YELLOW}[INFO]${NC} Frontend build لم يتغيّر: $(basename $NEW_BUILD)"
    fi
fi

# ------------------------------------------
# 4. إعادة تشغيل Backend
# ------------------------------------------
if [ "$UPDATE_TYPE" = "all" ] || [ "$UPDATE_TYPE" = "backend" ]; then
    echo -e "\n${BLUE}[4/4]${NC} إعادة تشغيل Backend..."
    pm2 restart halachat-api
    sleep 2

    # التحقق من أن التطبيق يعمل
    STATUS=$(pm2 jq 'halachat-api' 2>/dev/null | grep -o '"status":"[^"]*"' | head -1 || echo "")
    if pm2 show halachat-api | grep -q "online"; then
        echo -e "${GREEN}[OK]${NC} Backend يعمل بنجاح"
    else
        echo -e "${RED}[WARNING]${NC} تحقق من حالة Backend:"
        pm2 status
    fi
fi

# ------------------------------------------
# ملخص التحديث
# ------------------------------------------
echo ""
echo -e "${CYAN}=============================================="
echo -e "   ✅ التحديث اكتمل بنجاح!"
echo -e "==============================================${NC}"
echo ""
echo -e "   Commit: ${OLD_COMMIT} → ${GREEN}${NEW_COMMIT}${NC}"

NEW_BUILD_FILE=$(ls frontend/build/static/js/main.*.js 2>/dev/null | head -1)
if [ -n "$NEW_BUILD_FILE" ]; then
    echo -e "   Build:  $(basename $NEW_BUILD_FILE)"
fi

echo ""
pm2 status
echo ""
echo -e "${YELLOW}[TIP]${NC} للتحقق: bash $APP_DIR/deploy/update.sh check"
echo ""
