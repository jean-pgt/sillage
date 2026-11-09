// Called only with claims validated by openid-client (issuer, audience, nonce,
// expiry and signature). A configured group is mandatory, never bypassed by sub.
export function isOidcAdmin(claims, env = process.env) {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub.trim()) return false;
  const group = (env.OIDC_ADMIN_GROUP || '').trim();
  if (group) return Array.isArray(claims.groups) && claims.groups.every(value => typeof value === 'string') && claims.groups.includes(group);
  return (env.OIDC_ADMIN_SUBJECTS || '').split(',').map(value => value.trim()).filter(Boolean).includes(claims.sub);
}

export function localLoginEnabled(env = process.env) {
  return env.LOCAL_LOGIN_ENABLED !== 'false';
}
