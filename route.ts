import { ApiError, db, seed, session, publicSession, passwordHash, digest, cookie, cookieName, sessionCookie, processLog, accountData, requestKey } from '@/lib/server';
export const dynamic='force-dynamic';
function json(data:any,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}})}
async function handle(req:Request){
 try{
  const path=new URL(req.url).pathname.replace(/\/$/,'');const method=req.method;
  if(method!=='GET'){
   const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new ApiError(403,'Запрос с другого сайта отклонён.');
   if(!req.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'Ожидается JSON.');
  }
  await seed();
  let b:any={};if(method!=='GET'){const raw=await req.text();if(raw.length>8000)throw new ApiError(413,'Слишком большой запрос.');try{b=JSON.parse(raw)}catch{throw new ApiError(400,'Некорректный JSON.')}if(!b||typeof b!=='object'||Array.isArray(b))throw new ApiError(400,'Ожидается объект.');}
  if(method==='POST'&&(path==='/api/session/login'||path==='/api/admin/login')){
   const role=path.includes('/admin/')?'admin':'player';
   if(typeof b.login!=='string'||typeof b.password!=='string'||b.login.length>80||b.password.length>128)throw new ApiError(400,'Введи логин и пароль.');
   const login=b.login.trim().toLowerCase();const user=await db().prepare('SELECT * FROM accounts WHERE (login=? OR phone=?) AND role=?').bind(login,login,role).first<any>();
   const hashed=await passwordHash(b.password,role==='admin'?'club-demo-admin-v2':'club-demo-player-v2');
   if(!user||hashed!==user.password_hash)throw new ApiError(401,'Неверный логин или пароль.');
   const token=crypto.randomUUID()+crypto.randomUUID();const now=Date.now();const pc=role==='admin'?'ADMIN':(typeof b.pc==='string'&&/^PC-\d{2}$/.test(b.pc)?b.pc:'PC-01');
   const old=cookie(req,cookieName(role));const stmts=[];
   if(old)stmts.push(db().prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(now,await digest(old)));
   stmts.push(db().prepare('INSERT INTO sessions(token_hash,account_id,pc,created_at,expires_at) VALUES(?,?,?,?,?)').bind(await digest(token),user.id,pc,now,now+12*3600000));await db().batch(stmts);
   return json({account:{id:user.id,name:user.name,login:user.login,phone:user.phone},session:{pc,startedAt:now,expiresAt:now+12*3600000},wheelUrl:'/wheel'},200,{'Set-Cookie':sessionCookie(req,role,token,43200)});
  }
  if(path.startsWith('/api/admin/')){
   const s=await session(req,'admin');
   if(method==='POST'&&path==='/api/admin/logout'){await db().prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),s.token_hash).run();return json({ok:true},200,{'Set-Cookie':sessionCookie(req,'admin','',0)});}
   if(method==='GET'&&path==='/api/admin/data'){
    const [a,d,h,ses,p]=await Promise.all([
     db().prepare("SELECT a.id,a.login,a.name,a.phone,(SELECT COALESCE(SUM(amount_kopeks),0) FROM deposits WHERE account_id=a.id) AS balance,(SELECT COALESCE(SUM(quantity),0) FROM spin_grants WHERE account_id=a.id)-(SELECT COUNT(*) FROM spins WHERE account_id=a.id) AS available FROM accounts a WHERE role='player' ORDER BY a.id").all(),
     db().prepare('SELECT d.*,a.login,g.quantity,g.processed_at FROM deposits d JOIN accounts a ON a.id=d.account_id LEFT JOIN spin_grants g ON g.deposit_id=d.id ORDER BY d.created_at DESC LIMIT 200').all(),
     db().prepare('SELECT s.id,s.account_id,s.prize_name,s.created_at,s.issued_at,a.login FROM spins s JOIN accounts a ON a.id=s.account_id ORDER BY s.created_at DESC LIMIT 200').all(),
     db().prepare("SELECT s.account_id,s.pc,s.created_at,s.expires_at,s.revoked_at,a.login FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE a.role='player' ORDER BY s.created_at DESC LIMIT 100").all(),
     db().prepare('SELECT id,name,short,weight FROM prizes ORDER BY id').all()
    ]);return json({accounts:a.results,deposits:d.results,history:h.results,sessions:ses.results,prizes:p.results,admin:s.login});
   }
   if(method==='POST'&&path==='/api/admin/reset'){await db().batch([db().prepare('DELETE FROM spins'),db().prepare('DELETE FROM spin_grants'),db().prepare('DELETE FROM deposits'),db().prepare("UPDATE sessions SET revoked_at=? WHERE account_id IN (SELECT id FROM accounts WHERE role='player')").bind(Date.now())]);return json({ok:true});}
   if(method==='POST'&&path==='/api/admin/sync')return json({processed:await processLog()});
   if(method==='POST'&&path==='/api/admin/issue'){
    if(typeof b.id!=='string')throw new ApiError(400,'Не указан выигрыш.');const r=await db().prepare('UPDATE spins SET issued_at=COALESCE(issued_at,?) WHERE id=? RETURNING id,issued_at').bind(Date.now(),b.id).first();if(!r)throw new ApiError(404,'Выигрыш не найден.');return json(r);
   }
   if(method==='POST'&&path==='/api/admin/prizes'){
    if(!Array.isArray(b.weights)||b.weights.length!==6||b.weights.some((v:any)=>!Number.isInteger(v)||v<0||v>100)||b.weights.reduce((a:number,v:number)=>a+v,0)!==100)throw new ApiError(400,'Сумма целых вероятностей должна быть 100%.');
    await db().batch(b.weights.map((v:number,i:number)=>db().prepare('UPDATE prizes SET weight=? WHERE id=?').bind(v,i)));return json({ok:true});
   }
   throw new ApiError(404,'Метод не найден.');
  }
  const s=await session(req);
  if(method==='GET'&&path==='/api/session')return json(publicSession(s));
  if(method==='POST'&&path==='/api/session/logout'){await db().prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),s.token_hash).run();return json({ok:true},200,{'Set-Cookie':sessionCookie(req,'player','',0)});}
  if(method==='GET'&&path==='/api/account')return json(await accountData(s));
  if(method==='POST'&&path==='/api/wheel/sync'){const processed=await processLog(s.id);return json({processed,...await accountData(s)});}
  if(method==='POST'&&path==='/api/deposits'){
   const key=requestKey(b);const amount=b.amountKopeks;if(!Number.isSafeInteger(amount)||amount<100||amount>10000000)throw new ApiError(400,'Сумма — от 1 до 100 000 ₽.');
   if(b.accountId!==undefined&&b.accountId!==s.id)throw new ApiError(403,'Нельзя пополнить другой аккаунт из этой сессии.');
   const result=await db().prepare('INSERT INTO deposits(id,account_id,amount_kopeks,request_key,created_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,request_key) DO NOTHING').bind(crypto.randomUUID(),s.id,amount,key,Date.now()).run();
   const entry=await db().prepare('SELECT id,account_id,amount_kopeks,created_at FROM deposits WHERE account_id=? AND request_key=?').bind(s.id,key).first<any>();
   if(entry.amount_kopeks!==amount)throw new ApiError(409,'Этот ключ уже использован для другой суммы.');
   return json({deposit:entry,replayed:result.meta.changes===0,message:'Пополнение записано в журнал. Колесо получит его при следующей синхронизации.'});
  }
  if(method==='POST'&&path==='/api/wheel/spin'){
   if(b.accountId!==undefined&&b.accountId!==s.id)throw new ApiError(409,'Аккаунт в другом окне изменился. Обнови страницу.');
   const key=requestKey(b);const existing=await db().prepare('SELECT * FROM spins WHERE account_id=? AND request_key=?').bind(s.id,key).first();if(existing)return json({win:existing,replayed:true});
   const ps=await db().prepare('SELECT * FROM prizes ORDER BY id').all<any>();const total=ps.results.reduce((sum:number,p:any)=>sum+p.weight,0);if(total!==100)throw new ApiError(503,'Настройки колеса временно недоступны.');
   let random=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296*100;let prize=ps.results[ps.results.length-1];for(const p of ps.results){random-=p.weight;if(random<0){prize=p;break;}}
   const id=crypto.randomUUID();await db().prepare(`INSERT INTO spins(id,account_id,request_key,prize_id,prize_name,created_at)
    SELECT ?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(quantity),0) FROM spin_grants WHERE account_id=?)-(SELECT COUNT(*) FROM spins WHERE account_id=?)>0
    ON CONFLICT(account_id,request_key) DO NOTHING`).bind(id,s.id,key,prize.id,prize.name,Date.now(),s.id,s.id).run();
   const win=await db().prepare('SELECT * FROM spins WHERE account_id=? AND request_key=?').bind(s.id,key).first<any>();if(!win)throw new ApiError(409,'Доступных прокруток нет. Дождись обработки пополнения.');return json({win,replayed:win.id!==id});
  }
  throw new ApiError(404,'Метод не найден.');
 }catch(e){if(e instanceof ApiError)return json({error:e.message},e.status);console.error('Demo API error',e);return json({error:'Не удалось обратиться к базе. Попробуй ещё раз.'},503);}
}
export const GET=handle;export const POST=handle;
