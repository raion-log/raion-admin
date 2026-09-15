const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../academy-admin.js'),'utf8');

class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.attrs={}; this.events={}; this.textContent=''; this.value=''; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { node.parent=this; this.children.push(node); return node; }
  remove() { if(this.parent) this.parent.children=this.parent.children.filter(n=>n!==this); }
  close() { this.open=false; this.events.close?.(); }
  replaceChildren(...nodes) { this.textContent=''; this.children=nodes; }
  setAttribute(k,v) { this.attrs[k]=v; }
  addEventListener(k,v) { this.events[k]=v; }
  focus() { if (!this.disabled) this.focused=true; }
  querySelectorAll(selector) {
    const tags=selector.split(',').map(x=>x.trim());
    return this.children.flatMap(c=>[...(tags.includes(c.tagName)?[c]:[]),...c.querySelectorAll(selector)]);
  }
}
const copy = {version:2,applications:[],students:[],cohorts:[],roster:[],audit:[]};
const css = fs.readFileSync(require('node:path').join(__dirname,'../academy-admin.css'),'utf8');
test('the base form and disclosure styles survive — a region replace once ate all 21 of them', () => {
  // ★2026-09-14 실사고: 표 규칙을 넣으며 「내 주석 ~ .academy-pagination」 구간을 통째로 바꿨는데
  //   그 사이에 label·input·select·접기 기본 서식이 들어 있었다. 화면이 흰 입력칸으로 깨졌고
  //   시험은 전부 초록이었다 — JS 만 읽고 CSS 는 아무도 안 봤기 때문이다.
  for (const rule of [
    '.academy-admin label { display: flex;',
    '.academy-admin input, .academy-admin select { width: 100%;',
    '.academy-admin input:focus, .academy-admin select:focus {',
    '.academy-admin .academy-fields { display: flex;',
    '.academy-admin .academy-actions { display: flex;',
    '.academy-admin .academy-disclosure { margin-top: 8px;',
    '.academy-admin .academy-disclosure summary { display: flex;',
    '.academy-admin .academy-disclosure summary::after {',
    '.academy-admin .academy-disclosure-body {',
    '.academy-admin :is(button, input, select):focus-visible {'
  ]) assert.ok(css.includes(rule), `기본 서식이 사라졌다: ${rule}`);
});
test('table cells never break a word across two lines', () => {
  // 「유유스 1기」가 「유유스 1 / 기」로, 「김수한무거북이」가 두 줄로 쪼개졌다 — 다른 탭에서
  // 「차단」이 「차/단」이 된 것과 같은 결함이다. 모자라면 표를 가로로 민다.
  for (const rule of [
    '.academy-admin .academy-table th,',
    '.academy-admin .academy-table td { white-space: nowrap; }',
    '.academy-admin .academy-table { width: 100%; border-collapse: collapse; }',
    // 칸 안의 입력이 width:100% 를 물려받거나 auto 로 커지면 표가 보이는 폭을 넘는다.
    // 실측 2026-09-14, 1320px 창: 고치기 전 넘침 255px -> 0px.
    '.academy-admin .academy-table input[type="text"] { width: 130px;'
  ]) assert.ok(css.includes(rule), `표 규칙이 사라졌다: ${rule}`);
});

function setup(rpc,confirm=()=>true,timers={setTimeout,clearTimeout}) {
  const root=new Element('section');
  const window={confirm:()=>{throw new Error('Native confirm must not be used');}};
  vm.runInNewContext(source,{window,AbortController,...timers,document:{createElement:tag=>{
    const node=new Element(tag);
    if(tag==='dialog') node.showModal=()=>{
      node.open=true;
      if(confirm) findButton(node,confirm(textOf(node))?'확인하고 적용':'취소하고 돌아가기').events.click();
    };
    return node;
  }}});
  return {root,admin:window.createAcademyAdmin({rpc},root)};
}
const textOf = node => [node.textContent,...node.children.map(textOf)].join(' ');
const findButton = (root,text)=>root.querySelectorAll('button').find(n=>n.textContent===text);

async function manualRoster() {
  const calls=[];
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    return args.action==='admin_snapshot' ? {data:{...copy,cohorts:[{id:1,name:'검증 1기',status:'active'}]}} : {data:{ok:true}};
  },null);
  await admin.load();
  const direct=root.querySelectorAll('section').find(n=>String(n.className).includes('academy-direct-add'));
  const inputs=direct.querySelectorAll('input');
  inputs.find(n=>n.placeholder==='수강생 이름').value='합성 검증';
  inputs.find(n=>n.placeholder==='끝 4자리').value='4826';
  const cohort=direct.querySelectorAll('select').find(n=>n.required);
  cohort.value='1'; cohort.selectedOptions=[{textContent:'검증 1기'}];
  return {root,admin,calls,add:findButton(root,'수강 명단에 추가')};
}
test('in-page confirmation blocks writes, cancels with Escape, and permits retry',async()=>{
  const {root,calls,add}=await manualRoster();
  const pending=add.events.click();
  const dialog=root.querySelectorAll('dialog')[0];
  assert.equal(dialog.open,true);
  assert.equal(calls.length,1);
  assert.equal(add.disabled,true);
  assert.equal(findButton(dialog,'취소하고 돌아가기').focused,true);
  let prevented=false;
  dialog.events.cancel({preventDefault(){prevented=true;}});
  await pending;
  assert.equal(prevented,true);
  assert.equal(calls.length,1);
  assert.equal(root.querySelectorAll('dialog').length,0);
  assert.equal(add.disabled,false);
  const retry=add.events.click();
  findButton(root,'취소하고 돌아가기').events.click();
  await retry;
  assert.equal(calls.length,1);
});
test('explicit confirmation sends one audited payload despite duplicate clicks',async()=>{
  const {root,calls,add}=await manualRoster();
  const pending=add.events.click();
  await add.events.click();
  const apply=findButton(root,'확인하고 적용');
  apply.events.click(); apply.events.click();
  await pending;
  assert.equal(calls.filter(c=>c.action==='roster_add').length,1);
  assert.equal(calls[1].payload.reason,'관리자 화면에서 수강 명단 등록');
});
test('clear invalidates both an open and a just-accepted confirmation before RPC',async()=>{
  for(const accept of [false,true]) {
    const {root,admin,calls,add}=await manualRoster();
    const pending=add.events.click();
    if(accept) findButton(root,'확인하고 적용').events.click();
    admin.clear();
    await pending;
    assert.equal(calls.length,1);
    assert.equal(root.children.length,0);
  }
});

