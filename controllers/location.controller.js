const pool = require("../util/db");

const getLocations = async (req, res) => {
  try {
    let result = await pool.query(
      "SELECT * FROM locations WHERE status = 'Active' ORDER BY created_at DESC"
    );
    res.json({ success: true, locations: result.rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch locations" });
  }
};

const updateLocationStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await pool.query("UPDATE locations SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);
    res.json({ success: true, message: `Location is now ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: "Status update failed" });
  }
};

const getLocationsAdminPanel = async (req, res) => {
  try {
    let result = await pool.query(
      "SELECT * FROM locations ORDER BY created_at DESC"
    );
    res.json({ success: true, locations: result.rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch locations" });
  }
};

const createLocation = async (req, res) => {
  const {
    name,
    state_province,
    country_code,
    currency,
    tax_desc,
    tax_amount,
    additional_screen_cost, // 🚀 NEW
    max_screens_per_package, // 🚀 NEW
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO locations (
        name, state_province, country_code, currency, tax_desc, tax_amount, additional_screen_cost, max_screens_per_package
       ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        name,
        state_province,
        country_code,
        currency || "EUR",
        tax_desc || null,
        tax_amount || 0,
        additional_screen_cost || 10, // Default to 10
        max_screens_per_package || 4, // Default to 4
      ]
    );

    res.json({ success: true, location: result.rows[0] });
  } catch (err) {
    console.error("Location Insert Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error. Ensure the name/code is unique.",
    });
  }
};

const getLocationDetails = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Fetch Channels (Using explicit c.id to prevent ambiguous column crashes)
    const channels = await pool.query(
      `SELECT c.id, c.name 
       FROM channels c 
       JOIN channel_locations cl ON c.id = cl.channel_id 
       WHERE cl.location_id = $1`,
      [id]
    );

    // 2. Fetch Packages
    const packages = await pool.query(
      `SELECT id, name FROM packages WHERE location_id = $1`,
      [id]
    );

    res.json({
      success: true,
      details: {
        channels: channels.rows,
        packages: packages.rows,
      },
    });
  } catch (err) {
    // This logs the exact SQL error to your backend terminal
    console.error("GET DETAILS DB ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const deleteLocation = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const check = await client.query(
      `
      SELECT 
        (SELECT COUNT(*) FROM channel_locations WHERE location_id = $1) as ch_count,
        (SELECT COUNT(*) FROM packages WHERE location_id = $1) as pkg_count
      `,
      [id]
    );

    const { ch_count, pkg_count } = check.rows[0];

    if (parseInt(ch_count) > 0 || parseInt(pkg_count) > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        error: `Cannot delete: This location is tied to ${ch_count} channels and ${pkg_count} packages.`,
      });
    }

    await client.query("DELETE FROM locations WHERE id = $1", [id]);
    await client.query("COMMIT");
    res.json({ success: true, message: "Location deleted successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete DB Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Database error: " + err.message });
  } finally {
    client.release();
  }
};

const updateLocation = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    state_province,
    country_code,
    status,
    currency,
    tax_desc,
    tax_amount,
    additional_screen_cost, // 🚀 NEW
    max_screens_per_package, // 🚀 NEW
  } = req.body;

  if (!id || id === "undefined" || isNaN(id)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid Location ID" });
  }

  try {
    const result = await pool.query(
      `UPDATE locations 
       SET 
         name = $1, 
         state_province = $2, 
         country_code = $3, 
         status = $4, 
         currency = $5, 
         tax_desc = $6, 
         tax_amount = $7,
         additional_screen_cost = $8,    -- 🚀 NEW
         max_screens_per_package = $9    -- 🚀 NEW
       WHERE id = $10 
       RETURNING *`,
      [
        name,
        state_province,
        country_code,
        status,
        currency,
        tax_desc,
        tax_amount,
        additional_screen_cost || 10,
        max_screens_per_package || 4,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Location not found" });
    }

    res.json({ success: true, location: result.rows[0] });
  } catch (err) {
    console.error("Update Location Error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
};

module.exports = {
  getLocations,
  updateLocationStatus,
  createLocation,
  deleteLocation,
  updateLocation,
  getLocationDetails,
  getLocationsAdminPanel,
};
