const pool = require("../util/db");

const saveProposalProgress = async (req, res) => {
  // formData is the massive JSON payload we discussed earlier
  const { proposalId, formData } = req.body;

  // From your auth middleware
  const userId = req.user.id;
  const userEmail = req.user.email;

  try {
    // Start a transaction to ensure both tables update safely
    await pool.query("BEGIN");

    let currentProposalId = proposalId;
    let newVersion = 1;

    if (currentProposalId) {
      // UPDATE EXISTING PROPOSAL
      const getVer = await pool.query(
        "SELECT version FROM public.proposals WHERE id = $1",
        [currentProposalId]
      );
      newVersion = (getVer.rows[0]?.version || 0) + 1;

      await pool.query(
        `UPDATE public.proposals 
         SET form_data = $1, version = $2, updated_at = NOW() 
         WHERE id = $3 AND created_by_user_id = $4`,
        [formData, newVersion, currentProposalId, userId]
      );
    } else {
      // INSERT NEW PROPOSAL
      const newProp = await pool.query(
        `INSERT INTO public.proposals (created_by_user_id, created_by_email, form_data, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'draft', 1, NOW(), NOW()) 
         RETURNING id`,
        [userId, userEmail, formData]
      );
      currentProposalId = newProp.rows[0].id;
    }

    // CREATE AUDIT LOG
    await pool.query(
      `INSERT INTO public.proposal_logs (proposal_id, action, performed_by, timestamp) 
       VALUES ($1, 'save_progress', $2, NOW())`,
      [currentProposalId, userEmail]
    );

    await pool.query("COMMIT");

    res.status(200).json({
      success: true,
      proposalId: currentProposalId,
      message: "Progress saved successfully.",
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("❌ Save Progress Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = { saveProposalProgress };
