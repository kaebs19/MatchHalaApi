// HalaChat Dashboard - Frontend Configuration
// ملف الإعدادات الموحد

const config = {
    // عنوان API
    API_URL: process.env.REACT_APP_API_URL || 'http://localhost:5001/api',

    // عنوان السيرفر الأساسي (للصور والملفات)
    SERVER_URL: process.env.REACT_APP_SERVER_URL || 'http://localhost:5001',

    // عنوان Socket.IO
    SOCKET_URL: process.env.REACT_APP_SOCKET_URL || 'http://localhost:5001'
};

// دالة مساعدة للحصول على رابط الصورة الكامل
export const getImageUrl = (imagePath) => {
    if (!imagePath || imagePath.trim() === '') return null;
    // تصحيح الدومين القديم
    if (imagePath.includes('halachat.com')) {
        return imagePath.replace('https://halachat.com', config.SERVER_URL);
    }
    if (imagePath.startsWith('http')) return imagePath;
    if (imagePath.startsWith('data:')) return imagePath; // Base64 images
    // إزالة أي slashes مكررة
    const cleanPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
    return `${config.SERVER_URL}${cleanPath}`;
};

// صورة افتراضية للمستخدم
export const getDefaultAvatar = (name) => {
    const initial = name?.charAt(0)?.toUpperCase() || 'U';
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect fill='%23667eea' width='100' height='100'/%3E%3Ctext fill='white' font-family='Arial' font-size='40' x='50%25' y='50%25' text-anchor='middle' dominant-baseline='central'%3E${initial}%3C/text%3E%3C/svg%3E`;
};

export default config;
