// MatchHala Dashboard - API Configuration
// ملف الاتصال بالـ Backend API

import axios from 'axios';
import config from '../config';

// عنوان API
const API_URL = config.API_URL;

// إنشاء instance من axios
const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// إضافة Token تلقائياً لكل طلب
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// معالجة الأخطاء
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // إذا انتهت صلاحية Token، سجل خروج
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/';
        }
        return Promise.reject(error);
    }
);

// دوال API

// تسجيل دخول
export const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
};

// تسجيل مستخدم جديد
export const register = async (name, email, password) => {
    const response = await api.post('/auth/register', { name, email, password });
    return response.data;
};

// الحصول على بيانات المستخدم الحالي
export const getCurrentUser = async () => {
    const response = await api.get('/auth/me');
    return response.data;
};

// تحديث الملف الشخصي
export const updateProfile = async (name, email) => {
    const response = await api.put('/auth/update-profile', { name, email });
    return response.data;
};

// الحصول على إحصائيات Dashboard
export const getDashboardStats = async () => {
    const response = await api.get('/stats/dashboard');
    return response.data;
};

// الحصول على جميع المستخدمين (Admin فقط)
export const getAllUsers = async (page = 1, limit = 20, search = '', sort = 'createdAt', order = 'desc', filter = '') => {
    const params = new URLSearchParams({ page, limit, sort, order });
    if (search) params.append('search', search);
    if (filter) params.append('filter', filter);
    const response = await api.get('/users?' + params.toString());
    return response.data;
};

// حذف مستخدم (Admin فقط)
export const deleteUser = async (userId) => {
    const response = await api.delete(`/users/${userId}`);
    return response.data;
};

// تعديل بيانات مستخدم (Admin فقط)
export const updateUser = async (userId, userData) => {
    const response = await api.put(`/users/${userId}`, userData);
    return response.data;
};

// تفعيل/إلغاء تفعيل مستخدم (Admin فقط)
export const toggleUserActive = async (userId) => {
    const response = await api.put(`/users/${userId}/toggle-active`);
    return response.data;
};

// الحصول على نشاط مستخدم محدد (Admin فقط)
export const getUserActivity = async (userId) => {
    const response = await api.get(`/users/${userId}/activity`);
    return response.data;
};

// ============ Conversations APIs ============

// الحصول على جميع المحادثات
export const getAllConversations = async (page = 1, limit = 20, filters = {}) => {
    const params = new URLSearchParams({ page, limit, ...filters });
    const response = await api.get(`/conversations?${params}`);
    return response.data;
};

// الحصول على محادثة واحدة
export const getConversation = async (conversationId) => {
    const response = await api.get(`/conversations/${conversationId}`);
    return response.data;
};

// حذف محادثة
export const deleteConversation = async (conversationId) => {
    const response = await api.delete(`/conversations/${conversationId}`);
    return response.data;
};

// تفعيل/إلغاء تفعيل محادثة
export const toggleConversationActive = async (conversationId) => {
    const response = await api.put(`/conversations/${conversationId}/toggle-active`);
    return response.data;
};

// الحصول على إحصائيات المحادثات
export const getConversationsStats = async () => {
    const response = await api.get('/conversations/stats/overview');
    return response.data;
};

// إنشاء مجموعة جديدة
export const createGroup = async (groupData) => {
    const response = await api.post('/conversations/create-group', groupData);
    return response.data;
};

// قفل/فتح محادثة
export const lockConversation = async (conversationId) => {
    const response = await api.put(`/conversations/${conversationId}/lock`);
    return response.data;
};

// تحديث إعدادات محادثة
export const updateConversationSettings = async (conversationId, settings) => {
    const response = await api.put(`/conversations/${conversationId}/settings`, { settings });
    return response.data;
};

// حذف جميع رسائل المحادثة
export const deleteConversationMessages = async (conversationId) => {
    const response = await api.delete(`/conversations/${conversationId}/messages`);
    return response.data;
};

// الحصول على بلاغات المحادثة
export const getConversationReports = async (conversationId) => {
    const response = await api.get(`/conversations/${conversationId}/reports`);
    return response.data;
};

// ============ Reports APIs ============

// الحصول على جميع البلاغات
export const getAllReports = async (page = 1, limit = 20, filters = {}) => {
    const params = new URLSearchParams({ page, limit, ...filters });
    const response = await api.get(`/reports?${params}`);
    return response.data;
};

// الحصول على إحصائيات البلاغات
export const getReportsStats = async () => {
    const response = await api.get('/reports/stats');
    return response.data;
};

