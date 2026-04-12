require('dotenv').config();
const mongoose = require('mongoose');
const Interest = require('./models/Interest');
const defaults = [
  { key: 'football', nameAr: 'كرة القدم', nameEn: 'Football', emoji: '⚽', category: 'sports', order: 1 },
  { key: 'swimming', nameAr: 'السباحة', nameEn: 'Swimming', emoji: '🏊', category: 'sports', order: 2 },
  { key: 'fitness', nameAr: 'اللياقة البدنية', nameEn: 'Fitness', emoji: '💪', category: 'sports', order: 3 },
  { key: 'basketball', nameAr: 'كرة السلة', nameEn: 'Basketball', emoji: '🏀', category: 'sports', order: 4 },
  { key: 'running', nameAr: 'الجري', nameEn: 'Running', emoji: '🏃', category: 'sports', order: 5 },
  { key: 'hiking', nameAr: 'المشي والتسلق', nameEn: 'Hiking', emoji: '🥾', category: 'sports', order: 6 },
  { key: 'yoga', nameAr: 'يوغا', nameEn: 'Yoga', emoji: '🧘', category: 'sports', order: 7 },
  { key: 'movies', nameAr: 'الأفلام والمسلسلات', nameEn: 'Movies & Series', emoji: '🎬', category: 'entertainment', order: 10 },
  { key: 'gaming', nameAr: 'الألعاب الإلكترونية', nameEn: 'Gaming', emoji: '🎮', category: 'entertainment', order: 11 },
  { key: 'music', nameAr: 'الموسيقى', nameEn: 'Music', emoji: '🎵', category: 'entertainment', order: 12 },
  { key: 'reading', nameAr: 'القراءة', nameEn: 'Reading', emoji: '📚', category: 'entertainment', order: 13 },
  { key: 'dancing', nameAr: 'الرقص', nameEn: 'Dancing', emoji: '💃', category: 'entertainment', order: 14 },
  { key: 'travel', nameAr: 'السفر والسياحة', nameEn: 'Travel', emoji: '✈️', category: 'lifestyle', order: 20 },
  { key: 'nightlife', nameAr: 'السهر والحياة الليلية', nameEn: 'Nightlife', emoji: '🌙', category: 'lifestyle', order: 21 },
  { key: 'shopping', nameAr: 'التسوق', nameEn: 'Shopping', emoji: '🛍️', category: 'lifestyle', order: 22 },
  { key: 'fashion', nameAr: 'الموضة والأزياء', nameEn: 'Fashion', emoji: '👗', category: 'lifestyle', order: 23 },
  { key: 'nature', nameAr: 'الطبيعة', nameEn: 'Nature', emoji: '🌿', category: 'lifestyle', order: 24 },
  { key: 'pets', nameAr: 'الحيوانات الأليفة', nameEn: 'Pets', emoji: '🐾', category: 'lifestyle', order: 25 },
  { key: 'chat', nameAr: 'الدردشة والتعارف', nameEn: 'Chat & Connect', emoji: '💬', category: 'social', order: 30 },
  { key: 'relationships', nameAr: 'العلاقات الجدية', nameEn: 'Relationships', emoji: '❤️', category: 'social', order: 31 },
  { key: 'friendship', nameAr: 'صداقات جديدة', nameEn: 'New Friends', emoji: '🤝', category: 'social', order: 32 },
  { key: 'photography', nameAr: 'التصوير', nameEn: 'Photography', emoji: '📸', category: 'creative', order: 40 },
  { key: 'art', nameAr: 'الفن والرسم', nameEn: 'Art & Drawing', emoji: '🎨', category: 'creative', order: 41 },
  { key: 'writing', nameAr: 'الكتابة', nameEn: 'Writing', emoji: '✍️', category: 'creative', order: 42 },
  { key: 'cooking', nameAr: 'الطبخ', nameEn: 'Cooking', emoji: '🍳', category: 'food', order: 50 },
  { key: 'coffee', nameAr: 'القهوة', nameEn: 'Coffee', emoji: '☕', category: 'food', order: 51 },
  { key: 'food', nameAr: 'تجربة المطاعم', nameEn: 'Food & Dining', emoji: '🍕', category: 'food', order: 52 },
  { key: 'tech', nameAr: 'التقنية', nameEn: 'Technology', emoji: '💻', category: 'tech', order: 60 },
  { key: 'ai', nameAr: 'الذكاء الاصطناعي', nameEn: 'AI & Tech', emoji: '🤖', category: 'tech', order: 61 },
];
async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected');
    let added = 0;
    for (const item of defaults) {
      const exists = await Interest.findOne({ key: item.key });
      if (!exists) { await Interest.create(item); added++; console.log('+ ' + item.emoji + ' ' + item.nameEn); }
      else { console.log('= ' + item.nameEn + ' exists'); }
    }
    const total = await Interest.countDocuments();
    console.log('Done! Added: ' + added + ', Total: ' + total);
    process.exit(0);
  } catch (err) { console.error('Error:', err.message); process.exit(1); }
}
seed();
