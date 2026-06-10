// const pool = require("../db");

const pool = require("../util/db");
const bcrypt = require("bcrypt");

const crypto = require("crypto");
const AWS = require("aws-sdk");

const { createClient } = require("@supabase/supabase-js");

// Configure AWS SES
const SES = new AWS.SES({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// const createUser = async (req, res) => {
//   const { email, role_id, full_name } = req.body;

//   // 1. Get a client from the pool for the transaction
//   const client = await pool.connect();

//   try {
//     // 2. Start the transaction
//     await client.query("BEGIN");

//     // Check if user exists (Optional but good practice)
//     const existing = await client.query(
//       "SELECT id FROM admin_users WHERE email = $1",
//       [email]
//     );
//     if (existing.rows.length > 0) {
//       await client.query("ROLLBACK");
//       return res
//         .status(400)
//         .json({ success: false, error: "Email already exists" });
//     }

//     const token = crypto.randomBytes(32).toString("hex");
//     const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

//     // 3. Perform the Insert
//     await client.query(
//       `INSERT INTO admin_users (email, full_name, role_id, status, verification_token, token_expiry)
//        VALUES ($1, $2, $3, 'pending', $4, $5)`,
//       [email, full_name, role_id, token, expiry]
//     );

//     // 4. Attempt to send the email via SES
//     const verifyUrl = `${process.env.FRONTEND_ADMIN_URL}/admin/verify-account?token=${token}`;
//     const params = {
//       Source: process.env.SES_FROM,
//       Destination: { ToAddresses: [email] },
//       Message: {
//         Subject: { Data: "Invitation to IdealTV Admin Panel" },
//         Body: {
//           Html: {
//             Data: `<h1>Welcome, ${full_name}!</h1><p>Click below to activate:</p><a href="${verifyUrl}">Activate</a>`,
//           },
//         },
//       },
//     };

//     // If this fails, it jumps straight to the catch block
//     await SES.sendEmail(params).promise();

//     // 5. Success! Commit the changes to the database
//     await client.query("COMMIT");
//     res.json({ success: true, message: "Invitation sent successfully!" });
//   } catch (err) {
//     // 6. FAILURE: Rollback all database changes made in this block
//     await client.query("ROLLBACK");
//     console.error("Rollback triggered due to error:", err.message);

//     // Provide a specific error message if it's an SES issue
//     const errorMessage =
//       err.code === "MessageRejected" || err.code === "InvalidParameterValue"
//         ? "Email service failed. User was not created."
//         : "Internal server error";

//     res.status(500).json({ success: false, error: errorMessage });
//   } finally {
//     // 7. Always release the client back to the pool
//     client.release();
//   }
// };

// Safely grab the env variables
const supabaseUrl = process.env.SUPABASE_URL;
// 🚨 CRITICAL: Use the Service Role Key to bypass RLS!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("FATAL: Supabase URL or Key is missing from .env!");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const createUser = async (req, res) => {
  // 🚀 NEW: Accept the has_admin_access boolean from the frontend
  const { email, role_id, full_name, has_admin_access } = req.body;
  const roleIdInt = parseInt(role_id, 10);

  // 🚀 THE MASTER RULE:
  // If the frontend asks for Admin access, grant it.
  // BUT, if they are a Customer (Role 8), hard-deny Admin access regardless of the flag.
  const grantAdminAccess = has_admin_access === true && roleIdInt !== 8;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // -------------------------------------------------------------
    // 1. GLOBAL DUPLICATE CHECK
    // Since everyone gets Sales Portal access, staff_users is our master list.
    // -------------------------------------------------------------
    const existingStaff = await client.query(
      "SELECT id FROM staff_users WHERE email ILIKE $1",
      [email.trim()]
    );
    if (existingStaff.rowCount > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ success: false, error: "User already exists in the system." });
    }

    // Also check admin_users just in case of ghost records
    if (grantAdminAccess) {
      const existingAdmin = await client.query(
        "SELECT id FROM admin_users WHERE email ILIKE $1",
        [email.trim()]
      );
      if (existingAdmin.rowCount > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          error: "Email is already registered in the Admin Panel.",
        });
      }
    }

    // -------------------------------------------------------------
    // 2. CREATE SALES PORTAL ACCESS FOR EVERYONE (Supabase)
    // -------------------------------------------------------------
    const salesPortalUrl =
      process.env.FRONTEND_SALES_URL ||
      process.env.FRONTEND_URL ||
      "http://localhost:8080";

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email.trim(), {
        redirectTo: `${salesPortalUrl}/update-password`,
        data: {
          full_name: full_name,
          role_id: roleIdInt,
          is_customer: roleIdInt === 8,
        },
      });

    if (authError) throw new Error(`Supabase Auth Error: ${authError.message}`);

    // Insert into staff_users using the exact UUID Supabase generated
    await client.query(
      `INSERT INTO staff_users (id, email, full_name, role_id) 
       VALUES ($1, $2, $3, $4)`,
      [authData.user.id, email.trim(), full_name, roleIdInt]
    );

    // -------------------------------------------------------------
    // 3. CREATE ADMIN PANEL ACCESS (Conditional based on flag)
    // -------------------------------------------------------------
    if (grantAdminAccess) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Insert into admin_users (Custom Auth)
      await client.query(
        `INSERT INTO admin_users (email, full_name, role_id, status, verification_token, token_expiry) 
         VALUES ($1, $2, $3, 'pending', $4, $5)`,
        [email.trim(), full_name, roleIdInt, token, expiry]
      );

      // Send custom SES Email for Admin Panel
      const verifyUrl = `${process.env.FRONTEND_ADMIN_URL}/admin/verify-account?token=${token}`;
      const params = {
        Source: process.env.SES_FROM,
        Destination: { ToAddresses: [email.trim()] },
        Message: {
          Subject: { Data: "IdealTV: Admin Panel & Sales Portal Access" },
          Body: {
            Html: {
              Data: `
            <h1>Welcome, ${full_name}!</h1>
            <p>You have been granted access to the IdealTV network.</p>
            <h3>1. Admin Panel Access</h3>
            <p>Click below to set your Admin password:</p>
            <a href="${verifyUrl}">Activate Admin Account</a>
            <br/><br/>
            <h3>2. Sales Portal Access</h3>
            <p>You will receive a separate email from Supabase to set your password for the Sales Portal.</p>
          `,
            },
          },
        },
      };

      await SES.sendEmail(params).promise();
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      message: grantAdminAccess
        ? "User created. Invitations sent for BOTH Admin and Sales portals!"
        : "User created. Invitation sent for the Sales portal!",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("User Creation Error:", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to create user. Please try again.",
    });
  } finally {
    client.release();
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  // 1. Validation: Ensure an ID was actually passed in the URL
  if (!id) {
    return res
      .status(400)
      .json({ success: false, error: "User ID is required." });
  }

  // 2. Self-Deletion Protection: Use req.admin.id as set by your middleware
  // Note: Depending on your frontend, 'id' could be the UUID or the numeric ID.
  // We use String() to safely compare them.
  if (req.admin && String(req.admin.id) === String(id)) {
    return res.status(400).json({
      success: false,
      error:
        "Security Policy: You cannot delete your own administrator account.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 3. Find the user's email so we can target them across all tables
    let targetEmail = null;
    let authUserId = null;

    // A. Check staff_users first (Since everyone is supposed to be here)
    const staffQuery = await client.query(
      "SELECT id, email FROM staff_users WHERE id::text = $1",
      [id]
    );
    if (staffQuery.rowCount > 0) {
      targetEmail = staffQuery.rows[0].email;
      authUserId = staffQuery.rows[0].id; // In staff_users, the ID is the Supabase UUID
    } else {
      // B. Fallback check in admin_users
      const adminQuery = await client.query(
        "SELECT email FROM admin_users WHERE id::text = $1",
        [id]
      );
      if (adminQuery.rowCount > 0) {
        targetEmail = adminQuery.rows[0].email;
      }
    }

    // 4. Handle non-existent user
    if (!targetEmail) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "User not found in system." });
    }

    // -------------------------------------------------------------
    // 🚀 STEP 5: DELETE FROM CUSTOM DATABASES
    // -------------------------------------------------------------
    await client.query("DELETE FROM staff_users WHERE email = $1", [
      targetEmail,
    ]);
    await client.query("DELETE FROM admin_users WHERE email = $1", [
      targetEmail,
    ]);

    // -------------------------------------------------------------
    // 🚀 STEP 6: DELETE FROM SUPABASE AUTH.USERS
    // -------------------------------------------------------------
    if (authUserId) {
      // If we have their UUID, delete them cleanly via the Admin API
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
        authUserId
      );

      if (authError && !authError.message.includes("User not found")) {
        throw new Error(`Supabase Deletion Failed: ${authError.message}`);
      }
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      message: `User ${targetEmail} has been completely removed from all portals.`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete User Error:", err);
    res.status(500).json({ success: false, error: "Failed to delete user." });
  } finally {
    client.release();
  }
};

