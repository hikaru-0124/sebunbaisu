import { CARDS, cardOf, typeOf, createGame, playCard, resolveEffect, nextRound, chooseCpu } from './engine.js';
import { describeEvent } from './presentation.js';
import { Network, savedConnection, activeConnection } from './network.js';
const $ = selector => document.querySelector(selector);
const app = $('#app');
const STORAGE = 'seven-vice-game-v1';
let game = null, timer = null, selected = null, busy = false;
let online = false, roomState = null, seenSequence = -1, confirmedSequence = -1, networkError = '', entering = false;
const network = new Network(receiveState, e => {
  networkError=e.message;
  if([401,404].includes(e.status)){network.forget();online=false;roomState=null;clearPresentation();lobby();}
  else if(game && !activeEvent)render();else if(roomState && !game)renderWaiting();
});
function receiveState(state) {
  const previous=roomState, hadError=Boolean(networkError);roomState=state;networkError='';online=true;
  if(!state.game){clearPresentation();game=null;seenSequence=state.sequence;if(!previous || previous.revision!==state.revision || hadError || JSON.stringify(previous.members)!==JSON.stringify(state.members))renderWaiting();return;}
  game=state.game;
  if(state.sequence!==seenSequence){
    seenSequence=state.sequence;selected=null;
    if(state.ackNeeded && game.events.length){eventQueue=[...game.events];activeEvent=eventQueue[0];render();presentNextEvent();return;}
    lastAction=null;
  }
  if(!activeEvent && (!previous || previous.revision!==state.revision || previous.allConnected!==state.allConnected || hadError))render();
  if(!activeEvent && state.ackNeeded && confirmedSequence===state.sequence && !network.requesting)sendOnline('ack',{sequence:state.sequence});
}
async function sendOnline(action,payload={}) {
  if(network.requesting)return;
  const request=network.command(action,payload);
  if(game && !activeEvent)render();
  await request;
  if(online && game && !activeEvent)render();
}
function connectionNotice() {
  if(!online)return '';
  return `<div class="online-bar"><span><i class="${networkError || !roomState.allConnected ? 'offline' : ''}"></i>通信対戦 · ${roomState.code}</span><button id="copy-invite" class="quiet">招待リンク</button><button id="leave-room" class="quiet">退出</button></div>${networkError ? `<p class="network-error" role="alert">${escapeHtml(networkError)}</p>` : ''}`;
}
function renderWaiting() {
  const r=roomState;
  app.innerHTML=`<section class="room-lobby"><span class="eyebrow">ONLINE ROOM</span><h1>対戦の準備</h1>${connectionNotice()}<div class="room-code"><span>招待コード</span><strong>${r.code}</strong><p>友人にコードか招待リンクを共有してください。</p></div><div class="room-members">${r.members.map(m=>`<div><span class="avatar">${m.host?'Ⅶ':'◇'}</span><b>${escapeHtml(m.name)}${m.self?'（あなた）':''}</b><small>${m.host?'ルーム作成者 · ':''}${m.connected?'接続中':'再接続を待っています'}</small></div>`).join('')}${Array.from({length:r.count-r.members.length},()=>'<div class="empty-seat">参加を待っています…</div>').join('')}</div><p>${escapeHtml(r.note || `${r.count}人そろったら、ルーム作成者が開始できます。`)}</p>${r.host?`<button id="online-start" class="primary" ${r.members.length!==r.count || !r.allConnected || network.requesting?'disabled':''}>対戦を開始する →</button>`:'<p class="waiting-message">ルーム作成者の開始を待っています。</p>'}<p id="invite-feedback" role="status"></p></section>`;
}
async function enterRoom(action) {
  if(entering)return;entering=true;
  const name=$('#online-name').value.trim(),code=$('#room-code-input').value.trim().toUpperCase();
  const message=$('#online-message');message.textContent='接続しています…';
  try{online=true;seenSequence=-1;await network.enter(action,{name,code,count:Number($('#online-count').value)});}
  catch(e){online=false;message.textContent=e.message;}
  finally{entering=false;}
}
async function resumeOnline(session=savedConnection()) {
  if(!session || entering)return;entering=true;seenSequence=-1;online=true;
  try{await network.connect(session);}catch(e){networkError=e.message;online=false;network.forget();lobby();}finally{entering=false;}
}
let presentationTimer = null, eventQueue = [], activeEvent = null, lastAction = null;
let presentationMode = 'normal';
try { presentationMode = localStorage.getItem('seven-vice-presentation') || 'normal'; } catch { /* 設定は任意 */ }
if (!['normal','slow','manual'].includes(presentationMode)) presentationMode = 'normal';
const actionDialog = $('#action-dialog');
$('#presentation-speed').value = presentationMode;
function clearPresentation() {
  clearTimeout(presentationTimer); eventQueue = []; activeEvent = null; lastAction = null;
  if (actionDialog.open) actionDialog.close();
}
function armPresentationTimer() {
  clearTimeout(presentationTimer);
  const duration = presentationMode === 'slow' ? 4200 : 2400;
  actionDialog.dataset.mode = presentationMode;
  actionDialog.style.setProperty('--reveal-duration', `${duration}ms`);
  const bar = $('.action-timer i');
  bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  if (activeEvent && presentationMode !== 'manual' && !document.hidden) presentationTimer = setTimeout(advancePresentation, duration);
}
function presentNextEvent() {
  activeEvent = eventQueue.shift();
  if (!activeEvent) {
    if(online){confirmedSequence=roomState.sequence;if(roomState.ackNeeded)sendOnline('ack',{sequence:roomState.sequence});}
    actionDialog.close(); render();
    if (game.turn === 0) $('.action-zone button')?.focus({ preventScroll:true });
    return;
  }
  const d = describeEvent(activeEvent, game.players);
  lastAction = d;
  const source = document.querySelector(`[data-player="${activeEvent.actor}"]`);
  const rect = source?.getBoundingClientRect();
  actionDialog.style.setProperty('--from-x', `${rect ? rect.left + rect.width / 2 - window.innerWidth / 2 : 0}px`);
  actionDialog.style.setProperty('--from-y', `${rect ? rect.top + rect.height / 2 - window.innerHeight / 2 : -160}px`);
  actionDialog.style.setProperty('--reveal-color', d.color);
  $('#action-content').innerHTML = `<div class="action-actor">${escapeHtml(d.actor || 'ラウンド終了')}<span>${escapeHtml(d.label)}</span></div><div class="action-reveal-cards">${d.types.map(t => card(t, { action:'reveal' })).join('') || '<span class="action-emblem">Ⅶ</span>'}</div><span class="eyebrow">${d.badge}</span><h2 id="action-title">${escapeHtml(d.title)}</h2><p class="action-subtitle">${escapeHtml(d.subtitle)}</p><p id="action-description">${escapeHtml(d.detail)}</p><span class="action-step">${eventQueue.length ? `このあと ${eventQueue.length} 件の効果・結果を表示` : '確認後に対戦を続けます'}</span>`;
  if (!actionDialog.open) actionDialog.showModal();
  armPresentationTimer();
}
function advancePresentation() { clearTimeout(presentationTimer); if (activeEvent) presentNextEvent(); }
function performAction(mutation) {
  clearTimeout(timer);
  mutation(); selected = null;
  eventQueue = [...(game.events || [])];
  // 演出中の入力とCPU処理を止め、結果を順番に見せる。
  activeEvent = eventQueue[0] || null;
  render();
  presentNextEvent();
}
actionDialog.addEventListener('cancel', event => { event.preventDefault(); advancePresentation(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); clearTimeout(presentationTimer); }
  else if (activeEvent) armPresentationTimer();
  else scheduleCpu();
});
let saved = null;
try { const candidate = JSON.parse(localStorage.getItem(STORAGE)); if (candidate?.version === 1 && [3, 4].includes(candidate.players?.length) && ['play','effect','round','game'].includes(candidate.status)) saved = candidate; } catch { /* 保存が利用できなくてもプレイ可能 */ }
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const art = t => `/images/${encodeURIComponent(`スクリーンショット 2026-10-08 ${CARDS[t].image}.png`)}`;
function card(t, { id = null, action = 'inspect', mini = false, count = 0, active = false } = {}) {
  const c = CARDS[t];
  return `<button class="card ${mini ? 'mini' : ''} ${active ? 'selected' : ''} type-${t}" style="--card-color:${c.color}" data-action="${action}" data-type="${t}" ${id !== null ? `data-id="${id}"` : ''} aria-label="${c.name}${count ? ` ${count}枚` : ''}：${escapeHtml(c.text)}" ${action === 'hand' && busy ? 'disabled' : ''}><img src="${art(t)}" alt="" ${mini ? 'loading="lazy"' : ''}><span class="card-shade"></span>${t === 6 ? '<span class="lust-seal" aria-hidden="true">Ⅶ</span>' : ''}<span class="card-title"><b>${c.name}</b><small>${c.en}</small></span>${!mini ? `<span class="card-text">${escapeHtml(c.text)}</span>` : ''}${count ? `<span class="card-count">×${count}</span>` : ''}${active ? '<span class="selected-tag">選択中</span>' : ''}</button>`;
}
function lobby() {
  clearPresentation();
  clearTimeout(timer); game = null; selected = null; busy = false;
  app.innerHTML = `<section class="lobby"><div class="hero-copy"><span class="eyebrow">THE SEVEN DEADLY SINS</span><h1>その大罪を、<br><em>奪い合え。</em></h1><p>七つの能力を使いこなし、勝利を手繰り寄せる。<br>一枚の選択が、場の運命を変える。</p><div class="setup"><label for="player-count">対戦人数</label><select id="player-count"><option value="3">3人 · あなた ＋ CPU 2人</option><option value="4">4人 · あなた ＋ CPU 3人</option></select><button id="start-game" class="primary">対戦を始める <span>→</span></button>${saved ? '<button id="resume-game" class="quiet">保存した対戦を再開 →</button>' : ''}<small>CPU対戦 / ログイン不要 / 進行を自動保存</small></div></div><div class="hero-art" aria-label="セブンヴァイスのカード"><div class="hero-ring"></div>${[3, 0, 2].map(t => card(t)).join('')}<span class="hero-caption">Ⅶ &nbsp; COLLECT YOUR SINS</span></div></section><section class="online-setup"><div><span class="eyebrow">PLAY WITH FRIENDS</span><h2>友人と通信対戦</h2><p>ルームを作って招待コードを共有。<br>3〜4人で、それぞれの端末から遊べます。</p></div><div class="online-form"><label for="online-name">プレイヤー名</label><input id="online-name" maxlength="16" placeholder="名前を入力" autocomplete="nickname" value="${escapeHtml(savedConnection()?.name || '')}"><label for="online-count">対戦人数</label><select id="online-count"><option value="3">3人</option><option value="4">4人</option></select><button id="online-create" class="primary">ルームを作る →</button><label for="room-code-input">招待コード</label><input id="room-code-input" maxlength="6" placeholder="6桁のコード" value="${escapeHtml(new URLSearchParams(location.search).get('room')?.slice(0,6) || '')}"><button id="online-join" class="quiet">コードで参加する →</button>${savedConnection() ? '<button id="online-resume" class="quiet">前のルームに戻る →</button>' : ''}<p id="online-message" role="status">${escapeHtml(networkError)}</p></div></section><section class="intro-strip"><div><b>01</b><span>引く。選ぶ。出す。<small>手札2枚から、次の一手を。</small></span></div><div><b>02</b><span>効果で奪い合う。<small>七つの大罪、それぞれの力。</small></span></div><div><b>03</b><span>先に3点で勝利。<small>同種4枚で1点、7種類で2点。</small></span></div></section>`;
}
function persist() { if(online)return;try { localStorage.setItem(STORAGE, JSON.stringify(game)); saved = game; } catch { /* 保存不可でも対戦は継続 */ } }
function field(p) {
  if (!p.field.length) return '<div class="empty-field">カードはまだありません</div>';
  return `<div class="field-cards">${CARDS.flatMap((_, t) => { const n = p.field.filter(id => typeOf(id) === t).length; return n ? [card(t, { mini: true, count: n })] : []; }).join('')}</div>`;
}
function score(p) { return `<span class="score" aria-label="${p.score}点">${Array.from({length:3}, (_,i) => `<i class="${i < p.score ? 'filled' : ''}">◆</i>`).join('')}<b>${p.score}<small> / 3</small></b></span>`; }
function player(p, i) {
  return `<section data-player="${i}" class="player ${lastAction?.targets.includes(i) ? 'action-highlight' : ''} ${game.turn === i && ['play','effect'].includes(game.status) ? 'current' : ''}"><div class="player-head"><span class="avatar">${i ? `0${i}` : 'YOU'}</span><div><b>${escapeHtml(p.name)}</b><small>${i === 0 ? 'あなたの場' : `手札 ${p.hand.length}枚`}${online && p.connected === false ? ' · 切断中' : ''}${game.turn === i && ['play','effect'].includes(game.status) ? ' · 手番' : ''}</small></div>${score(p)}</div>${field(p)}<div class="collection-progress"><span>${new Set(p.field.map(typeOf)).size} / 7 種類</span><div>${CARDS.map((c,t) => `<i style="--card-color:${c.color}" class="${p.field.some(id => typeOf(id) === t) ? 'collected' : ''}" title="${c.name}"></i>`).join('')}</div></div></section>`;
}
function optionLabel(o) {
  const effect = game.pending.effect;
  return effect === 0 ? `${game.players[o.target].name}の手札を奪う` : `${game.players[o.target].name}の「${cardOf(o.ids[0]).name}」${o.ids.length}枚${effect === 1 ? 'と交換' : 'を奪う'}`;
}
function controls() {
  if (activeEvent) return '<div class="cpu-wait"><h3>カードの行動を表示しています</h3><p>表示が終わるまで次の手番は進みません。</p></div>';
  if(online && (roomState.locked || network.requesting || networkError))return `<div class="cpu-wait"><h3>${networkError?'接続を確認しています':!roomState.allConnected?'全員の接続を待っています':'全員の確認を待っています'}</h3><p>${escapeHtml(networkError || (roomState.waitingNames.length?`${roomState.waitingNames.join('、')}がカード演出を確認中です。`:'通信が戻ると続けられます。'))}</p></div>`;
  if (game.status === 'round' || game.status === 'game') {
    const r = game.result;
    return `<div class="round-result"><span class="eyebrow">${game.status === 'game' ? 'VICTORY' : 'ROUND COMPLETE'}</span><h2>${r.winner === null ? 'このラウンドは引き分け' : `${escapeHtml(game.players[r.winner].name)}${game.status === 'game' ? 'の勝利！' : `が${r.earned}点獲得！`}`}</h2><p>${game.status === 'game' ? '七つの大罪を制した勝者が決まりました。' : '場のカードを戻し、シャッフルして次のラウンドへ。'}</p>${online && !roomState.host ? '<p>ルーム作成者の操作を待っています。</p>' : `<button class="primary" id="${game.status === 'game' ? 'new-game' : 'next-round'}">${game.status === 'game' ? 'もう一度遊ぶ' : '次のラウンドへ'} →</button>`}</div>`;
  }
  if (game.turn !== 0) return `<div class="cpu-wait"><span class="thinking">◆</span><h3>${escapeHtml(game.players[game.turn].name)}の手番</h3><p>${online?'相手のカード選択を待っています。':'次の一手を考えています…'}</p><div class="waiting-hand">${game.players[0].hand.map(id => card(typeOf(id), { mini:true })).join('')}</div></div>`;
  if (game.status === 'effect') return `<div class="effect-picker"><span class="eyebrow">CHOOSE A TARGET</span><h3>「${CARDS[game.pending.effect].name}」の対象を選ぶ</h3><p>${CARDS[game.pending.effect].text}</p><div class="effect-options">${game.pending.options.map((o,i) => `<button class="target-option" data-action="target" data-option="${i}">${game.pending.effect !== 0 ? `<img src="${art(typeOf(o.ids[0]))}" alt="">` : '<span class="hidden-card">Ⅶ</span>'}<span>${escapeHtml(optionLabel(o))}</span><b>→</b></button>`).join('')}</div></div>`;
  return `<div class="hand-area"><div class="hand-heading"><div><span class="eyebrow">YOUR TURN</span><h3>場に出すカードを選んでください</h3></div><span class="hand-count">手札 ${game.players[0].hand.length}枚</span></div><div class="hand-cards">${game.players[0].hand.map(id => card(typeOf(id), { id, action:'hand', active: selected === id })).join('')}<div class="play-guide">${selected === null ? '<span class="guide-symbol">◇</span><p>カードを選ぶと<br>効果を確認できます。</p>' : `<span class="eyebrow">${cardOf(selected).en}</span><h3 style="color:${cardOf(selected).color}">${cardOf(selected).name}</h3><p>${cardOf(selected).text}</p><button id="play-selected" class="primary">このカードを出す →</button>`}</div></div></div>`;
}
function render() {
  busy = Boolean(activeEvent) || game.turn !== 0 || game.status !== 'play' || (online && (roomState.locked || network.requesting || Boolean(networkError)));
  app.innerHTML = `${connectionNotice()}<section class="game-heading"><div><span class="eyebrow">THE TABLE</span><h1>大罪の争奪戦</h1></div><div class="game-meta"><span>ROUND <b>${String(game.round).padStart(2, '0')}</b></span>${online ? '' : '<label class="speed-label">CPU速度 <select id="cpu-speed"><option value="1000">通常</option><option value="350">速い</option></select></label><button id="restart-game" class="quiet">新しい対戦</button>'}</div></section><div class="game-layout"><div class="table"><div class="opponents opponents-${game.players.length - 1}">${game.players.slice(1).map((p, i) => player(p,i+1)).join('')}</div><div class="table-center"><div class="deck"><span>Ⅶ</span><small>SEVEN VICE</small></div><div><span class="eyebrow">DRAW PILE</span><p>山札 <strong>${game.deck.length}</strong> 枚</p><small>${game.deck.length ? '同種4枚、または7種類を集めよう' : '残った手札で続行します'}</small></div><div class="turn-indicator"><i></i>${['round','game'].includes(game.status) ? 'ラウンド終了' : `${escapeHtml(game.players[game.turn].name)}の手番`}</div></div>${lastAction ? `<div class="last-action" role="status" style="--reveal-color:${lastAction.color}"><span>${escapeHtml(lastAction.actor || 'ラウンド終了')}</span><strong>${escapeHtml(lastAction.subtitle)}</strong><small>${escapeHtml(lastAction.detail)}</small></div>` : ''}${player(game.players[0],0)}<section class="action-zone" aria-live="polite">${controls()}</section></div><aside class="sidebar"><section class="goal-panel"><span class="eyebrow">WIN CONDITIONS</span><h3>勝利への道</h3><div><strong>4<span>枚</span></strong><p>同じ種類を集める<b>＋1点</b></p></div><div><strong>7<span>種類</span></strong><p>すべての種類を集める<b>＋2点</b></p></div><p class="goal-note">先に <b>3点</b> 獲得した人が勝利</p></section><section class="log-panel"><div class="panel-heading"><span class="eyebrow">GAME LOG</span><span>対戦記録</span></div><ol>${game.log.slice(0,18).map((line,i) => `<li class="${i === 0 ? 'latest' : ''}"><i></i>${escapeHtml(line)}</li>`).join('')}</ol></section><button id="rules-inline" class="quiet sidebar-rule">カードの効果・遊び方 ↗</button></aside></div>`;
  if($('#cpu-speed'))$('#cpu-speed').value = String(speed);
  persist();
  scheduleCpu();
}
let speed = 1000;
function scheduleCpu() {
  clearTimeout(timer);
  if (online || !game || activeEvent || document.hidden || document.querySelector('dialog[open]') || game.turn === 0 || !['play','effect'].includes(game.status)) return;
  timer = setTimeout(() => { if (document.hidden || activeEvent || document.querySelector('dialog[open]')) return; try { performAction(() => { if (game.status === 'effect') resolveEffect(game, chooseCpu(game)); else playCard(game, chooseCpu(game)); }); } catch (e) { showError(e); } }, speed);
}
function showError(e) { clearTimeout(timer); const zone = $('.action-zone'); if (zone) { zone.textContent = `対戦の処理でエラーが発生しました：${e.message}。上の「新しい対戦」からやり直せます。`; } console.error(e); }
function showRules() { clearTimeout(timer); $('#rules-dialog').showModal(); }
$('#rule-cards').innerHTML = CARDS.map((c,t) => `<div class="rule-card"><img src="${art(t)}" alt=""><div><h3 style="color:${c.color}">${c.name} <small>${c.en}</small></h3><p>${c.text}</p></div></div>`).join('');
$('#rules-button').addEventListener('click', showRules);
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  const close = button.dataset.close; if (close) { document.getElementById(close).close(); if (game) scheduleCpu(); return; }
  try {
    if (button.id === 'acknowledge-action') { advancePresentation(); return; }
    if (activeEvent) return;
    if(button.id==='online-create'){enterRoom('create');return;}
    if(button.id==='online-join'){enterRoom('join');return;}
    if(button.id==='online-resume'){resumeOnline();return;}
    if(button.id==='online-start'){sendOnline('start');return;}
    if(button.id==='leave-room'){$('#leave-dialog').showModal();return;}
    if(button.id==='confirm-leave'){
      $('#leave-dialog').close();
      network.command('leave').then(()=>{if(!network.session){online=false;roomState=null;clearPresentation();history.replaceState(null,'',location.pathname);lobby();}});return;
    }
    if(button.id==='copy-invite'){
      const link=`${location.origin}${location.pathname}?room=${roomState.code}`;
      navigator.clipboard?.writeText(link).then(()=>{const label=$('#invite-feedback');if(label)label.textContent='招待リンクをコピーしました。';else button.textContent='コピーしました';}).catch(()=>{window.prompt('この招待リンクをコピーしてください',link);});
      if(!navigator.clipboard)window.prompt('この招待リンクをコピーしてください',link);return;
    }
    if(online){
      if(roomState.locked || network.requesting || networkError)return;
      if(button.id==='next-round'){sendOnline('next');return;}
      if(button.id==='new-game'){sendOnline('restart');return;}
      if(button.id==='play-selected' && selected!==null){sendOnline('play',{id:selected});return;}
      if(button.dataset.action==='target'){sendOnline('effect',{option:Number(button.dataset.option)});return;}
    }
    if (button.id === 'start-game') { game = createGame(Number($('#player-count').value)); render(); }
    else if (button.id === 'resume-game') { game = structuredClone(saved); render(); }
    else if (button.id === 'rules-inline') showRules();
    else if (button.id === 'restart-game') { clearTimeout(timer); $('#restart-dialog').showModal(); }
    else if (button.id === 'confirm-restart') { $('#restart-dialog').close(); clearPresentation(); game = createGame(game.players.length); selected = null; render(); }
    else if (button.id === 'new-game') { clearPresentation(); game = createGame(game.players.length); selected = null; render(); }
    else if (button.id === 'next-round') { clearPresentation(); nextRound(game); selected = null; render(); }
    else if (button.dataset.action === 'hand' && game?.turn === 0 && game.status === 'play') { selected = Number(button.dataset.id); render(); }
    else if (button.id === 'play-selected' && selected !== null && game?.turn === 0 && game.status === 'play') { const id = selected; performAction(() => playCard(game, id)); }
    else if (button.dataset.action === 'target' && game?.turn === 0 && game.status === 'effect') { performAction(() => resolveEffect(game, Number(button.dataset.option))); }
    else if (button.dataset.action === 'inspect') { clearTimeout(timer); const t = Number(button.dataset.type); $('#card-detail').innerHTML = `<div class="detail-card">${card(t)}</div><h2 style="color:${CARDS[t].color}">${CARDS[t].name}</h2><p>${CARDS[t].text}</p>`; $('#card-dialog').showModal(); }
  } catch (e) { showError(e); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'cpu-speed') { speed = Number(event.target.value); scheduleCpu(); }
  if (event.target.id === 'presentation-speed') { presentationMode = event.target.value; try { localStorage.setItem('seven-vice-presentation',presentationMode); } catch { /* 設定は任意 */ } armPresentationTimer(); }
});
$('#restart-dialog').addEventListener('close', () => { if (game) scheduleCpu(); });
for (const dialog of document.querySelectorAll('dialog:not(#action-dialog)')) {
  dialog.addEventListener('close', () => { if (game) scheduleCpu(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
}
lobby();
if(activeConnection())resumeOnline(activeConnection());
else if(new URLSearchParams(location.search).has('room'))$('#online-name').scrollIntoView({block:'center'});
