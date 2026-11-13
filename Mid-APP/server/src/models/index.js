const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const { getCurrentActor } = require('../utils/auditContext');

// Added to every model below so each table carries who created/last modified
// a row, alongside Sequelize's own createdAt/updatedAt timestamps.
const AUDIT_FIELDS = {
  createdBy: { type: DataTypes.STRING },
  updatedBy: { type: DataTypes.STRING },
};

// ---- CHIEF ADMIN --------------------------------------------------------
const ChiefAdmin = sequelize.define('ChiefAdmin', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  // Identifies this account's one currently-valid login session - set at
  // login and stamped into the JWT, so logging in again elsewhere evicts
  // whatever session was active before (see auth.middleware.js).
  currentSessionId: { type: DataTypes.STRING, allowNull: true },
  ...AUDIT_FIELDS,
}, { tableName: 'chief_admin' });

// ---- NOTIFICATION SETTINGS (single global row, managed by Chief Admin) ----
const NotificationSetting = sequelize.define('NotificationSetting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  smtpHost: { type: DataTypes.STRING },
  smtpPort: { type: DataTypes.INTEGER },
  smtpUser: { type: DataTypes.STRING },
  smtpPassword: { type: DataTypes.STRING },
  smtpFromEmail: { type: DataTypes.STRING },
  smtpSecure: { type: DataTypes.BOOLEAN, defaultValue: false },
  whatsappPhoneNumberId: { type: DataTypes.STRING },
  whatsappAccessToken: { type: DataTypes.STRING },
  gmailClientId: { type: DataTypes.STRING },
  gmailClientSecret: { type: DataTypes.STRING },
  gmailRefreshToken: { type: DataTypes.STRING },
  gmailSenderEmail: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'notification_setting' });

// ---- NOTIFICATION TEMPLATES (Chief Admin managed, used when sending mail/WhatsApp) ----
const NotificationTemplate = sequelize.define('NotificationTemplate', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  channel: { type: DataTypes.ENUM('EMAIL', 'WHATSAPP', 'BOTH'), defaultValue: 'BOTH' },
  header: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...AUDIT_FIELDS,
}, { tableName: 'notification_template' });

// ---- ROLE -> SCREEN ACCESS (which nav screens a client-side role can see) ----
// Platform-wide baseline, set by Chief Admin - the ceiling every client's own
// override is checked against (a client can narrow this, never widen it).
const RoleScreenDefault = sequelize.define('RoleScreenDefault', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  role: { type: DataTypes.STRING, unique: true, allowNull: false },
  screens: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  ...AUDIT_FIELDS,
}, { tableName: 'role_screen_default' });

// Per-client override - lets each client's own ADMIN restrict which screens
// their FRONT_OFFICE/LAB_USER/MANAGER/MASTER_MANAGER staff can see.
const ClientRoleScreen = sequelize.define('ClientRoleScreen', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  clientId: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false },
  screens: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  // Extra screens Chief Admin granted this client's role beyond the platform
  // default - the client's own ADMIN may then switch these on/off too.
  grantedScreens: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_role_screen',
  indexes: [{ unique: true, fields: ['clientId', 'role'] }],
});

// ---- CLIENT --------------------------------------------------------------
const Client = sequelize.define('Client', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  clientCode: { type: DataTypes.STRING, unique: true, allowNull: false },
  clientName: { type: DataTypes.STRING, allowNull: false },
  mobile: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  address: { type: DataTypes.STRING },
  salesPerson: { type: DataTypes.STRING },
  // Extra monthly amount for the marketing person's involvement in this client
  // (e.g. an onboarding/referral fee), added on top of the plan price
  // (calculatePlanAmount) to make up monthlyAmount - so it's billed to the
  // client every cycle and multiplies correctly for 3/6/12-month payments.
  marketingPersonPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  monthlyAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  paymentStatus: {
    type: DataTypes.ENUM('PAID', 'PENDING', 'EXPIRED'),
    allowNull: false,
    defaultValue: 'PENDING',
  },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  // Chief-Admin-controlled, set at client creation (editable after): whether
  // this client's own staff can self-serve pay via the in-app QR/Razorpay
  // checkout when their subscription comes due. Off means Chief Admin
  // handles their billing directly (see Client Detail's "Record a Direct
  // Payment") - the client just sees that payment is pending, no Pay Now
  // button, since there's nothing for them to do themselves.
  qrPaymentRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  reportLogoPath: { type: DataTypes.STRING },
  reportLetterheadPath: { type: DataTypes.STRING },
  // For a full A4 letterhead (printed as the whole page's background): the
  // blank space to leave at its top/bottom for the printed header/footer
  // design, in mm. Null = the report's defaults.
  reportTopMarginMm: { type: DataTypes.INTEGER },
  reportBottomMarginMm: { type: DataTypes.INTEGER },
  // What a client's own staff set from Report Branding, shown on bills/lab
  // reports - deliberately separate from clientName/address/mobile/email
  // above (which Chief Admin sets at client creation for its own records),
  // since a clinic's patient-facing display name/branch address can
  // legitimately differ from what Chief Admin has on file for them. Falls
  // back to the fields above wherever null, so a brand-new client's bills
  // still show something before anyone's customized it.
  brandingName: { type: DataTypes.STRING },
  brandingAddress: { type: DataTypes.STRING },
  brandingMobile: { type: DataTypes.STRING },
  brandingEmail: { type: DataTypes.STRING },
  // Chief-Admin-controlled: whether this clinic's Front Office can cancel a
  // billed test and record a refund against it. Off by default since it
  // touches money - a clinic has to be explicitly opted in.
  allowBillCancellationRefund: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // How many days after the bill's walk-in date cancellation & refund stays
  // allowed. 0 means no limit. Only meaningful when allowBillCancellationRefund is on.
  refundAllowedDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // Whether Front Office/Manager can apply an extra discount to a bill after
  // it's already been created ("post-billing"), separate from the discount
  // that can be given at the time of billing itself. Off by default, like
  // allowBillCancellationRefund - it also touches money already collected.
  allowPostBillingDiscount: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // How many days after the bill's walk-in date a post-billing discount stays
  // allowed. 0 means no limit. Only meaningful when allowPostBillingDiscount is on.
  postDiscountAllowedDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // Pre-fills the GST % at billing time for this clinic (Front Office can
  // still override per bill). 0 (the default) means this clinic doesn't
  // charge GST at all - most diagnostic labs are tax-exempt, so this is opt-in.
  defaultGstPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
  ...AUDIT_FIELDS,
}, { tableName: 'client' });

