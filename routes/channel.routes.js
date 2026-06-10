const express = require("express");
const router = express.Router();
const { checkPermission } = require("../middleware/auth.middleware");
const { getChannels, createChannel, updateChannel, deleteChannel } = require("../controllers/channel.controller");

router.get("/", checkPermission('view_channels'), getChannels);
router.post("/", checkPermission('manage_channels'), createChannel);
router.put("/:id", checkPermission('manage_channels'), updateChannel);
router.delete("/:id", checkPermission('delete_channel'), deleteChannel);

module.exports = router;