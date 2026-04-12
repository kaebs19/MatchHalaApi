// توليد HalaID لجميع المستخدمين اللي ما عندهم
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateId() {
    let id = 'HALA';
    for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return id;
}

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = await User.find({ $or: [{ halaId: null }, { halaId: { $exists: false } }] });
    console.log(`Found ${users.length} users without HalaID`);
    
    const existingIds = new Set((await User.find({ halaId: { $ne: null } }).select('halaId').lean()).map(u => u.halaId));
    let count = 0;
    
    for (const user of users) {
        let id;
        do { id = generateId(); } while (existingIds.has(id));
        existingIds.add(id);
        await User.updateOne({ _id: user._id }, { halaId: id });
        count++;
        if (count % 500 === 0) console.log(`Processed ${count}/${users.length}`);
    }
    
    console.log(`Done! Generated ${count} HalaIDs`);
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
