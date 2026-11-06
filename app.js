(function(){
'use strict';
const EN=ENGINE();
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MATE=30000;
const FILES='abcdefgh';
const QUAL={fast:{ms:150,depth:7,label:'Fast'},std:{ms:400,depth:9,label:'Standard'},deep:{ms:1200,depth:11,label:'Deep'}};
const CLS={
  best:{l:'Best',s:'★'},excellent:{l:'Excellent',s:'!'},good:{l:'Good',s:''},book:{l:'Book',s:''},
  forced:{l:'Forced',s:''},inacc:{l:'Inaccuracy',s:'?!'},mistake:{l:'Mistake',s:'?'},blunder:{l:'Blunder',s:'??'}
};
const CLS_ORDER=['best','excellent','good','book','forced','inacc','mistake','blunder'];
const BOARD_BADGE={best:1,excellent:1,inacc:1,mistake:1,blunder:1};

const SAMPLE=`[Event "Sample game"]
[Site "?"]
[Date "2026-11-06"]
[White "Player One"]
[Black "Player Two"]
[Result "1-0"]
[WhiteElo "432"]
[BlackElo "477"]
[TimeControl "120+1"]
[Termination "*"]
1. e4 e6 2. d4 d5 3. e5 c5 4. Nf3 Nc6 5. dxc5 Bxc5 6. Nc3 Qd7 7. Nb5 Nge7 8. Bg5
O-O 9. Bxe7 Qxe7 10. Bc4 dxc4 11. b3 cxb3 12. cxb3 h6 13. g4 Rd8 14. Qc2 a6 15.
Nc3 b5 16. a4 bxa4 17. Nxa4 Bb7 18. Nxc5 Nb4 19. Qc4 Nc6 20. Nxb7 Qxb7 21. O-O
Ne7 22. Rfd1 Rxd1+ 23. Rxd1 Qxf3 24. Qd3 Qxg4+ 25. Kh1 Nc6 26. Rc1 Rd8 27. Qxa6
Rd1+ 28. Rxd1 Qxd1+ 29. Kg2 Nxe5 30. Qc8+ Kh7 31. b4 Qf3+ 32. Kf1 Ng4 33. Qc2+
g6 34. b5 Nxh2+ 35. Kg1 Ng4 36. b6 f5 37. Qb2 Qb7 38. f3 Qxf3 39. b7 Qd1+ 40.
Kg2 Ne3+ 41. Kf2 Ng4+ 42. Kg3 Qg1+ 43. Kf3 Qe3+ 44. Kg2 h5 45. b8=Q Qe1 46.
Q8h8# 1-0`;

/* ---------- opening book ---------- */
/* BOOK_LINES comes from src/openings.js (inlined at build time) */
const ROOT={kids:{},n:0,name:null,san:''};
const skey=s=>s.replace(/[+#!?]/g,'');
for(const [mv,name] of BOOK_LINES){
  let nd=ROOT;
  for(const t of mv.split(' ')){nd=nd.kids[t]||(nd.kids[t]={kids:{},n:0,name:null,san:t});nd.n++;}
  nd.name=name;
}
function nearName(nd){
  const q=[nd];
  while(q.length){
    const x=q.shift();
    if(x.name)return x.name;
    const ks=Object.keys(x.kids).sort((a,b)=>x.kids[b].n-x.kids[a].n);
    for(const k of ks)q.push(x.kids[k]);
  }
  return '';
}

/* ---------- state ---------- */
const A={games:[],gi:0,game:null,evals:[],moves:[],ply:0,flip:false,token:0,quality:'std',lines:3,arrows:true,tab:'review',cand:null,hint:null,playing:false,timer:null,cache:new Map(),analyzing:false,follow:false,line:null,xev:new Map(),xpend:new Set(),deep:new Map(),sel:null,dests:[]};

/* ---------- worker plumbing ---------- */
let worker=null,reqId=0;const pending=new Map();
function runLocal(t,a){return t==='top'?EN.top(a.fen,a.ms,a.depth,a.n):t==='best'?EN.best(a.fen,a.ms,a.depth):EN.multi(a.fen,a.depth,a.ms);}
function dropWorker(){
  if(worker){try{worker.terminate();}catch(e){}}
  worker=null;
  const items=Array.from(pending.values());
  pending.clear();
  items.forEach(it=>{clearTimeout(it.timer);setTimeout(()=>{try{it.res(runLocal(it.t,it.a));}catch(e){it.rej(e);}},0);});
}
function initWorker(){
  try{
    const src='const E=('+ENGINE.toString()+')();self.onmessage=function(e){var d=e.data;try{var r=d.t==="top"?E.top(d.fen,d.ms,d.depth,d.n):d.t==="best"?E.best(d.fen,d.ms,d.depth):E.multi(d.fen,d.depth,d.ms);self.postMessage({id:d.id,r:r});}catch(err){self.postMessage({id:d.id,err:String(err&&err.message||err)});}};';
    const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
    worker=new Worker(url);
    worker.onmessage=e=>{
      const it=pending.get(e.data.id);
      if(!it)return;
      pending.delete(e.data.id);clearTimeout(it.timer);
      if(e.data.err)it.rej(new Error(e.data.err));else it.res(e.data.r);
    };
    worker.onerror=()=>dropWorker();
  }catch(e){worker=null;}
}
function call(t,a){
  return new Promise((res,rej)=>{
    if(worker){
      const id=++reqId;
      const it={res,rej,t,a,timer:setTimeout(()=>dropWorker(),a.ms+5000)};
      pending.set(id,it);
      try{worker.postMessage({id,t,fen:a.fen,ms:a.ms,depth:a.depth,n:a.n});}catch(e){dropWorker();}
    }else setTimeout(()=>{try{res(runLocal(t,a));}catch(e){rej(e);}},0);
  });
}

/* ---------- helpers ---------- */
const winPct=cp=>50+50*(2/(1+Math.exp(-0.00368208*cp))-1);
const capv=w=>Math.max(-1000,Math.min(1000,w));
function evalStr(e){
  if(!e)return '…';
  if(e.terminal)return e.mated?'#':'0.0';
  if(e.mate!==null)return (e.mate>0?'M':'-M')+Math.abs(e.mate);
  const v=e.w/100;
  if(Math.abs(v)<0.05)return '0.0';
  return (v>0?'+':'-')+Math.abs(v).toFixed(1);
}
function normEval(r,fen){
  const stm=fen.split(' ')[1]==='b'?-1:1;
  if(r.terminal){
    const winner=r.mate?-stm:0;
    return {w:winner*MATE,mate:r.mate?winner:null,terminal:true,mated:r.mate,best:null,bestSan:null,depth:0,lines:[]};
  }
  let mate=null;
  if(Math.abs(r.score)>=MATE-200){
    const d=MATE-Math.abs(r.score);
    mate=(r.score>0?stm:-stm)*Math.max(1,Math.ceil(d/2));
  }
  const lines=(r.lines||[]).map(l=>{
    let lm=null;
    if(Math.abs(l.score)>=MATE-200)lm=(l.score>0?stm:-stm)*Math.max(1,Math.ceil((MATE-Math.abs(l.score))/2));
    return {move:l.move,san:l.san,w:l.score*stm,mate:lm};
  });
  return {w:r.score*stm,mate,best:r.move,bestSan:r.san,depth:r.depth,lines};
}
function timeControl(tc){
  const m=/^(\d+)(?:\+(\d+))?$/.exec(tc||'');
  if(!m)return tc||'';
  const base=+m[1],inc=+m[2]||0;
  const b=base>=60?(base/60)+' min':base+' s';
  return (b+(inc?' + '+inc+' s':'')).replace(/ /g,' ');
}
function splitGames(text){
  text=text.replace(/\r/g,'').trim();
  const idx=[],re=/^\[Event\s/gm;let m;
  while((m=re.exec(text)))idx.push(m.index);
  if(idx.length<=1)return [text];
  return idx.map((s,i)=>text.slice(s,i+1<idx.length?idx[i+1]:text.length));
}
function parseBoard(fen){
  const rows=fen.split(' ')[0].split('/'),out=[];
  for(let r=0;r<8;r++){
    const row=[];
    for(const ch of rows[r]){
      if(/\d/.test(ch)){for(let i=0;i<+ch;i++)row.push('');}else row.push(ch);
    }
    out.push(row);
  }
  return out;
}
function material(fen){
  const v={p:1,n:3,b:3,r:5,q:9};let w=0,b=0;
  for(const ch of fen.split(' ')[0]){
    const l=ch.toLowerCase();
    if(v[l]){if(ch===l)b+=v[l];else w+=v[l];}
  }
  return w-b;
}
function moveLabel(k){
  const g=A.game,pl=g.plies[k];
  const off=g.plies[0].color===-1?1:0;
  const num=g.firstFull+Math.floor((k+off)/2);
  return num+(pl.color===1?'.':'...')+' '+pl.san;
}
function computeBook(g){
  g.bookNodes=[ROOT];g.book=[true];g.open=[null];
  let nd=ROOT,name=null;
  for(let k=0;k<g.plies.length;k++){
    const t=skey(g.plies[k].san);
    nd=nd?(nd.kids[t]||null):null;
    g.bookNodes.push(nd);g.book.push(!!nd);
    if(nd&&nd.name)name=nd.name;
    g.open.push(name);
  }
}

/* ---------- current view (game position or the user's own variation) ---------- */
function inLine(){return !!(A.line&&A.line.idx>0);}
function cur(){
  const g=A.game;
  if(inLine()){
    const st=A.line.steps[A.line.idx-1];
    return {fen:st.fen,from:st.from,to:st.to,ev:A.xev.get(st.fen)||null,line:true};
  }
  const k=A.ply;
  return {fen:g.fens[k],from:k>0?g.plies[k-1].from:null,to:k>0?g.plies[k-1].to:null,ev:A.evals[k],line:false};
}
function stmOf(fen){return fen.split(' ')[1]==='b'?-1:1;}
function lineText(upto){
  const L=A.line,g=A.game;
  let before=g.fens[L.base],out=[];
  for(let i=0;i<upto&&i<L.steps.length;i++){
    const n=before.split(' ')[5],w=stmOf(before)===1;
    out.push((w?n+'. ':(i===0?n+'... ':''))+L.steps[i].san);
    before=L.steps[i].fen;
  }
  return out.join(' ');
}
function ensureEval(fen){
  if(A.xev.has(fen)||A.xpend.has(fen))return;
  A.xpend.add(fen);
  const q=QUAL[A.quality],g=A.game;
  call('top',{fen,ms:q.ms,depth:q.depth,n:A.lines}).then(r=>{A.xev.set(fen,normEval(r,fen));}).catch(()=>{}).then(()=>{
    A.xpend.delete(fen);
    if(A.game===g&&inLine()&&cur().fen===fen)refreshView();
  });
}
function refreshView(){
  if(inLine())ensureEval(cur().fen);
  renderStrips();renderBoard();renderBar();renderComment();renderPanel();
}

/* ---------- derived analysis ---------- */
function derive(){
  const g=A.game,n=g.plies.length,out=[];
  for(let k=0;k<n;k++){
    const e0=A.evals[k],e1=A.evals[k+1];
    if(!e0||!e1){out.push(null);continue;}
    const pl=g.plies[k],c=pl.color;
    const b0=capv(c*e0.w),b1=capv(c*e1.w);
    const w0=winPct(b0),w1=winPct(b1);
    let drop=Math.max(0,w0-w1),cpLoss=Math.max(0,b0-b1);
    let cls;
    if(g.book[k+1])cls='book';
    else if(pl.legalCount===1)cls='forced';
    else if(pl.uci===e0.best||drop<=0.2)cls='best';
    else cls=drop<=1.5?'excellent':drop<5?'good':drop<10?'inacc':drop<20?'mistake':'blunder';
    if(cls==='book'){drop=0;cpLoss=0;}
    const acc=Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*drop)-3.1669));
    out.push({cls,drop,cpLoss,w0,w1,acc,b0,b1});
  }
  A.moves=out;
}
function stats(){
  const g=A.game,res={'1':{n:0,acc:0,cp:0,cls:{}},'-1':{n:0,acc:0,cp:0,cls:{}}};
  for(let k=0;k<A.moves.length;k++){
    const m=A.moves[k];if(!m)continue;
    const r=res[g.plies[k].color];
    r.n++;r.acc+=m.acc;r.cp+=m.cpLoss;r.cls[m.cls]=(r.cls[m.cls]||0)+1;
  }
  for(const c of ['1','-1']){const r=res[c];r.accAvg=r.n?r.acc/r.n:null;r.acpl=r.n?r.cp/r.n:null;}
  return res;
}

/* ---------- loading ---------- */
function setErr(msg){
  const el=$('#loaderr');
  if(msg){el.textContent=msg;el.hidden=false;$('#loader').open=true;}else{el.hidden=true;el.textContent='';}
}
function loadFromText(){
  const text=$('#pgn').value;
  try{localStorage.setItem('pgnreview.pgn',text);}catch(e){}
  stopPlay();
  const parts=splitGames(text);
  if(!text.trim()){setErr('Paste a PGN first.');return;}
  const parsed=parts.map(t=>{try{return {text:t,g:EN.parseGame(t)};}catch(e){return {text:t,g:{hdr:{},plies:[],fens:[],error:{ply:1,token:'',empty:true}}};}});
  A.games=parsed;
  const sel=$('#gamesel');
  if(parsed.length>1){
    sel.innerHTML=parsed.map((p,i)=>`<option value="${i}">${i+1}. ${esc(p.g.hdr.White||'?')} vs ${esc(p.g.hdr.Black||'?')} ${esc(p.g.hdr.Result||'')}</option>`).join('');
    sel.hidden=false;
  }else sel.hidden=true;
  openGame(0);
}
function openGame(i){
  const item=A.games[i];
  A.gi=i;
  const g=item.g;
  if(!g.plies.length){
    setErr(g.error&&g.error.empty?'No moves found in that PGN.':'Could not read move '+(g.error?g.error.ply:1)+'.');
    return;
  }
  if(g.error){
    const num=g.firstFull+Math.floor((g.error.ply-1+(g.plies.length&&g.plies[0].color===-1?1:0))/2);
    setErr('Stopped at ply '+g.error.ply+' (move '+num+'): "'+g.error.token+'" is not a legal move there. Showing the moves before it.');
  }else setErr('');
  if($('#gamesel')&&!$('#gamesel').hidden)$('#gamesel').value=String(i);
  A.game=g;
  computeBook(g);
  A.ply=0;A.cand=null;A.hint=null;A.evals=new Array(g.plies.length+1).fill(null);A.moves=[];A.line=null;A.sel=null;A.dests=[];A.xev.clear();A.xpend.clear();A.deep.clear();
  const ckey=i+'|'+A.quality+'|'+A.lines+'|'+item.text;
  if(A.cache.has(ckey)){
    A.evals=A.cache.get(ckey);derive();renderAll();
    A.token++;A.analyzing=false;renderProg();
  }else{
    derive();renderAll();
    startAnalysis(ckey);
  }
  if(!g.error)$('#loader').open=false;
}
async function startAnalysis(ckey){
  const tok=++A.token,g=A.game,q=QUAL[A.quality];
  A.analyzing=true;renderProg();
  for(let k=0;k<=g.plies.length;k++){
    if(tok!==A.token)return;
    let r;
    try{r=await call('top',{fen:g.fens[k],ms:q.ms,depth:q.depth,n:A.lines});}
    catch(e){A.analyzing=false;renderProg('Engine error: '+e.message);return;}
    if(tok!==A.token)return;
    A.evals[k]=normEval(r,g.fens[k]);
    derive();
    scheduleRender();
  }
  A.analyzing=false;
  A.cache.set(ckey,A.evals.slice());
  derive();renderAll();
}

/* ---------- rendering ---------- */
let raf=0;
function scheduleRender(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;renderAll();});}
function renderAll(){
  if(!A.game)return;
  renderMeta();renderStrips();renderBoard();renderBar();renderGraph();renderComment();renderPanel();renderProg();
}
function renderMeta(){
  const h=A.game.hdr,bits=[];
  if(h.Event)bits.push(esc(h.Event));
  if(h.Date&&!/\?/.test(h.Date))bits.push(esc(h.Date));
  const tc=timeControl(h.TimeControl);if(tc)bits.push(esc(tc));
  if(h.Termination&&h.Termination!=='*')bits.push(esc(h.Termination));
  const op=A.game.open[A.game.open.length-1];
  $('#meta').innerHTML=bits.join(' · ')+(op?`<br><span class="opn">${esc(op)}</span>`:'');
}
function renderStrips(){
  const g=A.game,h=g.hdr,c=cur(),diff=material(c.fen);
  const res=h.Result||'';
  const tag=k=>c.line?'':res==='1-0'?(k===1?'1':'0'):res==='0-1'?(k===1?'0':'1'):res==='1/2-1/2'?'½':'';
  const strip=k=>{
    const name=k===1?h.White:h.Black,elo=k===1?h.WhiteElo:h.BlackElo;
    const lead=k===1?diff:-diff;
    const mover=stmOf(c.fen);
    return `<div class="strip${mover===k?' to-move':''}"><span class="chip ${k===1?'w':'b'}"></span><span class="pname">${esc(name||(k===1?'White':'Black'))}</span>${elo?`<span class="elo">${esc(elo)}</span>`:''}<span class="mat">${lead>0?'+'+lead:''}</span><span class="rtag">${tag(k)}</span></div>`;
  };
  $('#strip-top').innerHTML=strip(A.flip?1:-1);
  $('#strip-bot').innerHTML=strip(A.flip?-1:1);
}
const GLYPH={k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟︎'};
function sqXY(sq){
  const f=FILES.indexOf(sq[0]),rr=8-(+sq[1]);
  return {x:(A.flip?7-f:f),y:(A.flip?7-rr:rr)};
}
function arrowSVG(from,to,cls){
  const a=sqXY(from),b=sqXY(to);
  const ax=a.x*100+50,ay=a.y*100+50,bx=b.x*100+50,by=b.y*100+50;
  const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
  const tipx=bx-ux*14,tipy=by-uy*14,bsx=tipx-ux*38,bsy=tipy-uy*38,nx=-uy,ny=ux;
  return `<g class="arrow ${cls}"><line x1="${ax+ux*16}" y1="${ay+uy*16}" x2="${bsx}" y2="${bsy}" stroke-width="14"/><polygon points="${tipx},${tipy} ${bsx+nx*22},${bsy+ny*22} ${bsx-nx*22},${bsy-ny*22}"/></g>`;
}
function renderBoard(){
  const g=A.game,c=cur(),bd=parseBoard(c.fen);
  let s='<svg viewBox="0 0 800 800" role="img" aria-label="Chess board. Tap a piece, then a square, to try a move.">';
  for(let rr=0;rr<8;rr++)for(let f=0;f<8;f++){
    const x=(A.flip?7-f:f),y=(A.flip?7-rr:rr),dark=(f+rr)%2===1;
    s+=`<rect x="${x*100}" y="${y*100}" width="100" height="100" class="${dark?'sq-d':'sq-l'}"/>`;
  }
  if(c.from){
    for(const sq of [c.from,c.to]){const p=sqXY(sq);s+=`<rect x="${p.x*100}" y="${p.y*100}" width="100" height="100" class="hl"/>`;}
  }
  if(A.sel){const p=sqXY(A.sel);s+=`<rect x="${p.x*100}" y="${p.y*100}" width="100" height="100" class="selsq"/>`;}
  for(let i=0;i<8;i++){
    const xf=A.flip?7-i:i;
    const darkF=(i+(A.flip?0:7))%2===1;
    s+=`<text x="${xf*100+90}" y="792" class="co ${darkF?'on-l':'on-d'}" text-anchor="end">${FILES[i]}</text>`;
    const darkR=((A.flip?7:0)+(7-i))%2===1;
    s+=`<text x="6" y="${(A.flip?i:7-i)*100+22}" class="co ${darkR?'on-l':'on-d'}">${i+1}</text>`;
  }
  for(let rr=0;rr<8;rr++)for(let f=0;f<8;f++){
    const ch=bd[rr][f];if(!ch)continue;
    const lo=ch.toLowerCase(),white=ch!==lo;
    const x=(A.flip?7-f:f)*100+50,y=(A.flip?7-rr:rr)*100+50;
    s+=`<text x="${x}" y="${y}" dy="0.34em" text-anchor="middle" class="pc ${white?'w':'b'}">${GLYPH[lo]}</text>`;
  }
  const ev=A.deep.get(c.fen)||c.ev;
  if(A.hint)s+=arrowSVG(A.hint.slice(0,2),A.hint.slice(2,4),'a-hint');
  else if(A.arrows&&ev&&ev.lines&&!A.sel){
    const top3=ev.lines.slice(0,3);
    for(let i=top3.length-1;i>=0;i--)s+=arrowSVG(top3[i].move.slice(0,2),top3[i].move.slice(2,4),'a-c'+(i+1));
  }
  for(const d of A.dests){
    const p=sqXY(d.to),cap=bd[8-(+d.to[1])][FILES.indexOf(d.to[0])];
    s+=cap?`<circle cx="${p.x*100+50}" cy="${p.y*100+50}" r="44" class="dstc"/>`:`<circle cx="${p.x*100+50}" cy="${p.y*100+50}" r="15" class="dst"/>`;
  }
  const m=!c.line&&A.ply>0?A.moves[A.ply-1]:null;
  if(m&&BOARD_BADGE[m.cls]){
    const p=sqXY(g.plies[A.ply-1].to);
    s+=`<g class="badge k-${m.cls}"><circle cx="${p.x*100+82}" cy="${p.y*100+18}" r="16"/><text x="${p.x*100+82}" y="${p.y*100+18}" dy="0.35em" text-anchor="middle">${CLS[m.cls].s}</text></g>`;
  }
  s+='</svg>';
  $('#board').innerHTML=s;
}
function renderBar(){
  const e=cur().ev;
  const bar=$('#evalbar');
  bar.classList.toggle('flip',A.flip);
  const w=e?winPct(capv(e.w)):50;
  $('#evalfill').style.height=w.toFixed(1)+'%';
  const lab=$('#evallab');
  lab.textContent=e?evalStr(e):'';
  const whiteAhead=!e||e.w>=0;
  const atBottom=A.flip?!whiteAhead:whiteAhead;
  lab.className='evallab '+(atBottom?'at-bot':'at-top')+(whiteAhead?' dk':' lt');
}
function graphPts(){
  const n=A.game.plies.length,W=600,H=120,pts=[];
  for(let i=0;i<=n;i++){
    const e=A.evals[i];if(!e)break;
    pts.push([n?i/n*W:0,H/2-(winPct(capv(e.w))-50)/50*(H/2-3),i]);
  }
  return pts;
}
function renderGraph(){
  const n=A.game.plies.length,W=600,H=120,pts=graphPts();
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evaluation graph">`;
  s+=`<rect class="g-bg" width="${W}" height="${H}"/>`;
  if(pts.length>1){
    s+=`<path class="g-fill" d="M0 ${H} L${pts.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' L')} L${pts[pts.length-1][0].toFixed(1)} ${H} Z"/>`;
  }
  s+=`<line class="g-mid" x1="0" x2="${W}" y1="${H/2}" y2="${H/2}"/>`;
  for(let k=0;k<A.moves.length;k++){
    const m=A.moves[k];
    if(m&&(m.cls==='blunder'||m.cls==='mistake')&&pts[k+1])s+=`<circle class="g-dot k-${m.cls}" cx="${pts[k+1][0].toFixed(1)}" cy="${pts[k+1][1].toFixed(1)}" r="3.4"/>`;
  }
  const cx=n?A.ply/n*W:0;
  s+=`<line class="g-cur" x1="${cx}" x2="${cx}" y1="0" y2="${H}"/>`;
  s+='</svg>';
  $('#graph').innerHTML=s;
}
function renderComment(){
  const g=A.game,k=A.ply,c=cur();
  const el=$('#comment');
  if(c.line){
    el.innerHTML=`<div class="chead"><span class="cmove">${esc(lineText(A.line.idx))}</span><span class="tag k-pending">Your variation</span><span class="evnum">${c.ev?esc(evalStr(c.ev)):''}</span></div><p class="cbody">This is not part of the game. <button class="btn" id="exitline" type="button">Back to game</button></p>`+candHTML(c);
    return;
  }
  if(k===0){
    el.innerHTML=`<div class="chead"><span class="cmove">Start</span></div><p class="cbody">Use the arrow keys or tap any move to step through the game. Tap a piece on the board to try your own moves.</p>`+candHTML(c);
    return;
  }
  const pl=g.plies[k-1],m=A.moves[k-1],e0=A.evals[k-1],e1=A.evals[k];
  let head=`<div class="chead"><span class="cmove">${esc(moveLabel(k-1))}</span>`;
  let body='';
  if(!m){
    head+='</div>';
    body='<p class="cbody muted">Engine is still working on this move.</p>';
  }else{
    head+=`<span class="tag k-${m.cls}">${CLS[m.cls].l}</span><span class="evnum">${esc(evalStr(e1))}</span></div>`;
    const c=pl.color;
    const allowsMate=e1&&e1.mate!==null&&Math.sign(e1.mate)===-c&&!e1.terminal;
    const hadMate=e0&&e0.mate!==null&&Math.sign(e0.mate)===c;
    const bestTxt=e0&&e0.bestSan?`Better was <b>${esc(e0.bestSan)}</b> (${esc(evalStr(e0))}).`:'';
    const loss=(m.cpLoss/100).toFixed(1);
    if(m.cls==='book')body=`Opening theory${g.open[k]?': '+esc(g.open[k]):''}.`;
    else if(m.cls==='forced')body='The only legal move.';
    else if(m.cls==='best')body=e1&&e1.terminal&&e1.mated?'Checkmate.':'The engine’s top choice.';
    else if(m.cls==='excellent'||m.cls==='good')body=`Close to the best. ${bestTxt}`;
    else{
      const parts=[];
      if(allowsMate)parts.push(`Allows checkmate in ${Math.abs(e1.mate)}.`);
      else if(hadMate)parts.push(`Missed a forced mate in ${Math.abs(e0.mate)}.`);
      else parts.push(`Win chance drops from ${Math.round(m.w0)}% to ${Math.round(m.w1)}% (about ${loss} pawns).`);
      parts.push(bestTxt);
      body=parts.join(' ');
    }
    body=`<p class="cbody">${body}</p>`;
  }
  el.innerHTML=head+body+candHTML(c);
}
function candList(c){
  const ev=A.deep.get(c.fen)||c.ev;
  if(!ev)return '<p class="cbody muted">Working on this position…</p>';
  if(ev.terminal)return `<p class="cbody">${ev.mated?'Checkmate.':'Stalemate.'} No moves available.</p>`;
  if(!ev.lines||!ev.lines.length)return '';
  const nx=nextPlayed(c),played=nx?nx.uci:null;
  const row=(l,i,extra)=>{
    const pct=winPct(capv(l.w));
    return `<li><button class="cand${A.hint===l.move?' on':''}${l.move===played?' is-played':''}" data-hint="${l.move}"><b><i class="rk r${i+1}">${extra?'•':i+1}</i>${esc(l.san)}</b><span class="cbar"><i style="width:${pct.toFixed(0)}%"></i></span><span class="ev">${esc(evalStr({w:l.w,mate:l.mate}))}</span>${l.move===played?'<em>played</em>':'<span></span>'}</button></li>`;
  };
  let h='<ul class="cands">'+ev.lines.map((l,i)=>row(l,i,false)).join('');
  if(nx&&nx.ev&&!ev.lines.some(l=>l.move===played))h+=row({move:played,san:nx.san,w:nx.ev.w,mate:nx.ev.mate},ev.lines.length,true);
  h+='</ul>';
  return h+`<p class="muted small cnote">Searched to depth ${ev.depth}. Tap a move to show only its arrow.</p>`;
}
function nextPlayed(c){
  const g=A.game;
  if(c.line){const st=A.line.steps[A.line.idx];return st?{uci:st.uci,san:st.san,ev:A.xev.get(st.fen)||null}:null;}
  if(A.ply<g.plies.length)return {uci:g.plies[A.ply].uci,san:g.plies[A.ply].san,ev:A.evals[A.ply+1]};
  return null;
}
/* ---------- optional AI coach (any provider) ---------- */
const AI_DEFAULTS={openai:{model:'gpt-4o-mini',base:'https://api.openai.com/v1'},anthropic:{model:'claude-sonnet-4-6',base:''},gemini:{model:'gemini-2.0-flash',base:''}};
const aiCache=new Map();let aiBusy=false,aiErr='';
function aiLoad(){try{return Object.assign({provider:'openai',base:'',model:'',key:''},JSON.parse(localStorage.getItem('pgnreview.ai')||'{}'));}catch(e){return {provider:'openai',base:'',model:'',key:''};}}
function aiSave(c){try{localStorage.setItem('pgnreview.ai',JSON.stringify(c));}catch(e){}}
function aiReady(c){return !!(c.key||(c.provider==='openai'&&/localhost|127\.0\.0\.1|192\.168\./.test(c.base)));}
function aiPrompt(c){
  const g=A.game,ev=A.deep.get(c.fen)||c.ev;
  const sans=[];
  if(c.line){for(let i=0;i<g.plies.length&&i<A.line.base;i++)sans.push(g.plies[i].san);for(let i=0;i<A.line.idx;i++)sans.push(A.line.steps[i].san);}
  else for(let i=0;i<A.ply;i++)sans.push(g.plies[i].san);
  let moves='';for(let i=0;i<sans.length;i++)moves+=(i%2===0?(i/2+1)+'. ':'')+sans[i]+' ';
  const side=stmOf(c.fen)===1?'White':'Black';
  let t='Position (FEN): '+c.fen+'\nMoves so far: '+(moves||'(start)')+'\n'+side+' to move.\n';
  if(!c.line&&A.ply>0&&A.moves[A.ply-1]){const m=A.moves[A.ply-1];t+='Last move: '+g.plies[A.ply-1].san+' (engine grade: '+CLS[m.cls].l+')\n';}
  if(ev&&ev.lines&&ev.lines.length)t+='Engine top moves for '+side+' (score from White\'s view): '+ev.lines.map(l=>l.san+' '+evalStr({w:l.w,mate:l.mate})).join(', ')+'\n';
  return t;
}
const AI_SYSTEM='You are a friendly chess coach for a beginner (around 400-800 rating). Using ONLY the position and engine data given, explain in under 120 words: what is going on, what the best move idea is and why, and what to watch out for. Plain words, no jargon without a short explanation. Do not invent engine lines.';
async function aiCall(cfg,prompt){
  const model=cfg.model||AI_DEFAULTS[cfg.provider].model;
  let r,j;
  if(cfg.provider==='anthropic'){
    r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':cfg.key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model,max_tokens:500,system:AI_SYSTEM,messages:[{role:'user',content:prompt}]})});
    j=await r.json();if(!r.ok)throw new Error((j.error&&j.error.message)||r.status);
    return (j.content||[]).map(b=>b.text||'').join('');
  }
  if(cfg.provider==='gemini'){
    r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(cfg.key),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:AI_SYSTEM}]},contents:[{role:'user',parts:[{text:prompt}]}]})});
    j=await r.json();if(!r.ok)throw new Error((j.error&&j.error.message)||r.status);
    return ((j.candidates||[])[0]?.content?.parts||[]).map(x=>x.text||'').join('');
  }
  const base=(cfg.base||AI_DEFAULTS.openai.base).replace(/\/+$/,'');
  const headers={'content-type':'application/json'};if(cfg.key)headers.authorization='Bearer '+cfg.key;
  r=await fetch(base+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model,max_tokens:500,messages:[{role:'system',content:AI_SYSTEM},{role:'user',content:prompt}]})});
  j=await r.json();if(!r.ok)throw new Error((j.error&&(j.error.message||j.error))||r.status);
  return ((j.choices||[])[0]?.message?.content)||'';
}
async function aiExplain(){
  const cfg=aiLoad();
  if(!aiReady(cfg)){openAiDialog();return;}
  const c=cur(),key=c.fen+'|'+A.lines;
  if(aiBusy)return;
  aiBusy=true;aiErr='';renderComment();
  try{aiCache.set(key,await aiCall(cfg,aiPrompt(c)));}
  catch(e){aiErr=String(e.message||e);}
  aiBusy=false;renderComment();renderPanel();
}
function aiHTML(c){
  const ev=A.deep.get(c.fen)||c.ev;
  if(!ev||ev.terminal)return '';
  const txt=aiCache.get(c.fen+'|'+A.lines);
  let h='<div class="aibox"><div class="clabel">AI coach</div>';
  if(txt)h+=txt.split(/\n+/).filter(Boolean).map(x=>'<p>'+esc(x)+'</p>').join('');
  if(aiErr)h+='<p class="muted">Could not get an answer: '+esc(aiErr)+'. If this page is hosted online, the browser may block the request; open the downloaded file or use your own server.</p>';
  h+='<p><button class="btn" id="aiexplain" type="button"'+(aiBusy?' disabled':'')+'>'+(aiBusy?'Thinking…':txt?'Explain again':'Explain this position with AI')+'</button></p></div>';
  return h;
}
function openAiDialog(){
  const c=aiLoad(),d=$('#aidlg');
  $('#ai-provider').value=c.provider;$('#ai-base').value=c.base;$('#ai-model').value=c.model;$('#ai-key').value=c.key;
  $('#ai-model').placeholder=AI_DEFAULTS[c.provider].model;
  if(d.showModal)d.showModal();else d.setAttribute('open','');
}
function candHTML(c){
  const ev=A.deep.get(c.fen)||c.ev;
  if(ev&&ev.terminal)return `<div class="cwrap">${candList(c)}</div>`;
  const name=stmOf(c.fen)===1?'White':'Black';
  return `<div class="cwrap"><div class="clabel">Best moves for ${name} here</div>${candList(c)}</div>`+aiHTML(c);
}
function renderProg(msg){
  const g=A.game,n=g.plies.length+1;
  const done=A.evals.filter(Boolean).length;
  const box=$('#prog');
  box.hidden=false;
  $('#progfill').style.width=(done/n*100)+'%';
  let t;
  if(msg)t=msg;
  else if(A.analyzing)t=`Reviewing positions ${done} of ${n}`;
  else{
    const d=A.evals.reduce((a,e)=>e&&e.depth?Math.max(a,e.depth):a,0);
    t=`Review complete · ${QUAL[A.quality].label} · search depth up to ${d||'-'}`;
  }
  $('#progtxt').textContent=t;
  box.classList.toggle('done',!A.analyzing);
}

