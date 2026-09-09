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
  focus() { this.focused=true; }
  querySelectorAll(selector) {
    const tags=selector.split(',').map(x=>x.trim());
    return this.children.flatMap(c=>[...(tags.includes(c.tagName)?[c]:[]),...c.querySelectorAll(selector)]);
  }
}
const copy = {version:1,applications:[],students:[],cohorts:[],audit:[]};
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
  assert.equal(findButton(root,'다시 불러오기').disabled,false);
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
  const pending=admin.load(); admin.clear(); resolve({data:copy}); await pending;
  assert.equal(root.children.length,0);
});
test('stalled requests time out with a result-unconfirmed message and a usable retry',async()=>{
  let timeout;
  const {root,admin}=setup(()=>new Promise(()=>{}),()=>true,{setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{}});
  const pending=admin.load(); timeout(); await pending;
  assert.match(textOf(root),/처리 결과를 확인하지 못했습니다/);
  assert.equal(findButton(root,'다시 불러오기').disabled,false);
  assert.ok(root.children.some(node=>node.focused));
});
test('approval requires an explicit cohort, reason, confirmation and revision; double clicks are blocked',async()=>{
  const calls=[];
  let finish;
  const row={user_id:'fixture-id',revision:7,display_name:'예시 학생',canonical_gmail:'example@gmail.com',phone_last_four:'0000'};
  const {root,admin}=setup(async(_rpc,args)=>{
    calls.push(args);
    if(args.action==='admin_snapshot') return {data:{...copy,applications:[row],cohorts:[{id:2,name:'2기'}]}};
    return new Promise(resolve=>{finish=resolve;});
  });
  await admin.load();
  const approve=findButton(root,'승인하고 기수 배정');
  await approve.events.click();
  assert.equal(calls.length,1);
  const select=root.querySelectorAll('select')[0]; select.value='2';select.selectedOptions=[{textContent:'2기'}];
  await approve.events.click(); assert.equal(calls.length,1);
  root.querySelectorAll('input')[0].value='명단 확인';
  const pending=approve.events.click();
  await approve.events.click();
  assert.equal(calls.length,2);
  assert.equal(calls[1].action,'review');
  assert.equal(calls[1].payload.cohort_id,2);
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
