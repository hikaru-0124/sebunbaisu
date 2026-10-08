import { CARDS, cardOf, typeOf } from './engine.js';

export function describeEvent(event, players) {
  const actor = event.actor === null ? '' : players[event.actor].name;
  const target = event.target === null || event.target === undefined ? '山札' : players[event.target].name;
  const common = { actor, targets: [event.actor, event.target].filter(i => Number.isInteger(i)), types: [] };
  if (event.kind === 'play') {
    const c = CARDS[event.type];
    return { ...common, label:'カードを出しました', title:c.name, subtitle:`${actor}が「${c.name}」を場に出した！`, detail:event.type === 5 ? (event.effect === null ? '直前の効果がないため、今回は効果なし。' : `「${CARDS[event.effect].name}」をコピー：${CARDS[event.effect].text}`) : c.text, types:[event.type], color:c.color, badge:c.en };
  }
  if (event.kind === 'gain') {
    const c = cardOf(event.ids[0]);
    return { ...common, label:'カードが移動しました', title:`${c.name} ×${event.ids.length}`, subtitle:`${actor}が${target}${event.target === null ? 'から引いて場に置いた' : 'から奪った'}！`, detail:`${target}${event.effect === 0 ? 'の手札' : event.target === null ? '' : 'の場'} → ${actor}の場${event.refilled ? '。相手は山札から手札を補充。' : ''}`, types:event.ids.map(typeOf), color:c.color, badge:'CARD MOVE' };
  }
  if (event.kind === 'swap') {
    const taken = cardOf(event.ids[0]), given = cardOf(event.given);
    return { ...common, label:'カードを交換しました', title:`${given.name} ⇄ ${taken.name}`, subtitle:`${actor}と${target}が交換！`, detail:`${actor}の手札「${given.name}」 → ${target}の場 / ${target}の場「${taken.name}」 → ${actor}の手札`, types:[typeOf(event.given),typeOf(event.ids[0])], color:CARDS[1].color, badge:'EXCHANGE' };
  }
  if (event.kind === 'extra') return { ...common, label:'傲慢の効果', title:'もう一度！', subtitle:`${actor}の追加手番`, detail:'山札から引き、もう1枚カードを出します。', color:CARDS[3].color, badge:'EXTRA TURN' };
  if (event.kind === 'empty') return { ...common, label:'効果の結果', title:'対象なし', subtitle:`${actor}の「${CARDS[event.effect].name}」`, detail:'対象となるカードがないため、効果を終了します。', color:CARDS[event.effect].color, badge:'NO TARGET' };
  return { ...common, label:event.victory ? '対戦終了' : 'ラウンド終了', title:event.actor === null ? '引き分け' : `＋${event.earned}点`, subtitle:event.actor === null ? '全員の手札がなくなりました' : `${actor}${event.victory ? 'の勝利！' : 'がセットを完成！'}`, detail:event.actor === null ? '無得点で次のラウンドへ進みます。' : `合計 ${players[event.actor].score}点 / 勝利まで3点`, color:'#d6b881', badge:event.victory ? 'VICTORY' : 'ROUND COMPLETE' };
}
