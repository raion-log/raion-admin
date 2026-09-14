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
  // The e-mail is looked up by id, never passed through the onclick string (see the injection test).
  assert.match(source, /async function deleteEditorMember\(id\) \{\s*const email = \(editorMembers\.find\(member => member\.id === id\)/);
  assert.match(source, /supabaseFunction\('editor-admin-delete-member', \{ id, email \}\)/);
  // Both lists get the button: pending applicants and approved members.
  assert.ok((source.match(/onclick="deleteEditorMember\(/g) || []).length >= 2);
  // The confirmation must say it cannot be undone and point at 차단 for a temporary stop.
  assert.match(source, /되돌릴 수 없습니다/);
  assert.match(source, /'차단'을 쓰세요/);
  // A half-finished delete must be reported, never swallowed into a success toast.
  assert.match(source, /case 'account_delete_failed':/);
});

test('text people typed never lands inside an inline event handler string in the editor tab', () => {
  // ★2026-09-14 real Chrome: an e-mail like  x');window.__pwned=1;//@gmail.com  ran its code the
  //   moment 삭제 was clicked. edEsc turns ' into &#39;, but the HTML attribute decodes it back to '
  //   before the JS runs. Members pick their own e-mail at sign-up, so it is attacker text.
  const editor = source.slice(source.indexOf('function renderEditorPending()'), source.indexOf('(async function boot()'));
  const handlers = editor.match(/on(click|change)="[^"]*"/g) || [];
  assert.ok(handlers.length > 10, 'the editor tab should still have its handlers');
  for (const h of handlers) {
    assert.doesNotMatch(h, /edEsc\(/, `escaped text inside a handler is still injectable: ${h}`);
    assert.doesNotMatch(h, /\$\{(m|c|d|p)\.(email|name|code|memo|cohort|device_label)/, `raw typed text inside a handler: ${h}`);
  }
});

test('the device cell folds to one line and a cleared date is not shown as harmless', () => {
  // 사용자 2026-09-14: 「기기가 많아지면 그대로 다 리스트가 되니까 그 셀이 너무 커진다」 — up to 10 devices.
  assert.match(source, /devs\.length === 1 \? devLine\(devs\[0\]\)/);
  assert.match(source, /<details class="ed-dev"><summary><b>\$\{devs\.length\}대<\/b> · 최근 \$\{newestSeen\}<\/summary>/);
  assert.match(source, /\.ed-dev-item \{ display: flex;[^}]*white-space: nowrap;/);
  // The server treats valid_until = null as expired (supabase_schema.sql). The screen used to
  // call it a grey 「기간 없음」, so clearing the date by accident locked the student out silently.
  assert.match(source, /if \(!m\.valid_until\) return \{ cls: 'badge-inactive', text: '기간 없음 · 사용 불가'/);
  assert.match(source, /if \(!dateStr && !confirm\('날짜를 비우면 이 회원은 바로 에디터를 쓸 수 없게 됩니다/);
  assert.match(source, /if \(mode === 'expired'\)  return d === null \|\| d < 0;/);
  // The inline device limit used to send NaN/0/99 straight to the table.
  assert.match(source, /onchange="setEditorMaxDevices\('\$\{m\.id\}', this\)"/);
  // The start date wrapped to 「2026. 8. / 5.」 (real Chrome: 2 text lines -> 1 after nowrap).
  assert.match(source, /<td style="font-size:11px;color:var\(--text3\);white-space:nowrap;">\$\{startDate\}<\/td>/);
});

test('the Excel template example row is never uploaded as a real pre-approval', () => {
  // Forgetting to delete it pre-approved 「홍길동 · 1234」 — whoever signs up with that name and last four
  // would be auto-approved.
  const units = source.match(/const PRE_UNITS = \{[\s\S]*?\};/)[0];
  const types = source.match(/const ED_TYPE_LABEL = \{[\s\S]*?\};\s*const ED_TYPE_CODE = \{[\s\S]*?\};/)[0];
  const fn = source.match(/function parsePreapprovedRow\(row\) \{[\s\S]*?\n    \}/)[0];
  const parse = new Function(`${units}\n${types}\n${fn}\nreturn parsePreapprovedRow;`)();
  assert.match(parse({ '성함': '홍길동', '연락처끝4': '1234', '메모': '예시 (이 행은 지우세요)' }).problem, /예시 줄/);
  assert.match(parse({ '성함': '홍길동', '연락처끝4': '1234' }).problem, /예시 줄/, '메모를 지워도 예시 값 그대로면 막는다');
  assert.equal(parse({ '성함': '김철수', '연락처끝4': '5678', '메모': '예시 강의 수강' }).problem, undefined);
  // The template itself carries no e-mail column and shows the type in Korean.
  const template = source.slice(source.indexOf('function downloadPreapprovedTemplate()'), source.indexOf('function preUploadStatus('));
  assert.doesNotMatch(template, /'이메일'/);
  assert.match(template, /'유형': '수강생'/);
});

test('the pre-approval form takes no e-mail and the lists never show the English type', () => {
  const card = source.slice(source.indexOf('<!-- 가입 전 미리 승인 -->'), source.indexOf('id="ed-pre-tbody"'));
  assert.doesNotMatch(card, /id="ed-pre-email"/, '이메일 칸이 없어야 한다');
  assert.match(card, /<label for="ed-pre-name">성함 \(필수\)<\/label>/);
  assert.match(card, /<label for="ed-pre-phone">연락처 끝 4자리 \(필수\)<\/label>/);
  assert.match(card, /<thead><tr><th>성함<\/th><th>끝 4자리<\/th><th>기수<\/th><th>유형<\/th>/);
  const add = source.slice(source.indexOf('async function addPreapproved()'), source.indexOf('// ── 사전 명단 엑셀 올리기'));
  assert.doesNotMatch(add, /email/, 'addPreapproved 는 이메일을 보내지 않는다');
  assert.match(add, /if \(!\/\^\[0-9\]\{4\}\$\/\.test\(phone\)\)/);
  // 미리보기와 CSV 는 영문 유형을 그대로 찍지 않는다
  assert.match(source, /ED_TYPE_LABEL\[r\.member_type\] \|\| r\.member_type/);
  assert.match(source, /c === 'member_type' \? \(ED_TYPE_LABEL\[r\[c\]\] \|\| r\[c\]\)/);
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
  const types = source.match(/const ED_TYPE_LABEL = \{[\s\S]*?\};\s*const ED_TYPE_CODE = \{[\s\S]*?\};/)[0];
  const fn = source.match(/function parsePreapprovedRow\(row\) \{[\s\S]*?\n    \}/)[0];
  const parse = new Function(`${units}\n${types}\n${fn}\nreturn parsePreapprovedRow;`)();

  // ★이메일은 받지도 읽지도 않는다 — 수강생이 어떤 이메일로 가입할지 모른다 (사용자 2026-09-14).
  //   열쇠는 성함 + 연락처 끝 4자리다.
  const a = parse({ '이메일': 'Hong@Gmail.com', '성함': ' 홍  길동 ', '연락처끝4': '010-9999',
                    '기수': '유유스 1기', '유형': '수강생', '이용기간': 3, '기간단위': '개월', '허용기기': 2 });
  assert.equal(a.problem, undefined);
  assert.equal('email' in a, false, '이메일은 서버로 보내지 않는다');
  assert.equal(a.name, '홍 길동', '앞뒤·겹친 공백은 정리한다');
  assert.equal(a.phone_last4, '9999', '하이픈이 있어도 끝 4자리를 뽑는다');
  assert.equal(a.member_type, 'student', '한글 유형을 서버 값으로 바꾼다');
  assert.equal(a.valid_unit, 'months');
  assert.equal(a.valid_amount, 3);

  // 엑셀이 0402 를 숫자 402 로 저장한다 — 4자리로 되돌린다
  assert.equal(parse({ '성함': '김영희', '연락처끝4': 402 }).phone_last4, '0402');

  // 영문 머리글·영문 유형(예전 양식)도 받는다
  const b = parse({ name: 'Kim Lee', phone_last4: '1111', member_type: 'subscription', valid_amount: 2, valid_unit: 'weeks' });
  assert.equal(b.problem, undefined);
  assert.equal(b.member_type, 'subscription');
  assert.equal(b.valid_unit, 'weeks');

  // 빈 칸은 기본값으로 — 기간·유형을 안 적었다고 거절하지 않는다
  const c = parse({ '성함': '박민지', '연락처끝4': '2222' });
  assert.equal(c.problem, undefined);
  assert.equal(c.valid_amount, 3);
  assert.equal(c.valid_unit, 'months');
  assert.equal(c.max_devices, 2);
  assert.equal(c.member_type, 'student');
  assert.equal(c.cohort, null);

  // 잘못된 행은 무엇이 문제인지 말한다(통째로 거절하지 않는다). 열쇠가 비면 올리지 않는다.
  assert.match(parse({ '연락처끝4': '1234' }).problem, /성함/);
  assert.match(parse({ '성함': '최지우' }).problem, /연락처 끝 4자리/);
  assert.match(parse({ '성함': '최지우', '연락처끝4': '12' }).problem, /연락처 끝 4자리/);
  assert.match(parse({ '성함': '최지우', '연락처끝4': '1234', '이용기간': 999 }).problem, /이용기간/);
  assert.match(parse({ '성함': '최지우', '연락처끝4': '1234', '허용기기': 99 }).problem, /허용기기/);
  // 모르는 유형은 조용히 넘기지 않고 말한다 — 수강생으로 몰래 바꾸면 구독 회원이 수강생이 된다
  assert.match(parse({ '성함': '최지우', '연락처끝4': '1234', '유형': '이상한값' }).problem, /유형은 수강생·구독·내부·이벤트/);
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

test('a member row is one line — the 연장 controls sit beside the date, not under it', () => {
  // 유효기간 칸이 「날짜+뱃지」 아래에 <div> 로 「1 개월 연장」을 쌓아, 회원 행이 전부
  // 두 줄이 됐다. 세로만 두 배로 먹고 얻는 것이 없었다 (사용자 2026-09-14).
  // 실측: 행 높이 83px → 57px, 표 폭은 1632px 그대로.
  const cell = source.match(/<div class="ed-valid-cell">[\s\S]*?<\/div>/)[0];
  for (const part of ['type="date"', 'class="badge', 'ed-ext-dur-', 'ed-ext-unit-', '>연장</button>']) {
    assert.ok(cell.includes(part), `유효기간 칸 한 줄 안에 ${part} 가 있어야 한다`);
  }
  // 그 한 줄 안에 또 다른 <div> 가 생기면 다시 쌓인다.
  const inner = cell.replace(/^<div class="ed-valid-cell">/, '');
  assert.doesNotMatch(inner, /<div/, '칸 안에 중첩 div 를 두면 다시 두 줄이 된다');
  assert.match(source, /\.ed-valid-cell \{ display: flex;[^}]*white-space: nowrap;/);
  // 모자란 폭은 줄을 늘려 메우지 않고 표를 가로로 민다.
  assert.match(source, /\.table-scroll \{[^}]*overflow-x: auto;/);
});

test('the Excel buttons sit beside 명단에 올리기, not on their own row', () => {
  const row = source.match(/<button class="btn btn-primary" id="ed-pre-submit"[\s\S]{0,900}?<\/div>/)[0];
  assert.match(row, /ed-pre-excel/, '같은 form-row 안에 있어야 한다');
  assert.match(row, /downloadPreapprovedTemplate\(\)/);
  assert.match(row, /id="ed-pre-upload"/);
  assert.match(source, /\.ed-pre-excel \{ display: inline-flex;/);
  // Green marks the reversible helper actions, apart from 노랑(main) and 빨강(destructive).
  assert.match(row, /btn btn-success btn-small[^>]*>\s*엑셀 양식 받기/);
  assert.match(row, /btn btn-success btn-small[^>]*>\s*엑셀 업로드\(여러 명\)/);
  assert.match(source, /\.btn-success \{ background: var\(--green\); color: #fff; \}/);
  assert.match(source, /\.btn-success:hover/);
});

test('every button reserves the same 1px border, so neighbours line up', () => {
  // btn-outline carries a real 1px border while btn-danger/primary/success do not. With
  // border:none on .btn the outlined 삭제 button came out 1px taller and sat 1px higher than
  // 차단 beside it (measured 2026-09-13: 차단 t=518/h=16 vs 삭제 t=517/h=17).
  assert.match(source, /\.btn \{ padding: 10px 20px; border: 1px solid transparent;/);
  assert.doesNotMatch(source, /\.btn \{ padding: 10px 20px; border: none;/);
  // The outlined variant still shows its own border colour.
  assert.match(source, /\.btn-outline \{ background: transparent; border: 1px solid var\(--border\)/);
});

test('button and badge text never breaks across lines', () => {
  // In the real console (10 members, long device UUIDs) the 관리 column got squeezed and the
  // labels split vertically: 「차/단」, 「승/인」, 「연/장」. Other spots had already been
  // patched with inline white-space:nowrap; fix it at the source instead.
  assert.match(source, /\.btn \{[^}]*white-space: nowrap;[^}]*\}/);
  assert.match(source, /\.badge \{[^}]*white-space: nowrap;[^}]*\}/);
});

test('an actions cell stays a table cell so it follows the row height', () => {
  // `display:flex` on a <td> takes it out of table layout: the cell no longer stretches to the
  // row height and its buttons sit at the top while every other column is centred.
  // Measured 2026-09-13: 관리 칸 height 29 vs 이메일 칸 42 → after the fix both are 42.
  assert.match(source, /td\.actions \{ display: table-cell; vertical-align: middle; white-space: nowrap; \}/);
  assert.match(source, /td\.actions > \.btn \+ \.btn \{ margin-left: 6px; \}/);
  // The flex rule stays for the one place that uses a <div class="actions">.
  assert.match(source, /\.actions \{ display: flex; gap: 6px; align-items: center; \}/);
  assert.match(source, /<div class="actions"/);
});