/* ---------- right panel ---------- */
function renderPanel(){
  document.querySelectorAll('.tabs [role=tab]').forEach(b=>{
    const on=b.dataset.tab===A.tab;
    b.setAttribute('aria-selected',on?'true':'false');
  });
  const host=$('#panel');
  const old=host.querySelector('#sheet');
  const keep=old?old.scrollTop:0;
  if(A.tab==='review')host.innerHTML=reviewHTML();
  else if(A.tab==='moves')host.innerHTML=movesHTML();
  else host.innerHTML=explorerHTML();
  const sh=host.querySelector('#sheet');
  if(sh){
    sh.scrollTop=keep;
    if(A.follow){
      const cur=sh.querySelector('[aria-current=true]');
      if(cur){
        const top=cur.offsetTop-sh.offsetTop;
        if(top<sh.scrollTop||top+cur.offsetHeight>sh.scrollTop+sh.clientHeight)sh.scrollTop=Math.max(0,top-sh.clientHeight/2);
      }
      A.follow=false;
    }
  }
}
function reviewHTML(){
  const g=A.game,st=stats(),h=g.hdr;
  const fmt=v=>v===null?'–':v.toFixed(1);
  const pcol=c=>`<div class="pcard"><div class="pc-name"><span class="chip ${c===1?'w':'b'}"></span>${esc((c===1?h.White:h.Black)||(c===1?'White':'Black'))}</div><div class="pc-acc">${fmt(st[c].accAvg)}<small>accuracy</small></div><div class="pc-sub">${st[c].acpl===null?'–':Math.round(st[c].acpl)} <span>avg. centipawn loss</span></div></div>`;
  let rows='';
  for(const k of CLS_ORDER){
    const a=st['1'].cls[k]||0,b=st['-1'].cls[k]||0;
    rows+=`<tr class="k-${k}"><td><i class="dot"></i>${CLS[k].l}</td><td>${a}</td><td>${b}</td></tr>`;
  }
  const moments=[];
  A.moves.forEach((m,k)=>{if(m&&(m.cls==='inacc'||m.cls==='mistake'||m.cls==='blunder'))moments.push({k,m});});
  moments.sort((a,b)=>b.m.drop-a.m.drop);
  const top=moments.slice(0,6);
  let ml='';
  if(top.length){
    ml='<ol class="moments">'+top.map(({k,m})=>{
      const e0=A.evals[k];
      return `<li><button class="mom k-${m.cls}" data-ply="${k+1}"><span class="mom-mv">${esc(moveLabel(k))}</span><span class="mom-cls">${CLS[m.cls].l}</span><span class="mom-best">${e0&&e0.bestSan?'Better: '+esc(e0.bestSan):''}</span></button></li>`;
    }).join('')+'</ol>';
  }else ml=`<p class="muted">${A.analyzing?'Key moments appear as the review runs.':'No inaccuracies found.'}</p>`;
  const note=A.analyzing?'<p class="muted note">Review in progress. Numbers update as each position finishes.</p>':'';
  return `${note}<div class="pcards">${pcol(1)}${pcol(-1)}</div>
  <table class="cls"><thead><tr><th></th><th>White</th><th>Black</th></tr></thead><tbody>${rows}</tbody></table>
  <h3>Biggest swings</h3>${ml}
  <h3>Export</h3><div class="fenrow"><button class="btn" id="copyjson"${A.analyzing?' disabled':''}>Copy analysis as JSON</button><span class="muted small">Same format as the command-line tool and HTTP API.</span></div>`;
}
function movesHTML(){
  const g=A.game,n=g.plies.length;
  const off=g.plies[0].color===-1?1:0;
  const cells=[];
  if(off)cells.push(null);
  for(let i=0;i<n;i++)cells.push(i);
  let h='<div class="sheet" id="sheet">';
  for(let r=0;r<cells.length;r+=2){
    h+=`<div class="mrow"><span class="mn">${g.firstFull+r/2}</span>${cell(cells[r])}${r+1<cells.length?cell(cells[r+1]):'<span></span>'}</div>`;
  }
  return h+'</div>';
}
function cell(i){
  if(i===null)return '<span class="mv empty">…</span>';
  const g=A.game,m=A.moves[i],cls=m?m.cls:'pending';
  const sym=m&&['inacc','mistake','blunder'].includes(cls)?CLS[cls].s:'';
  const ev=A.evals[i+1];
  return `<button class="mv k-${cls}" data-ply="${i+1}" ${A.ply===i+1?'aria-current="true"':''}><span class="san"><i class="dot"></i>${esc(g.plies[i].san)}<b>${sym}</b></span><span class="ev">${ev?esc(evalStr(ev)):''}</span></button>`;
}
function explorerHTML(){
  const g=A.game,k=A.ply,c=cur();
  let h='';
  if(c.line){
    h+=`<h3>Your variation</h3><p class="oname">${esc(lineText(A.line.idx))}</p><p class="muted small">Branching from the game after ${k===0?'the start':esc(moveLabel(k-1))}. <button class="btn" id="exitline" type="button">Back to game</button></p>`;
  }else{
    const nd=g.bookNodes[k],open=g.open[k];
    h+=`<h3>Opening</h3><p class="oname">${open?esc(open):'No named opening yet'}</p>`;
    if(nd){
      const kids=Object.keys(nd.kids).sort((a,b)=>nd.kids[b].n-nd.kids[a].n).slice(0,8);
      const played=k<g.plies.length?skey(g.plies[k].san):null;
      h+=`<p class="muted small">${k===0?'First moves in the built-in opening table.':'Position is in the built-in opening table. Continuations:'}</p>`;
      if(kids.length)h+='<ul class="book">'+kids.map(x=>`<li class="${x===played?'is-played':''}"><b>${esc(x)}</b><span>${esc(nearName(nd.kids[x]))}</span>${x===played?'<em>played</em>':''}</li>`).join('')+'</ul>';
      else h+='<p class="muted small">End of the listed lines.</p>';
    }else{
      let kk=k;while(kk>0&&!g.bookNodes[kk])kk--;
      h+=`<p class="muted small">${kk===0?'Out of the opening table from the first move.':'Out of the opening table after '+esc(moveLabel(kk-1))+'.'} The table covers common first moves only, not full theory.</p>`;
    }
  }
  h+=`<h3>Top moves · ${stmOf(c.fen)===1?'White':'Black'} to play</h3>`+candList(c);
  const ev=A.deep.get(c.fen)||c.ev,deepDone=A.deep.has(c.fen);
  if(ev&&!ev.terminal&&!deepDone)h+=`<p><button class="btn" id="calc" type="button"${A.calc?' disabled':''}>${A.calc?'Searching deeper…':'Search deeper (6 moves)'}</button></p>`;
  h+='<p class="muted small">Tap any piece on the board, then a square, to try your own move. Pawns promote to a queen.</p>';
  h+=`<h3>Position</h3><div class="fenrow"><code id="fen">${esc(c.fen)}</code><button class="btn" id="copyfen">Copy</button></div>`;
  return h;
}
async function calcDeep(){
  if(A.calc)return;
  const c=cur(),g=A.game;
  A.calc=true;renderPanel();
  try{
    const r=await call('top',{fen:c.fen,ms:2500,depth:14,n:6});
    A.deep.set(c.fen,normEval(r,c.fen));
  }catch(e){}
  A.calc=false;
  if(A.game===g){renderBoard();renderComment();renderPanel();}
}
/* ---------- moving pieces on the board ---------- */
function boardTap(sq){
  const c=cur();stopPlay();
  if(A.sel){
    const m=A.dests.find(d=>d.to===sq&&(!d.uci[4]||d.uci[4]==='q'));
    if(m){makeMove(m.uci,c);return;}
  }
  const ch=parseBoard(c.fen)[8-(+sq[1])][FILES.indexOf(sq[0])];
  const white=stmOf(c.fen)===1;
  if(ch&&((ch===ch.toUpperCase())===white)&&A.sel!==sq){
    A.sel=sq;A.dests=EN.moves(c.fen).filter(m=>m.from===sq);
  }else{A.sel=null;A.dests=[];}
  A.hint=null;
  renderBoard();
}
function makeMove(u,c){
  const res=EN.play(c.fen,u);
  if(!res)return;
  const g=A.game;
  A.sel=null;A.dests=[];A.hint=null;
  if(!c.line&&A.ply<g.plies.length&&g.plies[A.ply].uci===u){go(A.ply+1,true);return;}
  const step={uci:u,san:res.san,from:res.from,to:res.to,fen:res.fen};
  const L=A.line;
  if(c.line){
    const nx=L.steps[L.idx];
    if(!(nx&&nx.uci===u)){L.steps=L.steps.slice(0,L.idx);L.steps.push(step);}
    L.idx++;
  }else if(L&&L.base===A.ply&&L.steps[0]&&L.steps[0].uci===u){L.idx=1;}
  else A.line={base:A.ply,steps:[step],idx:1};
  refreshView();
}
function navPrev(){
  if(A.line&&A.line.idx>0){A.line.idx--;A.sel=null;A.dests=[];A.hint=null;refreshView();}
  else go(A.ply-1);
}
function navNext(){
  if(A.line&&A.line.idx<A.line.steps.length){A.line.idx++;A.sel=null;A.dests=[];A.hint=null;refreshView();}
  else go(A.ply+1);
}
/* ---------- JSON export (same shape as the CLI / HTTP API) ---------- */
function exportJSON(){
  const g=A.game,st=stats();
  const pe=e=>!e?null:e.terminal?{cp:0,mate:null,checkmate:e.mated?(e.mate>0?'white':'black'):null}:{cp:e.mate===null?e.w:null,mate:e.mate};
  const nm=c=>c==='inacc'?'inaccuracy':c;
  const side=(c,key)=>{
    const counts={};
    for(const k in st[c].cls)counts[nm(k)]=st[c].cls[k];
    return {player:g.hdr[key]||null,accuracy:st[c].accAvg===null?null:+st[c].accAvg.toFixed(1),averageCentipawnLoss:st[c].acpl===null?null:Math.round(st[c].acpl),counts};
  };
  return {
    headers:g.hdr,opening:g.open[g.open.length-1],parseError:g.error,
    engine:{name:'pgn-review built-in',msPerPosition:QUAL[A.quality].ms,maxDepth:QUAL[A.quality].depth,lines:A.lines},
    summary:{white:side('1','White'),black:side('-1','Black')},
    moves:g.plies.map((pl,k)=>{
      const m=A.moves[k],e0=A.evals[k],e1=A.evals[k+1];
      const off=g.plies[0].color===-1?1:0;
      return {ply:k+1,moveNumber:g.firstFull+Math.floor((k+off)/2),color:pl.color===1?'white':'black',san:pl.san,uci:pl.uci,
        class:m?nm(m.cls):null,candidates:e0?e0.lines.map(l=>({move:l.move,san:l.san,cp:l.mate===null?l.w:null,mate:l.mate,played:l.move===pl.uci})):null,evalBefore:pe(e0),evalAfter:pe(e1),bestMove:e0?e0.best:null,bestMoveSan:e0?e0.bestSan:null,
        winChanceBefore:m?+m.w0.toFixed(1):null,winChanceAfter:m?+m.w1.toFixed(1):null,centipawnLoss:m?Math.round(m.cpLoss):null,
        accuracy:m?+m.acc.toFixed(1):null,opening:g.open[k+1]};
    })
  };
}

