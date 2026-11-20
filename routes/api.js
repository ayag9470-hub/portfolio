const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const Project = require('../models/Project');
const Message = require('../models/Message');
const { getDBStatus } = require('../config/db');

const seedProjectsPath = path.join(__dirname, '../data/projects.json');
const messagesFilePath = path.join(__dirname, '../data/messages.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'aya-admin-2026';
const MESSAGE_ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || 'aya-secret-msg-key-2026';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(MESSAGE_ENCRYPTION_KEY)).digest();

function emitSocketEvent(req, eventName, payload, rooms = []) {
  const io = req.app?.get('io');
  if (!io) return;

  if (Array.isArray(rooms) && rooms.length > 0) {
    rooms.forEach((room) => {
      if (room) io.to(room).emit(eventName, payload);
    });
  } else {
    io.emit(eventName, payload);
  }
}

function readSeedProjects() {
  return JSON.parse(fs.readFileSync(seedProjectsPath, 'utf-8'));
}

function writeSeedProjects(data) {
  fs.writeFileSync(seedProjectsPath, JSON.stringify(data, null, 2));
}

function readLocalMessages() {
  if (!fs.existsSync(messagesFilePath)) return [];
  return JSON.parse(fs.readFileSync(messagesFilePath, 'utf-8'));
}

function writeLocalMessages(data) {
  fs.writeFileSync(messagesFilePath, JSON.stringify(data, null, 2));
}

function encryptText(plainText) {
  const text = String(plainText ?? '');
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `enc:${iv.toString('hex')}:${encrypted}`;
}

function decryptText(cipherText) {
  const text = String(cipherText ?? '');
  if (!text.startsWith('enc:')) return text;

  try {
    const parts = text.split(':');
    if (parts.length !== 3) return text;
    const iv = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return text;
  }
}

function formatMessageForResponse(docOrObj) {
  const plain = typeof docOrObj?.toObject === 'function' ? docOrObj.toObject() : { ...docOrObj };
  const replies = Array.isArray(plain.replies)
    ? plain.replies.map((rep) => ({
        ...rep,
        message: decryptText(rep.message)
      }))
    : [];

  return {
    ...plain,
    message: decryptText(plain.message),
    replies
  };
}

function isAdminRequest(req) {
  const providedKey = req.headers['x-admin-key'] || req.query.adminKey;
  return Boolean(providedKey && String(providedKey) === String(ADMIN_KEY));
}

function createThreadToken(email, messageId) {
  return crypto
    .createHmac('sha256', ADMIN_KEY)
    .update(`${String(email).toLowerCase().trim()}:${String(messageId)}`)
    .digest('hex')
    .slice(0, 16);
}

// GET /api/status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    apiOnline: true,
    databaseConnected: getDBStatus(),
    storageMode: getDBStatus() ? 'MongoDB (Mongoose)' : 'Local JSON Fallback'
  });
});

// GET /api/projects
router.get('/projects', async (req, res) => {
  try {
    if (getDBStatus()) {
      let dbProjects = await Project.find().sort({ createdAt: 1 });
      if (dbProjects.length === 0) {
        const seedData = readSeedProjects().map(({ id, _id, ...rest }) => rest);
        dbProjects = await Project.insertMany(seedData);
      }
      return res.json({
        success: true,
        source: 'mongodb',
        count: dbProjects.length,
        data: dbProjects
      });
    }

    const fallbackData = readSeedProjects();
    return res.json({
      success: true,
      source: 'json-fallback',
      count: fallbackData.length,
      data: fallbackData
    });
  } catch (err) {
    const fallbackData = readSeedProjects();
    return res.json({
      success: true,
      source: 'json-fallback',
      count: fallbackData.length,
      data: fallbackData
    });
  }
});

