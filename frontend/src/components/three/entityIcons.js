/* Entity icons for the 3D graph, ported from Ayaana's prototype (index3d.html, "Sample v2/v3").
   The ICON drawing functions below are her artwork, copied as-is (only the case-file caption
   became a parameter so documents can read "EVIDENCE"). Each entity becomes a canvas texture:
   her silhouette (hexagon person, phone, laptop, shield account, pin location, folder case),
   the artwork clipped inside it, a ring and a badge. */
/* eslint-disable */
import * as THREE from 'three';

const rng=s=>()=>(s=(s*9301+49297)%233280)/233280;
const rrp=(c,x,y,w,h,r)=>{c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r)};
const rr=(g,x,y,w,h,r)=>{g.beginPath();rrp(g,x,y,w,h,r);g.closePath()};
const digits=n=>(n.name.match(/\d+/)||[''])[0];
// ---------- icons: every entity type / subtype has its own drawn artwork (128-unit space, scaled to 192px) ----------
const ICON={
person(g,n){const r=rng(n.id*7+3),pick=a=>a[Math.floor(r()*a.length)],skin=pick(['#f1c27d','#e0ac69','#c68642','#8d5524','#ffdbac']),hair=pick(['#1b1b1b','#3b2417','#6b4423','#a0522d','#b8b8b8','#d4a017']),shirt=pick(['#4cc9f0','#f72585','#ffb703','#80ed99','#b388ff','#ff6b35']),f=n.g==='f',st=r(),gl=r()<.45,bd=!f&&r()<.45,sus=n.role==='suspect';
const ell=(x,y,a,b)=>{g.beginPath();g.ellipse(x,y,a,b,0,0,7);g.fill()};
if(sus){g.fillStyle='#1a2034';ell(64,60,36,40)}
if(f){g.fillStyle=hair;ell(64,72,31,44)}
g.fillStyle=sus?'#232c47':shirt;ell(64,134,54,38);
g.fillStyle=skin;g.fillRect(56,82,16,22);g.fillStyle='#0003';g.fillRect(56,82,16,8);
if(sus){g.strokeStyle='#cfd6ee';g.lineWidth=2;g.beginPath();g.moveTo(58,100);g.lineTo(56,116);g.moveTo(70,100);g.lineTo(72,116);g.stroke()}
else{g.fillStyle='#f4f6ff';g.beginPath();g.moveTo(50,94);g.lineTo(64,110);g.lineTo(78,94);g.lineTo(73,88);g.lineTo(64,100);g.lineTo(55,88);g.closePath();g.fill()}
g.fillStyle=skin;ell(40,62,4,7);ell(88,62,4,7);ell(64,60,24,28);
const fg=g.createLinearGradient(40,0,88,0);fg.addColorStop(0,'#0000');fg.addColorStop(1,'#0003');g.fillStyle=fg;ell(64,60,24,28);
g.fillStyle=hair;
if(f||st>.45){g.beginPath();g.ellipse(64,46,25,19,0,Math.PI,0);g.fill()}
else if(st>.15){g.fillStyle=shirt;g.beginPath();g.ellipse(64,46,26,20,0,Math.PI,0);g.fill();g.fillRect(38,44,62,6)}
if(bd){g.fillStyle=hair;g.beginPath();g.ellipse(64,72,21,17,0,0,Math.PI);g.fill()}
if(sus){g.strokeStyle='#1a2034';g.lineWidth=7;g.beginPath();g.ellipse(64,56,28,33,0,Math.PI*1.04,Math.PI*1.96);g.stroke()}
g.fillStyle='#fff';ell(54,60,5,3.6);ell(74,60,5,3.6);g.fillStyle='#111';ell(55,60,2.6,2.6);ell(75,60,2.6,2.6);
g.strokeStyle='#2b2b2b';g.lineWidth=2.4;g.beginPath();if(sus){g.moveTo(47,50);g.lineTo(60,53);g.moveTo(68,53);g.lineTo(81,50)}else{g.moveTo(48,52);g.lineTo(60,51);g.moveTo(68,51);g.lineTo(80,52)}g.stroke();
g.strokeStyle='#0003';g.lineWidth=2;g.beginPath();g.moveTo(64,60);g.lineTo(62,69);g.lineTo(66,69);g.stroke();
g.strokeStyle=f?'#c2185b':bd?'#ddd':'#6b2f1a';g.lineWidth=3;g.beginPath();if(sus){g.moveTo(57,74);g.lineTo(71,74)}else g.arc(64,68,9,.15*Math.PI,.85*Math.PI);g.stroke();
if(gl){g.strokeStyle='#111';g.lineWidth=2;g.beginPath();g.arc(54,60,8,0,7);g.moveTo(82,60);g.arc(74,60,8,0,7);g.moveTo(62,60);g.lineTo(66,60);g.stroke()}},
android(g,n,col){rr(g,33.5,7.5,61,113,10);g.fillStyle='#0b1022';g.fill();
const sg=g.createLinearGradient(0,14,0,112);sg.addColorStop(0,'#203a7a');sg.addColorStop(1,'#0b1a3a');rr(g,38.5,13,51,99,6);g.fillStyle=sg;g.fill();
g.fillStyle='#000';g.beginPath();g.arc(64,19,2.5,0,7);g.fill();
g.fillStyle='#cfe0ff';g.font='bold 7px sans-serif';g.textAlign='left';g.fillText('9:41',42,23);g.fillRect(78,20,7,3.5);
g.fillStyle='#4cc9f0cc';rr(g,42,32,34,12,5);g.fill();g.fillStyle='#f72585d9';rr(g,52,48,34,12,5);g.fill();g.fillStyle='#4cc9f0cc';rr(g,42,64,26,12,5);g.fill();
g.fillStyle='#fffa';g.fillRect(47,37,22,2);g.fillRect(57,53,22,2);g.fillRect(47,69,14,2);
g.fillStyle='#ffffff1c';rr(g,42,82,44,14,4);g.fill();g.fillStyle='#80ed99';g.beginPath();g.arc(49,89,3.2,0,7);g.fill();g.fillStyle='#fff9';g.fillRect(56,86,24,2);g.fillRect(56,90,16,2);
g.fillStyle='#ffffff0f';g.beginPath();g.moveTo(38.5,13);g.lineTo(72,13);g.lineTo(38.5,62);g.closePath();g.fill();
g.fillStyle='#ffffffaa';g.beginPath();g.arc(52,105,2.4,0,7);g.fill();g.fillRect(61.5,102.5,5,5);g.beginPath();g.moveTo(76,102.5);g.lineTo(76,107.5);g.lineTo(80.5,105);g.closePath();g.fill();
g.strokeStyle=col;g.lineWidth=3;rr(g,33.5,7.5,61,113,10);g.stroke()},
iphone(g,n,col){rr(g,33.5,7.5,61,113,12);g.fillStyle='#0b1022';g.fill();
const sg=g.createLinearGradient(0,14,64,112);sg.addColorStop(0,'#3a2a7a');sg.addColorStop(1,'#1a2a5a');rr(g,38,12.5,52,103,8);g.fillStyle=sg;g.fill();
g.fillStyle='#000';rr(g,53,16,22,6,3);g.fill();
['#4cc9f0','#f72585','#ffb703','#80ed99','#b388ff','#ff6b35','#4cc9f0','#80ed99','#f72585','#ffb703','#b388ff','#4cc9f0'].forEach((c,i)=>{g.fillStyle=c;rr(g,43+(i%3)*15,30+Math.floor(i/3)*17,11,11,3);g.fill()});
g.fillStyle='#ffffff26';rr(g,41,96,46,14,6);g.fill();
['#80ed99','#4cc9f0','#ffb703','#f72585'].forEach((c,i)=>{g.fillStyle=c;rr(g,43.5+i*11,99,8,8,2.5);g.fill()});
g.fillStyle='#ffffffcc';rr(g,54,112,20,2.5,1.2);g.fill();
g.strokeStyle='#cbd3ea';g.lineWidth=3;rr(g,33.5,7.5,61,113,12);g.stroke()},
laptop(g,n,col){rr(g,10,27,108,66,5);g.fillStyle='#0b1022';g.fill();g.strokeStyle='#9aa6c8';g.lineWidth=2;g.stroke();
const sg=g.createLinearGradient(0,32,0,88);sg.addColorStop(0,'#10204a');sg.addColorStop(1,'#08122c');rr(g,15,32,98,55,2);g.fillStyle=sg;g.fill();
g.fillStyle='#9aa6c8';g.beginPath();g.arc(64,29.5,1.2,0,7);g.fill();
g.font='bold 7px monospace';g.textAlign='left';
[['$ ssh dxb-gw','#80ed99'],['login: ok','#cfe0ff'],['$ scp ledger.xlsx','#80ed99'],['transfer 100%','#4cc9f0'],['$ _','#80ed99']].forEach((l,i)=>{g.fillStyle=l[1];g.fillText(l[0],19,42+i*9)});
g.fillStyle=col;rr(g,92,74,18,9,2);g.fill();g.fillStyle='#0a1128';g.font='bold 6px sans-serif';g.textAlign='center';g.fillText('L'+digits(n),101,80.5);
g.fillStyle='#8892b0';g.beginPath();g.moveTo(9,93);g.lineTo(119,93);g.lineTo(116,101);g.lineTo(12,101);g.closePath();g.fill();g.fillStyle='#5a6384';rr(g,54,93,20,3,1.5);g.fill()},
card(g,n){g.save();g.translate(64,60);g.rotate(-.1);
const cg=g.createLinearGradient(-48,-30,48,30);cg.addColorStop(0,'#ffcf4a');cg.addColorStop(1,'#e07b00');rr(g,-48,-30,96,60,7);g.fillStyle=cg;g.fill();
g.fillStyle='#0a1128';g.font='bold 8px sans-serif';g.textAlign='right';g.fillText('BANK',42,-17);
rr(g,-40,-14,20,15,3);g.fillStyle='#f6dd9a';g.fill();g.strokeStyle='#9a6a00';g.lineWidth=1;g.stroke();g.beginPath();g.moveTo(-40,-6.5);g.lineTo(-20,-6.5);g.moveTo(-30,-14);g.lineTo(-30,1);g.stroke();
g.strokeStyle='#0a1128aa';g.lineWidth=1.6;for(let i=1;i<4;i++){g.beginPath();g.arc(-8,-6.5,i*3.4,-.9,.9);g.stroke()}
g.fillStyle='#2a1a00';g.font='bold 11px monospace';g.textAlign='left';g.fillText('•••• '+digits(n),-40,18);
g.fillStyle='#d9480fcc';g.beginPath();g.arc(30,18,7,0,7);g.fill();g.fillStyle='#fff8';g.beginPath();g.arc(38,18,7,0,7);g.fill();g.restore()},
bank(g,n,col){g.fillStyle=col;g.beginPath();g.moveTo(64,28);g.lineTo(108,52);g.lineTo(20,52);g.closePath();g.fill();
g.fillStyle='#0a1128';g.font='bold 15px sans-serif';g.textAlign='center';g.fillText('₹',64,50);
g.fillStyle=col;g.fillRect(22,54,84,5);
for(let i=0;i<5;i++){const x=28+i*17,cg=g.createLinearGradient(x,0,x+9,0);cg.addColorStop(0,'#fff6');cg.addColorStop(.5,col);cg.addColorStop(1,'#0004');g.fillStyle=cg;g.fillRect(x,61,9,26)}
g.fillStyle=col;g.fillRect(20,88,88,5);g.fillRect(14,94,100,5)},
wallet(g,n,col){const wg=g.createLinearGradient(0,44,0,92);wg.addColorStop(0,'#ffd166');wg.addColorStop(1,'#e09f00');
g.fillStyle='#ffe08a';g.beginPath();g.arc(42,40,13,0,7);g.fill();g.strokeStyle='#b8860b';g.lineWidth=2;g.stroke();g.fillStyle='#8a5a00';g.font='bold 15px sans-serif';g.textAlign='center';g.fillText('₹',42,45.5);
rr(g,20,44,88,48,9);g.fillStyle=wg;g.fill();g.fillStyle='#0003';rr(g,20,44,88,10,5);g.fill();
rr(g,82,58,30,22,7);g.fillStyle='#0a1128';g.fill();g.fillStyle=col;g.beginPath();g.arc(93,69,4,0,7);g.fill();
g.strokeStyle='#fffc';g.lineWidth=2.4;g.lineCap='round';for(let i=1;i<4;i++){g.beginPath();g.arc(90,46,i*5,-Math.PI*.85,-Math.PI*.15);g.stroke()}g.lineCap='butt'},
hub(g,n,col){g.fillStyle='#0003';g.fillRect(14,78,100,4);
const bg=g.createLinearGradient(0,34,0,78);bg.addColorStop(0,col);bg.addColorStop(1,'#3a8f57');g.fillStyle=bg;g.beginPath();g.moveTo(22,78);g.lineTo(22,52);g.lineTo(64,32);g.lineTo(106,52);g.lineTo(106,78);g.closePath();g.fill();
g.strokeStyle='#0a1128aa';g.lineWidth=2;g.beginPath();g.moveTo(22,52);g.lineTo(64,32);g.lineTo(106,52);g.stroke();
g.fillStyle='#0a1128';g.font='bold 9px sans-serif';g.textAlign='center';g.fillText('HUB',64,50);
rr(g,46,56,36,22,2);g.fillStyle='#0a1128d0';g.fill();g.strokeStyle='#80ed9966';g.lineWidth=1;for(let y=60;y<78;y+=4){g.beginPath();g.moveTo(46,y);g.lineTo(82,y);g.stroke()}
g.fillStyle='#b07a3c';g.fillRect(27,66,13,12);g.fillRect(31,57,10,9);g.fillStyle='#8a5a28';g.fillRect(88,68,12,10)},
tower(g,n,col){g.fillStyle=col+'55';g.fillRect(26,60,18,20);g.fillRect(84,52,20,28);
const tg=g.createLinearGradient(48,0,80,0);tg.addColorStop(0,col);tg.addColorStop(1,'#3a8f57');g.fillStyle=tg;g.fillRect(48,24,32,56);g.fillStyle=col;g.fillRect(44,76,40,4);
const r=rng(n.id+5);for(let y=0;y<6;y++)for(let x=0;x<3;x++){g.fillStyle=r()<.4?'#fff3a8':'#0a1128';g.fillRect(53+x*9,28+y*7.5,5,4.5)}
g.strokeStyle=col;g.lineWidth=1.5;g.beginPath();g.moveTo(64,24);g.lineTo(64,14);g.stroke();g.fillStyle='#ff4d6d';g.beginPath();g.arc(64,13,2,0,7);g.fill();g.fillStyle='#0003';g.fillRect(14,80,100,3)},
depot(g,n,col){g.fillStyle='#0003';g.fillRect(16,76,98,3);
g.fillStyle=col;g.beginPath();g.moveTo(24,76);g.lineTo(24,46);g.lineTo(34,38);g.lineTo(34,46);g.lineTo(44,38);g.lineTo(44,46);g.lineTo(54,38);g.lineTo(54,76);g.closePath();g.fill();
g.fillStyle='#0a1128d0';rr(g,28,58,10,18,1);g.fill();rr(g,41,58,10,18,1);g.fill();
rr(g,56,52,32,22,2);g.fillStyle='#e8ecff';g.fill();g.fillStyle=col;g.fillRect(56,60,32,4);
g.fillStyle='#cfd6ee';g.beginPath();g.moveTo(88,58);g.lineTo(96,58);g.lineTo(101,66);g.lineTo(101,74);g.lineTo(88,74);g.closePath();g.fill();
g.fillStyle='#0a1128';g.beginPath();g.moveTo(90,61);g.lineTo(95,61);g.lineTo(98,66);g.lineTo(90,66);g.closePath();g.fill();g.beginPath();g.arc(64,75,5,0,7);g.arc(94,75,5,0,7);g.fill()},
file(g,n){const fg=g.createLinearGradient(0,17,0,111);fg.addColorStop(0,'#c9b0ff');fg.addColorStop(1,'#8a5cff');g.fillStyle=fg;g.beginPath();g.moveTo(7,17);g.lineTo(50,17);g.lineTo(60,29);g.lineTo(121,29);g.lineTo(121,111);g.lineTo(7,111);g.closePath();g.fill();
g.fillStyle='#f4f1ff';rr(g,16,36,92,60,3);g.fill();g.fillStyle='#b8aee0';for(let i=0;i<4;i++)g.fillRect(22,44+i*8,60+(i%2)*14,2.5);
const cg=g.createLinearGradient(0,52,0,111);cg.addColorStop(0,'#a479ff');cg.addColorStop(1,'#6a3fe0');g.fillStyle=cg;g.beginPath();g.moveTo(7,58);g.lineTo(121,52);g.lineTo(121,111);g.lineTo(7,111);g.closePath();g.fill();
g.fillStyle='#fff';g.textAlign='left';g.font='bold 11px sans-serif';g.fillText(n.fileLabel||'CASE FILE',16,72);g.font='800 22px sans-serif';g.fillText('#'+digits(n),16,96);
g.save();g.translate(90,86);g.rotate(-.25);g.strokeStyle='#ff4d6d';g.fillStyle='#ff4d6d';g.lineWidth=2;rr(g,-18,-8,36,16,3);g.stroke();g.font='bold 9px sans-serif';g.textAlign='center';g.fillText('OPEN',0,3.5);g.restore();
g.strokeStyle='#e8ecff';g.lineWidth=2;rr(g,92,32,8,26,4);g.stroke()}
};

