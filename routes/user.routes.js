const express = require("express");
const router = express.Router();
const {
  getSystemUsers,
  getAdminStats,
  getRoles,
  createUser,
  deleteUser,
  updateUser,
  createRole,
  getAllPermissions,
  deleteRole,
  updateRole,
  getPackageTemplates,
  createPackageTemplate,
  updatePackageTemplate,
  deletePackageTemplate,
  getPackageOptions,
  getPackageTemplatesAdmin,
  getPendingFlexRequests,
  fulfillFlexRequest,
} = require("../controllers/user.controller");
const subscriberRoutes = require("./subscriber.routes");
const {
  getActiveServiceFees,
} = require("../controllers/serviceFeesController");
const {
  createSubscriptionDraft,
  getCustomerFlexData,
  saveCustomerFlexChannels,
  getAdminFlexChannels,
  generateFlexUnlockCode,
  validateFlexUnlockCode,
  requestFlexCode,
  checkNicknameAvailability,
} = require("../controllers/subscriptionController");
const { getDecoders } = require("../controllers/package.controller");
const {
  getAdditionalItems,
  createAdditionalItem,
  updateAdditionalItem,
  deleteAdditionalItem,
} = require("../controllers/additionalItem.controller");
const {
  protectAdmin,
  checkPermission,
  protectShared,
} = require("../middleware/auth.middleware");

const packageRoutes = require("./package.routes");
router.use("/packages", protectShared, packageRoutes);

const channelRoutes = require("./channel.routes");
router.use("/channels", protectAdmin, channelRoutes);

const subscriptionRoutes = require("./subscription.routes");
router.use("/subscriptions", protectShared, subscriptionRoutes);

router.get(
  "/additional-items",
  protectAdmin,
  // checkPermission("view_additional_items"),
  getAdditionalItems
);
router.post(
  "/additional-items",
  protectAdmin,
  // checkPermission("manage_additional_items"),
  createAdditionalItem
);
router.put(
  "/additional-items/:id",
  protectAdmin,
  // checkPermission("manage_additional_items"),
  updateAdditionalItem
);
router.delete(
  "/additional-items/:id",
  protectAdmin,
  // checkPermission("manage_additional_items"),
  deleteAdditionalItem
);

// ==========================================
// PACKAGE TEMPLATES API ROUTES
// ==========================================

// 1. GET all package templates (Used to populate the dropdown in the UI)
router.get("/package-templates", protectShared, getPackageTemplates);

router.get("/package-templates-admin", protectAdmin, getPackageTemplatesAdmin);

// 2. POST a new package template (Used by the Admin to create new blueprints)
router.post("/package-templates", protectShared, createPackageTemplate);

router.put("/package-templates/:id", protectShared, updatePackageTemplate);

router.delete("/package-templates/:id", protectShared, deletePackageTemplate);

router.use("/subscribers", protectAdmin, subscriberRoutes);

router.get("/decoders", protectAdmin, getDecoders);

router.get(
  "/admin-stats",
  protectAdmin,
  checkPermission("view_admin_stats"),
  getAdminStats
);
router.get(
  "/permission-matrix",
  protectAdmin,
  checkPermission("view_permissions"),
  getAllPermissions
);

router.get(
  "/system-users",
  protectAdmin,
  checkPermission("view_users"),
  getSystemUsers
);
router.get("/service-fees", protectShared, getActiveServiceFees);
router.get("/options/:packageId/:locationId", protectShared, getPackageOptions);
router.post("/users", protectAdmin, checkPermission("create_user"), createUser);
router.put(
  "/users/:id",
  protectAdmin,
  checkPermission("edit_user"),
  updateUser
);
router.delete(
  "/users/:id",
  protectAdmin,
  checkPermission("delete_user"),
  deleteUser
);

router.get("/roles", protectAdmin, checkPermission("view_roles"), getRoles);
router.post("/roles", protectAdmin, checkPermission("create_role"), createRole);
router.put(
  "/roles/:id",
  protectAdmin,
  checkPermission("update_role"),
  updateRole
);
router.delete(
  "/roles/:id",
  protectAdmin,
  checkPermission("delete_role"),
  deleteRole
);

module.exports = router;
