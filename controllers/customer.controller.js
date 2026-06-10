const pool = require("../util/db");

const syncCustomerProfile = async (req, res) => {
  // Added isCustomer to the destructured body
  const { id, email, fullName, phone, isCustomer } = req.body;

  // Assign IDs based on the checkbox
  const assignedRoleId = isCustomer ? 8 : 7;
  const assignedRoleEnum = isCustomer ? "viewer" : "staff";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Identity Insert (staff_users)
    await client.query(
      `
      INSERT INTO staff_users (id, email, full_name, status, role, role_id)
      VALUES ($1, $2, $3, 'active', $4::app_role, $5)
      ON CONFLICT (email) DO UPDATE SET 
        id = EXCLUDED.id,
        role_id = EXCLUDED.role_id,
        role = EXCLUDED.role,
        updated_at = NOW()
    `,
      [id, email, fullName, assignedRoleEnum, assignedRoleId]
    );

    // 2. Only create a billing profile if they are a CUSTOMER
    if (isCustomer) {
      const nameParts = fullName ? fullName.split(" ") : [""];
      const firstName = nameParts[0];
      const lastName =
        nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Customer";

      await client.query(
        `
        INSERT INTO subscribers (user_id, email, first_name, last_name, cell_phone)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email) DO UPDATE SET 
          user_id = EXCLUDED.user_id,
          updated_at = NOW()
      `,
        [id, email, firstName, lastName, phone || ""]
      );
    }

    await client.query("COMMIT");
    res.status(200).json({ success: true, role: assignedRoleId });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { syncCustomerProfile };
