const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const academySource = fs.readFileSync(path.join(__dirname, '../academy-admin.js'), 'utf8');

test('UV editor direct add appears before approval queues and writes an approved member', () => {
  const direct = source.indexOf('<h3>에디터 회원 직접 추가</h3>');
  const pending = source.indexOf('<h3>가입 승인 대기');
  assert.ok(direct > 0 && direct < pending);
  assert.match(source, /async function addEditorMember\(\)/);
  assert.match(source, /supabasePost\('uvengers_editor_members',[\s\S]*status: 'approved'/);
  assert.match(source, /phone_last4: phone \|\| null/);
  assert.match(source, /confirm\(`\$\{email\} 회원을 승인 상태로 바로 추가할까요\?`\)/);
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
  assert.match(academySource, /searchTimer=setTimeout\(\(\)=>\{ searchTimer=undefined; onChange\(search\.value,sort\.value,result\); \},100\)/);
});
