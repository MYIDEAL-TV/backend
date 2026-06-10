const pool = require("../util/db");

// GET: Fetch all items with their regional prices
// const getAdditionalItems = async (req, res) => {
//   try {
//     // ✨ ENHANCEMENT: Group identical pricing rules together so the frontend
//     // multi-select pills populate perfectly on edit, and combine names for the preview.
//     const result = await pool.query(`
//       SELECT
//         ai.*,
//         COALESCE(
//           (
//             SELECT json_agg(
//               json_build_object(
//                 'upfront_price', sub.upfront_price,
//                 'monthly_price', sub.monthly_price,
//                 'currency', sub.currency,
//                 'location_ids', sub.location_ids,
//                 'location_name', sub.location_names
//               )
//             )
//             FROM (
//               SELECT
//                 aip.upfront_price,
//                 aip.monthly_price,
//                 aip.currency,
//                 array_agg(aip.location_id) as location_ids,
//                 string_agg(l.name, ', ') as location_names
//               FROM additional_item_prices aip
//               LEFT JOIN locations l ON aip.location_id = l.id
//               WHERE aip.item_id = ai.id
//               GROUP BY aip.upfront_price, aip.monthly_price, aip.currency
//             ) sub
//           ),
//           '[]'::json
//         ) AS prices
//       FROM additional_items ai
//       ORDER BY ai.created_at DESC
//     `);
//     res.json({ success: true, items: result.rows });
//   } catch (err) {
//     console.error("Get Items Error:", err);
//     res.status(500).json({ success: false, error: "Failed to fetch items" });
//   }
// };

// // POST: Create a new item and its regional prices
// const createAdditionalItem = async (req, res) => {
//   const { name, description, category, is_active, prices } = req.body;
//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     // 1. Insert Master Item
//     const itemRes = await client.query(
//       `INSERT INTO additional_items (name, description, category, is_active)
//        VALUES ($1, $2, $3, $4) RETURNING id`,
//       [name, description, category, is_active]
//     );
//     const newItemId = itemRes.rows[0].id;

//     // 2. Insert Pricing Rows
//     if (prices && prices.length > 0) {
//       for (let price of prices) {
//         // ✨ FIX: Loop through the new location_ids array
//         if (price.location_ids && price.location_ids.length > 0) {
//           for (let locId of price.location_ids) {
//             await client.query(
//               `INSERT INTO additional_item_prices (item_id, location_id, upfront_price, monthly_price, currency)
//                VALUES ($1, $2, $3, $4, $5)`,
//               [
//                 newItemId,
//                 locId, // Insert each individual location
//                 price.upfront_price,
//                 price.monthly_price,
//                 price.currency,
//               ]
//             );
//           }
//         }
//       }
//     }

//     await client.query("COMMIT");
//     res.json({ success: true, message: "Item created successfully" });
//   } catch (err) {
//     await client.query("ROLLBACK");
//     console.error("Create Item Error:", err);
//     res.status(500).json({ success: false, error: "Failed to create item" });
//   } finally {
//     client.release();
//   }
// };

// // PUT: Update an item and completely sync its prices
// const updateAdditionalItem = async (req, res) => {
//   const { id } = req.params;
//   const { name, description, category, is_active, prices } = req.body;
//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     // 1. Update Master Item
//     await client.query(
//       `UPDATE additional_items SET name = $1, description = $2, category = $3, is_active = $4 WHERE id = $5`,
//       [name, description, category, is_active, id]
//     );

//     // 2. Wipe old prices and insert new ones (safest sync method)
//     await client.query(
//       `DELETE FROM additional_item_prices WHERE item_id = $1`,
//       [id]
//     );

//     // 3. Insert new Pricing Rows
//     if (prices && prices.length > 0) {
//       for (let price of prices) {
//         // ✨ FIX: Loop through the new location_ids array
//         if (price.location_ids && price.location_ids.length > 0) {
//           for (let locId of price.location_ids) {
//             await client.query(
//               `INSERT INTO additional_item_prices (item_id, location_id, upfront_price, monthly_price, currency)
//                VALUES ($1, $2, $3, $4, $5)`,
//               [
//                 id,
//                 locId, // Insert each individual location
//                 price.upfront_price,
//                 price.monthly_price,
//                 price.currency,
//               ]
//             );
//           }
//         }
//       }
//     }

//     await client.query("COMMIT");
//     res.json({ success: true, message: "Item updated successfully" });
//   } catch (err) {
//     await client.query("ROLLBACK");
//     console.error("Update Item Error:", err);
//     res.status(500).json({ success: false, error: "Failed to update item" });
//   } finally {
//     client.release();
//   }
// };

const getAdditionalItems = async (req, res) => {
  try {
    // ✨ ENHANCEMENT: Group identical pricing rules together so the frontend
    // multi-select pills populate perfectly on edit, and combine names for the preview.
    // 🚀 NEW: Added package_ids subquery to map compatible packages.
    const result = await pool.query(`
      SELECT 
        ai.*,
        COALESCE(
          (SELECT json_agg(package_id) 
           FROM package_item_compatibility 
           WHERE item_id = ai.id), 
          '[]'::json
        ) AS package_ids,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'upfront_price', sub.upfront_price,
                'monthly_price', sub.monthly_price,
                'currency', sub.currency,
                'location_ids', sub.location_ids,
                'location_name', sub.location_names
              )
            )
            FROM (
              SELECT 
                aip.upfront_price,
                aip.monthly_price,
                aip.currency,
                array_agg(aip.location_id) as location_ids,
                string_agg(l.name, ', ') as location_names
              FROM additional_item_prices aip
              LEFT JOIN locations l ON aip.location_id = l.id
              WHERE aip.item_id = ai.id
              GROUP BY aip.upfront_price, aip.monthly_price, aip.currency
            ) sub
          ),
          '[]'::json
        ) AS prices
      FROM additional_items ai
      ORDER BY ai.created_at DESC
    `);
    res.json({ success: true, items: result.rows });
  } catch (err) {
    console.error("Get Items Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch items" });
  }
};

