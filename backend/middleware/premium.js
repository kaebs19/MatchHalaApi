// HalaChat - Premium Middleware
// التحقق من اشتراك المستخدم المميز

const requirePremium = (req, res, next) => {
    if (!req.user.isPremium || !req.user.premiumExpiresAt || req.user.premiumExpiresAt < new Date()) {
        return res.status(403).json({
            success: false,
            error: 'premium_required',
            message: 'هذه الميزة تتطلب اشتراك مميز'
        });
    }
    next();
};

module.exports = { requirePremium };
