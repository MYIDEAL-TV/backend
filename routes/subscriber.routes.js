const express = require("express");
const router = express.Router();
const { getSubscribers } = require("../controllers/subscriber.controller");
const { checkPermission } = require("../middleware/auth.middleware");

router.get("/", checkPermission("manage_subscriptions"), getSubscribers);

module.exports = router;
