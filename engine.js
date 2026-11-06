function ENGINE(){
'use strict';
const P=1,N=2,B=3,R=4,Q=5,K=6,INF=32000,MATE=30000;
const FILES='abcdefgh';
const KN=[-33,-31,-18,-14,14,18,31,33],KG=[-17,-16,-15,-1,1,15,16,17],BD=[-17,-15,15,17],RD=[-16,-1,1,16],QD=[-17,-16,-15,-1,1,15,16,17];
const VAL=[0,100,320,330,500,900,0];
const CAS=new Int8Array(128).fill(15);
CAS[4]=12;CAS[0]=13;CAS[7]=14;CAS[116]=3;CAS[112]=7;CAS[119]=11;
const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PB=[0,0,6,14,28,50,85,0];
const ABORT={};
const S={nodes:0,deadline:Infinity};
const now=()=>(typeof performance!=='undefined'?performance.now():Date.now());
const sqName=s=>FILES[s&7]+((s>>4)+1);
const kidx=c=>c===1?0:1;

function parseFEN(fen){
  const f=fen.trim().split(/\s+/);
  const p={b:new Int8Array(128),side:1,cas:0,ep:-1,half:0,full:1,ks:[0,0],hist:[]};
  const rows=f[0].split('/');
  const map={p:1,n:2,b:3,r:4,q:5,k:6};
  for(let r=0;r<8;r++){
    let file=0;const rank=7-r;
    for(const ch of rows[r]){
      if(ch>='1'&&ch<='8'){file+=+ch;}
      else{
        const lo=ch.toLowerCase();const sq=rank*16+file;
        p.b[sq]=(ch===lo?-1:1)*map[lo];
        if(lo==='k')p.ks[ch===lo?1:0]=sq;
        file++;
      }
    }
  }
  p.side=f[1]==='b'?-1:1;
  const c=f[2]||'-';
  if(c.includes('K'))p.cas|=1;
  if(c.includes('Q'))p.cas|=2;
  if(c.includes('k'))p.cas|=4;
  if(c.includes('q'))p.cas|=8;
  if(f[3]&&f[3]!=='-')p.ep=(+f[3][1]-1)*16+FILES.indexOf(f[3][0]);
  p.half=+f[4]||0;p.full=+f[5]||1;
  return p;
}
function toFEN(p){
  let s='';
  for(let r=7;r>=0;r--){
    let e=0;
    for(let f=0;f<8;f++){
      const v=p.b[r*16+f];
      if(!v){e++;continue;}
      if(e){s+=e;e=0;}
      const ch='pnbrqk'[Math.abs(v)-1];
      s+=v>0?ch.toUpperCase():ch;
    }
    if(e)s+=e;
    if(r)s+='/';
  }
  let cs=(p.cas&1?'K':'')+(p.cas&2?'Q':'')+(p.cas&4?'k':'')+(p.cas&8?'q':'');
  if(!cs)cs='-';
  return s+(p.side===1?' w ':' b ')+cs+' '+(p.ep>=0?sqName(p.ep):'-')+' '+p.half+' '+p.full;
}

function attacked(p,sq,by){
  const b=p.b;let q;
  q=sq-by*15;if(!(q&0x88)&&b[q]===by*P)return true;
  q=sq-by*17;if(!(q&0x88)&&b[q]===by*P)return true;
  for(let i=0;i<8;i++){q=sq+KN[i];if(!(q&0x88)&&b[q]===by*N)return true;}
  for(let i=0;i<8;i++){q=sq+KG[i];if(!(q&0x88)&&b[q]===by*K)return true;}
  for(let i=0;i<4;i++){
    const d=BD[i];q=sq+d;
    while(!(q&0x88)){const v=b[q];if(v!==0){if(v===by*B||v===by*Q)return true;break;}q+=d;}
  }
  for(let i=0;i<4;i++){
    const d=RD[i];q=sq+d;
    while(!(q&0x88)){const v=b[q];if(v!==0){if(v===by*R||v===by*Q)return true;break;}q+=d;}
  }
  return false;
}
function inCheck(p){return attacked(p,p.ks[kidx(p.side)],-p.side);}

function gen(p,caps){
  const mv=[],b=p.b,s=p.side;
  for(let sq=0;sq<120;sq++){
    if(sq&0x88){sq+=7;continue;}
    const v=b[sq];
    if(v===0||(v>0)!==(s>0))continue;
    const t=v>0?v:-v;
    if(t===P){
      const dir=s*16,r=sq>>4,start=s===1?1:6,pr=s===1?6:1;
      let to=sq+dir;
      if(b[to]===0){
        if(r===pr){for(let pp=Q;pp>=N;pp--)mv.push(sq|(to<<7)|(pp<<14));}
        else if(!caps){
          mv.push(sq|(to<<7));
          if(r===start&&b[to+dir]===0)mv.push(sq|((to+dir)<<7)|(8<<17));
        }
      }
      for(let k=-1;k<=1;k+=2){
        to=sq+dir+k;
        if(to&0x88)continue;
        const tv=b[to];
        if(tv!==0&&(tv>0)!==(s>0)){
          if(r===pr){for(let pp=Q;pp>=N;pp--)mv.push(sq|(to<<7)|(pp<<14)|(1<<17));}
          else mv.push(sq|(to<<7)|(1<<17));
        }else if(tv===0&&to===p.ep){
          mv.push(sq|(to<<7)|(3<<17));
        }
      }
    }else if(t===N||t===K){
      const ds=t===N?KN:KG;
      for(let i=0;i<8;i++){
        const to=sq+ds[i];
        if(to&0x88)continue;
        const tv=b[to];
        if(tv===0){if(!caps)mv.push(sq|(to<<7));}
        else if((tv>0)!==(s>0))mv.push(sq|(to<<7)|(1<<17));
      }
      if(t===K&&!caps){
        if(s===1&&sq===4){
          if((p.cas&1)&&b[5]===0&&b[6]===0&&b[7]===R&&!attacked(p,4,-1)&&!attacked(p,5,-1)&&!attacked(p,6,-1))mv.push(4|(6<<7)|(4<<17));
          if((p.cas&2)&&b[3]===0&&b[2]===0&&b[1]===0&&b[0]===R&&!attacked(p,4,-1)&&!attacked(p,3,-1)&&!attacked(p,2,-1))mv.push(4|(2<<7)|(4<<17));
        }else if(s===-1&&sq===116){
          if((p.cas&4)&&b[117]===0&&b[118]===0&&b[119]===-R&&!attacked(p,116,1)&&!attacked(p,117,1)&&!attacked(p,118,1))mv.push(116|(118<<7)|(4<<17));
          if((p.cas&8)&&b[115]===0&&b[114]===0&&b[113]===0&&b[112]===-R&&!attacked(p,116,1)&&!attacked(p,115,1)&&!attacked(p,114,1))mv.push(116|(114<<7)|(4<<17));
        }
      }
    }else{
      const ds=t===B?BD:t===R?RD:QD;
      for(let i=0;i<ds.length;i++){
        const d=ds[i];let to=sq+d;
        while(!(to&0x88)){
          const tv=b[to];
          if(tv===0){if(!caps)mv.push(sq|(to<<7));}
          else{if((tv>0)!==(s>0))mv.push(sq|(to<<7)|(1<<17));break;}
          to+=d;
        }
      }
    }
  }
  return mv;
}

function make(p,m){
  const from=m&127,to=(m>>7)&127,promo=(m>>14)&7,fl=m>>17;
  const b=p.b,s=p.side,pc=b[from];
  const u={m:m,cap:b[to],cas:p.cas,ep:p.ep,half:p.half};
  p.hist.push(u);
  b[to]=promo?s*promo:pc;
  b[from]=0;
  if(fl&2){b[to-s*16]=0;u.cap=-s*P;}
  if(fl&4){
    if(to>from){b[to-1]=b[to+1];b[to+1]=0;}
    else{b[to+1]=b[to-2];b[to-2]=0;}
  }
  const t=pc*s;
  if(t===K)p.ks[kidx(s)]=to;
  p.cas&=CAS[from]&CAS[to];
  p.ep=(fl&8)?from+s*16:-1;
  p.half=(t===P||u.cap!==0)?0:p.half+1;
  if(s===-1)p.full++;
  p.side=-s;
}
function unmake(p){
  const u=p.hist.pop();
  p.side=-p.side;
  const s=p.side,m=u.m,b=p.b;
  const from=m&127,to=(m>>7)&127,promo=(m>>14)&7,fl=m>>17;
  const pc=promo?s*P:b[to];
  b[from]=pc;
  if(fl&2){b[to]=0;b[to-s*16]=u.cap;}
  else b[to]=u.cap;
  if(fl&4){
    if(to>from){b[to+1]=b[to-1];b[to-1]=0;}
    else{b[to-2]=b[to+1];b[to+1]=0;}
  }
  if(pc*s===K)p.ks[kidx(s)]=from;
  p.cas=u.cas;p.ep=u.ep;p.half=u.half;
  if(s===-1)p.full--;
}
function legalMoves(p){
  const ml=gen(p,false),out=[];
  for(let i=0;i<ml.length;i++){
    make(p,ml[i]);
    if(!attacked(p,p.ks[kidx(-p.side)],p.side))out.push(ml[i]);
    unmake(p);
  }
  return out;
}
function uci(m){
  const promo=(m>>14)&7;
  return sqName(m&127)+sqName((m>>7)&127)+(promo?' pnbrq'[promo]:'');
}
function sanOf(p,m,legal,suffix){
  const from=m&127,to=(m>>7)&127,promo=(m>>14)&7,fl=m>>17;
  const pc=Math.abs(p.b[from]);
  let s;
  if(fl&4)s=to>from?'O-O':'O-O-O';
  else if(pc===P){
    s='';
    if(fl&1)s=FILES[from&7]+'x';
    s+=sqName(to);
    if(promo)s+='='+' PNBRQK'[promo];
  }else{
    s=' PNBRQK'[pc];
    let amb=false,sameF=false,sameR=false;
    for(let i=0;i<legal.length;i++){
      const o=legal[i];
      if(o===m)continue;
      if(((o>>7)&127)!==to)continue;
      const of=o&127;
      if(Math.abs(p.b[of])!==pc)continue;
      amb=true;
      if((of&7)===(from&7))sameF=true;
      if((of>>4)===(from>>4))sameR=true;
    }
    if(amb){
      if(!sameF)s+=FILES[from&7];
      else if(!sameR)s+=(from>>4)+1;
      else s+=FILES[from&7]+((from>>4)+1);
    }
    if(fl&1)s+='x';
    s+=sqName(to);
  }
  if(suffix){
    make(p,m);
    if(inCheck(p))s+=legalMoves(p).length?'+':'#';
    unmake(p);
  }
  return s;
}

function evalW(p){
  const b=p.b;
  let nonP=0;
  const bmax=[-1,-1,-1,-1,-1,-1,-1,-1],wmin=[8,8,8,8,8,8,8,8];
  for(let sq=0;sq<120;sq++){
    if(sq&0x88){sq+=7;continue;}
    const v=b[sq];
    if(!v)continue;
    const t=v>0?v:-v;
    if(t===P){
      const f=sq&7,r=sq>>4;
      if(v>0){if(r<wmin[f])wmin[f]=r;}
      else if(r>bmax[f])bmax[f]=r;
    }else if(t!==K)nonP+=VAL[t];
  }
  const endg=nonP<=2600;
  let sc=0,wB=0,bB=0;
  for(let sq=0;sq<120;sq++){
    if(sq&0x88){sq+=7;continue;}
    const v=b[sq];
    if(!v)continue;
    const t=v>0?v:-v,c=v>0?1:-1;
    const f=sq&7,rank=sq>>4,rr=c===1?rank:7-rank;
    const cf=f<4?f:7-f,cr=rank<4?rank:7-rank,ctr=cf+cr;
    let x;
    switch(t){
      case P:{
        x=100+rr*8+(cf>=2?rr*2:0);
        let passed=true;
        const g0=f>0?f-1:0,g1=f<7?f+1:7;
        for(let g=g0;g<=g1;g++){
          if(c===1?bmax[g]>rank:wmin[g]<rank){passed=false;break;}
        }
        if(passed)x+=PB[rr];
        break;
      }
      case N:x=320+ctr*8-(rr===0?8:0);break;
      case B:x=330+ctr*4-(rr===0?5:0);if(c===1)wB++;else bB++;break;
      case R:x=500+(rr===6?18:0);break;
      case Q:x=900+ctr*2;break;
      default:x=endg?ctr*10:(rr===0?((f<=2||f>=6)?25:0):-rr*10);
    }
    sc+=c*x;
  }
  if(wB>=2)sc+=25;
  if(bB>=2)sc-=25;
  return sc;
}
const evalStm=p=>p.side===1?evalW(p):-evalW(p);

function order(p,mv){
  const sc=new Array(mv.length);
  for(let i=0;i<mv.length;i++){
    const m=mv[i],to=(m>>7)&127,from=m&127;
    let s=0;
    const cap=p.b[to];
    if(cap!==0)s=10000+VAL[cap>0?cap:-cap]*10-VAL[Math.abs(p.b[from])];
    else if((m>>17)&2)s=10900;
    const pr=(m>>14)&7;
    if(pr)s+=pr===Q?9000:100;
    sc[i]=s;
  }
  return sc;
}
function pick(mv,sc,i){
  let bi=i,bs=sc[i];
  for(let j=i+1;j<mv.length;j++)if(sc[j]>bs){bs=sc[j];bi=j;}
  if(bi!==i){
    const tm=mv[i];mv[i]=mv[bi];mv[bi]=tm;
    const ts=sc[i];sc[i]=sc[bi];sc[bi]=ts;
  }
  return mv[i];
}

function qs(p,alpha,beta,ply,qd){
  if((++S.nodes&1023)===0&&now()>S.deadline)throw ABORT;
  if(p.half>=100)return 0;
  const chk=inCheck(p);
  let bestv=-INF;
  if(!chk){
    const e=evalStm(p);
    if(e>=beta)return e;
    if(e>alpha)alpha=e;
    bestv=e;
  }else if(qd>=6)return evalStm(p);
  const mv=gen(p,!chk),sc=order(p,mv);
  let legal=0;
  for(let i=0;i<mv.length;i++){
    const m=pick(mv,sc,i);
    make(p,m);
    if(attacked(p,p.ks[kidx(-p.side)],p.side)){unmake(p);continue;}
    legal++;
    const v=-qs(p,-beta,-alpha,ply+1,qd+1);
    unmake(p);
    if(v>bestv){bestv=v;if(v>alpha){alpha=v;if(alpha>=beta)break;}}
  }
  if(chk&&legal===0)return -(MATE-ply);
  return bestv;
}
function nega(p,depth,alpha,beta,ply){
  if((++S.nodes&1023)===0&&now()>S.deadline)throw ABORT;
  if(p.half>=100)return 0;
  const chk=inCheck(p);
  if(chk&&ply<12)depth++;
  if(depth<=0)return qs(p,alpha,beta,ply,0);
  const mv=gen(p,false),sc=order(p,mv);
  let legal=0,bestv=-INF;
  for(let i=0;i<mv.length;i++){
    const m=pick(mv,sc,i);
    make(p,m);
    if(attacked(p,p.ks[kidx(-p.side)],p.side)){unmake(p);continue;}
    legal++;
    const v=-nega(p,depth-1,-beta,-alpha,ply+1);
    unmake(p);
    if(v>bestv){bestv=v;if(v>alpha){alpha=v;if(alpha>=beta)break;}}
  }
  if(legal===0)return chk?-(MATE-ply):0;
  return bestv;
}

function rootOrder(p,legal,first){
  const sc=order(p,legal);
  const arr=legal.map((m,i)=>[sc[i],m]).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  return first===undefined?arr:[first].concat(arr.filter(m=>m!==first));
}
function best(fen,ms,maxDepth){
  const p=parseFEN(fen),legal=legalMoves(p),chk=inCheck(p);
  if(!legal.length)return {terminal:true,mate:chk,score:chk?-MATE:0,stm:p.side};
  let bm=legal[0],bs=0,bd=0;
  const t0=now(),h0=p.hist.length;
  for(let d=1;d<=maxDepth;d++){
    S.deadline=d===1?Infinity:t0+ms;
    S.nodes=0;
    try{
      const ordered=rootOrder(p,legal,d===1?undefined:bm);
      let alpha=-INF,cur=null,curS=-INF;
      for(const m of ordered){
        make(p,m);
        const v=-nega(p,d-1,-INF,-alpha,1);
        unmake(p);
        if(cur===null||v>curS){curS=v;cur=m;}
        if(v>alpha)alpha=v;
      }
      bm=cur;bs=curS;bd=d;
      if(Math.abs(bs)>MATE-100)break;
      if(legal.length===1&&d>=3)break;
    }catch(e){
      if(e!==ABORT)throw e;
      while(p.hist.length>h0)unmake(p);
      break;
    }
  }
  return {move:uci(bm),san:sanOf(p,bm,legal,true),score:bs,depth:bd,stm:p.side};
}
function multi(fen,maxDepth,ms){
  const p=parseFEN(fen),legal=legalMoves(p);
  if(!legal.length)return {lines:[],depth:0,stm:p.side};
  let lines=legal.map(m=>({m:m,s:0})),done=0;
  const t0=now(),h0=p.hist.length;
  for(let d=1;d<=maxDepth;d++){
    S.deadline=d<=2?Infinity:t0+ms;
    S.nodes=0;
    try{
      const prev=lines.map(x=>x.m);
      const ordered=d===1?rootOrder(p,legal):prev;
      const cur=[];
      for(const m of ordered){
        make(p,m);
        const v=-nega(p,d-1,-INF,INF,1);
        unmake(p);
        cur.push({m:m,s:v});
      }
      cur.sort((a,b)=>b.s-a.s);
      lines=cur;done=d;
    }catch(e){
      if(e!==ABORT)throw e;
      while(p.hist.length>h0)unmake(p);
      break;
    }
  }
  return {depth:done,stm:p.side,lines:lines.slice(0,6).map(x=>({move:uci(x.m),san:sanOf(p,x.m,legal,true),score:x.s}))};
}
function top(fen,ms,maxDepth,n){
  // Multi-line search: the n best root moves, each with an exact score.
  // A root move only needs a full search while it can still beat the current n-th best.
  const p=parseFEN(fen),legal=legalMoves(p),chk=inCheck(p);
  if(!legal.length)return {terminal:true,mate:chk,score:chk?-MATE:0,stm:p.side,lines:[]};
  n=Math.max(1,Math.min(n||3,legal.length));
  let lines=null,bd=0,order=null;
  const t0=now(),h0=p.hist.length;
  for(let d=1;d<=maxDepth;d++){
    S.deadline=d===1?Infinity:t0+ms;
    S.nodes=0;
    try{
      const ordered=order||rootOrder(p,legal);
      const cur=[];
      for(const m of ordered){
        const alpha=cur.length<n?-INF:cur[n-1].s;
        make(p,m);
        const v=-nega(p,d-1,-INF,-alpha,1);
        unmake(p);
        if(cur.length<n||v>alpha){
          let i=cur.length;
          while(i>0&&cur[i-1].s<v)i--;
          cur.splice(i,0,{m:m,s:v});
          if(cur.length>n)cur.pop();
        }
      }
      lines=cur;bd=d;
      order=cur.map(x=>x.m).concat(ordered.filter(m=>!cur.some(x=>x.m===m)));
      if(Math.abs(cur[0].s)>MATE-100)break;
      if(legal.length===1&&d>=3)break;
    }catch(e){
      if(e!==ABORT)throw e;
      while(p.hist.length>h0)unmake(p);
      break;
    }
  }
  return {move:uci(lines[0].m),san:sanOf(p,lines[0].m,legal,true),score:lines[0].s,depth:bd,stm:p.side,
    lines:lines.map(x=>({move:uci(x.m),san:sanOf(p,x.m,legal,true),score:x.s}))};
}
function movesFrom(fen){
  const p=parseFEN(fen);
  return legalMoves(p).map(m=>({uci:uci(m),from:sqName(m&127),to:sqName((m>>7)&127)}));
}
function play(fen,u){
  const p=parseFEN(fen),legal=legalMoves(p);
  for(const m of legal){
    if(uci(m)===u){
      const san=sanOf(p,m,legal,true),from=sqName(m&127),to=sqName((m>>7)&127);
      make(p,m);
      return {uci:u,san:san,from:from,to:to,fen:toFEN(p)};
    }
  }
  return null;
}
function perft(fen,d){
  const p=parseFEN(fen);
  const go=n=>{
    if(n===0)return 1;
    const ml=legalMoves(p);
    if(n===1)return ml.length;
    let c=0;
    for(const m of ml){make(p,m);c+=go(n-1);unmake(p);}
    return c;
  };
  return go(d);
}

const normKey=s=>s.replace(/0/g,'O').replace(/e\.p\./,'').replace(/[+#!?x=:\-]/g,'');
function altKeys(p,m){
  const from=m&127,to=(m>>7)&127,pc=Math.abs(p.b[from]);
  if(pc===P||pc===K)return [];
  const L=' PNBRQK'[pc],f=FILES[from&7],r=String((from>>4)+1),t=sqName(to);
  return [L+f+t,L+r+t,L+f+r+t];
}
function cleanMovetext(text){
  let t=text.replace(/\{[^}]*\}/g,' ').replace(/;[^\n]*/g,' ');
  let prev;
  do{prev=t;t=t.replace(/\([^()]*\)/g,' ');}while(t!==prev);
  t=t.replace(/\$\d+/g,' ').replace(/\d+\.+/g,' ');
  return t.split(/\s+/).filter(x=>x&&!/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x));
}
function parseGame(text){
  const hdr={};
  const body=text.replace(/\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g,(m,k,v)=>{hdr[k]=v;return ' ';});
  const start=(hdr.FEN&&hdr.SetUp!=='0')?hdr.FEN:START;
  const p=parseFEN(start);
  const fens=[toFEN(p)],plies=[];
  const tokens=cleanMovetext(body);
  let error=null;
  for(const tok of tokens){
    const legal=legalMoves(p);
    const key=normKey(tok);
    let found=null;
    for(const m of legal){if(normKey(sanOf(p,m,legal,false))===key){found=m;break;}}
    if(found===null){
      for(const m of legal){if(altKeys(p,m).some(a=>normKey(a)===key)){found=m;break;}}
    }
    if(found===null){error={ply:plies.length+1,token:tok};break;}
    const from=found&127,to=(found>>7)&127;
    plies.push({san:sanOf(p,found,legal,true),uci:uci(found),from:sqName(from),to:sqName(to),color:p.side,legalCount:legal.length});
    make(p,found);
    fens.push(toFEN(p));
  }
  if(!plies.length&&!error)error={ply:1,token:'',empty:true};
  return {hdr:hdr,plies:plies,fens:fens,error:error,firstFull:parseInt(fens[0].split(' ')[5],10)||1};
}
return {parseGame:parseGame,best:best,multi:multi,top:top,moves:movesFrom,play:play,perft:perft,START:START};
}
if(typeof module!=='undefined')module.exports=ENGINE;
