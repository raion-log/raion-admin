/* Product-scoped API only. No direct table writes, central account bans or password handling. */
(function (global) {
  'use strict';
  function createAcademyAdmin(client, root) {
    let epoch = 0;
    let busy = false;
    let pageOffset = 0;
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = String(text ?? '');
      if (className) node.className = className;
      return node;
    };
    const errorMessage = (error) => {
      if (error?.message === 'academy_mfa_required') return '학습실 관리는 관리자 2단계 인증 후 이용할 수 있습니다. 관리자 인증 설정을 확인해주세요.';
      if (error?.message === 'academy_session_required') return '로그인 세션이 만료되었거나 종료되었습니다. 다시 로그인해주세요.';
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
    function message(text, error = false) {
      status.setAttribute('role', error ? 'alert' : 'status');
      status.textContent = text;
    }
    function button(text, onClick) {
      const node = el('button', text);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    }
    function shell() {
      root.replaceChildren(el('h2', '유유스 학습실 관리'),
        el('p', '학습실의 신청·현재 기수·이용 상태만 관리합니다. 기존 유벤져스·UV 에디터 회원과 중앙 로그인 계정은 변경하지 않습니다.', 'academy-notice'),
        button('다시 불러오기', () => load()), status);
    }
    function disabled(value) {
      root.querySelectorAll('button, input, select').forEach(node => { node.disabled = value; });
      root.setAttribute('aria-busy', String(value));
    }
    function field(label, input) {
      const wrapper = el('label', label);
      wrapper.appendChild(input);
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
      const empty = el('option', '배정할 기수를 선택하세요'); empty.value = '';
      select.appendChild(empty);
      for (const cohort of cohorts) {
        const option = el('option', cohort.name); option.value = String(cohort.id);
        select.appendChild(option);
      }
      return select;
    }
    async function command(action, row, values, reason, confirmation) {
      if (busy) return;
      if (!reason.value.trim()) { message('변경 사유를 입력해주세요.', true); reason.focus(); return; }
      if (!global.confirm(confirmation + '\n변경은 학습실에만 적용됩니다.')) return;
      busy = true; disabled(true); message('처리 중입니다. 창을 닫지 마세요.');
      const token = epoch;
      try {
        const { data, error } = await request(action, { user_id: row.user_id, revision: row.revision, ...values, reason: reason.value.trim() });
        if (token !== epoch) return;
        if (error || data?.ok !== true) throw error || new Error('invalid_response');
        busy = false;
        await load('변경을 저장했습니다. 최신 목록을 확인해주세요.');
      } catch (error) {
        if (token === epoch) { message(errorMessage(error), true); disabled(false); status.focus(); }
      } finally { if (token === epoch) busy = false; }
    }
    function record(row) {
      const section = el('article', undefined, 'academy-record');
      section.append(el('h3', row.display_name), el('p', `${row.canonical_gmail} · 휴대폰 끝 ${row.phone_last_four}`));
      return section;
    }
    function applications(rows, cohorts) {
      const section = el('section'); section.appendChild(el('h3', '승인 대기'));
      if (!rows.length) section.appendChild(el('p', '승인 대기 신청이 없습니다.'));
      for (const row of rows) {
        const card = record(row), cohort = cohortField(cohorts), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        fields.append(field('운영자가 배정할 기수', cohort), field('검토 사유', reason));
        card.append(fields, button('승인하고 기수 배정', () => {
          if (!cohort.value) { message('명단을 확인한 뒤 배정할 기수를 선택해주세요.', true); cohort.focus(); return; }
          const name = cohort.selectedOptions[0].textContent;
          return command('review', row, { decision: 'approve', cohort_id: Number(cohort.value) }, reason, `${row.display_name} 학생을 ${name} 수강생으로 승인할까요?`);
        }), button('신청 반려', () => command('review', row, { decision: 'reject' }, reason, `${row.display_name} 학생의 신청을 반려할까요?`)));
        section.appendChild(card);
      }
      return section;
    }
    function students(rows, cohorts) {
      const section = el('section'); section.appendChild(el('h3', '수강생 · 현재 기수'));
      if (!rows.length) section.appendChild(el('p', '등록된 학습실 수강생이 없습니다.'));
      const statuses = { active: '이용 가능', suspended: '이용 정지', revoked: '이용 해지' };
      for (const row of rows) {
        const card = record(row), cohort = cohortField(cohorts), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        card.appendChild(el('p', `${statuses[row.status] || '운영 확인 필요'} · 현재 배정: ${row.cohort_name || '없음'}`));
        fields.append(field('변경할 현재 기수', cohort), field('변경 사유', reason));
        card.append(fields, button('현재 기수 변경', () => {
          if (!cohort.value) { message('변경할 기수를 선택해주세요.', true); cohort.focus(); return; }
          return command('assign', row, { cohort_id: Number(cohort.value) }, reason, `${row.display_name} 학생의 현재 기수를 ${cohort.selectedOptions[0].textContent}(으)로 바꿀까요?`);
        }));
        for (const [value, label] of Object.entries(statuses)) {
          if (row.status === value) continue;
          card.appendChild(button(label + '로 변경', () => command('set_status', row, { status: value }, reason, `${row.display_name} 학생을 ${label} 상태로 바꿀까요?`)));
        }
        section.appendChild(card);
      }
      return section;
    }
    async function load(successMessage, offset = pageOffset) {
      if (busy) return;
      const token = ++epoch;
      pageOffset = offset;
      busy = true; shell(); disabled(true); message('학습실 관리 정보를 확인하고 있습니다.');
      try {
        const { data, error } = await request('admin_snapshot', { offset: pageOffset });
        if (token !== epoch) return;
        if (error) throw error;
        if (data?.version !== 1 || !['applications', 'students', 'cohorts', 'audit'].every(key => Array.isArray(data[key]))) throw new Error('invalid_contract');
        root.append(applications(data.applications, data.cohorts), students(data.students, data.cohorts));
        const pages = el('nav'); pages.setAttribute('aria-label', '관리 목록 페이지');
        if (pageOffset > 0) pages.appendChild(button('이전 100건', () => load(undefined, Math.max(0, pageOffset - 100))));
        if (Math.max(data.totals?.applications || 0, data.totals?.students || 0) > pageOffset + 100) {
          pages.appendChild(button('다음 100건', () => load(undefined, pageOffset + 100)));
        }
        root.appendChild(pages);
        const audit = el('details'); audit.appendChild(el('summary', '최근 변경 기록'));
        const list = el('ul');
        for (const entry of data.audit) list.appendChild(el('li', `${entry.created_at} · ${entry.action} · 대상 ${entry.subject_id} · ${entry.detail?.reason || '신청 접수'}`));
        if (!data.audit.length) list.appendChild(el('li', '변경 기록이 없습니다.'));
        audit.appendChild(list); root.appendChild(audit);
        root.appendChild(el('p', `목록 ${pageOffset + 1}번부터 최대 100건 · 최근 변경 기록 50건. 다음/이전 버튼으로 나머지 수강생과 신청을 확인하세요.`, 'academy-notice'));
        message(successMessage || '학습실 전용 권한과 최신 정보를 확인했습니다.');
      } catch (error) {
        if (token === epoch) message(errorMessage(error), true);
      } finally {
        if (token === epoch) { busy = false; disabled(false); status.focus(); }
      }
    }
    function clear() { epoch++; busy = false; pageOffset = 0; root.replaceChildren(); }
    return { load, clear };
  }
  global.createAcademyAdmin = createAcademyAdmin;
})(typeof window === 'undefined' ? globalThis : window);
