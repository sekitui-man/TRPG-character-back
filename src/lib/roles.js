export const normalizeAllowedRoles = (roles) => {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
};

export const normalizeAllowedUsers = (users) => {
  if (!Array.isArray(users)) return [];
  return users
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
};

export const userCanViewTab = (tab, participant, userId) => {
  if (!tab) return false;
  const roles = tab.allowed_roles || [];
  const users = tab.allowed_users || [];
  if (roles.length === 0 && users.length === 0) return true;
  if (userId && users.includes(userId)) return true;
  if (participant?.role && roles.includes(participant.role)) return true;
  return false;
};