// POST /api/projects
router.post('/projects', async (req, res) => {
  const { title, category, description, image, tech, liveUrl, githubUrl, featured } = req.body;
  if (!title || !category || !description) {
    return res.status(400).json({ success: false, error: 'Title, category, and description are required.' });
  }

  const techArray = Array.isArray(tech)
    ? tech
    : String(tech || 'React, Node.js, MongoDB')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  const payload = {
    title: title.trim(),
    category: category.trim(),
    featured: Boolean(featured),
    description: description.trim(),
    image:
      image && image.trim()
        ? image.trim()
        : 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1000&q=85',
    tech: techArray.length ? techArray : ['React', 'Node.js'],
    liveUrl: liveUrl && liveUrl.trim() ? liveUrl.trim() : '#',
    githubUrl: githubUrl && githubUrl.trim() ? githubUrl.trim() : 'https://github.com/'
  };

  try {
    if (getDBStatus()) {
      const created = await Project.create(payload);
      return res.status(201).json({ success: true, source: 'mongodb', data: created });
    }

    const existing = readSeedProjects();
    const newItem = { id: String(Date.now()), ...payload };
    existing.push(newItem);
    writeSeedProjects(existing);
    return res.status(201).json({ success: true, source: 'json-fallback', data: newItem });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create project.' });
  }
});

// DELETE /api/projects/:id
router.delete('/projects/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (getDBStatus()) {
      const deleted = await Project.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Project not found.' });
      }
      return res.json({ success: true, source: 'mongodb', deletedId: id });
    }

    const existing = readSeedProjects();
    const filtered = existing.filter((p) => String(p._id || p.id) !== String(id));
    if (filtered.length === existing.length) {
      return res.status(404).json({ success: false, error: 'Project not found.' });
    }
    writeSeedProjects(filtered);
    return res.json({ success: true, source: 'json-fallback', deletedId: id });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete project.' });
  }
});

// GET /api/messages — Admin-only inbox messages
router.get('/messages', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin access required.' });
  }

  try {
    if (getDBStatus()) {
      const docs = await Message.find().sort({ createdAt: -1 });
      const formatted = docs.map(formatMessageForResponse);
      return res.json({ success: true, source: 'mongodb', count: formatted.length, data: formatted });
    }

    const localMsgs = readLocalMessages().slice().reverse().map(formatMessageForResponse);
    return res.json({ success: true, source: 'json-fallback', count: localMsgs.length, data: localMsgs });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch messages.' });
  }
});

// GET /api/messages/thread?email=...&token=... — Customer sees only their own conversation & replies
router.get('/messages/thread', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const token = String(req.query.token || '').trim();

  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required to view your conversation.' });
  }

  try {
    let userMessages = [];

    if (getDBStatus()) {
      const docs = await Message.find({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).sort({
        createdAt: -1
      });
      userMessages = docs.map((doc) => {
        const plain = formatMessageForResponse(doc);
        const msgId = String(plain._id || plain.id);
        return {
          ...plain,
          threadToken: plain.threadToken || createThreadToken(plain.email, msgId)
        };
      });
    } else {
      const localMsgs = readLocalMessages();
      userMessages = localMsgs
        .filter((m) => String(m.email || '').toLowerCase().trim() === email)
        .map((m) => {
          const plain = formatMessageForResponse(m);
          const msgId = String(plain._id || plain.id);
          return {
            ...plain,
            threadToken: plain.threadToken || createThreadToken(plain.email, msgId)
          };
        })
        .reverse();
    }

    if (token) {
      userMessages = userMessages.filter((m) => m.threadToken === token);
    }

    return res.json({
      success: true,
      count: userMessages.length,
      data: userMessages
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load conversation thread.' });
  }
});

// POST /api/messages/:id/replies — Admin reply or customer follow-up
router.post('/messages/:id/replies', async (req, res) => {
  const sender = req.body.sender === 'customer' ? 'customer' : 'admin';

  if (sender === 'admin' && !isAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin access required.' });
  }

  const { id } = req.params;
  const replyText = String(req.body.message || req.body.reply || '').trim();
  const senderName = String(
    req.body.senderName || (sender === 'admin' ? 'Support' : 'Customer')
  ).trim();

  if (!replyText) {
    return res.status(400).json({ success: false, error: 'Reply message is required.' });
  }

  const storedReply = {
    id: `rep-${Date.now()}`,
    sender,
    senderName,
    message: encryptText(replyText),
    createdAt: new Date().toISOString()
  };

  const responseReply = {
    ...storedReply,
    message: replyText
  };

  try {
    let formattedMessage = null;

    if (getDBStatus()) {
      const nextStatus = sender === 'admin' ? 'replied' : 'new';
      const updated = await Message.findByIdAndUpdate(
        id,
        { $push: { replies: storedReply }, $set: { status: nextStatus } },
        { new: true }
      );
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Message not found.' });
      }
      formattedMessage = formatMessageForResponse(updated);
    } else {
      const existing = readLocalMessages();
      const index = existing.findIndex((m) => String(m._id || m.id) === String(id));
      if (index === -1) {
        return res.status(404).json({ success: false, error: 'Message not found.' });
      }

      const currentReplies = Array.isArray(existing[index].replies) ? existing[index].replies : [];
      existing[index] = {
        ...existing[index],
        status: sender === 'admin' ? 'replied' : 'new',
        replies: [...currentReplies, storedReply]
      };
      writeLocalMessages(existing);
      formattedMessage = formatMessageForResponse(existing[index]);
    }

    const targetEmail = String(formattedMessage.email || '').trim().toLowerCase();
    const socketPayload = {
      messageId: String(formattedMessage._id || formattedMessage.id),
      email: targetEmail,
      sender,
      senderName,
      message: replyText,
      reply: responseReply,
      thread: formattedMessage
    };

    emitSocketEvent(
      req,
      'message_reply',
      socketPayload,
      targetEmail ? [`thread:${targetEmail}`, 'admin_room'] : ['admin_room']
    );
    emitSocketEvent(
      req,
      'thread_updated',
      socketPayload,
      targetEmail ? [`thread:${targetEmail}`, 'admin_room'] : ['admin_room']
    );

    return res.status(201).json({
      success: true,
      source: getDBStatus() ? 'mongodb' : 'json-fallback',
      data: formattedMessage,
      reply: responseReply
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to send reply.' });
  }
});

// DELETE /api/messages/:id — Admin-only delete message
router.delete('/messages/:id', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin access required.' });
  }

  const { id } = req.params;
  try {
    if (getDBStatus()) {
      const deleted = await Message.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Message not found.' });
      }
      return res.json({ success: true, source: 'mongodb', deletedId: id });
    }

    const existing = readLocalMessages();
    const filtered = existing.filter((m) => String(m._id || m.id) !== String(id));
    writeLocalMessages(filtered);
    return res.json({ success: true, source: 'json-fallback', deletedId: id });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to delete message.' });
  }
});

