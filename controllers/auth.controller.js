// const pool = require("../db"); // Import the central pool
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../util/db");

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Join with roles and permissions tables
    const query = `
      SELECT u.*, r.name as role_name, 
      ARRAY_AGG(p.name) as permissions
      FROM admin_users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE u.email = $1
      GROUP BY u.id, r.name
    `;

    const result = await pool.query(query, [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    const userPerms = await pool.query(
      `SELECT p.name FROM permissions p 
   JOIN role_permissions rp ON p.id = rp.permission_id 
   WHERE rp.role_id = $1`,
      [user.role_id]
    );

    const permissionsArray = userPerms.rows.map((p) => p.name);
    // Include permissions in the JWT payload
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role_name,
        permissions: permissionsArray,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ success: true, token, permissions: user.permissions });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
};

// controllers/auth.controller.js

const createAdmin = async (req, res) => {
  const { email, password, adminSecret } = req.body;

  // Security check to prevent unauthorized admin creation
  if (adminSecret !== "IDEAL_SECRET_2026") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    // 1. Check if admin already exists
    const checkUser = await pool.query(
      "SELECT * FROM admin_users WHERE email = $1",
      [email]
    );
    if (checkUser.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, error: "Admin already exists" });
    }

    // 2. Hash the password correctly using bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Insert into DB
    await pool.query(
      "INSERT INTO admin_users (email, password_hash, status) VALUES ($1, $2, 'active')",
      [email, hashedPassword]
    );

    res.json({ success: true, message: "Admin created successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

const verifyAccount = async (req, res) => {
  const { token, password } = req.body;

  try {
    // 1. Find user by token and check expiry
    const result = await pool.query(
      "SELECT id FROM admin_users WHERE verification_token = $1 AND token_expiry > NOW()",
      [token]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ error: "Invalid or expired link" });

    // 2. Hash the user's chosen password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Update user: Remove token and set status to active
    await pool.query(
      "UPDATE admin_users SET password_hash = $1, status = 'active', verification_token = NULL, token_expiry = NULL WHERE id = $2",
      [hashedPassword, result.rows[0].id]
    );

    res.json({
      success: true,
      message: "Account activated! You can now log in.",
    });
  } catch (err) {
    res.status(500).json({ error: "Activation failed" });
  }
};

// Backend Controller: Check if email exists
const checkEmailExists = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    // 🚀 FIX: ONLY check the staff_users table for portal access.
    const staffCheck = await pool.query(
      "SELECT id FROM staff_users WHERE email ILIKE $1 LIMIT 1",
      [email.trim()]
    );

    const isTaken = staffCheck.rowCount > 0;

    res.status(200).json({ success: true, isTaken });
  } catch (err) {
    console.error("Email check error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
};

const validateActivationToken = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res
      .status(400)
      .json({ success: false, error: "Token is required." });
  }

  try {
    // Look up the user by the token
    const result = await pool.query(
      "SELECT status, token_expiry FROM admin_users WHERE verification_token = $1",
      [token]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Invalid activation link." });
    }

    const user = result.rows[0];

    // Check 1: Are they already active?
    if (user.status === "Active") {
      return res.status(400).json({
        success: false,
        error: "This account has already been activated. Please log in.",
      });
    }

    // Check 2: Has the token expired? (If you use expiration dates)
    if (user.token_expiry && new Date() > new Date(user.token_expiry)) {
      return res.status(400).json({
        success: false,
        error: "This activation link has expired. Please request a new one.",
      });
    }

    // If they pass the checks, give the frontend the green light!
    res.json({
      success: true,
      message: "Token is valid and ready for activation.",
    });
  } catch (err) {
    console.error("Token Validation Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error while validating token.",
    });
  }
};

// Export both login and createAdmin
module.exports = {
  login,
  createAdmin,
  verifyAccount,
  validateActivationToken,
  checkEmailExists,
};
