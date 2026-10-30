
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Register a new user
const register = async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    // Validate input
    if (
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: 'Username, email, and password are required'
      });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanUsername.length > 50 || cleanEmail.length > 100) {
      return res.status(400).json({
        error: 'Username or email is too long'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters long'
      });
    }

    // Hash password before storing it
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user; PostgreSQL generates id, role, and created_at
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, role, created_at`,
      [cleanUsername, cleanEmail, passwordHash]
    );

    return res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (err) {
    // Keep detailed errors in server logs only
    console.error('Registration error:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      constraint: err.constraint
    });

    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Username or email already exists'
      });
    }

    if (err.code === '23502' || err.code === '23503') {
      return res.status(400).json({
        error: 'Registration data violates a database constraint'
      });
    }

    return res.status(500).json({
      error: 'Server error'
    });
  }
};

// Login an existing user
const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, username, email, password_hash, role
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [cleanEmail]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error('Login error: JWT_SECRET is not configured');
      return res.status(500).json({
        error: 'Authentication is not configured'
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d'
      }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      role: user.role,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login error:', {
      message: err.message,
      code: err.code
    });

    return res.status(500).json({
      error: 'Server error'
    });
  }
};

// Get the currently authenticated user
const me = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const result = await pool.query(
      `SELECT id, username, email, role, created_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Get current user error:', {
      message: err.message,
      code: err.code
    });

    return res.status(500).json({
      error: 'Server error'
    });
  }
};

module.exports = {
  register,
  login,
  me
};
