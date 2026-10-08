export const CARDS = [
  { name: '憤怒', en: 'WRATH', color: '#e96165', image: '151123', text: '他プレイヤーの手札を1枚奪い、自分の場に置く。取られた相手は山札から手札を補充する。' },
  { name: '嫉妬', en: 'ENVY', color: '#b597eb', image: '151131', text: '他プレイヤーの場のカード1枚と、自分の手札を交換する。' },
  { name: '強欲', en: 'GREED', color: '#e7bd5e', image: '151145', text: '他プレイヤーの場のカードを1枚選び、奪って自分の場に置く。' },
  { name: '傲慢', en: 'PRIDE', color: '#6eafe0', image: '151157', text: 'もう一度、自分の手番を行う。引いて出したカードの効果も使う。' },
  { name: '暴食', en: 'GLUTTONY', color: '#8fcb8b', image: '151229', text: '右隣のプレイヤーの場から、同じ種類のカードを最大2枚奪う。' },
  { name: '怠惰', en: 'SLOTH', color: '#e49b72', image: '151243', text: '直前に使用された効果を使う。傲慢の追加手番でも傲慢をコピーできる。' },
  { name: '色欲', en: 'LUST', color: '#e38cbd', image: '151331', text: '山札の一番上のカードを1枚取り、自分の場に置く。' },
];
export const typeOf = id => Math.floor(id / 5);
export const cardOf = id => CARDS[typeOf(id)];
export function points(field) {
  const counts = new Map();
  for (const id of field) counts.set(typeOf(id), (counts.get(typeOf(id)) || 0) + 1);
  return counts.size === 7 ? 2 : [...counts.values()].some(n => n >= 4) ? 1 : 0;
}
function log(s, message) { s.log.unshift(message); s.log = s.log.slice(0, 60); }
// 演出には公開されたカードと移動だけを渡す。補充した手札は含めない。
function event(s, value) { (s.events ||= []).push(value); }
function shuffle(random) {
  const deck = Array.from({ length: 35 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function createGame(count = 3, random = Math.random) {
  if (![3, 4].includes(count)) throw new Error('プレイヤー人数は3人か4人です。');
  const s = { version: 1, players: Array.from({ length: count }, (_, i) => ({ name: i ? `CPU ${i}` : 'あなた', hand: [], field: [], score: 0 })), deck: [], turn: Math.floor(random() * count), starter: 0, round: 0, lastEffect: null, status: 'round', pending: null, result: null, log: [] };
  s.starter = s.turn;
  nextRound(s, random);
  return s;
}
function beginTurn(s) {
  if (s.deck.length) s.players[s.turn].hand.push(s.deck.pop());
  s.status = 'play';
  // 山札が空で手札もないプレイヤーの手番は自動で飛ばす。
  if (!s.players[s.turn].hand.length) {
    s.turn = (s.turn + 1) % s.players.length;
    if (s.players.some(p => p.hand.length)) beginTurn(s);
    else finishRound(s, null, 0);
  }
}
export function nextRound(s, random = Math.random) {
  if (s.status !== 'round') throw new Error('次のラウンドへ進めません。');
  s.deck = shuffle(random);
  for (const p of s.players) { p.field = []; p.hand = [s.deck.pop()]; }
  s.round++;
  s.turn = s.starter;
  s.lastEffect = null;
  s.pending = null;
  s.result = null;
  s.events = [];
  log(s, `ラウンド ${s.round} 開始。${s.players[s.turn].name}が先手。`);
  beginTurn(s);
}
function finishRound(s, winner, earned) {
  s.pending = null;
  if (winner !== null) {
    s.players[winner].score += earned;
    s.starter = winner;
    log(s, `${s.players[winner].name}が${earned}点獲得！`);
  } else log(s, '全員の手札がなくなりました。このラウンドは無得点です。');
  s.result = { winner, earned };
  s.status = winner !== null && s.players[winner].score >= 3 ? 'game' : 'round';
  event(s, { kind: 'score', actor: winner, earned, victory: s.status === 'game' });
}
function complete(s, effect) {
  s.lastEffect = effect;
  s.pending = null;
  // 嫉妬によって相手がそろう場合も判定。手番プレイヤーを優先。
  for (let i = 0; i < s.players.length; i++) {
    const index = (s.turn + i) % s.players.length;
    const earned = points(s.players[index].field);
    if (earned) { finishRound(s, index, earned); return; }
  }
  if (!s.deck.length && s.players.every(p => !p.hand.length)) { finishRound(s, null, 0); return; }
  if (effect !== 3) s.turn = (s.turn + 1) % s.players.length;
  else { log(s, `${s.players[s.turn].name}の追加手番。`); event(s, { kind: 'extra', actor: s.turn }); }
  beginTurn(s);
}
export function playCard(s, id) {
  if (s.status !== 'play') throw new Error('カードを出せる状態ではありません。');
  const p = s.players[s.turn];
  const index = p.hand.indexOf(id);
  if (index < 0) throw new Error('手札にないカードです。');
  s.events = [];
  p.hand.splice(index, 1);
  p.field.push(id);
  const type = typeOf(id);
  const effect = type === 5 ? s.lastEffect : type;
  event(s, { kind: 'play', actor: s.turn, type, effect });
  log(s, `${p.name}が「${CARDS[type].name}」を出しました。${type === 5 ? (effect === null ? 'コピーする効果はありません。' : `「${CARDS[effect].name}」の効果を使用。`) : ''}`);
  const options = [];
  if (effect === 0) {
    s.players.forEach((other, target) => { if (target !== s.turn && other.hand.length) options.push({ target, ids: [other.hand[0]] }); });
  } else if (effect === 1 || effect === 2) {
    if (effect !== 1 || p.hand.length) s.players.forEach((other, target) => { if (target !== s.turn) for (const card of other.field) options.push({ target, ids: [card] }); });
  } else if (effect === 4) {
    // 手番順は時計回り。右隣はその一つ前の席。
    const target = (s.turn + s.players.length - 1) % s.players.length;
    for (let t = 0; t < 7; t++) {
      const matches = s.players[target].field.filter(card => typeOf(card) === t);
      for (let n = 1; n <= Math.min(2, matches.length); n++) options.push({ target, ids: matches.slice(0, n) });
    }
  } else if (effect === 6 && s.deck.length) {
    const card = s.deck.pop(); p.field.push(card);
    event(s, { kind: 'gain', actor: s.turn, target: null, ids: [card], effect });
    log(s, `${p.name}が山札から「${cardOf(card).name}」を場に置きました。`);
  }
  if (options.length) { s.pending = { effect, options }; s.status = 'effect'; }
  else { if ([0, 1, 2, 4, 6].includes(effect) && !(effect === 6 && s.events.some(e => e.kind === 'gain'))) { log(s, '対象がないため効果の処理を終了。'); event(s, { kind:'empty', actor:s.turn, effect }); } complete(s, effect); }
}
export function resolveEffect(s, optionIndex) {
  if (s.status !== 'effect') throw new Error('効果を選択できる状態ではありません。');
  const choice = s.pending.options[optionIndex];
  if (!choice) throw new Error('無効な選択です。');
  s.events = [];
  const effect = s.pending.effect;
  const p = s.players[s.turn];
  const other = s.players[choice.target];
  const source = effect === 0 ? other.hand : other.field;
  for (const card of choice.ids) source.splice(source.indexOf(card), 1);
  if (effect === 1) {
    const given = p.hand.pop(); other.field.push(given); p.hand.push(choice.ids[0]);
    event(s, { kind: 'swap', actor: s.turn, target: choice.target, ids: choice.ids.slice(), given, effect });
    log(s, `${p.name}が${other.name}の「${cardOf(choice.ids[0]).name}」と手札の「${cardOf(given).name}」を交換。`);
  } else {
    p.field.push(...choice.ids);
    event(s, { kind: 'gain', actor: s.turn, target: choice.target, ids: choice.ids.slice(), effect, refilled: effect === 0 && s.deck.length > 0 });
    log(s, `${p.name}が${other.name}から「${cardOf(choice.ids[0]).name}」を${choice.ids.length}枚獲得。`);
    if (effect === 0 && s.deck.length) { other.hand.push(s.deck.pop()); log(s, `${other.name}が山札から手札を補充。`); }
  }
  complete(s, effect);
}
function value(field, type) {
  const n = field.filter(id => typeOf(id) === type).length;
  const unique = new Set(field.map(typeOf)).size;
  return n >= 3 ? 100 : n === 0 ? 9 + unique * 2 : n * 7;
}
export function chooseCpu(s) {
  const p = s.players[s.turn];
  if (s.status === 'effect') {
    let best = 0, score = -Infinity;
    s.pending.options.forEach((o, i) => {
      // 憤怒は相手の非公開の手札を評価に使用しない。
      const v = s.pending.effect === 0 ? s.players[o.target].score * 3 + s.players[o.target].field.length : value(p.field, typeOf(o.ids[0])) * o.ids.length + s.players[o.target].score * 2;
      if (v > score) { score = v; best = i; }
    });
    return best;
  }
  let best = p.hand[0], score = -Infinity;
  for (const id of p.hand) {
    const t = typeOf(id);
    const effect = t === 5 ? s.lastEffect : t;
    const v = value(p.field, t) + ([0, 2, 3, 4, 6].includes(effect) ? 6 : 0);
    if (v > score) { score = v; best = id; }
  }
  return best;
}
