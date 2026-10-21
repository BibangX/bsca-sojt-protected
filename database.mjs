import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
const storage=new AsyncLocalStorage();
export function createDatabase({pool}={}){
 pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,ssl:process.env.PG_TEST==='1'?false:{rejectUnauthorized:true}});
 const query=async(sql,args)=>{
  const ctx=storage.getStore();if(!ctx)throw Error('Database request context required');
  let n=0;sql=sql.replace(/\?/g,()=>'$'+(++n));
  try{return await ctx.client.query(sql,args);}catch(e){ctx.failed=true;throw e;}
 };
 return {
  prepare(sql){return {async all(...args){return (await query(sql,args)).rows;},async get(...args){return (await query(sql,args)).rows[0];},async run(...args){return query(sql,args);}};},
  rollbackOnly(){storage.getStore().failed=true;},
  async request(fn,write=false){const client=await pool.connect();const ctx={client,failed:false};try{return await storage.run(ctx,async()=>{
   await client.query('BEGIN');await client.query('SET LOCAL search_path TO portal,pg_catalog');
   // Serialize short writes across function instances, including review/completion races.
   if(write)await client.query('SELECT pg_advisory_xact_lock(20261021)');
   const result=await fn();await client.query(ctx.failed?'ROLLBACK':'COMMIT');return result;
  });}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}},
  close(){return pool.end();}
 };
}