/* ---------- navigation ---------- */
function go(k,follow){
  const n=A.game.plies.length;
  k=Math.max(0,Math.min(n,k));
  const had=!!A.line;
  A.line=null;A.sel=null;A.dests=[];
  if(k===A.ply&&follow===undefined&&!had)return;
  A.ply=k;A.hint=null;A.follow=follow!==false;
  renderStrips();renderBoard();renderBar();renderGraph();renderComment();renderPanel();
}
function stopPlay(){
  A.playing=false;clearInterval(A.timer);A.timer=null;
  const b=$('#play');if(b)b.textContent='Play';
}
function togglePlay(){
  if(A.playing){stopPlay();return;}
  if(A.ply>=A.game.plies.length)go(0);
  A.playing=true;$('#play').textContent='Pause';
  A.timer=setInterval(()=>{
    if(A.ply>=A.game.plies.length){stopPlay();return;}
    go(A.ply+1);
  },950);
}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const t=e.target;
  const pl=t.closest&&t.closest('[data-ply]');
  if(pl){stopPlay();go(+pl.dataset.ply,false);return;}
  const hint=t.closest&&t.closest('[data-hint]');
  if(hint){A.hint=A.hint===hint.dataset.hint?null:hint.dataset.hint;renderBoard();renderComment();renderPanel();return;}
  const tab=t.closest&&t.closest('[data-tab]');
  if(tab){A.tab=tab.dataset.tab;A.follow=true;renderPanel();return;}
  if(t.id==='calc'){calcDeep();return;}
  if(t.id==='aiexplain'){aiExplain();return;}
  if(t.id==='exitline'){A.line=null;A.sel=null;A.dests=[];A.hint=null;renderStrips();renderBoard();renderBar();renderGraph();renderComment();renderPanel();return;}
  if(t.id==='copyjson'){
    const txt=JSON.stringify(exportJSON(),null,2);
    const done=ok=>{t.textContent=ok?'Copied':'Copy not allowed here';setTimeout(()=>{t.textContent='Copy analysis as JSON';},1800);};
    try{navigator.clipboard.writeText(txt).then(()=>done(true),()=>done(false));}catch(err){done(false);}
    return;
  }
  if(t.id==='copyfen'){
    const txt=cur().fen;
    const fallback=()=>{const r=document.createRange();r.selectNodeContents($('#fen'));const s=getSelection();s.removeAllRanges();s.addRange(r);};
    try{navigator.clipboard.writeText(txt).then(()=>{t.textContent='Copied';setTimeout(()=>{t.textContent='Copy';},1200);},fallback);}catch(err){fallback();}
  }
});
$('#nav-start').onclick=()=>{stopPlay();go(0);};
$('#nav-prev').onclick=()=>{stopPlay();navPrev();};
$('#nav-next').onclick=()=>{stopPlay();navNext();};
$('#nav-end').onclick=()=>{stopPlay();go(A.game.plies.length);};
$('#play').onclick=togglePlay;
$('#flip').onclick=()=>{A.flip=!A.flip;renderAll();};
$('#board').addEventListener('click',e=>{
  const svg=$('#board svg');if(!svg||!A.game)return;
  const r=svg.getBoundingClientRect();
  const x=Math.floor((e.clientX-r.left)/r.width*8),y=Math.floor((e.clientY-r.top)/r.height*8);
  if(x<0||x>7||y<0||y>7)return;
  boardTap(FILES[A.flip?7-x:x]+(8-(A.flip?7-y:y)));
});
$('#aibtn').onclick=openAiDialog;
$('#ai-provider').onchange=e=>{$('#ai-model').placeholder=AI_DEFAULTS[e.target.value].model;};
$('#aidlg').addEventListener('close',()=>{
  const v=$('#aidlg').returnValue;
  if(v==='save')aiSave({provider:$('#ai-provider').value,base:$('#ai-base').value.trim(),model:$('#ai-model').value.trim(),key:$('#ai-key').value.trim()});
  else if(v==='clear'){const c=aiLoad();c.key='';aiSave(c);}
  renderComment();
});
$('#arrows').onclick=()=>{A.arrows=!A.arrows;$('#arrows').textContent='Arrows: '+(A.arrows?'on':'off');renderBoard();};
$('#lines').onchange=e=>{A.lines=+e.target.value;if(A.games.length)openGame(A.gi);};
$('#go').onclick=loadFromText;
$('#sample').onclick=()=>{$('#pgn').value=SAMPLE;loadFromText();};
$('#clear').onclick=()=>{$('#pgn').value='';$('#pgn').focus();};
$('#pgn').addEventListener('paste',()=>setTimeout(loadFromText,60));
$('#pgn').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();loadFromText();}});
$('#gamesel').onchange=e=>{stopPlay();openGame(+e.target.value);};
$('#quality').onchange=e=>{A.quality=e.target.value;if(A.games.length)openGame(A.gi);};
document.addEventListener('keydown',e=>{
  const tg=e.target.tagName;
  if(tg==='TEXTAREA'||tg==='INPUT'||tg==='SELECT'||!A.game)return;
  if(e.key==='ArrowLeft'){e.preventDefault();stopPlay();navPrev();}
  else if(e.key==='ArrowRight'){e.preventDefault();stopPlay();navNext();}
  else if(e.key==='Home'){e.preventDefault();stopPlay();go(0);}
  else if(e.key==='End'){e.preventDefault();stopPlay();go(A.game.plies.length);}
  else if(e.key==='f'){A.flip=!A.flip;renderAll();}
});
(function(){
  const g=$('#graph');let down=false;
  const at=ev=>{
    const r=g.getBoundingClientRect(),n=A.game.plies.length;
    const k=Math.round((ev.clientX-r.left)/r.width*n);
    stopPlay();go(k,true);
  };
  g.addEventListener('pointerdown',ev=>{down=true;try{g.setPointerCapture(ev.pointerId);}catch(e){}at(ev);});
  g.addEventListener('pointermove',ev=>{if(down)at(ev);});
  g.addEventListener('pointerup',()=>{down=false;});
  g.addEventListener('pointercancel',()=>{down=false;});
})();

/* ---------- init ---------- */
$('#quality').innerHTML=Object.keys(QUAL).map(k=>`<option value="${k}"${k===A.quality?' selected':''}>${QUAL[k].label}</option>`).join('');
$('#lines').innerHTML=[1,2,3,4,5].map(n=>`<option value="${n}"${n===A.lines?' selected':''}>${n}</option>`).join('');
initWorker();
let saved='';
try{saved=localStorage.getItem('pgnreview.pgn')||'';}catch(e){}
$('#pgn').value=saved.trim()?saved:SAMPLE;
loadFromText();
})();
