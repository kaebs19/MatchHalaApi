#!/bin/bash
# ==============================================
# HalaChat - First-Time Deploy Script
# سكربت النشر الأولي على سيرفر جديد
#
# المتطلبات:
#   - Node.js 18+
#   - PM2 (npm install -g pm2)
#   - Nginx
#   - Git
#
# الاستخدام:
#   git clone <repo-url> /var/www/HalaChat
#   bash /var/www/HalaChat/deploy/deploy.sh
#
# ملاحظة: البناء يتم محلياً ويُرفع على GitHub
#         السيرفر لا يحتاج npm run build
# ==============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_step() {
    echo -e "\n${BLUE}[STEP]${NC} $1"
    echo "=============================================="
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

APP_DIR="/var/www/HalaChat"
DOMAIN="halachat.khalafiati.io"

echo ""
echo -e "${CYAN}=============================================="
echo "   HalaChat - First-Time Deployment"
echo "==============================================${NC}"
echo ""

# ------------------------------------------
# التحقق من المتطلبات
# ------------------------------------------
print_step "0/6 - التحقق من المتطلبات..."

if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Node.js غير مثبّت! ثبّته أولاً"
    exit 1
fi

if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}[INFO]${NC} تثبيت PM2..."
    npm install -g pm2
fi

if ! command -v nginx &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Nginx غير مثبّت! ثبّته أولاً"
    exit 1
fi

print_success "المتطلبات متوفرة: Node $(node -v), PM2, Nginx"

# ------------------------------------------
# 1. إعداد Backend Environment
# ------------------------------------------
print_step "1/6 - إعداد ملف .env للـ Backend..."
if [ ! -f "$APP_DIR/backend/.env" ]; then
    if [ -f "$APP_DIR/deploy/env.production" ]; then
        cp "$APP_DIR/deploy/env.production" "$APP_DIR/backend/.env"
        print_success "تم إنشاء Backend .env"
        print_warning "مهم: عدّل $APP_DIR/backend/.env وغيّر JWT_SECRET!"
    else
        echo -e "${RED}[ERROR]${NC} ملف env.production غير موجود! أنشئ backend/.env يدوياً"
        exit 1
    fi
else
    print_warning "Backend .env موجود بالفعل، تم التخطي"
fi

# ------------------------------------------
# 2. إعداد Frontend Environment
# ------------------------------------------
print_step "2/6 - إعداد ملف .env للـ Frontend..."
if [ -f "$APP_DIR/deploy/env.frontend" ]; then
    cp "$APP_DIR/deploy/env.frontend" "$APP_DIR/frontend/.env"
    print_success "تم إنشاء Frontend .env"
else
    print_warning "ملف env.frontend غير موجود، تم التخطي"
fi

# ------------------------------------------
# 3. تثبيت تبعيات Backend
# ------------------------------------------
print_step "3/6 - تثبيت تبعيات Backend..."
cd "$APP_DIR/backend"
npm install --production
print_success "تم تثبيت تبعيات Backend"

# ------------------------------------------
# 4. التحقق من Frontend Build
# ------------------------------------------
print_step "4/6 - التحقق من Frontend Build..."
if [ -f "$APP_DIR/frontend/build/index.html" ]; then
    BUILD_FILE=$(ls "$APP_DIR/frontend/build/static/js/main.*.js" 2>/dev/null | head -1)
    print_success "Frontend build موجود: $(basename $BUILD_FILE)"
else
    echo -e "${RED}[ERROR]${NC} لا يوجد Frontend build!"
    echo "  البناء يتم على جهازك المحلي (السيرفر لا يملك ذاكرة كافية):"
    echo "    cd frontend && npm run build && cd .."
    echo "    git add frontend/build/ && git commit -m 'build frontend' && git push"
    echo "  ثم على السيرفر: git pull origin main"
    exit 1
fi

# ------------------------------------------
# 5. إعداد Nginx
# ------------------------------------------
print_step "5/6 - إعداد Nginx..."
cp "$APP_DIR/deploy/nginx-halachat.conf" /etc/nginx/sites-available/halachat

# إنشاء symlink (وليس نسخة!) في sites-enabled
ln -sf /etc/nginx/sites-available/halachat /etc/nginx/sites-enabled/halachat

# حذف الموقع الافتراضي
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# فحص وتحميل
nginx -t
systemctl reload nginx
print_success "Nginx مُعدّ بشكل صحيح (symlink في sites-enabled)"

# التحقق أن sites-enabled هو symlink
if [ -L /etc/nginx/sites-enabled/halachat ]; then
    print_success "sites-enabled/halachat = symlink ✓"
else
    print_warning "sites-enabled/halachat ليس symlink! قد يسبب مشاكل مستقبلاً"
fi

# ------------------------------------------
# 6. تشغيل Backend بـ PM2
# ------------------------------------------
print_step "6/6 - تشغيل Backend بـ PM2..."
cd "$APP_DIR"

# إنشاء مجلد logs
mkdir -p /var/log/halachat

# إنشاء مجلد uploads
mkdir -p "$APP_DIR/backend/uploads"
chmod 755 "$APP_DIR/backend/uploads"

# إيقاف أي نسخة سابقة
pm2 delete halachat-api 2>/dev/null || true

# تشغيل
pm2 start deploy/ecosystem.config.js

# حفظ قائمة PM2 لإعادة التشغيل التلقائي
pm2 save

# إعداد التشغيل التلقائي عند إعادة تشغيل السيرفر
pm2 startup systemd -u root --hp /root 2>/dev/null || true

print_success "Backend يعمل بـ PM2"

# ------------------------------------------
# ملخص
# ------------------------------------------
echo ""
echo -e "${CYAN}=============================================="
echo -e "${GREEN}   ✅ النشر اكتمل بنجاح!"
echo -e "${CYAN}==============================================${NC}"
echo ""
echo "   🌐 Frontend: https://$DOMAIN"
echo "   🔗 API:      https://$DOMAIN/api"
echo "   💚 Health:   https://$DOMAIN/api/health"
echo ""
echo "   📋 أوامر مفيدة:"
echo "   pm2 status                              # حالة التطبيق"
echo "   pm2 logs halachat-api                    # سجلات التطبيق"
echo "   bash $APP_DIR/deploy/update.sh           # تحديث التطبيق"
echo "   bash $APP_DIR/deploy/update.sh check     # فحص الحالة"
echo ""
echo "   🔒 لتفعيل SSL:"
echo "   certbot --nginx -d $DOMAIN"
echo ""
echo -e "${CYAN}==============================================${NC}"

# عرض حالة PM2
pm2 status
