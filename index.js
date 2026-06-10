require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./util/db");
const { protectAdmin } = require("./middleware/auth.middleware");
const authRoutes = require("./routes/auth.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/admin/auth", authRoutes);

const userRoutes = require("./routes/user.routes");
app.use("/api/admin", userRoutes);

const locationRoutes = require("./routes/location.routes");
app.use("/api/admin/locations", locationRoutes);

const customerRoutes = require("./routes/customer.routes");
app.use("/api/customer", customerRoutes);

app.get("/api/admin/dashboard-stats", protectAdmin, (req, res) => {
  res.json({ success: true, message: "Secure data fetched successfully" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Admin Server running on port ${PORT}`));
