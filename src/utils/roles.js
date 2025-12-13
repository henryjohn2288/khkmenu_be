const STORE_ROLE_WEIGHT = {
  EDITOR: 1,
  OWNER: 2
};

const STORE_ROLES = Object.keys(STORE_ROLE_WEIGHT);

const hasStorePermission = (currentRole, requiredRole) =>
  (STORE_ROLE_WEIGHT[currentRole] || 0) >= (STORE_ROLE_WEIGHT[requiredRole] || 0);

const getActorStoreRole = (user, membership) => (user.role === 'SUPER_ADMIN' ? 'OWNER' : membership?.role || 'EDITOR');

const assertRoleAssignable = (actorRole, targetRole) => {
  if (!STORE_ROLES.includes(targetRole)) {
    const error = new Error('Invalid role');
    error.statusCode = 400;
    throw error;
  }
  if (targetRole === 'OWNER' && actorRole !== 'OWNER') {
    const error = new Error('Only store owners can assign the OWNER role');
    error.statusCode = 403;
    throw error;
  }
  if ((STORE_ROLE_WEIGHT[actorRole] || 0) < (STORE_ROLE_WEIGHT[targetRole] || 0)) {
    const error = new Error('Insufficient permission for the selected role');
    error.statusCode = 403;
    throw error;
  }
};

const assertRoleManagement = (actorRole, targetRole, actorUserId, targetUserId) => {
  if (actorUserId === targetUserId) {
    return;
  }
  if (!STORE_ROLES.includes(targetRole)) {
    const error = new Error('Invalid role');
    error.statusCode = 400;
    throw error;
  }
  if ((STORE_ROLE_WEIGHT[actorRole] || 0) <= (STORE_ROLE_WEIGHT[targetRole] || 0) && actorRole !== 'OWNER') {
    const error = new Error('You cannot change members with equal or higher roles');
    error.statusCode = 403;
    throw error;
  }
};

module.exports = {
  STORE_ROLES,
  STORE_ROLE_WEIGHT,
  hasStorePermission,
  getActorStoreRole,
  assertRoleAssignable,
  assertRoleManagement
};