// Ensure crypto is required at the top of your file if not already there
// const crypto = require('crypto');

const updateUser = async (req, res) => {
  const { id } = req.params;
  // 🚀 NEW: Accept has_admin_access from the frontend
  const { full_name, role_id, status, has_admin_access } = req.body;
  const roleIdInt = parseInt(role_id, 10);

  if (!full_name || !role_id || !status) {
    return res
      .status(400)
      .json({ success: false, error: "Missing required fields." });
  }

  // 🚀 THE MASTER RULE:
  // Admin access is granted IF the toggle is true AND they are NOT a Customer (Role 8).
  const grantAdminAccess = has_admin_access === true && roleIdInt !== 8;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Find the user's email to target across all tables
    let targetEmail = null;
    let authUserId = null;

    const staffQuery = await client.query(
      "SELECT id, email FROM staff_users WHERE id::text = $1",
      [id]
    );
    if (staffQuery.rowCount > 0) {
      targetEmail = staffQuery.rows[0].email;
      authUserId = staffQuery.rows[0].id;
    } else {
      const adminQuery = await client.query(
        "SELECT email FROM admin_users WHERE id::text = $1",
        [id]
      );
      if (adminQuery.rowCount > 0) {
        targetEmail = adminQuery.rows[0].email;
      }
    }

    if (!targetEmail) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "User not found." });
    }

    // 2. ALWAYS Update the Sales Portal record (staff_users)
    await client.query(
      `UPDATE staff_users 
       SET full_name = $1, role_id = $2 
       WHERE email = $3`,
      [full_name, roleIdInt, targetEmail]
    );

    // 3. ALWAYS Update Supabase Auth Metadata (Keeps tokens in sync!)
    if (authUserId) {
      await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        user_metadata: {
          full_name: full_name,
          role_id: roleIdInt,
          is_customer: roleIdInt === 8,
        },
      });
    }

    // -------------------------------------------------------------
    // 🚀 4. DYNAMIC ADMIN PANEL ACCESS LOGIC
    // -------------------------------------------------------------
    const existingAdmin = await client.query(
      "SELECT id FROM admin_users WHERE email = $1",
      [targetEmail]
    );
    const hasExistingAdminRecord = existingAdmin.rowCount > 0;

    let actionMessage = `Profile for ${targetEmail} updated successfully.`;

    if (grantAdminAccess && !hasExistingAdminRecord) {
      // SCENARIO A: PROMOTION (Gaining Admin Access)
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO admin_users (email, full_name, role_id, status, verification_token, token_expiry) 
         VALUES ($1, $2, $3, 'pending', $4, $5)`,
        [targetEmail, full_name, roleIdInt, token, expiry]
      );

      // Send SES Email
      const verifyUrl = `${process.env.FRONTEND_ADMIN_URL}/admin/verify-account?token=${token}`;
      const params = {
        Source: process.env.SES_FROM,
        Destination: { ToAddresses: [targetEmail] },
        Message: {
          Subject: { Data: "IdealTV: Admin Panel Access Granted" },
          Body: {
            Html: {
              Data: `<h1>Welcome, ${full_name}!</h1><p>You have been promoted/granted access to the IdealTV Admin Panel.</p><p>Click below to set your Admin password:</p><a href="${verifyUrl}">Activate Admin Account</a>`,
            },
          },
        },
      };
      await SES.sendEmail(params).promise();
      actionMessage += " An invitation email for the Admin Panel was sent.";
    } else if (grantAdminAccess && hasExistingAdminRecord) {
      // SCENARIO B: NORMAL UPDATE (Already has Admin Access)
      await client.query(
        `UPDATE admin_users 
         SET full_name = $1, role_id = $2, status = $3 
         WHERE email = $4`,
        [full_name, roleIdInt, status.toLowerCase(), targetEmail]
      );
    } else if (!grantAdminAccess && hasExistingAdminRecord) {
      // SCENARIO C: DEMOTION / REVOCATION (Losing Admin Access)
      // They are now a Customer, or the toggle was unchecked. We destroy their Admin login.
      await client.query("DELETE FROM admin_users WHERE email = $1", [
        targetEmail,
      ]);
      actionMessage += " Admin Panel access has been revoked.";
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      message: actionMessage,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update User Error:", err);
    res.status(500).json({ success: false, error: "Internal server error." });
  } finally {
    client.release();
  }
};

const getUserTypes = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name FROM user_types WHERE is_active = true ORDER BY name ASC"
    );
    res.status(200).json({ success: true, types: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const getAdminStats = async (req, res) => {
  try {
    // Run all count queries simultaneously for speed
    const [usersRes, locationsRes, packagesRes, channelsRes] =
      await Promise.all([
        pool.query("SELECT COUNT(*) FROM admin_users"), // Or 'subscribers' depending on your main user base
        pool.query("SELECT COUNT(*) FROM locations WHERE status = 'Active'"),
        pool.query("SELECT COUNT(*) FROM packages WHERE status = 'Active'"),
        pool.query("SELECT COUNT(*) FROM channels WHERE status = 'Active'"),
      ]);

    res.json({
      success: true,
      stats: {
        totalUsers: parseInt(usersRes.rows[0].count),
        activeLocations: parseInt(locationsRes.rows[0].count),
        activePackages: parseInt(packagesRes.rows[0].count),
        activeChannels: parseInt(channelsRes.rows[0].count),
        totalRevenue: "0.00", // Placeholder until the billing module is built
      },
    });
  } catch (err) {
    console.error("Dashboard Stats Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to load dashboard metrics" });
  }
};

const getRoles = async (req, res) => {
  try {
    const query = `
      SELECT 
        r.id, 
        r.name, 
        r.description,
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT('id', p.id, 'name', p.name, 'desc', p.description)
          ) FILTER (WHERE p.id IS NOT NULL), 
          '[]'
        ) as permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      GROUP BY r.id, r.name, r.description
      ORDER BY r.name ASC
    `;

    const result = await pool.query(query);
    res.json({ success: true, roles: result.rows });
  } catch (err) {
    console.error("Fetch Roles with Perms Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to load roles data" });
  }
};

// Inside controllers/user.controller.js
const createRole = async (req, res) => {
  const { name, description, permissionIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roleRes = await client.query(
      "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
      [name, description]
    );
    const roleId = roleRes.rows[0].id;

    if (permissionIds.length > 0) {
      const values = permissionIds.map((id) => `(${roleId}, ${id})`).join(",");
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`
      );
    }
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

