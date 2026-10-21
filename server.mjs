import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OAuth2Client} from 'google-auth-library';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const CLIENT=process.env.GOOGLE_CLIENT_ID||'559253472044-ek8vsrlh19ik12iekci4mob8aptbg181.apps.googleusercontent.com';
const COORDINATOR='excelvan.jondonero@g.msuiit.edu.ph';
const hash=x=>createHash('sha256').update(x).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const schoolEmail=value=>typeof value==='string'&&value.length<=254&&/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@g\.msuiit\.edu\.ph$/i.test(value.trim())?value.trim().toLowerCase():null;
export function validIdentity(p){return p&&p.email_verified===true&&p.hd==='g.msuiit.edu.ph'&&typeof p.sub==='string'&&p.sub.length>0&&typeof p.email==='string'&&p.email.toLowerCase().endsWith('@g.msuiit.edu.ph');}
export function driveFile(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='drive.google.com'&&(/^\/file\/d\/[\w-]+(?:\/|$)/.test(u.pathname)||(u.pathname==='/open'&&/^[\w-]+$/.test(u.searchParams.get('id')||'')));}catch{return false;}}
export async function createApp({dbPath=':memory:',origin='http://localhost:5173',verifyToken}={}){
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,student_number TEXT UNIQUE);CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),step TEXT NOT NULL,label TEXT NOT NULL,url TEXT NOT NULL,filename TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'submitted',note TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS completion(user_id TEXT NOT NULL REFERENCES users(id),step TEXT NOT NULL,complete INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,step));CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,submission_id INTEGER,action TEXT NOT NULL,created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS allowed_students(email TEXT PRIMARY KEY,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),added_by TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS opened_steps(user_id TEXT NOT NULL REFERENCES users(id),step TEXT NOT NULL,opened_at TEXT NOT NULL,PRIMARY KEY(user_id,step));`);
 const resources=await readFile(path.join(ROOT,'portal/resources.js'),'utf8');
 // Read the trusted static configuration without evaluating user input.
 const vm=await import('node:vm');const context={window:{}};vm.runInNewContext(resources,context);const steps=context.window.OJT_RESOURCES.steps;const stepIds=new Set(steps.map(s=>s.id));
 function studentProgress(userId){
  const submissions=db.prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC').all(userId);
  const completion=db.prepare('SELECT step FROM completion WHERE user_id=? AND complete=1').all(userId).map(s=>s.step);
  const openedSteps=db.prepare('SELECT step FROM opened_steps WHERE user_id=? ORDER BY opened_at,step').all(userId).map(s=>s.step);
  const completedSet=new Set(completion),openedSet=new Set(openedSteps);
  const progress=steps.map(({id:step})=>{
   if(completedSet.has(step))return {step,stars:3,status:'completed'};
   const current=submissions.filter(s=>s.step===step&&s.status!=='superseded');
   if(current.length)return {step,stars:2,status:current.some(s=>s.status==='revision')?'revision':current.some(s=>s.status==='submitted')?'submitted':'ready'};
   if(openedSet.has(step))return {step,stars:1,status:'opened'};
   return {step,stars:0,status:'not-started'};
  });
  return {submissions,completion,openedSteps,progress};
 }

 const google=new OAuth2Client(CLIENT);const verify=verifyToken|| (async(token,nonce)=>{const ticket=await google.verifyIdToken({idToken:token,audience:CLIENT});const payload=ticket.getPayload();if(payload.nonce!==nonce)throw Error('Invalid sign-in challenge');return payload;});
 const attempts=new Map();let lastSweep=0;
 function limit(key){const now=Date.now();if(now-lastSweep>60000){for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);lastSweep=now;}let a=attempts.get(key);if(!a||a.until<now){a={n:0,until:now+60000};attempts.set(key,a);}return ++a.n<=15;}
 function cookie(req,name){return (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);}
 function setCookie(name,value,age){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`;}
 const challenges=new Map();
 function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
 async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>150000)throw Error('Request too large');}return JSON.parse(s||'{}');}
 const app=http.createServer(async(req,res)=>{try{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'self' https://accounts.google.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const url=new URL(req.url,origin);const pathname=url.pathname;
  if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
  if(req.method==='POST'&&req.headers.origin!==origin)return send(res,403,{error:'Invalid origin'});
  if(pathname==='/api/auth-config'&&req.method==='GET'){
   for(const [k,v] of challenges)if(v.expires<Date.now())challenges.delete(k);
   if(!limit('config:'+req.socket.remoteAddress))return send(res,429,{error:'Please wait a minute before trying again.'});
   const key=random(),nonce=random();challenges.set(hash(key),{nonce,expires:Date.now()+600000});res.setHeader('Set-Cookie',setCookie('challenge',key,600));return send(res,200,{clientId:CLIENT,nonce});
  }
  if(pathname==='/api/login'&&req.method==='POST'){
   if(!limit('login:'+req.socket.remoteAddress))return send(res,429,{error:'Please wait a minute before trying again.'});
   const challengeKey=hash(cookie(req,'challenge')||'');const ch=challenges.get(challengeKey);challenges.delete(challengeKey);if(!ch||ch.expires<Date.now())return send(res,401,{error:'Refresh the page to start sign-in again.'});
   const b=await body(req);let p;try{p=await verify(b.credential,ch.nonce);}catch{return send(res,401,{error:'Google sign-in could not be verified. Please refresh and retry.'});}
   if(!validIdentity(p))return send(res,403,{error:'Use your verified @g.msuiit.edu.ph Google account.'});
   const email=p.email.toLowerCase();
   if(email!==COORDINATOR&&!db.prepare('SELECT 1 FROM allowed_students WHERE email=? AND active=1').get(email))return send(res,403,{error:'Your school email has not been approved for portal access. Contact the coordinator.'});
   db.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email').run(p.sub,email,p.name||email);
   const token=random(),csrf=random();db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),p.sub,csrf,Date.now()+28800000);res.setHeader('Set-Cookie',[setCookie('session',token,28800),setCookie('challenge','',0)]);return send(res,200,{ok:true});
  }
  let session=db.prepare('SELECT s.*,u.email,u.name,u.student_number FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(cookie(req,'session')||''),Date.now());
  if(session&&session.email!==COORDINATOR&&!db.prepare('SELECT 1 FROM allowed_students WHERE email=? AND active=1').get(session.email)){
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.user_id);session=undefined;res.setHeader('Set-Cookie',setCookie('session','',0));
  }
  const coordinator=session?.email===COORDINATOR;
  if(req.method==='POST'&&session){const t=req.headers['x-csrf-token'];if(typeof t!=='string'||t.length!==session.csrf.length||!timingSafeEqual(Buffer.from(t),Buffer.from(session.csrf)))return send(res,403,{error:'Refresh this page before saving.'});}
  if(pathname==='/api/me'&&req.method==='GET'){if(!session)return send(res,401,{error:'Sign in required'});return send(res,200,{name:session.name,email:session.email,studentNumber:session.student_number,role:coordinator?'coordinator':'student',csrf:session.csrf,steps:steps.map(s=>({id:s.id,title:s.title})),...studentProgress(session.user_id)});}
  if(pathname.startsWith('/api/')&&!session)return send(res,401,{error:'Sign in required'});
  if(pathname==='/api/steps/open'&&req.method==='POST'){
   if(coordinator)return send(res,403,{error:'Only students can record their own opened steps.'});
   const b=await body(req);if(!stepIds.has(b.step))return send(res,400,{error:'Choose a valid map step.'});
   db.prepare('INSERT INTO opened_steps(user_id,step,opened_at) VALUES(?,?,?) ON CONFLICT(user_id,step) DO NOTHING').run(session.user_id,b.step,new Date().toISOString());
   return send(res,200,{ok:true,progress:studentProgress(session.user_id).progress.find(s=>s.step===b.step)});
  }
  if(pathname==='/api/allowlist'&&req.method==='GET'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});
   return send(res,200,{entries:db.prepare('SELECT email,active,added_by,updated_at FROM allowed_students ORDER BY email').all()});
  }
  if(pathname==='/api/allowlist'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});
   const b=await body(req);
   if(!Array.isArray(b.emails)||b.emails.length<1||b.emails.length>500)return send(res,400,{error:'Provide between 1 and 500 school email addresses.'});
   const normalized=b.emails.map(schoolEmail);
   if(normalized.some(e=>!e))return send(res,400,{error:'Every address must be a valid @g.msuiit.edu.ph school email. No addresses were added.'});
   const emails=[...new Set(normalized)].filter(e=>e!==COORDINATOR);const now=new Date().toISOString();
   db.exec('BEGIN IMMEDIATE');try{
    const add=db.prepare('INSERT INTO allowed_students(email,active,added_by,updated_at) VALUES(?,1,?,?) ON CONFLICT(email) DO UPDATE SET active=1,added_by=excluded.added_by,updated_at=excluded.updated_at');
    for(const email of emails)add.run(email,session.user_id,now);
    db.prepare('INSERT INTO audit(actor,action,created) VALUES(?,?,?)').run(session.user_id,JSON.stringify({action:'allowlist_add',emails}),now);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return send(res,200,{ok:true,count:emails.length});
  }
  if(pathname==='/api/allowlist/revoke'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});
   const b=await body(req),email=schoolEmail(b.email);
   if(!email)return send(res,400,{error:'Enter a valid @g.msuiit.edu.ph school email.'});
   if(email===COORDINATOR)return send(res,400,{error:'The coordinator account cannot be revoked.'});
   if(!db.prepare('SELECT 1 FROM allowed_students WHERE email=?').get(email))return send(res,404,{error:'That email is not on the approved student list.'});
   const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
    db.prepare('UPDATE allowed_students SET active=0,updated_at=? WHERE email=?').run(now,email);
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)').run(email);
    db.prepare('INSERT INTO audit(actor,action,created) VALUES(?,?,?)').run(session.user_id,JSON.stringify({action:'allowlist_revoke',email}),now);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return send(res,200,{ok:true});
  }
  if(pathname==='/api/profile'&&req.method==='POST'){
   const b=await body(req);if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>100||typeof b.studentNumber!=='string'||!/^[-\w]{3,30}$/.test(b.studentNumber))return send(res,400,{error:'Enter your name and valid student number.'});
   try{db.prepare('UPDATE users SET name=?,student_number=? WHERE id=?').run(b.name.trim(),b.studentNumber,session.user_id);}catch{return send(res,409,{error:'That student number is already registered. Contact the coordinator.'});}return send(res,200,{ok:true});
  }
  if(pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);res.setHeader('Set-Cookie',setCookie('session','',0));return send(res,200,{ok:true});}
  if(pathname==='/api/submissions'&&req.method==='POST'){
   if(coordinator||!session.student_number)return send(res,403,{error:'Complete student registration first.'});
   const b=await body(req);if(!stepIds.has(b.step)||!driveFile(b.url)||typeof b.label!=='string'||b.label.trim().length<2||b.label.length>120||typeof b.filename!=='string'||b.filename.length>180||!b.filename.startsWith(session.student_number+'_')||!/^[-\w. ()]+\.pdf$/i.test(b.filename))return send(res,400,{error:'Choose a step, enter a document name and direct Google Drive file link, and use StudentNumber_LastName_DocumentName.pdf.'});
   const duplicate=db.prepare('SELECT id FROM submissions WHERE user_id=? AND step=? AND url=? AND status IN (\'submitted\',\'approved\')').get(session.user_id,b.step,b.url);if(duplicate)return send(res,409,{error:'This file is already awaiting review or approved.'});
   db.prepare('INSERT INTO submissions(user_id,step,label,url,filename,created) VALUES(?,?,?,?,?,?)').run(session.user_id,b.step,b.label.trim(),b.url,b.filename,new Date().toISOString());db.prepare('INSERT INTO completion VALUES(?,?,0) ON CONFLICT(user_id,step) DO UPDATE SET complete=0').run(session.user_id,b.step);return send(res,201,{ok:true});
  }
  if(pathname==='/api/review'&&req.method==='GET'){if(!coordinator)return send(res,403,{error:'Coordinator only'});return send(res,200,{students:db.prepare('SELECT id,email,name,student_number FROM users WHERE email<>? ORDER BY name').all(COORDINATOR),submissions:db.prepare('SELECT s.*,u.name,u.student_number FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC').all(),completion:db.prepare('SELECT * FROM completion WHERE complete=1').all(),openedSteps:db.prepare('SELECT user_id,step FROM opened_steps ORDER BY user_id,step').all()});}
  if(pathname==='/api/review'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});const b=await body(req);
   if(!Number.isSafeInteger(b.id)||!['approved','revision','superseded'].includes(b.status)||typeof b.note!=='string'||b.note.length>1000||(b.status==='revision'&&!b.note.trim()))return send(res,400,{error:'Choose a review status; explain requested revisions.'});
   const item=db.prepare('SELECT * FROM submissions WHERE id=?').get(b.id);if(!item)return send(res,404,{error:'Submission not found'});
   db.prepare('UPDATE submissions SET status=?,note=? WHERE id=?').run(b.status,b.note,b.id);db.prepare('INSERT INTO completion VALUES(?,?,0) ON CONFLICT(user_id,step) DO UPDATE SET complete=0').run(item.user_id,item.step);db.prepare('INSERT INTO audit(actor,submission_id,action,created) VALUES(?,?,?,?)').run(session.user_id,b.id,b.status,new Date().toISOString());return send(res,200,{ok:true});
  }
  if(pathname==='/api/complete'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});const b=await body(req);if(!stepIds.has(b.step)||typeof b.userId!=='string'||typeof b.complete!=='boolean')return send(res,400,{error:'Invalid step'});
   const rows=db.prepare('SELECT status FROM submissions WHERE user_id=? AND step=? AND status<>\'superseded\'').all(b.userId,b.step);
   if(b.complete&&(!rows.length||rows.some(r=>r.status!=='approved')))return send(res,400,{error:'Approve all current files before completing this step. Mark replaced files as superseded.'});
   db.prepare('INSERT INTO completion VALUES(?,?,?) ON CONFLICT(user_id,step) DO UPDATE SET complete=excluded.complete').run(b.userId,b.step,b.complete?1:0);db.prepare('INSERT INTO audit(actor,action,created) VALUES(?,?,?)').run(session.user_id,JSON.stringify({user:b.userId,step:b.step,complete:b.complete}),new Date().toISOString());return send(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/'))return send(res,404,{error:'Not found'});
  const publicFiles=new Map([['/login','login.html'],['/login.js','login.js'],['/account.css','account.css']]);
  let file;if(publicFiles.has(pathname))file=path.join(ROOT,publicFiles.get(pathname));
  else {if(!session){res.writeHead(302,{Location:'/login'});return res.end();}const rel=decodeURIComponent(pathname==='/'?'/index.html':pathname);file=path.resolve(ROOT,'portal','.'+rel);if(!file.startsWith(path.join(ROOT,'portal')+path.sep))return send(res,404,{error:'Not found'});}
  const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  if(!types[ext])return send(res,404,{error:'Not found'});let content;try{content=await readFile(file);}catch{return send(res,404,{error:'Not found'});}res.writeHead(200,{'Content-Type':types[ext]});res.end(content);
 }catch{send(res,400,{error:'Could not complete this request. Please retry.'});}});
 return {app,db};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const directory=path.resolve(ROOT,process.env.DATA_DIR||'data');await mkdir(directory,{recursive:true});const port=Number(process.env.PORT||5173);const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;const {app}=await createApp({dbPath:path.join(directory,'portal.sqlite'),origin});app.listen(port,'0.0.0.0',()=>console.log(`BSCA portal: ${origin}`));}
