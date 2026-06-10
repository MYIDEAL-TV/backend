const pool = require("../util/db");

// NEW ROUTE (Ticket #97): Get active channels by location
const getEligibleChannels = async (req, res) => {
  const { locationId } = req.query;
  try {
    if (!locationId) return res.json({ success: true, channels: [] });

    const query = `
      SELECT c.* FROM channels c
      JOIN channel_locations cl ON c.id = cl.channel_id
      WHERE cl.location_id = $1 
      AND c.status = 'Active'
    `;
    const result = await pool.query(query, [locationId]);
    res.json({ success: true, channels: result.rows });
  } catch (err) {
    console.error("Get Eligible Channels Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const createPackage = async (req, res) => {
  const {
    name,
    description,
    price,
    price_type,
    type,
    location_id,
    status,
    flex_channel_quota,
    channel_model,
    channel_ids,
    template_id,
    addon_ids,
    decoder_ids,
    other_item_ids, // NEW: Added other_item_ids from frontend payload
  } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const packageResult = await client.query(
      `INSERT INTO packages (name, description, price, price_type, type, location_id, status, flex_channel_quota, channel_model, template_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        name,
        description,
        price,
        price_type || "per_subscriber",
        type,
        location_id,
        status,
        flex_channel_quota || 0,
        channel_model || 16,
        template_id || null,
      ]
    );
    const newPackageId = packageResult.rows[0].id;

    if (channel_ids && channel_ids.length > 0) {
      const values = [];
      const queryParts = [];
      let i = 1;

      values.push(newPackageId);
      channel_ids.forEach((channelId) => {
        i++;
        values.push(channelId);
        queryParts.push(`($1, $${i})`);
      });

      await client.query(
        `INSERT INTO package_channels (package_id, channel_id) VALUES ${queryParts.join(
          ", "
        )}`,
        values
      );
    }

    if (type?.toUpperCase() === "BASE" && addon_ids && addon_ids.length > 0) {
      const addonValues = [];
      const addonQueryParts = [];
      let j = 1;

      addonValues.push(newPackageId);
      addon_ids.forEach((addonId) => {
        j++;
        addonValues.push(addonId);
        addonQueryParts.push(`($1, $${j})`);
      });

      await client.query(
        `INSERT INTO package_addons (base_package_id, addon_package_id) VALUES ${addonQueryParts.join(
          ", "
        )}`,
        addonValues
      );
    }

    // NEW: Combine decoders and other items, then insert into compatibility table
    const allCompatibleItems = [
      ...(decoder_ids || []),
      ...(other_item_ids || []),
    ];

    if (allCompatibleItems.length > 0) {
      for (let itemId of allCompatibleItems) {
        await client.query(
          `INSERT INTO package_item_compatibility (package_id, item_id) VALUES ($1, $2)`,
          [newPackageId, itemId]
        );
      }
    }

    await client.query("COMMIT");
    res
      .status(201)
      .json({ success: true, message: "Package created successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create Package Error:", err);
    res.status(500).json({
      success: false,
      error: "Package creation failed: " + err.message,
    });
  } finally {
    client.release();
  }
};

const updatePackage = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    price,
    price_type,
    type,
    location_id,
    status,
    flex_channel_quota,
    channel_model,
    channel_ids,
    template_id,
    addon_ids,
    decoder_ids,
    other_item_ids, // NEW: Added other_item_ids from frontend payload
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE packages 
       SET name = $1, description = $2, price = $3, price_type = $4, type = $5, location_id = $6, status = $7, flex_channel_quota = $8, channel_model = $9, template_id = $10
       WHERE id = $11 RETURNING *`,
      [
        name,
        description,
        price,
        price_type || "per_subscriber",
        type,
        location_id,
        status,
        flex_channel_quota || 0,
        channel_model || 16,
        template_id || null,
        id,
      ]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "Package not found." });
    }

    await client.query("DELETE FROM package_channels WHERE package_id = $1", [
      id,
    ]);

    if (channel_ids && channel_ids.length > 0) {
      const values = [];
      const queryParts = [];
      let i = 1;

      values.push(id);
      channel_ids.forEach((channelId) => {
        i++;
        values.push(channelId);
        queryParts.push(`($1, $${i})`);
      });

      await client.query(
        `INSERT INTO package_channels (package_id, channel_id) VALUES ${queryParts.join(
          ", "
        )}`,
        values
      );
    }

    await client.query(
      "DELETE FROM package_addons WHERE base_package_id = $1",
      [id]
    );

    if (type?.toUpperCase() === "BASE" && addon_ids && addon_ids.length > 0) {
      const addonValues = [];
      const addonQueryParts = [];
      let j = 1;

      addonValues.push(id);
      addon_ids.forEach((addonId) => {
        j++;
        addonValues.push(addonId);
        addonQueryParts.push(`($1, $${j})`);
      });

      await client.query(
        `INSERT INTO package_addons (base_package_id, addon_package_id) VALUES ${addonQueryParts.join(
          ", "
        )}`,
        addonValues
      );
    }

    // NEW: Sync Compatible Items (Delete old mappings, insert combined new ones)
    await client.query(
      `DELETE FROM package_item_compatibility WHERE package_id = $1`,
      [id]
    );

    const allCompatibleItems = [
      ...(decoder_ids || []),
      ...(other_item_ids || []),
    ];

    if (allCompatibleItems.length > 0) {
      for (let itemId of allCompatibleItems) {
        await client.query(
          `INSERT INTO package_item_compatibility (package_id, item_id) VALUES ($1, $2)`,
          [id, itemId]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, package: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Package Update Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update package and channels.",
    });
  } finally {
    client.release();
  }
};