const getSystemUsers = async (req, res) => {
  try {
    // 🚀 FIX: Master Directory Query using FULL OUTER JOIN
    // This merges staff_users and admin_users so NO ONE is left behind!
    const query = `
      SELECT 
        COALESCE(su.id, au.id) as id,
        COALESCE(su.email, au.email) as email,
        COALESCE(su.full_name, au.full_name) as full_name,
        COALESCE(au.status, 'active') as status, -- Supabase users are active by default
        r.name as role_name,
        CASE WHEN au.id IS NOT NULL THEN true ELSE false END as has_admin_access -- 🚀 NEW: Tells UI if they exist in admin_users
      FROM staff_users su
      FULL OUTER JOIN admin_users au ON su.email = au.email
      LEFT JOIN roles r ON COALESCE(su.role_id, au.role_id) = r.id
      ORDER BY email ASC
    `;
    const result = await pool.query(query);

    const users = result.rows.map((user) => ({
      id: user.id,
      name: user.full_name || user.email.split("@")[0], // Priority to full_name
      email: user.email,
      role: user.role_name || "No Role",

      // If they are pending in admin_users, show Pending. Otherwise Active.
      status: user.status?.toLowerCase() === "pending" ? "Pending" : "Active",

      has_admin_access: user.has_admin_access, // 🚀 NEW: Send to React

      initials: (user.full_name
        ? user.full_name.substring(0, 2)
        : user.email.substring(0, 2)
      ).toUpperCase(),
    }));

    res.json({ success: true, users });
  } catch (err) {
    console.error("Master Directory Fetch Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch users" });
  }
};

