import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api, { setPaymentRequiredHandler, setAuthInvalidatedHandler } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const raw = localStorage.getItem('auth');
    return raw ? JSON.parse(raw) : null;
  });
  // Restored from the saved session so a page refresh can't drop the
  // payment-pending block; re-verified against the server on load below.
  const [paymentRequired, setPaymentRequired] = useState(
    () => auth?.user?.type === 'CLIENT_USER' && auth?.client?.paymentStatus !== 'PAID'
  );
  const [sessionMessage, setSessionMessage] = useState('');

  function persist(next) {
    setAuth(next);
    if (next) {
      localStorage.setItem('auth', JSON.stringify(next));
      localStorage.setItem('token', next.token);
    } else {
      localStorage.removeItem('auth');
      localStorage.removeItem('token');
    }
  }

  function logout() {
    // Best-effort: clears currentSessionId server-side so the token can't be
    // reused even before it expires. Ignore failures (e.g. already invalid) -
    // the local session is cleared regardless.
    if (auth?.token) api.post('/auth/logout').catch(() => {});
    persist(null);
    setPaymentRequired(false);
  }

  function markUnpaid(paymentStatus) {
    setPaymentRequired(true);
    setAuth((prev) => {
      if (!prev?.client) return prev;
      const next = { ...prev, client: { ...prev.client, paymentStatus: paymentStatus || 'PENDING' } };
      localStorage.setItem('auth', JSON.stringify(next));
      return next;
    });
  }

  // Registered during render, not in an effect: child effects run before this
  // provider's, so pages fetching on first mount after a refresh would
  // otherwise hit a 402 before any handler existed and slip past the block.
  setPaymentRequiredHandler((data) => markUnpaid(data?.paymentStatus));
  // A blocked request while a session looked valid means the account was
  // deactivated or a role was changed elsewhere - force a clean re-login
  // rather than leaving stale nav/permissions on screen.
  setAuthInvalidatedHandler((message) => {
    logout();
    setSessionMessage(message || 'Your access has changed. Please log in again.');
  });

  // On every app load, re-check the real subscription status with the server
  // rather than trusting the saved session (it may have lapsed, or been paid
  // from another device, since it was stored).
  useEffect(() => {
    if (auth?.user?.type !== 'CLIENT_USER') return;
    api.get('/payments/status')
      .then(({ data }) => {
        if (!data.clientPaymentStatus) return;
        if (data.clientPaymentStatus === 'PAID') {
          setPaymentRequired(false);
          setAuth((prev) => {
            if (!prev?.client || prev.client.paymentStatus === 'PAID') return prev;
            const next = { ...prev, client: { ...prev.client, paymentStatus: 'PAID' } };
            localStorage.setItem('auth', JSON.stringify(next));
            return next;
          });
        } else {
          markUnpaid(data.clientPaymentStatus);
        }
      })
      .catch(() => {});
  }, [auth?.token]);

  async function loginChiefAdmin(username, password) {
    const { data } = await api.post('/auth/chief-admin/login', { username, password });
    persist(data);
    return data;
  }

  // locationId: the login screen's Location pick (only when the client has several).
  async function loginClientUser(clientCode, username, password, locationId) {
    const { data } = await api.post('/auth/login', { clientCode, username, password, locationId: locationId || undefined });
    persist(data);
    if (data.client?.paymentStatus !== 'PAID') setPaymentRequired(true);
    return data;
  }

  // Chief Admin opening a client's app directly, without that client's
  // clientCode/password - swaps the Chief Admin session for a client one, so
  // the caller should navigate to /app right after this resolves.
  async function impersonateClient(clientId) {
    const { data } = await api.post(`/clients/${clientId}/impersonate`);
    persist(data);
    if (data.client?.paymentStatus !== 'PAID') setPaymentRequired(true);
    return data;
  }

  function markPaid() {
    if (!auth) return;
    // lastPaymentAt always changes, even when paymentStatus was already PAID
    // (an advance top-up while already paid) - components that need to
    // refetch payment/subscription details after any payment should key off
    // this instead of paymentStatus, which wouldn't change in that case.
    const next = { ...auth, client: { ...auth.client, paymentStatus: 'PAID' }, lastPaymentAt: Date.now() };
    persist(next);
    setPaymentRequired(false);
  }

  function clearSessionMessage() {
    setSessionMessage('');
  }

  const value = useMemo(() => ({
    auth,
    paymentRequired,
    setPaymentRequired,
    sessionMessage,
    clearSessionMessage,
    loginChiefAdmin,
    loginClientUser,
    impersonateClient,
    logout,
    markPaid,
  }), [auth, paymentRequired, sessionMessage]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