test('load errors are not rendered as empty queues and raw server detail is not leaked',async()=>{
  const {root,admin}=setup(async()=>({error:{code:'42501',message:'private email@example.test'}}));
  await admin.load();
  assert.match(textOf(root),/학습실 관리 권한/);
  assert.doesNotMatch(textOf(root),/승인 대기 신청이 없습니다|email@example/);
  assert.equal(findButton(root,'새로고침').disabled,false);
});
test('missing database API is explicitly distinguished from a connected empty queue',async()=>{
  const {root,admin}=setup(async()=>({error:{code:'PGRST202'}}));
  await admin.load();
  assert.match(textOf(root),/DB API가 아직 적용되지 않았습니다/);
  assert.doesNotMatch(textOf(root),/최신 정보를 확인했습니다/);
});
test('successful empty snapshot, contract failure and XSS are handled without HTML interpolation',async()=>{
  const {root,admin}=setup(async()=>({data:copy}));
  await admin.load(); assert.match(textOf(root),/승인 대기 신청이 없습니다/);
  const hostile='<img src=x onerror=alert(1)>';
  const second=setup(async()=>({data:{...copy,students:[{user_id:'fixture',revision:1,display_name:hostile,canonical_gmail:'example@gmail.com',phone_last_four:'0000',status:'active'}]}}));
  await second.admin.load();
  assert.ok(textOf(second.root).includes(hostile));
  assert.equal(second.root.querySelectorAll('img').length,0);
  assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|eval\(/);
  const broken=setup(async()=>({data:{version:99}}));
  await broken.admin.load(); assert.match(textOf(broken.root),/처리 결과를 확인하지 못했습니다/);
});
test('logout/clear invalidates a late privileged response',async()=>{
  let resolve;
  const {root,admin}=setup(()=>new Promise(r=>{resolve=r;}));
  const pending=admin.load(); await new Promise(done=>setImmediate(done)); admin.clear(); resolve({data:copy}); await pending;
  assert.equal(root.children.length,0);
});
test('stalled requests time out with a result-unconfirmed message and a usable retry',async()=>{
  let timeout;
  const {root,admin}=setup(()=>new Promise(()=>{}),()=>true,{setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{}});
  const pending=admin.load(); await new Promise(done=>setImmediate(done)); timeout(); await pending;
  assert.match(textOf(root),/처리 결과를 확인하지 못했습니다/);
  assert.equal(findButton(root,'새로고침').disabled,false);
  assert.ok(root.children.some(node=>node.focused));
});
test('approval requires an explicit cohort, confirmation and revision while its audit reason is automatic',async()=>{
  const calls=[];
  let finish;
  const row={user_id:'fixture-id',revision:7,display_name:'예시 학생',canonical_gmail:'example@gmail.com',phone_last_four:'0000',roster_matches:[{id:12,cohort_id:2,cohort_name:'2기',display_name:'예시 학생',canonical_gmail:'example@gmail.com',phone_last_four:'0000',status:'eligible'}]};
  const {root,admin}=setup(async(_rpc,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,applications:[row],cohorts:[{id:2,cohort_number:2,name:'2기',slug:'2gi',status:'active',revision:1}]}};
    return new Promise(resolve=>{finish=resolve;});
  });
  await admin.load();
  const approve=findButton(root,'승인');
  await approve.events.click();
  assert.equal(calls.length,1);
  const select=root.querySelectorAll('select').find(node=>node.children.some(option=>String(option.textContent).includes('example@gmail.com')));
  select.value='12';select.selectedOptions=[{textContent:'2기 · 예시 학생 · example@gmail.com'}];
  const pending=approve.events.click();
  await approve.events.click();
  assert.equal(calls.length,2);
  assert.equal(calls[1].action,'review');
  assert.equal(calls[1].payload.roster_entry_id,12);
  assert.equal(calls[1].payload.revision,7);
  assert.equal(calls[1].payload.reason,'관리자 화면에서 가입 승인');
  finish({error:{code:'40001'}}); await pending;
  assert.match(textOf(root),/다른 화면에서 이 정보가 바뀌었습니다/);
});
test('page navigation requests records beyond the first 100 without changing other products',async()=>{
  const calls=[];
  const {root,admin}=setup(async(name,args)=>{calls.push({name,args});return {data:{...copy,totals:{applications:101,students:0}}};});
  await admin.load();
  await findButton(root,'다음 100건').events.click();
  assert.equal(calls[1].name,'academy_api');
  assert.equal(calls[1].args.payload.offset,100);
  assert.ok(findButton(root,'이전 100건'));
  assert.equal(findButton(root,'다음 100건'),undefined);
});
test('an authenticated academy administrator loads data without an app MFA flow',async()=>{
  let requested=false;
  const {root,admin}=setup(async()=>{requested=true;return {data:copy};});
  await admin.load();
  assert.equal(requested,true);
  assert.match(textOf(root),/승인 대기 신청이 없습니다/);
  assert.doesNotMatch(textOf(root),/2단계 인증|인증 앱|QR 코드/);
  assert.doesNotMatch(source,/auth[.]mfa|aal2|academy_mfa_required/);
});
test('academy work uses one screen without inner tabs and keeps a compact overview',async()=>{
  const {root,admin}=setup(async()=>({data:copy}));
  await admin.load();
  assert.equal(findButton(root,'수강생'),undefined);
  assert.equal(findButton(root,'명단 관리'),undefined);
  assert.equal(findButton(root,'변경 기록'),undefined);
  assert.equal(root.querySelectorAll('button').filter(node=>node.attrs.role==='tab').length,0);
  assert.match(textOf(root),/현재 입장 가능한 기수\s+0개\s+현재 명단\s+0명\s+가입 승인 대기\s+0명\s+등록 수강생\s+0명/);
  // ★카드는 일이 일어나는 순서다: 준비(기수 관리 + 수강 명단 관리) -> 요약 -> 대기 -> 수강생.
  //   예전에는 명단 관리가 맨 위, 기수 관리가 맨 아래여서 흐름이 거꾸로였다 (사용자 2026-09-14).
  assert.match(textOf(root),/기수 관리.*수강 명단 관리.*가입 승인 대기 \(0\).*수강생 관리 \(0\)/);
});
test('direct roster entry is the first academy work card and keeps account approval separate',async()=>{
  const calls=[];
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,cohorts:[cohort]}};
    return {data:{ok:true}};
  });
  await admin.load();
  const content=root.querySelectorAll('div').find(node=>node.className==='academy-view');
  // 준비 두 카드는 좌(기수 관리)·우(수강 명단 관리) 한 묶음이다.
  const prep=content.children[0];
  assert.equal(prep.className,'academy-setup');
  assert.equal(prep.children.length,2);
  assert.match(textOf(prep.children[0]),/기수 관리/);
  assert.match(textOf(prep.children[1]),/수강 명단 관리.*수강생 추가.*가입할 때 같은 정보로 자동 확인/);
  assert.match(textOf(content.children[1]),/현재 입장 가능한 기수/);

  const direct=prep.children[1];
  const select=direct.querySelectorAll('select')[0]; select.value='1'; select.selectedOptions=[{textContent:'유유스 1기'}];
  const inputs=direct.querySelectorAll('input');
  inputs.find(node=>node.placeholder==='수강생 이름').value='테스트 학생';
  inputs.find(node=>node.placeholder==='아는 경우에만').value='Test.Student+academy';
  inputs.find(node=>node.placeholder==='끝 4자리').value='1234';
  await findButton(direct,'수강 명단에 추가').events.click();
  assert.equal(calls[1].action,'roster_add');
  assert.equal(calls[1].payload.gmail_local_id,'test.student+academy');
  assert.equal(calls[1].payload.cohort_id,1);
  assert.equal(calls[1].payload.source_reference,'');
  assert.equal(calls[1].payload.reason,'관리자 화면에서 수강 명단 등록');
  assert.doesNotMatch(textOf(direct),/등록 사유/);
  // ★기수는 **왼쪽 기수 관리에서만** 고른다 — 같은 기수를 두 군데서 고르던 드롭다운은 없앴다
  //   (사용자 2026-09-14). 새 명단을 저장하면 그 기수로 자동 전환되는 계약은 그대로다.
  assert.equal(root.querySelectorAll('select').filter(node=>node.attrs['aria-label']==='등록 명단 기수 선택').length,0);
  const picked=root.querySelectorAll('button').find(node=>node.attrs['aria-pressed']==='true');
  assert.match(picked.attrs['aria-label'],/유유스 1기 명단 접기/);
  assert.doesNotMatch(textOf(direct),/외부 참조|주문\/신청 번호/);
});
test('a roster row can be added without a Gmail — name + last four + cohort is the key',async()=>{
  // ★형님은 수강생의 Gmail 을 미리 알 수 없다. 본인이 가입할 때 넣기 때문이다 (2026-09-14).
  //   그래서 Gmail 은 선택이고, 비우면 서버가 이름+끝 4자리+기수로 맞춘다.
  const calls=[];
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,cohorts:[cohort]}};
    return {data:{ok:true}};
  });
  await admin.load();
  const direct=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-direct-add'));
  const select=direct.querySelectorAll('select')[0]; select.value='1'; select.selectedOptions=[{textContent:'유유스 1기'}];
  const inputs=direct.querySelectorAll('input');
  inputs.find(node=>node.placeholder==='수강생 이름').value='김미가입';
  inputs.find(node=>node.placeholder==='끝 4자리').value='0402';
  // Gmail 칸은 손대지 않는다.
  await findButton(direct,'수강 명단에 추가').events.click();
  const add=calls.find(c=>c.action==='roster_add');
  assert.ok(add,'Gmail 을 비웠다고 막히면 안 된다');
  assert.equal(add.payload.gmail_local_id,'');
  assert.equal(add.payload.display_name,'김미가입');
  assert.equal(add.payload.phone_last_four,'0402');
  assert.equal(add.payload.cohort_id,1);
});
test('the Excel roster reads name, last four and cohort — and says what it will skip',()=>{
  // 엑셀이 0402 를 숫자 402 로 저장한다. 전화번호를 통째로 적어도 뒤 4자리만 쓴다.
  const cohorts=[{id:7,cohort_number:2,name:'유유스 2기',status:'active'},
                 {id:8,cohort_number:9,name:'유유스 9기',status:'archived'}];
  assert.match(source,/const ROSTER_COLUMNS = \['이름', '휴대폰 끝 4자리', '기수'\]/);
  const parse=new Function('cohorts','row',
    source.slice(source.indexOf('function parseRosterRow'),source.indexOf('async function bulkRosterAdd'))
    + 'return parseRosterRow(row, cohorts);');
  const ok=parse(cohorts,{'이름':'홍 길동','휴대폰 끝 4자리':402,'기수':'유유스 2기'});
  assert.equal(ok.problem,'');
  assert.equal(ok.phone_last_four,'0402','엑셀이 0 을 떼어먹어도 4자리로 되돌린다');
  assert.equal(ok.cohort_id,7);
  assert.equal(parse(cohorts,{'이름':'홍길동','휴대폰':'010-1234-5678','기수':'2기'}).phone_last_four,'5678');
  assert.equal(parse(cohorts,{'이름':'홍길동','휴대폰 끝 4자리':'0402','기수':'2기'}).cohort_id,7,'「2기」로 적어도 찾는다');
  assert.match(parse(cohorts,{'이름':'홍길동','휴대폰 끝 4자리':'0402','기수':'유유스 3기'}).problem,/찾지 못했습니다/);
  assert.match(parse(cohorts,{'이름':'홍길동','휴대폰 끝 4자리':'0402','기수':'유유스 9기'}).problem,/명단을 받지 않습니다/);
  assert.match(parse(cohorts,{'이름':'','휴대폰 끝 4자리':'0402','기수':'2기'}).problem,/이름이 비었습니다/);
});
test('direct roster add omits the unnecessary reason field but still sends an audit reason',async()=>{
  const calls=[];
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,cohorts:[cohort]}};
    return {data:{ok:true}};
  });
  await admin.load();
  const direct=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-direct-add'));
  const select=direct.querySelectorAll('select')[0]; select.value='1'; select.selectedOptions=[{textContent:'유유스 1기'}];
  const inputs=direct.querySelectorAll('input');
  inputs.find(node=>node.placeholder==='수강생 이름').value='시험학생';
  inputs.find(node=>node.placeholder==='끝 4자리').value='0402';
  await findButton(direct,'수강 명단에 추가').events.click();
  assert.equal(calls.filter(c=>c.action==='roster_add').length,1);
  assert.equal(calls.find(c=>c.action==='roster_add').payload.reason,'관리자 화면에서 수강 명단 등록');
  assert.doesNotMatch(textOf(direct),/등록 사유/);
});
test('only a cancelled roster row that never had an account can be deleted, and the reason is required',async()=>{
  // ★사용자 2026-09-14: 「취소된 명단도 삭제도 안되고」. 지울 수 있는 것은 취소된 줄 중
  //   계정과 연결된 적 없는 줄뿐이다 — 연결된 적 있는 줄은 수강 기록과 이어져 있다.
  const calls=[];
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const roster=[
    {id:31,cohort_id:1,revision:4,display_name:'지울 학생',canonical_gmail:null,phone_last_four:'3131',cohort_name:'유유스 1기',status:'cancelled',bound_user_id:null,source_reference:''},
    {id:32,cohort_id:1,revision:2,display_name:'남길 학생',canonical_gmail:'keep@gmail.com',phone_last_four:'3232',cohort_name:'유유스 1기',status:'cancelled',bound_user_id:'u-keep',source_reference:''},
    {id:33,cohort_id:1,revision:1,display_name:'현재 학생',canonical_gmail:null,phone_last_four:'3333',cohort_name:'유유스 1기',status:'eligible',bound_user_id:null,source_reference:''}
  ];
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,cohorts:[cohort],roster,totals:{applications:0,students:0,roster:3}}};
    return {data:{ok:true}};
  });
  await admin.load();
  const list=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-roster-management'));
  const rowOf=name=>list.querySelectorAll('tr').find(node=>String(node.className)==='academy-roster-record'&&textOf(node).includes(name));
  assert.ok(findButton(rowOf('지울 학생'),'삭제'),'취소됐고 연결된 적 없는 줄에는 삭제가 있다');
  assert.equal(findButton(rowOf('남길 학생'),'삭제'),undefined,'연결된 적 있는 줄은 지우지 않는다');
  assert.equal(findButton(rowOf('현재 학생'),'삭제'),undefined,'쓰고 있는 명단은 먼저 취소해야 한다');

  findButton(rowOf('지울 학생'),'삭제').events.click();
  assert.equal(findButton(rowOf('지울 학생'),'삭제').attrs['aria-expanded'],'true');
  // 사유를 비우면 보내지 않고, 까닭을 **그 판 안에서** 칸 이름 그대로 말한다.
  await findButton(list,'영구 삭제').events.click();
  assert.equal(calls.filter(c=>c.action==='roster_delete').length,0);
  // 한 표 안에 수정·취소·삭제 사유 칸이 여럿이다 — 삭제 판을 id 로 집는다.
  const panel=list.querySelectorAll('div').find(node=>node.id==='academy-roster-delete-31');
  assert.equal(panel.hidden,false,'삭제 판이 열려 있어야 한다');
  const stop=panel.querySelectorAll('p').find(node=>String(node.className).includes('academy-add-stop'));
  assert.ok(stop,'까닭이 판 안에 보여야 한다 — 맨 위 문구만으로는 못 본다');
  assert.equal(stop.textContent,'삭제 사유를 입력해주세요.');
  panel.querySelectorAll('input')[0].value='잘못 넣은 명단';
  await findButton(list,'영구 삭제').events.click();
  const sent=calls.filter(c=>c.action==='roster_delete');
  assert.equal(sent.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].payload)),{roster_entry_id:31,revision:4,reason:'잘못 넣은 명단'});
});
test('server refusals for deletion and not-yet-applied actions read as plain Korean',()=>{
  const start=source.indexOf('const errorMessage = (error) => {');
  const end=source.indexOf('};',start)+2;
  const errorMessage=new Function(source.slice(start,end)+' return errorMessage;')();
  assert.match(errorMessage({message:'academy_roster_not_deletable',code:'22023'}),/지울 수 없습니다/);
  assert.match(errorMessage({message:'academy_unknown_action',code:'22023'}),/서버에 아직 적용되지 않았습니다/);
});
test('current roster stays prominent while cancelled and internal reference records stay secondary',async()=>{
  const roster=[
    {id:2,revision:1,user_id:null,display_name:'현재 학생',canonical_gmail:'current@gmail.com',phone_last_four:'0402',cohort_name:'유유스 1기',status:'eligible',source_reference:'INTERNAL-CURRENT'},
    {id:1,revision:2,user_id:null,display_name:'지난 테스트',canonical_gmail:'old@gmail.com',phone_last_four:'0000',cohort_name:'유유스 1기',status:'cancelled',source_reference:'INTERNAL-OLD'}
  ];
  const {root,admin}=setup(async()=>({data:{...copy,roster,totals:{applications:0,students:0,roster:2}}}));
  await admin.load();
  const management=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-roster-card'));
  assert.match(textOf(management),/등록 명단.*1명.*현재 학생.*가입 전.*취소된 명단.*1건/);
  assert.doesNotMatch(textOf(management),/INTERNAL-CURRENT|INTERNAL-OLD|외부 참조 번호/);
  assert.match(textOf(root),/현재 명단\s+1명/);
});
test('a bound roster row points to student management instead of exposing invalid roster edits',async()=>{
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1};
  const bound={id:2,cohort_id:1,revision:2,user_id:'student',display_name:'연결 학생',canonical_gmail:'bound@gmail.com',phone_last_four:'1002',cohort_name:'유유스 1기',status:'bound',source_reference:''};
  const {root,admin}=setup(async()=>({data:{...copy,cohorts:[cohort],roster:[bound],totals:{applications:0,students:1,roster:1}}}));
  await admin.load();
  const record=root.querySelectorAll('tr').find(node=>textOf(node).includes('bound@gmail.com'));
  assert.match(textOf(record),/계정 연결됨.*수강생 관리에서 변경/);
  assert.equal(findButton(record,'수정'),undefined);
  assert.equal(findButton(record,'취소'),undefined);
});
test('roster cohort filter stays beside the list and each row owns its edit and cancel actions',async()=>{
  const calls=[];
  const cohorts=[
    {id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1},
    {id:2,cohort_number:2,name:'유유스 2기',slug:'2gi',status:'draft',revision:1}
  ];
  const roster=[
    {id:11,cohort_id:1,revision:1,user_id:null,display_name:'첫 학생',canonical_gmail:'first@gmail.com',phone_last_four:'1111',cohort_name:'유유스 1기',status:'eligible',source_reference:''},
    {id:22,cohort_id:2,revision:3,user_id:null,display_name:'둘 학생',canonical_gmail:'second@gmail.com',phone_last_four:'2222',cohort_name:'유유스 2기',status:'eligible',source_reference:''}
  ];
  const snapshot={...copy,cohorts,roster,totals:{applications:0,students:0,roster:2}};
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    return args.action==='admin_snapshot' ? {data:snapshot} : {data:{ok:true}};
  });
  await admin.load();
  // 왼쪽 기수 카드가 인원을 들고 있고, 누르면 오른쪽 명단이 그 기수만 보인다.
  const pickButtons=()=>root.querySelectorAll('button').filter(node=>/명단 (보기|접기)$/.test(String(node.attrs['aria-label']||'')));
  assert.deepEqual(pickButtons().map(node=>node.textContent),['1명 · 명단 보기','1명 · 명단 보기']);
  const listOf=()=>root.querySelectorAll('section').find(node=>String(node.className).includes('academy-roster-management'));
  assert.match(textOf(listOf()),/second@gmail\.com/);
  await pickButtons()[0].events.click();
  assert.match(textOf(listOf()),/등록 명단 · 유유스 1기/);
  assert.doesNotMatch(textOf(listOf()),/second@gmail\.com/,'고른 기수만 보인다');
  await pickButtons()[0].events.click();
  assert.match(textOf(listOf()),/second@gmail\.com/,'다시 누르면 전체로 돌아온다');
  // 유유스 2기만 보이게 고른다 — 기수는 왼쪽 단추로만 고른다.
  await pickButtons()[1].events.click();
  const rosterRows=()=>listOf().querySelectorAll('tr').filter(node=>String(node.className)==='academy-roster-record');
  assert.equal(rosterRows().length,1);
  assert.match(textOf(rosterRows()[0]),/둘 학생.*유유스 2기/);
  assert.doesNotMatch(textOf(listOf()),/첫 학생/);

  // ★수정 입력은 그 줄 **바로 아래 칸**에서 열린다 — 줄 자체는 한 줄로 남는다.
  findButton(listOf(),'수정').events.click();
  assert.equal(findButton(listOf(),'수정').attrs['aria-expanded'],'true');
  const editInputs=listOf().querySelectorAll('input');
  editInputs.find(node=>node.value==='둘 학생').value='둘째 학생';
  editInputs.find(node=>node.value==='second').value='Second.Updated';
  editInputs.find(node=>node.value==='2222').value='2323';
  // 한 구역 안에 수정 사유와 취소 사유가 둘 다 있다 — 수정은 **첫 번째**다.
  editInputs.find(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').value='연락처 확인';
  await findButton(listOf(),'수정 내용 저장').events.click();
  assert.equal(calls[1].action,'roster_update');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)),{roster_entry_id:22,revision:3,display_name:'둘째 학생',gmail_local_id:'second.updated',phone_last_four:'2323',source_reference:'',reason:'연락처 확인'});

  findButton(listOf(),'취소').events.click();
  listOf().querySelectorAll('input').filter(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').at(-1).value='등록 오류';
  await findButton(listOf(),'명단 취소하기').events.click();
  assert.equal(calls[3].action,'roster_cancel');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[3].payload)),{roster_entry_id:22,revision:3,reason:'등록 오류'});
});
test('sorting stays inside student management and the page-wide search toolbar is absent',async()=>{
  const students=[
    {user_id:'b',revision:1,display_name:'나 학생',canonical_gmail:'beta@gmail.com',phone_last_four:'2222',status:'suspended',cohort_name:'유유스 2기',roster_options:[]},
    {user_id:'a',revision:1,display_name:'가 학생',canonical_gmail:'alpha@gmail.com',phone_last_four:'1111',status:'active',cohort_name:'유유스 1기',roster_options:[]}
  ];
  const {root,admin}=setup(async()=>({data:{...copy,students,totals:{applications:0,students:2,roster:0}}}));
  await admin.load();
  assert.doesNotMatch(textOf(root),/현재 페이지 목록 찾기|현재 페이지 관리 목록 검색|검색 지우기/);
  const studentSection=root.querySelectorAll('section').find(node=>textOf(node).includes('수강생 관리 (2)'));
  assert.doesNotMatch(textOf(studentSection),/수강생 정렬/);
  // ★한 사람은 한 줄이고 칸 순서는 아이디 · 이름 · 끝 4자리 · 기수 · 상태 다 (사용자 2026-09-14).
  //   예전엔 이름만 든 h4 를 읽었다 — 세 줄로 쌓여 있어 그게 가능했다.
  // ★한 사람은 한 줄이고, 앞 네 칸 순서는 이메일 · 성함 · 끝 4자리 · 기수 다 (사용자 2026-09-14).
  //   예전엔 카드 + 접기 둘이라 한 사람이 세 덩이였다 — 이름만 든 h4 를 읽는 것이 그래서 가능했다.
  const rows=()=>studentSection.querySelectorAll('tr').filter(node=>String(node.className)==='academy-row');
  const lines=()=>rows().map(node=>node.children.slice(0,5).map(c=>textOf(c).trim()).join(' · '));
  const 가='alpha@gmail.com · 가 학생 · 1111 · 유유스 1기 · 이용 가능';
  const 나='beta@gmail.com · 나 학생 · 2222 · 유유스 2기 · 이용 정지';
  assert.deepEqual(studentSection.querySelectorAll('th').map(node=>textOf(node).trim()).slice(0,5),
    ['이메일 ⇅','성함 ⇅','끝 4자리 ⇅','기수 ⇅','상태 ⇅']);
  const draft=rows()[0].querySelectorAll('input')[0];
  draft.value='정렬 뒤에도 유지할 사유';
  await findButton(studentSection,'성함 ⇅').events.click();
  assert.deepEqual(lines(),[가,나]);
  await findButton(studentSection,'성함 ▲').events.click();
  assert.deepEqual(lines(),[나,가]);
  assert.equal(rows()[0].querySelectorAll('input')[0],draft);
  assert.equal(draft.value,'정렬 뒤에도 유지할 사유');
  // 한 사람은 <tr> 하나다 — 카드나 접기가 다시 생기면 여기서 걸린다.
  assert.equal(rows().length,2);
  assert.equal(studentSection.querySelectorAll('article').length,0,'수강생을 카드로 되돌리면 안 된다');
  assert.doesNotMatch(textOf(root),/선택 승인|선택 정지|일괄 승인/);
});
test('academy account rows edit role and profile in one modal without changing the Gmail identity',async()=>{
  const calls=[];
  const accounts=[
    {user_id:'admin-id',revision:2,display_name:'검증 관리자',canonical_gmail:'admin.check@gmail.com',phone_last_four:null,role:'admin',account_active:true,cohort_id:null,cohort_name:null,roster_options:[]},
    {user_id:'student-id',revision:4,display_name:'검증 수강생',canonical_gmail:'student.check@gmail.com',phone_last_four:'0402',role:'student',account_active:true,cohort_id:1,cohort_name:'1기',roster_options:[]}
  ];
  const snapshot={...copy,accounts,cohorts:[{id:1,name:'1기',status:'active'}],totals:{accounts:2,applications:0,students:1,roster:1}};
  const {root,admin}=setup(async(_name,args)=>{calls.push(args); return args.action==='admin_snapshot'?{data:snapshot}:{data:{ok:true}};},null);
  await admin.load();
  const section=root.querySelectorAll('section').find(node=>textOf(node).includes('수강생 계정 관리 (2)'));
  assert.deepEqual(section.querySelectorAll('th').map(node=>textOf(node).trim()),['','이메일 ⇅','성함 ⇅','끝 4자리 ⇅','기수 ⇅','역할 ⇅','상태 ⇅','관리']);
  assert.match(textOf(section),/admin[.]check@gmail[.]com.*관리자.*student[.]check@gmail[.]com.*수강생/);
  assert.doesNotMatch(textOf(section),/기수 변경/);
  const studentRow=section.querySelectorAll('tr').find(node=>textOf(node).includes('student.check@gmail.com'));
  findButton(studentRow,'수정').events.click();
  const dialog=root.querySelectorAll('dialog')[0];
  assert.match(textOf(dialog),/Gmail 주소와 비밀번호는 바꾸지 않습니다/);
  const inputs=dialog.querySelectorAll('input');
  const email=inputs.find(node=>node.type==='email');
  assert.equal(email.value,'student.check@gmail.com'); assert.equal(email.readOnly,true);
  inputs.find(node=>node.value==='검증 수강생').value='검증 코치';
  inputs.find(node=>node.value==='0402').value='0402';
  inputs.find(node=>node.placeholder==='예: 본인 요청으로 정보 정정').value='코치 배정';
  const role=dialog.querySelectorAll('select')[0]; role.value='coach'; role.events.change();
  const cohort=dialog.querySelectorAll('select')[1]; cohort.value='1';
  await findButton(dialog,'저장').events.click();
  assert.equal(calls[1].action,'account_update');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)),{
    user_id:'student-id',revision:4,display_name:'검증 코치',phone_last_four:'0402',role:'coach',reason:'코치 배정',cohort_id:1
  });
});
test('academy account rows have left-side selection and one atomic bulk change command',async()=>{
  const calls=[];
  const accounts=[
    {user_id:'student-a',revision:4,display_name:'가 학생',canonical_gmail:'a.student@gmail.com',phone_last_four:'1111',role:'student',account_active:true,cohort_name:'1기',can_be_student:true,roster_options:[]},
    {user_id:'student-b',revision:7,display_name:'나 학생',canonical_gmail:'b.student@gmail.com',phone_last_four:'2222',role:'student',account_active:true,cohort_name:'1기',can_be_student:true,roster_options:[]}
  ];
  const snapshot={...copy,accounts,cohorts:[{id:1,name:'1기',status:'active'},{id:2,name:'2기',status:'active'}],totals:{accounts:2,applications:0,students:2,roster:2}};
  const {root,admin}=setup(async(_name,args)=>{calls.push(args);return args.action==='admin_snapshot'?{data:snapshot}:{data:{ok:true}};},null);
  await admin.load();
  const section=root.querySelectorAll('section').find(node=>textOf(node).includes('수강생 계정 관리 (2)'));
  const selectAll=section.querySelectorAll('input').find(node=>node.attrs['aria-label']==='현재 페이지 전체 선택');
  assert.ok(selectAll);
  assert.equal(section.querySelectorAll('input').filter(node=>String(node.attrs['aria-label']).endsWith('계정 선택')).length,2);
  selectAll.checked=true; selectAll.events.change();
  assert.match(textOf(section),/2명 선택/);
  await findButton(section,'성함 ⇅').events.click();
  await findButton(section,'성함 ▲').events.click();
  const sorted=section.querySelectorAll('tr').filter(node=>node.className==='academy-row');
  assert.deepEqual(sorted.map(row=>row.children[2].textContent),['나 학생','가 학생']);
  assert.ok(sorted.every(row=>row.children[0].children[0].checked),'정렬 뒤 선택 유지');
  assert.equal(section.querySelectorAll('th')[2].attrs['aria-sort'],'descending');
  assert.equal(calls.length,1,'정렬은 DB 쓰기를 발생시키지 않는다');
  const role=section.querySelectorAll('select').find(node=>node.attrs['aria-label']==='선택 계정 역할 변경');
  const cohort=section.querySelectorAll('select').find(node=>node.attrs['aria-label']==='선택 코치 담당 기수');
  const status=section.querySelectorAll('select').find(node=>node.attrs['aria-label']==='선택 계정 이용 상태 변경');
  role.value='coach'; role.events.change(); cohort.value='2'; status.value='suspended';
  const pending=findButton(section,'일괄 적용').events.click();
  findButton(root,'확인하고 적용').events.click();
  await pending;
  assert.equal(calls[1].action,'account_bulk_update');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)),{
    accounts:[{user_id:'student-a',revision:4},{user_id:'student-b',revision:7}],
    role:'coach',cohort_id:2,status:'suspended',reason:'관리자 화면에서 선택 계정 일괄 변경'
  });
});
test('academy account actions expose edit, suspend and Academy-only delete with confirmation',async()=>{
  const calls=[];
  const account={user_id:'student-id',revision:4,display_name:'검증 수강생',canonical_gmail:'student.check@gmail.com',phone_last_four:'0402',role:'student',account_active:true,cohort_name:'1기',roster_options:[]};
  const snapshot={...copy,accounts:[account],cohorts:[{id:1,name:'1기',status:'active'}],totals:{accounts:1,applications:0,students:1,roster:1}};
  const {root,admin}=setup(async(_name,args)=>{calls.push(args);return args.action==='admin_snapshot'?{data:snapshot}:{data:{ok:true}};},null);
  await admin.load();
  const section=root.querySelectorAll('section').find(node=>textOf(node).includes('수강생 계정 관리 (1)'));
  assert.ok(findButton(section,'수정')); assert.ok(findButton(section,'이용 정지')); assert.ok(findButton(section,'삭제'));
  const pending=findButton(section,'삭제').events.click();
  const dialog=root.querySelectorAll('dialog')[0];
  assert.match(textOf(dialog),/Gmail 계정과 다른 서비스 권한은 유지됩니다/);
  findButton(dialog,'확인하고 적용').events.click();
  await pending;
  assert.equal(calls[1].action,'account_delete');
  assert.equal(calls[1].payload.user_id,'student-id');
});
test('roster and cohort management use separate clear cards while cohort access stays explicit',async()=>{
  const snapshot={...copy,cohorts:[
    {id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:3,starts_on:null,ends_on:null},
    {id:2,cohort_number:2,name:'유유스 2기',slug:'2gi',status:'draft',revision:1,starts_on:null,ends_on:null},
    {id:3,cohort_number:3,name:'유유스 3기',slug:'3gi',status:'active',revision:1,starts_on:'9999-01-01',ends_on:null},
    {id:4,cohort_number:4,name:'유유스 4기',slug:'4gi',status:'active',revision:1,starts_on:null,ends_on:'2000-01-01'}
  ]};
  const {root,admin}=setup(async()=>({data:snapshot}));
  await admin.load();
  const roster=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-roster-card'));
  const cohorts=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-cohort-management'));
  assert.ok(roster); assert.ok(cohorts);
  assert.doesNotMatch(textOf(roster),/기수 관리|주소 코드|참조 번호/);
  assert.match(textOf(cohorts),/기수 관리.*수강생 입장 열림.*수강생 입장 닫힘.*수강생 입장 예정.*수강생 입장 기간 종료/);
  assert.match(textOf(cohorts),/운영 기간/);
  assert.match(textOf(cohorts),/0명 · 명단 보기/);
  const cohortCard=cohorts.querySelectorAll('article')[0];
  const period=cohortCard.querySelectorAll('div').find(node=>String(node.className).includes('academy-meta-with-action'));
  assert.match(textOf(period),/운영 기간.*0명 · 명단 보기/);
  assert.doesNotMatch(textOf(cohorts),/주소 코드|1기 · 유유스 1기/);
  assert.ok(findButton(cohorts,'입장 닫기'));
  assert.ok(findButton(cohorts,'입장 열기'));
  assert.doesNotMatch(textOf(cohorts),/운영 상태|명단 접수|보관/);
});
test('cohort badges use server totals instead of undercounting the visible roster page',async()=>{
  const snapshot={...copy,cohorts:[
    {id:1,cohort_number:1,name:'유유스 1기',status:'active',revision:1,roster_count:125}
  ],roster:[{id:1,cohort_id:1,display_name:'현재 화면 한 명',canonical_gmail:null,phone_last_four:'1000',cohort_name:'유유스 1기',status:'eligible',revision:1}]};
  const {root,admin}=setup(async()=>({data:snapshot}));
  await admin.load();
  assert.ok(findButton(root,'125명 · 명단 보기'));
  assert.equal(findButton(root,'1명 · 명단 보기'),undefined);
});
test('an empty roster explains the next action and returns focus to direct entry',async()=>{
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const {root,admin}=setup(async()=>({data:{...copy,cohorts:[cohort]}}));
  await admin.load();
  assert.match(textOf(root),/현재 사용할 수강 명단이 없습니다.*위 수강생 추가/);
  const directSelect=root.querySelectorAll('select').find(node=>node.children.some(option=>option.textContent==='유유스 1기'));
  await findButton(root,'수강생 추가로 이동').events.click();
  assert.equal(directSelect.focused,true);
});
test('cohort creation generates its internal address code and rejects reversed dates',async()=>{
  const calls=[];
  const {root,admin}=setup(async(_name,args)=>{calls.push(args);return {data:copy};});
  await admin.load();
  const create=root.querySelectorAll('details').find(node=>textOf(node).includes('새 기수 추가'));
  const inputs=create.querySelectorAll('input');
  inputs.find(node=>node.placeholder==='예: 2').value='3';
  inputs.find(node=>node.placeholder==='예: 유유스 2기').value='유유스 3기';
  const dates=inputs.filter(node=>node.type==='date');
  dates[0].value='2026-10-02'; dates[1].value='2026-10-01';
  await findButton(create,'새 기수 등록').events.click();
  assert.equal(calls.length,1);
  assert.match(textOf(root),/종료일은 시작일보다 빠를 수 없습니다/);
});
test('new cohorts start closed and cohort access buttons keep revision and reason',async()=>{
  const calls=[];
  const draft={id:2,cohort_number:2,name:'유유스 2기',slug:'2gi',status:'draft',revision:4,starts_on:null,ends_on:null};
  const {root,admin}=setup(async(_name,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,cohorts:[draft]}};
    return {data:{ok:true}};
  });
  await admin.load();
  const create=root.querySelectorAll('details').find(node=>textOf(node).includes('새 기수 추가'));
  create.querySelectorAll('input').find(node=>node.placeholder==='예: 2').value='3';
  create.querySelectorAll('input').find(node=>node.placeholder==='예: 유유스 2기').value='유유스 3기';
  create.querySelectorAll('input').find(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').value='3기 준비';
  await findButton(create,'새 기수 등록').events.click();
  assert.equal(calls[1].action,'cohort_create');
  assert.equal(calls[1].payload.status,'draft');
  assert.equal(calls[1].payload.slug,'3gi');

  const cohortRecord=root.querySelectorAll('article').find(node=>textOf(node).includes('유유스 2기'));
  cohortRecord.querySelectorAll('input').find(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').value='개강 확인';
  await findButton(cohortRecord,'입장 열기').events.click();
  assert.equal(calls[3].action,'cohort_set_status');
  assert.equal(calls[3].payload.status,'active');
  assert.equal(calls[3].payload.revision,4);
  assert.equal(calls[3].payload.reason,'개강 확인');
});
test('recent audit entries appear only on the related account',async()=>{
  const students=[
    {user_id:'student-a',revision:1,display_name:'학생 가',canonical_gmail:'studenta@gmail.com',phone_last_four:'0001',status:'active'},
    {user_id:'student-b',revision:1,display_name:'학생 나',canonical_gmail:'studentb@gmail.com',phone_last_four:'0002',status:'active'}
  ];
  const audit=[
    {subject_id:'student-a',action:'set_status',created_at:'2026-09-10T01:00:00Z',detail:{reason:'이용 재개'}},
    {subject_id:'student-a',action:'application_auto_approved',created_at:'2026-09-10T00:30:00Z',detail:{}},
    {subject_id:'student-b',action:'assign',created_at:'2026-09-10T02:00:00Z',detail:{reason:'2기 배정'}}
  ];
  const {root,admin}=setup(async()=>({data:{...copy,students,audit}}));
  await admin.load();
  const first=root.querySelectorAll('tr').find(node=>textOf(node).includes('studenta@gmail.com'));
  const second=root.querySelectorAll('tr').find(node=>textOf(node).includes('studentb@gmail.com'));
  // 「계정 관리」 접기는 없앴다 — 단추가 그 줄에 바로 선다.
  // 단추 이름은 다른 탭과 같은 두 글자, 뜻은 title·aria-label 에 온전히 남는다.
  assert.equal(findButton(first,'정지').title,'학생 가 학생 이용 정지로 변경');
  assert.equal(findButton(first,'해지').attrs['aria-label'],'학생 가 학생 이용 해지로 변경');
  assert.doesNotMatch(textOf(first),/계정 관리/);
  assert.match(textOf(first),/최근 이력\s+2건.*이용 상태 변경.*이용 재개.*명단 자동 확인/);
  assert.doesNotMatch(textOf(first),/2기 배정/);
  assert.match(textOf(second),/변경.*2기 배정/);
  assert.equal(findButton(second,'변경').title,'학생 나 학생의 현재 기수 변경');
  assert.doesNotMatch(textOf(second),/이용 재개/);
});
test('one shared pagination advances all visible academy lists by 100',async()=>{
  const calls=[];
  const snapshot={...copy,totals:{applications:3,students:20,roster:250}};
  const {root,admin}=setup(async(_name,args)=>{calls.push(args);return {data:snapshot};});
  await admin.load();
  assert.ok(findButton(root,'다음 100건'));
  findButton(root,'다음 100건').events.click();
  await new Promise(done=>setImmediate(done));
  assert.equal(calls.at(-1).payload.offset,100);
  assert.ok(findButton(root,'이전 100건'));
});
test('the client displays at most 100 roster rows to match its pagination step',async()=>{
  const roster=Array.from({length:150},(_,index)=>({id:index+1,revision:1,user_id:null,display_name:`학생 ${index+1}`,canonical_gmail:`student${index+1}@gmail.com`,phone_last_four:'0000',cohort_name:'유유스 1기',status:'eligible',source_reference:''}));
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const {root,admin}=setup(async()=>({data:{...copy,cohorts:[cohort],roster,totals:{applications:0,students:0,roster:150}}}));
  await admin.load();
  const management=root.querySelectorAll('section').find(node=>String(node.className).includes('academy-roster-card'));
  const rosterRecords=management.querySelectorAll('tr').filter(node=>String(node.className)==='academy-roster-record');
  assert.equal(rosterRecords.length,100);
  // 100명이어도 화면이 아래로 늘어나지 않는다 — 표 안에서 세로로 구른다.
  const scroll=management.querySelectorAll('div').find(node=>String(node.className).includes('academy-roster-scroll'));
  assert.ok(scroll,'명단은 스크롤 상자 안에 있어야 한다');
  assert.match(css,/\.academy-admin \.academy-roster-scroll \{ max-height: 420px; overflow-y: auto;/);
  assert.match(css,/\.academy-admin \.academy-roster-table thead th \{ position: sticky;/);
  assert.match(textOf(management),/100명 표시/);
});
test('a later page keeps its previous-page escape when totals shrink',async()=>{
  const snapshot={...copy,totals:{applications:0,students:0,roster:100}};
  const {root,admin}=setup(async()=>({data:snapshot}));
  await admin.load();
  await admin.load(undefined,100);
  assert.ok(findButton(root,'이전 100건'));
  assert.equal(findButton(root,'다음 100건'),undefined);
});
