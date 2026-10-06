import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import type {IncomingMessage,ServerResponse} from 'node:http';
const redirect='http://localhost:3211/auth/twitch/callback';
export class TwitchOAuth {
 pending=new Map<string,number>();fetcher:typeof fetch;envPath:string;
 constructor(options:{fetcher?:typeof fetch;envPath?:string}={}){this.fetcher=options.fetcher??fetch;this.envPath=options.envPath??'.env';}
 async handle(req:IncomingMessage,res:ServerResponse){
  const url=new URL(req.url??'/','http://localhost:3211');if(!url.pathname.startsWith('/auth/twitch/'))return false;
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"};
  const reply=(status:number,text:string)=>{res.writeHead(status,{...headers,'Content-Type':'text/plain; charset=utf-8','Set-Cookie':'vw_twitch_state=; HttpOnly; SameSite=Lax; Path=/auth/twitch/; Max-Age=0'});res.end(text);};
  if(req.headers.host!=='localhost:3211'||req.method!=='GET'){reply(403,'Invalid OAuth request.');return true;}
  if(url.pathname==='/auth/twitch/start'){
   if(req.headers['sec-fetch-site']&& !['none','same-origin'].includes(String(req.headers['sec-fetch-site']))){reply(403,'Open the local OAuth page directly.');return true;}
   if(!process.env.TWITCH_CLIENT_ID||!process.env.TWITCH_CLIENT_SECRET||process.env.TWITCH_REDIRECT_URI!==redirect){reply(400,'Local Twitch application configuration is missing or the redirect does not match.');return true;}
   for(const [key,expires]of this.pending)if(expires<Date.now())this.pending.delete(key);
   if(this.pending.size>=5){reply(429,'Too many pending authorizations. Wait ten minutes.');return true;}
   const state=randomBytes(32).toString('hex');this.pending.set(state,Date.now()+600000);
   const target=new URL('https://id.twitch.tv/oauth2/authorize');target.search=new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'user:read:chat',state}).toString();
   res.writeHead(302,{...headers,Location:target.toString(),'Set-Cookie':`vw_twitch_state=${state}; HttpOnly; SameSite=Lax; Path=/auth/twitch/; Max-Age=600`});res.end();return true;
  }
  if(url.pathname!=='/auth/twitch/callback'){reply(404,'Not found.');return true;}
  const state=url.searchParams.get('state')??'',cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('vw_twitch_state='))?.slice(16)??'';
  const expiry=this.pending.get(state);const valid=/^[a-f0-9]{64}$/.test(state)&&cookie.length===state.length&&timingSafeEqual(Buffer.from(state),Buffer.from(cookie))&&!!expiry&&expiry>Date.now();
  if(!valid){reply(400,'Authorization state expired or invalid. Start again from the local authorization page.');return true;}
  this.pending.delete(state);
  if(url.searchParams.has('error')||!url.searchParams.get('code')){reply(400,'Twitch authorization was not granted. No credentials were saved.');return true;}
  try{
   if(spawnSync('git',['check-ignore','--quiet','--',this.envPath]).status!==0||spawnSync('git',['ls-files','--error-unmatch','--',this.envPath],{stdio:'ignore'}).status===0)throw Error('Unsafe credential storage');
   const response=await this.fetcher('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID!,client_secret:process.env.TWITCH_CLIENT_SECRET!,code:url.searchParams.get('code')!,grant_type:'authorization_code',redirect_uri:redirect}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Exchange failed');const tokens:any=await response.json();
   if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string'||!Array.isArray(tokens.scope)||tokens.scope.length!==1||tokens.scope[0]!=='user:read:chat')throw Error('Invalid token response');
   const validated=await this.fetcher('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+tokens.access_token},signal:AbortSignal.timeout(15000)});if(!validated.ok)throw Error('Validation failed');const user:any=await validated.json();
   if(user.client_id!==process.env.TWITCH_CLIENT_ID||!user.user_id||user.scopes?.length!==1||user.scopes[0]!=='user:read:chat'||user.expires_in<3900)throw Error('Token eligibility failed');
   const values={TWITCH_USER_ACCESS_TOKEN:tokens.access_token,TWITCH_REFRESH_TOKEN:tokens.refresh_token,TWITCH_ACCESS_APPROVED:'true'};
   let text=readFileSync(this.envPath,'utf8');for(const [key,value]of Object.entries(values)){if(!/^[A-Za-z0-9:_-]+$/.test(value))throw Error('Invalid environment value');const line=key+'='+value,pattern=new RegExp('^'+key+'=.*$','gm');text=pattern.test(text)?text.replace(pattern,line):text.trimEnd()+'\n'+line+'\n';}
   writeFileSync(this.envPath,text,{mode:0o600});Object.assign(process.env,values);
   res.writeHead(303,{...headers,Location:'/auth/twitch/complete','Set-Cookie':'vw_twitch_state=; HttpOnly; SameSite=Lax; Path=/auth/twitch/; Max-Age=0'});res.end();
  }catch{reply(400,'OAuth could not be completed safely. Tokens were not approved. Check local configuration and restart authorization.');}
  return true;
 }
}