// الحصول على إحصائيات الاستئنافات (للـ badge)
export const getAppealsStats = async () => {
    const response = await api.get('/appeals/admin/stats');
    return response.data;
};

// ========== Newcomers (مراجعة الحسابات الجديدة) ==========
export const getNewcomers = async (status = 'review', page = 1, limit = 20) => {
    const params = new URLSearchParams({ status, page, limit });
    const response = await api.get(`/newcomers?${params}`);
    return response.data;
};

export const getNewcomersStats = async () => {
    const response = await api.get('/newcomers/stats');
    return response.data;
};

export const approveNewcomer = async (userId) => {
    const response = await api.post(`/newcomers/${userId}/approve`);
    return response.data;
};

export const rejectNewcomer = async (userId, reason) => {
    const response = await api.post(`/newcomers/${userId}/reject`, { reason });
    return response.data;
};

// ========== Sensitive Content (Phase 1.4) ==========
export const getSensitiveContentSettings = async () => {
    const response = await api.get('/settings/sensitive-content');
    return response.data;
};

export const updateSensitiveContentSettings = async (payload) => {
    const response = await api.put('/settings/sensitive-content', payload);
    return response.data;
};

export const getSensitiveContentStats = async (days = 30) => {
    const response = await api.get(`/settings/sensitive-content/stats?days=${days}`);
    return response.data;
};

export const getSensitiveContentReveals = async (page = 1, limit = 50, filters = {}) => {
    const params = new URLSearchParams({ page, limit });
    if (filters.category) params.append('category', filters.category);
    if (filters.userId) params.append('userId', filters.userId);
    const response = await api.get(`/settings/sensitive-content/reveals?${params}`);
    return response.data;
};

// الحصول على بلاغ واحد
export const getReport = async (reportId) => {
    const response = await api.get(`/reports/${reportId}`);
    return response.data;
};

// تحديث حالة البلاغ
export const updateReportStatus = async (reportId, status, reviewNotes = '') => {
    const response = await api.put(`/reports/${reportId}/status`, { status, reviewNotes });
    return response.data;
};

// ✅ إلغاء بلاغ + تنبيه المُبلِّغ
export const cancelReport = async (reportId, reason = '') => {
    const response = await api.post(`/reports/${reportId}/cancel`, { reason });
    return response.data;
};

// ✅ تصفير كل البلاغات المفتوحة على مستخدم + تنبيهه
export const clearUserReports = async (userId, { reason = '', includeResolved = false } = {}) => {
    const response = await api.post(`/users/${userId}/clear-reports`, { reason, includeResolved });
    return response.data;
};

// ✅ إخفاء/فك إخفاء حساب
export const hideUser = async (userId, { duration = '7d', reason = '' } = {}) => {
    const response = await api.post(`/users/${userId}/hide`, { duration, reason });
    return response.data;
};
export const unhideUser = async (userId) => {
    const response = await api.post(`/users/${userId}/unhide`);
    return response.data;
};

// اتخاذ إجراء على البلاغ
export const takeReportAction = async (reportId, action, reviewNotes = '') => {
    const response = await api.put(`/reports/${reportId}/action`, { action, reviewNotes });
    return response.data;
};

// تحديث أولوية البلاغ
export const updateReportPriority = async (reportId, priority) => {
    const response = await api.put(`/reports/${reportId}/priority`, { priority });
    return response.data;
};

// حذف بلاغ
export const deleteReport = async (reportId) => {
    const response = await api.delete(`/reports/${reportId}`);
    return response.data;
};
// ============ Reports Bulk & Analytics APIs ============

export const bulkUpdateReportStatus = async (ids, status) => {
    const response = await api.put('/reports/bulk-status', { ids, status });
    return response.data;
};

export const bulkDeleteReports = async (ids) => {
    const response = await api.delete('/reports/bulk-delete', { data: { ids } });
    return response.data;
};

export const resolveAllPendingReports = async () => {
    const response = await api.put('/reports/resolve-all-pending');
    return response.data;
};

export const getTopReported = async () => {
    const response = await api.get('/reports/top-reported');
    return response.data;
};

export const getTopReporters = async () => {
    const response = await api.get('/reports/top-reporters');
    return response.data;
};


// الحصول على تفاصيل محادثة واحدة
export const getConversationById = async (conversationId) => {
    const response = await api.get(`/conversations/${conversationId}`);
    return response.data;
};

// ========== Messages APIs ==========

