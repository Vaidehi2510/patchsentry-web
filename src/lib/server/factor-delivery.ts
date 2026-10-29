import {AsyncLocalStorage} from 'node:async_hooks';
import type {Database} from './database';
import type {AuthConfig} from './auth';
export const factorDelivery=new AsyncLocalStorage<{failed:boolean}>();
export async function sendFactorCode(database:Database,config:AuthConfig,userId:string,email:string,code:string){
  try{const profile=(await database.query<{method:string|null;pending_method:string|null}>('SELECT method,pending_method FROM qa_auth_profiles WHERE user_id=$1',[userId])).rows[0];
    if((profile?.method || profile?.pending_method)!=='email'||!config.sendSecurityCode)throw new Error('Email codes are unavailable');
    await config.sendSecurityCode({email,code});
  }catch{const state=factorDelivery.getStore();if(state)state.failed=true;throw new Error('Security code delivery failed');}
}
