const express = require("express");
const {
  login,
  createAdmin,
  verifyAccount,
  validateActivationToken,
  checkEmailExists,
} = require("../controllers/auth.controller");
const { syncCustomerProfile } = require("../controllers/customer.controller");
const router = express.Router();

router.post("/login", login);
router.post("/check-email", checkEmailExists);
router.post("/create-root-admin", createAdmin);
router.post("/sync-customer", syncCustomerProfile);
router.post("/verify-account", verifyAccount);

router.get("/validate-token", validateActivationToken);
module.exports = router;
