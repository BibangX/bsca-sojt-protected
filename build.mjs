import {mkdir,writeFile,readdir,stat} from 'node:fs/promises';
await mkdir('public',{recursive:true});
const exposed=await readdir('public');
if(exposed.some(n=>n!=='robots.txt'))throw Error('Public directory must not contain protected files.');
await writeFile('public/robots.txt','User-agent: *\nDisallow: /\n');
async function check(dir){for(const n of await readdir(dir)){const p=dir+'/'+n;const s=await stat(p);if(s.isDirectory())await check(p);else if(s.size>4400000)throw Error('Asset exceeds conservative function response limit: '+p);}}
await check('portal');console.log('Protected assets verified; only robots.txt is published statically.');