/* ------------------------------------------------------------------ */
/* Mapping real case data onto the prototype's artwork.                 */
/* ------------------------------------------------------------------ */
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h) % 100000; };
const pickBy = (key, list) => list[hash(key) % list.length];

// The case data has no gender field, so the avatar uses attrs.gender/sex when present and
// otherwise a list of common female first names. It only changes the drawing.
const FEMALE = new Set(['leena', 'lina', 'mira', 'meera', 'nisha', 'priya', 'neha', 'anita', 'sunita', 'sana', 'zoya', 'pooja', 'kavya', 'ananya', 'divya',
  'riya', 'sneha', 'asha', 'geeta', 'gita', 'sita', 'lakshmi', 'radha', 'shreya', 'anjali', 'deepa', 'rekha', 'seema', 'sonia', 'fatima', 'ayesha', 'aisha',
  'maria', 'sarah', 'emma', 'olivia', 'anna', 'lisa', 'mary', 'sara', 'isha', 'tara', 'kiara', 'aditi', 'swati', 'preeti', 'jyoti', 'komal', 'nikita',
  'shilpa', 'shalini', 'sunaina', 'madhuri', 'ayaana', 'aaliya', 'alia', 'heena', 'farah', 'nandini', 'pallavi', 'rani', 'usha', 'uma', 'vidya', 'sapna', 'neelam']);
