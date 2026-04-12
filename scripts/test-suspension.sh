#!/bin/bash
# ══════════════════════════════════════════════
# اختبار نظام التعليق التدريجي
# MatchHala API — Test Script
# ══════════════════════════════════════════════
#
# الاستخدام:
#   chmod +x scripts/test-suspension.sh
#   ./scripts/test-suspension.sh
#
# المتطلبات:
#   - curl, jq
#   - توكن أدمن صالح
#   - معرف مستخدم تجريبي
# ══════════════════════════════════════════════

set -e

# ─── الإعدادات ───
BASE_URL="${BASE_URL:-https://matchhala.chathala.com/api}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
TEST_USER_ID="${TEST_USER_ID:-}"

# ─── الألوان ───
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── التحقق من المتطلبات ───
check_requirements() {
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}❌ jq غير مثبّت. ثبّته: brew install jq${NC}"
        exit 1
    fi

    if [ -z "$ADMIN_TOKEN" ]; then
        echo -e "${YELLOW}⚠️  ADMIN_TOKEN غير محدد${NC}"
        read -p "أدخل توكن الأدمن: " ADMIN_TOKEN
    fi

    if [ -z "$TEST_USER_ID" ]; then
        echo -e "${YELLOW}⚠️  TEST_USER_ID غير محدد${NC}"
        read -p "أدخل معرف المستخدم التجريبي: " TEST_USER_ID
    fi
}

# ─── دالة مساعدة: طلب API ───
api_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local token=${4:-$ADMIN_TOKEN}

    if [ -n "$data" ]; then
        curl -s -X "$method" "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -X "$method" "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json"
    fi
}

# ─── طباعة فاصل ───
separator() {
    echo ""
    echo -e "${CYAN}══════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════${NC}"
    echo ""
}

# ─── اختبار 1: فحص الحالة الحالية ───
test_current_status() {
    separator "اختبار 1: فحص الحالة الحالية"

    echo -e "${YELLOW}→ جلب بيانات المستخدم...${NC}"
    local response=$(api_request GET "/users/$TEST_USER_ID/activity")

    local is_suspended=$(echo "$response" | jq -r '.data.user.suspension.isSuspended // false')
    local level=$(echo "$response" | jq -r '.data.user.suspension.level // 0')
    local total=$(echo "$response" | jq -r '.data.user.suspension.totalSuspensions // 0')
    local history_count=$(echo "$response" | jq -r '.data.user.suspension.history | length // 0')
    local name=$(echo "$response" | jq -r '.data.user.name // "غير معروف"')

    echo -e "  المستخدم: ${GREEN}$name${NC}"
    echo -e "  معلّق: $([ "$is_suspended" = "true" ] && echo -e "${RED}نعم${NC}" || echo -e "${GREEN}لا${NC}")"
    echo -e "  المستوى: ${YELLOW}$level / 5${NC}"
    echo -e "  إجمالي التعليقات: $total"
    echo -e "  سجل التعليقات: $history_count إدخال"

    # فحص البلاغات
    echo ""
    echo -e "${YELLOW}→ جلب عدد البلاغات...${NC}"
    local reports=$(api_request GET "/users/$TEST_USER_ID/reports-count")
    local unique=$(echo "$reports" | jq -r '.data.uniqueReporters // 0')
    local total_reports=$(echo "$reports" | jq -r '.data.totalReports // 0')
    local pending=$(echo "$reports" | jq -r '.data.pendingReports // 0')

    echo -e "  مبلّغين فريدين: ${YELLOW}$unique / 5${NC}"
    echo -e "  إجمالي البلاغات: $total_reports"
    echo -e "  معلّقة: $pending"

    echo -e "\n${GREEN}✅ اختبار 1 — تم${NC}"
}

