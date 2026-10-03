const express = require('express');
const router = express.Router();
const { register, login, me } = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');

// Public routes - no token needed
router.post('/register', register);
router.post('/login', login);

// Protected route - token required
router.get('/me', verifyToken, me);

module.exports = router;