function genderOf(node) {
  const a = node.raw?.attrs || {};
  const g = String(a.gender || a.sex || '').toLowerCase();
  if (g.startsWith('f')) return 'f';
  if (g.startsWith('m')) return 'm';
  return FEMALE.has(String(node.label || '').trim().split(/\s+/)[0].toLowerCase()) ? 'f' : 'm';
}

// Which drawing and silhouette each entity type uses.
export function iconKind(node) {
  const key = node.raw?.attrs?.bank || node.id;
  switch (node.type) {
    case 'Person': return { art: 'person', sil: 'hex' };
    case 'Account': return { art: pickBy(key, ['bank', 'card', 'wallet']), sil: 'shield' };
    case 'Transaction': return { art: 'wallet', sil: 'shield' };
    case 'Phone': return { art: pickBy(node.id, ['android', 'iphone']), sil: 'phone' };
    case 'Location': return { art: pickBy(node.id, ['hub', 'tower', 'depot']), sil: 'pin' };
    case 'Organization': return { art: 'tower', sil: 'pin' };
    case 'Document': return { art: 'file', sil: 'folder', fileLabel: 'EVIDENCE' };
    case 'Case': return { art: 'file', sil: 'folder', fileLabel: 'CASE FILE' };
    default: return { art: 'file', sil: 'folder' };
  }
}

