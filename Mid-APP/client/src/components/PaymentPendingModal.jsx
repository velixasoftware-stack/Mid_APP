import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const BLOCKED_MONTH_OPTIONS = [
  { value: 1, label: 'This cycle only (1 month)' },
  { value: 3, label: 'Pay in advance — 3 months' },
  { value: 6, label: 'Pay in advance — 6 months' },
  { value: 12, label: 'Pay in advance — 12 months' },
];

const TOPUP_MONTH_OPTIONS = [
  { value: 1, label: 'Extend by 1 month' },
  { value: 3, label: 'Extend by 3 months' },
  { value: 6, label: 'Extend by 6 months' },
  { value: 12, label: 'Extend by 12 months' },
];

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

// `dismissible` (already paid, opened voluntarily via "Pay in Advance") lets
// the client close without paying; the blocking case (subscription actually
// pending/expired) does not, matching the "access stays blocked" business rule.
export default function PaymentPendingModal({ dismissible = false, onClose }) {
  const { auth, markPaid } = useAuth();
  const qrRequired = auth?.client?.qrPaymentRequired !== false;
  const isTopUp = dismissible;
  const monthOptions = isTopUp ? TOPUP_MONTH_OPTIONS : BLOCKED_MONTH_OPTIONS;
  const [months, setMonths] = useState(1);
  const [order, setOrder] = useState(null);
  const [paidResult, setPaidResult] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function handlePayNow() {
    setLoading(true);
    setStatus('');
    try {
      const { data } = await api.post('/payments/create-order', { months });
      setOrder(data);

      if (!data.mock) {
        const ok = await loadRazorpayScript();
        if (!ok) {
          setStatus('Could not load payment gateway. Please try again.');
          return;
        }
        const rzp = new window.Razorpay({
          key: data.keyId,
          amount: data.amount,
          currency: data.currency,
          order_id: data.orderId,
          name: 'HMS / LIMS Monthly Recharge',
          description: `${data.monthsCovered} month(s) from ${data.subscriptionMonth}`,
          handler: async (response) => {
            const { data: result } = await api.post('/payments/verify', {
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });
            setPaidResult(result);
          },
        });
        rzp.open();
      }
    } catch (err) {
      setStatus(err.response?.data?.message || 'Could not start payment');
    } finally {
      setLoading(false);
    }
  }

  async function handleMockConfirm() {
    setLoading(true);
    try {
      const { data: result } = await api.post('/payments/verify', { orderId: order.orderId });
      setPaidResult(result);
    } catch (err) {
      setStatus(err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    markPaid();
    onClose?.();
  }

  if (paidResult) {
    return (
      <div className="modal-overlay">
        <div className="modal-card">
          <h2>Payment Successful</h2>
          <p>
            {paidResult.monthsCovered > 1
              ? `${paidResult.monthsCovered} months paid in advance for ${auth?.client?.clientName}.`
              : `This cycle is now paid for ${auth?.client?.clientName}.`}
          </p>
          <p>Access is enabled, paid through <strong>{formatDate(paidResult.paidThrough)}</strong>.</p>
          <button onClick={handleContinue}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2>{isTopUp ? 'Pay in Advance' : 'Payment Pending'}</h2>
        <p>
          {isTopUp ? (
            <>Top up <strong>{auth?.client?.clientName}</strong>&apos;s subscription ahead of time so it never lapses.</>
          ) : (
            <>
              Access to <strong>{auth?.client?.clientName}</strong>&apos;s application is blocked because the
              current month&apos;s subscription payment is {auth?.client?.paymentStatus?.toLowerCase() || 'pending'}.
            </>
          )}
        </p>

        {!qrRequired && (
          <p style={{ color: '#64748b' }}>
            Online payment isn&apos;t set up for your account. Your account manager handles this directly - please
            contact them to complete payment. Access will unlock automatically as soon as it&apos;s recorded.
          </p>
        )}

        {qrRequired && !order && (
          <>
            <label style={{ display: 'block', textAlign: 'left', marginBottom: 12 }}>
              <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Pay for</span>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {monthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={handlePayNow} disabled={loading}>
                {loading ? 'Please wait…' : 'Pay Now'}
              </button>
              {dismissible && <button type="button" className="secondary" onClick={onClose}>Maybe Later</button>}
            </div>
          </>
        )}

        {order && (
          <>
            <div className="qr-box">
              {order.mock ? 'MOCK QR CODE' : 'Scan QR in Razorpay window'}
              <br />
              Order: {order.orderId}
            </div>
            <p>
              {order.monthsCovered} month(s) × ₹{order.monthlyAmount} = <strong>₹{(order.amount / 100).toFixed(2)}</strong>
            </p>
            {order.mock && (
              <button onClick={handleMockConfirm} disabled={loading}>
                {loading ? 'Verifying…' : 'Simulate Payment Success (Mock)'}
              </button>
            )}
          </>
        )}

        {status && <p className="error-text">{status}</p>}
      </div>
    </div>
  );
}