const getAllPermissions = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, description FROM permissions ORDER BY name ASC"
    );
    res.json({ success: true, permissions: result.rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch permissions list" });
  }
};

const deleteRole = async (req, res) => {
  const { id } = req.params;

  // 0. Security Check: Prevent deletion of mandatory roles
  const mandatoryRoleIds = ["1", "6", "7", "8"];
  if (mandatoryRoleIds.includes(String(id))) {
    return res.status(403).json({
      success: false,
      error:
        "Security Policy: These are mandatory system roles and cannot be deleted.",
    });
  }

  const client = await pool.connect();

  try {
    // 🚀 FIX: Check BOTH user tables to ensure this role isn't being used!
    const userCheck = await client.query(
      `SELECT 
        (SELECT count(*) FROM admin_users WHERE role_id = $1) as admin_count,
        (SELECT count(*) FROM staff_users WHERE role_id = $1) as staff_count
      `,
      [id]
    );

    const totalUsersUsingRole =
      parseInt(userCheck.rows[0].admin_count) +
      parseInt(userCheck.rows[0].staff_count);

    if (totalUsersUsingRole > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete: ${totalUsersUsingRole} user(s) are currently assigned to this role across the system. Please reassign them first.`,
      });
    }

    // 2. Start Transaction
    await client.query("BEGIN");

    // 3. Remove junction records (role_permissions) first to maintain referential integrity
    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);

    // 4. Remove the role itself
    const result = await client.query(
      "DELETE FROM roles WHERE id = $1 RETURNING name",
      [id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Role not found." });
    }

    // 5. Commit Changes
    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Role '${result.rows[0].name}' has been permanently removed from the system.`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete Role Error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error during role deletion.",
    });
  } finally {
    client.release();
  }
};

