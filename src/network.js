const KEY='seven-vice-online';
export function savedConnection() {
  try { return JSON.parse(sessionStorage.getItem(KEY)||localStorage.getItem(KEY)||'null'); } catch { return null; }
}
export function activeConnection() { try{return JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{return null;} }
export class Network {
  constructor(onState,onError){this.onState=onState;this.onError=onError;this.session=null;this.state=null;this.stopped=true;this.requesting=false;this.pollTimer=null;}
  async api(path,body,session=this.session) {
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
    try {
      const response=await fetch(path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Authorization:`Bearer ${session.token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:controller.signal});
      const value=await response.json();
      if(!response.ok){const e=new Error(value.error||'通信に失敗しました。');e.status=response.status;throw e;}return value;
    }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw new Error('サーバーに接続できません。接続を再試行しています。');throw e;}finally{clearTimeout(timeout);}
  }
  async enter(action,input) {
    const session=await this.api(action==='create'?'/api/rooms':'/api/join',input,null);
    session.name=input.name;await this.connect(session);
  }
  async connect(session) {
    this.stop();this.session=session;this.stopped=false;
    try{const state=await this.api(`/api/rooms/${session.code}`);if(this.stopped)return;
      try{sessionStorage.setItem(KEY,JSON.stringify(session));localStorage.setItem(KEY,JSON.stringify(session));}catch{/*接続中はメモリで保持*/}
      this.accept(state);this.poll();
    }catch(e){this.stopped=true;throw e;}
  }
  accept(state){if(state.code!==this.session?.code || (this.state?.code===state.code && state.revision<this.state.revision))return;this.state=state;this.onState(state);}
  async poll() {
    if(this.stopped)return;
    const session=this.session;
    try {const state=await this.api(`/api/rooms/${session.code}`,undefined,session);if(!this.stopped && this.session===session)this.accept(state);}
    catch(e){if(!this.stopped && this.session===session){this.onError(e);if([401,404].includes(e.status)){this.stop();return;}}}
    if(!this.stopped && this.session===session)this.pollTimer=setTimeout(()=>this.poll(),700);
  }
  async command(action,payload={}) {
    if(this.requesting) return;
    this.requesting=true;
    try{const state=await this.api(`/api/rooms/${this.session.code}/action`,{action,revision:this.state.revision,...payload});if(state.left){this.forget();return;}if(!this.stopped)this.accept(state);}
    catch(e){this.onError(e);if(e.status===409){try{this.accept(await this.api(`/api/rooms/${this.session.code}`));}catch(err){this.onError(err);}}}
    finally{this.requesting=false;}
  }
  stop(){this.stopped=true;clearTimeout(this.pollTimer);this.state=null;}
  forget(){this.stop();try{sessionStorage.removeItem(KEY);const stored=JSON.parse(localStorage.getItem(KEY)||'null');if(stored?.token===this.session?.token)localStorage.removeItem(KEY);}catch{}this.session=null;this.state=null;}
}
