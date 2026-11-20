const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri || uri.includes('USERNAME:PASSWORD')) {
    console.log('ℹ️  No live MONGO_URI configured yet — running API with local JSON storage fallback.');
    isConnected = false;
    return false;
  }

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log('✅ Connected to MongoDB successfully');
    return true;
  } catch (err) {
    console.warn('⚠️  MongoDB connection failed, using local JSON fallback:', err.message);
    isConnected = false;
    return false;
  }
}

function getDBStatus() {
  return isConnected || mongoose.connection.readyState === 1;
}

module.exports = { connectDB, getDBStatus };
