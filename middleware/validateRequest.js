const validateRequest = (schema) => {
  return (req, res, next) => {
    // Determine if the user is staff/admin based on your auth setup
    // (Adjust this line to match how your auth middleware attaches the user to 'req')
    const isStaff =
      !!req.admin ||
      (req.user && ["admin", "super_admin", "staff"].includes(req.user.role));

    // Pass 'isStaff' into the Joi context
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      context: { isStaff: isStaff }, // 🚀 Injects context here
    });

    if (error) {
      const errorDetails = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: "Business logic validation failed. Unpermitted data detected.",
        details: errorDetails,
      });
    }

    req.body = value;
    next();
  };
};

module.exports = validateRequest;
