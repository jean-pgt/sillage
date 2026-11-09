import test from 'node:test';
import assert from 'node:assert/strict';
import { isOidcAdmin, localLoginEnabled } from '../server/oidc-policy.mjs';

test('OIDC admin access fails closed without a configured rule or subject', () => {
  for (const claims of [null, {}, {sub:''}, {sub:'a',groups:['sillage-admins']}]) assert.equal(isOidcAdmin(claims,{}),false);
});
test('OIDC admin group must be an exact member of a typed group list', () => {
  const env={OIDC_ADMIN_GROUP:'sillage-admins'};
  assert.equal(isOidcAdmin({sub:'a',groups:['app-media','sillage-admins']},env),true);
  for(const groups of [undefined,'sillage-admins',[],['sillage-admins-extra'],['SILLAGE-ADMINS'],[true,'sillage-admins']]) assert.equal(isOidcAdmin({sub:'a',groups},env),false);
});
test('subject allowlist cannot bypass the mandatory admin group', () => {
  assert.equal(isOidcAdmin({sub:'a',groups:['app-media']},{OIDC_ADMIN_GROUP:'sillage-admins',OIDC_ADMIN_SUBJECTS:'a'}),false);
  assert.equal(isOidcAdmin({sub:'a'},{OIDC_ADMIN_SUBJECTS:'b, a'}),true);
});
test('SSO-only mode disables local access explicitly', () => {
  assert.equal(localLoginEnabled({}),true);
  assert.equal(localLoginEnabled({LOCAL_LOGIN_ENABLED:'false'}),false);
});
