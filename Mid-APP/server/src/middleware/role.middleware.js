/** Restricts a route to client users holding at least one of the given roles (ADMIN always allowed through). */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (req.user?.type !== 'CLIENT_USER') {
      return res.status(403).json({ message: 'Client user access required' });
    }
    const userRoles = req.user.roles || [];
    if (userRoles.includes('ADMIN') || userRoles.some((r) => allowedRoles.includes(r))) {
      return next();
    }
    return res.status(403).json({ message: 'You do not have permission to access this screen' });
  };
}

module.exports = { requireRole };
