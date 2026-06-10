const express = require("express");
const {
  updateSubscriptionNickname,
  updateCustomerProfile,
  getCustomerDashboard,
  getSubscriptionDetails,
} = require("../controllers/profile.controller");
const { protectShared } = require("../middleware/auth.middleware");
const { saveProposalProgress } = require("../controllers/proposal.controller");
const { getUserTypes } = require("../controllers/user.controller");
const router = express.Router();

router.get("/dashboard", protectShared, getCustomerDashboard);
router.put("/profile", protectShared, updateCustomerProfile);
router.put(
  "/subscription/:subId/nickname",
  protectShared,
  updateSubscriptionNickname
);
router.get("/user-types", protectShared, getUserTypes);
router.get(
  "/subscription/:subId/details",
  protectShared,
  getSubscriptionDetails
);

router.post("/proposal/save", protectShared, saveProposalProgress);

module.exports = router;