// POST: Create a new item and its regional prices
const createAdditionalItem = async (req, res) => {
  // 🚀 NEW: Extract package_ids from req.body
  const { name, description, category, is_active, prices, package_ids } =
    req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Insert Master Item
    const itemRes = await client.query(
      `INSERT INTO additional_items (name, description, category, is_active) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, description, category, is_active]
    );
    const newItemId = itemRes.rows[0].id;

    // 2. Insert Pricing Rows
    if (prices && prices.length > 0) {
      for (let price of prices) {
        // ✨ FIX: Loop through the new location_ids array
        if (price.location_ids && price.location_ids.length > 0) {
          for (let locId of price.location_ids) {
            await client.query(
              `INSERT INTO additional_item_prices (item_id, location_id, upfront_price, monthly_price, currency) 
               VALUES ($1, $2, $3, $4, $5)`,
              [
                newItemId,
                locId, // Insert each individual location
                price.upfront_price,
                price.monthly_price,
                price.currency,
              ]
            );
          }
        }
      }
    }

    // 🚀 NEW: Link to selected packages
    const packageIds = package_ids || [];
    if (packageIds.length > 0) {
      // Builds dynamic insert: ($1, $2), ($1, $3)
      const pkgValues = packageIds.map((_, i) => `($1, $${i + 2})`).join(", ");
      await client.query(
        `INSERT INTO package_item_compatibility (item_id, package_id) VALUES ${pkgValues}`,
        [newItemId, ...packageIds]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Item created successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create Item Error:", err);
    res.status(500).json({ success: false, error: "Failed to create item" });
  } finally {
    client.release();
  }
};

// PUT: Update an item and completely sync its prices
const updateAdditionalItem = async (req, res) => {
  const { id } = req.params;
  // 🚀 NEW: Extract package_ids from req.body
  const { name, description, category, is_active, prices, package_ids } =
    req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Update Master Item
    await client.query(
      `UPDATE additional_items SET name = $1, description = $2, category = $3, is_active = $4 WHERE id = $5`,
      [name, description, category, is_active, id]
    );

    // 2. Wipe old prices and insert new ones (safest sync method)
    await client.query(
      `DELETE FROM additional_item_prices WHERE item_id = $1`,
      [id]
    );

    // 3. Insert new Pricing Rows
    if (prices && prices.length > 0) {
      for (let price of prices) {
        // ✨ FIX: Loop through the new location_ids array
        if (price.location_ids && price.location_ids.length > 0) {
          for (let locId of price.location_ids) {
            await client.query(
              `INSERT INTO additional_item_prices (item_id, location_id, upfront_price, monthly_price, currency) 
               VALUES ($1, $2, $3, $4, $5)`,
              [
                id,
                locId, // Insert each individual location
                price.upfront_price,
                price.monthly_price,
                price.currency,
              ]
            );
          }
        }
      }
    }

    // 🚀 NEW: Update package links
    const packageIds = package_ids || [];

    // Wipe old package links
    await client.query(
      `DELETE FROM package_item_compatibility WHERE item_id = $1`,
      [id]
    );

    // Insert new package links
    if (packageIds.length > 0) {
      const pkgValues = packageIds.map((_, i) => `($1, $${i + 2})`).join(", ");
      await client.query(
        `INSERT INTO package_item_compatibility (item_id, package_id) VALUES ${pkgValues}`,
        [id, ...packageIds]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Item updated successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update Item Error:", err);
    res.status(500).json({ success: false, error: "Failed to update item" });
  } finally {
    client.release();
  }
};

const deleteAdditionalItem = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. PROTECTION: Check if the item is linked to any packages
    // This table maps which items are available for which plans.
    const linkedCheck = await pool.query(
      `SELECT package_id FROM package_item_compatibility WHERE item_id = $1 LIMIT 1`,
      [id]
    );

    if (linkedCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error:
          "This item is currently linked to one or more Packages. You must unlink it from all packages before it can be deleted.",
      });
    }

    // 3. If no external links exist, proceed with deletion
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete internal regional pricing first
      await client.query(
        `DELETE FROM additional_item_prices WHERE item_id = $1`,
        [id]
      );

      // Delete the master item record
      const result = await client.query(
        `DELETE FROM additional_items WHERE id = $1`,
        [id]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ success: false, error: "Item not found." });
      }

      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Item and its prices deleted successfully.",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err; // Pass to the outer catch
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Delete Item Error:", err);
    res.status(500).json({
      success: false,
      error:
        "Failed to delete item. It may be referenced by historical contract data.",
    });
  }
};

module.exports = {
  getAdditionalItems,
  createAdditionalItem,
  updateAdditionalItem,
  deleteAdditionalItem,
};
