import http from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { createStore, MAX_BODY } from './store.mjs';
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Negotiate only the public HTML. Private API responses are never compressed.
export function selectHtmlEncoding(header) {
  if (!header || !String(header).trim()) return 'identity';
  const weights = new Map();
  for (const item of String(header).split(',')) {
    const [token, ...parameters] = item.trim().toLowerCase().split(';');
    if (!/^(br|gzip|identity|\*)$/.test(token.trim())) continue;
    let quality = 1, seenQuality = false;
    for (const parameter of parameters) {
      const [key, value] = parameter.trim().split('=');
      if (key.trim() !== 'q') continue;
      quality = !seenQuality && /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value?.trim() || '') ? Number(value.trim()) : 0;
      seenQuality = true;
    }
    const name = token.trim();
    weights.set(name, Math.min(weights.get(name) ?? 1, quality));
  }
  const wildcard = weights.get('*') ?? 0;
  const candidates = ['br', 'gzip'].map(name => ({name, quality: weights.get(name) ?? wildcard}));
  // An implicit identity remains a fallback; explicit preferences are ranked.
  candidates.push({name: 'identity', quality: weights.get('identity') ?? (weights.get('*') === 0 ? 0 : 0.001)});
  candidates.sort((a, b) => b.quality - a.quality);
  return candidates[0].quality > 0 ? candidates[0].name : null;
}
export function resolveRequestPath(url, root) {
  let pathname=url.split('?')[0].split('#')[0];
  if(!pathname.startsWith('/') || pathname.startsWith('//')) throw new Error('Caminho inválido.');
  for(let pass=0;pass<5;pass++){const decoded=decodeURIComponent(pathname);if(decoded===pathname)break;pathname=decoded;}
  if(pathname.includes('%') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..'))throw new Error('Caminho inválido.');
  const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));const relative=path.relative(root,filename);
  if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('Caminho inválido.');return filename;
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req,limit=MAX_BODY){if(Number(req.headers['content-length'])>limit)throw Object.assign(new Error('Corpo excede o limite.'),{status:413});const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>limit)throw Object.assign(new Error('Corpo excede o limite.'),{status:413});parts.push(part);}return Buffer.concat(parts);}
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createAppServer({root=path.join(PROJECT,'dist'),storageDirectory=path.join(PROJECT,'private'),username,password,origin,localAccess=false,defaults: suppliedDefaults}={}){
  if(origin && (!/^https:\/\//.test(origin) || new URL(origin).origin!==origin))throw new Error('Origem pública exige HTTPS e nenhum caminho.');
  const defaults=suppliedDefaults || {inventory:JSON.parse(readFileSync(path.join(PROJECT,'data/example-inventory.json'),'utf8')),maps:JSON.parse(readFileSync(path.join(PROJECT,'data/default-maps.json'),'utf8'))};
  const store=createStore({storageDirectory,defaults,username,password});const sessions=new Map();const loginLimits=new Map();
  let htmlCache;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    const expectedOrigin=origin || 'http://127.0.0.1:'+server.address().port;
    const allowedHosts=origin?[new URL(origin).host]:['127.0.0.1:'+server.address().port,'localhost:'+server.address().port];
    try{
      if(!allowedHosts.includes(req.headers.host))return json(res,403,{error:'Host não permitido.'});
      const rawUrl=req.url || '/';resolveRequestPath(rawUrl,root);const pathname=rawUrl.split('?')[0];const write=!['GET','HEAD'].includes(req.method);
      if(write && req.headers.origin!==expectedOrigin && !(!origin && req.headers.origin==='http://localhost:'+server.address().port))return json(res,403,{error:'Origem não permitida.'});
      if(req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))return json(res,403,{error:'Origem não permitida.'});
      const cookie=String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('map_session='))?.slice(12);
      let session=cookie && sessions.get(cookie);if(session && session.expires<Date.now()){sessions.delete(cookie);session=null;}
      const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      if(localAccess && !origin && loopback && !session && pathname==='/api/session' && req.method==='GET'){
        for(const [id,value] of sessions)if(value.expires<Date.now())sessions.delete(id);
        if(sessions.size>=1000)return json(res,503,{error:'Limite de sessões atingido.'});
        const token=randomBytes(32).toString('hex');
        session={username:'local',csrfToken:randomBytes(32).toString('hex'),expires:Date.now()+8*60*60*1000};
        sessions.set(token,session);
        res.setHeader('Set-Cookie','map_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
      }
      if(pathname==='/api/login' && req.method==='POST'){
        const address=req.socket.remoteAddress || 'local';const now=Date.now();for(const [ip,v]of loginLimits)if(v.until<now)loginLimits.delete(ip);
        const limit=loginLimits.get(address)||{count:0,until:now+15*60*1000};if(limit.count>=10){res.setHeader('Retry-After','900');return json(res,429,{error:'Muitas tentativas. Aguarde 15 minutos.'});}
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{error:'Use JSON.'});
        const credentials=JSON.parse((await body(req,4096)).toString('utf8'));
        if(typeof credentials.username!=='string'||typeof credentials.password!=='string'||credentials.username.length>100||credentials.password.length>256)return json(res,400,{error:'Credenciais inválidas.'});
        limit.count++;loginLimits.set(address,limit);if(!store.verifyUser(credentials.username,credentials.password))return json(res,401,{error:'Usuário ou senha inválidos.'});loginLimits.delete(address);
        for(const [id,v]of sessions)if(v.expires<now)sessions.delete(id);if(sessions.size>=1000)return json(res,503,{error:'Limite de sessões atingido.'});if(cookie)sessions.delete(cookie);
        const token=randomBytes(32).toString('hex');session={username:credentials.username,csrfToken:randomBytes(32).toString('hex'),expires:now+8*60*60*1000};sessions.set(token,session);
        res.setHeader('Set-Cookie','map_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(origin?'; Secure':''));return json(res,200,{username:session.username,csrfToken:session.csrfToken});
      }
      if(pathname.startsWith('/api/')){
        res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; sandbox");if(!session)return json(res,401,{error:'Entre com sua conta.'});
        if(write && !safeEqual(req.headers['x-csrf-token'],session.csrfToken))return json(res,403,{error:'Sessão inválida. Entre novamente.'});
        if(pathname==='/api/session'&&req.method==='GET')return json(res,200,{username:session.username,csrfToken:session.csrfToken});
        if(pathname==='/api/revision'&&req.method==='GET')return json(res,200,{revision:store.getRevision()});
        if(pathname==='/api/logout'&&req.method==='POST'){sessions.delete(cookie);res.setHeader('Set-Cookie','map_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(origin?'; Secure':''));return json(res,200,{ok:true});}
        if(pathname==='/api/state'&&req.method==='GET')return json(res,200,store.getState());
        if(pathname==='/api/state'&&req.method==='PUT'){
          if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{error:'Use JSON.'});
          const input=JSON.parse((await body(req)).toString('utf8'));if(!Number.isSafeInteger(input.revision)||input.revision<0)return json(res,400,{error:'Revisão inválida.'});
          const revision=store.putState({inventory:input.inventory,maps:input.maps},input.revision,session.username);
          if(revision===null)return json(res,409,{error:'Outro usuário salvou uma nova versão. Suas edições permanecem nesta sessão.',revision:store.getRevision()});return json(res,200,{revision});
        }
        if(pathname==='/api/assets'&&req.method==='POST'){const url=store.saveAsset(await body(req));return json(res,201,{url});}
        if(pathname.startsWith('/api/assets/')&&['GET','HEAD'].includes(req.method)){
          try{const asset=store.readAsset(pathname.slice(12));res.writeHead(200,{'Content-Type':asset.mime,'Content-Length':asset.bytes.length});res.end(req.method==='HEAD'?undefined:asset.bytes);}catch{return json(res,404,{error:'Imagem não encontrada.'});}return;
        }
        return json(res,404,{error:'Recurso não encontrado.'});
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Método não permitido.'});if(!['/','/index.html'].includes(pathname))return json(res,404,{error:'Página não encontrada.'});
      const filename=realpathSync(path.join(root,'index.html'));const file=statSync(filename);
      if(path.dirname(filename)!==realpathSync(root)||!file.isFile())return json(res,404,{error:'Página não encontrada.'});
      const fingerprint=[filename,file.dev,file.ino,file.size,file.mtimeMs,file.ctimeMs].join(':');
      if(htmlCache?.fingerprint!==fingerprint){const content=readFileSync(filename);htmlCache={fingerprint,variants:{identity:content},policy:content.toString('utf8').match(/<meta content="([^"]+)" http-equiv="Content-Security-Policy">/i)?.[1]};}
      res.setHeader('Vary','Accept-Encoding');
      if(htmlCache.policy)res.setHeader('Content-Security-Policy',htmlCache.policy+"; frame-ancestors 'none'");
      const encoding=selectHtmlEncoding(req.headers['accept-encoding']);
      if(!encoding)return json(res,406,{error:'Codificação não aceita.'});
      if(!htmlCache.variants[encoding])htmlCache.variants[encoding]=encoding==='br'?brotliCompressSync(htmlCache.variants.identity,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5}}):gzipSync(htmlCache.variants.identity);
      const content=htmlCache.variants[encoding];if(encoding!=='identity')res.setHeader('Content-Encoding',encoding);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':content.length});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){json(res,error.status||(error.code==='ENOENT'?404:400),{error:error.status===413?error.message:'Requisição inválida.'});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.store=store;server.on('close',()=>store.close());return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const server=createAppServer({username:process.env.MAP_BOOTSTRAP_USERNAME,password:process.env.MAP_BOOTSTRAP_PASSWORD,origin:process.env.MAP_PUBLIC_ORIGIN,localAccess:process.env.MAP_LOCAL_ACCESS!=='0'});server.on('error',error=>{console.error('Não foi possível abrir o painel: '+error.message);process.exitCode=1;});server.listen(Number(process.env.MAP_PORT||4173),'127.0.0.1',()=>console.log('Painel privado disponível neste computador: http://127.0.0.1:'+server.address().port));}
