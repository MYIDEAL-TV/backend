const express = require("express");
const router = express.Router();
const {
  getLocations,
  updateLocationStatus,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocationsAdminPanel,
  getLocationDetails,
} = require("../controllers/location.controller");
const {
  protectAdmin,
  checkPermission,
  protectShared,
} = require("../middleware/auth.middleware");

router.get("/", protectShared, checkPermission("view_countries"), getLocations);
router.get(
  "/admin",
  protectAdmin,
  checkPermission("view_countries"),
  getLocationsAdminPanel
);
router.put(
  "/:id/status",
  protectAdmin,
  checkPermission("update_countries"),
  updateLocationStatus
);
router.get("/:id/details", protectAdmin, checkPermission("view_countries"), getLocationDetails);
router.post(
  "/",
  protectAdmin,
  checkPermission("manage_countries"),
  createLocation
);
router.delete(
  "/:id",
  protectAdmin,
  checkPermission("manage_countries"),
  deleteLocation
);
router.put(
  "/:id",
  protectAdmin,
  checkPermission("manage_countries"),
  updateLocation
);

module.exports = router;
