// HalaChat Dashboard - API Configuration
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
export const getAllUsers = async () => {
    const response = await api.get('/users');
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

// ============ Chat Rooms APIs ============

// الحصول على جميع غرف المحادثة (Admin)
export const getAllChatRooms = async (page = 1, limit = 20, filters = {}) => {
    const params = new URLSearchParams({ page, limit, ...filters });
    const response = await api.get(`/chat-rooms?${params}`);
    return response.data;
};

// الحصول على الغرف العامة (للمستخدمين)
export const getPublicChatRooms = async () => {
    const response = await api.get('/chat-rooms/public');
    return response.data;
};

// الحصول على غرفة واحدة
export const getChatRoom = async (roomId) => {
    const response = await api.get(`/chat-rooms/${roomId}`);
    return response.data;
};

// إنشاء غرفة جديدة
export const createChatRoom = async (roomData) => {
    const response = await api.post('/chat-rooms', roomData);
    return response.data;
};

// تحديث غرفة
export const updateChatRoom = async (roomId, roomData) => {
    const response = await api.put(`/chat-rooms/${roomId}`, roomData);
    return response.data;
};

// حذف غرفة
export const deleteChatRoom = async (roomId) => {
    const response = await api.delete(`/chat-rooms/${roomId}`);
    return response.data;
};

// حذف جميع رسائل الغرفة
export const deleteRoomMessages = async (roomId) => {
    const response = await api.delete(`/chat-rooms/${roomId}/messages`);
    return response.data;
};

// تفعيل/إلغاء تفعيل غرفة
export const toggleChatRoomActive = async (roomId) => {
    const response = await api.put(`/chat-rooms/${roomId}/toggle-active`);
    return response.data;
};

// قفل/فتح غرفة
export const toggleChatRoomLock = async (roomId) => {
    const response = await api.put(`/chat-rooms/${roomId}/toggle-lock`);
    return response.data;
};

// إحصائيات الغرفة
export const getChatRoomStats = async (roomId) => {
    const response = await api.get(`/chat-rooms/${roomId}/stats`);
    return response.data;
};

// رفع صورة الغرفة
export const uploadRoomImage = async (roomId, file) => {
    const formData = new FormData();
    formData.append('roomImage', file);

    const response = await api.post(`/chat-rooms/${roomId}/upload-image`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
    return response.data;
};

// جلب رسائل الغرفة
export const getRoomMessages = async (roomId, page = 1, limit = 50, search = '') => {
    const params = new URLSearchParams({ page, limit });
    if (search) params.append('search', search);
    const response = await api.get(`/chat-rooms/${roomId}/messages?${params}`);
    return response.data;
};

// جلب بلاغات الغرفة
export const getRoomReports = async (roomId) => {
    const response = await api.get(`/chat-rooms/${roomId}/reports`);
    return response.data;
};

// تثبيت إعلان في الغرفة
export const pinRoomMessage = async (roomId, content) => {
    const response = await api.put(`/chat-rooms/${roomId}/pin`, { content });
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

// ============ Banned Words APIs ============

// الحصول على جميع الكلمات المحظورة
export const getBannedWords = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.type) queryParams.append('type', params.type);
    if (params.isActive !== undefined) queryParams.append('isActive', params.isActive);
    const response = await api.get(`/banned-words?${queryParams}`);
    return response.data;
};

// إضافة كلمة محظورة
export const addBannedWord = async (wordData) => {
    const response = await api.post('/banned-words', wordData);
    return response.data;
};

// إضافة كلمات محظورة بالجملة
export const addBannedWordsBulk = async (words) => {
    const response = await api.post('/banned-words/bulk', { words });
    return response.data;
};

// تحديث كلمة محظورة
export const updateBannedWord = async (wordId, wordData) => {
    const response = await api.put(`/banned-words/${wordId}`, wordData);
    return response.data;
};

// حذف كلمة محظورة
export const deleteBannedWord = async (wordId) => {
    const response = await api.delete(`/banned-words/${wordId}`);
    return response.data;
};

// تفعيل/إلغاء تفعيل كلمة محظورة
export const toggleBannedWordActive = async (wordId) => {
    const response = await api.put(`/banned-words/${wordId}/toggle`);
    return response.data;
};

// فحص نص
export const checkBannedWords = async (text) => {
    const response = await api.post('/banned-words/check', { text });
    return response.data;
};

// إحصائيات الكلمات المحظورة
export const getBannedWordsStats = async () => {
    const response = await api.get('/banned-words/stats');
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

// ============ Flagged Messages (Admin) ============

export const getFlaggedMessages = async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);
    if (params.severity) queryParams.append('severity', params.severity);
    if (params.chatType) queryParams.append('chatType', params.chatType);
    const response = await api.get(`/stats/flagged-messages?${queryParams}`);
    return response.data;
};

export default api;
