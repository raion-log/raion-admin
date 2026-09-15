/* Product-scoped API only. No direct table writes, central account bans or password handling. */
(function (global) {
  'use strict';
  function createAcademyAdmin(client, root) {
    let epoch = 0;
    let busy = false;
    let pageOffset = 0;
    let rosterCohortFilter = 'all';
    // 조회어도 화면을 다시 그려도 살아 있어야 한다 — 기수 고름과 같은 자리에 둔다.
    let rosterSearch = '';
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = String(text ?? '');
      if (className) node.className = className;
      return node;
    };
    const errorMessage = (error) => {
      if (error?.message === 'academy_session_required') return '로그인 세션이 만료되었거나 종료되었습니다. 다시 로그인해주세요.';
      if (error?.message === 'academy_roster_not_deletable') return '계정과 연결된 적이 있거나 취소되지 않은 명단은 지울 수 없습니다. 먼저 취소하거나, 연결된 줄은 그대로 두세요.';
      if (error?.message === 'academy_last_admin') return '마지막 이용 가능 관리자는 역할을 바꾸거나 정지·삭제할 수 없습니다. 다른 관리자를 먼저 지정해주세요.';
      if (error?.message === 'academy_student_roster_required') return '수강생 역할은 가입과 수강 명단 연결을 마친 계정에만 지정할 수 있습니다.';
      if (error?.message === 'academy_invalid_account' || error?.message === 'academy_invalid_cohort') return '이름·끝 4자리·역할·담당 기수를 다시 확인해주세요.';
      // 화면이 서버보다 먼저 올라가면 새 동작을 서버가 모른다 — 고장이 아니라 적용 대기라고 말한다.
      if (error?.message === 'academy_unknown_action') return '이 기능이 서버에 아직 적용되지 않았습니다. 잠시 뒤 새로고침해 다시 시도해주세요.';
      if (error?.code === '42501') return '학습실 관리 권한을 확인하지 못했습니다. 학습실 전용 관리자 등록을 확인해주세요.';
      if (error?.code === 'PGRST202' || error?.code === '42883') return '학습실 DB API가 아직 적용되지 않았습니다. DB 적용·권한 검증 후 다시 불러오세요.';
      if (error?.code === '40001') return '다른 화면에서 이 정보가 바뀌었습니다. 다시 불러온 뒤 확인해주세요.';
      return '처리 결과를 확인하지 못했습니다. 다시 불러와 현재 상태를 확인해주세요.';
    };
    const status = el('p', '', 'academy-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.tabIndex = -1;
    async function request(action, payload) {
      const controller = new AbortController();
      let timer;
      try {
        const query = client.rpc('academy_api', { action, payload });
        const response = typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
        return await Promise.race([response, new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('result_unconfirmed'));
          }, 15000);
        })]);
      } finally { clearTimeout(timer); }
    }
    async function bounded(promise) {
      let timer;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('result_unconfirmed')), 15000);
        })]);
      } finally { clearTimeout(timer); }
    }
    function message(text, error = false) {
      status.setAttribute('role', error ? 'alert' : 'status');
      status.textContent = text;
    }
    // ★단추 이름은 다른 탭과 같은 두 글자다(차단·삭제·승인·거부). 긴 이름을 쓰면
    //   수강생 표가 보이는 폭을 255px 넘겨 관리 칸이 잘렸다 (사용자 2026-09-14).
    //   뜻은 title 과 aria-label 로 온전히 남긴다.
    function briefButton(short, full, onClick, variant) {
      const node = button(short, onClick, variant);
      node.title = full;
      node.setAttribute('aria-label', full);
      return node;
    }
    function button(text, onClick, variant = 'outline') {
      const node = el('button', text);
      node.type = 'button';
      node.className = `btn btn-small btn-${variant}`;
      node.addEventListener('click', onClick);
      return node;
    }
    function shell() {
      const heading = el('div', undefined, 'academy-heading');
      heading.append(el('h2', '유유스 학습실 관리'), button('새로고침', () => load()));
      root.replaceChildren(heading,
        el('p', '가입 신청, 수강생, 기수와 수강 명단을 한 화면에서 관리합니다.', 'academy-notice'),
        status);
    }
    function disabled(value) {
      root.querySelectorAll('button, input, select').forEach(node => { node.disabled = value; });
      root.setAttribute('aria-busy', String(value));
    }
    function field(label, input) {
      const wrapper = el('label', input.required ? `${label} (필수)` : label);
      wrapper.appendChild(input);
      // 막힌 까닭을 이 칸 바로 아래에서 말하려고, 칸이 자기 이름과 자리를 기억한다.
      input.fieldLabel = label;
      input.fieldWrapper = wrapper;
      return wrapper;
    }
    function reasonField() {
      const input = el('input');
      input.type = 'text'; input.maxLength = 300; input.required = true;
      input.placeholder = '예: 수강 명단과 신청 정보를 확인함';
      return input;
    }
    function cohortField(cohorts) {
      const select = el('select');
      select.required = true;
      const empty = el('option', '배정할 기수를 선택하세요'); empty.value = '';
      select.appendChild(empty);
      for (const cohort of cohorts) {
        const option = el('option', cohort.name); option.value = String(cohort.id);
        select.appendChild(option);
      }
      return select;
    }
    let cancelConfirmation = null;
    function confirmChange(text) {
      const token = epoch;
      const previousFocus = document.activeElement;
      busy = true;
      disabled(true);
      return new Promise(resolve => {
        const dialog = el('dialog', undefined, 'academy-confirm');
        dialog.setAttribute('aria-label', '변경 내용 확인');
        const finish = accepted => {
          if (cancelConfirmation !== cancel) return;
          cancelConfirmation = null;
          if (dialog.open) dialog.close();
          dialog.remove();
          if (!accepted && token === epoch) {
            busy = false;
            disabled(false);
            if (previousFocus?.isConnected) previousFocus.focus();
          }
          resolve(accepted && token === epoch);
        };
        const cancel = () => finish(false);
        cancelConfirmation = cancel;
        const cancelButton = button('취소하고 돌아가기', cancel);
        const actions = el('div', undefined, 'academy-actions');
        actions.append(cancelButton, button('확인하고 적용', () => finish(true)));
        dialog.append(el('h3', '변경 내용 확인'), el('p', text + '\n변경은 학습실에만 적용됩니다.'), actions);
        dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
        dialog.addEventListener('close', cancel);
        root.appendChild(dialog);
        try { dialog.showModal(); cancelButton.focus(); }
        catch { cancel(); message('확인창을 열지 못했습니다. 브라우저를 새로고침해주세요.', true); }
      });
    }
    async function mutate(action, values, reason, confirmation) {
      if (busy) return;
      // ★사유가 비면 까닭을 **그 칸 바로 아래**에서도 말한다. 맨 위 문구만으로는 판에서
      //   멀어 「눌렀는데 아무 일도 안 난다」로 보였다 (사용자 2026-09-14). 칸 이름도 그대로 쓴다 —
      //   「삭제 사유」 칸에 「변경 사유를 입력해주세요」라고 달리 말하지 않게.
      const wrap = reason.fieldWrapper;
      if (!reason.value.trim()) {
        const text = (reason.fieldLabel || '변경 사유') + '를 입력해주세요.';
        message(text, true);
        if (wrap) {
          if (!wrap.stopNote) { wrap.stopNote = el('p', '', 'academy-bulk-note academy-add-stop'); wrap.appendChild(wrap.stopNote); }
          wrap.stopNote.textContent = text;
        }
        reason.focus(); return;
      }
      if (wrap?.stopNote) wrap.stopNote.textContent = '';
      const payload = { ...values, reason: reason.value.trim() };
      const confirmationEpoch = epoch;
      if (!await confirmChange(confirmation) || confirmationEpoch !== epoch) return;
      busy = true; disabled(true); message('처리 중입니다. 창을 닫지 마세요.');
      const token = epoch;
      try {
        const { data, error } = await request(action, payload);
        if (token !== epoch) return;
        if (error || data?.ok !== true) throw error || new Error('invalid_response');
        if (action === 'roster_add') rosterCohortFilter = String(values.cohort_id);
        busy = false;
        await load('변경을 저장했습니다. 최신 목록을 확인해주세요.');
      } catch (error) {
        if (token === epoch) { message(errorMessage(error), true); disabled(false); status.focus(); }
      } finally { if (token === epoch) busy = false; }
    }
    async function applyAccountChange(action, payload, successMessage) {
      if (busy) return false;
      busy = true; disabled(true); message('계정 정보를 적용하고 있습니다. 창을 닫지 마세요.');
      const token = epoch;
      try {
        const { data, error } = await request(action, payload);
        if (token !== epoch) return false;
        if (error || data?.ok !== true) throw error || new Error('invalid_response');
        busy = false;
        await load(successMessage);
        return true;
      } catch (error) {
        if (token === epoch) { message(errorMessage(error), true); disabled(false); status.focus(); }
        return false;
      } finally { if (token === epoch) busy = false; }
    }
    function command(action, row, values, reason, confirmation) {
      return mutate(action, { user_id: row.user_id, revision: row.revision, ...values }, reason, confirmation);
    }
    // ★한 사람은 **한 줄**이다 — 다른 탭들처럼 표로 세운다 (사용자 2026-09-14).
    //   예전엔 카드 + 「계정 관리」·「최근 이력」 접기라 한 사람이 화면 세 덩이를 먹었고,
    //   기수는 맨 아랫줄에 섞여 훑어보기가 안 됐다.
    //   앞 네 칸은 어느 표에서나 같은 순서다: 이메일 · 성함 · 끝 4자리 · 기수.
    const PERSON_HEAD = ['이메일', '성함', '끝 4자리', '기수'];
    function personTable(headers, selectable = false) {
      // 폭이 모자라면 줄을 늘리지 말고 가로로 민다 — 다른 탭의 .table-scroll 과 같은 규칙.
      const scroll = el('div', undefined, 'table-scroll academy-table-scroll');
      scroll.setAttribute('tabindex', '0');
      const table = el('table', undefined, 'academy-table');
      const head = el('thead'), headRow = el('tr');
      let selectAll = null;
      if (selectable) {
        selectAll = el('input'); selectAll.type = 'checkbox';
        selectAll.setAttribute('aria-label', '현재 페이지 전체 선택');
        const selectHead = el('th'); selectHead.className = 'academy-select-cell'; selectHead.appendChild(selectAll);
        headRow.appendChild(selectHead);
      }
      for (const label of [...PERSON_HEAD, ...headers]) headRow.appendChild(el('th', label));
      head.appendChild(headRow);
      const body = el('tbody');
      table.append(head, body);
      scroll.appendChild(table);
      return { scroll, body, selectAll };
    }
    function personRow(row, selector = null) {
      const tr = el('tr', undefined, 'academy-row');
      if (selector) {
        const selectorCell = cell(selector); selectorCell.className = 'academy-select-cell';
        tr.appendChild(selectorCell);
      }
      tr.append(
        el('td', row.canonical_gmail, 'academy-cell-id'),
        el('td', row.display_name),
        el('td', row.phone_last_four, 'academy-cell-four'),
        el('td', row.cohort_name || '없음', 'academy-cell-cohort')
      );
      return tr;
    }
    function cell(...nodes) {
      const td = el('td');
      td.append(...nodes);
      return td;
    }
    function disclosure(label, children, meta) {
      const details = el('details', undefined, 'academy-disclosure');
      const summary = el('summary');
      summary.append(el('span', label, 'academy-disclosure-title'));
      if (meta) summary.append(el('span', meta, 'academy-disclosure-meta'));
      const body = el('div', undefined, 'academy-disclosure-body');
      body.append(...children);
      details.append(summary, body);
      return details;
    }
    function historyLabel(entry) {
      if (entry.action === 'application_submitted') return '가입 신청';
      if (entry.action === 'application_auto_approved') return '명단 자동 확인';
      if (entry.action === 'review') return entry.detail?.after?.application_status === 'approved' ? '가입 승인' : '가입 반려';
      if (entry.action === 'assign') return '현재 기수 변경';
      if (entry.action === 'set_status') return '이용 상태 변경';
      return '계정 정보 변경';
    }
    function historyDisclosure(userId, audit) {
      const rows = audit.filter(entry => String(entry.subject_id || '') === String(userId)).slice(0, 10);
      const content = [];
      if (!rows.length) content.push(el('p', '표시할 최근 이력이 없습니다.', 'empty'));
      else {
        const list = el('ul', undefined, 'academy-history-list');
        for (const entry of rows) {
          const when = entry.created_at ? new Intl.DateTimeFormat('ko-KR', {
            dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul'
          }).format(new Date(entry.created_at)) : '시각 확인 필요';
          const reason = entry.detail?.reason ? ` · ${entry.detail.reason}` : '';
          list.appendChild(el('li', `${when} · ${historyLabel(entry)}${reason}`));
        }
        content.push(list, el('p', '이 화면이 불러온 최근 운영 기록 중 최대 10건을 표시합니다.', 'academy-notice'));
      }
      return disclosure('최근 이력', content, `${rows.length}건`);
    }
    function rosterField(rows) {
      const select = el('select');
      const empty = el('option', rows.length ? '일치하는 명단을 선택하세요' : '일치하는 수강 명단이 없습니다'); empty.value = '';
      select.appendChild(empty);
      for (const row of rows) {
        const option = el('option', `${row.cohort_name} · ${row.display_name} · ${row.canonical_gmail}`);
        option.value = String(row.id); select.appendChild(option);
      }
      return select;
    }
    function applications(rows, total = rows.length, audit = [], filtered = false) {
      const count = filtered ? `${rows.length} 표시 / 전체 ${total}` : total;
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', `가입 승인 대기 (${count})`));
      if (!rows.length) { section.appendChild(el('p', '승인 대기 신청이 없습니다.', 'empty')); return section; }
      const { scroll, body } = personTable(['일치 명단', '관리', '최근 이력']);
      for (const row of rows) {
        const matches = Array.isArray(row.roster_matches) ? row.roster_matches : [], rosterSelect = rosterField(matches);
        // 표에는 라벨을 띄울 자리가 없다 — 머리글이 그 몫을 하고, 읽어 주는 이름만 따로 단다.
        rosterSelect.setAttribute('aria-label', `${row.display_name} 이름·Gmail·끝 4자리가 모두 같은 수강 명단`);
        const rosterCell = cell(rosterSelect);
        if (!matches.length) rosterCell.appendChild(el('p', '먼저 기수·명단에서 이 학생을 정확히 등록해주세요.', 'academy-notice'));
        const actions = el('div', undefined, 'actions');
        actions.append(briefButton('승인', `${row.display_name} 학생을 승인하고 기수 배정`, () => {
          if (!rosterSelect.value) { message('이름·Gmail·끝 4자리가 모두 같은 수강 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
          const name = rosterSelect.selectedOptions[0].textContent;
          const reason = reasonField(); reason.value = '관리자 화면에서 가입 승인';
          return command('review', row, { decision: 'approve', roster_entry_id: Number(rosterSelect.value) }, reason, `${name} 명단과 신청을 묶어 승인할까요?`);
        }, 'primary'), briefButton('반려', `${row.display_name} 학생의 신청 반려`, () => {
          const reason = reasonField(); reason.value = '관리자 화면에서 가입 반려';
          return command('review', row, { decision: 'reject' }, reason, `${row.display_name} 학생의 신청을 반려할까요?`);
        }, 'danger'));
        const tr = personRow(row);
        tr.append(rosterCell, cell(actions), cell(historyDisclosure(row.user_id, audit)));
        body.appendChild(tr);
      }
      section.appendChild(scroll);
      return section;
    }
    function students(rows, total = rows.length, audit = []) {
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', `수강생 관리 (${total})`));
      const statuses = { active: '이용 가능', suspended: '이용 정지', revoked: '이용 해지' };
      // 짧은 이름은 표에, 긴 뜻은 title·aria-label 에. 조사는 붙여 만들지 않는다 —
      // 「이용 가능」 + 「로 변경」 이 「이용 가능로 변경」이 됐다.
      const STATUS_CHANGE = {
        active: { short: '재개', full: '이용 가능으로 변경' },
        suspended: { short: '정지', full: '이용 정지로 변경' },
        revoked: { short: '해지', full: '이용 해지로 변경' }
      };
      const { scroll, body } = personTable(['상태', '기수 변경', '변경 사유', '관리', '최근 이력']);
      let sortField = '';
      let sortDirection = 'asc';
      const sortModes = [['name', '이름'], ['email', 'Gmail'], ['cohort', '기수'], ['status', '상태']];
      const sortValue = (row, mode) => ({
        name: row.display_name,
        email: row.canonical_gmail,
        cohort: row.cohort_name,
        status: statuses[row.status] || row.status
      })[mode] || '';
      const renderRows = () => {
        const visible = sortField ? [...rows].sort((a, b) => {
          const result = String(sortValue(a, sortField)).toLowerCase().localeCompare(String(sortValue(b, sortField)).toLowerCase(), 'ko', { numeric: true });
          return sortDirection === 'asc' ? result : -result;
        }) : rows;
        body.replaceChildren();
        for (const row of visible) {
          const candidates = Array.isArray(row.roster_options) ? row.roster_options : [];
          const rosterSelect = rosterField(candidates), reason = reasonField();
          rosterSelect.setAttribute('aria-label', `${row.display_name} 현재 기수로 사용할 등록 명단`);
          reason.setAttribute('aria-label', `${row.display_name} 변경 사유`);
          const assign = el('div', undefined, 'actions');
          assign.append(rosterSelect, briefButton('변경', `${row.display_name} 학생의 현재 기수 변경`, () => {
            if (!rosterSelect.value) { message('이 학생과 일치하는 기수 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
            return command('assign', row, { roster_entry_id: Number(rosterSelect.value) }, reason, `${row.display_name} 학생의 현재 기수를 ${rosterSelect.selectedOptions[0].textContent}(으)로 바꿀까요?`);
          }, 'primary'));
          const actions = el('div', undefined, 'actions');
          for (const [value, label] of Object.entries(statuses)) {
            if (row.status === value) continue;
            // ★조사는 붙여 만들지 않는다 — 「이용 가능」 + 「로 변경」 이 「이용 가능로 변경」이 됐다.
            actions.appendChild(briefButton(STATUS_CHANGE[value].short, `${row.display_name} 학생 ${STATUS_CHANGE[value].full}`, () => command('set_status', row, { status: value }, reason, `${row.display_name} 학생을 ${label} 상태로 바꿀까요?`), value === 'active' ? 'primary' : value === 'revoked' ? 'danger' : 'outline'));
          }
          const tr = personRow(row);
          tr.append(
            cell(el('span', statuses[row.status] || '운영 확인 필요', `badge badge-${row.status}`)),
            cell(assign), cell(reason), cell(actions),
            cell(historyDisclosure(row.user_id, audit))
          );
          body.appendChild(tr);
        }
      };
      if (!rows.length) {
        section.appendChild(el('p', '등록된 학습실 수강생이 없습니다.', 'empty'));
        return section;
      }
      if (rows.length > 1) {
        const controls = el('div', undefined, 'academy-student-sort');
        controls.appendChild(el('span', '수강생 정렬', 'academy-student-sort-label'));
        const sortButtons = sortModes.map(([value, label]) => {
          const control = button(label, () => {
            sortDirection = sortField === value && sortDirection === 'asc' ? 'desc' : 'asc';
            sortField = value;
            for (const [index, [mode, modeLabel]] of sortModes.entries()) {
              const active = mode === sortField;
              sortButtons[index].setAttribute('aria-pressed', String(active));
              sortButtons[index].textContent = `${modeLabel}${active ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}`;
              sortButtons[index].setAttribute('aria-label', `${modeLabel} ${active && sortDirection === 'asc' ? '내림차순으로' : '오름차순으로'} 정렬`);
            }
            renderRows();
          });
          control.className += ' academy-sort-button';
          control.setAttribute('aria-pressed', 'false');
          control.setAttribute('aria-label', `${label} 오름차순으로 정렬`);
          return control;
        });
        controls.append(...sortButtons);
        section.appendChild(controls);
      }
      renderRows();
      section.appendChild(scroll);
      return section;
    }
    function accountManagement(rows, cohorts, total = rows.length, audit = []) {
      const section = el('section', undefined, 'academy-card academy-account-card');
      section.append(el('h3', `수강생 계정 관리 (${total})`),
        el('p', 'Gmail 계정은 그대로 두고, 유유스 내 정보·역할·이용 상태만 관리합니다.', 'academy-notice'));
      if (!rows.length) {
        section.appendChild(el('p', '관리할 학습실 계정이 없습니다.', 'empty'));
        return section;
      }
      const roleLabels = { student: '수강생', coach: '코치', admin: '관리자' };
      const activeAdminCount = rows.filter(row => row.role === 'admin' && row.account_active).length;
      let sortField = '';
      let sortDirection = 'asc';
      const selected = new Set();
      const { scroll, body, selectAll } = personTable(['역할', '상태', '관리'], true);
      const sortModes = [['name','이름'],['email','Gmail'],['cohort','기수'],['role','역할'],['status','상태']];
      const sortValue = (row, mode) => ({
        name: row.display_name,
        email: row.canonical_gmail,
        cohort: row.cohort_name,
        role: roleLabels[row.role] || row.role,
        status: row.account_active ? '이용 가능' : '이용 정지'
      })[mode] || '';

      const bulkBar = el('div', undefined, 'academy-account-bulk');
      const selectedCount = el('strong', '0명 선택', 'academy-account-bulk-count');
      const bulkRole = el('select'); bulkRole.setAttribute('aria-label', '선택 계정 역할 변경');
      for (const [value,label] of [['','역할 유지'],['student','수강생으로'],['coach','코치로'],['admin','관리자로']]) {
        const option = el('option',label); option.value=value; bulkRole.appendChild(option);
      }
      const bulkCohort = cohortField(cohorts.filter(item => item.status !== 'archived'));
      bulkCohort.required = false; bulkCohort.setAttribute('aria-label','선택 코치 담당 기수'); bulkCohort.hidden = true;
      const bulkStatus = el('select'); bulkStatus.setAttribute('aria-label','선택 계정 이용 상태 변경');
      for (const [value,label] of [['','상태 유지'],['active','이용 재개'],['suspended','이용 정지']]) {
        const option = el('option',label); option.value=value; bulkStatus.appendChild(option);
      }
      const bulkApply = button('일괄 적용', () => {
        const chosen = rows.filter(row => selected.has(String(row.user_id)));
        if (!chosen.length) { message('먼저 변경할 계정을 선택해주세요.', true); selectAll.focus(); return; }
        if (!bulkRole.value && !bulkStatus.value) { message('역할 또는 이용 상태에서 바꿀 값을 선택해주세요.', true); bulkRole.focus(); return; }
        if (bulkRole.value === 'coach' && !bulkCohort.value) { message('코치가 담당할 기수를 선택해주세요.', true); bulkCohort.focus(); return; }
        if (bulkRole.value === 'student' && chosen.some(row => row.can_be_student === false)) {
          message('명단 연결이 없는 계정은 수강생 역할로 바꿀 수 없습니다. 해당 계정을 빼고 다시 선택해주세요.', true); return;
        }
        const values = { accounts: chosen.map(row => ({ user_id: row.user_id, revision: row.revision })) };
        if (bulkRole.value) values.role = bulkRole.value;
        if (bulkRole.value === 'coach') values.cohort_id = Number(bulkCohort.value);
        if (bulkStatus.value) values.status = bulkStatus.value;
        const reason = reasonField(); reason.value = '관리자 화면에서 선택 계정 일괄 변경';
        return mutate('account_bulk_update', values, reason, `${chosen.length}개 계정에 선택한 변경을 한 번에 적용할까요?\n한 계정이라도 조건에 맞지 않으면 전체가 적용되지 않습니다.`);
      }, 'primary');
      bulkApply.disabled = true;
      const syncBulkRole = () => { bulkCohort.hidden = bulkRole.value !== 'coach'; };
      bulkRole.addEventListener('change', syncBulkRole);
      bulkBar.append(selectedCount, bulkRole, bulkCohort, bulkStatus, bulkApply);
      const syncSelection = () => {
        selectedCount.textContent = `${selected.size}명 선택`;
        bulkApply.disabled = selected.size === 0;
        selectAll.checked = selected.size === rows.length && rows.length > 0;
        selectAll.indeterminate = selected.size > 0 && selected.size < rows.length;
      };
      selectAll.addEventListener('change', () => {
        selected.clear();
        if (selectAll.checked) for (const row of rows) selected.add(String(row.user_id));
        renderRows();
      });

      const openEditor = row => {
        const previousFocus = document.activeElement;
        const dialog = el('dialog', undefined, 'academy-confirm academy-account-dialog');
        dialog.setAttribute('aria-labelledby', `academy-account-title-${row.user_id}`);
        const title = el('h3', '계정 정보 수정'); title.id = `academy-account-title-${row.user_id}`;
        const email = input('email'); email.value = row.canonical_gmail || ''; email.readOnly = true;
        const name = input('text'); name.value = row.display_name || ''; name.required = true; name.maxLength = 40;
        const phone = input('text'); phone.value = row.phone_last_four || ''; phone.inputMode = 'numeric'; phone.maxLength = 4;
        const role = el('select'); role.required = true;
        for (const [value, label] of Object.entries(roleLabels)) {
          const option = el('option', value === 'student' && row.can_be_student === false ? `${label} (명단 연결 필요)` : label);
          option.value = value; option.selected = row.role === value;
          option.disabled = (value === 'student' && row.can_be_student === false) || (row.role === 'admin' && row.account_active && activeAdminCount <= 1 && value !== 'admin');
          role.appendChild(option);
        }
        const coachCohort = cohortField(cohorts.filter(item => item.status !== 'archived'));
        coachCohort.value = row.role === 'coach' && row.cohort_id ? String(row.cohort_id) : '';
        const studentRoster = rosterField(Array.isArray(row.roster_options) ? row.roster_options : []);
        studentRoster.children[0].textContent = '현재 기수 유지';
        studentRoster.value = '';
        const scopeFields = el('div', undefined, 'academy-account-scope');
        const coachField = field('담당 기수', coachCohort);
        const studentField = field('수강 기수', studentRoster);
        scopeFields.append(coachField, studentField);
        const reason = reasonField(); reason.placeholder = '예: 본인 요청으로 정보 정정';
        const form = el('form', undefined, 'academy-account-form');
        form.append(field('Gmail 계정', email), field('이름', name), field('휴대폰 끝 4자리', phone), field('역할', role), scopeFields, field('수정 사유', reason));
        const guidance = el('p', '', 'academy-notice academy-account-guidance');
        const syncScope = () => {
          coachField.hidden = role.value !== 'coach';
          studentField.hidden = role.value !== 'student';
          coachCohort.required = role.value === 'coach';
          studentRoster.required = false;
          phone.required = role.value === 'student' || Boolean(row.phone_last_four);
          guidance.textContent = role.value === 'coach'
            ? '코치는 지정한 기수의 질문 큐만 확인합니다.'
            : role.value === 'admin'
              ? '관리자는 명단·역할·운영 전체를 관리합니다.'
              : '수강생은 배정된 현재 기수 학습실만 이용합니다.';
        };
        role.addEventListener('change', syncScope); syncScope();
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          if (dialog.open) dialog.close();
          dialog.remove();
          if (previousFocus?.isConnected) previousFocus.focus();
        };
        const cancel = button('취소', close);
        const save = button('저장', async () => {
          const cleanName = name.value.trim().replace(/\s+/g, ' ');
          const cleanPhone = phone.value.trim();
          if (cleanName.length < 2 || cleanName.length > 40) { message('이름을 2~40자로 입력해주세요.', true); name.focus(); return; }
          if ((role.value === 'student' || cleanPhone) && !/^\d{4}$/.test(cleanPhone)) { message('휴대폰 끝 4자리를 숫자로 입력해주세요.', true); phone.focus(); return; }
          if (role.value === 'coach' && !coachCohort.value) { message('코치가 담당할 기수를 선택해주세요.', true); coachCohort.focus(); return; }
          if (!reason.value.trim()) { message('수정 사유를 입력해주세요.', true); reason.focus(); return; }
          const payload = {
            user_id: row.user_id, revision: row.revision, display_name: cleanName,
            phone_last_four: cleanPhone, role: role.value, reason: reason.value.trim()
          };
          if (role.value === 'coach') payload.cohort_id = Number(coachCohort.value);
          if (role.value === 'student' && studentRoster.value) payload.roster_entry_id = Number(studentRoster.value);
          close();
          await applyAccountChange('account_update', payload, `${cleanName} 계정 정보를 저장했습니다.`);
        }, 'primary');
        const actions = el('div', undefined, 'academy-actions academy-account-dialog-actions');
        actions.append(cancel, save);
        dialog.append(title, el('p', '저장하면 유유스 접근 권한에 바로 반영됩니다. Gmail 주소와 비밀번호는 바꾸지 않습니다.', 'academy-notice'), form, guidance,
          historyDisclosure(row.user_id, audit), actions);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        root.appendChild(dialog);
        try { dialog.showModal(); name.focus(); }
        catch { close(); message('수정창을 열지 못했습니다. 브라우저를 새로고침해주세요.', true); }
      };

      const renderRows = () => {
        const visible = sortField ? [...rows].sort((a,b) => {
          const result = String(sortValue(a,sortField)).toLowerCase().localeCompare(String(sortValue(b,sortField)).toLowerCase(),'ko',{numeric:true});
          return sortDirection === 'asc' ? result : -result;
        }) : rows;
        body.replaceChildren();
        for (const row of visible) {
          const selector = el('input'); selector.type = 'checkbox';
          selector.checked = selected.has(String(row.user_id));
          selector.setAttribute('aria-label', `${row.display_name} 계정 선택`);
          selector.addEventListener('change', () => {
            if (selector.checked) selected.add(String(row.user_id)); else selected.delete(String(row.user_id));
            syncSelection();
          });
          const actions = el('div', undefined, 'actions academy-account-actions');
          actions.appendChild(briefButton('수정', `${row.display_name} 계정 정보 수정`, () => openEditor(row)));
          const statusAction = row.account_active ? { short:'정지', status:'suspended', label:'이용을 정지' } : { short:'재개', status:'active', label:'이용을 재개' };
          const protectedAdmin = row.role === 'admin' && row.account_active && activeAdminCount <= 1;
          const statusButton = briefButton(statusAction.short, protectedAdmin ? '마지막 관리자는 정지할 수 없습니다' : `${row.display_name} 계정 ${statusAction.label}`, () => {
            const reason = reasonField(); reason.value = row.account_active ? '관리자 화면에서 이용 정지' : '관리자 화면에서 이용 재개';
            return mutate('account_set_status',{user_id:row.user_id,revision:row.revision,status:statusAction.status},reason,
              `${row.display_name} 계정의 ${statusAction.label}할까요?`);
          }, row.account_active ? 'outline' : 'primary');
          statusButton.disabled = protectedAdmin;
          actions.appendChild(statusButton);
          const deleteButton = briefButton('삭제', protectedAdmin ? '마지막 관리자는 삭제할 수 없습니다' : `${row.display_name} 유유스 접근권 삭제`, () => {
            const reason = reasonField(); reason.value = '관리자 화면에서 유유스 접근권 삭제';
            return mutate('account_delete',{user_id:row.user_id,revision:row.revision},reason,
              `${row.display_name} 계정의 유유스 접근권을 삭제할까요?\nGmail 계정과 다른 서비스 권한은 유지됩니다.`);
          }, 'danger');
          deleteButton.disabled = protectedAdmin;
          actions.appendChild(deleteButton);
          const tr = personRow({ ...row, phone_last_four: row.phone_last_four || '-', cohort_name: row.cohort_name || '-' }, selector);
          tr.append(cell(el('span', roleLabels[row.role] || '확인 필요', `badge academy-role academy-role-${row.role}`)),
            cell(el('span', row.account_active ? '이용 가능' : '이용 정지', `badge badge-${row.account_active ? 'active' : 'suspended'}`)),
            cell(actions));
          body.appendChild(tr);
        }
        syncSelection();
      };
      section.appendChild(bulkBar);
      if (rows.length > 1) {
        const controls = el('div', undefined, 'academy-student-sort');
        controls.appendChild(el('span', '계정 정렬', 'academy-student-sort-label'));
        const buttons = sortModes.map(([value,label]) => {
          const control = button(label, () => {
            sortDirection = sortField === value && sortDirection === 'asc' ? 'desc' : 'asc'; sortField = value;
            for (const [index,[mode,modeLabel]] of sortModes.entries()) {
              const active = mode === sortField; buttons[index].setAttribute('aria-pressed',String(active));
              buttons[index].textContent = `${modeLabel}${active ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}`;
            }
            renderRows();
          });
          control.className += ' academy-sort-button'; control.setAttribute('aria-pressed','false'); return control;
        });
        controls.append(...buttons); section.appendChild(controls);
      }
      renderRows(); section.appendChild(scroll); return section;
    }
    function input(type, placeholder) {
      const node = el('input'); node.type = type; node.placeholder = placeholder || ''; return node;
    }
    function seoulDateKey() {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const value = type => parts.find(part => part.type === type)?.value;
      return `${value('year')}-${value('month')}-${value('day')}`;
    }
    function cohortAccess(row) {
      if (row.status !== 'active') return { current: false, label: '수강생 입장 닫힘' };
      const today = seoulDateKey();
      if (row.starts_on && row.starts_on > today) return { current: false, label: '수강생 입장 예정' };
      if (row.ends_on && row.ends_on < today) return { current: false, label: '수강생 입장 기간 종료' };
      return { current: true, label: '수강생 입장 열림' };
    }
    function managementHeading(title, description) {
      const heading = el('div', undefined, 'academy-section-heading');
      const copy = el('div');
      copy.append(el('h4', title), el('p', description, 'academy-notice'));
      heading.appendChild(copy);
      return heading;
    }
    function countBadge(value) {
      const badge = el('span', value, 'academy-count');
      badge.setAttribute('aria-label', `총 ${value}`);
      return badge;
    }
    function metaItem(label, value) {
      const item = el('div', undefined, 'academy-meta-item');
      item.append(el('dt', label), el('dd', value));
      return item;
    }
    function stateBadge(label, current = false) {
      return el('span', label, `academy-state ${current ? 'academy-state-open' : 'academy-state-closed'}`);
    }
    function cohortManagement(rows, rosterRows = [], onPick) {
      const section = el('section', undefined, 'academy-card academy-cohort-management');
      section.append(
        el('h3', '기수 관리'),
        el('p', '기수별 운영 기간과 수강생 입장을 관리합니다. 평소에는 현재 상태만 확인하면 됩니다.', 'academy-notice')
      );
      const number = input('number', '예: 2'); number.min = '1'; number.required = true;
      const name = input('text', '예: 유유스 2기'); name.maxLength = 60; name.required = true;
      const starts = input('date'); const ends = input('date'); const reason = reasonField();
      const fields=el('div',undefined,'academy-fields');
      fields.append(field('기수 번호',number),field('표시 이름',name),field('시작일',starts),field('종료일',ends),field('등록 사유',reason));
      const createAction = button('새 기수 등록',()=>{
        if(!number.value || !name.value.trim()) { message('기수 번호와 표시 이름을 모두 입력해주세요.',true); number.focus(); return; }
        const slugValue=`${Number(number.value)}gi`;
        if(starts.value && ends.value && starts.value>ends.value) { message('종료일은 시작일보다 빠를 수 없습니다.',true); ends.focus(); return; }
        return mutate('cohort_create',{cohort_number:Number(number.value),name:name.value.trim(),slug:slugValue,status:'draft',starts_on:starts.value,ends_on:ends.value},reason,`${name.value.trim()} 기수를 닫힌 상태로 등록할까요?`);
      },'primary');
      section.appendChild(disclosure('새 기수 추가', [el('p', '새 기수는 수강생 입장이 닫힌 상태로 만들어집니다.', 'academy-notice'), fields, createAction]));
      const cohortList=el('div',undefined,'academy-cohort-list');
      if(!rows.length) cohortList.appendChild(el('p','등록된 기수가 없습니다. 새 기수를 먼저 추가해주세요.','academy-empty-copy'));
      // ★기수를 고르면 오른쪽 명단이 그 기수만 보인다 — 기수를 한 군데서만 고르게
      //   하려고 「기수별 보기」 드롭다운은 없앴다 (사용자 2026-09-14).
      const countOf = (cohort) => Number.isInteger(Number(cohort.roster_count))
        ? Number(cohort.roster_count)
        : rosterRows.filter(entry => entry.status !== 'cancelled' &&
          (String(entry.cohort_id ?? '') === String(cohort.id) || entry.cohort_name === cohort.name)).length;
      for(const row of rows) {
        const card=el('article',undefined,'academy-cohort-card');
        if(String(row.id)===rosterCohortFilter) card.className+=' academy-cohort-picked';
        const isOpen=row.status==='active';
        const access=cohortAccess(row);
        const numberLabel=`${row.cohort_number}기`;
        const heading=String(row.name).includes(numberLabel) ? row.name : `${numberLabel} · ${row.name}`;
        const cardHeading=el('div',undefined,'academy-record-heading');
        const picked=String(row.id)===rosterCohortFilter;
        const rosterCount=countOf(row);
        const pick=button(`${rosterCount}명 · ${picked ? '전체 보기' : '명단 보기'}`,()=>{
          rosterCohortFilter = picked ? 'all' : String(row.id);
          rosterSearch='';
          onPick?.();
        },picked ? 'primary' : 'outline');
        pick.setAttribute('aria-pressed',String(picked));
        pick.setAttribute('aria-label',`${row.name} 명단 ${picked ? '접기' : '보기'}`);
        cardHeading.append(el('h5',heading),stateBadge(access.label,access.current));
        const meta=el('dl',undefined,'academy-cohort-meta');
        const period=metaItem('운영 기간',`${row.starts_on || '시작일 미정'} ~ ${row.ends_on || '종료일 미정'}`);
        period.className += ' academy-meta-with-action';
        period.children[0].appendChild(pick);
        meta.append(period);
        card.append(cardHeading,meta);
        const changeReason=reasonField();
        const actionLabel=isOpen ? '입장 닫기' : '입장 열기';
        const targetStatus=isOpen ? 'completed' : 'active';
        const edit=el('div',undefined,'academy-fields');
        edit.append(field(`${actionLabel} 사유`,changeReason));
        card.appendChild(disclosure('수강생 입장 관리', [
          el('p', isOpen ? '닫으면 이 기수 수강생은 학습실에 들어올 수 없습니다.' : '열어도 설정한 시작일과 종료일 안에서만 입장할 수 있습니다.', 'academy-notice'),
          edit,
          button(actionLabel,()=>mutate('cohort_set_status',{cohort_id:row.id,revision:row.revision,status:targetStatus},changeReason,`${row.name} 수강생 입장을 ${isOpen ? '닫을까요?' : '열까요?'}`),isOpen ? 'danger' : 'primary')
        ]));
        cohortList.appendChild(card);
      }
      section.appendChild(cohortList);
      return section;
    }
    // ★명단의 열쇠는 **기수 + 이름 + 휴대폰 끝 4자리**다 (사용자 2026-09-14).
    //   Gmail 은 본인이 가입할 때 직접 넣는 것이라 형님이 미리 알 수 없다. 그래서 선택이며,
    //   비워 두면 서버가 이름+끝 4자리로 맞춘다. 같은 기수에 이름도 끝 4자리도 같은 줄이
    //   둘 이상이면 자동 승인하지 않고 「가입 승인 대기」로 보낸다.
    const ROSTER_COLUMNS = ['이름', '휴대폰 끝 4자리', '기수'];
    function parseRosterRow(row, cohorts) {
      const pick = (...keys) => {
        for (const key of keys) {
          const value = row[key];
          if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
        }
        return '';
      };
      const name = pick('이름', '성함', 'name').replace(/\s+/g, ' ');
      // 엑셀이 0402 를 숫자 402 로 저장한다. 전화번호를 통째로 적어도 뒤 4자리만 쓴다.
      const four = pick('휴대폰 끝 4자리', '끝 4자리', '연락처 끝 4자리', '휴대폰', 'phone')
        .replace(/[^0-9]/g, '').slice(-4).padStart(4, '0');
      const cohortText = pick('기수', 'cohort');
      const digits = cohortText.replace(/[^0-9]/g, '');
      const cohort = cohorts.find(c => c.name === cohortText)
        || (digits ? cohorts.find(c => String(c.cohort_number) === digits) : undefined);
      const problem = !name ? '이름이 비었습니다'
        : (name.length < 2 || name.length > 40) ? '이름은 2~40자여야 합니다'
        : !/^[0-9]{4}$/.test(four) ? '휴대폰 끝 4자리가 숫자 4자리가 아닙니다'
        : !cohortText ? '기수가 비었습니다'
        : !cohort ? '「' + cohortText + '」 기수를 찾지 못했습니다'
        : !['draft', 'enrollment', 'active'].includes(cohort.status) ? '「' + cohort.name + '」은 지금 명단을 받지 않습니다'
        : '';
      return { display_name: name, phone_last_four: four, cohort_id: cohort ? Number(cohort.id) : null,
               cohort_name: cohort ? cohort.name : cohortText, problem };
    }
    async function bulkRosterAdd(entries) {
      if (busy) return;
      entries = entries.map(entry => ({ ...entry }));
      const confirmedReason = '관리자 화면에서 수강 명단 일괄 등록';
      const confirmationEpoch = epoch;
      if (!await confirmChange(entries.length + '명을 수강 명단에 올릴까요?') || confirmationEpoch !== epoch) return;
      busy = true; disabled(true); message(entries.length + '명을 올리는 중입니다. 창을 닫지 마세요.');
      const token = epoch;
      const failed = [];
      let done = 0;
      try {
        for (const entry of entries) {
          const { data, error } = await request('roster_add', {
            cohort_id: entry.cohort_id, display_name: entry.display_name,
            gmail_local_id: '', phone_last_four: entry.phone_last_four,
            source_reference: '', reason: confirmedReason });
          if (token !== epoch) return;
          if (error || data?.ok !== true) failed.push(entry.display_name); else done += 1;
        }
        busy = false;
        // 한 줄이 실패해도 앞의 줄은 이미 올라갔다 — 몇 명이 됐는지 정확히 말한다.
        await load(failed.length
          ? done + '명을 올렸습니다. ' + failed.length + '명은 실패했습니다 (' +
            failed.slice(0, 5).join(', ') + (failed.length > 5 ? ' 외' : '') + '). 목록을 확인해주세요.'
          : done + '명을 수강 명단에 올렸습니다.');
      } catch (error) {
        if (token === epoch) { message(errorMessage(error), true); disabled(false); status.focus(); }
      } finally { if (token === epoch) busy = false; }
    }
    function rosterAdd(cohorts) {
      const section = el('section', undefined, 'academy-roster-add academy-direct-add');
      section.append(managementHeading('수강생 추가',
        '이름·휴대폰 끝 4자리·기수를 등록하면 그분이 가입할 때 같은 정보로 자동 확인합니다. Gmail 은 본인이 가입할 때 넣습니다.'));
      const open = cohorts.filter(row => ['draft', 'enrollment', 'active'].includes(row.status));
      const cohort = cohortField(open);
      const name = input('text', '수강생 이름'); name.maxLength = 40; name.required = true;
      const gmail = input('text', '아는 경우에만'); gmail.maxLength = 64; gmail.autocapitalize = 'none';
      const phone = input('text', '끝 4자리'); phone.inputMode = 'numeric'; phone.maxLength = 4; phone.required = true;
      const fields = el('div', undefined, 'academy-fields');
      fields.append(field('기수', cohort), field('이름', name), field('휴대폰 끝 4자리', phone),
                    field('Gmail 아이디 (선택)', gmail));
      // ★막힌 까닭은 **단추 옆에서** 말한다. 예전에는 화면 맨 위 회색 문구로만 떠서
      //   단추에서 318px 위였다 — 누르면 아무 일도 안 난 것처럼 보였다 (사용자 2026-09-14:
      //   「하나 수강명단에 추가해보려고 했는데 실제로는 안들어가는데?」. 기록을 보니
      //   그 시도는 서버까지 온 적이 없었다).
      const note = el('p', '', 'academy-bulk-note');
      const stop = (text, target) => {
        message(text, true);
        note.textContent = text;
        note.className = 'academy-bulk-note academy-add-stop';
        if (target) target.focus();
      };
      const clearNote = () => { note.textContent = ''; note.className = 'academy-bulk-note'; };
      const addAction = button('수강 명단에 추가', () => {
        const gmailLocal = gmail.value.trim().toLowerCase();
        if (!cohort.value) { stop('기수를 선택해주세요.', cohort); return; }
        if (name.value.trim().length < 2) { stop('수강생 이름을 2자 이상 입력해주세요.', name); return; }
        if (gmailLocal && !/^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9._-]+)?$/.test(gmailLocal)) {
          stop('@gmail.com 앞의 Gmail 아이디만 정확히 입력해주세요. 모르면 비워 두세요.', gmail); return; }
        if (!/^[0-9]{4}$/.test(phone.value)) { stop('휴대폰 끝 4자리를 숫자로 입력해주세요.', phone); return; }
        clearNote();
        const reason = reasonField(); reason.value = '관리자 화면에서 수강 명단 등록';
        return mutate('roster_add', { cohort_id: Number(cohort.value), display_name: name.value.trim(),
          gmail_local_id: gmailLocal, phone_last_four: phone.value, source_reference: '' }, reason,
          name.value.trim() + ' 학생을 ' + cohort.selectedOptions[0].textContent + ' 명단에 추가할까요?');
      }, 'primary');

      // ── 엑셀로 여러 명. 초록은 되돌릴 수 있는 보조 작업 — UV 에디터 탭과 같은 규칙이다. ──
      const template = button('엑셀 양식 받기', () => {
        const rows = open.length
          ? open.slice(0, 3).map(c => ({ '이름': '홍길동', '휴대폰 끝 4자리': '0402', '기수': c.name }))
          : [{ '이름': '홍길동', '휴대폰 끝 4자리': '0402', '기수': '유유스 1기' }];
        const sheet = global.XLSX.utils.json_to_sheet(rows, { header: ROSTER_COLUMNS });
        const book = global.XLSX.utils.book_new();
        global.XLSX.utils.book_append_sheet(book, sheet, '수강명단');
        global.XLSX.writeFile(book, '유유스_수강명단_양식.xlsx');
      }, 'success');
      const picker = el('input');
      // 숨기기는 class 로 한다 — 화면 없는 검사에는 style 이 없어 여기서 통째로 터졌다.
      picker.type = 'file'; picker.accept = '.xlsx,.xls,.csv'; picker.className = 'academy-file-input';
      picker.setAttribute('aria-label', '수강 명단 엑셀 고르기');
      const upload = button('엑셀로 여러 명', () => picker.click(), 'success');
      picker.addEventListener('change', async () => {
        const file = picker.files && picker.files[0];
        if (!file) return;
        try {
          const book = global.XLSX.read(await file.arrayBuffer());
          const raw = global.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
          const parsed = raw.map(row => parseRosterRow(row, cohorts));
          const good = parsed.filter(row => !row.problem);
          const bad = parsed.filter(row => row.problem);
          note.textContent = parsed.length === 0
            ? '엑셀에서 줄을 읽지 못했습니다. 양식을 받아 그대로 채워주세요.'
            : parsed.length + '줄 중 ' + good.length + '명 올릴 수 있습니다.' +
              (bad.length ? ' 건너뛸 ' + bad.length + '줄: ' +
                bad.slice(0, 3).map(r => (r.display_name || '(이름 없음)') + ' — ' + r.problem).join(' / ') +
                (bad.length > 3 ? ' 외' : '') : '');
          if (!good.length) return;
          await bulkRosterAdd(good);
        } catch (error) {
          void error;
          note.textContent = '엑셀을 읽지 못했습니다. 양식을 받아 그대로 채워주세요.';
        } finally { picker.value = ''; }
      });
      const actions = el('div', undefined, 'academy-add-actions');
      actions.append(addAction, template, upload, picker);
      section.append(fields, actions, note);
      section.focusPrimary = () => cohort.focus();
      return section;
    }
    function rosterManagement(rows, cohorts, total = rows.length, focusDirectAdd, onFilterChange) {
      const cohortIds = new Set(cohorts.map(row => String(row.id)));
      if (rosterCohortFilter !== 'all' && !cohortIds.has(rosterCohortFilter)) rosterCohortFilter = 'all';
      const cohortIdOf = row => String(row.cohort_id ?? cohorts.find(cohort => cohort.name === row.cohort_name)?.id ?? '');
      const visibleRows = rosterCohortFilter === 'all' ? rows : rows.filter(row => cohortIdOf(row) === rosterCohortFilter);
      const needle=rosterSearch.trim().toLowerCase();
      const hit=row=>!needle
        || String(row.display_name||'').toLowerCase().includes(needle)
        || String(row.phone_last_four||'').includes(needle)
        || String(row.canonical_gmail||'').toLowerCase().includes(needle);
      const foundRows=visibleRows.filter(hit);
      const currentRows=foundRows.filter(row=>row.status!=='cancelled');
      const cancelledRows=foundRows.filter(row=>row.status==='cancelled');
      const section=el('section',undefined,'academy-management-group academy-roster-management');
      // 기수는 **왼쪽 기수 관리에서** 고른다. 여기서는 무엇을 보고 있는지만 말한다.
      const pickedCohort=cohorts.find(cohort=>String(cohort.id)===rosterCohortFilter);
      const pageLimited=total>rows.length;
      const heading=managementHeading(
        pickedCohort ? `등록 명단 · ${pickedCohort.name}` : '등록 명단',
        pickedCohort
          ? '가입 전 행은 오른쪽에서 바로 고치거나 취소합니다. 왼쪽 기수를 다시 누르면 전체가 보입니다.'
          : '왼쪽에서 기수를 누르면 그 기수 명단만 봅니다. 가입 전 행은 오른쪽에서 바로 고치거나 취소합니다.');
      const controls=el('div',undefined,'academy-roster-controls');
      // ★100명이 넘어도 찾을 수 있어야 한다 — 이름·끝 4자리로 거른다 (사용자 2026-09-14).
      const search=input('search','이름 또는 끝 4자리');
      search.value=rosterSearch;
      search.setAttribute('aria-label','등록 명단에서 이름·끝 4자리로 찾기');
      search.addEventListener('input',()=>{ rosterSearch=search.value; onFilterChange?.(); });
      const searchLabel=el('label','찾기','academy-roster-filter');
      searchLabel.appendChild(search);
      controls.append(searchLabel,countBadge(`${currentRows.length}명${pageLimited ? ' 표시' : ''}`));
      heading.appendChild(controls);
      section.appendChild(heading);
      const labels={eligible:'가입 전',bound:'계정 연결됨',cancelled:'명단 취소'};
      if(!currentRows.length) {
        const empty=el('div',undefined,'academy-empty-state');
        const copy=el('div');
        const cohortSelected=rosterCohortFilter!=='all';
        if(needle) copy.append(el('strong',`「${rosterSearch.trim()}」에 맞는 명단이 없습니다.`),el('p','찾기 칸을 비우면 전체가 다시 보입니다.','academy-notice'));
        else copy.append(el('strong',cohortSelected ? '이 기수에 등록된 명단이 없습니다.' : '현재 사용할 수강 명단이 없습니다.'),el('p',cohortSelected ? '왼쪽 기수를 다시 눌러 전체를 보거나, 위 수강생 추가에서 등록해주세요.' : '위 수강생 추가에서 명단을 등록할 수 있습니다.','academy-notice'));
        empty.appendChild(copy);
        if(focusDirectAdd) empty.appendChild(button('수강생 추가로 이동',focusDirectAdd));
        section.appendChild(empty);
      }
      function actionPanel(id,label,children) {
        const panel=el('div',undefined,'academy-roster-panel');
        panel.id=id;
        panel.hidden=true;
        panel.setAttribute('aria-label',label);
        panel.append(...children);
        return panel;
      }
      function togglePanel(trigger,panel,others=[]) {
        const opening=panel.hidden;
        for(const [otherTrigger,otherPanel] of others) {
          otherPanel.hidden=true;
          otherTrigger.setAttribute('aria-expanded','false');
        }
        panel.hidden=!opening;
        trigger.setAttribute('aria-expanded',String(opening));
        if(opening) panel.querySelectorAll('input, select')[0]?.focus();
      }
      // ★한 사람은 한 줄이다. 수정·취소 입력은 그 줄 **바로 아래** 칸을 통째로 빌린다 —
      //   예전에는 한 사람이 카드 세 줄이라 100명이면 화면이 300줄로 늘어졌다 (사용자 2026-09-14).
      function rosterRecord(row) {
        const tr=el('tr',undefined,'academy-roster-record');
        const identity=el('td',row.display_name,'academy-cell-id');
        const actions=el('div',undefined,'academy-roster-actions');
        const panels=[];
        if(row.status!=='bound') {
          const editName=input('text'); editName.value=row.display_name; editName.maxLength=40;
          const editGmail=input('text'); editGmail.value=String(row.canonical_gmail || '').replace(/@gmail\.com$/,''); editGmail.placeholder='아는 경우에만';
          const editPhone=input('text'); editPhone.value=row.phone_last_four; editPhone.inputMode='numeric'; editPhone.maxLength=4;
          const editReason=reasonField(); const editFields=el('div',undefined,'academy-fields');
          editFields.append(field('이름',editName),field('Gmail 아이디 (선택)',editGmail),field('휴대폰 끝 4자리',editPhone),field('수정 사유',editReason));
          const editPanel=actionPanel(`academy-roster-edit-${row.id}`,'명단 정보 수정',[editFields,button(row.status==='cancelled' ? '수정하고 명단 복구' : '수정 내용 저장',()=>{
            const gmailLocal=editGmail.value.trim().toLowerCase();
            if(editName.value.trim().length<2) { message('수강생 이름을 2자 이상 입력해주세요.',true); editName.focus(); return; }
            if(gmailLocal && !/^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9._-]+)?$/.test(gmailLocal)) { message('@gmail.com 앞의 Gmail 아이디만 정확히 입력해주세요. 모르면 비워 두세요.',true); editGmail.focus(); return; }
            if(!/^[0-9]{4}$/.test(editPhone.value)) { message('휴대폰 끝 4자리를 숫자로 입력해주세요.',true); editPhone.focus(); return; }
            return mutate('roster_update',{roster_entry_id:row.id,revision:row.revision,display_name:editName.value.trim(),gmail_local_id:gmailLocal,phone_last_four:editPhone.value,source_reference:row.source_reference || ''},editReason,`${row.display_name} 학생의 ${row.cohort_name} 명단 정보를 저장할까요?`);
          })]);
          const editAction=button(row.status==='cancelled' ? '수정·복구' : '수정',()=>togglePanel(editAction,editPanel,panels));
          editAction.setAttribute('aria-controls',editPanel.id);
          editAction.setAttribute('aria-expanded','false');
          panels.push([editAction,editPanel]);
          actions.appendChild(editAction);
        }
        if(row.status==='eligible') {
          const cancelReason=reasonField();
          const cancelFields=el('div',undefined,'academy-fields');
          cancelFields.appendChild(field('취소 사유',cancelReason));
          const cancelPanel=actionPanel(`academy-roster-cancel-${row.id}`,'명단 취소',[cancelFields,button('명단 취소하기',()=>mutate('roster_cancel',{roster_entry_id:row.id,revision:row.revision},cancelReason,`${row.display_name} 학생의 ${row.cohort_name} 명단을 취소할까요?`),'danger')]);
          const cancelAction=button('취소',()=>togglePanel(cancelAction,cancelPanel,panels),'danger');
          cancelAction.setAttribute('aria-controls',cancelPanel.id);
          cancelAction.setAttribute('aria-expanded','false');
          panels.push([cancelAction,cancelPanel]);
          actions.appendChild(cancelAction);
        }
        // ★취소된 명단 중 **계정과 연결된 적 없는 줄만** 지운다 (사용자 2026-09-14:
        //   「취소된 명단도 삭제도 안되고」). 목록에서는 사라져도 누가 언제 왜 지웠는지는
        //   서버 기록에 이름·끝 4자리·기수와 함께 남는다. 연결된 적 있는 줄은 서버가 거부한다.
        if(row.status==='cancelled' && !row.bound_user_id) {
          const deleteReason=reasonField();
          const deleteFields=el('div',undefined,'academy-fields');
          deleteFields.appendChild(field('삭제 사유',deleteReason));
          const deletePanel=actionPanel(`academy-roster-delete-${row.id}`,'명단 영구 삭제',[
            el('p','목록에서 완전히 사라지고 되돌릴 수 없습니다. 누가 언제 왜 지웠는지는 기록에 남습니다.','academy-notice'),
            deleteFields,
            button('영구 삭제',()=>mutate('roster_delete',{roster_entry_id:row.id,revision:row.revision},deleteReason,
              `${row.display_name}(끝 ${row.phone_last_four}) ${row.cohort_name} 명단을 영구 삭제할까요?\n되돌릴 수 없습니다.`),'danger')]);
          const deleteAction=button('삭제',()=>togglePanel(deleteAction,deletePanel,panels),'danger');
          deleteAction.setAttribute('aria-controls',deletePanel.id);
          deleteAction.setAttribute('aria-expanded','false');
          panels.push([deleteAction,deletePanel]);
          actions.appendChild(deleteAction);
        }
        if(row.status==='bound') actions.appendChild(el('span','수강생 관리에서 변경','academy-roster-readonly'));
        tr.append(identity,
          el('td',row.phone_last_four,'academy-cell-four'),
          el('td',row.canonical_gmail || '가입할 때 채워집니다','academy-cell-cohort'),
          el('td',row.cohort_name,'academy-cell-cohort'),
          cell(stateBadge(labels[row.status] || row.status,row.status==='bound')),
          cell(actions));
        const panelRow=el('tr',undefined,'academy-roster-panel-row');
        const panelCell=el('td'); panelCell.setAttribute('colspan','6');
        panelCell.append(...panels.map(([,panel])=>panel));
        panelRow.appendChild(panelCell);
        return panels.length ? [tr,panelRow] : [tr];
      }
      const rosterTable=(source)=>{
        const scroll=el('div',undefined,'table-scroll academy-roster-scroll');
        scroll.setAttribute('tabindex','0');
        const table=el('table',undefined,'academy-table academy-roster-table');
        const head=el('thead'),headRow=el('tr');
        for(const label of ['이름','끝 4자리','Gmail','기수','상태','관리']) headRow.appendChild(el('th',label));
        head.appendChild(headRow);
        const body=el('tbody');
        for(const row of source) body.append(...rosterRecord(row));
        table.append(head,body);
        scroll.appendChild(table);
        return scroll;
      };
      if(currentRows.length) section.appendChild(rosterTable(currentRows));
      if(cancelledRows.length) {
        section.appendChild(disclosure('취소된 명단', [rosterTable(cancelledRows)], `${cancelledRows.length}건`));
      }
      section.focusFilter=()=>search.focus();
      return section;
    }
    function summary(data) {
      const section = el('section', undefined, 'academy-overview');
      section.setAttribute('aria-label', '학습실 운영 요약');
      const metric = (label, value) => {
        const item = el('span', undefined, 'academy-overview-item');
        item.append(el('span', label, 'academy-overview-label'), el('strong', value, 'academy-overview-value'));
        return item;
      };
      const activeCohorts = data.cohorts.filter(row => cohortAccess(row).current).length;
      const activeRosterCount = data.roster.filter(row => row.status !== 'cancelled').length;
      const rosterCountLabel = (data.totals?.roster || 0) > data.roster.length ? `${activeRosterCount}+명` : `${activeRosterCount}명`;
      section.append(
        metric('현재 입장 가능한 기수', `${activeCohorts}개`),
        metric('현재 명단', rosterCountLabel),
        metric('가입 승인 대기', `${data.totals?.applications ?? data.applications.length}명`),
        metric('등록 수강생', `${data.totals?.students ?? data.students.length}명`)
      );
      return section;
    }
    function pagination(data) {
      const wrapper = el('div');
      const pages = el('nav', undefined, 'academy-pagination'); pages.setAttribute('aria-label', '관리 목록 페이지');
      const total = Math.max(data.totals?.applications || 0, data.totals?.students || 0, data.totals?.accounts || 0, data.totals?.roster || 0);
      if (pageOffset > 0) pages.appendChild(button('이전 100건', () => load(undefined, Math.max(0, pageOffset - 100))));
      if (total > pageOffset + 100) {
        pages.appendChild(button('다음 100건', () => load(undefined, pageOffset + 100)));
      }
      if (pageOffset > 0 || total > 100) wrapper.append(pages, el('p', `목록 ${pageOffset + 1}번부터 최대 100건을 표시합니다.`, 'academy-notice'));
      return wrapper;
    }
    async function load(successMessage, offset = pageOffset) {
      if (busy) return;
      const token = ++epoch;
      let loaded = false;
      pageOffset = offset;
      busy = true; shell(); disabled(true); message('학습실 관리 정보를 확인하고 있습니다.');
      try {
        const { data, error } = await request('admin_snapshot', { offset: pageOffset });
        if (token !== epoch) return;
        if (error) throw error;
        if (data?.version !== 2 || !['applications', 'students', 'cohorts', 'roster', 'audit'].every(key => Array.isArray(data[key]))
          || (data.accounts !== undefined && !Array.isArray(data.accounts))) throw new Error('invalid_contract');
        const content = el('div', undefined, 'academy-view');
        const rosterHost=el('div');
        const rosterPage=data.roster.slice(0,100);
        const management = el('section', undefined, 'academy-card academy-management-card academy-roster-card');
        management.append(el('h3', '수강 명단 관리'), el('p','등록한 명단과 실제 가입 정보를 대조해 해당 기수로 연결합니다.','academy-notice'));
        const directAdd=rosterAdd(data.cohorts);
        const renderRoster=(focusFilter=false)=>{
          const rosterSection=rosterManagement(rosterPage,data.cohorts,data.totals?.roster,()=>directAdd.focusPrimary(),()=>renderRoster(true));
          rosterHost.replaceChildren(rosterSection);
          if(focusFilter) rosterSection.focusFilter();
        };
        renderRoster();
        management.append(directAdd, rosterHost);
        // ★카드는 **일이 일어나는 순서**로 세운다 (사용자 2026-09-14).
        //   ① 준비: 기수를 만들고(좌) 그 기수에 명단을 넣는다(우) — 늘 같이 보는 짝이라 2열.
        //   ② 요약 → ③ 가입 승인 대기(예외만 뜬다) → ④ 수강생 관리(일상) → ⑤ 페이지.
        //   예전에는 명단 관리가 맨 위, 기수 관리가 맨 아래여서 흐름이 거꾸로였다.
        const setup = el('div', undefined, 'academy-setup');
        const cohortHost = el('div');
        // 기수를 고르면 왼쪽(고른 표시)과 오른쪽(명단)을 함께 다시 그린다.
        const renderPrep = () => {
          cohortHost.replaceChildren(cohortManagement(data.cohorts, rosterPage, () => { renderPrep(); renderRoster(); }));
        };
        renderPrep();
        setup.append(cohortHost, management);
        content.append(setup, summary(data),
          applications(data.applications, data.totals?.applications, data.audit),
          Array.isArray(data.accounts)
            ? accountManagement(data.accounts, data.cohorts, data.totals?.accounts, data.audit)
            : students(data.students, data.totals?.students, data.audit),
          pagination(data));
        root.append(content);
        message(successMessage || '학습실 전용 권한과 최신 정보를 확인했습니다.');
        loaded = true;
      } catch (error) {
        if (token === epoch) { message(errorMessage(error), true); status.focus(); }
      } finally {
        if (token === epoch) {
          busy = false;
          disabled(false);
          if (loaded) status.focus();
        }
      }
    }
    function clear() { epoch++; cancelConfirmation?.(); busy = false; pageOffset = 0; rosterCohortFilter = 'all'; root.replaceChildren(); }
    return { load, clear };
  }
  global.createAcademyAdmin = createAcademyAdmin;
})(typeof window === 'undefined' ? globalThis : window);