// جلب رسائل محادثة
export const getConversationMessages = async (conversationId, page = 1, limit = 50, search = '') => {
    const params = new URLSearchParams({ page, limit });
    if (search) params.append('search', search);
    const response = await api.get(`/messages/conversation/${conversationId}?${params}`);
    return response.data;
};

// جلب رسالة واحدة
export const getMessage = async (messageId) => {
    const response = await api.get(`/messages/${messageId}`);
    return response.data;
};

// حذف رسالة (soft delete)
export const deleteMessage = async (messageId) => {
    const response = await api.delete(`/messages/${messageId}`);
    return response.data;
};

// حذف رسالة نهائياً
export const deleteMessagePermanent = async (messageId) => {
    const response = await api.delete(`/messages/${messageId}/permanent`);
    return response.data;
};

// إحصائيات رسائل محادثة
export const getMessagesStats = async (conversationId) => {
    const response = await api.get(`/messages/stats/${conversationId}`);
    return response.data;
};

// إرسال رسالة جديدة
export const sendMessage = async (conversationId, content, type = 'text') => {
    const response = await api.post('/messages/send', {
        conversationId,
        content,
        type
    });
    return response.data;
};

// ============ Settings APIs ============

// الحصول على الإعدادات
export const getSettings = async () => {
    const response = await api.get('/settings');
    return response.data;
};

// تحديث الإعدادات
export const updateSettings = async (settings) => {
    const response = await api.put('/settings', settings);
    return response.data;
};

// تحديث محتوى صفحة (privacy/terms/about)
export const updatePageContent = async (type, content) => {
    const response = await api.put(`/settings/content/${type}`, { content });
    return response.data;
};

// الحصول على سياسة الخصوصية
export const getPrivacyPolicy = async () => {
    const response = await api.get('/settings/privacy-policy');
    return response.data;
};

// الحصول على شروط الاستخدام
export const getTerms = async () => {
    const response = await api.get('/settings/terms');
    return response.data;
};

// الحصول على معلومات التطبيق
export const getAbout = async () => {
    const response = await api.get('/settings/about');
    return response.data;
};

// تغيير كلمة المرور
export const changePassword = async (currentPassword, newPassword) => {
    const response = await api.put('/auth/change-password', { currentPassword, newPassword });
    return response.data;
};

// رفع صورة الملف الشخصي
export const uploadProfileImage = async (file) => {
    const formData = new FormData();
    formData.append('profileImage', file);

    const response = await api.put('/auth/upload-profile-image', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
    return response.data;
};

// ============ Swipes APIs (Admin) ============

// إحصائيات Swipes
export const getSwipesStats = async () => {
    const response = await api.get('/swipes/stats');
    return response.data;
};

// قائمة Swipes
export const getSwipesList = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.type) queryParams.append('type', params.type);
    const response = await api.get(`/swipes/admin/list?${queryParams}`);
    return response.data;
};

// ============ Matches APIs (Admin) ============

// إحصائيات Matches
export const getMatchesStats = async () => {
    const response = await api.get('/matches/admin/stats');
    return response.data;
};

// قائمة Matches
export const getMatchesList = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.status) queryParams.append('status', params.status);
    const response = await api.get(`/matches/admin/list?${queryParams}`);
    return response.data;
};

// ============ Notifications APIs ============

// الحصول على الإشعارات
export const getNotifications = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.unreadOnly) queryParams.append('unreadOnly', params.unreadOnly);
    const response = await api.get(`/notifications?${queryParams}`);
    return response.data;
};

// تحديد إشعار كمقروء
export const markNotificationAsRead = async (notificationId) => {
    const response = await api.put(`/notifications/${notificationId}/read`);
    return response.data;
};

// تحديد جميع الإشعارات كمقروءة
export const markAllNotificationsAsRead = async () => {
    const response = await api.put('/notifications/read-all');
    return response.data;
};

// حذف إشعار
export const deleteNotification = async (notificationId) => {
    const response = await api.delete(`/notifications/${notificationId}`);
    return response.data;
};


// ============ طلبات التوثيق (Admin) ============

export const getVerificationRequests = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    const response = await api.get(`/verifications?${queryParams}`);
    return response.data;
};

export const reviewVerification = async (userId, action) => {
    const response = await api.put(`/verifications/${userId}`, { action });
    return response.data;
};

// ============ المستخدمين المميزين (Admin) ============