# ─── اختبار 2: تعليق تلقائي (auto) ───
test_auto_suspend() {
    separator "اختبار 2: تعليق تلقائي (المستوى التالي)"

    # إلغاء التعليق أولاً إذا كان معلّق
    echo -e "${YELLOW}→ إلغاء التعليق (إن وُجد)...${NC}"
    api_request PUT "/users/$TEST_USER_ID/suspend" '{"duration": "unsuspend"}' > /dev/null 2>&1
    sleep 1

    echo -e "${YELLOW}→ تعليق تلقائي (auto)...${NC}"
    local response=$(api_request PUT "/users/$TEST_USER_ID/suspend" \
        '{"duration": "auto", "reason": "اختبار التعليق التدريجي", "source": "admin"}')

    local success=$(echo "$response" | jq -r '.success')
    local message=$(echo "$response" | jq -r '.message')
    local new_level=$(echo "$response" | jq -r '.data.user.suspension.level // 0')
    local total=$(echo "$response" | jq -r '.data.user.suspension.totalSuspensions // 0')

    if [ "$success" = "true" ]; then
        echo -e "  ${GREEN}✅ $message${NC}"
        echo -e "  المستوى الجديد: ${YELLOW}$new_level${NC}"
        echo -e "  إجمالي التعليقات: $total"
    else
        echo -e "  ${RED}❌ فشل: $message${NC}"
    fi

    echo -e "\n${GREEN}✅ اختبار 2 — تم${NC}"
}

# ─── اختبار 3: فحص response 403 ───
test_403_response() {
    separator "اختبار 3: فحص response 403 (من جهة التطبيق)"

    echo -e "${YELLOW}→ محاولة طلب API بتوكن المستخدم المعلّق...${NC}"
    echo -e "${YELLOW}  (يحتاج توكن المستخدم المعلّق — هذا الاختبار تقريبي)${NC}"

    # نستخدم توكن الأدمن لفحص حالة المستخدم
    local response=$(api_request GET "/users/$TEST_USER_ID/activity")
    local is_suspended=$(echo "$response" | jq -r '.data.user.suspension.isSuspended // false')
    local level=$(echo "$response" | jq -r '.data.user.suspension.level // 0')
    local until=$(echo "$response" | jq -r '.data.user.suspension.suspendedUntil // "null"')

    echo -e "  معلّق: $([ "$is_suspended" = "true" ] && echo -e "${RED}نعم${NC}" || echo -e "${GREEN}لا${NC}")"
    echo -e "  المستوى: ${YELLOW}$level${NC}"
    echo -e "  حتى: $until"

    if [ "$is_suspended" = "true" ]; then
        echo -e "\n  ${GREEN}✅ المستخدم معلّق — response 403 سيحتوي:${NC}"
        echo -e "    level: $level"
        echo -e "    suspendedUntil: $until"
        echo -e "    violationCount: (يُحسب ديناميكياً)"
    fi

    echo -e "\n${GREEN}✅ اختبار 3 — تم${NC}"
}

# ─── اختبار 4: إلغاء التعليق ───
test_unsuspend() {
    separator "اختبار 4: إلغاء التعليق"

    echo -e "${YELLOW}→ إلغاء التعليق...${NC}"
    local response=$(api_request PUT "/users/$TEST_USER_ID/suspend" '{"duration": "unsuspend"}')

    local success=$(echo "$response" | jq -r '.success')
    local message=$(echo "$response" | jq -r '.message')

    if [ "$success" = "true" ]; then
        echo -e "  ${GREEN}✅ $message${NC}"
    else
        echo -e "  ${RED}❌ فشل: $message${NC}"
    fi

    echo -e "\n${GREEN}✅ اختبار 4 — تم${NC}"
}