const updateRole = async (req, res) => {
  const { id } = req.params;
  const { name, description, permissionIds } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Update basic role info
    await client.query(
      "UPDATE roles SET name = $1, description = $2 WHERE id = $3",
      [name, description, id]
    );

    // Security Check: Protect SuperAdmin (id: 1) permissions from being removed or modified
    if (String(id) !== "1") {
      // 2. Wipe existing permissions for this role
      await client.query("DELETE FROM role_permissions WHERE role_id = $1", [
        id,
      ]);

      // 3. Re-insert new permission set
      if (permissionIds && permissionIds.length > 0) {
        const values = permissionIds.map((pId) => `(${id}, ${pId})`).join(",");
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`
        );
      }
    } else {
      // return the proper message if someone tries to modify SuperAdmin permissions
      return res.status(403).json({
        success: false,
        error:
          "Security Policy: The SuperAdmin role's permissions cannot be modified.",
      });
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Role updated successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: "Update failed." });
  } finally {
    client.release();
  }
};

const getPackageTemplatesAdmin = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM package_templates ORDER BY created_at DESC`
    );
    res.json({ success: true, templates: result.rows });
  } catch (err) {
    console.error("Get Templates Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error while fetching templates",
    });
  }
};

const getPackageTemplates = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * 
       FROM package_templates 
       WHERE status = 'Active'
       ORDER BY created_at DESC`
    );

    res.json({ success: true, templates: result.rows });
  } catch (err) {
    console.error("Get Templates Error:", err);

    res.status(500).json({
      success: false,
      error: "Database error while fetching templates",
    });
  }
};

const createPackageTemplate = async (req, res) => {
  const {
    name,
    applicable_user_type_id, // 🚀 Changed to ID
    total_channels,
    fixed_channels,
    flex_channels,
    template_type,
    status,
    description,
  } = req.body;

  // --- 1. STRICT BACKEND VALIDATION ---
  const total = parseInt(total_channels) || 0;
  const fixed = parseInt(fixed_channels) || 0;
  const flex = parseInt(flex_channels) || 0;

  // Only apply the math rule if it's a Base package (Add-ons usually don't have flex splits)
  if (template_type?.toUpperCase() === "BASE") {
    if (fixed + flex !== total) {
      return res.status(400).json({
        success: false,
        error: `Blueprint Rule Violated: Fixed (${fixed}) + Flex (${flex}) must exactly equal Total channels (${total}).`,
      });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO package_templates
      (name, applicable_user_type_id, total_channels, fixed_channels, flex_channels, template_type, status, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        name,
        applicable_user_type_id, // 🚀 Updated mapping
        total, // Safely parsed integer
        fixed, // Safely parsed integer
        flex, // Safely parsed integer
        template_type,
        status || "Active",
        description,
      ]
    );
    res.status(201).json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error("Create Template Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create template." });
  }
};

const updatePackageTemplate = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    applicable_user_type_id, // 🚀 Changed to ID
    total_channels,
    fixed_channels,
    flex_channels,
    template_type,
    status,
    description,
  } = req.body;

  // --- 1. STRICT BACKEND VALIDATION ---
  // 🚀 Added to UPDATE so admins can't break the math rule when editing
  const total = parseInt(total_channels) || 0;
  const fixed = parseInt(fixed_channels) || 0;
  const flex = parseInt(flex_channels) || 0;

  if (template_type?.toUpperCase() === "BASE") {
    if (fixed + flex !== total) {
      return res.status(400).json({
        success: false,
        error: `Blueprint Rule Violated: Fixed (${fixed}) + Flex (${flex}) must exactly equal Total channels (${total}).`,
      });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE package_templates
       SET name = $1, applicable_user_type_id = $2, total_channels = $3, fixed_channels = $4, flex_channels = $5, template_type = $6, status = $7, description = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        name,
        applicable_user_type_id, // 🚀 Updated mapping
        total, // Safely parsed integer
        fixed, // Safely parsed integer
        flex, // Safely parsed integer
        template_type,
        status,
        description,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error("Update Template Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update template." });
  }
};

const deletePackageTemplate = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. SAFETY CHECK: Count how many packages are using this template
    const checkResult = await pool.query(
      `SELECT COUNT(*) FROM packages WHERE template_id = $1`,
      [id]
    );

    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete: This blueprint is actively used by ${checkResult.rows[0].count} package(s).`,
      });
    }

    // 2. Safe to delete
    const result = await pool.query(
      `DELETE FROM package_templates WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }

    res.json({ success: true, message: "Template deleted successfully." });
  } catch (err) {
    console.error("Delete Template Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete template." });
  }
};

const getPackageOptions = async (req, res) => {
  const { packageId, locationId } = req.params;

  const query = `
        SELECT 
            ai.id, 
            ai.name, 
            ai.description, 
            ai.category,
            aip.upfront_price, 
            aip.monthly_price, 
            aip.currency
        FROM additional_items ai
        JOIN package_item_compatibility pic ON ai.id = pic.item_id
        JOIN additional_item_prices aip ON ai.id = aip.item_id
        WHERE pic.package_id = $1 
        AND aip.location_id = $2
        AND ai.is_active = true;
    `;

  try {
    const { rows } = await pool.query(query, [packageId, locationId]);
    res.json({ success: true, rows: rows });
  } catch (err) {
    console.error("Error fetching options:", err.message);
    res.status(500).json({ error: "Database error" });
  }
};

// 1. Get Pending Requests
const getPendingFlexRequests = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        fcr.id AS request_id, 
        fcr.created_at, 
        s.id AS subscription_id,
        s.nickname, 
        sub.first_name, 
        sub.last_name, 
        sub.email 
      FROM flex_code_requests fcr
      JOIN subscriptions s ON fcr.subscription_id = s.id
      JOIN subscribers sub ON s.subscriber_id = sub.id
      WHERE fcr.status = 'pending'
      ORDER BY fcr.created_at ASC
    `);
    res.status(200).json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 2. Fulfill Request (Generate Code)