export const getPremiumUsers = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.plan) queryParams.append('plan', params.plan);
    if (params.expired !== undefined) queryParams.append('expired', params.expired);
    if (params.expiringSoon !== undefined) queryParams.append('expiringSoon', params.expiringSoon);
    if (params.signupPeriod) queryParams.append('signupPeriod', params.signupPeriod);
    if (params.search) queryParams.append('search', params.search);
    if (params.sort) queryParams.append('sort', params.sort);
    const response = await api.get(`/users/premium?${queryParams}`);
    return response.data;
};

export const updateUserPremium = async (userId, premiumData) => {
    const response = await api.put(`/users/${userId}/premium`, premiumData);
    return response.data;
};

// ============ Super Likes (Admin) ============

export const getSuperLikes = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.startDate) queryParams.append('startDate', params.startDate);
    if (params.endDate) queryParams.append('endDate', params.endDate);
    const response = await api.get(`/stats/super-likes?${queryParams}`);
    return response.data;
};

// ============ Analytics APIs (Admin) ============

export const getAnalytics = async () => {
    const response = await api.get('/stats/analytics');
    return response.data;
};

export const getUserLocations = async () => {
    const response = await api.get('/stats/user-locations');
    return response.data;
};

// ============ ✅ إدارة المستخدمين المتقدمة ============

// تعليق مستخدم
export const suspendUser = async (userId, duration, reason, notify = true) => {
    const response = await api.put(`/users/${userId}/suspend`, { duration, reason, notify });
    return response.data;
};

// إلغاء تعليق مستخدم
export const unsuspendUser = async (userId) => {
    const response = await api.put(`/users/${userId}/suspend`, { duration: 'unsuspend' });
    return response.data;
};

// عدد البلاغات ضد مستخدم
export const getUserReportsCount = async (userId) => {
    const response = await api.get(`/users/${userId}/reports-count`);
    return response.data;
};

// تحديد مخالفات المستخدم
export const setUserViolations = async (userId, violations) => {
    const response = await api.put(`/users/${userId}/violations`, { violations });
    return response.data;
};

// حظر/إلغاء حظر مستخدم
export const banUser = async (userId, reason) => {
    const response = await api.put(`/users/${userId}/ban`, { reason });
    return response.data;
};

// إجراء على اسم المستخدم (suspend/ban/restore/change)
export const userNameAction = async (userId, action, reason, newName) => {
    const response = await api.put(`/users/${userId}/name-action`, { action, reason, newName, notify: true });
    return response.data;
};

// 📜 سجل تغييرات الاسم — Audit Log
export const getUserNameHistory = async (userId, limit = 50) => {
    const response = await api.get(`/users/${userId}/name-history`, { params: { limit } });
    return response.data;
};

