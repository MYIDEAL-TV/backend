const pool = require("../util/db");

const getChannels = async (req, res) => {
  try {
    // We use a subquery with json_agg to bundle the assigned region IDs into an array!
    const result = await pool.query(`
      SELECT 
        c.*,
        COALESCE(
          (SELECT json_agg(location_id) FROM channel_locations WHERE channel_id = c.id), 
          '[]'::json
        ) AS location_ids
      FROM channels c
      ORDER BY c.created_at DESC
    `);

    res.json({ success: true, channels: result.rows });
  } catch (err) {
    console.error("Get Channels Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error while fetching channels.",
    });
  }
};

const createChannel = async (req, res) => {
  let {
    name,
    description,
    status,
    monthly_cost,
    stream_url,
    logo_url,
    flex_eligible,
    is_iptv,
    is_satellite,
    location_ids,
  } = req.body;
  const client = await pool.connect();
  if (status === "Offline") {
    status = "Inactive";
  } else {
    status = "Active";
  }
  console.log("Creating Channel with data:", req.body);
  try {
    await client.query("BEGIN");

    // 1. Insert the channel with the new boolean fields
    const channelResult = await client.query(
      `INSERT INTO channels (name, description, status, monthly_cost, stream_url, logo_url, flex_eligible, is_iptv, is_satellite) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        name,
        description || null,
        status || "Active",
        monthly_cost || 0,
        stream_url || "",
        logo_url || "",
        flex_eligible || false,
        is_iptv || false,
        is_satellite || false,
      ]
    );
    const newChannelId = channelResult.rows[0].id;

    // 2. Insert into the channel_locations junction table (Multi-Region Support)
    if (location_ids && location_ids.length > 0) {
      const values = [];
      const queryParts = [];
      let i = 1;

      values.push(newChannelId);
      location_ids.forEach((locId) => {
        i++;
        values.push(locId);
        queryParts.push(`($1, $${i})`);
      });

      await client.query(
        `INSERT INTO channel_locations (channel_id, location_id) VALUES ${queryParts.join(
          ", "
        )}`,
        values
      );
    }

    await client.query("COMMIT");

    // Append the location_ids back to the response object for the frontend
    const newChannel = channelResult.rows[0];
    newChannel.location_ids = location_ids || [];

    res.status(201).json({ success: true, channel: newChannel });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create Channel Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Database rejected the channel entry." });
  } finally {
    client.release();
  }
};

const updateChannel = async (req, res) => {
  const { id } = req.params;
  let {
    name,
    description,
    status,
    monthly_cost,
    stream_url,
    logo_url,
    flex_eligible,
    is_iptv,
    is_satellite,
    location_ids,
  } = req.body;

  if (!id || id === "undefined") {
    return res
      .status(400)
      .json({ success: false, error: "Invalid Channel ID provided." });
  }

  const client = await pool.connect();
  if (status === "Offline") {
    status = "Inactive";
  } else {
    status = "Active";
  }
  try {
    await client.query("BEGIN");

    // 1. Update the main channel record
    const result = await client.query(
      `UPDATE channels 
       SET name = $1, description = $2, status = $3, monthly_cost = $4, stream_url = $5, logo_url = $6, flex_eligible = $7, is_iptv = $8, is_satellite = $9
       WHERE id = $10 
       RETURNING *`,
      [
        name,
        description,
        status,
        monthly_cost,
        stream_url,
        logo_url,
        flex_eligible,
        is_iptv,
        is_satellite,
        id,
      ]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "Channel not found." });
    }

    // 2. Wipe existing region mappings for this channel
    await client.query("DELETE FROM channel_locations WHERE channel_id = $1", [
      id,
    ]);

    // 3. Insert the newly selected regions
    if (location_ids && location_ids.length > 0) {
      const values = [];
      const queryParts = [];
      let i = 1;

      values.push(id);
      location_ids.forEach((locId) => {
        i++;
        values.push(locId);
        queryParts.push(`($1, $${i})`);
      });

      await client.query(
        `INSERT INTO channel_locations (channel_id, location_id) VALUES ${queryParts.join(
          ", "
        )}`,
        values
      );
    }

    await client.query("COMMIT");

    const updatedChannel = result.rows[0];
    updatedChannel.location_ids = location_ids || [];

    res.json({ success: true, channel: updatedChannel });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update Channel Error:", err);
    res.status(500).json({ success: false, error: "Database update failed." });
  } finally {
    client.release();
  }
};

const deleteChannel = async (req, res) => {
  const { id } = req.params;

  // 1. Check if the channel is locked in any packages
  const checkPackages = await pool.query(
    "SELECT COUNT(*) FROM package_channels WHERE channel_id = $1",
    [id]
  );

  if (parseInt(checkPackages.rows[0].count) > 0) {
    return res.status(400).json({
      success: false,
      error: `Cannot delete: This channel is currently fixed inside ${checkPackages.rows[0].count} package(s). Please remove it from the package(s) first to ensure tier math stays valid.`,
    });
  }

  // 2. If it's safe (count is 0), proceed with deletion...
  await pool.query("DELETE FROM channels WHERE id = $1", [id]);
  res.json({ success: true, message: "Channel deleted." });
};

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
};
