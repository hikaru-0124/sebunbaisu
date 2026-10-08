import { randomBytes } from 'node:crypto';
import { createGame, playCard, resolveEffect, nextRound } from '../src/engine.js';

export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new RoomError(message, status); };
function nameOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 16) fail('名前は1〜16文字で入力してください。');
  return value.trim();
}
export class Rooms {
  constructor({ now = Date.now, random = Math.random } = {}) { this.rooms = new Map(); this.now = now; this.random = random; }
  clean() { for (const [code, r] of this.rooms) if (this.now() - r.updated > 4 * 60 * 60 * 1000) this.rooms.delete(code); }
  create({ name, count }) {
    this.clean();
    if (![3,4].includes(count)) fail('対戦人数は3人か4人を選んでください。');
    if (this.rooms.size >= 500) fail('ルームが満員です。時間をおいてお試しください。',503);
    name = nameOf(name);
    let code; do { code = randomBytes(4).toString('hex').slice(0,6).toUpperCase(); } while(this.rooms.has(code));
    const room = { code, count, members:[], game:null, revision:0, sequence:0, waiting:new Set(), updated:this.now(), note:'' };
    this.rooms.set(code,room);
    return this.add(room,name);
  }
  room(code) { this.clean(); const room = this.rooms.get(String(code).toUpperCase()); if (!room) fail('ルームが見つかりません。コードを確認してください。サーバー再起動後は作り直してください。',404); return room; }
  add(room,name) {
    const token = randomBytes(32).toString('hex');
    room.members.push({name,token,seen:this.now()});this.bump(room);
    return {code:room.code,token};
  }
  join({ code, name }) {
    const r=this.room(code);
    name=nameOf(name);
    if(r.game) fail('このルームは対戦中です。');
    if(r.members.length>=r.count) fail('このルームは満員です。');
    if(r.members.some(m=>m.name===name)) fail('同じ名前のプレイヤーがいます。別の名前を入力してください。');
    return this.add(r,name);
  }
  bump(r) { r.revision++;r.updated=this.now(); }
  auth(code,token) {
    const r=this.room(code), seat=r.members.findIndex(m=>m.token===token);
    if(seat<0) fail('参加情報が無効です。ルームに参加し直してください。',401);
    const m=r.members[seat], wasOffline=this.now()-m.seen>15000;
    m.seen=this.now();r.updated=this.now();
    if(wasOffline)this.bump(r);
    return {r,seat,m};
  }
  snapshot(code,token) {
    const {r,seat}=this.auth(code,token);
    const map=i=>i===null?null:(i-seat+r.members.length)%r.members.length;
    const connected = r.members.map(m=>this.now()-m.seen<=15000);
    const allConnected=connected.every(Boolean);
    let game=null;
    if(r.game) {
      const g=r.game;
      const players=Array.from({length:r.members.length},(_,i)=>{
        const original=(seat+i)%r.members.length,p=g.players[original];
        return {name:r.members[original].name,hand:original===seat?[...p.hand]:Array(p.hand.length).fill(null),field:[...p.field],score:p.score,connected:connected[original]};
      });
      game={version:1,players,deck:Array(g.deck.length).fill(null),turn:map(g.turn),starter:map(g.starter),round:g.round,lastEffect:g.lastEffect,status:g.status,log:[...g.log],result:g.result?{...g.result,winner:map(g.result.winner)}:null,
        pending:g.pending && g.turn===seat?{effect:g.pending.effect,options:g.pending.options.map(o=>({target:map(o.target),ids:g.pending.effect===0?Array(o.ids.length).fill(null):[...o.ids]}))}:null,
        events:(g.events||[]).map(e=>({...e,actor:map(e.actor),...(Number.isInteger(e.target)?{target:map(e.target)}:{})}))};
    }
    return { code:r.code,count:r.count,seat,host:seat===0,revision:r.revision,sequence:r.sequence,
      members:r.members.map((m,i)=>({name:m.name,connected:connected[i],self:i===seat,host:i===0})),
      game,locked:r.waiting.size>0 || !allConnected,ackNeeded:r.waiting.has(token),waitingNames:r.members.filter(m=>r.waiting.has(m.token)).map(m=>m.name),allConnected,note:r.note };
  }
  command(code,token,input) {
    const {r,seat,m}=this.auth(code,token);
    const action=input.action;
    if(action==='leave') {
      r.members.splice(seat,1);r.game=null;r.waiting.clear();r.sequence++;
      r.note=`${m.name}が退出しました。メンバーがそろったら新しい対戦を開始できます。`;
      if(!r.members.length)this.rooms.delete(r.code);else this.bump(r);
      return {left:true};
    }
    if(action==='ack') {
      if(input.sequence!==r.sequence) return this.snapshot(code,token);
      if(r.waiting.delete(token))this.bump(r);
      return this.snapshot(code,token);
    }
    if(input.revision!==r.revision) fail('画面を最新の状態に更新しています。もう一度操作してください。',409);
    if(r.members.length!==r.count || r.members.some(p=>this.now()-p.seen>15000)) fail('全員の接続を待っています。');
    if(r.waiting.size)fail('全員がカード演出を確認するまでお待ちください。');
    const hostAction=['start','restart','next'].includes(action);
    if(hostAction && seat!==0)fail('この操作はルーム作成者が行います。',403);
    if(action==='start' || action==='restart') {
      if(action==='start' && r.game)fail('対戦はすでに始まっています。');
      if(action==='restart' && r.game?.status!=='game')fail('再対戦は対戦終了後に開始できます。');
      r.game=createGame(r.count,this.random);
      r.game.players.forEach((p,i)=>p.name=r.members[i].name);
      // 初回ログも実際のプレイヤー名に置換。
      r.game.log=[`ラウンド 1 開始。${r.members[r.game.turn].name}が先手。`];
      r.note='';r.sequence++;
    } else if(action==='next') {
      if(!r.game || r.game.status!=='round')fail('次のラウンドに進めません。');
      nextRound(r.game,this.random);r.sequence++;
    } else if(action==='play' || action==='effect') {
      if(!r.game || r.game.turn!==seat)fail('あなたの手番ではありません。',403);
      if(action==='play') {
        if(!Number.isInteger(input.id))fail('カードが無効です。');
        try {playCard(r.game,input.id);}catch(e){fail(e.message);}
      } else {
        if(!Number.isInteger(input.option))fail('対象が無効です。');
        try {resolveEffect(r.game,input.option);}catch(e){fail(e.message);}
      }
      r.sequence++;r.waiting=new Set(r.members.map(p=>p.token));
    } else fail('操作が無効です。');
    this.bump(r);return this.snapshot(code,token);
  }
}
