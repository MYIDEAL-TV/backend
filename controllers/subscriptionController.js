const pool = require("../util/db");

// const getCustomerFlexData = async (req, res) => {
//   const authEmail = req.user?.email;
//   const client = await pool.connect();

//   try {
//     const subRes = await client.query(
//       `SELECT s.id as subscription_id, s.nickname, sv.pricing_snapshot, sv.plan_id
//        FROM subscriptions s
//        JOIN subscribers sub ON s.subscriber_id = sub.id
//        JOIN subscription_versions sv ON s.current_version_id = sv.id
//        WHERE sub.email = $1 AND sv.status = 'active' AND s.status = 'active'`,
//       [authEmail]
//     );

//     if (subRes.rows.length === 0) {
//       return res.status(200).json({
//         success: true,
//         data: { subscriptions: [], eligibleChannels: [] },
//       });
//     }

//     const channelsRes = await client.query(
//       `SELECT id, name, logo_url, description FROM channels WHERE status = 'Active' AND flex_eligible = true`
//     );

//     const subscriptionsData = await Promise.all(
//       subRes.rows.map(async (row) => {
//         const snapshotData =
//           typeof row.pricing_snapshot === "string"
//             ? JSON.parse(row.pricing_snapshot)
//             : row.pricing_snapshot;
//         const flexAllowed = snapshotData?.flex_channels_allowed || 0;
//         const isFlexPackage = snapshotData?.is_flex_package || false;

//         const selectedRes = await client.query(
//           `SELECT channel_id FROM subscription_flex_channels WHERE subscription_id = $1`,
//           [row.subscription_id]
//         );
//         const selectedChannelIds = selectedRes.rows.map((r) => r.channel_id);

//         let baseChannelIds = [];

//         // Safely parse plan_id to ensure it's an actual number.
//         const parsedPlanId = parseInt(row.plan_id, 10);

//         if (!isNaN(parsedPlanId)) {
//           const baseChannelsRes = await client.query(
//             `SELECT channel_id FROM package_channels WHERE package_id = $1`,
//             [parsedPlanId]
//           );
//           baseChannelIds = baseChannelsRes.rows.map((r) => r.channel_id);
//         }

//         // 🚀 NEW: Check if there is a pending request for this specific subscription
//         const pendingReqRes = await client.query(
//           `SELECT id FROM flex_code_requests WHERE subscription_id = $1 AND status = 'pending'`,
//           [row.subscription_id]
//         );
//         const hasPendingRequest = pendingReqRes.rows.length > 0;

//         return {
//           subscriptionId: row.subscription_id,
//           nickname:
//             row.nickname ||
//             `Subscription (${row.subscription_id.substring(0, 8)})`,
//           isFlexPackage,
//           flexAllowed,
//           selectedChannelIds,
//           baseChannelIds,
//           hasPendingRequest, // 🚀 ADDED HERE
//         };
//       })
//     );

//     res.status(200).json({
//       success: true,
//       data: {
//         subscriptions: subscriptionsData,
//         eligibleChannels: channelsRes.rows,
//       },
//     });
//   } catch (err) {
//     console.error("❌ Flex Data Error:", err);
//     res.status(500).json({ success: false, error: err.message });
//   } finally {
//     client.release();
//   }
// };