# ─── اختبار 5: دورة كاملة (5 مستويات) ───
test_full_cycle() {
    separator "اختبار 5: دورة كاملة (المستويات 1-5)"

    local levels=("24 ساعة" "48 ساعة" "3 أيام" "7 أيام" "دائم")

    for i in 1 2 3 4 5; do
        echo -e "${YELLOW}→ [$i/5] تعليق auto → المستوى $i (${levels[$i-1]})...${NC}"

        # إلغاء أولاً
        api_request PUT "/users/$TEST_USER_ID/suspend" '{"duration": "unsuspend"}' > /dev/null 2>&1
        sleep 0.5

        # تعليق
        local response=$(api_request PUT "/users/$TEST_USER_ID/suspend" \
            "{\"duration\": \"auto\", \"reason\": \"اختبار المستوى $i\"}")

        local new_level=$(echo "$response" | jq -r '.data.user.suspension.level // 0')
        local total=$(echo "$response" | jq -r '.data.user.suspension.totalSuspensions // 0')
        local until=$(echo "$response" | jq -r '.data.user.suspension.suspendedUntil // "دائم"')

        if [ "$new_level" = "$i" ]; then
            echo -e "  ${GREEN}✅ المستوى $new_level — حتى: $until — إجمالي: $total${NC}"
        else
            echo -e "  ${RED}❌ متوقع المستوى $i لكن حصلت على $new_level${NC}"
        fi
    done

    # إلغاء التعليق بعد الاختبار
    echo ""
    echo -e "${YELLOW}→ إلغاء التعليق بعد الاختبار...${NC}"
    api_request PUT "/users/$TEST_USER_ID/suspend" '{"duration": "unsuspend"}' > /dev/null 2>&1
    echo -e "${GREEN}✅ تم إلغاء التعليق${NC}"

    echo -e "\n${GREEN}✅ اختبار 5 — تم (الدورة الكاملة)${NC}"
}

# ─── اختبار 6: فحص سجل التعليقات ───
test_history() {
    separator "اختبار 6: فحص سجل التعليقات"

    local response=$(api_request GET "/users/$TEST_USER_ID/activity")
    local history=$(echo "$response" | jq -r '.data.user.suspension.history // []')
    local count=$(echo "$history" | jq 'length')

    echo -e "  عدد الإدخالات في السجل: ${YELLOW}$count${NC}"
    echo ""

    echo "$history" | jq -c '.[-5:] | .[]' 2>/dev/null | while read -r entry; do
        local level=$(echo "$entry" | jq -r '.level')
        local source=$(echo "$entry" | jq -r '.source // "admin"')
        local reason=$(echo "$entry" | jq -r '.reason // "—"')
        local date=$(echo "$entry" | jq -r '.suspendedAt // "—"')

        local source_icon="👤"
        [ "$source" = "auto" ] && source_icon="🤖"

        echo -e "  $source_icon المستوى $level | $source | $reason | $date"
    done

    echo -e "\n${GREEN}✅ اختبار 6 — تم${NC}"
}

# ─── القائمة الرئيسية ───
main() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   اختبار نظام التعليق التدريجي — MatchHala  ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""

    check_requirements

    echo ""
    echo -e "  الـ API:     $BASE_URL"
    echo -e "  المستخدم:   $TEST_USER_ID"
    echo ""
    echo -e "  اختر الاختبار:"
    echo -e "  ${CYAN}1${NC}) فحص الحالة الحالية"
    echo -e "  ${CYAN}2${NC}) تعليق تلقائي (المستوى التالي)"
    echo -e "  ${CYAN}3${NC}) فحص response 403"
    echo -e "  ${CYAN}4${NC}) إلغاء التعليق"
    echo -e "  ${CYAN}5${NC}) دورة كاملة (5 مستويات)"
    echo -e "  ${CYAN}6${NC}) فحص سجل التعليقات"
    echo -e "  ${CYAN}a${NC}) تشغيل الكل"
    echo -e "  ${CYAN}q${NC}) خروج"
    echo ""

    read -p "اختيارك: " choice

    case $choice in
        1) test_current_status ;;
        2) test_auto_suspend ;;
        3) test_403_response ;;
        4) test_unsuspend ;;
        5) test_full_cycle ;;
        6) test_history ;;
        a|A)
            test_current_status
            test_auto_suspend
            test_403_response
            test_unsuspend
            test_full_cycle
            test_history
            ;;
        q|Q) echo "👋"; exit 0 ;;
        *) echo -e "${RED}اختيار غير صالح${NC}"; exit 1 ;;
    esac

    echo ""
    echo -e "${GREEN}══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  انتهت الاختبارات بنجاح!${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════${NC}"
}

main
