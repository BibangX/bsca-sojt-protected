import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,validIdentity,driveFile} from './server.mjs';
const origin='http://localhost:5173';
const identities={student:{sub:'student-1',email:'student@g.msuiit.edu.ph',name:'Student One',email_verified:true,hd:'g.msuiit.edu.ph'},other:{sub:'student-2',email:'other@g.msuiit.edu.ph',name:'Student Two',email_verified:true,hd:'g.msuiit.edu.ph'},coordinator:{sub:'coordinator',email:'excelvan.jondonero@g.msuiit.edu.ph',name:'Excel Van',email_verified:true,hd:'g.msuiit.edu.ph'},outsider:{sub:'outsider',email:'student@gmail.com',email_verified:true,hd:'gmail.com'}};
test('identity requires verified school Workspace membership',()=>{assert.equal(validIdentity(identities.student),true);for(const p of [identities.outsider,{...identities.student,email_verified:false},{...identities.student,hd:undefined},{...identities.student,email:'x@g.msuiit.edu.ph.attacker.com'}])assert.equal(Boolean(validIdentity(p)),false);});
test('accepts direct Drive files only',()=>{assert(driveFile('https://drive.google.com/file/d/abc/view'));for(const u of ['https://drive.google.com/drive/folders/abc','https://evil.com/file/d/abc','javascript:alert(1)','https://drive.google.com.evil.com/file/d/abc'])assert(!driveFile(u));});
test('protected end-to-end registration, privacy, review and completion',async()=>{
const {app,db}=await createApp({origin,verifyToken:async token=>{if(!identities[token])throw Error();return identities[token];}});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
async function call(route,{cookie='',csrf='',body,headers={}}={}){return fetch(base+route,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{cookie,origin,'x-csrf-token':csrf,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
async function login(who){const config=await call('/api/auth-config');const ch=config.headers.getSetCookie()[0].split(';')[0];const response=await call('/api/login',{cookie:ch,body:{credential:who}});assert.equal(response.status,200);const cookie=response.headers.getSetCookie()[0].split(';')[0];const me=await (await call('/api/me',{cookie})).json();return {cookie,csrf:me.csrf};}
try{
for(const route of ['/','/resources.js','/templates/Intent-Declaration.docx','/assets/ojt-pirate-map.png'])assert.equal((await call(route)).status,302);
assert.equal((await call('/api/review')).status,401);
const challenge=await call('/api/auth-config');assert.equal((await call('/api/login',{cookie:challenge.headers.getSetCookie()[0].split(';')[0],body:{credential:'outsider'}})).status,403);
const unlistedChallenge=await call('/api/auth-config');assert.equal((await call('/api/login',{cookie:unlistedChallenge.headers.getSetCookie()[0].split(';')[0],body:{credential:'student'}})).status,403);
const c=await login('coordinator');
assert.equal((await call('/api/allowlist',c)).status,200);
assert.equal((await call('/api/allowlist',{...c,body:{emails:['student@g.msuiit.edu.ph','bad@gmail.com']}})).status,400);
assert.equal((await (await call('/api/allowlist',c)).json()).entries.length,0);
assert.equal((await call('/api/allowlist',{...c,body:{emails:['STUDENT@g.msuiit.edu.ph','student@g.msuiit.edu.ph','other@g.msuiit.edu.ph']}})).status,200);
assert.equal((await (await call('/api/allowlist',c)).json()).entries.length,2);
const a=await login('student'),b=await login('other');
assert.equal((await call('/api/allowlist',a)).status,403);
assert.equal((await call('/api/allowlist',{...a,body:{emails:['new@g.msuiit.edu.ph']}})).status,403);
assert.equal((await call('/api/allowlist/revoke',{...c,body:{email:'excelvan.jondonero@g.msuiit.edu.ph'}})).status,400);
const initialDesk=await (await call('/api/review',c)).json();assert.equal(initialDesk.students.length,2);assert.equal(initialDesk.submissions.length,0);
assert.equal((await call('/coordinator.js')).status,302);assert.equal((await call('/coordinator.js',c)).status,200);
assert.equal((await call('/api/profile',{...a,body:{name:'Student One',studentNumber:'2026-001'},headers:{origin:'https://evil.example'}})).status,403);
assert.equal((await call('/api/profile',{...a,csrf:'wrong',body:{name:'Student One',studentNumber:'2026-001'}})).status,403);
assert.equal((await call('/api/profile',{...a,body:{name:'Student One',studentNumber:'2026-001'}})).status,200);
assert.equal((await call('/api/profile',{...b,body:{name:'Student Two',studentNumber:'2026-001'}})).status,409);
assert.equal((await (await call('/api/me',a)).json()).progress.find(p=>p.step==='intent').stars,0);
assert.equal((await call('/api/steps/open',{...a,body:{step:'unknown'}})).status,400);
assert.equal((await call('/api/steps/open',{...c,body:{step:'intent'}})).status,403);
assert.equal((await call('/api/steps/open',{...a,csrf:'bad',body:{step:'intent'}})).status,403);
assert.equal((await call('/api/steps/open',{...a,body:{step:'intent',stars:3,user_id:'student-2'}})).status,200);
assert.equal((await call('/api/steps/open',{...a,body:{step:'intent'}})).status,200);
const opened=await (await call('/api/me',a)).json();assert.deepEqual(opened.openedSteps,['intent']);assert.equal(opened.progress.find(p=>p.step==='intent').stars,1);assert.deepEqual(opened.completion,[]);
assert.equal(db.prepare('SELECT COUNT(*) n FROM opened_steps WHERE user_id=?').get('student-1').n,1);
assert.deepEqual((await (await call('/api/me',b)).json()).openedSteps,[]);
assert((await (await call('/api/review',c)).json()).openedSteps.some(r=>r.user_id==='student-1'&&r.step==='intent'));

assert.equal((await call('/api/submissions',{...a,body:{step:'intent',label:'Intent declaration',filename:'2026-001_One_Intent.pdf',url:'https://drive.google.com/drive/folders/abc'}})).status,400);
const submission={step:'intent',label:'Intent declaration',filename:'2026-001_One_Intent.pdf',url:'https://drive.google.com/file/d/abc/view'};
assert.equal((await call('/api/submissions',{...a,body:submission})).status,201);
assert.equal((await (await call('/api/me',a)).json()).progress.find(p=>p.step==='intent').stars,2);
assert.equal((await call('/api/submissions',{...a,body:submission})).status,409);
assert.equal((await call('/api/review',a)).status,403);
assert.equal((await (await call('/api/me',b)).json()).submissions.length,0);
assert.equal((await call('/api/review',{...a,body:{id:1,status:'approved',note:''}})).status,403);
assert.equal((await call('/api/complete',{...c,body:{userId:'student-1',step:'intent',complete:true}})).status,400);
assert.equal((await call('/api/review',{...c,body:{id:1,status:'revision',note:''}})).status,400);
assert.equal((await call('/api/review',{...c,body:{id:1,status:'revision',note:'Please sign the document.'}})).status,200);
const revision=await (await call('/api/me',a)).json();assert.equal(revision.progress.find(p=>p.step==='intent').stars,2);assert.equal(revision.progress.find(p=>p.step==='intent').status,'revision');
assert.equal((await call('/api/review',{...c,body:{id:1,status:'approved',note:'Verified'}})).status,200);
const ready=await (await call('/api/me',a)).json();assert.equal(ready.progress.find(p=>p.step==='intent').stars,2);assert.equal(ready.progress.find(p=>p.step==='intent').status,'ready');
assert.equal((await call('/api/complete',{...c,body:{userId:'student-1',step:'intent',complete:true}})).status,200);
assert.deepEqual((await (await call('/api/me',a)).json()).completion,['intent']);
assert.equal((await (await call('/api/me',a)).json()).progress.find(p=>p.step==='intent').stars,3);
await call('/api/steps/open',{...a,body:{step:'intent'}});
assert.equal((await (await call('/api/me',a)).json()).progress.find(p=>p.step==='intent').stars,3);
assert.equal((await call('/api/submissions',{...a,body:{...submission,url:'https://drive.google.com/file/d/newfile/view'}})).status,201);
assert.deepEqual((await (await call('/api/me',a)).json()).completion,[]);
const anew=await login('student');const returning=await (await call('/api/me',anew)).json();assert.equal(returning.submissions.length,2);assert.equal(returning.progress.find(p=>p.step==='intent').stars,2);assert.deepEqual(returning.openedSteps,['intent']);
assert.equal((await call('/api/logout',{...a,body:{}})).status,200);assert.equal((await call('/api/me',a)).status,401);
assert.equal((await call('/api/allowlist/revoke',{...c,body:{email:'other@g.msuiit.edu.ph'}})).status,200);
assert.equal((await call('/api/me',b)).status,401);
assert.equal((await call('/assets/ojt-pirate-map.png',b)).status,302);
const denied=await call('/api/auth-config');assert.equal((await call('/api/login',{cookie:denied.headers.getSetCookie()[0].split(';')[0],body:{credential:'other'}})).status,403);
assert.equal((await call('/api/allowlist',{...c,body:{emails:['other@g.msuiit.edu.ph']}})).status,200);
assert.equal((await call('/api/me',b)).status,401);
await login('other');
}finally{await new Promise(r=>app.close(r));db.close();}
});

test('saved accounts and submissions survive database restart',async()=>{
const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const directory=await mkdtemp(path.join(os.tmpdir(),'bsca-persistence-'));const file=path.join(directory,'test.sqlite');
try{let a=await createApp({dbPath:file,origin});a.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('persist','persist@g.msuiit.edu.ph','Saved Student','2026-010');a.db.prepare('INSERT INTO submissions(user_id,step,label,url,filename,created) VALUES(?,?,?,?,?,?)').run('persist','intent','Intent','https://drive.google.com/file/d/abc/view','2026-010_Student_Intent.pdf',new Date().toISOString());a.db.prepare('INSERT INTO opened_steps VALUES(?,?,?)').run('persist','intent',new Date().toISOString());a.db.close();let b=await createApp({dbPath:file,origin});assert.equal(b.db.prepare('SELECT COUNT(*) n FROM opened_steps WHERE user_id=?').get('persist').n,1);assert.equal(b.db.prepare('SELECT student_number FROM users WHERE id=?').get('persist').student_number,'2026-010');assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,1);b.db.close();}finally{await rm(directory,{recursive:true,force:true});}
});


test('allowlist CSV preview handles quoted columns and validates school emails',async()=>{
 const {parseEmailCsv,normalizeAllowedEmails}=await import('./portal/coordinator.js');
 assert.deepEqual(parseEmailCsv('name,email\r\n"Doe, Jane",Jane@g.msuiit.edu.ph\r\n"John ""JJ"" Doe",john@g.msuiit.edu.ph'),['Jane@g.msuiit.edu.ph','john@g.msuiit.edu.ph']);
 assert.deepEqual(normalizeAllowedEmails([' Jane@g.msuiit.edu.ph ','jane@g.msuiit.edu.ph']),['jane@g.msuiit.edu.ph']);
 assert.throws(()=>parseEmailCsv('name,email\nJane,"unfinished'));
 assert.throws(()=>parseEmailCsv('name,email\nJane,'));
 assert.throws(()=>normalizeAllowedEmails(['student@gmail.com']));
 assert.throws(()=>normalizeAllowedEmails(Array.from({length:501},(_,i)=>'s'+i+'@g.msuiit.edu.ph')));
});

test('map stars match saved progress without treating visits as completion',async()=>{
 const {starProgress}=await import('./portal/coordinator.js');
 const base={step:'intent',userId:'s1'};
 assert.equal(starProgress(base).stars,0);
 assert.equal(starProgress({...base,openedSteps:[{user_id:'s1',step:'intent'}]}).stars,1);
 assert.equal(starProgress({...base,openedSteps:[{user_id:'s2',step:'intent'}]}).stars,0);
 for(const status of ['submitted','revision','approved'])assert.equal(starProgress({...base,submissions:[{user_id:'s1',step:'intent',status}]}).stars,2);
 assert.equal(starProgress({...base,submissions:[{user_id:'s1',step:'intent',status:'superseded'}]}).stars,0);
 assert.equal(starProgress({...base,openedSteps:['intent'],submissions:[{user_id:'s1',step:'intent',status:'superseded'}]}).stars,1);
 assert.equal(starProgress({...base,completion:[{user_id:'s1',step:'intent',complete:1}]}).stars,3);
 assert.equal(starProgress({...base,completion:[{user_id:'s2',step:'intent',complete:1}]}).stars,0);
});