// ---- CLIENT SUBSCRIPTION ---------------------------------------------------
const ClientSubscription = sequelize.define('ClientSubscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  month: { type: DataTypes.STRING, allowNull: false }, // e.g. "2026-09"
  fromDate: { type: DataTypes.DATEONLY, allowNull: false },
  toDate: { type: DataTypes.DATEONLY, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  dueDate: { type: DataTypes.DATEONLY, allowNull: false },
  status: {
    type: DataTypes.ENUM('PAID', 'PENDING', 'EXPIRED'),
    allowNull: false,
    defaultValue: 'PENDING',
  },
  ...AUDIT_FIELDS,
}, { tableName: 'client_subscription' });

// ---- CLIENT PAYMENT --------------------------------------------------------
const ClientPayment = sequelize.define('ClientPayment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  orderId: { type: DataTypes.STRING },
  transactionId: { type: DataTypes.STRING },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  // Number of monthly cycles this single payment covers (1 = just the
  // current due cycle; >1 = an advance/bulk payment covering future cycles).
  monthsCovered: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  paymentMode: { type: DataTypes.STRING },
  status: {
    type: DataTypes.ENUM('CREATED', 'PAID', 'FAILED'),
    allowNull: false,
    defaultValue: 'CREATED',
  },
  gatewayResponse: { type: DataTypes.JSONB },
  paymentDate: { type: DataTypes.DATE },
  ...AUDIT_FIELDS,
}, { tableName: 'client_payment' });

// ---- ROLE / PERMISSION -----------------------------------------------------
const Role = sequelize.define('Role', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  // FRONT_OFFICE | LAB_USER | MANAGER | MASTER_MANAGER | ADMIN
  ...AUDIT_FIELDS,
}, { tableName: 'role_master' });

const RolePermission = sequelize.define('RolePermission', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  screen: { type: DataTypes.STRING, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false, defaultValue: 'access' },
  ...AUDIT_FIELDS,
}, { tableName: 'role_permission' });

// ---- CLIENT USER ------------------------------------------------------------
const ClientUser = sequelize.define('ClientUser', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  mobile: { type: DataTypes.STRING },
  department: { type: DataTypes.STRING },
  designation: { type: DataTypes.STRING },
  signaturePath: { type: DataTypes.STRING },
  // The name printed with the signature on a report footer - separate from
  // this account's own `name` (used everywhere else in the app) so a client
  // can print any doctor's name here without it having to match a real
  // login's display name. Falls back to `name`/username when not set.
  signatureName: { type: DataTypes.STRING },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  // Auto-created once per client (see createClient) so Chief Admin can log in
  // as that client - using the client's own code plus this user - to help
  // troubleshoot an issue without needing the client's own credentials.
  // Never counted toward the client's billable user count or shown as one
  // of their own staff.
  isSystemUser: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Identifies this account's one currently-valid login session - set at
  // login and stamped into the JWT, so logging in again elsewhere evicts
  // whatever session was active before (see auth.middleware.js).
  currentSessionId: { type: DataTypes.STRING, allowNull: true },
  // Where this user may work when the client has several locations: every
  // location (allLocations) or just the one in locationId.
  allLocations: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_user',
  indexes: [{ unique: true, fields: ['clientId', 'username'] }],
});

// A branch of a client, set up by Chief Admin. The first one created is the
// Main location: its test prices are the client's own (ClientTestPrice); any
// other location uses those too unless it has its own price below.
const ClientLocation = sequelize.define('ClientLocation', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.STRING },
  isMain: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_location',
  indexes: [{ unique: true, fields: ['clientId', 'name'] }],
});

// A non-Main location's own price for a test, replacing the Main price there.
const ClientLocationTestPrice = sequelize.define('ClientLocationTestPrice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_location_test_price',
  indexes: [{ unique: true, fields: ['locationId', 'testId'] }],
});

// ---- MASTERS ------------------------------------------------------------
// A Chief-Admin-managed catalog of Test Group names (e.g. "Haematology",
// "Biochemistry"), so a test's group is picked from an explicitly-created
// list instead of free-typed - TestMaster.category below still just stores
// the chosen name as a string, this table exists purely so "create a group"
// is its own action rather than an implicit side effect of creating a test.
const TestGroup = sequelize.define('TestGroup', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  ...AUDIT_FIELDS,
}, { tableName: 'test_group' });

// Uploaded images (logos, letterheads, signatures) - the permanent copy, as
// the host's disk is wiped on every deploy/restart (see utils/fileStore.js).
// `path` is relative to /uploads, e.g. "12/letterhead.png".
const StoredFile = sequelize.define('StoredFile', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  path: { type: DataTypes.STRING, allowNull: false, unique: true },
  contentType: { type: DataTypes.STRING },
  data: { type: DataTypes.BLOB, allowNull: false },
  ...AUDIT_FIELDS,
}, { tableName: 'stored_file' });

// Chief-Admin-managed patient titles ("Mr.", "Mrs.", "Baby" ...) - one global
// list offered in every client's billing screen and printed before the
// patient's name on bills and reports. Patient.title stores the chosen text
// itself, so deleting a title here never changes an existing patient.
const PatientTitle = sequelize.define('PatientTitle', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  sequence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // dropdown order
  // Gender billing selects automatically when this title is picked (null = leave it as is, e.g. "Dr.").
  gender: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'patient_title' });