// استبدال/تعيين الصورة الشخصية لمستخدم من لوحة التحكم + إشعاره
export const uploadUserProfileImage = async (userId, file, reason = '', notify = true) => {
    const formData = new FormData();
    formData.append('profileImage', file);
    formData.append('reason', reason);
    formData.append('notify', notify ? 'true' : 'false');

    const response = await api.put(`/users/${userId}/profile-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

// حذف صورة مستخدم
export const deleteUserPhoto = async (userId, photoIndex, reason) => {
    const response = await api.delete(`/users/${userId}/photo`, {
        data: { photoIndex, reason, notify: true }
    });
    return response.data;
};

// إرسال إشعار لمستخدم بالبريد/الاسم/المعرف
export const sendUserNotification = async (title, body, identifier, identifierType = 'id', type = 'system') => {
    const response = await api.post('/users/send-notification', { title, body, identifier, identifierType, type });
    return response.data;
};

// بحث مستخدمين
export const searchUsers = async (query, type = 'auto') => {
    const response = await api.post('/users/search', { query, type });
    return response.data;
};

// منع مستخدم من تغيير الصورة/الاسم
export const restrictUser = async (userId, type, duration, reason) => {
    const response = await api.put(`/users/${userId}/restrict`, { type, duration, reason });
    return response.data;
};

// ✅ منح/سحب شارة VIP (X)
export const setVipBadge = async (userId, grant, note) => {
    const response = await api.put(`/users/${userId}/vip-badge`, { grant, note });
    return response.data;
};

// ============ ✅ التحكم بالإصدارات ============

// الحصول على إعدادات الإصدار
export const getVersionControl = async () => {
    const response = await api.get('/settings/version-control');
    return response.data;
};

// تحديث إعدادات الإصدار
export const updateVersionControl = async (settings) => {
    const response = await api.put('/settings/version-control', settings);
    return response.data;
};

// ============ ✅ الأسماء المحظورة ============

// الحصول على الأسماء المحظورة
export const getBannedNames = async () => {
    const response = await api.get('/settings/banned-names');
    return response.data;
};

// إضافة أسماء محظورة
export const addBannedNames = async (names, reason) => {
    const response = await api.post('/settings/banned-names', { names, reason });
    return response.data;
};

// حذف اسم محظور
export const deleteBannedName = async (name) => {
    const response = await api.delete(`/settings/banned-names/${encodeURIComponent(name)}`);
    return response.data;
};

// تحديث حد المخالفات
export const updateMaxViolations = async (maxViolations) => {
    const response = await api.put('/settings/max-violations', { maxViolations });
    return response.data;
};

// إضافة أسماء مشهورة محظورة (seed)
export const seedBannedNames = async () => {
    const response = await api.post('/settings/banned-names/seed');
    return response.data;
};


// ✅ إلغاء تقييد المستخدم
export const unrestrictUser = async (userId) => {
    const response = await api.delete("/users/" + userId + "/restrict");
    return response.data;
};

export default api;

// إجراء على نبذة المستخدم (ban/restore)
export const userBioAction = async (userId, action, reason) => {
    const response = await api.put(`/users/${userId}/bio-action`, { action, reason });
    return response.data;
};

// ✅ تعديل نبذة المستخدم مباشرة (admin)
export const editUserBio = async (userId, bio) => {
    const response = await api.put(`/users/${userId}/bio`, { bio });
    return response.data;
};


// ============ Banned Devices APIs ============

export const getBannedDevices = async (params = {}) => {
    const response = await api.get('/users/banned-devices/list', { params });
    return response.data;
};

export const unbanDevice = async (userId) => {
    const response = await api.delete('/users/' + userId + '/unban-device');
    return response.data;
};

// ✅ فك حظر جماعي — auto: التلقائي فقط | all: كل الأجهزة المحظورة
export const unbanBulkDevices = async (source = 'auto') => {
    const response = await api.post('/users/banned-devices/unban-bulk', { source });
    return response.data;
};

// ✅ فك حظر الأجهزة الضوضائية (collision-only) — dryRun لمعاينة العدد قبل التنفيذ
export const unbanNoisyDevices = async ({ dryRun = false } = {}) => {
    const response = await api.post('/users/banned-devices/unban-noisy', { dryRun });
    return response.data;
};

// ============ Violations APIs ============

export const getUserViolations = async (userId, params = {}) => {
    const response = await api.get(`/users/${userId}/violations`, { params });
    return response.data;
};

export const getRecentViolations = async (params = {}) => {
    const response = await api.get('/users/violations/recent', { params });
    return response.data;
};

// ============ Related Accounts APIs ============

export const getRelatedAccounts = async (userId) => {
    const response = await api.get(`/users/${userId}/related-accounts`);
    return response.data;
};

// ============ Official Warnings APIs ============

export const getWarningTemplates = async () => {
    const response = await api.get('/users/tools/warning-templates');
    return response.data;
};

export const getUserWarnings = async (userId, params = {}) => {
    const response = await api.get(`/users/${userId}/warnings`, { params });
    return response.data;
};

export const sendOfficialWarning = async (userId, payload) => {
    const response = await api.post(`/users/${userId}/official-warning`, payload);
    return response.data;
};

export const dismissWarning = async (warningId) => {
    const response = await api.put(`/users/warnings/${warningId}/dismiss`);
    return response.data;
};

// Helper: رابط كامل لصورة دليل مخالفة (يحتاج auth — يُستخدم داخل <img src>)
// ملاحظة: <img> العادي لا يرسل token، لذا نستخدم blob fetch + object URL
export const fetchViolationEvidenceBlob = async (userId, filename) => {
    const response = await api.get(`/users/${userId}/violation-evidence/${filename}`, {
        responseType: 'blob'
    });
    return URL.createObjectURL(response.data);
};

// ============ Conversations/Messages Management ============

/// حذف جميع محادثات المستخدم + رسائلها (admin)
export const deleteAllUserConversations = async (userId) => {
    const response = await api.delete(`/users/${userId}/conversations/bulk`);
    return response.data;
};

/// حذف رسالة فردية (admin)
export const deleteUserMessage = async (userId, messageId) => {
    const response = await api.delete(`/users/${userId}/messages/${messageId}`);
    return response.data;
};

/// تشفير رسائل المستخدم كنجوم (admin)
/// scope: 'all' = كل المحادثات، 'sent' = فقط الرسائل التي أرسلها هذا المستخدم
export const censorUserMessages = async (userId, scope = 'all') => {
    const response = await api.put(`/users/${userId}/conversations/censor`, { scope });
    return response.data;
};
