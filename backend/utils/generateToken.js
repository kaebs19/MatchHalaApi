// HalaChat Dashboard - JWT Token Generator
// دالة لتوليد Token للمصادقة

const jwt = require('jsonwebtoken');

const generateToken = (userId) => {
    return jwt.sign(
        { id: userId }, 
        process.env.JWT_SECRET, 
        {
            expiresIn: process.env.JWT_EXPIRE || '30d' // صلاحية Token (30 يوم افتراضياً)
        }
    );
};

module.exports = generateToken;