const TestMaster = sequelize.define('TestMaster', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  testCode: { type: DataTypes.STRING, unique: true, allowNull: false },
  testName: { type: DataTypes.STRING, allowNull: false },
  // Free-text grouping (e.g. "Haematology", "Biochemistry") so the Test
  // Parameters screen can filter tests by group; left blank a test is just
  // "Uncategorized". Sample type (e.g. "Blood", "Urine") is informational.
  category: { type: DataTypes.STRING },
  sampleType: { type: DataTypes.STRING },
  // REGULAR | FASTING | POST_LUNCH - drives sample collection: a Fasting and a
  // Post Lunch sample on the same order are drawn at different times, so they
  // can never be collected in the same action (see utils/testType.js).
  testType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'REGULAR' },
  // A fixed note about this test, the same on every report regardless of
  // patient or entered values (e.g. "Elevated in bacterial infection,
  // reduced in viral") - set once here at Test Master, not per-result.
  // Printed on the report below this test's results whenever non-empty.
  interpretation: { type: DataTypes.TEXT },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...AUDIT_FIELDS,
}, { tableName: 'test_master' });

// clientId is null for a universal parameter (created by Chief Admin, shared
// across every client) and set for a parameter a client added for themselves
// - which only that client ever sees, exactly like their own test prices.
const ParameterMaster = sequelize.define('ParameterMaster', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  parameterCode: { type: DataTypes.STRING },
  parameterName: { type: DataTypes.STRING, allowNull: false },
  unit: { type: DataTypes.STRING },
  method: { type: DataTypes.STRING }, // testing method, e.g. "Photometry", "ELISA"
  // The default range, used whenever no age/gender-specific rule below matches.
  normalRangeLow: { type: DataTypes.STRING },
  normalRangeHigh: { type: DataTypes.STRING },
  // The reference range exactly as printed on the report ("Bio. Ref.
  // Interval") - auto-filled from low/high at creation but editable, and may
  // be given on its own (e.g. "Negative", "Up to 200", several age bands on
  // separate lines). When set it's printed instead of low - high; low/high
  // still drive the abnormal (red) flag.
  normalRangeText: { type: DataTypes.TEXT },
  // Gender-wise versions of the printed range: a male/female patient's
  // report prints its own (falling back to normalRangeText - the common one -
  // when its box is empty). See utils/normalRange.js printedRangeText.
  normalRangeTextMale: { type: DataTypes.TEXT },
  normalRangeTextFemale: { type: DataTypes.TEXT },
  // Free-text clinical notes about this parameter (interpretation, significance, etc.) - long-form, so TEXT not STRING.
  description: { type: DataTypes.TEXT },
  // True for a qualitative parameter (e.g. a Widal titer conclusion, a
  // culture & sensitivity report, USG findings) whose entered Result is a
  // free-text paragraph rather than a number - result entry gets a large
  // textarea instead of a small value input, normalRangeLow/High don't
  // apply, and the report prints it as its own block below the test's
  // normal parameter table instead of as a Value/Unit/Range row.
  isInterpretation: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Display order within its test (1, 2, 3 ...) - result entry and the
  // printed report list parameters in this order. Null = after numbered ones.
  sequence: { type: DataTypes.INTEGER },
  // false = removed from its test(s): hidden from result entry and the masters
  // lists, but kept so already-entered/released results still print.
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ...AUDIT_FIELDS,
}, { tableName: 'parameter_master' });

// An age/gender-specific normal range rule for a parameter (e.g. Male 18-60,
// Female 18-60, child 0-12). Resolved against a patient's own age/gender at
// result-entry and report time; falls back to ParameterMaster's own
// normalRangeLow/High above when nothing here matches.
const ParameterNormalRange = sequelize.define('ParameterNormalRange', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  gender: { type: DataTypes.STRING, allowNull: false, defaultValue: 'All' }, // All (everyone) | Male | Female | Other - older rows said "Any"
  ageMin: { type: DataTypes.INTEGER }, // null = no lower bound
  ageMax: { type: DataTypes.INTEGER }, // null = no upper bound
  ageUnit: { type: DataTypes.STRING, defaultValue: 'Years' }, // Years | Months | Days - the unit ageMin (and ageMax, unless ageMaxUnit is set) is in (e.g. a "0-7 days" newborn band)
  // The unit ageMax is in, when it differs from ageMin's - e.g. "15 Days to 1 Years". Null = same as ageUnit.
  ageMaxUnit: { type: DataTypes.STRING },
  normalRangeLow: { type: DataTypes.STRING },
  normalRangeHigh: { type: DataTypes.STRING },
  // What the report prints as the Normal Range for a patient this row matches
  // (e.g. "4.5 - 5.5" or "Negative"); empty = this row's low - high.
  rangeText: { type: DataTypes.TEXT },
  // Null = the parameter's own rows (Chief Admin's for a universal parameter).
  // Set = a clinic's private copy of a universal parameter's ranges, used only
  // for that clinic once it has customised them (ClientParameterOverride).
  clientId: { type: DataTypes.INTEGER },
  ...AUDIT_FIELDS,
}, { tableName: 'parameter_normal_range' });

// Marks that a clinic has its own normal ranges for a universal (Chief Admin)
// parameter: its ranges are then the ParameterNormalRange rows with its
// clientId, and its printed Normal Range text is held here - so its edits
// never touch other clinics, and Chief Admin's later changes don't overwrite
// them. No row = the clinic follows Chief Admin's ranges. See utils/clientRanges.js.
const ClientParameterOverride = sequelize.define('ClientParameterOverride', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  normalRangeText: { type: DataTypes.TEXT },
  normalRangeTextMale: { type: DataTypes.TEXT },
  normalRangeTextFemale: { type: DataTypes.TEXT },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_parameter_override',
  indexes: [{ unique: true, fields: ['clientId', 'parameterId'] }],
});

