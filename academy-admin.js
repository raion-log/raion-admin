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
    function button(text, onClick) {
      const node = el('button', text);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    }
    function shell() {
      root.replaceChildren(el('h2', '유유스 학습실 관리'),
        el('p', '기수와 수강 명단을 먼저 등록한 뒤 신청을 대조합니다. 명단·승인 변경은 학습실에만 적용됩니다. 관리자 2단계 인증은 중앙 로그인 계정에 보안 수단을 추가하며, 등록 완료 시 다른 기기의 로그인 세션이 종료될 수 있습니다.', 'academy-notice'),
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
    async function verifyMfaCode(factorId, code) {
      const challenge = await bounded(client.auth.mfa.challenge({ factorId }));
      if (challenge.error) throw challenge.error;
      const verified = await bounded(client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code }));
      if (verified.error) throw verified.error;
    }
    function showMfaChallenge(factor, token) {
      const section = el('section'); section.append(el('h3', '관리자 2단계 인증'), el('p', '인증 앱에 표시된 6자리 코드를 입력해야 학습실 수강생 정보를 볼 수 있습니다.', 'academy-notice'));
      const code = el('input'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 6; code.placeholder = '인증 앱의 6자리 코드';
      const action = button('2단계 인증 확인', async () => {
        if (!/^[0-9]{6}$/.test(code.value)) { message('인증 앱에 표시된 6자리 코드를 입력해주세요.', true); code.focus(); return; }
        disabled(true); message('2단계 인증을 확인하고 있습니다.');
        try { await verifyMfaCode(factor.id, code.value); if (token === epoch) await load('2단계 인증을 확인했습니다.'); }
        catch { if (token === epoch) { message('코드를 확인하지 못했습니다. 새 코드를 확인해 다시 입력해주세요.', true); disabled(false); code.focus(); } }
      });
      section.append(field('6자리 인증 코드', code), action); root.appendChild(section);
    }
    function showMfaEnrollment(token) {
      const section = el('section'); section.append(el('h3', '관리자 2단계 인증 등록'), el('p', '학습실 관리를 처음 이용할 때만 인증 앱을 등록합니다. Google Authenticator 같은 인증 앱을 준비해주세요.', 'academy-notice'));
      section.appendChild(button('인증 앱 등록 시작', async () => {
        disabled(true); message('등록용 QR 코드를 만들고 있습니다.');
        try {
          const enrolled = await bounded(client.auth.mfa.enroll({ factorType: 'totp', friendlyName: '유유스 학습실 관리자' }));
          if (enrolled.error) throw enrolled.error;
          if (token !== epoch) return;
          section.replaceChildren(el('h3', '관리자 2단계 인증 등록'), el('p', '인증 앱에서 QR 코드를 스캔한 뒤 앱에 표시된 6자리 코드를 입력하세요.', 'academy-notice'));
          const qr = el('img'); qr.src = enrolled.data.totp.qr_code; qr.alt = '인증 앱 등록용 QR 코드'; qr.className = 'academy-mfa-qr';
          const secret = el('code', enrolled.data.totp.secret, 'academy-mfa-secret');
          section.append(qr, el('p', 'QR 인식이 어려우면 아래 설정 키를 인증 앱에 직접 입력하세요.'), secret);
          const code = el('input'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 6; code.placeholder = '인증 앱의 6자리 코드';
          section.append(field('6자리 인증 코드', code), button('등록 확인', async () => {
            if (!/^[0-9]{6}$/.test(code.value)) { message('인증 앱에 표시된 6자리 코드를 입력해주세요.', true); code.focus(); return; }
            disabled(true); message('2단계 인증 등록을 확인하고 있습니다.');
            try { await verifyMfaCode(enrolled.data.id, code.value); if (token === epoch) await load('2단계 인증 등록을 완료했습니다.'); }
            catch { if (token === epoch) { message('코드를 확인하지 못했습니다. 새 코드를 확인해 다시 입력해주세요.', true); disabled(false); code.focus(); } }
          }));
          disabled(false); message('QR 코드를 스캔하고 6자리 코드를 입력해주세요.'); code.focus();
        } catch { if (token === epoch) { message('2단계 인증 등록을 시작하지 못했습니다. 다시 로그인한 뒤 시도해주세요.', true); disabled(false); } }
      }));
      root.appendChild(section);
    }
    function showPendingMfa(factor, token) {
      const section = el('section');
      section.append(el('h3', '관리자 2단계 인증 등록 이어서 하기'),
        el('p', '앞에서 시작한 등록이 남아 있습니다. 이미 인증 앱에 추가했다면 6자리 코드를 입력하세요. QR을 저장하지 못했다면 이 미완료 등록만 정리한 뒤 다시 시작할 수 있습니다.', 'academy-notice'));
      const code = el('input'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 6; code.placeholder = '인증 앱의 6자리 코드';
      section.append(field('6자리 인증 코드', code), button('등록 확인', async () => {
        if (!/^[0-9]{6}$/.test(code.value)) { message('인증 앱에 표시된 6자리 코드를 입력해주세요.', true); code.focus(); return; }
        disabled(true); message('미완료 등록을 확인하고 있습니다.');
        try { await verifyMfaCode(factor.id, code.value); if (token === epoch) await load('2단계 인증 등록을 완료했습니다.'); }
        catch { if (token === epoch) { message('코드를 확인하지 못했습니다. QR을 저장하지 못했다면 미완료 등록을 정리하고 다시 시작해주세요.', true); disabled(false); code.focus(); } }
      }), button('미완료 등록 정리', async () => {
        if (!global.confirm('유유스 학습실 관리자가 시작한 미완료 2단계 인증 등록만 삭제할까요?\n이미 등록 완료된 인증 수단은 건드리지 않습니다.')) return;
        disabled(true); message('미완료 등록을 정리하고 있습니다.');
        try {
          const removed = await bounded(client.auth.mfa.unenroll({ factorId: factor.id }));
          if (removed.error) throw removed.error;
          if (token === epoch) await load('미완료 등록을 정리했습니다. 등록을 다시 시작해주세요.');
        } catch { if (token === epoch) { message('미완료 등록을 정리하지 못했습니다. 다시 로그인한 뒤 시도해주세요.', true); disabled(false); } }
      }));
      root.appendChild(section);
    }
    async function requireMfa(token) {
      const level = await bounded(client.auth.mfa.getAuthenticatorAssuranceLevel());
      if (level.error) throw level.error;
      if (token !== epoch) return false;
      if (level.data.currentLevel === 'aal2') return true;
      const factors = await bounded(client.auth.mfa.listFactors());
      if (factors.error) throw factors.error;
      if (token !== epoch) return false;
      const factor = factors.data.totp.find(item => item.status === 'verified');
      const pending = (Array.isArray(factors.data.all) ? factors.data.all : []).find(item => item.factor_type === 'totp'
        && item.status === 'unverified' && item.friendly_name === '유유스 학습실 관리자');
      if (factor) showMfaChallenge(factor, token);
      else if (pending) showPendingMfa(pending, token);
      else showMfaEnrollment(token);
      message('학습실 관리 전용 2단계 인증이 필요합니다.');
      return false;
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
      section.append(el('h3', row.display_name), el('p', `${row.canonical_gmail} · 휴대폰 끝 ${row.phone_last_four}`));
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
    function applications(rows) {
      const section = el('section'); section.appendChild(el('h3', '승인 대기'));
      if (!rows.length) section.appendChild(el('p', '승인 대기 신청이 없습니다.'));
      for (const row of rows) {
        const card = record(row), matches = Array.isArray(row.roster_matches) ? row.roster_matches : [], rosterSelect = rosterField(matches), reason = reasonField();
        const fields = el('div', undefined, 'academy-fields');
        fields.append(field('이름·Gmail·끝 4자리가 모두 같은 수강 명단', rosterSelect), field('검토 사유', reason));
        if (!matches.length) card.appendChild(el('p', '먼저 아래 수강 명단에 이 학생을 정확히 등록해주세요.', 'academy-notice'));
        card.append(fields, button('승인하고 기수 배정', () => {
          if (!rosterSelect.value) { message('이름·Gmail·끝 4자리가 모두 같은 수강 명단을 선택해주세요.', true); rosterSelect.focus(); return; }
          const name = rosterSelect.selectedOptions[0].textContent;
          return command('review', row, { decision: 'approve', roster_entry_id: Number(rosterSelect.value) }, reason, `${name} 명단과 신청을 묶어 승인할까요?`);
        }), button('신청 반려', () => command('review', row, { decision: 'reject' }, reason, `${row.display_name} 학생의 신청을 반려할까요?`)));
        section.appendChild(card);
      }
      return section;
    }
    function students(rows) {
      const section = el('section'); section.appendChild(el('h3', '수강생 · 현재 기수'));
      if (!rows.length) section.appendChild(el('p', '등록된 학습실 수강생이 없습니다.'));
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
        }));
        for (const [value, label] of Object.entries(statuses)) {
          if (row.status === value) continue;
          card.appendChild(button(label + '로 변경', () => command('set_status', row, { status: value }, reason, `${row.display_name} 학생을 ${label} 상태로 바꿀까요?`)));
        }
        section.appendChild(card);
      }
      return section;
    }
    function input(type, placeholder) {
      const node = el('input'); node.type = type; node.placeholder = placeholder || ''; return node;
    }
    function cohortManagement(rows) {
      const section = el('section'); section.appendChild(el('h3', '기수 설정'));
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
      }));
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
      const section=el('section'); section.appendChild(el('h3','수강 명단'));
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
      }));
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
        if(row.status==='eligible') { const cancelReason=reasonField(); card.append(field('취소 사유',cancelReason),button('명단 취소',()=>mutate('roster_cancel',{roster_entry_id:row.id,revision:row.revision},cancelReason,`${row.display_name} 학생의 ${row.cohort_name} 명단을 취소할까요?`))); }
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
        if (!await requireMfa(token)) return;
        const { data, error } = await request('admin_snapshot', { offset: pageOffset });
        if (token !== epoch) return;
        if (error) throw error;
        if (data?.version !== 2 || !['applications', 'students', 'cohorts', 'roster', 'audit'].every(key => Array.isArray(data[key]))) throw new Error('invalid_contract');
        root.append(cohortManagement(data.cohorts), rosterManagement(data.roster, data.cohorts), applications(data.applications), students(data.students));
        const pages = el('nav'); pages.setAttribute('aria-label', '관리 목록 페이지');
        if (pageOffset > 0) pages.appendChild(button('이전 100건', () => load(undefined, Math.max(0, pageOffset - 100))));
        if (Math.max(data.totals?.applications || 0, data.totals?.students || 0, data.totals?.roster || 0) > pageOffset + 100) {
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
