import type {EmailDelivery} from './foundation-auth.ts';
export interface TransactionalEmailAdapter {
 sendVerificationEmail(message:{to:string;url:string}):Promise<void>;
 sendPasswordResetEmail(message:{to:string;url:string}):Promise<void>;
}
// Provider-neutral; delivery is injected by the deployment adapter. No external requests here.
export function emailDelivery(adapter:TransactionalEmailAdapter):EmailDelivery{return message=>message.purpose==='VERIFY'?adapter.sendVerificationEmail(message):adapter.sendPasswordResetEmail(message);}
export class MemoryEmailAdapter implements TransactionalEmailAdapter{
 readonly messages:{to:string;url:string;purpose:'VERIFY'|'RESET'}[]=[];
 async sendVerificationEmail(m:{to:string;url:string}){this.messages.push({...m,purpose:'VERIFY'});}
 async sendPasswordResetEmail(m:{to:string;url:string}){this.messages.push({...m,purpose:'RESET'});}
}
