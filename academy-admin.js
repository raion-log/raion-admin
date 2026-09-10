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
    function record(row, headingTag = 'h4') {
      const section = el('article', undefined, 'academy-record');
      section.append(el(headingTag, row.display_name), el('p', `${row.canonical_gmail} · 휴대폰 끝 ${row.phone_last_four}`));
      return section;
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
    function applications(rows, total = rows.length, audit = []) {
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', `가입 승인 대기 (${total})`));
      if (!rows.length) section.appendChild(el('p', '승인 대기 신청이 없습니다.', 'empty'));
      for (const row of rows) {
        const card = record(row), matches = Array.isArray(row.roster_matches) ? row.roster_matches : [], rosterSelect = rosterField(matches), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        fields.append(field('이름·Gmail·끝 4자리가 모두 같은 수강 명단', rosterSelect), field('검토 사유', reason));
        const review = [];
        if (!matches.length) review.push(el('p', '먼저 기수·명단에서 이 학생을 정확히 등록해주세요.', 'academy-notice'));
        const actions = el('div', undefined, 'academy-actions');
        actions.append(button('승인하고 기수 배정', () => {
          if (!rosterSelect.value) { message('이름·Gmail·끝 4자리가 모두 같은 수강 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
          const name = rosterSelect.selectedOptions[0].textContent;
          return command('review', row, { decision: 'approve', roster_entry_id: Number(rosterSelect.value) }, reason, `${name} 명단과 신청을 묶어 승인할까요?`);
        }, 'primary'), button('신청 반려', () => command('review', row, { decision: 'reject' }, reason, `${row.display_name} 학생의 신청을 반려할까요?`), 'danger'));
        review.push(fields, actions);
        card.append(disclosure('가입 신청 검토', review), historyDisclosure(row.user_id, audit));
        section.appendChild(card);
      }
      return section;
    }
    function students(rows, total = rows.length, audit = []) {
      const section = el('section', undefined, 'academy-card'); section.appendChild(el('h3', `수강생 관리 (${total})`));
      if (!rows.length) section.appendChild(el('p', '등록된 학습실 수강생이 없습니다.', 'empty'));
      const statuses = { active: '이용 가능', suspended: '이용 정지', revoked: '이용 해지' };
      for (const row of rows) {
        const candidates = Array.isArray(row.roster_options) ? row.roster_options : [];
        const card = record(row), rosterSelect = rosterField(candidates), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        card.appendChild(el('p', `${statuses[row.status] || '운영 확인 필요'} · 현재 기수 ${row.cohort_name || '없음'}`));
        fields.append(field('현재 기수로 사용할 등록 명단', rosterSelect), field('변경 사유', reason));
        const actions = el('div', undefined, 'academy-actions');
        actions.append(button('현재 기수 변경', () => {
          if (!rosterSelect.value) { message('이 학생과 일치하는 기수 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
          return command('assign', row, { roster_entry_id: Number(rosterSelect.value) }, reason, `${row.display_name} 학생의 현재 기수를 ${rosterSelect.selectedOptions[0].textContent}(으)로 바꿀까요?`);
        }, 'primary'));
        for (const [value, label] of Object.entries(statuses)) {
          if (row.status === value) continue;
          actions.appendChild(button(label + '로 변경', () => command('set_status', row, { status: value }, reason, `${row.display_name} 학생을 ${label} 상태로 바꿀까요?`), value === 'active' ? 'primary' : value === 'revoked' ? 'danger' : 'outline'));
        }
        card.append(disclosure('계정 관리', [fields, actions]), historyDisclosure(row.user_id, audit));
        section.appendChild(card);
      }
      return section;
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
    function cohortManagement(rows) {
      const section = el('section', undefined, 'academy-management-group');
      section.append(el('h4', '기수'), el('p', '기수를 만든 뒤 수강생 입장을 열면 해당 기간의 승인된 수강생만 학습실에 들어올 수 있습니다.', 'academy-notice'));
      const number = input('number', '예: 2'); number.min = '1'; number.required = true;
      const name = input('text', '예: 유유스 2기'); name.maxLength = 60; name.required = true;
      const slug = input('text', '예: 2gi'); slug.maxLength = 40; slug.required = true;
      const starts = input('date'); const ends = input('date'); const reason = reasonField();
      const fields=el('div',undefined,'academy-fields');
      fields.append(field('기수 번호',number),field('표시 이름',name),field('주소 코드',slug),field('시작일',starts),field('종료일',ends),field('등록 사유',reason));
      const createAction = button('새 기수 등록',()=>{
        if(!number.value || !name.value.trim() || !slug.value.trim()) { message('기수 번호·표시 이름·주소 코드를 모두 입력해주세요.',true); number.focus(); return; }
        const slugValue=slug.value.trim().toLowerCase();
        if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slugValue)) { message('주소 코드는 영문 소문자·숫자·하이픈만 사용할 수 있습니다.',true); slug.focus(); return; }
        if(starts.value && ends.value && starts.value>ends.value) { message('종료일은 시작일보다 빠를 수 없습니다.',true); ends.focus(); return; }
        return mutate('cohort_create',{cohort_number:Number(number.value),name:name.value.trim(),slug:slugValue,status:'draft',starts_on:starts.value,ends_on:ends.value},reason,`${name.value.trim()} 기수를 닫힌 상태로 등록할까요?`);
      },'primary');
      section.appendChild(disclosure('새 기수 추가', [el('p', '새 기수는 수강생 입장이 닫힌 상태로 만들어집니다.', 'academy-notice'), fields, createAction]));
      for(const row of rows) {
        const card=el('article',undefined,'academy-record');
        const isOpen=row.status==='active';
        const access=cohortAccess(row);
        const numberLabel=`${row.cohort_number}기`;
        const heading=String(row.name).includes(numberLabel) ? row.name : `${numberLabel} · ${row.name}`;
        card.append(
          el('h5',heading),
          el('p',`${access.label} · ${row.starts_on || '시작일 미정'} ~ ${row.ends_on || '종료일 미정'} · 주소 코드 ${row.slug}`)
        );
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
        section.appendChild(card);
      }
      return section;
    }
    function rosterManagement(rows, cohorts) {
      const section=el('section',undefined,'academy-management-group'); section.appendChild(el('h4','수강 명단'));
      section.appendChild(el('p','필수 열은 기수·이름·Gmail 아이디·휴대폰 끝 4자리입니다. 주문/신청 번호는 선택 입력이며 비밀번호와 전체 휴대폰 번호는 받지 않습니다.','academy-notice'));
      const cohort=cohortField(cohorts.filter(row=>['draft','enrollment','active'].includes(row.status)));
      const name=input('text','수강생 이름'); name.maxLength=40; name.required=true;
      const gmail=input('text','Gmail 아이디'); gmail.required=true;
      const phone=input('text','끝 4자리'); phone.inputMode='numeric'; phone.maxLength=4; phone.required=true;
      const reference=input('text','선택: 주문/신청 번호'); reference.maxLength=80;
      const reason=reasonField(); const fields=el('div',undefined,'academy-fields');
      fields.append(field('기수',cohort),field('이름',name),field('Gmail 아이디 (@gmail.com 고정)',gmail),field('휴대폰 끝 4자리',phone),field('외부 참조 번호 (선택)',reference),field('등록 사유',reason));
      const addAction = button('수강 명단에 추가',()=>{
        if(!cohort.value || !name.value.trim() || !gmail.value.trim() || !/^[0-9]{4}$/.test(phone.value)) { message('기수·이름·Gmail 아이디·휴대폰 끝 4자리를 확인해주세요.',true); cohort.focus(); return; }
        return mutate('roster_add',{cohort_id:Number(cohort.value),display_name:name.value.trim(),gmail_local_id:gmail.value.trim(),phone_last_four:phone.value,source_reference:reference.value.trim()},reason,`${name.value.trim()} 학생을 ${cohort.selectedOptions[0].textContent} 명단에 추가할까요?`);
      },'primary');
      section.appendChild(disclosure('수강 명단 추가', [fields, addAction]));
      const labels={eligible:'승인 대기 가능',bound:'계정 연결 완료',cancelled:'명단 취소'};
      for(const row of rows) {
        const card=record(row, 'h5'); card.appendChild(el('p',`${row.cohort_name} · ${labels[row.status] || row.status}${row.source_reference ? ` · 참조 ${row.source_reference}` : ''}`));
        if(row.status!=='bound') {
          const editName=input('text'); editName.value=row.display_name; editName.maxLength=40;
          const editGmail=input('text'); editGmail.value=String(row.canonical_gmail).replace(/@gmail\.com$/,'');
          const editPhone=input('text'); editPhone.value=row.phone_last_four; editPhone.inputMode='numeric'; editPhone.maxLength=4;
          const editReference=input('text'); editReference.value=row.source_reference || ''; editReference.maxLength=80;
          const editReason=reasonField(); const editFields=el('div',undefined,'academy-fields');
          editFields.append(field('이름',editName),field('Gmail 아이디 (@gmail.com 고정)',editGmail),field('휴대폰 끝 4자리',editPhone),field('외부 참조 번호 (선택)',editReference),field('수정 사유',editReason));
          card.appendChild(disclosure('명단 정보 관리', [editFields, button(row.status==='cancelled' ? '수정하고 명단 복구' : '명단 정보 수정',()=>mutate('roster_update',{roster_entry_id:row.id,revision:row.revision,display_name:editName.value.trim(),gmail_local_id:editGmail.value.trim(),phone_last_four:editPhone.value,source_reference:editReference.value.trim()},editReason,`${row.display_name} 학생의 ${row.cohort_name} 명단 정보를 저장할까요?`))]));
        }
        if(row.status==='eligible') {
          const cancelReason=reasonField();
          card.appendChild(disclosure('명단 취소', [field('취소 사유',cancelReason),button('명단 취소',()=>mutate('roster_cancel',{roster_entry_id:row.id,revision:row.revision},cancelReason,`${row.display_name} 학생의 ${row.cohort_name} 명단을 취소할까요?`),'danger')]));
        }
        section.appendChild(card);
      }
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
      section.append(
        metric('현재 입장 가능한 기수', `${activeCohorts}개`),
        metric('가입 승인 대기', `${data.totals?.applications ?? data.applications.length}명`),
        metric('등록 수강생', `${data.totals?.students ?? data.students.length}명`)
      );
      return section;
    }
    function pagination(data) {
      const wrapper = el('div');
      const pages = el('nav', undefined, 'academy-pagination'); pages.setAttribute('aria-label', '관리 목록 페이지');
      const total = Math.max(data.totals?.applications || 0, data.totals?.students || 0, data.totals?.roster || 0);
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
        if (data?.version !== 2 || !['applications', 'students', 'cohorts', 'roster', 'audit'].every(key => Array.isArray(data[key]))) throw new Error('invalid_contract');
        const content = el('div', undefined, 'academy-view');
        const management = el('section', undefined, 'academy-card');
        management.append(el('h3', '기수·수강 명단'), cohortManagement(data.cohorts), rosterManagement(data.roster.slice(0, 100), data.cohorts));
        content.append(summary(data), applications(data.applications, data.totals?.applications, data.audit), students(data.students, data.totals?.students, data.audit), management, pagination(data));
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
    function clear() { epoch++; busy = false; pageOffset = 0; root.replaceChildren(); }
    return { load, clear };
  }
  global.createAcademyAdmin = createAcademyAdmin;
})(typeof window === 'undefined' ? globalThis : window);
