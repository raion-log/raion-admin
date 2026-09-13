const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const academySource = fs.readFileSync(path.join(__dirname, '../academy-admin.js'), 'utf8');

test('UV editor direct add appears before approval queues and goes through the server function', () => {
  const direct = source.indexOf('<h3>에디터 회원 직접 추가</h3>');
  const pending = source.indexOf('<h3>가입 승인 대기');
  assert.ok(direct > 0 && direct < pending);
  assert.match(source, /async function addEditorMember\(\)/);
  // uvengers_editor_members.id is a reference to auth.users(id), so the account must exist
  // first and only service_role can create it. A browser INSERT can never succeed: it was
  // silently broken from 2026-09-10 until 2026-09-12 because this test only looked for a
  // string in the source.
  assert.match(source, /supabaseFunction\('editor-admin-add-member', \{/);
  assert.doesNotMatch(source, /supabasePost\('uvengers_editor_members'/);
  assert.match(source, /phone_last4: phone \|\| null/);
  assert.match(source, /confirm\(`\$\{email\} 회원을 승인 상태로 바로 추가할까요\?`\)/);
  // The failure must name the real cause instead of guessing at permissions and input.
  assert.match(source, /function editorAddError\(error\)/);
  assert.match(source, /case 'member_exists':/);
  assert.doesNotMatch(source, /'회원 추가에 실패했습니다\. 권한과 입력값을 확인해주세요'/);
});

test('a one-time temporary password is shown where it can be copied, not in a toast', () => {
  // Toasts disappear after 3 seconds — the admin cannot write the password down in time.
  assert.match(source, /id="ed-add-result"/);
  assert.match(source, /function showEditorAddResult\(out\)/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /이 비밀번호는 지금만 보입니다/);
  // An existing account keeps its own password — we never reset someone else's.
  assert.match(source, /out\.created_account/);
});

test('pre-approval roster lets an admin queue people who have not signed up yet', () => {
  assert.match(source, /<h3>가입 전 미리 승인/);
  assert.match(source, /async function addPreapproved\(\)/);
  assert.match(source, /supabasePost\('uvengers_editor_preapproved', \{/);
  // The period must follow the sign-up date. Freezing a date here would burn the whole
  // period for anyone who signs up weeks after being added to the roster.
  assert.match(source, /valid_amount: amount, valid_unit: unit/);
  assert.doesNotMatch(source, /supabasePost\('uvengers_editor_preapproved',[\s\S]{0,400}valid_until/);
  // Names and e-mails are hand-entered; they go in as text, never as HTML.
  assert.match(source, /td\.textContent = value/);
  // A missing table must be visible, not swallowed into an empty list.
  assert.match(source, /명단 기능이 아직 서버에 적용되지 않았습니다/);
});

test('DELETE sends real headers', () => {
  // `headers` alone was a reference to a name that never existed — any DELETE threw.
  assert.match(source, /method: 'DELETE', headers: apiHeaders\(\)/);
  assert.doesNotMatch(source, /method: 'DELETE', headers\s*\n/);
});

test('active sessions switch to labelled cards in a narrow window', () => {
  assert.equal((source.match(/<table class="session-table">/g) || []).length, 1);
  assert.match(source, /@media \(max-width: 900px\)[\s\S]*\.session-table colgroup, \.session-table thead \{ display: none; \}/);
  for (const label of ['이메일', '허용 확장프로그램', '활성 중', '기수', '메모', '마지막 활동', '액션']) {
    assert.match(source, new RegExp(`data-label="${label}" aria-label="${label}"`));
  }
  assert.match(source, /@media \(max-width: 640px\)[\s\S]*\.tabs \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /\.form-row, \.search-bar \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
});

test('sortable headers are scoped, use native keyboard buttons, and editor bulk actions stay within the visible selection', () => {
  assert.match(source, /document\.querySelectorAll\('th\[data-sort\]'\)\.forEach/);
  assert.doesNotMatch(source, /document\.querySelectorAll\('th\.sortable'\)\.forEach\(th => \{\s*th\.addEventListener\('click'/);
  assert.match(source, /trigger\.type = 'button'/);
  assert.match(source, /trigger\.className = 'sort-button'/);
  assert.match(source, /trigger\.setAttribute\('aria-label', `\$\{label\} 정렬`\)/);
  assert.match(source, /data-editor-kind="pending" data-editor-sort="created_at"/);
  assert.match(source, /data-editor-kind="member" data-editor-sort="device_count"/);
  assert.match(source, /const visibleIds = new Set\(edRowsOf\(kind\)\.map\(member => member\.id\)\)/);
  assert.match(source, /const ids = \[\.\.\.edSel\[kind\]\]\.filter\(id => visibleIds\.has\(id\)\)/);
  assert.match(source, /setAttribute\('aria-sort'/);
  assert.doesNotMatch(academySource, /현재 페이지 목록 찾기|academy-list-controls/);
  assert.match(academySource, /\[\['name', '이름'\], \['email', 'Gmail'\], \['cohort', '기수'\], \['status', '상태'\]\]/);
});

test('uvengers tables stay inside labelled responsive scroll regions', () => {
  assert.match(source, /<div class="table-scroll" role="region" aria-label="유벤져스 가입 신청 목록" tabindex="0">\s*<table>/);
  assert.match(source, /<div class="table-scroll" role="region" aria-label="승인된 유벤져스 멤버 목록" tabindex="0">\s*<table>/);
  assert.match(source, /\.form-row \{ display: flex; flex-wrap: wrap;/);
  assert.match(source, /#tab-ext, #tab-uvengers, #tab-editor \{ width: 100%; min-width: 0; \}/);
});

test('a member can be deleted outright, not just blocked', () => {
  // Blocking leaves the row in place. To undo a mistaken entry the login account has to go
  // too — otherwise that person is silently rejected on their next sign-up ("already exists",
  // no e-mail sent).
  assert.match(source, /async function deleteEditorMember\(id, email\)/);
  assert.match(source, /supabaseFunction\('editor-admin-delete-member', \{ id, email \}\)/);
  // Both lists get the button: pending applicants and approved members.
  assert.ok((source.match(/onclick="deleteEditorMember\(/g) || []).length >= 2);
  // The confirmation must say it cannot be undone and point at 차단 for a temporary stop.
  assert.match(source, /되돌릴 수 없습니다/);
  assert.match(source, /'차단'을 쓰세요/);
  // A half-finished delete must be reported, never swallowed into a success toast.
  assert.match(source, /case 'account_delete_failed':/);
});
