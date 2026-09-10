const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../academy-admin.js'),'utf8');

class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.attrs={}; this.events={}; this.textContent=''; this.value=''; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(k,v) { this.attrs[k]=v; }
  addEventListener(k,v) { this.events[k]=v; }
  focus() { if (!this.disabled) this.focused=true; }
  querySelectorAll(selector) {
    const tags=selector.split(',').map(x=>x.trim());
    return this.children.flatMap(c=>[...(tags.includes(c.tagName)?[c]:[]),...c.querySelectorAll(selector)]);
  }
}
const copy = {version:2,applications:[],students:[],cohorts:[],roster:[],audit:[]};
function setup(rpc,confirm=()=>true,timers={setTimeout,clearTimeout}) {
  const root=new Element('section');
  const window={confirm};
  vm.runInNewContext(source,{window,AbortController,...timers,document:{createElement:tag=>new Element(tag)}});
  return {root,admin:window.createAcademyAdmin({rpc},root)};
}
const textOf = node => [node.textContent,...node.children.map(textOf)].join(' ');
const findButton = (root,text)=>root.querySelectorAll('button').find(n=>n.textContent===text);

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
test('approval requires an explicit cohort, reason, confirmation and revision; double clicks are blocked',async()=>{
  const calls=[];
  let finish;
  const row={user_id:'fixture-id',revision:7,display_name:'예시 학생',canonical_gmail:'example@gmail.com',phone_last_four:'0000',roster_matches:[{id:12,cohort_id:2,cohort_name:'2기',display_name:'예시 학생',canonical_gmail:'example@gmail.com',phone_last_four:'0000',status:'eligible'}]};
  const {root,admin}=setup(async(_rpc,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,applications:[row],cohorts:[{id:2,cohort_number:2,name:'2기',slug:'2gi',status:'active',revision:1}]}};
    return new Promise(resolve=>{finish=resolve;});
  });
  await admin.load();
  const approve=findButton(root,'승인하고 기수 배정');
  await approve.events.click();
  assert.equal(calls.length,1);
  const select=root.querySelectorAll('select').find(node=>node.children.some(option=>String(option.textContent).includes('example@gmail.com')));
  select.value='12';select.selectedOptions=[{textContent:'2기 · 예시 학생 · example@gmail.com'}];
  await approve.events.click(); assert.equal(calls.length,1);
  const applicationRecord=root.querySelectorAll('article').find(node=>textOf(node).includes('example@gmail.com'));
  applicationRecord.querySelectorAll('input').find(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').value='명단 확인';
  const pending=approve.events.click();
  await approve.events.click();
  assert.equal(calls.length,2);
  assert.equal(calls[1].action,'review');
  assert.equal(calls[1].payload.roster_entry_id,12);
  assert.equal(calls[1].payload.revision,7);
  assert.equal(calls[1].payload.reason,'명단 확인');
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
  assert.match(textOf(root),/현재 입장 가능한 기수\s+0개\s+가입 승인 대기\s+0명\s+등록 수강생\s+0명/);
  assert.match(textOf(root),/가입 승인 대기 \(0\).*수강생 관리 \(0\).*기수·수강 명단/);
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
  assert.match(textOf(content.children[0]),/수강생 직접 추가.*로그인 계정을 만들거나 바로 입장을 승인하는 동작은 아닙니다/);
  assert.match(textOf(content.children[1]),/현재 입장 가능한 기수/);

  const direct=content.children[0];
  const select=direct.querySelectorAll('select')[0]; select.value='1'; select.selectedOptions=[{textContent:'유유스 1기'}];
  const inputs=direct.querySelectorAll('input');
  inputs.find(node=>node.placeholder==='수강생 이름').value='테스트 학생';
  inputs.find(node=>node.placeholder==='Gmail 아이디').value='Test.Student+academy';
  inputs.find(node=>node.placeholder==='끝 4자리').value='1234';
  inputs.find(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').value='신청서 대조';
  await findButton(direct,'수강 명단에 추가').events.click();
  assert.equal(calls[1].action,'roster_add');
  assert.equal(calls[1].payload.gmail_local_id,'test.student+academy');
  assert.equal(calls[1].payload.cohort_id,1);
  assert.equal(calls[1].payload.reason,'신청서 대조');
});
test('academy lists can be searched and sorted without adding unsafe bulk account actions',async()=>{
  const applications=[
    {user_id:'b',revision:1,display_name:'나 학생',canonical_gmail:'beta@gmail.com',phone_last_four:'2222',status:'pending',submitted_at:'2026-09-02T00:00:00Z',roster_matches:[]},
    {user_id:'a',revision:1,display_name:'가 학생',canonical_gmail:'alpha@gmail.com',phone_last_four:'1111',status:'pending',submitted_at:'2026-09-01T00:00:00Z',roster_matches:[]}
  ];
  const {root,admin}=setup(async()=>({data:{...copy,applications,totals:{applications:2,students:0,roster:0}}}));
  await admin.load();
  const search=root.querySelectorAll('input').find(node=>node.type==='search');
  const sort=root.querySelectorAll('select').find(node=>node.attrs['aria-label']==='현재 페이지 관리 목록 정렬');
  assert.ok(search); assert.ok(sort);
  search.value='alpha@gmail.com'; search.events.input();
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.match(textOf(root),/현재 페이지 검색 결과: 신청 1명/);
  assert.match(textOf(root),/가입 승인 대기 \(1 표시 \/ 전체 2\)/);
  assert.match(textOf(root),/가 학생/);
  assert.doesNotMatch(textOf(root),/나 학생/);
  findButton(root,'검색 지우기').events.click();
  sort.value='name'; sort.events.change();
  const applicationSection=root.querySelectorAll('section').find(node=>textOf(node).includes('가입 승인 대기 (2)'));
  assert.deepEqual(applicationSection.querySelectorAll('article').map(node=>node.children[0].textContent),['가 학생','나 학생']);
  assert.doesNotMatch(textOf(root),/선택 승인|선택 정지|일괄 승인/);
});
test('cohorts and roster share one card while cohort access is expressed as open or closed',async()=>{
  const snapshot={...copy,cohorts:[
    {id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:3,starts_on:null,ends_on:null},
    {id:2,cohort_number:2,name:'유유스 2기',slug:'2gi',status:'draft',revision:1,starts_on:null,ends_on:null},
    {id:3,cohort_number:3,name:'유유스 3기',slug:'3gi',status:'active',revision:1,starts_on:'9999-01-01',ends_on:null},
    {id:4,cohort_number:4,name:'유유스 4기',slug:'4gi',status:'active',revision:1,starts_on:null,ends_on:'2000-01-01'}
  ]};
  const {root,admin}=setup(async()=>({data:snapshot}));
  await admin.load();
  const management=root.querySelectorAll('section').find(node=>textOf(node).includes('기수·수강 명단'));
  assert.ok(management);
  assert.match(textOf(management),/기수·수강 명단.*기수.*수강 명단/);
  assert.match(textOf(management),/수강생 입장 열림.*수강생 입장 닫힘.*수강생 입장 예정.*수강생 입장 기간 종료/);
  assert.match(textOf(management),/운영 기간.*주소 코드/);
  assert.doesNotMatch(textOf(management),/1기 · 유유스 1기/);
  assert.ok(findButton(management,'입장 닫기'));
  assert.ok(findButton(management,'입장 열기'));
  assert.doesNotMatch(textOf(management),/운영 상태|명단 접수|보관/);
});
test('an empty roster explains the next action and returns focus to direct entry',async()=>{
  const cohort={id:1,cohort_number:1,name:'유유스 1기',slug:'1gi',status:'active',revision:1,starts_on:null,ends_on:null};
  const {root,admin}=setup(async()=>({data:{...copy,cohorts:[cohort]}}));
  await admin.load();
  assert.match(textOf(root),/아직 등록된 수강 명단이 없습니다.*위의 수강생 직접 추가/);
  const directSelect=root.querySelectorAll('select').find(node=>node.children.some(option=>option.textContent==='유유스 1기'));
  await findButton(root,'수강생 직접 추가로 이동').events.click();
  assert.equal(directSelect.focused,true);
});
test('cohort creation rejects an invalid address code and reversed dates before an RPC write',async()=>{
  const calls=[];
  const {root,admin}=setup(async(_name,args)=>{calls.push(args);return {data:copy};});
  await admin.load();
  const create=root.querySelectorAll('details').find(node=>textOf(node).includes('새 기수 추가'));
  const inputs=create.querySelectorAll('input');
  inputs.find(node=>node.placeholder==='예: 2').value='3';
  inputs.find(node=>node.placeholder==='예: 유유스 2기').value='유유스 3기';
  const slug=inputs.find(node=>node.placeholder==='예: 2gi');
  slug.value='3기';
  await findButton(create,'새 기수 등록').events.click();
  assert.equal(calls.length,1);
  assert.match(textOf(root),/주소 코드는 영문 소문자/);
  slug.value='3gi';
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
  create.querySelectorAll('input').find(node=>node.placeholder==='예: 2gi').value='3gi';
  create.querySelectorAll('input').find(node=>node.placeholder==='예: 수강 명단과 신청 정보를 확인함').value='3기 준비';
  await findButton(create,'새 기수 등록').events.click();
  assert.equal(calls[1].action,'cohort_create');
  assert.equal(calls[1].payload.status,'draft');

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
    {subject_id:'student-b',action:'assign',created_at:'2026-09-10T02:00:00Z',detail:{reason:'2기 배정'}}
  ];
  const {root,admin}=setup(async()=>({data:{...copy,students,audit}}));
  await admin.load();
  const first=root.querySelectorAll('article').find(node=>textOf(node).includes('studenta@gmail.com'));
  const second=root.querySelectorAll('article').find(node=>textOf(node).includes('studentb@gmail.com'));
  assert.match(textOf(first),/계정 관리/);
  assert.match(textOf(first),/최근 이력\s+1건.*이용 상태 변경.*이용 재개/);
  assert.doesNotMatch(textOf(first),/2기 배정/);
  assert.match(textOf(second),/현재 기수 변경.*2기 배정/);
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
  const management=root.querySelectorAll('section').find(node=>textOf(node).includes('기수·수강 명단'));
  const rosterRecords=management.querySelectorAll('article').filter(node=>textOf(node).includes('@gmail.com'));
  assert.equal(rosterRecords.length,100);
});
test('a later page keeps its previous-page escape when totals shrink',async()=>{
  const snapshot={...copy,totals:{applications:0,students:0,roster:100}};
  const {root,admin}=setup(async()=>({data:snapshot}));
  await admin.load();
  await admin.load(undefined,100);
  assert.ok(findButton(root,'이전 100건'));
  assert.equal(findButton(root,'다음 100건'),undefined);
});
