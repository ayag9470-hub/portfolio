const mongoose = require('mongoose');

const ReplySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    sender: { type: String, enum: ['admin', 'customer'], default: 'admin' },
    senderName: { type: String, default: 'Eng. Aya Gabr', trim: true },
    message: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, default: 'Portfolio Inquiry', trim: true },
    message: { type: String, required: true, trim: true },
    threadToken: { type: String, trim: true, index: true },
    status: { type: String, enum: ['new', 'replied'], default: 'new' },
    replies: { type: [ReplySchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', MessageSchema);