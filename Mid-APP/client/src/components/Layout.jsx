import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PaymentPendingModal from './PaymentPendingModal';
import Announcements from './Announcements';
import { Icon } from './Icons';
import api from '../api/client';

// Every screen a client-side role can be granted, keyed by the same screen
// key the backend's RoleScreenDefault/ClientRoleScreen tables use. `group`
// controls which labelled section of the sidebar it's rendered under.
export const SCREEN_CATALOG = [
  { key: 'billing', to: '/app/billing', label: 'Patient & Billing', icon: 'billing', group: 'Front Office' },
  { key: 'orders', to: '/app/orders', label: 'Orders', icon: 'orders', group: 'Front Office' },
  { key: 'lab', to: '/app/lab', label: 'Laboratory', icon: 'lab', group: 'Laboratory' },
  { key: 'pending-tests', to: '/app/pending-tests', label: 'Pending Lab Tests', icon: 'clock', group: 'Laboratory' },
  { key: 'reports', to: '/app/reports', label: 'Reports', icon: 'reports', group: 'Manager' },
  { key: 'report-branding', to: '/app/report-branding', label: 'Report Branding', icon: 'branding', group: 'Manager' },
  { key: 'payor-invoices', to: '/app/payor-invoices', label: 'Payor Invoices', icon: 'invoice', group: 'Manager' },
  { key: 'test-parameters', to: '/app/test-parameters', label: 'Test Parameters', icon: 'masters', group: 'Manager' },
  { key: 'masters', to: '/app/masters', label: 'Masters & Pricing', icon: 'masters', group: 'Admin' },
  { key: 'payors', to: '/app/payors', label: 'Payors', icon: 'building', group: 'Admin' },
  { key: 'tickets', to: '/app/tickets', label: 'Tickets', icon: 'tickets', group: 'General' },
];

const NAV_GROUP_ORDER = ['Front Office', 'Laboratory', 'Manager', 'Admin', 'General'];

/** "Front Office" -> "front-office", so each group can carry its own accent color in CSS. */
function groupSlug(label) {
  return label.toLowerCase().replace(/\s+/g, '-');
}

/** Buckets a filtered link list into the labelled sections the sidebar renders, in a fixed order, dropping empty sections. */
function groupNavLinks(links) {
  const byGroup = new Map();
  for (const item of links) {
    if (!byGroup.has(item.group)) byGroup.set(item.group, []);
    byGroup.get(item.group).push(item);
  }
  return NAV_GROUP_ORDER.map((label) => ({ label, items: byGroup.get(label) || [] })).filter((g) => g.items.length > 0);
}

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function TopbarClock() {
  const now = useClock();
  const dateStr = now.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="topbar-center">
      <div className="topbar-clock">
        <Icon name="clock" size={14} />
        <span>{dateStr} · {timeStr}</span>
      </div>
    </div>
  );
}

function TopbarUser({ name, meta }) {
  return (
    <div className="topbar-user">
      <div className="topbar-user-info">
        <div className="name">{name}</div>
        {meta && <div className="meta">{meta}</div>}
      </div>
      <div className="avatar-circle">{initial(name)}</div>
    </div>
  );
}

