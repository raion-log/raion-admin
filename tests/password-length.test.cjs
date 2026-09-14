const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('shared-auth recovery form accepts the six-character policy without changing recovery', () => {
  const source = fs.readFileSync(path.join(__dirname, '../reset.html'), 'utf8');
  assert.equal((source.match(/minlength="6"/g) || []).length, 2);
  assert.doesNotMatch(source, /minlength="8"|8자 이상/);
  assert.match(source, /detectSessionInUrl: true, persistSession: false/);
  assert.match(source, /pw !== pw2/);
  assert.match(source, /sb.auth.updateUser\(\{ password: pw \}\)/);
});
