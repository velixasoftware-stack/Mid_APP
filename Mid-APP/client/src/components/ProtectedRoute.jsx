import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ type, roles, children }) {
  const { auth } = useAuth();

  // Chief Admin pages send a signed-out visitor to the separate Chief Admin login.
  const loginPath = type === 'CHIEF_ADMIN' ? '/chief-admin/login' : '/';
  if (!auth) return <Navigate to={loginPath} replace />;
  if (auth.user.type !== type) return <Navigate to={loginPath} replace />;

  const userRoles = auth.user.roles || [];
  if (roles && !userRoles.includes('ADMIN') && !roles.some((r) => userRoles.includes(r))) {
    return <Navigate to={type === 'CHIEF_ADMIN' ? '/chief-admin' : '/app'} replace />;
  }

  return children;
}
