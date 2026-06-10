const Joi = require("joi");

const subscriptionDraftSchema = Joi.object({
  // Action & Flow Controls
  sendMethod: Joi.string()
    .valid("embed", "email", "sms", "kiosk")
    .default("embed"),
  action: Joi.string().optional(),
  documentId: Joi.string().optional(),
  forceDuplicate: Joi.boolean().default(false),
  useApproverFlow: Joi.boolean().default(false),
  approverName: Joi.string().allow("", null),
  approverEmail: Joi.string().email().allow("", null),

  // Core Subscription Math
  location: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.object({ id: Joi.string().required() }).unknown(true)
    )
    .required(),
  totalScreens: Joi.number().integer().min(1).required(),
  planQuantity: Joi.number()
    .integer()
    .min(1)
    .when("contractType", {
      is: "hotel",
      then: Joi.valid(Joi.ref("totalScreens")).messages({
        "any.only":
          "Security Violation: Hotel contracts must have exactly 1 package per screen.",
      }),
      otherwise: Joi.number().max(Joi.ref("totalScreens")).messages({
        "number.max":
          "Security Violation: Plan quantity cannot arbitrarily exceed total screens.",
      }),
    })
    .required(),
  additionalScreens: Joi.number().integer().min(0).default(0),
  contractType: Joi.string()
    .valid("individual", "professional", "hotel")
    .required(),
  includeLegalPackage: Joi.boolean().default(true),

  // Tax & Currency (From your Kiosk fix)
  taxDesc: Joi.string().allow("", null),
  taxAmount: Joi.number().min(0).max(1).allow(null),
  currency: Joi.string().valid("EUR", "USD").default("EUR"),

  // Selected Items
  selectedPlan: Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    name: Joi.string().required(),
    price: Joi.number().min(0).required(),
  }).required(),

  addons: Joi.array()
    .items(
      Joi.object({
        id: Joi.alternatives().try(Joi.string(), Joi.number()),
        name: Joi.string().required(),
        price: Joi.number().min(0).required(),
        quantity: Joi.number().integer().min(1).default(1),
      })
    )
    .default([]),

  selectedDecoders: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        name: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        upfrontPrice: Joi.number().min(0).default(0),
        monthlyPrice: Joi.number().min(0).default(0),
      })
    )
    .default([]),

  selectedFees: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        name: Joi.string().required(),
        price: Joi.number().min(0).required(),
      })
    )
    .default([]),

  // Flex Channels
  selectedFlexChannels: Joi.array()
    .items(Joi.alternatives().try(Joi.string(), Joi.number()))
    .default([]),
  extraFlexEnabled: Joi.boolean().default(false),
  extraFlexCost: Joi.number().min(0).default(0),

  // Custom Items (Allowing Negative Values!)
  customItemName: Joi.string().allow("", null),
  customItemPrice: Joi.number()
    .allow(null)
    .default(0)
    .when(Joi.ref("$isStaff"), {
      is: false, // If the user is NOT staff...
      then: Joi.number().min(0).messages({
        "number.min":
          "Unauthorized: Customers cannot apply manual negative discounts to custom items.",
      }),
    }),
  autrePoncText: Joi.string().allow("", null),
  autrePoncCost: Joi.number()
    .allow(null)
    .default(0)
    .when(Joi.ref("$isStaff"), {
      is: false, // If the user is NOT staff...
      then: Joi.number().min(0).messages({
        // ...Force the price to be 0 or higher!
        "number.min":
          "Unauthorized: Customers cannot apply manual negative discounts to punctual fees.",
      }),
    }),
  // Demographics
  subscriberInfo: Joi.object({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    email: Joi.string().email().required(),
    cellPhone: Joi.string()
      .pattern(/^[\d\s\+\-\(\)]{8,20}$/)
      .required(), // Same regex as frontend
    landlinePhone: Joi.string().allow("", null),
    companyName: Joi.string().allow("", null),
    accommodationName: Joi.string().allow("", null),
    address: Joi.string().required(),
    city: Joi.string().required(),
    postalCode: Joi.string().required(),
    country: Joi.string().allow("", null),
    acceptsMarketing: Joi.boolean().default(true),
  }).required(),

  partnerInfo: Joi.object().unknown(true).allow(null),
  guarantorInfo: Joi.object().unknown(true).allow(null),
  deliveryInfo: Joi.object().unknown(true).allow(null),

  // Payment Mandates (Conditional Logic)
  addSepaMandate: Joi.boolean().default(false),
  addCcAuthorization: Joi.boolean().default(false),
  sepaData: Joi.any().when("addSepaMandate", {
    is: true,
    then: Joi.object({
      firstName: Joi.string().required(),
      lastName: Joi.string().required(),
      companyName: Joi.string().required(),
      address: Joi.string().required(),
      postalCode: Joi.string().required(),
      city: Joi.string().required(),
      country: Joi.string().required(),
      iban: Joi.string().required(),
      bic: Joi.string().required(),
      paymentRecurrent: Joi.boolean().required(),
      paymentPonctuel: Joi.boolean().required(),
      rum: Joi.string().allow("", null),
      contractReference: Joi.string().allow("", null),
    }).required(),
    otherwise: Joi.any().optional(),
  }),

  // Optional string comments
  planComment: Joi.string().allow("", null).max(200),
  decoderRentalComment: Joi.string().allow("", null),
  decoderPurchaseComment: Joi.string().allow("", null),
  additionalScreensComment: Joi.string().allow("", null),
  addonComments: Joi.object()
    .pattern(Joi.string(), Joi.string().allow("", null))
    .default({}),

  // Ghost variables (from frontend edge cases)
  subscriptionId: Joi.string().allow("", null),
  frontendUrl: Joi.string().uri().allow("", null),
}).unknown(true); // Allow extra unused fields from frontend to pass without crashing

module.exports = {
  subscriptionDraftSchema,
};