// A client's own shortcut/abbreviated name for a test (e.g. for quick search
// or a compact report layout), set per client just like ClientTestPrice.
const ClientTestShortName = sequelize.define('ClientTestShortName', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  shortName: { type: DataTypes.STRING, allowNull: false },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_test_short_name',
  indexes: [{ unique: true, fields: ['clientId', 'testId'] }],
});

// A client's own specimen / sample type for a test (e.g. "Fluoride Plasma"
// where Chief Admin's Test Master says "Serum") - printed on that client's
// reports only. No row = Chief Admin's TestMaster.sampleType.
const ClientTestSpecimen = sequelize.define('ClientTestSpecimen', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sampleType: { type: DataTypes.STRING, allowNull: false },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_test_specimen',
  indexes: [{ unique: true, fields: ['clientId', 'testId'] }],
});

// One row per parameter a client wants trended on its patient reports (the AI
// Trend Report section). Keyed by parameter, not test - a parameter assigned to
// several tests (e.g. Glucose) is trended wherever it appears. No row = no trend.
const ClientParameterTrend = sequelize.define('ClientParameterTrend', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_parameter_trend',
  indexes: [{ unique: true, fields: ['clientId', 'parameterId'] }],
});

// A clinic's own name / unit / method for a universal (Chief Admin) parameter,
// shown on its result entry and reports only. Null field = Chief Admin's
// value. Kept apart from ClientParameterOverride (ranges) so changing a unit
// doesn't stop the clinic following Chief Admin's later range updates.
const ClientParameterLabel = sequelize.define('ClientParameterLabel', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  parameterName: { type: DataTypes.STRING },
  unit: { type: DataTypes.STRING },
  method: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_parameter_label',
  indexes: [{ unique: true, fields: ['clientId', 'parameterId'] }],
});

// A universal (Chief Admin) parameter a clinic has removed from one test for
// itself only: hidden from that clinic's Test Parameters list and result
// entry for that test, while every other clinic (and Chief Admin's master)
// still has it. Results already entered keep printing. No row = shown.
const ClientHiddenParameter = sequelize.define('ClientHiddenParameter', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_hidden_parameter',
  indexes: [{ unique: true, fields: ['clientId', 'testId', 'parameterId'] }],
});

const ClientTestPrice = sequelize.define('ClientTestPrice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  // Per-client switch: false hides this test from this client's billing only,
  // without touching the shared Test Master (whose own `active` is Chief
  // Admin's platform-wide switch).
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  // Set when this client switched the test Active while Chief Admin had it
  // Inactive - the clinic keeps billing it even though it's off platform-wide.
  // Cleared whenever the client switches it Inactive. See utils/testStatus.js.
  overrideChiefInactive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ...AUDIT_FIELDS,
}, {
  tableName: 'client_test_price',
  indexes: [{ unique: true, fields: ['clientId', 'testId'] }],
});

// A package (e.g. "Full Body Checkup") bundles several global tests under one
// price. Packages are defined per client, unlike the shared Test Master.
const Package = sequelize.define('Package', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  packageCode: { type: DataTypes.STRING, allowNull: false },
  packageName: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...AUDIT_FIELDS,
}, {
  tableName: 'package',
  indexes: [{ unique: true, fields: ['clientId', 'packageCode'] }],
});

// A Payor is a third party (corporate, TPA, insurer) that a client bills in
// bulk each month instead of the patient paying at the counter - it gets its
// own negotiated price per test, separate from the client's standard price.
const Payor = sequelize.define('Payor', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  contactPerson: { type: DataTypes.STRING },
  mobile: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  address: { type: DataTypes.STRING },
  // How often this credit client is invoiced for the patients billed to it.
  billingCycle: { type: DataTypes.ENUM('MONTHLY', 'WEEKLY'), allowNull: false, defaultValue: 'MONTHLY' },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...AUDIT_FIELDS,
}, {
  tableName: 'payor',
  indexes: [{ unique: true, fields: ['clientId', 'name'] }],
});

const PayorTestPrice = sequelize.define('PayorTestPrice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  ...AUDIT_FIELDS,
}, {
  tableName: 'payor_test_price',
  indexes: [{ unique: true, fields: ['payorId', 'testId'] }],
});

// A monthly bill sent to one Payor, covering every test done under its name
// that month. Line items snapshot both the client's standard price and the
// payor's negotiated price at generation time, so the invoice stays accurate
// even if prices change later.
const PayorInvoice = sequelize.define('PayorInvoice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  invoiceNo: { type: DataTypes.STRING, allowNull: false, unique: true },
  month: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM
  fromDate: { type: DataTypes.DATEONLY, allowNull: false },
  toDate: { type: DataTypes.DATEONLY, allowNull: false },
  totalOriginal: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  totalAssigned: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  totalDifference: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  totalCollected: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  totalDeduction: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  status: {
    type: DataTypes.ENUM('PENDING', 'PARTIALLY_COLLECTED', 'COLLECTED'),
    allowNull: false,
    defaultValue: 'PENDING',
  },
  ...AUDIT_FIELDS,
}, {
  tableName: 'payor_invoice',
  // Not unique: a period can have more than one invoice (a bill billed after
  // that period's invoice was generated goes on a further invoice) - each
  // invoice only takes bills not already on another one.
  indexes: [{ name: 'payor_invoice_payor_id_month_idx', fields: ['payorId', 'month'] }],
});

const PayorInvoiceItem = sequelize.define('PayorInvoiceItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  testName: { type: DataTypes.STRING, allowNull: false },
  // Snapshotted at generation time (like testName/originalPrice/assignedPrice)
  // so the invoice's detail/summary views keep showing the right patient and
  // order number even if the patient record changes later.
  patientName: { type: DataTypes.STRING },
  billNo: { type: DataTypes.STRING },
  originalPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  assignedPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  difference: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  ...AUDIT_FIELDS,
}, { tableName: 'payor_invoice_item' });

