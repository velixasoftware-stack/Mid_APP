// What each test on a bill actually cost the patient. A bill-level discount
// (given at billing, plus any post-billing discount - both are in
// Bill.discount) and GST apply to the whole bill, so each test carries a share
// of them in proportion to its price:
//
//   bill charge = totalAmount - discount + taxAmount
//   test charge = bill charge x test price / totalAmount
//
// e.g. 50 + 280 + 300 = 630 with a 130 discount: the 280 test cost 222.22,
// not 280. Cancelling a test refunds at most its charge - never its list
// price - so the discount isn't left sitting on the remaining tests.

const round2 = (n) => Math.round(n * 100) / 100;

// Map of billItem id -> { charge, refunded, remaining }. Shares are rounded
// to paise with the rounding difference put on the last item, so they always
// add up exactly to the bill charge.
function itemCharges(bill, items) {
  const gross = Number(bill.totalAmount) || 0;
  const billCharge = Math.max(0, gross - Number(bill.discount || 0) + Number(bill.taxAmount || 0));
  const out = new Map();
  let allocated = 0;
  // Always allocate in the order the tests were added, so the paise
  // rounding lands on the same test whichever screen asks.
  [...items].sort((a, b) => a.id - b.id).forEach((item, i) => {
    const price = Number(item.price) || 0;
    const charge = i === items.length - 1
      ? round2(billCharge - allocated)
      : round2(gross > 0 ? billCharge * price / gross : 0);
    allocated = round2(allocated + charge);
    const refunded = round2((item.Refunds || []).reduce((s, r) => s + Number(r.amount), 0));
    out.set(item.id, { charge, refunded, remaining: round2(Math.max(0, charge - refunded)) });
  });
  return out;
}

// For cancelling one test: its unrefunded charge first comes off whatever the
// patient still owes on the bill, and only the rest - never more than the
// money actually collected - can be refunded.
function cancellationSplit(bill, itemCharge) {
  const due = Number(bill.dueAmount) || 0;
  const paid = Number(bill.paidAmount) || 0;
  const fromDue = round2(Math.min(due, itemCharge.remaining));
  const maxRefund = round2(Math.max(0, Math.min(itemCharge.remaining - fromDue, paid)));
  return { fromDue, maxRefund };
}

// Bill JSON plus, per item, its charge and what cancelling it now would do,
// and the discount/charge belonging to the still-active tests - what the
// receipt and Edit Order show once some tests are cancelled.
function withCharges(bill) {
  const json = bill.toJSON ? bill.toJSON() : bill;
  const items = json.BillItems || [];
  const charges = itemCharges(json, items);
  const gross = Number(json.totalAmount) || 0;
  let activeGross = 0;
  let activeCharge = 0;
  for (const item of items) {
    const c = charges.get(item.id);
    item.charge = c.charge;
    if (item.status === 'ACTIVE') {
      Object.assign(item, cancellationSplit(json, c));
      activeGross += Number(item.price) || 0;
      activeCharge += c.charge;
    }
  }
  json.activeGross = round2(activeGross);
  json.activeDiscount = round2(gross > 0 ? Number(json.discount || 0) * activeGross / gross : 0);
  json.activeTax = round2(gross > 0 ? Number(json.taxAmount || 0) * activeGross / gross : 0);
  json.activeCharge = round2(activeCharge);
  json.money = moneySummary(json, items, charges);
  return json;
}

// A plain money story for the receipt: what was billed, what the patient
// actually paid, what went back, and what the lab kept.
//
// paidAmount is "money kept" and older code clamped it at 0 when a refund was
// too big, so "paid by patient" is rebuilt from the records instead: kept +
// refunds + post-billing discount handed back - never more than was billed.
function moneySummary(json, items, charges) {
  const activePost = (json.BillDiscounts || []).filter((d) => !d.cancelledAt);
  const postDiscount = round2(activePost.reduce((s, d) => s + Number(d.amount), 0));
  const postDiscountPaidOut = round2(activePost.reduce((s, d) => s + Number(d.amount) - Number(d.fromDueAmount || 0), 0));
  const billingDiscount = round2(Math.max(0, Number(json.discount || 0) - postDiscount));
  const gross = round2(Number(json.totalAmount) || 0);
  const tax = round2(Number(json.taxAmount) || 0);
  const billAmount = round2(gross - billingDiscount + tax);

  const refunded = round2(items.reduce((s, i) => s + (charges.get(i.id)?.refunded || 0), 0));
  const cancelledValue = round2(items.filter((i) => i.status === 'CANCELLED').reduce((s, i) => s + (charges.get(i.id)?.charge || 0), 0));
  const kept = round2(Number(json.paidAmount) || 0);
  const due = round2(Number(json.dueAmount) || 0);
  // A credit (payor) bill: paidAmount there means "amount to invoice the
  // payor", not money from the patient - the patient paid nothing, and the
  // payor pays later through its invoice (status from withPayorStatus).
  if (json.payorId) {
    const refundedCredit = round2(items.reduce((s, i) => s + (charges.get(i.id)?.refunded || 0), 0));
    return {
      gross, billingDiscount, tax, billAmount, postDiscount, postDiscountPaidOut: 0,
      paidByPatient: 0, refunded: refundedCredit, cancelledValue: round2(items.filter((i) => i.status === 'CANCELLED').reduce((s, i) => s + (charges.get(i.id)?.charge || 0), 0)),
      netKept: 0, due: 0, excessRefund: 0,
      credit: { payorName: json.Payor?.name || 'Payor', amount: kept, status: json.payorStatus || 'DUE', invoiceNo: json.payorInvoiceNo || null },
    };
  }
  const paidByPatient = round2(Math.min(kept + refunded + postDiscountPaidOut, Math.max(0, billAmount - due)));
  const netKept = round2(paidByPatient - refunded - postDiscountPaidOut);
  return {
    gross, billingDiscount, tax, billAmount, postDiscount, postDiscountPaidOut,
    paidByPatient, refunded, cancelledValue, netKept, due,
    // Refunded more than the cancelled tests were worth after the discount
    // (only possible on bills cancelled before the refund fix).
    excessRefund: round2(Math.max(0, refunded - cancelledValue)),
  };
}

module.exports = { itemCharges, cancellationSplit, withCharges, round2 };
