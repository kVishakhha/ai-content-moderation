const express = require('express');
const router = express.Router();
const {
  sendMessage,
  getConversation,
  getConversationList,
  searchUsers,
} = require('../controllers/chatController');

// send a message (gets moderated, then pushed live if allowed)
router.post('/send', sendMessage);

// sidebar: list of people you've chatted with + last message
router.get('/conversations', getConversationList);

// search users by name/email to start a new chat
router.get('/users/search', searchUsers);

// full message history with one person
router.get('/conversation/:otherUserId', getConversation);

module.exports = router;