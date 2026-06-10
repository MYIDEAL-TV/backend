const express = require("express");
const { protectAdmin } = require("../middleware/auth.middleware");
const {
  fulfillFlexRequest,
  getPendingFlexRequests,
} = require("../controllers/user.controller");
const {
  checkNicknameAvailability,
  requestFlexCode,
  createSubscriptionDraft,
  getCustomerFlexData,
  getAdminFlexChannels,
  generateFlexUnlockCode,
  validateFlexUnlockCode,
  saveCustomerFlexChannels,
} = require("../controllers/subscriptionController");
const router = express.Router();

router.post("/request-code", requestFlexCode);
router.get("/check-nickname", checkNicknameAvailability);

router.get("/flex-requests", protectAdmin, getPendingFlexRequests);
router.post("/flex-requests/fulfill", protectAdmin, fulfillFlexRequest);

router.post("/draft",  createSubscriptionDraft);

router.get("/flex-data",  getCustomerFlexData);
router.get("/flex-channels",  getAdminFlexChannels);
router.post("/flex-unlock", protectAdmin, generateFlexUnlockCode);
router.post("/flex-unlock/validate",  validateFlexUnlockCode);
router.post("/flex-data",  saveCustomerFlexChannels);

module.exports = router;
