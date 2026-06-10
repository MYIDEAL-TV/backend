const pool = require("../util/db");

const getActiveServiceFees = async (req, res) => {
  try {
    // Direct SQL query using the pg pool
    const query = 'SELECT * FROM public.location_service_fees WHERE is_active = true;';
    const { rows } = await pool.query(query);

    return res.status(200).json({
      success: true,
      fees: rows, // pg returns the data in the 'rows' array
    });
  } catch (error) {
    console.error("❌ Error fetching service fees:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service fees",
      error: error.message,
    });
  }
};

module.exports = {
  getActiveServiceFees,
};