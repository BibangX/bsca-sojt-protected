const serverless=require('serverless-http');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
let application;
exports.handler=async function handler(event,context){
 context.callbackWaitsForEmptyEventLoop=false;
 const origin=process.env.APP_ORIGIN;
 if(!origin||!process.env.DATABASE_URL)return {statusCode:503,body:'Portal setup is incomplete.'};
 application ||= import(pathToFileURL(path.join(process.cwd(),'server.mjs')).href).then(({createApp})=>createApp({origin,rootDir:process.cwd(),trustProxy:true})).then(({app})=>serverless(app,{binary:['image/*','application/vnd.openxmlformats-officedocument.wordprocessingml.document']}));
 const serve=await application;
 // A forced rewrite preserves the visitor route in rawUrl.
 if(event.rawUrl)event.path=new URL(event.rawUrl).pathname;
 return serve(event,context);
}
