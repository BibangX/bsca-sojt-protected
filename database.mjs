import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
const storage=new AsyncLocalStorage();
// Public Supabase root CA supplied from the project's SSL settings.
const SUPABASE_CA="-----BEGIN CERTIFICATE-----\nMIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL\nBQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l\ndyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh\nc2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow\nazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD\nYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug\nUm9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW\nQyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q\nDmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2\nGtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi\ncvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4\nO4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt\nNaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX\nuXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt\naUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU\ntVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b\nVW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6\njB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx\nCea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2\nCMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P\no/bKiIz+Fq8=\n-----END CERTIFICATE-----\n";
export function connectionOptions(connectionString){
 const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Object.assign(new Error('Invalid database URL'),{code:'ERR_INVALID_URL'});
 // pg otherwise lets URI SSL options override the verified CA configuration.
 for(const key of ['sslmode','sslrootcert','sslcert','sslkey','ssl','uselibpqcompat'])url.searchParams.delete(key);
 return {connectionString:url.toString(),max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,ssl:{ca:SUPABASE_CA,rejectUnauthorized:true}};
}
export function createDatabase({pool}={}){
 pool ||= new pg.Pool(connectionOptions(process.env.DATABASE_URL));
 let schemaReady=false;
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
   // Additive upgrade for existing deployments; the same write lock prevents cold-start races.
   if(!schemaReady){
    await client.query('SELECT pg_advisory_xact_lock(20261021)');
    await client.query('CREATE TABLE IF NOT EXISTS portal.level_access(user_id TEXT PRIMARY KEY REFERENCES portal.users(id),early_access BOOLEAN NOT NULL DEFAULT FALSE,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL)');
    await client.query('ALTER TABLE portal.level_access ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON portal.level_access FROM PUBLIC,anon,authenticated');
   }
   // Serialize short writes across function instances, including review/completion races.
   if(write)await client.query('SELECT pg_advisory_xact_lock(20261021)');
   const result=await fn();await client.query(ctx.failed?'ROLLBACK':'COMMIT');if(!ctx.failed)schemaReady=true;return result;
  });}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}},
  close(){return pool.end();}
 };
}
