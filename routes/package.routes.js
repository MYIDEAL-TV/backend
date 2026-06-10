const express = require("express");
const { checkPermission } = require("../middleware/auth.middleware");
const { getPackages, createPackage, updatePackage, deletePackage, getEligibleChannels, getPackagesAdminPanel } = require("../controllers/package.controller");
const router = express.Router();

router.get("/admin", checkPermission("view_packages"), getPackagesAdminPanel);
router.get("/", checkPermission("view_packages"), getPackages);
router.get("/eligible-channels", checkPermission("view_channels"), getEligibleChannels);
router.post("/", checkPermission("create_package"), createPackage);
router.put("/:id", checkPermission("update_package"), updatePackage);
router.delete("/:id", checkPermission("delete_package"), deletePackage);

module.exports = router;
