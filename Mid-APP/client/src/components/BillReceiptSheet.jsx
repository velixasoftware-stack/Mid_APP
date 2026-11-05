import { numberToWords } from '../utils/numberToWords';
import { doctorLabel, patientLabel } from '../utils/format';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// A package is billed as one line at its price; the tests it includes are
// listed under it (each has its own sample/barcode for the lab). Items keep
// their bill order, grouped at the package's first item.
function receiptLines(items) {
  const lines = [];
  const pkgLine = new Map();
  for (const item of items) {
    if (!item.Package) { lines.push({ type: 'test', item }); continue; }
    if (!pkgLine.has(item.Package.id)) {
      const line = { type: 'package', pkg: item.Package, items: [] };
      pkgLine.set(item.Package.id, line);
      lines.push(line);
    }
    pkgLine.get(item.Package.id).items.push(item);
  }
  return lines;
}

function itemStatus(item) {
  const refunded = (item.Refunds || []).reduce((sum, r) => sum + Number(r.amount), 0);
  return `${item.status === 'CANCELLED' ? 'Cancelled' : 'Active'}${refunded > 0 ? ` (₹${refunded.toFixed(2)} refunded)` : ''}`;
}

// A credit bill's payment status (from the payor invoice it was put on).
const CREDIT_STATUS = {
  DUE: 'Payment Due',
  PENDING: 'Payment Due - invoiced',
  PARTIALLY_COLLECTED: 'Partially Collected',
  COLLECTED: 'Collected',
};