const PayorInvoiceCollection = sequelize.define('PayorInvoiceCollection', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paymentType: { type: DataTypes.ENUM('CASH', 'CARD', 'UPI'), allowNull: false },
  discount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  collectedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  remarks: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'payor_invoice_collection' });

// ---- PATIENT / BILLING -----------------------------------------------------
const Patient = sequelize.define('Patient', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // Unique Medical Record number - generated once per patient, per client,
  // and reused across every future visit/order for that same patient.
  umr: { type: DataTypes.STRING, allowNull: false },
  title: { type: DataTypes.STRING }, // e.g. "Mr." - picked from PatientTitle
  name: { type: DataTypes.STRING, allowNull: false },
  age: { type: DataTypes.INTEGER },
  ageUnit: { type: DataTypes.STRING, defaultValue: 'Years' }, // Years | Months | Days - lets a newborn's age be entered in days
  gender: { type: DataTypes.STRING },
  mobile: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  address: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, {
  tableName: 'patient',
  indexes: [{ unique: true, fields: ['clientId', 'umr'] }],
});

// Referring doctors, maintained per client so a name typed once can be
// searched and reused (most-recently-used first) on every future order.
const ReferralDoctor = sequelize.define('ReferralDoctor', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  mobile: { type: DataTypes.STRING },
  lastUsedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  ...AUDIT_FIELDS,
}, {
  tableName: 'referral_doctor',
  indexes: [{ unique: true, fields: ['clientId', 'name'] }],
});

const Bill = sequelize.define('Bill', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  billNo: { type: DataTypes.STRING, allowNull: false },
  // Random, unguessable code in the report's QR link (/r/<token>) - opens this
  // bill's released report without a login. Made the first time the report is opened.
  reportToken: { type: DataTypes.STRING, unique: true },
  walkInDate: { type: DataTypes.DATEONLY },
  visitType: { type: DataTypes.STRING, defaultValue: 'WALK-IN' }, // IPD | OPD | WALK-IN
  priority: { type: DataTypes.STRING, defaultValue: 'ROUTINE' }, // ROUTINE | URGENT
  totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  discount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  paidAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  // What the patient still owes - either left over from billing time (paid
  // less than the net payable) or added later (a test added after billing,
  // or a post-billing discount that was itself cancelled). Recovered via
  // DuePayment below; a report can't be released while this is above 0.
  dueAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  // GST added on top of (totalAmount - discount) at billing time, split evenly
  // into CGST + SGST per Indian tax convention. gstPercent of 0 (the default)
  // means this bill has no tax at all - existing bills/clients are unaffected.
  gstPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
  cgstAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  sgstAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 }, // cgstAmount + sgstAmount, kept for easy display
  paymentMode: { type: DataTypes.STRING },
  visitAddress: { type: DataTypes.STRING },
  transactionNumber: { type: DataTypes.STRING },
  remarks: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'bill' });

const BillItem = sequelize.define('BillItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  // The client's standard price at billing time - equal to `price` for a
  // normal walk-in, but kept separately so a Payor invoice can show the
  // discount given (originalPrice - price) even after prices change later.
  originalPrice: { type: DataTypes.DECIMAL(10, 2) },
  // A single test within a bill can be cancelled independently of the rest
  // of the bill ("test-wise" cancellation) - see Refund below for the money.
  status: { type: DataTypes.ENUM('ACTIVE', 'CANCELLED'), allowNull: false, defaultValue: 'ACTIVE' },
  ...AUDIT_FIELDS,
}, { tableName: 'bill_item' });

// One row per refund payout against a cancelled BillItem. Kept as its own
// table (rather than a single amount on BillItem) so a partial refund now
// and a further partial refund later both have their own record, and so the
// payment mode/reason of each payout is tracked individually.
const Refund = sequelize.define('Refund', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  mode: { type: DataTypes.STRING, allowNull: false },
  reason: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'refund' });

// One row per discount applied to a bill after it was already created
// ("post-billing"), separate from the discount that can be given at the
// time of billing (Bill.discount). Unlike a cancellation, no test is
// cancelled - it just reduces what the bill still owes, and (since the
// full amount is normally already collected at billing time) money is
// physically handed back, so a payment mode is recorded just like a Refund.
const BillDiscount = sequelize.define('BillDiscount', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  // How much of `amount` was taken off the bill's still-outstanding
  // dueAmount, vs handed back out of money already collected (paidAmount) -
  // recorded so cancelling this discount later can restore each side
  // exactly, instead of guessing from the bill's current totals.
  fromDueAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  mode: { type: DataTypes.STRING, allowNull: false },
  reason: { type: DataTypes.STRING, allowNull: false },
  // Set when this discount is later reversed - kept as a record (never
  // deleted) rather than removed, so the audit trail shows it was given and
  // then cancelled, not that it never happened.
  cancelledAt: { type: DataTypes.DATE },
  ...AUDIT_FIELDS,
}, { tableName: 'bill_discount' });

// One row per payment recorded against a bill's dueAmount - a patient billed
// with a shortfall (or who owes again after a post-billing discount was
// cancelled) pays it off in one or more installments, each its own record
// with its own payment mode, the same pattern as Refund/BillDiscount above.
const DuePayment = sequelize.define('DuePayment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  mode: { type: DataTypes.STRING, allowNull: false },
  reference: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'due_payment' });

// ---- LAB ------------------------------------------------------------------
const Sample = sequelize.define('Sample', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  barcode: { type: DataTypes.STRING, unique: true, allowNull: false },
  status: {
    type: DataTypes.ENUM('PENDING_COLLECTION', 'COLLECTED', 'RESULT_ENTERED', 'VERIFIED', 'RELEASED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'PENDING_COLLECTION',
  },
  collectedAt: { type: DataTypes.DATE },
  // Audit trail of the lab steps (who + when), shown on Reports > Lab Details.
  collectedBy: { type: DataTypes.STRING },
  resultEnteredAt: { type: DataTypes.DATE },
  resultEnteredBy: { type: DataTypes.STRING },
  // Optional per-test remarks printed on the report under "Remarks".
  // remarksBig: entered in the large box (multi-line interpretation, may hold
  // a pasted table) rather than the one-line box - kept so it reopens the same way.
  remarks: { type: DataTypes.TEXT },
  remarksBig: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ...AUDIT_FIELDS,
}, { tableName: 'sample' });