// POST /api/contact — Customer submits project details / message
router.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({
      success: false,
      error: 'Name, email, and message are required fields.'
    });
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanMessage = message.trim();
  const encryptedMessage = encryptText(cleanMessage);

  try {
    if (getDBStatus()) {
      const saved = await Message.create({
        name: cleanName,
        email: cleanEmail,
        subject: (subject || 'Portfolio Inquiry').trim(),
        message: encryptedMessage,
        replies: [],
        status: 'new'
      });

      const threadToken = createThreadToken(cleanEmail, saved._id);
      await Message.findByIdAndUpdate(saved._id, { $set: { threadToken } });

      const plainResponse = formatMessageForResponse({ ...saved.toObject(), threadToken });

      emitSocketEvent(
        req,
        'new_message',
        { message: plainResponse, email: cleanEmail },
        ['admin_room', `thread:${cleanEmail}`]
      );

      return res.status(201).json({
        success: true,
        source: 'mongodb',
        data: plainResponse,
        threadToken,
        message: `Thank you, ${cleanName}! Your message has been saved to MongoDB.`
      });
    }

    const msgId = `msg-${Date.now()}`;
    const threadToken = createThreadToken(cleanEmail, msgId);
    const existing = readLocalMessages();
    const newMsg = {
      id: msgId,
      name: cleanName,
      email: cleanEmail,
      subject: (subject || 'Portfolio Inquiry').trim(),
      message: encryptedMessage,
      threadToken,
      replies: [],
      status: 'new',
      createdAt: new Date().toISOString()
    };
    existing.push(newMsg);
    writeLocalMessages(existing);

    const formattedNewMsg = formatMessageForResponse(newMsg);

    emitSocketEvent(
      req,
      'new_message',
      { message: formattedNewMsg, email: cleanEmail },
      ['admin_room', `thread:${cleanEmail}`]
    );

    return res.status(201).json({
      success: true,
      source: 'json-fallback',
      data: formattedNewMsg,
      threadToken,
      message: `Thank you, ${cleanName}! Your message has been saved to the Inbox.`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to save message.'
    });
  }
});

module.exports = router;