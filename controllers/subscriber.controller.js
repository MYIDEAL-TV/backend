const pool = require("../util/db");

const getSubscribers = async (req, res) => {
  try {
    const { status } = req.query;

    let statusFilter = "";
    const queryParams = [];

    // Filters the subscriptions cleanly
    if (status && status !== "all") {
      statusFilter = "WHERE s.status = $1";
      queryParams.push(status);
    }

    const result = await pool.query(
      `
      WITH SubscriberData AS (
        SELECT 
          sub.id AS subscriber_id,
          sub.first_name,
          sub.last_name,
          sub.email,
          sub.cell_phone,
          sub.company_name,
          sub.created_at AS joined_date,
          
          -- Subscription details
          s.id AS subscription_id,
          s.location AS regional_location,
          s.accommodation_name,
          s.nickname,
          s.status AS subscription_status,
          
          -- Active Version details
          p.name AS current_package_name,
          sv.monthly_total_price,
          sv.currency,
          sv.start_date,
          sv.end_date,
          
          -- 🚀 Pulling ONLY the exact Contract Payload (hardware_snapshot removed)
          c.contract_snapshot,
          c.signnow_document_id,
          
          -- Flex Channels Subquery
          COALESCE(
            (
              SELECT json_agg(json_build_object(
                'id', ch.id, 
                'name', ch.name, 
                'logo_url', ch.logo_url
              ))
              FROM subscription_flex_channels sfc
              JOIN channels ch ON sfc.channel_id = ch.id
              WHERE sfc.version_id = sv.id 
            ), 
            '[]'::json
          ) AS selected_flex_channels

        FROM subscribers sub
        LEFT JOIN subscriptions s ON sub.id = s.subscriber_id
        LEFT JOIN subscription_versions sv ON s.current_version_id = sv.id
        LEFT JOIN packages p ON sv.plan_id = p.id
        LEFT JOIN contracts c ON s.id = c.subscription_id
        ${statusFilter}
      )
      
      -- Main Query: Grouping everything into 1 row per subscriber
      SELECT 
        subscriber_id,
        first_name,
        last_name,
        email,
        cell_phone,
        company_name,
        joined_date,
        -- Aggregate all contracts into a single array
        COALESCE(
          json_agg(
            json_build_object(
              'subscription_id', subscription_id,
              'regional_location', regional_location,
              'accommodation_name', accommodation_name,
              'nickname', nickname,
              'current_package_name', current_package_name,
              'subscription_status', subscription_status,
              'monthly_total_price', monthly_total_price,
              'currency', currency,
              'start_date', start_date,
              'end_date', end_date,
              'contract_snapshot', contract_snapshot, 
              'signnow_document_id', signnow_document_id, 
              'selected_flex_channels', selected_flex_channels
            )
          ) FILTER (WHERE subscription_id IS NOT NULL), 
          '[]'::json
        ) AS subscriptions
      FROM SubscriberData
      GROUP BY 
        subscriber_id, first_name, last_name, email, cell_phone, company_name, joined_date
      ORDER BY joined_date DESC
    `,
      queryParams
    );

    res.json({ success: true, subscribers: result.rows });
  } catch (err) {
    console.error("Get Subscribers Error:", err);
    res.status(500).json({
      success: false,
      error: "Database error while fetching subscriber dossiers.",
    });
  }
};

module.exports = { getSubscribers };