const fulfillFlexRequest = async (req, res) => {
  const { requestId, subscriptionId } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Generate 6 digit code
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Invalidate old codes
    await client.query(
      `UPDATE flex_unlock_codes SET expires_at = NOW() WHERE subscription_id = $1 AND is_used = false`,
      [subscriptionId]
    );

    // Insert new code
    await client.query(
      `INSERT INTO flex_unlock_codes (subscription_id, code, expires_at) 
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [subscriptionId, newCode]
    );

    // Mark request as fulfilled
    await client.query(
      `UPDATE flex_code_requests SET status = 'fulfilled', updated_at = NOW() WHERE id = $1`,
      [requestId]
    );

    await client.query("COMMIT");
    res.status(200).json({ success: true, code: newCode });
    // Note: You can also hook up AWS SES here to email the code directly to the customer!
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};
// Add to router: router.get('/flex-requests', getPendingFlexRequests);
// Add to router: router.post('/flex-requests/fulfill', fulfillFlexRequest);

module.exports = {
  getSystemUsers,
  getAdminStats,
  getRoles,
  getAllPermissions,
  createUser,
  deleteUser,
  updateUser,
  createRole,
  deleteRole,
  updateRole,
  getPackageTemplates,
  createPackageTemplate,
  updatePackageTemplate,
  deletePackageTemplate,
  getUserTypes,
  getPackageOptions,
  getPackageTemplatesAdmin,
  getPendingFlexRequests,
  fulfillFlexRequest,
};