// Her silhouettes: hexagon person, portrait phone / landscape laptop, shield account, pin location, folder.
function shape(c, sil, r) {
  c.beginPath();
  if (sil === 'hex') { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6, x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) c.lineTo(x, y); else c.moveTo(x, y); } }
  else if (sil === 'laptop') rrp(c, -r * 1.12, -r * .76, r * 2.24, r * 1.52, r * .12);
  else if (sil === 'phone') rrp(c, -r * .62, -r * 1.15, r * 1.24, r * 2.3, r * .2);
  else if (sil === 'shield') { c.moveTo(-r, -r * .8); c.lineTo(r, -r * .8); c.lineTo(r, r * .1); c.quadraticCurveTo(r, r * .8, 0, r * 1.15); c.quadraticCurveTo(-r, r * .8, -r, r * .1); }
  else if (sil === 'pin') { c.arc(0, -r * .2, r * .85, Math.PI * .85, Math.PI * .15); c.lineTo(0, r * 1.3); c.lineTo(-r * .75, r * .45); }
  else { c.moveTo(-r * 1.15, -r * .95); c.lineTo(-r * .3, -r * .95); c.lineTo(-r * .08, -r * .7); c.lineTo(r * 1.15, -r * .7); c.lineTo(r * 1.15, r * .95); c.lineTo(-r * 1.15, r * .95); }
  c.closePath();
}

