const { HttpError } = require('../utils');

// UI-02: what each role may do. Routes check these names instead of hard-coding role strings,
// so changing a role's access is a one-line edit here.
const PERMISSIONS = {
  Passenger: [
    'flights:search',
    'bookings:create',
    'bookings:read:own',
    'bookings:update:own', // change seat, accessibility notes
    'bookings:cancel:own',
    'profile:update',
  ],
  Staff: [
    'flights:search',
    'bookings:create',
    'bookings:read:own',
    'bookings:update:own',
    'bookings:cancel:own',
    'profile:update',
    'bookings:read:any',
    'bookings:cancel:any',
    'flights:manage', // REP-05: add and update flights
    'passengers:read', // REP-04: passenger list
    'accessibility:read', // REP-03: accessibility overview by seat number
  ],
};

const permissionsFor = (role) => PERMISSIONS[role] || [];
const can = (role, permission) => permissionsFor(role).includes(permission);

// Must run after authenticate().
const requirePermission = (permission) => (req, res, next) =>
  can(req.user?.role, permission)
    ? next()
    : next(new HttpError(403, 'You do not have permission to do that'));

module.exports = { PERMISSIONS, permissionsFor, can, requirePermission };
