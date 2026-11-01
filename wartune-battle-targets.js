'use strict';
/** Resolves ACTUAL hit records, not just distinct enemy targets.
 * AcceptObject=2 (archer 208xx Multi Shot): two hits, even against one monster.
 * AcceptObject=12: two different random enemies when available, one if only one.
 * AcceptObject=3: all enemies. Other attack skills target one enemy.
 */
function choose(skill,units,random=Math.random){
 const alive=(units||[]).filter(m=>m && Number(m.hp)>0);
 if(!alive.length)return [];
 const code=Number(skill?.AcceptObject||0);
 const rand=()=>{const n=Number(random());if(!Number.isFinite(n)||n<0||n>=1)throw Error('RNG invalido');return n;};
 const pick=arr=>arr[Math.floor(rand()*arr.length)];
 if(code===3)return alive.slice();
 if(code===2){
  const a=pick(alive),other=alive.filter(x=>Number(x.livingId)!==Number(a.livingId));
  return [a,other.length?pick(other):a];
 }
 if(code===12){
  const a=pick(alive),other=alive.filter(x=>Number(x.livingId)!==Number(a.livingId));
  return other.length?[a,pick(other)]:[a];
 }
 return [pick(alive)];
}
module.exports={choose};