// The prototype's artwork square (192 px) for one entity.
function artwork(node, color) {
  const k = iconKind(node);
  const c = document.createElement('canvas'); c.width = c.height = 192;
  const g = c.getContext('2d'); g.scale(1.5, 1.5);
  const bg = g.createLinearGradient(0, 0, 0, 128); bg.addColorStop(0, color + 'aa'); bg.addColorStop(1, '#0a1128');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  const n = { id: hash(node.id), name: String(node.label || ''), g: node.type === 'Person' ? genderOf(node) : null, role: null, fileLabel: k.fileLabel };
  ICON[k.art](g, n, color);
  return c;
}

export const RING_FLAG = '#FF6B5B';
const SIZE = 256, R = 62;
const cache = new Map();

/* Full node texture: ring (share of the busiest entity's links; coral when a finding names it),
   glowing silhouette with the artwork inside, coloured outline and a "!" badge for flagged entities. */
export function iconTexture(node, color, { ring = 0, flagged = false } = {}) {
  const key = `${node.id}|${color}|${flagged ? 1 : 0}|${Math.round(ring * 20)}`;
  if (cache.has(key)) return cache.get(key);
  const k = iconKind(node);
  const sil = k.art === 'laptop' ? 'laptop' : k.sil;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.translate(SIZE / 2, SIZE / 2);
  g.lineWidth = 7; g.strokeStyle = '#1b2a52'; g.beginPath(); g.arc(0, 0, R * 1.3, 0, 7); g.stroke();
  if (ring > 0) {
    g.strokeStyle = flagged ? RING_FLAG : color; g.lineCap = 'round';
    g.beginPath(); g.arc(0, 0, R * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.min(1, ring) * Math.PI * 2); g.stroke();
  }
  g.shadowColor = color; g.shadowBlur = 18; shape(g, sil, R); g.fillStyle = '#0a1128'; g.fill(); g.shadowBlur = 0;
  g.save(); shape(g, sil, R); g.clip(); const s = R * 1.3; g.drawImage(artwork(node, color), -s, -s, 2 * s, 2 * s); g.restore();
  shape(g, sil, R); g.strokeStyle = color; g.lineWidth = 4.5; g.stroke();
  if (flagged) {
    const bx = R * .95, by = -R * .95, br = 20;
    g.fillStyle = RING_FLAG; g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill();
    g.strokeStyle = '#070b16'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#070b16'; g.font = '800 25px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', bx, by + 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

// Small square picture of an entity type, for the toolbar chips.
const thumbs = new Map();
export function typeThumb(type, color) {
  if (thumbs.has(type)) return thumbs.get(type);
  const sample = { id: 'sample-' + type, type, label: type === 'Person' ? 'Sample' : type + ' 01', raw: { attrs: {} } };
  const url = artwork(sample, color).toDataURL();
  thumbs.set(type, url);
  return url;
}
