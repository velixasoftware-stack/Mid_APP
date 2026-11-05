import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { installInspectGuard } from './utils/disableInspect';
import { ChiefAdminLayout, AppLayout } from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import AppHome from './pages/AppHome';
import ChiefAdminDashboard from './pages/ChiefAdmin/Dashboard';
import ClientCreate from './pages/ChiefAdmin/ClientCreate';
import ClientDetail from './pages/ChiefAdmin/ClientDetail';
import ChiefAdminMasters from './pages/ChiefAdmin/Masters';
import PatientTitles from './pages/ChiefAdmin/PatientTitles';
import ChiefAdminUsers from './pages/ChiefAdmin/ChiefAdminUsers';
import TestRemoval from './pages/ChiefAdmin/TestRemoval';
import ClientDataReset from './pages/ChiefAdmin/ClientDataReset';
import PublicReport from './pages/PublicReport';
import ChiefAdminTickets from './pages/ChiefAdmin/Tickets';
import Integrations from './pages/ChiefAdmin/Integrations';
import SalesDashboard from './pages/ChiefAdmin/SalesDashboard';
import TeamPasswordReset from './pages/ChiefAdmin/TeamPasswordReset';
import RoleScreenDefaults from './pages/ChiefAdmin/RoleScreenDefaults';
import ResetPassword from './pages/ResetPassword';
import Masters from './pages/Admin/Masters';
import Payors from './pages/Admin/Payors';
import Tickets from './pages/Admin/Tickets';
import RoleScreens from './pages/Admin/RoleScreens';
import FrontDesk from './pages/FrontOffice/FrontDesk';
import Orders from './pages/FrontOffice/Orders';
import EditOrder from './pages/FrontOffice/EditOrder';
import BillPrint from './pages/FrontOffice/BillPrint';
import Laboratory from './pages/Lab/Laboratory';
import PendingTests from './pages/Lab/PendingTests';
import Announcements from './pages/ChiefAdmin/Announcements';
import LabReport from './pages/Lab/LabReport';
import Reports from './pages/Manager/Reports';
import ReportBranding from './pages/Manager/ReportBranding';
import PayorInvoices from './pages/Manager/PayorInvoices';
import PayorInvoiceView from './pages/Manager/PayorInvoiceView';
import TestParameters from './pages/Manager/TestParameters';

export default function App() {
  useEffect(() => installInspectGuard(), []);

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/chief-admin/login" element={<Login variant="chief" />} />
      {/* No login: the QR code printed on a lab report opens this. */}
      <Route path="/r/:token" element={<PublicReport />} />

      <Route
        path="/chief-admin"
        element={<ProtectedRoute type="CHIEF_ADMIN"><ChiefAdminLayout /></ProtectedRoute>}
      >
        <Route index element={<ChiefAdminDashboard />} />
        <Route path="clients/new" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN', 'MARKETING']}><ClientCreate /></ProtectedRoute>} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="masters" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><ChiefAdminMasters /></ProtectedRoute>} />
        <Route path="patient-titles" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><PatientTitles /></ProtectedRoute>} />
        <Route path="test-removal" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><TestRemoval /></ProtectedRoute>} />
        <Route path="data-reset" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><ClientDataReset /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><ChiefAdminUsers /></ProtectedRoute>} />
        <Route path="tickets" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN', 'MARKETING']}><ChiefAdminTickets /></ProtectedRoute>} />
        <Route path="integrations" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><Integrations /></ProtectedRoute>} />
        <Route path="sales-dashboard" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN', 'MARKETING']}><SalesDashboard /></ProtectedRoute>} />
        <Route path="team-passwords" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN', 'MARKETING']}><TeamPasswordReset /></ProtectedRoute>} />
        <Route path="role-screen-defaults" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><RoleScreenDefaults /></ProtectedRoute>} />
        <Route path="announcements" element={<ProtectedRoute type="CHIEF_ADMIN" roles={['ADMIN']}><Announcements /></ProtectedRoute>} />
        <Route path="reset-password" element={<ProtectedRoute type="CHIEF_ADMIN"><ResetPassword /></ProtectedRoute>} />
      </Route>

      <Route
        path="/app"
        element={<ProtectedRoute type="CLIENT_USER"><AppLayout /></ProtectedRoute>}
      >
        <Route index element={<AppHome />} />
        <Route path="masters" element={<ProtectedRoute type="CLIENT_USER" roles={['MASTER_MANAGER']}><Masters /></ProtectedRoute>} />
        <Route path="payors" element={<ProtectedRoute type="CLIENT_USER" roles={['MASTER_MANAGER']}><Payors /></ProtectedRoute>} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="billing" element={<ProtectedRoute type="CLIENT_USER" roles={['FRONT_OFFICE']}><FrontDesk /></ProtectedRoute>} />
        <Route path="orders" element={<ProtectedRoute type="CLIENT_USER" roles={['FRONT_OFFICE', 'MANAGER']}><Orders /></ProtectedRoute>} />
        <Route path="orders/:billId/edit" element={<ProtectedRoute type="CLIENT_USER" roles={['FRONT_OFFICE', 'MANAGER']}><EditOrder /></ProtectedRoute>} />
        <Route path="billing/print/:billId" element={<ProtectedRoute type="CLIENT_USER" roles={['FRONT_OFFICE', 'MANAGER']}><BillPrint /></ProtectedRoute>} />
        <Route path="lab" element={<ProtectedRoute type="CLIENT_USER" roles={['LAB_USER']}><Laboratory /></ProtectedRoute>} />
        <Route path="pending-tests" element={<ProtectedRoute type="CLIENT_USER" roles={['FRONT_OFFICE', 'LAB_USER', 'MANAGER']}><PendingTests /></ProtectedRoute>} />
        <Route path="report/:billId" element={<ProtectedRoute type="CLIENT_USER" roles={['LAB_USER', 'FRONT_OFFICE', 'MANAGER']}><LabReport /></ProtectedRoute>} />
        <Route path="reports" element={<ProtectedRoute type="CLIENT_USER" roles={['MANAGER']}><Reports /></ProtectedRoute>} />
        <Route path="report-branding" element={<ProtectedRoute type="CLIENT_USER" roles={['MANAGER']}><ReportBranding /></ProtectedRoute>} />
        <Route path="payor-invoices" element={<ProtectedRoute type="CLIENT_USER" roles={['MANAGER']}><PayorInvoices /></ProtectedRoute>} />
        <Route path="payor-invoices/:invoiceId" element={<ProtectedRoute type="CLIENT_USER" roles={['MANAGER']}><PayorInvoiceView /></ProtectedRoute>} />
        <Route path="test-parameters" element={<ProtectedRoute type="CLIENT_USER" roles={['MANAGER', 'MASTER_MANAGER']}><TestParameters /></ProtectedRoute>} />
        <Route path="role-screens" element={<ProtectedRoute type="CLIENT_USER" roles={['ADMIN']}><RoleScreens /></ProtectedRoute>} />
        <Route path="reset-password" element={<ProtectedRoute type="CLIENT_USER"><ResetPassword /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
