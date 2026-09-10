/* Product-scoped API only. No direct table writes, central account bans or password handling. */
(function (global) {
  'use strict';
  function createAcademyAdmin(client, root) {
    let epoch = 0;
    let busy = false;
    let pageOffset = 0;
    let activeView = 'operations';
    let focusViewAfterLoad = false;
    let viewButtons = {};
    let viewPanels = {};
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = String(text ?? '');
      if (className) node.className = className;
      return node;
    };
    const errorMessage = (error) => {
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
    function button(text, onClick, variant = 'outline') {
      const node = el('button', text);
      node.type = 'button';
      node.className = `btn btn-small btn-${variant}`;
      node.addEventListener('click', onClick);
      return node;
    }
    function switchView(name, focus = false) {
      if (!viewButtons[name] || !viewPanels[name]) return;
      const changed = activeView !== name;
      activeView = name;
      if (changed && pageOffset > 0) {
        focusViewAfterLoad = focus;
        load(undefined, 0);
        return;
      }
      for (const [key, node] of Object.entries(viewButtons)) {
        const selected = key === name;
        node.className = `subtab${selected ? ' active' : ''}`;
        node.setAttribute('aria-selected', String(selected));
        node.tabIndex = selected ? 0 : -1;
      }
      for (const [key, node] of Object.entries(viewPanels)) {
        node.className = `academy-view${key === name ? '' : ' hidden'}`;
      }
      if (focus) viewButtons[name].focus();
    }
    function viewTab(name, text) {
      const node = el('button', text, `subtab${activeView === name ? ' active' : ''}`);
      node.type = 'button';
      node.id = `academy-tab-${name}`;
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-controls', `academy-view-${name}`);
      node.setAttribute('aria-selected', String(activeView === name));
      node.tabIndex = activeView === name ? 0 : -1;
      node.addEventListener('click', () => switchView(name, true));
      node.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const order = ['operations', 'setup', 'audit'];
        const current = order.indexOf(name);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
        switchView(order[next], true);
      });
      viewButtons[name] = node;
      return node;
    }
    function viewPanel(name) {
      const node = el('div', undefined, `academy-view${activeView === name ? '' : ' hidden'}`);
      node.id = `academy-view-${name}`;
      node.setAttribute('role', 'tabpanel');
      node.setAttribute('aria-labelledby', `academy-tab-${name}`);
      viewPanels[name] = node;
      return node;
    }
    function shell() {
      viewButtons = {};
      viewPanels = {};
      const heading = el('div', undefined, 'academy-heading');
      heading.append(el('h2', '유유스 학습실 관리'), button('새로고침', () => load()));
      const tabs = el('div', undefined, 'subtabs academy-subtabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '유유스 학습실 관리 메뉴');
      tabs.append(viewTab('operations', '가입·수강생'), viewTab('setup', '기수·명단'), viewTab('audit', '변경 기록'));
      root.replaceChildren(heading,
        el('p', '가입 신청과 수강생 상태를 확인합니다. 기수와 수강 명단 설정은 별도 메뉴에서 관리합니다.', 'academy-notice'),
        tabs, status);
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
    async function mutate(action, values, reason, confirmation) {
      if (busy) return;
      if (!reason.value.trim()) { message('변경 사유를 입력해주세요.', true); reason.focus(); return; }
      if (!global.confirm(confirmation + '\n변경은 학습실에만 적용됩니다.')) return;
      busy = true; disabled(true); message('처리 중입니다. 창을 닫지 마세요.');
      const token = epoch;
      try {
        const { data, error } = await request(action, { ...values, reason: reason.value.trim() });
        if (token !== epoch) return;
        if (error || data?.ok !== true) throw error || new Error('invalid_response');
        busy = false;
        await load('변경을 저장했습니다. 최신 목록을 확인해주세요.');
      } catch (error) {
        if (token === epoch) { message(errorMessage(error), true); disabled(false); status.focus(); }
      } finally { if (token === epoch) busy = false; }
    }
    function command(action, row, values, reason, confirmation) {
      return mutate(action, { user_id: row.user_id, revision: row.revision, ...values }, reason, confirmation);
    }
    function record(row) {
      const section = el('article', undefined, 'academy-record');
      section.append(el('h4', row.display_name), el('p', `${row.canonical_gmail} · 휴대폰 끝 ${row.phone_last_four}`));
      return section;
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
    function applications(rows, total = rows.length) {
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', `가입 승인 대기 (${total})`));
      if (!rows.length) section.appendChild(el('p', '승인 대기 신청이 없습니다.', 'empty'));
      for (const row of rows) {
        const card = record(row), matches = Array.isArray(row.roster_matches) ? row.roster_matches : [], rosterSelect = rosterField(matches), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        fields.append(field('이름·Gmail·끝 4자리가 모두 같은 수강 명단', rosterSelect), field('검토 사유', reason));
        if (!matches.length) card.appendChild(el('p', '먼저 아래 수강 명단에 이 학생을 정확히 등록해주세요.', 'academy-notice'));
        card.append(fields, button('승인하고 기수 배정', () => {
          if (!rosterSelect.value) { message('이름·Gmail·끝 4자리가 모두 같은 수강 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
          const name = rosterSelect.selectedOptions[0].textContent;
          return command('review', row, { decision: 'approve', roster_entry_id: Number(rosterSelect.value) }, reason, `${name} 명단과 신청을 묶어 승인할까요?`);
        }, 'primary'), button('신청 반려', () => command('review', row, { decision: 'reject' }, reason, `${row.display_name} 학생의 신청을 반려할까요?`), 'danger'));
        section.appendChild(card);
      }
      return section;
    }
    function students(rows, total = rows.length) {
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', `수강생 관리 (${total})`));
      if (!rows.length) section.appendChild(el('p', '등록된 학습실 수강생이 없습니다.', 'empty'));
      const statuses = { active: '이용 가능', suspended: '이용 정지', revoked: '이용 해지' };
      for (const row of rows) {
        const candidates = Array.isArray(row.roster_options) ? row.roster_options : [];
        const card = record(row), rosterSelect = rosterField(candidates), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        card.appendChild(el('p', `${statuses[row.status] || '운영 확인 필요'} · 현재 배정: ${row.cohort_name || '없음'}`));
        fields.append(field('현재 기수로 사용할 등록 명단', rosterSelect), field('변경 사유', reason));
        card.append(fields, button('현재 기수 변경', () => {
          if (!rosterSelect.value) { message('이 학생과 일치하는 기수 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
          return command('assign', row, { roster_entry_id: Number(rosterSelect.value) }, reason, `${row.display_name} 학생의 현재 기수를 ${rosterSelect.selectedOptions[0].textContent}(으)로 바꿀까요?`);
        }, 'primary'));
        for (const [value, label] of Object.entries(statuses)) {
          if (row.status === value) continue;
          card.appendChild(button(label + '로 변경', () => command('set_status', row, { status: value }, reason, `${row.display_name} 학생을 ${label} 상태로 바꿀까요?`), value === 'active' ? 'primary' : value === 'revoked' ? 'danger' : 'outline'));
        }
        section.appendChild(card);
      }
      return section;
    }
    function input(type, placeholder) {
      const node = el('input'); node.type = type; node.placeholder = placeholder || ''; return node;
    }
    function cohortManagement(rows) {
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', '기수 설정'));
      const number = input('number', '예: 2'); number.min = '1'; number.required = true;
      const name = input('text', '예: 유유스 2기'); name.maxLength = 60; name.required = true;
      const slug = input('text', '예: 2gi'); slug.maxLength = 40; slug.required = true;
      const starts = input('date'); const ends = input('date'); const reason = reasonField();
      const statusSelect = el('select');
      for (const [value,label] of [['draft','준비'],['enrollment','명단 접수'],['active','운영 중']]) {
        const option=el('option',label); option.value=value; statusSelect.appendChild(option);
      }
      const fields=el('div',undefined,'academy-fields');
      fields.append(field('기수 번호',number),field('표시 이름',name),field('주소 코드',slug),field('운영 상태',statusSelect),field('시작일',starts),field('종료일',ends),field('등록 사유',reason));
      section.append(fields,button('새 기수 등록',()=>{
        if(!number.value || !name.value.trim() || !slug.value.trim()) { message('기수 번호·표시 이름·주소 코드를 모두 입력해주세요.',true); number.focus(); return; }
        return mutate('cohort_create',{cohort_number:Number(number.value),name:name.value.trim(),slug:slug.value.trim(),status:statusSelect.value,starts_on:starts.value,ends_on:ends.value},reason,`${name.value.trim()} 기수를 등록할까요?`);
      },'primary'));
      const statuses={draft:'준비',enrollment:'명단 접수',active:'운영 중',completed:'종료',archived:'보관'};
      for(const row of rows) {
        const card=el('article',undefined,'academy-record');
        card.append(el('h4',`${row.cohort_number}기 · ${row.name}`),el('p',`${statuses[row.status] || row.status} · ${row.starts_on || '시작일 미정'} ~ ${row.ends_on || '종료일 미정'} · 코드 ${row.slug}`));
        const next=el('select');
        for(const [value,label] of Object.entries(statuses)) { const option=el('option',label); option.value=value; if(value===row.status) option.selected=true; next.appendChild(option); }
        const changeReason=reasonField(); const edit=el('div',undefined,'academy-fields'); edit.append(field('변경할 운영 상태',next),field('변경 사유',changeReason));
        card.append(edit,button('기수 상태 변경',()=>mutate('cohort_set_status',{cohort_id:row.id,revision:row.revision,status:next.value},changeReason,`${row.name} 상태를 ${next.selectedOptions[0].textContent}(으)로 바꿀까요?`)));
        section.appendChild(card);
      }
      return section;
    }
    function rosterManagement(rows, cohorts) {
      const section=el('section',undefined,'academy-card'); section.appendChild(el('h3','수강 명단'));
      section.appendChild(el('p','필수 열은 기수·이름·Gmail 아이디·휴대폰 끝 4자리입니다. 주문/신청 번호는 선택 입력이며 비밀번호와 전체 휴대폰 번호는 받지 않습니다.','academy-notice'));
      const cohort=cohortField(cohorts.filter(row=>['draft','enrollment','active'].includes(row.status)));
      const name=input('text','수강생 이름'); name.maxLength=40; name.required=true;
      const gmail=input('text','Gmail 아이디'); gmail.required=true;
      const phone=input('text','끝 4자리'); phone.inputMode='numeric'; phone.maxLength=4; phone.required=true;
      const reference=input('text','선택: 주문/신청 번호'); reference.maxLength=80;
      const reason=reasonField(); const fields=el('div',undefined,'academy-fields');
      fields.append(field('기수',cohort),field('이름',name),field('Gmail 아이디 (@gmail.com 고정)',gmail),field('휴대폰 끝 4자리',phone),field('외부 참조 번호 (선택)',reference),field('등록 사유',reason));
      section.append(fields,button('수강 명단에 추가',()=>{
        if(!cohort.value || !name.value.trim() || !gmail.value.trim() || !/^[0-9]{4}$/.test(phone.value)) { message('기수·이름·Gmail 아이디·휴대폰 끝 4자리를 확인해주세요.',true); cohort.focus(); return; }
        return mutate('roster_add',{cohort_id:Number(cohort.value),display_name:name.value.trim(),gmail_local_id:gmail.value.trim(),phone_last_four:phone.value,source_reference:reference.value.trim()},reason,`${name.value.trim()} 학생을 ${cohort.selectedOptions[0].textContent} 명단에 추가할까요?`);
      },'primary'));
      const labels={eligible:'승인 대기 가능',bound:'계정 연결 완료',cancelled:'명단 취소'};
      for(const row of rows) {
        const card=record(row); card.appendChild(el('p',`${row.cohort_name} · ${labels[row.status] || row.status}${row.source_reference ? ` · 참조 ${row.source_reference}` : ''}`));
        if(row.status!=='bound') {
          const editName=input('text'); editName.value=row.display_name; editName.maxLength=40;
          const editGmail=input('text'); editGmail.value=String(row.canonical_gmail).replace(/@gmail\.com$/,'');
          const editPhone=input('text'); editPhone.value=row.phone_last_four; editPhone.inputMode='numeric'; editPhone.maxLength=4;
          const editReference=input('text'); editReference.value=row.source_reference || ''; editReference.maxLength=80;
          const editReason=reasonField(); const editFields=el('div',undefined,'academy-fields');
          editFields.append(field('이름',editName),field('Gmail 아이디 (@gmail.com 고정)',editGmail),field('휴대폰 끝 4자리',editPhone),field('외부 참조 번호 (선택)',editReference),field('수정 사유',editReason));
          card.append(editFields,button(row.status==='cancelled' ? '수정하고 명단 복구' : '명단 정보 수정',()=>mutate('roster_update',{roster_entry_id:row.id,revision:row.revision,display_name:editName.value.trim(),gmail_local_id:editGmail.value.trim(),phone_last_four:editPhone.value,source_reference:editReference.value.trim()},editReason,`${row.display_name} 학생의 ${row.cohort_name} 명단 정보를 저장할까요?`)));
        }
        if(row.status==='eligible') { const cancelReason=reasonField(); card.append(field('취소 사유',cancelReason),button('명단 취소',()=>mutate('roster_cancel',{roster_entry_id:row.id,revision:row.revision},cancelReason,`${row.display_name} 학생의 ${row.cohort_name} 명단을 취소할까요?`),'danger')); }
        section.appendChild(card);
      }
      return section;
    }
    function summary(data) {
      const section = el('section', undefined, 'academy-summary');
      section.setAttribute('aria-label', '학습실 운영 요약');
      const metric = (label, value) => {
        const item = el('div', undefined, 'academy-summary-item');
        item.append(el('span', label, 'academy-summary-label'), el('strong', value, 'academy-summary-value'));
        return item;
      };
      const activeCohorts = data.cohorts.filter(row => row.status === 'active').length;
      section.append(
        metric('운영 중인 기수', `${activeCohorts}개`),
        metric('가입 승인 대기', `${data.totals?.applications ?? data.applications.length}명`),
        metric('등록 수강생', `${data.totals?.students ?? data.students.length}명`)
      );
      return section;
    }
    function pagination(data, view) {
      const wrapper = el('div');
      const pages = el('nav', undefined, 'academy-pagination'); pages.setAttribute('aria-label', '관리 목록 페이지');
      const total = view === 'operations'
        ? Math.max(data.totals?.applications || 0, data.totals?.students || 0)
        : data.totals?.roster || 0;
      if (pageOffset > 0) pages.appendChild(button('이전 100건', () => load(undefined, Math.max(0, pageOffset - 100))));
      if (total > pageOffset + 100) {
        pages.appendChild(button('다음 100건', () => load(undefined, pageOffset + 100)));
      }
      if (pageOffset > 0 || total > 100) wrapper.append(pages, el('p', `목록 ${pageOffset + 1}번부터 최대 100건을 표시합니다.`, 'academy-notice'));
      return wrapper;
    }
    function auditManagement(rows) {
      const section = el('section', undefined, 'academy-card');
      section.appendChild(el('h3', `최근 변경 기록 (${rows.length})`));
      if (!rows.length) {
        section.appendChild(el('p', '변경 기록이 없습니다.', 'empty'));
        return section;
      }
      const list = el('ul', undefined, 'academy-audit-list');
      for (const entry of rows) list.appendChild(el('li', `${entry.created_at} · ${entry.action} · 대상 ${entry.subject_id} · ${entry.detail?.reason || '신청 접수'}`));
      section.appendChild(list);
      return section;
    }
    async function load(successMessage, offset = pageOffset) {
      if (busy) return;
      const token = ++epoch;
      let restoreViewFocus = false;
      let loaded = false;
      pageOffset = offset;
      busy = true; shell(); disabled(true); message('학습실 관리 정보를 확인하고 있습니다.');
      try {
        const { data, error } = await request('admin_snapshot', { offset: pageOffset });
        if (token !== epoch) return;
        if (error) throw error;
        if (data?.version !== 2 || !['applications', 'students', 'cohorts', 'roster', 'audit'].every(key => Array.isArray(data[key]))) throw new Error('invalid_contract');
        const operations = viewPanel('operations');
        operations.append(summary(data), applications(data.applications, data.totals?.applications), students(data.students, data.totals?.students), pagination(data, 'operations'));
        const setup = viewPanel('setup');
        setup.append(cohortManagement(data.cohorts), rosterManagement(data.roster, data.cohorts), pagination(data, 'setup'));
        const audit = viewPanel('audit');
        audit.append(auditManagement(data.audit), el('p', '최근 변경 기록은 최대 50건까지 표시합니다.', 'academy-notice'));
        root.append(operations, setup, audit);
        restoreViewFocus = focusViewAfterLoad;
        focusViewAfterLoad = false;
        switchView(activeView);
        message(successMessage || '학습실 전용 권한과 최신 정보를 확인했습니다.');
        loaded = true;
      } catch (error) {
        if (token === epoch) { focusViewAfterLoad = false; message(errorMessage(error), true); status.focus(); }
      } finally {
        if (token === epoch) {
          busy = false;
          disabled(false);
          if (loaded) (restoreViewFocus ? viewButtons[activeView] : status).focus();
        }
      }
    }
    function clear() { epoch++; busy = false; pageOffset = 0; focusViewAfterLoad = false; root.replaceChildren(); }
    return { load, clear };
  }
  global.createAcademyAdmin = createAcademyAdmin;
})(typeof window === 'undefined' ? globalThis : window);
