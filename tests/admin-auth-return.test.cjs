const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{textContent:'',classList:{add(c){classes.add(c);},remove(c){classes.delete(c);},contains(c){return classes.has(c);}}});}return nodes.get(id);};
  let restores=0,clears=0;
  const results=[];
  const ctx={document:{getElementById:node},academyAdmin:{clear(){clears++;}},gateEl:node('auth-gate'),gateLogout:node('logout'),gateMessage(){},restoreLastTab(){restores++;},sb:{from(){return{select(){return{eq(){return{maybeSingle(){return results.length?results.shift():Promise.resolve({data:{role:'admin'}});}};}};}};}}};
  vm.createContext(ctx);
  vm.runInContext(`let academyIdentity=null,displayedAdminIdentity=null,adminCheckEpoch=0,accessToken=null,currentAdmin=null;\n${html.slice(html.indexOf('    function syncAcademyIdentity('),html.indexOf('    let currentAdmin'))}\n${html.slice(html.indexOf('    async function checkAdmin('),html.indexOf("    document.getElementById('gate-login').addEventListener"))}`,ctx);
  return {ctx,results,node,get restores(){return restores;},get clears(){return clears;}};
}
const session=id=>({user:{id,email:id+'@gmail.com'},access_token:'test-token'});
test('same-account Chrome return revalidates without restoring/reloading tabs',async()=>{
  const s=setup();await s.ctx.checkAdmin(session('a'));assert.equal(s.restores,1);
  await s.ctx.checkAdmin(session('a'));await s.ctx.checkAdmin(session('a'));
  assert.equal(s.restores,1);assert.equal(s.clears,1);
  await s.ctx.checkAdmin(session('b'));assert.equal(s.restores,2);assert.equal(s.clears,2);
});
test('permission removal clears view and later grant initializes again',async()=>{
  const s=setup();await s.ctx.checkAdmin(session('a'));
  s.results.push(Promise.resolve({data:{role:'member'}}));await s.ctx.checkAdmin(session('a'));
  assert.equal(s.clears,2);assert.equal(s.restores,1);
  await s.ctx.checkAdmin(session('a'));assert.equal(s.restores,2);
});
test('late privileged response after logout never reopens the app',async()=>{
  const s=setup();let finish;s.results.push(new Promise(done=>finish=done));
  const pending=s.ctx.checkAdmin(session('a'));s.ctx.syncAcademyIdentity(null);
  finish({data:{role:'admin'}});await pending;assert.equal(s.restores,0);
});

test('cross-window logout shows login gate and hides privileged content',async()=>{
  const s=setup();await s.ctx.checkAdmin(session('a'));
  assert.equal(s.node('auth-gate').classList.contains('hidden'),true);
  s.ctx.syncAcademyIdentity(null);
  assert.equal(s.node('app-root').classList.contains('hidden'),true);
  assert.equal(s.node('auth-gate').classList.contains('hidden'),false);
});
