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

test('remaining days are shown once, as a badge', () => {
  // The cell used to print the badge AND a second line saying the same thing.
  assert.doesNotMatch(source, /vuNote/);
  assert.match(source, /edExpiryInfo\(m\)\.cls\}"[^>]*>\$\{edExpiryInfo\(m\)\.text\}<\/span>\s*<\/td>|edExpiryInfo\(m\)\.text\}<\/span>\s*\n/);
});

test('the tab you were on survives a refresh', () => {
  // It always jumped back to 확장프로그램. Now the tab and its subtab are remembered.
  assert.match(source, /function restoreLastTab\(\)/);
  assert.match(source, /rememberTab\(TAB_KEY, name\)/);
  assert.match(source, /rememberTab\(SUBTAB_KEY \+ group, name\)/);
  assert.doesNotMatch(source, /\n\s*showTab\('ext'\);/);   // 로그인 직후 고정 호출이 남아 있으면 안 된다
  assert.match(source, /restoreLastTab\(\);/);
  // localStorage can throw (private window, blocked site data) — both sides are guarded.
  assert.match(source, /try \{ localStorage\.setItem/);
  assert.match(source, /try \{ return localStorage\.getItem/);
});

test('the pre-approval roster accepts an Excel file', () => {
  assert.match(source, /id="ed-pre-upload"[^>]*accept="\.xlsx,\.xls,\.csv"/);
  assert.match(source, /function downloadPreapprovedTemplate\(\)/);
  assert.match(source, /function parsePreapprovedRow\(row\)/);
  assert.match(source, /async function commitPreapprovedUpload\(\)/);
  // Rows go in one at a time: a single duplicate must not roll back the whole file.
  assert.match(source, /for \(const row of rows\) \{[\s\S]{0,260}supabasePost\('uvengers_editor_preapproved', row\)/);
  // The preview must render values as text, not HTML.
  assert.match(source, /td\.textContent = v;/);
  // Period stays relative to sign-up date, same as the single-entry form.
  assert.match(source, /valid_amount: amount,\s*\n\s*valid_unit: PRE_UNITS/);
});

test('Excel rows are parsed the way a real sheet hands them over', () => {
  // ★Pulling the real function out and running it. Checking that the source merely *contains*
  //   a function is what let the 「바로 추가」 button sit broken for two days.
  const units = source.match(/const PRE_UNITS = \{[\s\S]*?\};/)[0];
  const fn = source.match(/function parsePreapprovedRow\(row\) \{[\s\S]*?\n    \}/)[0];
  const parse = new Function(`${units}\n${fn}\nreturn parsePreapprovedRow;`)();

  // 한글 머리글 + 한글 단위 — 관리자가 양식을 그대로 채운 경우
  const a = parse({ '이메일': ' Hong@Gmail.com ', '성함': '홍길동', '연락처끝4': '010-9999',
                    '기수': '유유스 1기', '유형': 'student', '이용기간': 3, '기간단위': '개월',
                    '허용기기': 2 });
  assert.equal(a.problem, undefined);
  assert.equal(a.email, 'hong@gmail.com', '공백·대문자는 정리한다');
  assert.equal(a.phone_last4, '9999', '하이픈이 있어도 끝 4자리를 뽑는다');
  assert.equal(a.valid_unit, 'months');
  assert.equal(a.valid_amount, 3);

  // 영문 머리글도 받는다
  const b = parse({ email: 'a@b.com', name: 'Kim', valid_amount: 2, valid_unit: 'weeks' });
  assert.equal(b.problem, undefined);
  assert.equal(b.valid_unit, 'weeks');
  assert.equal(b.valid_amount, 2);

  // 빈 칸은 기본값으로 — 기간을 안 적었다고 거절하지 않는다
  const c = parse({ '이메일': 'c@d.com' });
  assert.equal(c.problem, undefined);
  assert.equal(c.valid_amount, 3);
  assert.equal(c.valid_unit, 'months');
  assert.equal(c.max_devices, 2);
  assert.equal(c.member_type, 'student');
  assert.equal(c.name, null, '빈 칸은 null 로 — 빈 문자열을 넣으면 트리거가 못 채운다');

  // 잘못된 행은 무엇이 문제인지 말한다(통째로 거절하지 않는다)
  assert.match(parse({ '이메일': '없음' }).problem, /이메일/);
  assert.match(parse({ '이메일': 'e@f.com', '이용기간': 999 }).problem, /이용기간/);
  assert.match(parse({ '이메일': 'e@f.com', '허용기기': 99 }).problem, /허용기기/);

  // 모르는 유형은 조용히 수강생으로 — 서버 check 제약에 걸려 통째로 실패하는 것을 막는다
  assert.equal(parse({ '이메일': 'g@h.com', '유형': '이상한값' }).member_type, 'student');
});

test('row action buttons sit on one line, at the same height as the rest of the row', () => {
  // A margin-top on the delete button alone pushed it below its neighbour inside a flex row,
  // and a flex-wrap on .actions split 승인/거부/삭제 across three lines (2026-09-13).
  assert.match(source, /\.actions \{ display: flex; gap: 6px; align-items: center; \}/);
  // 기본 규칙(display:flex 로 시작하는 쪽)에는 flex-wrap 이 없어야 한다. 좁은 화면은 @media 에만.
  assert.doesNotMatch(source, /\.actions \{ display: flex;[^}]*flex-wrap/);
  assert.match(source, /@media \(max-width: 900px\)[\s\S]*\.actions \{ flex-wrap: wrap; \}/);
  assert.doesNotMatch(source, /style="margin-top:3px;" onclick="deleteEditorMember/);
});

test('the Excel buttons sit beside 명단에 올리기, not on their own row', () => {
  const row = source.match(/<button class="btn btn-primary" id="ed-pre-submit"[\s\S]{0,900}?<\/div>/)[0];
  assert.match(row, /ed-pre-excel/, '같은 form-row 안에 있어야 한다');
  assert.match(row, /downloadPreapprovedTemplate\(\)/);
  assert.match(row, /id="ed-pre-upload"/);
  assert.match(source, /\.ed-pre-excel \{ display: inline-flex;/);
});