// The printable Bill/Receipt layout - shared verbatim between Front Desk
// (right after a bill is generated) and Orders' "Print Bill" button, so the
// two can never drift into different-looking receipts again.
export default function BillReceiptSheet({ bill }) {
  const totalRefunded = bill.BillItems.reduce(
    (sum, item) => sum + (item.Refunds || []).reduce((s, r) => s + Number(r.amount), 0), 0,
  );
  const totalPostDiscount = (bill.BillDiscounts || []).reduce((sum, d) => sum + Number(d.amount), 0);
  // The net amount this bill was ever meant to collect - paid-so-far plus
  // whatever's still due - independent of how paidAmount has shifted since
  // (a due payment, a refund, a post-billing discount all move paidAmount
  // without changing what the bill was originally billed for).
  const netAmount = Number(bill.paidAmount) + Number(bill.dueAmount);
  // With tests cancelled, the discount and GST shown are only the remaining
  // tests' share (activeDiscount/activeTax from the server) - the cancelled
  // tests' share left with them, so the full discount isn't shown against
  // fewer tests. A bill with nothing cancelled shows the original figures.
  const hasCancelled = bill.BillItems.some((i) => i.status === 'CANCELLED');
  const useActive = hasCancelled && bill.activeDiscount != null;
  const discountShown = useActive ? Number(bill.activeDiscount).toFixed(2) : bill.discount;
  const taxShown = useActive ? Number(bill.activeTax).toFixed(2) : bill.taxAmount;
  // Money summary from the server (bill details); a bill fresh from the Front
  // Desk has no cancellations/refunds yet and uses the simple layout below.
  const m = bill.money || null;
  const fmt = (n) => Number(n || 0).toFixed(2);
  // Nothing is "received" from the patient on a credit (payor) bill.
  const receivedShown = m ? fmt(m.paidByPatient) : (bill.payorId ? 0 : bill.paidAmount);
  // Gross + Net (after its share of the discount/GST) per test, whenever the
  // bill has a discount or GST - Net is the amount actually paid for that test.
  const showNet = (Number(bill.discount) > 0 || Number(bill.taxAmount) > 0)
    && bill.BillItems.every((it) => it.charge != null);
  // Branding details (set from Report Branding) are what's shown on a bill -
  // deliberately separate from the clientName/address/mobile/email Chief
  // Admin set at client creation, falling back to those only until this
  // client has set its own.
  const brandName = bill.Client?.brandingName || bill.Client?.clientName;
  const brandContact = [
    bill.Client?.brandingAddress || bill.Client?.address,
    bill.Client?.brandingMobile || bill.Client?.mobile,
    bill.Client?.brandingEmail || bill.Client?.email,
  ].filter(Boolean).join(' · ');

  return (
    <div className="report-sheet bill-receipt">
      <div className="bill-receipt-box">
        <div className="bill-receipt-header">
          <div className="bill-receipt-logo">
            {bill.Client?.reportLogoPath
              ? <img src={bill.Client.reportLogoPath} alt="Logo" />
              : <div className="bill-receipt-logo-fallback">{brandName}</div>}
            {bill.Client && <p className="bill-receipt-client-contact">{brandContact}</p>}
          </div>
          <div className="bill-receipt-info">
            <div><span>Name</span><strong>{patientLabel(bill.Patient)}</strong></div>
            <div><span>Bill No</span><strong>{bill.billNo}</strong></div>
            <div><span>Umr No</span><strong>{bill.Patient?.umr}</strong></div>
            <div><span>Reg.Date</span><strong>{formatDateTime(bill.createdAt)}</strong></div>
            <div><span>Age/Gender</span><strong>{bill.Patient?.age ?? '—'} {bill.Patient?.ageUnit || 'Years'} / {bill.Patient?.gender || '—'}</strong></div>
            <div><span>Ref.By</span><strong>{doctorLabel(bill.ReferralDoctor?.name) || '-'}</strong></div>
            <div><span>Client Name</span><strong>{bill.Payor?.name || '-'}</strong></div>
            <div><span>Mobile No</span><strong>{bill.Patient?.mobile || '—'}</strong></div>
          </div>
        </div>

        <h3 className="bill-receipt-title">Bill Cum Receipt</h3>

        <table className="bill-receipt-table">
          <thead><tr><th>S.No</th><th>Service Name</th><th>Barcode</th>{showNet ? <><th>Gross</th><th title="After its share of the discount / GST">Net</th></> : <th>Amount</th>}<th>Status</th></tr></thead>
          <tbody>
            {receiptLines(bill.BillItems).map((line, i) => {
              const cancelledStyle = { textDecoration: 'line-through', color: '#94a3b8' };
              if (line.type === 'package') {
                const allCancelled = line.items.every((it) => it.status === 'CANCELLED');
                return [
                  <tr key={`pkg-${line.pkg.id}-${line.items[0].id}`}>
                    <td>{i + 1}</td>
                    <td style={allCancelled ? cancelledStyle : undefined}><strong>{line.pkg.packageName}</strong> (Package)</td>
                    <td />
                    <td>₹{line.items.reduce((s, it) => s + Number(it.price), 0).toFixed(2)}</td>
                    {showNet && <td><strong>₹{line.items.reduce((s, it) => s + Number(it.charge || 0), 0).toFixed(2)}</strong></td>}
                    <td>{allCancelled ? 'Cancelled' : 'Active'}</td>
                  </tr>,
                  ...line.items.map((item) => (
                    <tr key={item.id} style={{ fontSize: '0.92em' }}>
                      <td />
                      <td style={item.status === 'CANCELLED' ? cancelledStyle : { color: '#475569' }}>↳ {item.TestMaster?.testName}</td>
                      <td>{item.Sample?.barcode}</td>
                      <td style={{ color: '#94a3b8' }}>Included</td>
                      {showNet && <td />}
                      <td>{itemStatus(item)}</td>
                    </tr>
                  )),
                ];
              }
              const { item } = line;
              return (
                <tr key={item.id}>
                  <td>{i + 1}</td>
                  <td style={item.status === 'CANCELLED' ? cancelledStyle : undefined}>{item.TestMaster?.testName}</td>
                  <td>{item.Sample?.barcode}</td>
                  <td>₹{item.price}</td>
                  {showNet && <td><strong>₹{Number(item.charge || 0).toFixed(2)}</strong></td>}
                  <td>{itemStatus(item)}</td>
                </tr>
              );
            })}
            <tr className="bill-receipt-total-row">
              <td colSpan={3}>Total</td>
              {showNet ? (
                <>
                  <td>₹{bill.totalAmount}</td>
                  <td colSpan={2}>₹{fmt(bill.BillItems.reduce((s, it) => s + Number(it.charge || 0), 0))}</td>
                </>
              ) : <td colSpan={2}>₹{bill.totalAmount}</td>}
            </tr>
          </tbody>
        </table>

        <div className="bill-receipt-footer">
          {Number(receivedShown) > 0 && (
            <p className="bill-receipt-words">
              Received with thanks from {patientLabel(bill.Patient)} a sum of ₹{receivedShown}/-
              <br />
              <strong>{numberToWords(receivedShown).toUpperCase()} ONLY</strong>
              <br />
              Payment Mode: <strong>{bill.paymentMode || (bill.Payor ? 'Credit (billed to payor)' : '—')}</strong>
            </p>
          )}

          {m ? (
            /* Step-by-step: billed → paid → refunded → kept, so anyone can
               follow the money (server: utils/billCharges.js moneySummary). */
            <div className="bill-receipt-summary">
              <div><span>Total (all tests)</span><strong>₹{fmt(m.gross)}</strong></div>
              {m.billingDiscount > 0 && <div><span>Discount</span><strong>− ₹{fmt(m.billingDiscount)}</strong></div>}
              {m.tax > 0 && (
                <>
                  <div><span>CGST ({Number(bill.gstPercent) / 2}%)</span><strong>+ ₹{fmt(m.tax / 2)}</strong></div>
                  <div><span>SGST ({Number(bill.gstPercent) / 2}%)</span><strong>+ ₹{fmt(m.tax / 2)}</strong></div>
                </>
              )}
              <div className="bill-receipt-net"><span>Bill Amount</span><strong>₹{fmt(m.billAmount)}</strong></div>
              {m.postDiscount > 0 && <div><span>Post-Billing Discount</span><strong>− ₹{fmt(m.postDiscount)}</strong></div>}
              {m.credit ? (
                // Credit bill: the payor pays through its invoice, not the patient.
                <>
                  <div><span>Billed to {m.credit.payorName} (credit)</span><strong>₹{fmt(m.credit.amount)}</strong></div>
                  <div className={m.credit.status === 'COLLECTED' ? '' : 'bill-receipt-due'}>
                    <span>Payment Status</span>
                    <strong>{CREDIT_STATUS[m.credit.status] || 'Payment Due'}{m.credit.invoiceNo ? ` (${m.credit.invoiceNo})` : ''}</strong>
                  </div>
                </>
              ) : (
                <div><span>Paid by Patient</span><strong>₹{fmt(m.paidByPatient)}</strong></div>
              )}
              {m.refunded > 0 && (
                <div>
                  <span>Refunded (cancelled tests{m.cancelledValue > 0 ? `, worth ₹${fmt(m.cancelledValue)}` : ''})</span>
                  <strong>− ₹{fmt(m.refunded)}</strong>
                </div>
              )}
              {m.postDiscountPaidOut > 0 && <div><span>Discount Returned</span><strong>− ₹{fmt(m.postDiscountPaidOut)}</strong></div>}
              {(m.refunded > 0 || m.postDiscountPaidOut > 0) && (
                <div className={`bill-receipt-net${m.netKept < 0 ? ' bill-receipt-negative' : ''}`}>
                  <span>{m.netKept < 0 ? 'Refunded More Than Paid' : 'Amount Kept'}</span>
                  <strong>{m.netKept < 0 ? `− ₹${fmt(-m.netKept)}` : `₹${fmt(m.netKept)}`}</strong>
                </div>
              )}
              {m.due > 0 && <div className="bill-receipt-due"><span>Due Amount</span><strong>₹{fmt(m.due)}</strong></div>}
              {m.excessRefund > 0 && (
                <div className="bill-receipt-warning">
                  ⚠ Refund was ₹{fmt(m.excessRefund)} more than the cancelled tests' value after discount
                </div>
              )}
              <div><span>Payment Mode</span><strong>{bill.paymentMode || (bill.Payor ? 'Credit (billed to payor)' : '—')}</strong></div>
              {bill.transactionNumber && <div><span>Transaction No</span><strong>{bill.transactionNumber}</strong></div>}
            </div>
          ) : (
          <div className="bill-receipt-summary">
            {Number(discountShown) > 0 && <div><span>Discount</span><strong>₹{discountShown}</strong></div>}
            {Number(taxShown) > 0 && (
              <>
                <div><span>CGST ({Number(bill.gstPercent) / 2}%)</span><strong>₹{(Number(taxShown) / 2).toFixed(2)}</strong></div>
                <div><span>SGST ({Number(bill.gstPercent) / 2}%)</span><strong>₹{(Number(taxShown) / 2).toFixed(2)}</strong></div>
              </>
            )}
            {totalRefunded > 0 && <div><span>Cancelled / Refunded</span><strong>₹{totalRefunded.toFixed(2)}</strong></div>}
            {totalPostDiscount > 0 && <div><span>Post-Billing Discount</span><strong>₹{totalPostDiscount.toFixed(2)}</strong></div>}
            <div className="bill-receipt-net"><span>Net Amount</span><strong>₹{netAmount.toFixed(2)}</strong></div>
            <div><span>Paid Amount</span><strong>₹{bill.paidAmount}</strong></div>
            {Number(bill.dueAmount) > 0 && (
              <div className="bill-receipt-due"><span>Due Amount</span><strong>₹{bill.dueAmount}</strong></div>
            )}
            <div><span>Payment Mode</span><strong>{bill.paymentMode || (bill.Payor ? 'Credit (billed to payor)' : '—')}</strong></div>
            {bill.transactionNumber && <div><span>Transaction No</span><strong>{bill.transactionNumber}</strong></div>}
          </div>
          )}
        </div>
      </div>

      {bill.remarks && <p style={{ marginTop: 12 }}><strong>Remarks:</strong> {bill.remarks}</p>}
    </div>
  );
}
