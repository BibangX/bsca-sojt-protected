import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createDatabase} from './database.mjs';
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
export function diagnosticCode(error){
 const codes={
  '28P01':'DB_PASSWORD','28000':'DB_USER',
  'ENOTFOUND':'DB_HOST','EAI_AGAIN':'DB_DNS',
  'ECONNREFUSED':'DB_REFUSED','ETIMEDOUT':'DB_TIMEOUT','ECONNRESET':'DB_RESET',
  'SELF_SIGNED_CERT_IN_CHAIN':'DB_CERTIFICATE','DEPTH_ZERO_SELF_SIGNED_CERT':'DB_CERTIFICATE',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE':'DB_CERTIFICATE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY':'DB_CERTIFICATE',
  'CERT_HAS_EXPIRED':'DB_CERTIFICATE','ERR_TLS_CERT_ALTNAME_INVALID':'DB_CERTIFICATE',
  'ERR_INVALID_URL':'DB_URL','3D000':'DB_NAME','42P01':'DB_TABLES','42501':'DB_PERMISSIONS','53300':'DB_CONNECTION_LIMIT'
 };
 if(codes[error?.code])return codes[error.code];
 if(/timeout|timed out/i.test(error?.message||''))return 'DB_TIMEOUT';
 return 'BACKEND_UNKNOWN';
}
export async function createApp({origin='http://localhost:5173',verifyToken,database,rootDir=ROOT,trustProxy=false}={}){
 const db=database||createDatabase();
 const resources=await readFile(path.join(rootDir,'portal/resources.js'),'utf8');
 // Read the trusted static configuration without evaluating user input.
 const vm=await import('node:vm');const context={window:{}};vm.runInNewContext(resources,context);const steps=context.window.OJT_RESOURCES.steps;const stepIds=new Set(steps.map(s=>s.id));
 async function studentProgress(userId){
  const submissions=(await db.prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC').all(userId));
  const completion=(await db.prepare('SELECT step FROM completion WHERE user_id=? AND complete=1').all(userId)).map(s=>s.step);
  const openedSteps=(await db.prepare('SELECT step FROM opened_steps WHERE user_id=? ORDER BY opened_at,step').all(userId)).map(s=>s.step);
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
 
 async function limit(key){
  const bucket=Math.floor(Date.now()/60000), token='rate:'+hash(key)+':'+bucket;
  const row=await db.prepare("INSERT INTO auth_challenges(token,nonce,expires) VALUES(?,'1',?) ON CONFLICT(token) DO UPDATE SET nonce=(auth_challenges.nonce::integer+1)::text RETURNING nonce").get(token,(bucket+2)*60000);
  return Number(row.nonce)<=15;
 }
 function cookie(req,name){return (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);}
 function setCookie(name,value,age){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`;}

 function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
 async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>150000)throw Error('Request too large');}return JSON.parse(s||'{}');}
 const handle=async(req,res)=>{try{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'self' https://accounts.google.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const url=new URL(req.url,origin);const pathname=url.pathname;
  if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
  if(req.method==='POST'&&req.headers.origin!==origin)return send(res,403,{error:'Invalid origin'});
  if(pathname==='/api/auth-config'&&req.method==='GET'){
   await db.prepare('DELETE FROM auth_challenges WHERE expires<?').run(Date.now());
   if(!await limit('config:'+req.clientIp))return send(res,429,{error:'Please wait a minute before trying again.'});
   const key=random(),nonce=random();await db.prepare('INSERT INTO auth_challenges(token,nonce,expires) VALUES(?,?,?)').run(hash(key),nonce,Date.now()+600000);res.setHeader('Set-Cookie',setCookie('challenge',key,600));return send(res,200,{clientId:CLIENT,nonce});
  }
  if(pathname==='/api/login'&&req.method==='POST'){
   if(!await limit('login:'+req.clientIp))return send(res,429,{error:'Please wait a minute before trying again.'});
   const challengeKey=hash(cookie(req,'challenge')||'');const ch=await db.prepare('DELETE FROM auth_challenges WHERE token=? RETURNING nonce,expires').get(challengeKey);if(!ch||ch.expires<Date.now())return send(res,401,{error:'Refresh the page to start sign-in again.'});
   const b=await body(req);let p;try{p=await verify(b.credential,ch.nonce);}catch{return send(res,401,{error:'Google sign-in could not be verified. Please refresh and retry.'});}
   if(!validIdentity(p))return send(res,403,{error:'Use your verified @g.msuiit.edu.ph Google account.'});
   const email=p.email.toLowerCase();
   if(email!==COORDINATOR&&!(await db.prepare('SELECT 1 FROM allowed_students WHERE email=? AND active=1').get(email)))return send(res,403,{error:'Your school email has not been approved for portal access. Contact the coordinator.'});
   (await db.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email').run(p.sub,email,p.name||email));
   const token=random(),csrf=random();(await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()));(await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),p.sub,csrf,Date.now()+28800000));res.setHeader('Set-Cookie',[setCookie('session',token,28800),setCookie('challenge','',0)]);return send(res,200,{ok:true});
  }
  let session=(await db.prepare('SELECT s.*,u.email,u.name,u.student_number FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(cookie(req,'session')||''),Date.now()));
  if(session&&session.email!==COORDINATOR&&!(await db.prepare('SELECT 1 FROM allowed_students WHERE email=? AND active=1').get(session.email))){
   (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.user_id));session=undefined;res.setHeader('Set-Cookie',setCookie('session','',0));
  }
  const coordinator=session?.email===COORDINATOR;
  if(req.method==='POST'&&session){const t=req.headers['x-csrf-token'];if(typeof t!=='string'||t.length!==session.csrf.length||!timingSafeEqual(Buffer.from(t),Buffer.from(session.csrf)))return send(res,403,{error:'Refresh this page before saving.'});}
  if(pathname==='/api/me'&&req.method==='GET'){if(!session)return send(res,401,{error:'Sign in required'});return send(res,200,{name:session.name,email:session.email,studentNumber:session.student_number,role:coordinator?'coordinator':'student',csrf:session.csrf,steps:steps.map(s=>({id:s.id,title:s.title})),...(await studentProgress(session.user_id))});}
  if(pathname.startsWith('/api/')&&!session)return send(res,401,{error:'Sign in required'});
  if(pathname==='/api/steps/open'&&req.method==='POST'){
   if(coordinator)return send(res,403,{error:'Only students can record their own opened steps.'});
   const b=await body(req);if(!stepIds.has(b.step))return send(res,400,{error:'Choose a valid map step.'});
   (await db.prepare('INSERT INTO opened_steps(user_id,step,opened_at) VALUES(?,?,?) ON CONFLICT(user_id,step) DO NOTHING').run(session.user_id,b.step,new Date().toISOString()));
   return send(res,200,{ok:true,progress:(await studentProgress(session.user_id)).progress.find(s=>s.step===b.step)});
  }
  if(pathname==='/api/allowlist'&&req.method==='GET'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});
   return send(res,200,{entries:(await db.prepare('SELECT email,active,added_by,updated_at FROM allowed_students ORDER BY email').all())});
  }
  if(pathname==='/api/allowlist'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});
   const b=await body(req);
   if(!Array.isArray(b.emails)||b.emails.length<1||b.emails.length>500)return send(res,400,{error:'Provide between 1 and 500 school email addresses.'});
   const normalized=b.emails.map(schoolEmail);
   if(normalized.some(e=>!e))return send(res,400,{error:'Every address must be a valid @g.msuiit.edu.ph school email. No addresses were added.'});
   const emails=[...new Set(normalized)].filter(e=>e!==COORDINATOR);const now=new Date().toISOString();
   try{
    const add=db.prepare('INSERT INTO allowed_students(email,active,added_by,updated_at) VALUES(?,1,?,?) ON CONFLICT(email) DO UPDATE SET active=1,added_by=excluded.added_by,updated_at=excluded.updated_at');
    for(const email of emails)await add.run(email,session.user_id,now);
    (await db.prepare('INSERT INTO audit(actor,action,created) VALUES(?,?,?)').run(session.user_id,JSON.stringify({action:'allowlist_add',emails}),now));
   }catch(e){throw e;}
   return send(res,200,{ok:true,count:emails.length});
  }
  if(pathname==='/api/allowlist/revoke'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});
   const b=await body(req),email=schoolEmail(b.email);
   if(!email)return send(res,400,{error:'Enter a valid @g.msuiit.edu.ph school email.'});
   if(email===COORDINATOR)return send(res,400,{error:'The coordinator account cannot be revoked.'});
   if(!(await db.prepare('SELECT 1 FROM allowed_students WHERE email=?').get(email)))return send(res,404,{error:'That email is not on the approved student list.'});
   const now=new Date().toISOString();try{
    (await db.prepare('UPDATE allowed_students SET active=0,updated_at=? WHERE email=?').run(now,email));
    (await db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)').run(email));
    (await db.prepare('INSERT INTO audit(actor,action,created) VALUES(?,?,?)').run(session.user_id,JSON.stringify({action:'allowlist_revoke',email}),now));
   }catch(e){throw e;}
   return send(res,200,{ok:true});
  }
  if(pathname==='/api/profile'&&req.method==='POST'){
   const b=await body(req);if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>100||typeof b.studentNumber!=='string'||!/^[-\w]{3,30}$/.test(b.studentNumber))return send(res,400,{error:'Enter your name and valid student number.'});
   try{(await db.prepare('UPDATE users SET name=?,student_number=? WHERE id=?').run(b.name.trim(),b.studentNumber,session.user_id));}catch{return send(res,409,{error:'That student number is already registered. Contact the coordinator.'});}return send(res,200,{ok:true});
  }
  if(pathname==='/api/logout'&&req.method==='POST'){(await db.prepare('DELETE FROM sessions WHERE token=?').run(session.token));res.setHeader('Set-Cookie',setCookie('session','',0));return send(res,200,{ok:true});}
  if(pathname==='/api/submissions'&&req.method==='POST'){
   if(coordinator||!session.student_number)return send(res,403,{error:'Complete student registration first.'});
   const b=await body(req);if(!stepIds.has(b.step)||!driveFile(b.url)||typeof b.label!=='string'||b.label.trim().length<2||b.label.length>120||typeof b.filename!=='string'||b.filename.length>180||!b.filename.startsWith(session.student_number+'_')||!/^[-\w. ()]+\.pdf$/i.test(b.filename))return send(res,400,{error:'Choose a step, enter a document name and direct Google Drive file link, and use StudentNumber_LastName_DocumentName.pdf.'});
   const duplicate=(await db.prepare('SELECT id FROM submissions WHERE user_id=? AND step=? AND url=? AND status IN (\'submitted\',\'approved\')').get(session.user_id,b.step,b.url));if(duplicate)return send(res,409,{error:'This file is already awaiting review or approved.'});
   (await db.prepare('INSERT INTO submissions(user_id,step,label,url,filename,created) VALUES(?,?,?,?,?,?)').run(session.user_id,b.step,b.label.trim(),b.url,b.filename,new Date().toISOString()));(await db.prepare('INSERT INTO completion VALUES(?,?,0) ON CONFLICT(user_id,step) DO UPDATE SET complete=0').run(session.user_id,b.step));return send(res,201,{ok:true});
  }
  if(pathname==='/api/review'&&req.method==='GET'){if(!coordinator)return send(res,403,{error:'Coordinator only'});return send(res,200,{students:(await db.prepare('SELECT id,email,name,student_number FROM users WHERE email<>? ORDER BY name').all(COORDINATOR)),submissions:(await db.prepare('SELECT s.*,u.name,u.student_number FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC').all()),completion:(await db.prepare('SELECT * FROM completion WHERE complete=1').all()),openedSteps:(await db.prepare('SELECT user_id,step FROM opened_steps ORDER BY user_id,step').all())});}
  if(pathname==='/api/review'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});const b=await body(req);
   if(!Number.isSafeInteger(b.id)||!['approved','revision','superseded'].includes(b.status)||typeof b.note!=='string'||b.note.length>1000||(b.status==='revision'&&!b.note.trim()))return send(res,400,{error:'Choose a review status; explain requested revisions.'});
   const item=(await db.prepare('SELECT * FROM submissions WHERE id=?').get(b.id));if(!item)return send(res,404,{error:'Submission not found'});
   (await db.prepare('UPDATE submissions SET status=?,note=? WHERE id=?').run(b.status,b.note,b.id));(await db.prepare('INSERT INTO completion VALUES(?,?,0) ON CONFLICT(user_id,step) DO UPDATE SET complete=0').run(item.user_id,item.step));(await db.prepare('INSERT INTO audit(actor,submission_id,action,created) VALUES(?,?,?,?)').run(session.user_id,b.id,b.status,new Date().toISOString()));return send(res,200,{ok:true});
  }
  if(pathname==='/api/complete'&&req.method==='POST'){
   if(!coordinator)return send(res,403,{error:'Coordinator only'});const b=await body(req);if(!stepIds.has(b.step)||typeof b.userId!=='string'||typeof b.complete!=='boolean')return send(res,400,{error:'Invalid step'});
   const rows=(await db.prepare('SELECT status FROM submissions WHERE user_id=? AND step=? AND status<>\'superseded\'').all(b.userId,b.step));
   if(b.complete&&(!rows.length||rows.some(r=>r.status!=='approved')))return send(res,400,{error:'Approve all current files before completing this step. Mark replaced files as superseded.'});
   (await db.prepare('INSERT INTO completion VALUES(?,?,?) ON CONFLICT(user_id,step) DO UPDATE SET complete=excluded.complete').run(b.userId,b.step,b.complete?1:0));(await db.prepare('INSERT INTO audit(actor,action,created) VALUES(?,?,?)').run(session.user_id,JSON.stringify({user:b.userId,step:b.step,complete:b.complete}),new Date().toISOString()));return send(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/'))return send(res,404,{error:'Not found'});
  const publicFiles=new Map([['/login','login.html'],['/login.js','login.js'],['/account.css','account.css']]);
  let file;if(publicFiles.has(pathname))file=path.join(rootDir,publicFiles.get(pathname));
  else {if(!session){res.writeHead(302,{Location:'/login'});return res.end();}const rel=decodeURIComponent(pathname==='/'?'/index.html':pathname);file=path.resolve(rootDir,'portal','.'+rel);if(!file.startsWith(path.join(rootDir,'portal')+path.sep))return send(res,404,{error:'Not found'});}
  const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  if(!types[ext])return send(res,404,{error:'Not found'});let content;try{content=await readFile(file);}catch{return send(res,404,{error:'Not found'});}res.writeHead(200,{'Content-Type':types[ext]});res.end(content);
 }catch{res.failed=true;send(res,400,{error:'Could not complete this request. Please retry.'});}};
 const app=http.createServer(async(req,res)=>{
  const buffered={headers:{},status:200,setHeader(k,v){this.headers[k]=v;},writeHead(s,h={}){this.status=s;Object.assign(this.headers,h);},end(data){this.data=data;}};
  req.clientIp=trustProxy ? (req.headers['x-nf-client-connection-ip']||'unknown') : req.socket.remoteAddress;
  try{await db.request(async()=>{await handle(req,buffered);if(buffered.failed)db.rollbackOnly();},req.method==='POST'||req.url.startsWith('/api/auth-config'));
   res.writeHead(buffered.status,buffered.headers);res.end(buffered.data);
  }catch(error){const reference=diagnosticCode(error);console.error('Portal backend diagnostic:',reference);res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Portal temporarily unavailable. Please retry shortly.',reference}));}
 });
 return {app,db};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||5173);const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;const {app}=await createApp({origin});app.listen(port,'0.0.0.0',()=>console.log(`BSCA portal: ${origin}`));}