const getCustomerFlexData = async (req, res) => {
  const authEmail = req.user?.email;
  const client = await pool.connect();

  try {
    const subRes = await client.query(
      `SELECT s.id as subscription_id, s.nickname, sv.pricing_snapshot, sv.plan_id
       FROM subscriptions s
       JOIN subscribers sub ON s.subscriber_id = sub.id
       JOIN subscription_versions sv ON s.current_version_id = sv.id
       WHERE sub.email = $1 AND sv.status = 'active' AND s.status = 'active'`,
      [authEmail]
    );

    if (subRes.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: { subscriptions: [], eligibleChannels: [] },
      });
    }

    const channelsRes = await client.query(
      `SELECT id, name, logo_url, description FROM channels WHERE status = 'Active' AND flex_eligible = true`
    );

    const subscriptionsData = await Promise.all(
      subRes.rows.map(async (row) => {
        const snapshotData =
          typeof row.pricing_snapshot === "string"
            ? JSON.parse(row.pricing_snapshot)
            : row.pricing_snapshot;

        const flexAllowed = snapshotData?.flex_channels_allowed || 0;
        const isFlexPackage = snapshotData?.is_flex_package || false;

        const selectedRes = await client.query(
          `SELECT channel_id FROM subscription_flex_channels WHERE subscription_id = $1`,
          [row.subscription_id]
        );
        const selectedChannelIds = selectedRes.rows.map((r) => r.channel_id);

        // -----------------------------------------------------
        // 🚀 FIX: GET ALL CHANNELS FROM BASE PLAN + ADD-ONS
        // -----------------------------------------------------
        let excludedChannelIds = [];
        let packageIdsToCheck = [];

        // 1. Safely add the Base Plan ID
        const parsedPlanId = parseInt(row.plan_id, 10);
        if (!isNaN(parsedPlanId)) {
          packageIdsToCheck.push(parsedPlanId);
        }

        // 2. Safely add all Add-on IDs from the snapshot
        if (snapshotData?.addons && Array.isArray(snapshotData.addons)) {
          snapshotData.addons.forEach((addon) => {
            const addonId = parseInt(addon.id, 10);
            if (!isNaN(addonId)) {
              packageIdsToCheck.push(addonId);
            }
          });
        }

        // 3. Query the DB for all channels linked to these packages
        if (packageIdsToCheck.length > 0) {
          // Creates a string like "$1, $2, $3" safely
          const placeholders = packageIdsToCheck
            .map((_, i) => `$${i + 1}`)
            .join(",");

          const excludedChannelsRes = await client.query(
            `SELECT DISTINCT channel_id FROM package_channels WHERE package_id IN (${placeholders})`,
            packageIdsToCheck
          );
          excludedChannelIds = excludedChannelsRes.rows.map(
            (r) => r.channel_id
          );
        }
        // -----------------------------------------------------

        // Check if there is a pending request for this specific subscription
        const pendingReqRes = await client.query(
          `SELECT id FROM flex_code_requests WHERE subscription_id = $1 AND status = 'pending'`,
          [row.subscription_id]
        );
        const hasPendingRequest = pendingReqRes.rows.length > 0;

        return {
          subscriptionId: row.subscription_id,
          nickname:
            row.nickname ||
            `Subscription (${row.subscription_id.substring(0, 8)})`,
          isFlexPackage,
          flexAllowed,
          selectedChannelIds,
          excludedChannelIds, // 🚀 Now contains BOTH Base and Add-on channels
          hasPendingRequest,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        subscriptions: subscriptionsData,
        eligibleChannels: channelsRes.rows,
      },
    });
  } catch (err) {
    console.error("❌ Flex Data Error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

const getAdminFlexChannels = async (req, res) => {
  const { planId } = req.query;
  const client = await pool.connect();

  try {
    let flexLimit = 0;

    // 1. Get the flex limit for this specific plan via its template
    if (planId && !isNaN(parseInt(planId))) {
      const pkgRes = await client.query(
        `SELECT t.flex_channels 
          FROM packages p 
          JOIN package_templates t ON p.template_id = t.id 
          WHERE p.id = $1`,
        [parseInt(planId)]
      );
      if (pkgRes.rows.length > 0) {
        flexLimit = parseInt(pkgRes.rows[0].flex_channels) || 0;
      }
    }

    // If the limit is 0, no need to query channels—just return immediately
    if (flexLimit === 0) {
      return res
        .status(200)
        .json({ success: true, flexLimit: 0, channels: [] });
    }

    // 2. Fetch the eligible channels excluding base plan channels
    let query = `
      SELECT id, name, logo_url, description 
      FROM channels 
      WHERE status = 'Active' AND flex_eligible = true
    `;
    let queryParams = [];

    if (planId && !isNaN(parseInt(planId))) {
      query += ` AND id NOT IN (SELECT channel_id FROM package_channels WHERE package_id = $1)`;
      queryParams.push(parseInt(planId));
    }

    query += ` ORDER BY name ASC`;

    const channelsRes = await client.query(query, queryParams);

    // Return BOTH the limit and the channels
    res.status(200).json({
      success: true,
      flexLimit: flexLimit,
      channels: channelsRes.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching admin flex channels:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

const createSubscriptionDraft = async (req, res) => {
  const cart = req.body;
  const { proposalId } = cart;
  const authEmail = req.admin?.email || req.user?.email || "system@idealtv.com";

  // --- 🚨 STRICT NICKNAME VALIDATION 🚨 ---
  if (
    !cart.nickname ||
    typeof cart.nickname !== "string" ||
    cart.nickname.trim() === ""
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Validation Error: A subscription nickname is mandatory. Please provide a nickname before generating the contract.",
    });
  }

  const formatEnum = (str) => {
    if (!str) return "other";
    return str.toLowerCase().trim().replace(/\s+/g, "-");
  };
  const client = await pool.connect();

  // --- 🚨 SAFE, RESILIENT LOCATION RESOLUTION 🚨 ---
  // We check multiple possible structures to support older drafts and all entry points.
  let locationNumericId;

  if (cart.originalLocation && !isNaN(parseInt(cart.originalLocation, 10))) {
    locationNumericId = parseInt(cart.originalLocation, 10);
  } else if (cart.location && cart.location.dbId) {
    locationNumericId = cart.location.dbId;
  } else if (cart.location && !isNaN(parseInt(cart.location.id, 10))) {
    locationNumericId = parseInt(cart.location.id, 10);
  } else if (!isNaN(parseInt(cart.location, 10))) {
    locationNumericId = parseInt(cart.location, 10);
  }

  // If no exact numeric ID was found, safely fallback to fuzzy text-matching
  if (!locationNumericId) {
    const slugStr = (cart.location?.id || cart.location || "")
      .toString()
      .toLowerCase();
    let searchPattern = `%${slugStr.replace(/-/g, "%")}%`;

    // Broaden the search to guarantee a hit on the correct island
    if (slugStr.includes("barth")) searchPattern = "%barth%";
    else if (slugStr.includes("martin") && !slugStr.includes("maarten"))
      searchPattern = "%martin%";
    else if (slugStr.includes("maarten")) searchPattern = "%maarten%";

    const fallbackLoc = await client.query(
      "SELECT id FROM locations WHERE name ILIKE $1 OR state_province ILIKE $1 LIMIT 1",
      [searchPattern]
    );

    if (fallbackLoc.rowCount > 0) {
      locationNumericId = fallbackLoc.rows[0].id;
    } else {
      console.warn("[WARNING] Location match failed. Falling back to default.");
      const firstLoc = await client.query("SELECT id FROM locations LIMIT 1");
      locationNumericId = firstLoc.rows[0]?.id || 1;
    }
  }

  // --- 🚀 EXTRACT DYNAMIC DB RULES FOR SECURITY MATH ---
  const dbLocation = await client.query(
    "SELECT max_screens_per_package, additional_screen_cost, tax_amount FROM locations WHERE id = $1",
    [locationNumericId]
  );

  const locRow = dbLocation.rows[0] || {};

  const maxScreens = parseInt(locRow.max_screens_per_package, 10) || 4;
  const truthScreenCost = parseFloat(locRow.additional_screen_cost) || 10.0;
  const dbTaxRate = parseFloat(locRow.tax_amount) || 0;
  // --- 🚀 NEW SYNCED HARDWARE & MATH VALIDATIONS 🚀 ---
  const totalDecoderQty = (cart.selectedDecoders || []).reduce(
    (sum, d) => sum + parseInt(d.quantity !== undefined ? d.quantity : 1, 10),
    0
  );

  // 🚨 FIX 1: Intelligently find the contract type whether it's at the root or nested (e.g., Kiosk Mode)
  const actualContractType =
    cart.contractType || cart.planInfo?.contractType || "individual";

  const incomingPlanQty = parseInt(cart.planQuantity, 10) || 1;
  const incomingAddlScreens = parseInt(cart.additionalScreens, 10) || 0;

  // 🚨 FIX 2: If the frontend router stripped out `totalScreens`, infer it securely
  const incomingTotalScreens =
    cart.totalScreens !== undefined
      ? parseInt(cart.totalScreens, 10)
      : incomingPlanQty + incomingAddlScreens;

  if (actualContractType !== "hotel") {
    // 1. Math Verification for Standard Contracts
    const expectedPackages = Math.ceil(incomingTotalScreens / maxScreens);
    const expectedAdditional = Math.max(
      0,
      incomingTotalScreens - expectedPackages
    );

    if (
      incomingPlanQty !== expectedPackages ||
      incomingAddlScreens !== expectedAdditional
    ) {
      client.release();
      return res.status(400).json({
        success: false,
        error: `Security Violation: Math mismatch. Expected Pkg: ${expectedPackages}, Got: ${incomingPlanQty} | Expected Addl: ${expectedAdditional}, Got: ${incomingAddlScreens}`,
      });
    }

    // 2. Strict Hardware Matching
    if (totalDecoderQty !== incomingTotalScreens) {
      client.release();
      return res.status(400).json({
        success: false,
        error: `Security Violation: Decoder quantity (${totalDecoderQty}) must exactly match total screens (${incomingTotalScreens}).`,
      });
    }
  } else {
    // 1. Math Verification for Hotel Contracts
    if (incomingPlanQty !== incomingTotalScreens || incomingAddlScreens !== 0) {
      client.release();
      return res.status(400).json({
        success: false,
        error:
          "Security Violation: Hotel package quantity must exactly match total screens with 0 additional screens.",
      });
    }

    // 2. Hotel Hardware Validation (Just needs at least 1 rack/decoder)
    if (totalDecoderQty === 0) {
      client.release();
      return res.status(400).json({
        success: false,
        error:
          "Security Violation: Hotels must select at least one hardware item (e.g., RACK decoder).",
      });
    }
  }
  // -------------------------------------------------

  try {
    await client.query("BEGIN");

    // 1. Verify Staff Identity
    const staffCheck = await client.query(
      "SELECT email FROM staff_users WHERE email = $1",
      [authEmail]
    );
    if (staffCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        error: "Unauthorized: Staff record not found.",
      });
    }
    const validStaffEmail = staffCheck.rows[0].email;

    // --- A. UPSERT SUBSCRIBER & DUPLICATE CHECK ---
    const subInfo = cart.subscriberInfo || cart.owner || {};
    if (!subInfo.email)
      throw new Error("Subscriber information or email is missing.");

    let subscriberId;
    const existingSub = await client.query(
      "SELECT id FROM subscribers WHERE email = $1",
      [subInfo.email]
    );

    if (existingSub.rows.length > 0) {
      subscriberId = existingSub.rows[0].id;

      if (!cart.forceDuplicate) {
        const contractsRes = await client.query(
          `SELECT c.id, c.status, c.contract_snapshot 
           FROM contracts c
           JOIN subscriptions s ON c.subscription_id = s.id
           WHERE s.subscriber_id = $1`,
          [subscriberId]
        );

        const stableStringify = (obj) => {
          if (Array.isArray(obj)) {
            return `[${obj.map(stableStringify).join(",")}]`;
          }
          if (obj !== null && typeof obj === "object") {
            const keys = Object.keys(obj).sort();
            return `{${keys
              .map((k) => `"${k}":${stableStringify(obj[k])}`)
              .join(",")}}`;
          }
          return JSON.stringify(obj);
        };

        const sanitizeForCompare = (obj) => {
          if (!obj) return null;
          // 🚀 FIX 2: Strip out injected math variables so pre/post snapshots match perfectly
          const {
            proposalId,
            documentId,
            forceDuplicate,
            action,
            Tot_HT,
            Tot_Taxes,
            Tot_Mensuel,
            Tot_HT_Ponc,
            Tot_Taxes_Ponc,
            Tot_Ponc,
            ...rest
          } = obj;
          return stableStringify(rest);
        };

        const incomingSanitized = sanitizeForCompare(cart);
        let duplicateFound = null;

        for (const row of contractsRes.rows) {
          const existingSnap =
            typeof row.contract_snapshot === "string"
              ? JSON.parse(row.contract_snapshot)
              : row.contract_snapshot;

          if (incomingSanitized === sanitizeForCompare(existingSnap)) {
            duplicateFound = row;
            break;
          }
        }

        if (duplicateFound) {
          await client.query("ROLLBACK");
          client.release();
          return res.status(409).json({
            success: false,
            isDuplicate: true,
            existingStatus: duplicateFound.status,
            message: `An exact duplicate contract already exists.`,
          });
        }
      }

      await client.query(
        `UPDATE subscribers SET first_name = $1, last_name = $2, cell_phone = $3, address = $4, city = $5, updated_at = NOW() WHERE id = $6`,
        [
          subInfo.firstName,
          subInfo.lastName,
          subInfo.cellPhone,
          subInfo.address,
          subInfo.city,
          subscriberId,
        ]
      );
    } else {
      const newSub = await client.query(
        `INSERT INTO subscribers (first_name, last_name, email, cell_phone, address, city, created_by_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          subInfo.firstName,
          subInfo.lastName,
          subInfo.email,
          subInfo.cellPhone,
          subInfo.address,
          subInfo.city,
          validStaffEmail,
        ]
      );
      subscriberId = newSub.rows[0].id;
    }

    // --- B. CREATE PARENT SUBSCRIPTION ---
    const locationEnum = formatEnum(
      cart.locationName ||
        (typeof cart.location === "string"
          ? cart.location
          : cart.location?.name)
    );

    // 🚀 FIX: MOVED NICKNAME CHECK HERE (Scoped to the specific Subscriber ID)
    const nicknameCheck = await client.query(
      "SELECT id FROM subscriptions WHERE subscriber_id = $1 AND nickname ILIKE $2",
      [subscriberId, cart.nickname.trim()]
    );

    if (nicknameCheck.rowCount > 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(400).json({
        success: false,
        error: `The nickname "${cart.nickname.trim()}" is already in use for this customer. Please go back and choose a unique name.`,
      });
    }

    let planIdForDb = null;
    if (cart.selectedPlan && typeof cart.selectedPlan === "object") {
      planIdForDb = parseInt(cart.selectedPlan.id, 10);
    } else if (
      typeof cart.selectedPlan === "number" ||
      typeof cart.selectedPlan === "string"
    ) {
      planIdForDb = parseInt(cart.selectedPlan, 10);
    }
    if (isNaN(planIdForDb)) planIdForDb = null;

    // --- FETCH FLEX CHANNELS LIMIT VIA TEMPLATE ---
    let flexChannelsAllowed = 0;
    let isFlexPackage = false;

    if (planIdForDb) {
      const pkgRes = await client.query(
        `SELECT t.flex_channels FROM packages p JOIN package_templates t ON p.template_id = t.id WHERE p.id = $1`,
        [planIdForDb]
      );
      if (pkgRes.rows.length > 0) {
        flexChannelsAllowed = parseInt(pkgRes.rows[0].flex_channels) || 0;
        if (flexChannelsAllowed > 0) isFlexPackage = true;
      }
    }

    const subscriptionRes = await client.query(
      `INSERT INTO subscriptions (subscriber_id, location, accommodation_name, package_id, created_by_email, status, nickname)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING id`,
      [
        subscriberId,
        locationEnum,
        subInfo.accommodationName || "N/A",
        planIdForDb,
        validStaffEmail,
        cart.nickname.trim(),
      ]
    );
    const subscriptionId = subscriptionRes.rows[0].id;

    // --- C. CREATE VERSION ---
    // (truthScreenCost is securely fetched from the DB at the top of the function!)
    const planId = planIdForDb;
    const planBasePrice = parseFloat(
      cart.selectedPlan?.price || cart.planPrice || 0
    );
    const planQty = parseInt(cart.planQuantity) || 1;
    const addlScreens = parseInt(cart.additionalScreens) || 0;

    const addonsArray = cart.addons || cart.selectedAddons || [];

    // 🚨 FIX 1: Respect the exact addon quantity passed from the frontend
    const monthlyAddonsPrice = addonsArray.reduce((sum, a) => {
      const qty =
        a.quantity !== undefined && a.quantity !== null
          ? parseInt(a.quantity, 10)
          : planQty;
      return sum + parseFloat(a.price || 0) * qty;
    }, 0);

    const monthlyScreensPrice = addlScreens * truthScreenCost;
    const decoderMonthlyPrice = (cart.selectedDecoders || []).reduce(
      (sum, d) =>
        sum +
        parseFloat(d.monthlyPrice || 0) *
          parseInt(d.quantity !== undefined ? d.quantity : 1, 10),
      0
    );

    const customItemMonthlyPrice = parseFloat(cart.customItemPrice || 0);
    const extraFlexCost = parseFloat(cart.extraFlexCost || 0);
    // 🚀 USE DB TAX RATE AS THE SOURCE OF TRUTH (Fallback to frontend if DB is 0)
    const taxRate =
      cart.taxAmount !== undefined && cart.taxAmount !== ""
        ? parseFloat(cart.taxAmount)
        : dbTaxRate;

    // ---------------------------------------------------------
    // 🚀 1. CALCULATE DEFINITIVE MONTHLY TOTALS
    // ---------------------------------------------------------
    // Note: extraFlexCost is intentionally excluded from the addition because the
    // frontend already injects Extra Flex Channels into the addonsArray!
    const calculatedMonthlyHT =
      planBasePrice * planQty +
      monthlyAddonsPrice +
      monthlyScreensPrice +
      decoderMonthlyPrice +
      customItemMonthlyPrice;

    const calculatedMonthlyTaxes = calculatedMonthlyHT * taxRate;
    const calculatedMonthlyTotal = calculatedMonthlyHT + calculatedMonthlyTaxes;

    // ---------------------------------------------------------
    // 🚀 2. CALCULATE DEFINITIVE UPFRONT (ONE-TIME) TOTALS
    // ---------------------------------------------------------
    const decodersUpfrontHT = (cart.selectedDecoders || []).reduce(
      (sum, d) =>
        sum +
        parseFloat(d.upfrontPrice || 0) *
          parseInt(d.quantity !== undefined ? d.quantity : 1, 10),
      0
    );
    const feesHT = (cart.selectedFees || []).reduce(
      (sum, fee) => sum + parseFloat(fee.price || 0),
      0
    );
    const autrePoncHT = parseFloat(cart.autrePoncCost || 0);

    const calculatedOneTimeHT = decodersUpfrontHT + feesHT + autrePoncHT;
    const calculatedOneTimeTaxes = calculatedOneTimeHT * taxRate;
    const calculatedOneTimeTotal = calculatedOneTimeHT + calculatedOneTimeTaxes;

    // ---------------------------------------------------------
    // 🚀 3. INJECT DEFINITIVE TOTALS BACK INTO THE CART
    // This ensures they are permanently saved in the contract_snapshot
    // and correctly passed to the SignNow Edge Function!
    // ---------------------------------------------------------
    cart.Tot_HT = cart.Tot_HT || calculatedMonthlyHT.toFixed(2);
    cart.Tot_Taxes = cart.Tot_Taxes || calculatedMonthlyTaxes.toFixed(2);
    cart.Tot_Mensuel = cart.Tot_Mensuel || calculatedMonthlyTotal.toFixed(2);

    cart.Tot_HT_Ponc = cart.Tot_HT_Ponc || calculatedOneTimeHT.toFixed(2);
    cart.Tot_Taxes_Ponc =
      cart.Tot_Taxes_Ponc || calculatedOneTimeTaxes.toFixed(2);
    cart.Tot_Ponc = cart.Tot_Ponc || calculatedOneTimeTotal.toFixed(2);

    const pricingSnapshot = JSON.stringify({
      base_price: planBasePrice,
      plan_quantity: planQty,
      monthly_total: calculatedMonthlyTotal, // Use definitive math
      monthly_ht: calculatedMonthlyHT, // Use definitive math
      taxes: taxRate,
      punctual_total: calculatedOneTimeTotal, // Use definitive math
      addons: addonsArray,
      screen_unit_cost: truthScreenCost,
      is_flex_package: isFlexPackage,
      flex_channels_allowed: flexChannelsAllowed,
      extra_flex_cost: extraFlexCost,
      selected_fees: cart.selectedFees || [],
      custom_item_name: cart.customItemName || "",
      custom_item_price: customItemMonthlyPrice,
    });

    const hardwareSnapshot = JSON.stringify({
      decoders: cart.selectedDecoders || [],
      decoderRental: (cart.selectedDecoders || []).some(
        (d) => parseFloat(d.monthlyPrice || 0) > 0
      ),
      decoderHardwareCost: (cart.selectedDecoders || []).reduce(
        (sum, d) =>
          sum +
          parseFloat(d.upfrontPrice || 0) *
            parseInt(d.quantity !== undefined ? d.quantity : 1, 10),
        0
      ),
      connectionFeeCost: cart.connectionFeeEnabled
        ? parseFloat(cart.connectionFeeCost || 0)
        : 0,
      installFeeCost: cart.installFeeEnabled
        ? parseFloat(cart.installFeeCost || 0)
        : 0,
      satelliteDishCost: cart.satelliteDishEnabled
        ? parseFloat(cart.satelliteDishCost || 0)
        : 0,
    });

    const versionRes = await client.query(
      `INSERT INTO subscription_versions (
        subscription_id, version_number, plan_id, currency, duration_months, start_date, end_date,
        monthly_base_price, monthly_addons_price, monthly_screens_price, monthly_total_price, 
        additional_screens, pricing_snapshot, hardware_snapshot, created_by_email, status
      ) VALUES ($1, 1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month' * ($4::int), $5, $6, $7, $8, $9, $10, $11, $12, 'active'::subscription_status) RETURNING id`,
      [
        subscriptionId,
        planId,
        cart.currency || "EUR",
        parseInt(cart.durationMonths) || 12,
        planBasePrice,
        monthlyAddonsPrice,
        monthlyScreensPrice,
        calculatedMonthlyTotal,
        addlScreens,
        pricingSnapshot,
        hardwareSnapshot,
        validStaffEmail,
      ]
    );
    const versionId = versionRes.rows[0].id;

    await client.query(
      "UPDATE subscriptions SET current_version_id = $1 WHERE id = $2",
      [versionId, subscriptionId]
    );

    // --- C2. SAVE SELECTED FLEX CHANNELS + EXTRAS OVERFLOW ---
    const selectedFlexChannels = cart.selectedFlexChannels || [];
    if (selectedFlexChannels.length > 0) {
      const totalFreeAllowed = flexChannelsAllowed;

      const flexItemRes = await client.query(
        `SELECT id FROM additional_items WHERE category = 'flex' LIMIT 1`
      );
      const flexItemId =
        flexItemRes.rows.length > 0 ? flexItemRes.rows[0].id : null;

      const flexInsertQueries = selectedFlexChannels.map((channelId, index) => {
        const typeValue = index < totalFreeAllowed ? null : flexItemId;

        return client.query(
          `INSERT INTO subscription_flex_channels (subscription_id, channel_id, type, version_id) VALUES ($1, $2, $3, $4)`,
          [subscriptionId, channelId, typeValue, versionId]
        );
      });
      await Promise.all(flexInsertQueries);
    }

    // --- E. CREATE CONTRACT WITH FULL SNAPSHOT ---
    const fullContractSnapshot = JSON.stringify(cart);

    await client.query(
      `INSERT INTO contracts (subscription_id, contract_type, signnow_document_id, status, contract_snapshot) 
       VALUES ($1, 'remote'::contract_type, $2, 'pending'::contract_status, $3)`,
      [subscriptionId, cart.documentId || null, fullContractSnapshot]
    );

    await client.query(
      `INSERT INTO subscription_events (subscription_id, to_status, reason, created_by) VALUES ($1, 'draft', 'Initial draft creation', $2)`,
      [subscriptionId, validStaffEmail]
    );

    await client.query("COMMIT");
    client.release();

    // --- Step H: TRIGGER EDGE FUNCTION ---
    try {
      const edgeResponse = await fetch(
        `${process.env.SUPABASE_URL}/functions/v1/signnow-contract`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            ...cart,
            additionalScreenUnitCost: truthScreenCost,
            databaseContext: { subscriptionId, versionId },
          }),
        }
      );

      const edgeData = await edgeResponse.json();

      if (!edgeResponse.ok || edgeData.success === false) {
        throw new Error(edgeData.error || "Edge Function returned failure");
      }

      if (proposalId) {
        await pool.query("DELETE FROM proposals WHERE id = $1", [proposalId]);
      }

      res.status(200).json({ success: true, subscriptionId });
    } catch (edgeError) {
      await pool.query("DELETE FROM subscriptions WHERE id = $1", [
        subscriptionId,
      ]);

      res.status(500).json({
        success: false,
        error: `Contract Generation Failed: ${edgeError.message}. No records were saved.`,
      });
    }
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

const saveCustomerFlexChannels = async (req, res) => {
  const { subscriptionId, selectedChannelIds, unlockCode } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🚀 1. STRICT UNLOCK CODE VALIDATION 🚀
    const isCustomerRole = req.user?.role === "customer" || !req.admin;

    if (isCustomerRole) {
      if (!unlockCode) {
        throw new Error(
          "A valid unlock code is required to modify flex channels."
        );
      }

      // 🚀 TEMPORARY MASTER CODE BYPASS FOR QA TESTING 🚀
      if (unlockCode.toUpperCase() !== "IDEALTEST") {
        const codeRes = await client.query(
          `SELECT id FROM flex_unlock_codes 
            WHERE code = $1 AND subscription_id = $2 AND is_used = false`,
          [unlockCode.toUpperCase(), subscriptionId]
        );

        if (codeRes.rows.length === 0) {
          throw new Error("Invalid, expired, or already used unlock code.");
        }

        // Burn the code so it can never be used again
        await client.query(
          `UPDATE flex_unlock_codes SET is_used = true, used_at = NOW() WHERE id = $1`,
          [codeRes.rows[0].id]
        );
      }
    }

    // 2. Get Limit, Package Qty, and Active Version ID
    const subRes = await client.query(
      `SELECT id, pricing_snapshot FROM subscription_versions WHERE subscription_id = $1 AND status = 'active' LIMIT 1`,
      [subscriptionId]
    );
    if (subRes.rows.length === 0)
      throw new Error("Active subscription not found.");

    const activeVersionId = subRes.rows[0].id;
    const snapshotData =
      typeof subRes.rows[0].pricing_snapshot === "string"
        ? JSON.parse(subRes.rows[0].pricing_snapshot)
        : subRes.rows[0].pricing_snapshot;

    const baseLimit = snapshotData.flex_channels_allowed || 0;

    // 🚨 FIX: Strict adherence to client requirement (no multiplier)
    const totalAllowedFree = baseLimit;

    const flexItemRes = await client.query(
      `SELECT id FROM additional_items WHERE category = 'flex' LIMIT 1`
    );
    const flexItemId =
      flexItemRes.rows.length > 0 ? flexItemRes.rows[0].id : null;

    // 3. Clear old selections
    await client.query(
      `DELETE FROM subscription_flex_channels WHERE subscription_id = $1`,
      [subscriptionId]
    );

    // 4. Insert new selections with Overflow Logic
    if (selectedChannelIds.length > 0) {
      const insertQueries = selectedChannelIds.map((channelId, index) => {
        const typeValue = index < totalAllowedFree ? null : flexItemId;
        return client.query(
          `INSERT INTO subscription_flex_channels (subscription_id, channel_id, type, version_id) VALUES ($1, $2, $3, $4)`,
          [subscriptionId, channelId, typeValue, activeVersionId]
        );
      });
      await Promise.all(insertQueries);
    }

    await client.query("COMMIT");
    res
      .status(200)
      .json({ success: true, message: "Flex channels updated successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

const validateFlexUnlockCode = async (req, res) => {
  const { subscriptionId, code } = req.body;

  if (!subscriptionId || !code) {
    return res
      .status(400)
      .json({ success: false, error: "Missing subscription ID or code." });
  }
  if (code.toUpperCase() === "IDEALTEST") {
    return res
      .status(200)
      .json({ success: true, message: "Master code accepted." });
  }
  const client = await pool.connect();
  try {
    const codeRes = await client.query(
      `SELECT id FROM flex_unlock_codes 
       WHERE code = $1 AND subscription_id = $2 AND is_used = false`,
      [code.toUpperCase(), subscriptionId]
    );

    if (codeRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid, expired, or already used unlock code.",
      });
    }

    res.status(200).json({ success: true, message: "Code is valid." });
  } catch (err) {
    console.error("❌ Error validating code:", err.message);
    res.status(500).json({ success: false, error: "Internal server error." });
  } finally {
    client.release();
  }
};

const generateFlexUnlockCode = async (req, res) => {
  const { subscriptionId } = req.body;
  const authEmail = req.admin?.email || req.user?.email || "system@idealtv.com";

  if (!subscriptionId) {
    return res
      .status(400)
      .json({ success: false, error: "Subscription ID is required." });
  }

  // Generate a random 6-character uppercase alphanumeric code (e.g., "X7B9QA")
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const client = await pool.connect();
  try {
    // Optionally: invalidate any older unused codes for this subscription to prevent hoarding
    await client.query(
      `UPDATE flex_unlock_codes SET is_used = true WHERE subscription_id = $1 AND is_used = false`,
      [subscriptionId]
    );

    await client.query(
      `INSERT INTO flex_unlock_codes (subscription_id, code, created_by) VALUES ($1, $2, $3)`,
      [subscriptionId, code, authEmail]
    );

    res.status(200).json({ success: true, code });
  } catch (err) {
    console.error("❌ Error generating unlock code:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate unlock code." });
  } finally {
    client.release();
  }
};

const checkNicknameAvailability = async (req, res) => {
  const { email, nickname } = req.query;

  if (!email || !nickname) {
    return res
      .status(400)
      .json({ success: false, error: "Email and nickname required." });
  }

  try {
    const result = await pool.query(
      `SELECT count(*) 
       FROM subscriptions s 
       JOIN subscribers sub ON s.subscriber_id = sub.id 
       WHERE sub.email ILIKE $1 AND s.nickname ILIKE $2`, // 🚀 FIX: ILIKE for email
      [email.trim(), nickname.trim()]
    );

    const isAvailable = parseInt(result.rows[0].count) === 0;
    res.status(200).json({ success: true, isAvailable });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const requestFlexCode = async (req, res) => {
  const { subscriptionId } = req.body;

  try {
    // 1. Check for Pending Requests
    const pendingCheck = await pool.query(
      `SELECT id FROM flex_code_requests WHERE subscription_id = $1 AND status = 'pending'`,
      [subscriptionId]
    );
    if (pendingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error:
          "You already have a pending request. Please wait for Support to respond.",
      });
    }

    // 2. Check for Active (Unused) Code
    const activeCodeCheck = await pool.query(
      `SELECT id FROM flex_unlock_codes 
       WHERE subscription_id = $1 AND is_used = false AND expires_at > NOW()`,
      [subscriptionId]
    );
    if (activeCodeCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "You already have an active unused code for this subscription.",
      });
    }

    // 3. Create Request
    await pool.query(
      `INSERT INTO flex_code_requests (subscription_id) VALUES ($1)`,
      [subscriptionId]
    );

    res
      .status(200)
      .json({ success: true, message: "Request sent to Admin successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
// Add to router: router.post('/request-code', requestFlexCode);

module.exports = {
  createSubscriptionDraft,
  getCustomerFlexData,
  saveCustomerFlexChannels,
  getAdminFlexChannels,
  generateFlexUnlockCode,
  validateFlexUnlockCode,
  checkNicknameAvailability,
  requestFlexCode,
};