function SidebarBrand({ title, subtitle }) {
  return (
    <div className="sidebar-brand">
      <div className="mark-icon"><Icon name="lab" size={18} /></div>
      <div className="sidebar-brand-text">
        {title}
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}

// Used only until the real effective map has loaded from the server, or if
// that fetch fails - mirrors the screens each role could already reach
// before access became configurable, so nothing regresses.
export const DEFAULT_ROLE_SCREENS = {
  FRONT_OFFICE: ['billing', 'orders', 'pending-tests'],
  LAB_USER: ['lab', 'pending-tests'],
  MANAGER: ['reports', 'tickets', 'report-branding', 'payor-invoices', 'test-parameters', 'orders', 'pending-tests'],
  MASTER_MANAGER: ['masters', 'payors'],
};

/** ADMIN always sees every screen - it's the role that configures everyone else's access. */
export function getNavLinks(roles, roleScreens = DEFAULT_ROLE_SCREENS) {
  if (roles.includes('ADMIN')) return SCREEN_CATALOG;
  const allowedKeys = new Set(roles.flatMap((r) => roleScreens[r] || []));
  return SCREEN_CATALOG.filter((s) => allowedKeys.has(s.key));
}

export function ChiefAdminLayout() {
  const { auth, logout } = useAuth();
  const roles = auth?.user?.roles || [];
  const isAdmin = roles.includes('ADMIN');
  const isMarketing = roles.includes('MARKETING');
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className={`sidebar-overlay${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} />
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <SidebarBrand title="Chief Admin" subtitle="Control Center" />
        <nav onClick={() => setNavOpen(false)}>
          <NavLink to="/chief-admin" end><Icon name="dashboard" size={17} /><span>Dashboard</span></NavLink>
          {isAdmin && (
            <div className="nav-group nav-group-administration">
              <div className="nav-group-label">Administration</div>
              <NavLink to="/chief-admin/clients/new"><Icon name="building" size={17} /><span>Create Client</span></NavLink>
              <NavLink to="/chief-admin/masters"><Icon name="masters" size={17} /><span>Test Master</span></NavLink>
              <NavLink to="/chief-admin/patient-titles"><Icon name="user" size={17} /><span>Patient Titles</span></NavLink>
              <NavLink to="/chief-admin/test-removal"><Icon name="close" size={17} /><span>Test Removal</span></NavLink>
              <NavLink to="/chief-admin/data-reset"><Icon name="trash" size={17} /><span>Client Data Reset</span></NavLink>
              <NavLink to="/chief-admin/users"><Icon name="team" size={17} /><span>Team</span></NavLink>
              <NavLink to="/chief-admin/team-passwords"><Icon name="lock" size={17} /><span>Reset Passwords</span></NavLink>
              <NavLink to="/chief-admin/tickets"><Icon name="tickets" size={17} /><span>Tickets</span></NavLink>
              <NavLink to="/chief-admin/integrations"><Icon name="plug" size={17} /><span>Integrations</span></NavLink>
              <NavLink to="/chief-admin/sales-dashboard"><Icon name="reports" size={17} /><span>Sales Dashboard</span></NavLink>
              <NavLink to="/chief-admin/role-screen-defaults"><Icon name="branding" size={17} /><span>Role Screen Defaults</span></NavLink>
              <NavLink to="/chief-admin/announcements"><Icon name="sparkle" size={17} /><span>Login Captions</span></NavLink>
            </div>
          )}
          {/* MARKETING: their own clients only - create clients (auto-assigned to them),
              tickets from their clients, Sales Dashboard. No Team / Reset Passwords. */}
          {!isAdmin && isMarketing && (
            <div className="nav-group nav-group-administration">
              <div className="nav-group-label">Sales</div>
              <NavLink to="/chief-admin/clients/new"><Icon name="building" size={17} /><span>Create Client</span></NavLink>
              <NavLink to="/chief-admin/tickets"><Icon name="tickets" size={17} /><span>Tickets</span></NavLink>
              <NavLink to="/chief-admin/team-passwords"><Icon name="lock" size={17} /><span>Reset Passwords</span></NavLink>
              <NavLink to="/chief-admin/sales-dashboard"><Icon name="reports" size={17} /><span>Sales Dashboard</span></NavLink>
            </div>
          )}
          <div className="nav-group-label">Account</div>
          <div className="nav-group nav-group-account">
            <NavLink to="/chief-admin/reset-password"><Icon name="lock" size={17} /><span>My Password</span></NavLink>
          </div>
        </nav>
        <div className="sidebar-footer-brand">
          <img src="/velixa-icon.png" alt="Velixa Software Solutions" />
          <span>Velixa Software<br />Solutions Pvt Ltd</span>
        </div>
      </aside>
      <main className="main-content">
        <div className="topbar">
          <div className="topbar-left">
            <button className="hamburger-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
              <Icon name="menu" size={18} />
            </button>
          </div>
          <TopbarClock />
          <div className="topbar-right">
            <TopbarUser name={auth?.user?.username} meta={roles.join(' + ')} />
            <button className="secondary" onClick={logout}><Icon name="logout" size={15} /> Logout</button>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

export function AppLayout() {
  const { auth, logout, paymentRequired } = useAuth();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [roleScreens, setRoleScreens] = useState(DEFAULT_ROLE_SCREENS);
  const roles = auth?.user?.roles || [];
  const links = getNavLinks(roles, roleScreens);

  useEffect(() => {
    api.get('/role-screens/effective').then((r) => setRoleScreens(r.data)).catch(() => {});
  }, []);

  return (
    <div className="app-shell">
      <div className={`sidebar-overlay${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} />
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <SidebarBrand title={auth?.client?.clientName} subtitle={auth?.client?.multiLocation && auth.client.locationName ? `LIMS · ${auth.client.locationName}` : 'LIMS'} />
        <nav onClick={() => setNavOpen(false)}>
          <NavLink to="/app" end><Icon name="home" size={17} /><span>Home</span></NavLink>
          {groupNavLinks(links).map((g) => (
            <div className={`nav-group nav-group-${groupSlug(g.label)}`} key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {g.items.map((item) => (
                <NavLink key={item.to} to={item.to}><Icon name={item.icon} size={17} /><span>{item.label}</span></NavLink>
              ))}
            </div>
          ))}
          <div className="nav-group-label">Account</div>
          <div className="nav-group nav-group-account">
            <NavLink to="/app/reset-password"><Icon name="lock" size={17} /><span>Reset Password</span></NavLink>
          </div>
        </nav>
        <div className="sidebar-footer-brand">
          <img src="/velixa-icon.png" alt="Velixa Software Solutions" />
          <span>Velixa Software<br />Solutions Pvt Ltd</span>
        </div>
      </aside>
      <main className="main-content">
        <div className="topbar">
          <div className="topbar-left">
            <button className="hamburger-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
              <Icon name="menu" size={18} />
            </button>
            <span className={`badge ${auth?.client?.paymentStatus}`}>{auth?.client?.paymentStatus}</span>
            {auth?.client?.multiLocation && auth.client.locationName && (
              <span className="topbar-location" title="The location you are logged in at"><Icon name="pin" size={14} />{auth.client.locationName}</span>
            )}
          </div>
          <TopbarClock />
          <div className="topbar-right">
            {!paymentRequired && auth?.client?.qrPaymentRequired !== false && (
              <button className="secondary" onClick={() => setShowPaymentModal(true)}>Pay in Advance</button>
            )}
            <TopbarUser name={auth?.user?.username} meta={roles.join(' + ')} />
            <button className="secondary" onClick={logout}><Icon name="logout" size={15} /> Logout</button>
          </div>
        </div>
        <Announcements />
        {/* Don't render any screen behind the payment-pending modal - it must block access, not just cover it. */}
        {!paymentRequired && <Outlet context={{ roleScreens }} />}
      </main>
      {(paymentRequired || showPaymentModal) && (
        <PaymentPendingModal dismissible={!paymentRequired} onClose={() => setShowPaymentModal(false)} />
      )}
    </div>
  );
}
