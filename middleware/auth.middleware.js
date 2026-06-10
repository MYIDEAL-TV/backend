const jwt = require("jsonwebtoken");

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const protectAdmin = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = {
        id: decoded.id,
        role: decoded.role,
        permissions: decoded.permissions || [], // This is the cached array
      };

      next();
    } catch (error) {
      res
        .status(401)
        .json({ success: false, error: "Not authorized, token failed" });
    }
  }

  if (!token) {
    res.status(401).json({ success: false, error: "Not authorized, no token" });
  }
};

const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    // req.user was populated by your protectAdmin middleware from the JWT
    if (
      !req.user.permissions ||
      !req.user.permissions.includes(requiredPermission)
    ) {
      console.log(
        `Permission check failed. Required: ${requiredPermission}, User Permissions: ${req.user.permissions}`
      );
      return res.status(403).json({
        success: false,
        error: "Forbidden: Missing required permission.",
      });
    }
    next();
  };
};

const protectShared = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token || token === "null" || token === "undefined") {
    return res
      .status(401)
      .json({ success: false, error: "Not authorized, no valid token" });
  }

  try {
    // -------------------------------------------------------------
    // 🚀 FIX: INTELLIGENT TOKEN ROUTING
    // Supabase tokens are massive (always > 300 chars due to GoTrue padding).
    // Standard custom JWTs are much smaller. We use length to route them safely!
    // -------------------------------------------------------------

    if (token.length > 250) {
      // 🟢 ROUTE 1: IT IS A SUPABASE TOKEN (Sales Portal)
      const { data, error: supabaseError } = await supabase.auth.getUser(token);

      if (supabaseError || !data.user) {
        console.error("Supabase Auth Rejected Token:", supabaseError?.message);
        return res
          .status(401)
          .json({ success: false, error: "Supabase authentication failed" });
      }

      req.user = {
        id: data.user.id,
        email: data.user.email,
        role: "staff", // Default baseline role
        permissions: ["view_countries", "view_packages"],
      };

      return next();
    } else {
      // 🔵 ROUTE 2: IT IS A CUSTOM ADMIN TOKEN (Admin Panel)
      // Only verify against our JWT_SECRET if we are sure it's an Admin token!
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = {
        id: decoded.id,
        role: decoded.role,
        permissions: decoded.permissions || [],
      };

      return next();
    }
  } catch (err) {
    console.error("Auth Middleware Error:", err.message);
    return res
      .status(401)
      .json({ success: false, error: "Authentication failed entirely." });
  }
};

module.exports = { protectAdmin, checkPermission, protectShared };
