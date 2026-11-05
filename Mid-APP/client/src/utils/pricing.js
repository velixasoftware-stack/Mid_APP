const BASE_USER_COUNT = 2;
const BASE_MONTHLY_AMOUNT = 2000;
const EXTRA_USER_AMOUNT = 500;

/** Mirrors the server's plan pricing: ₹2000/month covers 2 users, +₹500/month per extra user. */
export function calculatePlanAmount(userCount) {
  const extraUsers = Math.max(0, userCount - BASE_USER_COUNT);
  return BASE_MONTHLY_AMOUNT + extraUsers * EXTRA_USER_AMOUNT;
}

export { BASE_USER_COUNT, BASE_MONTHLY_AMOUNT, EXTRA_USER_AMOUNT };