const getPackagesAdminPanel = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*, 
        l.name as location_name, 
        l.state_province,
        pt.name as template_name,
        pt.total_channels as template_total_channels,
        pt.fixed_channels as template_fixed_channels,
        pt.flex_channels as template_flex_channels,
        pt.template_type as template_type,
        COALESCE(
          (SELECT json_agg(channel_id) FROM package_channels WHERE package_id = p.id), 
          '[]'::json
        ) AS channel_ids,
        COALESCE(
          (SELECT json_agg(addon_package_id) FROM package_addons WHERE base_package_id = p.id), 
          '[]'::json
        ) AS addon_ids,
        -- NEW: Bundle compatible decoders
        COALESCE(
          (SELECT json_agg(item_id) FROM package_item_compatibility WHERE package_id = p.id), 
          '[]'::json
        ) AS compatible_decoders
      FROM packages p
      LEFT JOIN locations l ON p.location_id = l.id
      LEFT JOIN package_templates pt ON p.template_id = pt.id
      ORDER BY p.created_at DESC
    `);

    res.json({ success: true, packages: result.rows });
  } catch (err) {
    console.error("Get Packages Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error while fetching packages",
    });
  }
};

const getPackages = async (req, res) => {
  // Extract contractType from query params (e.g., /api/packages?contractType=hotel)
  const { contractType } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT 
        p.*, 
        l.name as location_name, 
        l.state_province,
        pt.name as template_name,
        pt.total_channels as template_total_channels,
        pt.fixed_channels as template_fixed_channels,
        pt.flex_channels as template_flex_channels,
        pt.template_type as template_type,
        
        -- Fetch allowed contract type code via the Package Template's new UUID
        COALESCE(
          (SELECT json_agg(ut.code) 
           FROM user_types ut 
           WHERE ut.id = pt.applicable_user_type_id), 
          '[]'::json
        ) AS allowed_types,
        
        COALESCE(
          (SELECT json_agg(channel_id) FROM package_channels WHERE package_id = p.id), 
          '[]'::json
        ) AS channel_ids,
        
        COALESCE(
          (SELECT json_agg(addon_package_id) FROM package_addons WHERE base_package_id = p.id), 
          '[]'::json
        ) AS addon_ids,
        
        -- 🚀 UPDATED: Only return items where category is strictly 'decoder'
        COALESCE(
          (SELECT json_agg(pic.item_id) 
           FROM package_item_compatibility pic 
           JOIN additional_items ai ON pic.item_id = ai.id
           WHERE pic.package_id = p.id AND ai.category = 'decoder'), 
          '[]'::json
        ) AS compatible_decoders,

        -- 🚀 NEW: Return all other items (fees, dishes, etc.) for the Admin Panel
        COALESCE(
          (SELECT json_agg(pic.item_id) 
           FROM package_item_compatibility pic 
           JOIN additional_items ai ON pic.item_id = ai.id
           WHERE pic.package_id = p.id AND ai.category != 'decoder'), 
          '[]'::json
        ) AS compatible_other_items

      FROM packages p
      LEFT JOIN locations l ON p.location_id = l.id
      LEFT JOIN package_templates pt ON p.template_id = pt.id
      
      -- Filter by contract type if provided
      WHERE ($1::text IS NULL OR EXISTS (
        SELECT 1 FROM user_types ut
        WHERE ut.id = pt.applicable_user_type_id AND ut.code = $1
      ))
      ORDER BY p.created_at DESC
    `,
      [contractType || null]
    );

    res.json({ success: true, packages: result.rows });
  } catch (err) {
    console.error("Get Packages Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error while fetching packages",
    });
  }
};

const deletePackage = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // -------------------------------------------------------------
    // 🚀 FIX: PROACTIVE DEPENDENCY CHECK
    // Check if any customer subscriptions are actively using this package
    // -------------------------------------------------------------
    const checkSubs = await client.query(
      "SELECT COUNT(*) FROM subscriptions WHERE package_id = $1",
      [id]
    );

    if (parseInt(checkSubs.rows[0].count) > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        error:
          "Cannot delete this package because it is currently assigned to active customer subscriptions. Please deactivate it instead.",
      });
    }

    // NEW: Delete from junction tables first to prevent foreign key constraint violations
    await client.query(
      "DELETE FROM package_item_compatibility WHERE package_id = $1",
      [id]
    );
    await client.query("DELETE FROM package_channels WHERE package_id = $1", [
      id,
    ]);
    await client.query(
      "DELETE FROM package_addons WHERE base_package_id = $1",
      [id]
    );

    const result = await client.query("DELETE FROM packages WHERE id = $1", [
      id,
    ]);

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        error: "Package already deleted or not found.",
      });
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      message: "Package and its links removed.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Package Delete Error:", err);

    // 🚀 FIX: REACTIVE FALLBACK
    // 23503 is the strict PostgreSQL code for "Foreign Key Violation"
    if (err.code === "23503") {
      return res.status(400).json({
        success: false,
        error:
          "Cannot delete this package because it is locked to historical contracts or versions.",
      });
    }

    res.status(500).json({
      success: false,
      error: "Database error during deletion.",
    });
  } finally {
    client.release();
  }
};

const getDecoders = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description 
      FROM additional_items 
      WHERE category = 'decoder' AND is_active = true
    `);
    res.json({ success: true, decoders: result.rows });
  } catch (err) {
    console.error("Get Decoders Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch decoders" });
  }
};

module.exports = {
  createPackage,
  getPackages,
  updatePackage,
  deletePackage,
  getEligibleChannels,
  getPackagesAdminPanel,
  getDecoders,
};
