const pool = require("../util/db");

// GET: Fetch everything for the dashboard
const getCustomerDashboard = async (req, res) => {
  const userId = req.user.id; // Assuming you have an auth middleware extracting the user ID

  try {
    // 1. Fetch Identity & Business Profile
    const profileRes = await pool.query(
      `
      SELECT 
        su.full_name, su.email,
        s.id AS subscriber_id, s.cell_phone, s.company_name, s.address, s.city, s.postal_code
      FROM staff_users su
      LEFT JOIN subscribers s ON s.user_id = su.id
      WHERE su.id = $1
    `,
      [userId]
    );

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }
    const profile = profileRes.rows[0];

    // 2. Fetch Subscriptions (Active & Drafts) & Contracts
    // We join contracts to get the signnow_link and created_at date for pending items
    const subsRes = await pool.query(
      `
      SELECT 
        sub.id AS subscription_id, 
        sub.status AS sub_status, 
        sub.nickname, 
        sub.created_at,
        c.id AS contract_id, 
        c.status AS contract_status, 
        c.signnow_link,
        c.created_at AS contract_created_at
      FROM subscriptions sub
      LEFT JOIN contracts c ON c.subscription_id = sub.id
      WHERE sub.subscriber_id = $1
      ORDER BY sub.created_at DESC
    `,
      [profile.subscriber_id]
    );

    const allSubs = subsRes.rows;

    // Categorize them for the frontend
    const activeSubscriptions = allSubs.filter(
      (s) => s.sub_status === "active"
    );
    const pendingContracts = allSubs.filter(
      (s) => s.contract_status === "pending" || s.sub_status === "draft"
    );

    const proposalsRes = await pool.query(
      `SELECT id, created_at, updated_at, form_data 
   FROM proposals 
   WHERE created_by_user_id = $1 AND status = 'draft'
   ORDER BY updated_at DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      profile,
      activeSubscriptions,
      pendingContracts,
      savedProposals: proposalsRes.rows,
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT: Update Profile Info
const updateCustomerProfile = async (req, res) => {
  const userId = req.user.id;
  const { fullName, phone, companyName, address, city, postalCode } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Update Identity (Name only, Email is locked)
    await client.query(
      `
      UPDATE staff_users SET full_name = $1, updated_at = NOW() WHERE id = $2
    `,
      [fullName, userId]
    );

    // 2. Update Business Profile
    await client.query(
      `
      UPDATE subscribers 
      SET cell_phone = $1, company_name = $2, address = $3, city = $4, postal_code = $5, updated_at = NOW()
      WHERE user_id = $6
    `,
      [phone, companyName, address, city, postalCode, userId]
    );

    await client.query("COMMIT");
    res.status(200).json({ success: true, message: "Profile updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

const updateSubscriptionNickname = async (req, res) => {
  const { subId } = req.params;
  const { nickname } = req.body;

  try {
    const result = await pool.query(
      `UPDATE public.subscriptions 
       SET nickname = $1 
       WHERE id = $2`,
      [nickname, subId]
    );

    // ==========================================================
    // THE HONESTY CHECK
    // ==========================================================
    if (result.rowCount === 0) {
      // If result.rowCount is 0, the query ran but no row matched the subId.
      return res.status(404).json({
        success: false,
        error: `Update failed. No subscription found with ID: ${subId}`,
      });
    }

    res.status(200).json({ success: true, message: "Nickname updated." });
  } catch (err) {
    console.error("❌ SQL Error:", err.message);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

const getSubscriptionDetails = async (req, res) => {
  const { subId } = req.params;

  try {
    // 1. Fetch from subscriptions and join contracts
    const result = await pool.query(
      `
      SELECT 
        s.id, 
        s.status, 
        s.nickname,
        c.contract_snapshot
      FROM public.subscriptions s
      JOIN public.contracts c ON c.subscription_id = s.id
      WHERE s.id = $1
      ORDER BY c.created_at DESC
      LIMIT 1
      `,
      [subId]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Subscription or Contract details not found" });
    }

    const row = result.rows[0];

    // 2. Parse the snapshot safely
    const snap =
      typeof row.contract_snapshot === "string"
        ? JSON.parse(row.contract_snapshot)
        : row.contract_snapshot || {};

    // ---------------------------------------------------------
    // 🚀 DYNAMIC MATH CALCULATION (Bulletproof Fallback)
    // ---------------------------------------------------------
    const taxRate = Number(snap.taxAmount) || 0;
    const planQty = Number(snap.planQuantity) || 1;
    const addlScreens = Number(snap.additionalScreens) || 0;

    // Determine screen unit cost (Fallback to 20 for St. Barth, 10 otherwise)
    const locId = snap.location?.id || snap.location || "";

    // 🚀 NEW: Dynamically fetch the real screen cost from your locations table
    let dbScreenCost = 10; // Global default fallback
    try {
      // Try to match the location by ID or Name
      const locQuery = await pool.query(
        `SELECT additional_screen_cost FROM locations 
         WHERE id::text = $1 OR name ILIKE $2 LIMIT 1`,
        [locId, `%${locId.replace(/-/g, " ")}%`]
      );
      if (locQuery.rows.length > 0 && locQuery.rows[0].additional_screen_cost) {
        dbScreenCost = Number(locQuery.rows[0].additional_screen_cost);
      }
    } catch (e) {
      console.error("Failed to fetch location screen cost, using fallback", e);
    }

    const screenUnitCost =
      Number(snap.additionalScreenUnitCost) || dbScreenCost;

    const addonsArray = snap.addons || snap.addonsWithPrices || [];
    const decodersArray = snap.selectedDecoders || [];
    const feesArray = snap.selectedFees || [];

    // --- MONTHLY HT CALCULATION ---
    const planHT = (Number(snap.selectedPlan?.price) || 0) * planQty;
    const addonsHT = addonsArray.reduce((sum, a) => {
      const q =
        a.quantity !== undefined && a.quantity !== null
          ? Number(a.quantity)
          : planQty;
      return sum + (Number(a.price) || 0) * q;
    }, 0);
    const screensHT = addlScreens * screenUnitCost;
    const decodersMonthlyHT = decodersArray.reduce((sum, d) => {
      return sum + (Number(d.monthlyPrice) || 0) * (Number(d.quantity) || 1);
    }, 0);
    const customMonthlyHT = Number(snap.customItemPrice) || 0;

    // Note: extraFlexCost is intentionally excluded here because your frontend
    // already injects Extra Flex Channels into the addonsArray!
    const calculatedMonthlyHT =
      planHT + addonsHT + screensHT + decodersMonthlyHT + customMonthlyHT;
    const calculatedMonthlyTaxes = calculatedMonthlyHT * taxRate;
    const calculatedMonthlyTotal = calculatedMonthlyHT + calculatedMonthlyTaxes;

    // --- ONE-TIME HT CALCULATION ---
    const decodersUpfrontHT = decodersArray.reduce((sum, d) => {
      return sum + (Number(d.upfrontPrice) || 0) * (Number(d.quantity) || 1);
    }, 0);
    const feesHT = feesArray.reduce(
      (sum, f) => sum + (Number(f.price) || 0),
      0
    );
    const autrePoncHT = Number(snap.autrePoncCost) || 0;

    const calculatedOneTimeHT = decodersUpfrontHT + feesHT + autrePoncHT;
    const calculatedOneTimeTaxes = calculatedOneTimeHT * taxRate;
    const calculatedOneTimeTotal = calculatedOneTimeHT + calculatedOneTimeTaxes;

    // ---------------------------------------------------------
    // 3. MAP EXACTLY TO WHAT THE FRONTEND MODAL EXPECTS
    // ---------------------------------------------------------
    const formattedDetails = {
      // Core Plan
      selectedPlan: snap.selectedPlan || {
        name: "Unknown Package",
        price: snap.planPrice || 0,
      },
      planQuantity: planQty,
      additionalScreens: addlScreens,
      totalScreens: snap.totalScreens || planQty + addlScreens,
      contractType:
        snap.planInfo?.contractType || snap.contractType || "individual",
      currency: snap.currency || (locId === "sint-maarten" ? "USD" : "EUR"),

      // Add-ons & Flex
      addons: addonsArray,
      extraFlexCost: Number(snap.extraFlexCost) || 0,
      customItemName: snap.customItemName || "",
      customItemPrice: Number(snap.customItemPrice) || 0,

      // Hardware
      selectedDecoders: decodersArray,
      decoderRental: snap.decoderRental ?? false,

      // Fees & One-Time
      selectedFees: feesArray,
      autrePoncText: snap.autrePoncText || "",
      autrePoncCost: autrePoncHT,

      // Tax Info
      taxDesc: snap.taxDesc || "Tax",
      taxAmount: taxRate,

      // 🚀 Use the snapshot totals if they exist, otherwise use our bulletproof calculations
      monthlyHT: snap.Tot_HT || calculatedMonthlyHT,
      monthlyTaxes: snap.Tot_Taxes || calculatedMonthlyTaxes,
      monthlyTotal:
        snap.Tot_Mensuel || snap.monthly_total || calculatedMonthlyTotal,

      oneTimeHT: snap.Tot_HT_Ponc || calculatedOneTimeHT,
      oneTimeTaxes: snap.Tot_Taxes_Ponc || calculatedOneTimeTaxes,
      oneTimeTotal:
        snap.Tot_Ponc || snap.punctual_total || calculatedOneTimeTotal,
    };

    // 4. Send perfectly mapped response
    res.status(200).json({
      success: true,
      details: formattedDetails,
      status: row.status,
      nickname: row.nickname,
    });
  } catch (err) {
    console.error("[Subscription Details Error]:", err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getCustomerDashboard,
  updateCustomerProfile,
  updateSubscriptionNickname,
  getSubscriptionDetails,
};