const Result = sequelize.define('Result', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // TEXT, not STRING (which defaults to VARCHAR(255)) - a free-text
  // interpretation result (e.g. a culture & sensitivity paragraph) can
  // easily run past 255 characters.
  value: { type: DataTypes.TEXT },
  isAbnormal: { type: DataTypes.BOOLEAN, defaultValue: false },
  ...AUDIT_FIELDS,
}, { tableName: 'result' });

const Report = sequelize.define('Report', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  status: {
    type: DataTypes.ENUM('PENDING', 'VERIFIED', 'RELEASED', 'REVOKED'),
    allowNull: false,
    defaultValue: 'PENDING',
  },
  verifiedAt: { type: DataTypes.DATE },
  releasedAt: { type: DataTypes.DATE },
  // The ClientUser who clicked "Release" - used to print *that* user's own
  // doctor signature/designation (set up in Report Branding) on this
  // report's footer, rather than whoever happens to be viewing/printing it.
  releasedByUserId: { type: DataTypes.INTEGER },
  // Set when a released report is later revoked (e.g. a mistake was found) -
  // kept as a record rather than cleared, same "stamp, don't delete" idea as
  // BillDiscount.cancelledAt. The underlying Sample rolls back to VERIFIED so
  // it can be corrected and released again; these two fields stay as the
  // historical record of the earlier revoke even after that happens.
  revokedAt: { type: DataTypes.DATE },
  revokedReason: { type: DataTypes.STRING },
  // Who verified / released / revoked (audit trail, alongside the *At times).
  verifiedBy: { type: DataTypes.STRING },
  releasedBy: { type: DataTypes.STRING },
  revokedBy: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'report' });

// ---- TICKET ----------------------------------------------------------------
const Ticket = sequelize.define('Ticket', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  subject: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  status: {
    type: DataTypes.ENUM('OPEN', 'ASSIGNED', 'RESOLVED', 'CLOSED'),
    allowNull: false,
    defaultValue: 'OPEN',
  },
  assignedTo: { type: DataTypes.STRING },
  ...AUDIT_FIELDS,
}, { tableName: 'ticket' });

// ---- ANNOUNCEMENT (login caption) -----------------------------------------
// A caption Chief Admin publishes to every client: shown on the client login
// page and as a banner inside the app while active and today falls within
// fromDate..toDate (inclusive, India date). Either date may be left open.
const Announcement = sequelize.define('Announcement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  message: { type: DataTypes.TEXT, allowNull: false },
  tone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'info' }, // info | warning | success
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  fromDate: { type: DataTypes.DATEONLY },
  toDate: { type: DataTypes.DATEONLY },
  ...AUDIT_FIELDS,
}, { tableName: 'announcement' });

