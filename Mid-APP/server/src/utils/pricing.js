const BASE_USER_COUNT = 2;
const BASE_MONTHLY_AMOUNT = 2000;
const EXTRA_USER_AMOUNT = 500;

/** Basic plan includes 2 users for ₹2000/month; each additional user adds ₹500/month. */
function calculatePlanAmount(userCount) {
  const extraUsers = Math.max(0, userCount - BASE_USER_COUNT);
  return BASE_MONTHLY_AMOUNT + extraUsers * EXTRA_USER_AMOUNT;
}

module.exports = { calculatePlanAmount, BASE_USER_COUNT, BASE_MONTHLY_AMOUNT, EXTRA_USER_AMOUNT };