// ===== ASSOCIATIONS =========================================================
Client.hasMany(ClientSubscription, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientSubscription.belongsTo(Client, { foreignKey: 'clientId' });

ClientSubscription.hasMany(ClientPayment, { foreignKey: 'subscriptionId' });
ClientPayment.belongsTo(ClientSubscription, { foreignKey: 'subscriptionId' });

Client.hasMany(ClientPayment, { foreignKey: 'clientId' });
ClientPayment.belongsTo(Client, { foreignKey: 'clientId' });

Role.hasMany(RolePermission, { foreignKey: 'roleId', onDelete: 'CASCADE' });
RolePermission.belongsTo(Role, { foreignKey: 'roleId' });

Client.hasMany(ClientUser, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientUser.belongsTo(Client, { foreignKey: 'clientId' });

// A user can hold more than one role (e.g. FRONT_OFFICE + LAB_USER).
ClientUser.belongsToMany(Role, { through: 'client_user_role', foreignKey: 'clientUserId', otherKey: 'roleId' });
Role.belongsToMany(ClientUser, { through: 'client_user_role', foreignKey: 'roleId', otherKey: 'clientUserId' });

// Chief-Admin-side staff accounts (e.g. Admin, Marketing) - same Role table, separate join table.
ChiefAdmin.belongsToMany(Role, { through: 'chief_admin_role', foreignKey: 'chiefAdminId', otherKey: 'roleId' });
Role.belongsToMany(ChiefAdmin, { through: 'chief_admin_role', foreignKey: 'roleId', otherKey: 'chiefAdminId' });

Client.hasMany(ClientLocation, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientLocation.belongsTo(Client, { foreignKey: 'clientId' });
ClientLocation.hasMany(ClientUser, { foreignKey: 'locationId' });
ClientUser.belongsTo(ClientLocation, { foreignKey: 'locationId' });
ClientLocation.hasMany(ClientLocationTestPrice, { foreignKey: 'locationId', onDelete: 'CASCADE' });
ClientLocationTestPrice.belongsTo(ClientLocation, { foreignKey: 'locationId' });
TestMaster.hasMany(ClientLocationTestPrice, { foreignKey: 'testId', onDelete: 'CASCADE' });
ClientLocationTestPrice.belongsTo(TestMaster, { foreignKey: 'testId' });
ClientLocation.hasMany(Bill, { foreignKey: 'locationId' });
Bill.belongsTo(ClientLocation, { foreignKey: 'locationId' });
ClientLocation.hasMany(Sample, { foreignKey: 'locationId' });
Sample.belongsTo(ClientLocation, { foreignKey: 'locationId' });

Client.hasMany(ClientTestPrice, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientTestPrice.belongsTo(Client, { foreignKey: 'clientId' });

TestMaster.hasMany(ClientTestPrice, { foreignKey: 'testId' });
ClientTestPrice.belongsTo(TestMaster, { foreignKey: 'testId' });

// Nullable - a universal parameter (clientId null) has no Client row to cascade from.
Client.hasMany(ParameterMaster, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ParameterMaster.belongsTo(Client, { foreignKey: 'clientId' });

Client.hasMany(ClientParameterTrend, { foreignKey: { name: 'clientId', allowNull: false }, onDelete: 'CASCADE' });
ClientParameterTrend.belongsTo(Client, { foreignKey: 'clientId' });
ParameterMaster.hasMany(ClientParameterTrend, { foreignKey: { name: 'parameterId', allowNull: false }, onDelete: 'CASCADE' });
ClientParameterTrend.belongsTo(ParameterMaster, { foreignKey: 'parameterId' });

Client.hasMany(ClientParameterLabel, { foreignKey: { name: 'clientId', allowNull: false }, onDelete: 'CASCADE' });
ClientParameterLabel.belongsTo(Client, { foreignKey: 'clientId' });
ParameterMaster.hasMany(ClientParameterLabel, { foreignKey: { name: 'parameterId', allowNull: false }, onDelete: 'CASCADE' });
ClientParameterLabel.belongsTo(ParameterMaster, { foreignKey: 'parameterId' });

Client.hasMany(ClientHiddenParameter,{ foreignKey: { name: 'clientId', allowNull: false }, onDelete: 'CASCADE' });
ClientHiddenParameter.belongsTo(Client, { foreignKey: 'clientId' });
TestMaster.hasMany(ClientHiddenParameter, { foreignKey: { name: 'testId', allowNull: false }, onDelete: 'CASCADE' });
ClientHiddenParameter.belongsTo(TestMaster, { foreignKey: 'testId' });
ParameterMaster.hasMany(ClientHiddenParameter, { foreignKey: { name: 'parameterId', allowNull: false }, onDelete: 'CASCADE' });
ClientHiddenParameter.belongsTo(ParameterMaster, { foreignKey: 'parameterId' });

Client.hasMany(ClientTestShortName, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientTestShortName.belongsTo(Client, { foreignKey: 'clientId' });

TestMaster.hasMany(ClientTestShortName, { foreignKey: 'testId' });
ClientTestShortName.belongsTo(TestMaster, { foreignKey: 'testId' });
Client.hasMany(ClientTestSpecimen, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientTestSpecimen.belongsTo(Client, { foreignKey: 'clientId' });
TestMaster.hasMany(ClientTestSpecimen, { foreignKey: 'testId', onDelete: 'CASCADE' });
ClientTestSpecimen.belongsTo(TestMaster, { foreignKey: 'testId' });

Client.hasMany(Package, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Package.belongsTo(Client, { foreignKey: 'clientId' });

Package.belongsToMany(TestMaster, { through: 'package_test', foreignKey: 'packageId', otherKey: 'testId' });
TestMaster.belongsToMany(Package, { through: 'package_test', foreignKey: 'testId', otherKey: 'packageId' });

TestMaster.hasMany(ParameterMaster, { foreignKey: 'testId', onDelete: 'CASCADE' });
ParameterMaster.belongsTo(TestMaster, { foreignKey: 'testId' });

// A parameter can also be *assigned* to other tests beyond the one it was
// created on (its "home" test above) - same code, unit, method and normal
// ranges shared everywhere it's assigned, so updating a range updates it for
// every test that uses it instead of each test keeping its own duplicate row.
TestMaster.belongsToMany(ParameterMaster, { through: 'test_parameter_link', as: 'AssignedParameters', foreignKey: 'testId', otherKey: 'parameterId' });
ParameterMaster.belongsToMany(TestMaster, { through: 'test_parameter_link', as: 'AssignedTests', foreignKey: 'parameterId', otherKey: 'testId' });

Client.hasMany(Patient, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Patient.belongsTo(Client, { foreignKey: 'clientId' });

Client.hasMany(ReferralDoctor, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ReferralDoctor.belongsTo(Client, { foreignKey: 'clientId' });

Client.hasMany(Payor, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Payor.belongsTo(Client, { foreignKey: 'clientId' });

Payor.hasMany(PayorTestPrice, { foreignKey: 'payorId', onDelete: 'CASCADE' });
PayorTestPrice.belongsTo(Payor, { foreignKey: 'payorId' });
TestMaster.hasMany(PayorTestPrice, { foreignKey: 'testId' });
PayorTestPrice.belongsTo(TestMaster, { foreignKey: 'testId' });

Client.hasMany(PayorInvoice, { foreignKey: 'clientId', onDelete: 'CASCADE' });
PayorInvoice.belongsTo(Client, { foreignKey: 'clientId' });
Payor.hasMany(PayorInvoice, { foreignKey: 'payorId', onDelete: 'CASCADE' });
PayorInvoice.belongsTo(Payor, { foreignKey: 'payorId' });

PayorInvoice.hasMany(PayorInvoiceItem, { foreignKey: 'payorInvoiceId', onDelete: 'CASCADE' });
PayorInvoiceItem.belongsTo(PayorInvoice, { foreignKey: 'payorInvoiceId' });
PayorInvoiceItem.belongsTo(Bill, { foreignKey: 'billId' });
PayorInvoiceItem.belongsTo(BillItem, { foreignKey: 'billItemId' });

PayorInvoice.hasMany(PayorInvoiceCollection, { foreignKey: 'payorInvoiceId', onDelete: 'CASCADE' });
PayorInvoiceCollection.belongsTo(PayorInvoice, { foreignKey: 'payorInvoiceId' });

Client.hasMany(Bill, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Bill.belongsTo(Client, { foreignKey: 'clientId' });

Payor.hasMany(Bill, { foreignKey: 'payorId' });
Bill.belongsTo(Payor, { foreignKey: 'payorId' });

Patient.hasMany(Bill, { foreignKey: 'patientId' });
Bill.belongsTo(Patient, { foreignKey: 'patientId' });

ReferralDoctor.hasMany(Bill, { foreignKey: 'referredDoctorId' });
Bill.belongsTo(ReferralDoctor, { foreignKey: 'referredDoctorId' });

ClientUser.hasMany(Bill, { foreignKey: 'createdByUserId' });
Bill.belongsTo(ClientUser, { foreignKey: 'createdByUserId', as: 'creator' });

Bill.hasMany(BillItem, { foreignKey: 'billId', onDelete: 'CASCADE' });
BillItem.belongsTo(Bill, { foreignKey: 'billId' });

TestMaster.hasMany(BillItem, { foreignKey: 'testId' });
BillItem.belongsTo(TestMaster, { foreignKey: 'testId' });

// Set when the item was billed as part of a package - each of the package's
// tests is its own BillItem (own sample/report), carrying a share of the
// package price. Null for a test billed on its own.
Package.hasMany(BillItem, { foreignKey: 'packageId' });
BillItem.belongsTo(Package, { foreignKey: 'packageId' });

BillItem.hasOne(Sample, { foreignKey: 'billItemId' });
Sample.belongsTo(BillItem, { foreignKey: 'billItemId' });

Bill.hasMany(Refund, { foreignKey: 'billId', onDelete: 'CASCADE' });
Refund.belongsTo(Bill, { foreignKey: 'billId' });
BillItem.hasMany(Refund, { foreignKey: 'billItemId', onDelete: 'CASCADE' });
Refund.belongsTo(BillItem, { foreignKey: 'billItemId' });

Bill.hasMany(BillDiscount, { foreignKey: 'billId', onDelete: 'CASCADE' });
BillDiscount.belongsTo(Bill, { foreignKey: 'billId' });

Bill.hasMany(DuePayment, { foreignKey: 'billId', onDelete: 'CASCADE' });
DuePayment.belongsTo(Bill, { foreignKey: 'billId' });

Client.hasMany(Sample, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Sample.belongsTo(Client, { foreignKey: 'clientId' });

Sample.hasMany(Result, { foreignKey: 'sampleId', onDelete: 'CASCADE' });
Result.belongsTo(Sample, { foreignKey: 'sampleId' });

ParameterMaster.hasMany(Result, { foreignKey: 'parameterId' });
Result.belongsTo(ParameterMaster, { foreignKey: 'parameterId' });

ParameterMaster.hasMany(ParameterNormalRange, { foreignKey: 'parameterId', onDelete: 'CASCADE' });
Client.hasMany(ClientParameterOverride, { foreignKey: { name: 'clientId', allowNull: false }, onDelete: 'CASCADE' });
ClientParameterOverride.belongsTo(Client, { foreignKey: 'clientId' });
ParameterMaster.hasMany(ClientParameterOverride, { foreignKey: { name: 'parameterId', allowNull: false }, onDelete: 'CASCADE' });
ClientParameterOverride.belongsTo(ParameterMaster, { foreignKey: 'parameterId' });
ParameterNormalRange.belongsTo(ParameterMaster, { foreignKey: 'parameterId' });

Sample.hasOne(Report, { foreignKey: 'sampleId', onDelete: 'CASCADE' });
Report.belongsTo(Sample, { foreignKey: 'sampleId' });

Report.belongsTo(ClientUser, { foreignKey: 'releasedByUserId', as: 'ReleasedByUser' });

Client.hasMany(Ticket, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Ticket.belongsTo(Client, { foreignKey: 'clientId' });

// ===== AUDIT HOOKS ===========================================================
// Applied globally so createdBy/updatedBy are stamped on every model above
// without every controller having to remember to set them.
function hasAuditFields(model) {
  return !!(model?.rawAttributes?.createdBy && model?.rawAttributes?.updatedBy);
}

sequelize.addHook('beforeCreate', (instance) => {
  if (hasAuditFields(instance.constructor)) {
    const actor = getCurrentActor();
    instance.createdBy = actor;
    instance.updatedBy = actor;
  }
});

sequelize.addHook('beforeBulkCreate', (instances) => {
  const actor = getCurrentActor();
  for (const instance of instances) {
    if (hasAuditFields(instance.constructor)) {
      instance.createdBy = actor;
      instance.updatedBy = actor;
    }
  }
});

sequelize.addHook('beforeUpdate', (instance) => {
  if (hasAuditFields(instance.constructor)) {
    instance.updatedBy = getCurrentActor();
  }
});

// Static `Model.update({...}, { where })` calls bypass instance hooks, so
// they need their own hook to still get stamped.
sequelize.addHook('beforeBulkUpdate', (options) => {
  if (hasAuditFields(options.model) && options.attributes) {
    options.attributes.updatedBy = getCurrentActor();
    // Sequelize computes which columns to actually write (options.fields)
    // before hooks run, so a key only added here would otherwise be
    // silently dropped from the generated SQL - it has to be added here too.
    if (Array.isArray(options.fields) && !options.fields.includes('updatedBy')) {
      options.fields.push('updatedBy');
    }
  }
});

module.exports = {
  sequelize,
  ChiefAdmin,
  NotificationSetting,
  NotificationTemplate,
  RoleScreenDefault,
  ClientRoleScreen,
  Client,
  ClientSubscription,
  ClientPayment,
  Role,
  RolePermission,
  ClientUser,
  ClientLocation,
  ClientLocationTestPrice,
  TestGroup,
  StoredFile,
  PatientTitle,
  TestMaster,
  ParameterMaster,
  ParameterNormalRange,
  ClientParameterOverride,
  ClientTestShortName,
  ClientTestSpecimen,
  ClientParameterTrend,
  ClientHiddenParameter,
  ClientParameterLabel,
  ClientTestPrice,
  Package,
  Patient,
  ReferralDoctor,
  Payor,
  PayorTestPrice,
  PayorInvoice,
  PayorInvoiceItem,
  PayorInvoiceCollection,
  Bill,
  BillItem,
  Refund,
  BillDiscount,
  DuePayment,
  Sample,
  Result,
  Report,
  Ticket,
  Announcement,
};
