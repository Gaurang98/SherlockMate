// SherlockMate
(function(){
'use strict';
if(window.__SM_LOADED) return;
window.__SM_LOADED = true;

const state = { enabled:true, analyzing:false, lastFen:null, depth:15, site: location.hostname.includes('lichess')?'lichess':'chesscom' };

function readFen(){
  try{
    const site = state.site==='lichess'?'lichess':'chesscom';
    const result = site==='lichess'?readLichess():readChesscom();
    console.log('[SM] readFen - site:', site, 'result:', result?.substring(0, 50));
    return result;
  }catch(e){
    console.log('[SM] readFen error:', e.message);
    return null;
  }
}
function readLichess(){
  const cg=document.querySelector('cg-board,.cg-wrap');
  if(cg){let el=cg;while(el&&el!==document.body){if(el.dataset&&el.dataset.fen)return el.dataset.fen;el=el.parentElement;}}
  try{if(window.lichess&&window.lichess.analysis)return window.lichess.analysis.data.game.fen;}catch{}
  for(const s of document.querySelectorAll('script:not([src])')){const m=s.textContent.match(/"fen":"([^"]{20,})"/);if(m&&vFen(m[1]))return m[1];}
  return null;
}
function reconstructFenFromBoard(){
  try{
    const pieceFenMap={
      'wp':'P','wn':'N','wb':'B','wr':'R','wq':'Q','wk':'K',
      'bp':'p','bn':'n','bb':'b','br':'r','bq':'q','bk':'k'
    };
    const board={};
    const pieces=document.querySelectorAll('.piece');
    console.log('[SM] Found pieces on board:', pieces.length);

    pieces.forEach(p=>{
      const classes=p.className.split(' ');
      const squareClass=classes.find(c=>c.startsWith('square-'));
      if(squareClass){
        const squareNum=squareClass.replace('square-','');
        const file=String.fromCharCode(96+parseInt(squareNum[0]));
        const rank=squareNum[1];
        const square=file+rank;
        let piece=null;
        for(let k in pieceFenMap){if(classes.includes(k)){piece=pieceFenMap[k];break;}}
        if(piece)board[square]=piece;
      }
    });

    let fen='';
    for(let rank=8;rank>=1;rank--){
      let empty=0;
      for(let fileCode=97;fileCode<=104;fileCode++){
        const file=String.fromCharCode(fileCode);
        const square=file+rank;
        const piece=board[square];
        if(piece){if(empty){fen+=empty;empty=0;}fen+=piece;}else{empty++;}
      }
      if(empty)fen+=empty;
      if(rank>1)fen+='/';
    }

    if(fen){
      // Determine whose turn it is by checking move count
      const moveElements=document.querySelectorAll('.node');
      const moveCount=moveElements.length;
      const turn=moveCount%2===0?'w':'b';

      // Determine castling rights based on piece positions
      let castling='';
      // White kingside: King on e1, Rook on h1
      if(board['e1']==='K'&&board['h1']==='R')castling+='K';
      // White queenside: King on e1, Rook on a1
      if(board['e1']==='K'&&board['a1']==='R')castling+='Q';
      // Black kingside: King on e8, Rook on h8
      if(board['e8']==='k'&&board['h8']==='r')castling+='k';
      // Black queenside: King on e8, Rook on a8
      if(board['e8']==='k'&&board['a8']==='r')castling+='q';

      // If no castling available, use '-'
      if(!castling)castling='-';

      // Complete FEN with turn, castling, en passant, halfmove, fullmove
      const completeFen=fen+' '+turn+' '+castling+' - 0 1';
      console.log('[SM] Reconstructed FEN from board:', completeFen);
      return completeFen;
    }
    return null;
  }catch(e){
    console.log('[SM] Error reconstructing FEN from board:', e.message);
    return null;
  }
}
function readChesscom(){
  console.log('[SM] readChesscom - detecting Chess.com position...');
  let fen=null;
  try{
    const cb=document.querySelector('chess-board');
    if(cb){
      try{if(cb.game&&cb.game.getFEN){fen=cb.game.getFEN();console.log('[SM] Got FEN from cb.game.getFEN:', fen?.substring(0,50));}}catch{}
      if(!fen){
        const rk=Object.keys(cb).find(k=>k.startsWith('__reactFiber')||k.startsWith('__reactInternalInstance'));
        if(rk){let f=cb[rk],i=0;while(f&&i++<50){const p=f.memoizedProps||f.pendingProps||{};if(p.fen&&vFen(p.fen)){fen=p.fen;console.log('[SM] Got FEN from react props:', fen.substring(0,50));break;}if(p.game&&p.game.getFEN){fen=p.game.getFEN();console.log('[SM] Got FEN from react game:', fen?.substring(0,50));break;}f=f.return;}}
      }
    }
  }catch(e){console.log('[SM] Error checking chess-board:', e.message);}
  if(!fen){
    try{if(window.game&&window.game.getFEN){fen=window.game.getFEN();console.log('[SM] Got FEN from window.game:', fen?.substring(0,50));}}catch{}
  }
  if(!fen){
    for(const s of document.querySelectorAll('script:not([src])')){const m=s.textContent.match(/"fen":"([^"]{20,})"/);if(m&&vFen(m[1])){fen=m[1];console.log('[SM] Got FEN from script tag:', fen.substring(0,50));break;}}
  }
  if(!fen){
    fen=reconstructFenFromBoard();
  }
  if(fen)console.log('[SM] readChesscom - Final FEN:', fen.substring(0,50));
  else console.log('[SM] readChesscom - No FEN found');
  return fen||null;
}
function vFen(f){return f&&typeof f==='string'&&f.trim().split(/\s+/)[0].split('/').length===8;}

async function analyze(fen){
  if(!state.enabled||state.analyzing||!fen||fen===state.lastFen||!vFen(fen))return;
  state.lastFen=fen; state.analyzing=true;
  setStatus('analyzing','Analysing…'); clearCards();
  try{
    const url=`https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=${state.depth}&multiPV=3`;
    console.log('[SM] Fetching Stockfish API:', url);
    const res=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new Error(`HTTP ${res.status} - ${res.statusText}`);
    const data=await res.json();
    console.log('[SM] API Response:', data);
    if(!data.success){
      const errMsg=data.error?` - ${data.error}`:'';
      throw new Error(`API error${errMsg}`);
    }
    if(!data.continuation && !data.bestmove){
      throw new Error('No moves in response');
    }
    const moves=parseMoves(data,fen);
    console.log('[SM] Parsed moves:', moves);
    if(!moves.length)throw new Error('Failed to parse moves');
    moves.forEach((m,i)=>renderCard(i+1,m));
    setStatus('ready',`Depth ${state.depth} · ${moves.length} move${moves.length>1?'s':''}`);
    chrome.runtime.sendMessage({type:'EXPLAIN',fen,moves},r=>{
      if(chrome.runtime.lastError)return;
      if(r&&r.explanations)r.explanations.forEach((e,i)=>{const el=document.getElementById(`smc-expl-${i+1}`);if(el&&e)el.textContent=e;});
      setStatus('ready','Analysis complete ✓');
    });
  }catch(err){
    console.error('[SM] Analysis failed:', err.message);
    console.error('[SM] Error type:', err.name);
    setStatus('error','Engine error — retrying in 5s');
    setTimeout(()=>{state.analyzing=false;state.lastFen=null;},5000);
    return;
  }
  state.analyzing=false;
}

function parseMoves(data,fen){
  const moves=[];
  console.log('[SM] Raw API response:', JSON.stringify(data));

  // Current Stockfish API v2.1.8a returns: success, evaluation, mate, bestmove, continuation
  // Extract moves from continuation field (space-separated UCI moves)
  if(data.continuation){
    const moveList=data.continuation.trim().split(/\s+/).filter(m=>m.length>=4&&m.length<=5);
    console.log('[SM] Extracted moves from continuation:', moveList);

    // For top 3 moves, we take first 3 from continuation
    for(let i=0; i<Math.min(3, moveList.length); i++){
      const uci=moveList[i];
      const score=data.mate?
        (data.mate>0?`M+${data.mate}`:`M${data.mate}`):
        (data.evaluation!=null?(data.evaluation>=0?`+${data.evaluation.toFixed(2)}`:`${data.evaluation.toFixed(2)}`):'+0.00');
      const san=uciToSan(uci,fen);

      moves.push({
        rank:i+1,
        uci,
        san,
        score,
        scoreRaw:data.mate?data.mate:Math.round((data.evaluation||0)*100),
        scoreType:data.mate?'mate':'cp'
      });
    }
  }

  // Fallback: use bestmove if no continuation
  if(!moves.length && data.bestmove){
    console.log('[SM] Using fallback bestmove:', data.bestmove);
    const bm=data.bestmove.replace(/^bestmove\s+/,'').split(/\s+/)[0];
    if(bm && bm!=='(none)'){
      const score=data.mate?
        (data.mate>0?`M+${data.mate}`:`M${data.mate}`):
        (data.evaluation!=null?(data.evaluation>=0?`+${data.evaluation.toFixed(2)}`:`${data.evaluation.toFixed(2)}`):'+0.00');
      moves.push({
        rank:1,
        uci:bm,
        san:uciToSan(bm,fen),
        score,
        scoreRaw:data.mate?data.mate:Math.round((data.evaluation||0)*100),
        scoreType:data.mate?'mate':'cp'
      });
    }
  }

  console.log('[SM] Final parsed moves:', moves);
  return moves;
}

const SYM={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
function brd(fen){return fen.split(' ')[0].split('/').map(row=>{const a=[];for(const c of row)/\d/.test(c)?a.push(...Array(+c).fill('')):a.push(c);return a;});}
function pat(b,sq){return b[8-parseInt(sq[1])]?.[sq.charCodeAt(0)-97]||'';}
function uciToSan(uci,fen){
  if(!uci||uci.length<4)return{symbol:'',san:uci||'?',isCapture:false};
  const from=uci.slice(0,2),to=uci.slice(2,4),promo=uci[4]?.toUpperCase()||null;
  const board=brd(fen),turn=(fen.split(' ')[1]||'w'),piece=pat(board,from),tgt=pat(board,to);
  const pl=piece.toUpperCase(),sym=SYM[piece]||'♟';
  const isCap=tgt!==''&&(turn==='w'?/[a-z]/.test(tgt):/[A-Z]/.test(tgt));
  if(pl==='K'){
    if(from==='e1'&&to==='g1')return{symbol:'♔',san:'O-O',isCapture:false};
    if(from==='e1'&&to==='c1')return{symbol:'♔',san:'O-O-O',isCapture:false};
    if(from==='e8'&&to==='g8')return{symbol:'♚',san:'O-O',isCapture:false};
    if(from==='e8'&&to==='c8')return{symbol:'♚',san:'O-O-O',isCapture:false};
  }
  const san=(pl==='P'||!piece)?(isCap?`${from[0]}x${to}`:to)+(promo?`=${promo}`:''):pl+(isCap?'x':'')+to;
  return{symbol:sym,san,isCapture:isCap,promo};
}

function createPanel(){
  if(document.getElementById('sm-root'))return;
  const root=document.createElement('div');
  root.id='sm-root';
  root.innerHTML=`
    <div id="sm-panel">
      <div id="sm-header">
        <span id="sm-logo">🔍 <b>SherlockMate</b></span>
        <div id="sm-hbtns">
          <button id="sm-toggle" data-on="1">ON</button>
          <button id="sm-min">—</button>
        </div>
      </div>
      <div id="sm-body">
        <div id="sm-statusbar"><span id="sm-dot" class="dot-idle"></span><span id="sm-stxt">Waiting for position…</span></div>
        <div id="sm-cards">
          ${[1,2,3].map(i=>`
          <div class="smc" id="smc-${i}">
            <div class="smc-top">
              <span class="smc-medal">${['🥇','🥈','🥉'][i-1]}</span>
              <span class="smc-lbl">${['Best Move','2nd Best','3rd Best'][i-1]}</span>
              <span class="smc-score" id="smc-sc-${i}"></span>
            </div>
            <div class="smc-move">
              <span class="smc-sym"  id="smc-sym-${i}"></span>
              <span class="smc-san"  id="smc-san-${i}">—</span>
              <span class="smc-tags" id="smc-tags-${i}"></span>
            </div>
            <div class="smc-expl" id="smc-expl-${i}"></div>
          </div>`).join('')}
        </div>
        <div id="sm-keysec">
          <div id="sm-keylbl">Groq Key <span id="sm-keyhint">not saved</span></div>
          <div id="sm-keyrow">
            <input type="password" id="sm-keyinput" placeholder="gsk_…" autocomplete="off" spellcheck="false"/>
            <button id="sm-eyebtn">👁</button>
            <button id="sm-savebtn">💾</button>
            <button id="sm-delbtn" style="display:none">🗑</button>
          </div>
          <div id="sm-keymsg"></div>
        </div>
        <div id="sm-depthrow">
          <span class="sm-lbl">Depth</span>
          <input type="range" id="sm-depth" min="8" max="18" value="15"/>
          <span id="sm-depthval">15</span>
        </div>
        <div id="sm-footer">Your move. Your choice.</div>
      </div>
    </div>
    <div id="sm-bubble" style="display:none">🔍</div>
  `;
  document.body.appendChild(root);
  bindAll();
  checkKey();
}

function bindAll(){
  g('sm-min').onclick=()=>{show('sm-panel',false);show('sm-bubble',true);};
  g('sm-bubble').onclick=()=>{show('sm-panel',true);show('sm-bubble',false);};
  const tb=g('sm-toggle');
  tb.onclick=()=>{
    state.enabled=!state.enabled;tb.textContent=state.enabled?'ON':'OFF';tb.dataset.on=state.enabled?'1':'0';
    if(state.enabled){state.lastFen=null;const f=readFen();if(f)analyze(f);}
    else{clearCards();setStatus('idle','Suggestions off');}
  };
  g('sm-eyebtn').onclick=()=>{const i=g('sm-keyinput');i.type=i.type==='password'?'text':'password';};
  g('sm-savebtn').onclick=()=>{
    const k=g('sm-keyinput').value.trim();
    if(!k.startsWith('gsk_')){keyMsg('Key must start with gsk_','err');return;}
    chrome.runtime.sendMessage({type:'SAVE_KEY',key:k},r=>{if(r&&r.ok)keySaved();else keyMsg('Failed','err');});
  };
  g('sm-delbtn').onclick=()=>chrome.runtime.sendMessage({type:'CLEAR_KEY'},()=>keyCleared());
  g('sm-depth').oninput=()=>{state.depth=parseInt(g('sm-depth').value);g('sm-depthval').textContent=g('sm-depth').value;state.lastFen=null;};
  drag(g('sm-panel'),g('sm-header'));
}

function drag(el,handle){
  let sx,sy,sl,st;
  const go=(cx,cy)=>{el.style.right='auto';el.style.left=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,sl+cx-sx))+'px';el.style.top=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,st+cy-sy))+'px';};
  handle.addEventListener('mousedown',e=>{
    if(['BUTTON','INPUT'].includes(e.target.tagName))return;
    e.preventDefault();const r=el.getBoundingClientRect();sx=e.clientX;sy=e.clientY;sl=r.left;st=r.top;el.style.transition='none';
    const mm=e2=>go(e2.clientX,e2.clientY);
    const mu=()=>{el.style.transition='';removeEventListener('mousemove',mm);removeEventListener('mouseup',mu);};
    addEventListener('mousemove',mm);addEventListener('mouseup',mu);
  });
  handle.addEventListener('touchstart',e=>{
    if(['BUTTON','INPUT'].includes(e.target.tagName))return;
    const t=e.touches[0],r=el.getBoundingClientRect();sx=t.clientX;sy=t.clientY;sl=r.left;st=r.top;
    const tm=e2=>{const t2=e2.touches[0];go(t2.clientX,t2.clientY);};
    const tu=()=>{handle.removeEventListener('touchmove',tm);handle.removeEventListener('touchend',tu);};
    handle.addEventListener('touchmove',tm,{passive:true});handle.addEventListener('touchend',tu);
  },{passive:true});
}

function checkKey(){chrome.runtime.sendMessage({type:'HAS_KEY'},r=>{if(r&&r.exists)keySaved();});}
function keySaved(){g('sm-keyhint').textContent='🔒 saved';g('sm-keyhint').style.color='#4ade80';g('sm-keyinput').placeholder='••••••••••••';g('sm-keyinput').value='';g('sm-savebtn').style.display='none';g('sm-delbtn').style.display='inline-flex';keyMsg('Key loaded ✓','ok');}
function keyCleared(){g('sm-keyhint').textContent='not saved';g('sm-keyhint').style.color='';g('sm-keyinput').placeholder='gsk_…';g('sm-keyinput').value='';g('sm-savebtn').style.display='inline-flex';g('sm-delbtn').style.display='none';keyMsg('Key removed','warn');}
function keyMsg(t,type){const el=g('sm-keymsg');el.textContent=t;el.className='km-'+type;setTimeout(()=>{el.textContent='';el.className='';},3500);}
function setStatus(type,text){const d=g('sm-dot'),s=g('sm-stxt');if(d)d.className='dot-'+type;if(s)s.textContent=text;}
function renderCard(rank,move){
  const sym=document.getElementById(`smc-sym-${rank}`),san=document.getElementById(`smc-san-${rank}`),
        tags=document.getElementById(`smc-tags-${rank}`),sc=document.getElementById(`smc-sc-${rank}`),card=document.getElementById(`smc-${rank}`);
  if(!card||!sym||!san||!tags||!sc)return console.warn(`[SM] Missing DOM elements for card ${rank}`);
  const s=move.san||{};
  if(!s.symbol&&!s.san)return console.warn(`[SM] Invalid move data for rank ${rank}`,move);
  sym.textContent=s.symbol||'';san.textContent=s.san||move.uci;
  let t='';
  if(s.isCapture)t+='<span class="tx">✕</span>';
  if(s.promo)t+=`<span class="tp">=${s.promo}</span>`;
  if(move.scoreType==='mate'&&move.scoreRaw>0)t+='<span class="tm"># Mate</span>';
  tags.innerHTML=t;sc.textContent=move.score;sc.className='smc-score '+(move.scoreRaw>=0?'sp':'sn');
  card.classList.add('act');card.style.animation='none';void card.offsetWidth;card.style.animation='smIn .25s ease forwards';
}
function clearCards(){[1,2,3].forEach(i=>{const card=document.getElementById(`smc-${i}`);if(card)card.classList.remove('act');['san','sym','sc','tags','expl'].forEach(k=>{const el=document.getElementById(`smc-${k}-${i}`);if(el){if(k==='tags')el.innerHTML='';else el.textContent=k==='san'?'—':'';}});});}
const g=id=>document.getElementById(id);
const show=(id,v)=>{const e=g(id);if(e)e.style.display=v?'flex':'none';};

function watchBoard(){
  let deb=null;
  const check=()=>{
    if(!state.enabled)return;
    const fen=readFen();
    console.log('[SM] watchBoard check - FEN:', fen, 'lastFen:', state.lastFen, 'enabled:', state.enabled);
    if(fen&&fen!==state.lastFen&&vFen(fen)){
      console.log('[SM] FEN change detected, calling analyze');
      analyze(fen);
    }
  };
  const tgt=document.querySelector('cg-board,chess-board,.board,#board')||document.body;
  console.log('[SM] watchBoard target element:', tgt);
  new MutationObserver(()=>{console.log('[SM] Board mutation detected');clearTimeout(deb);deb=setTimeout(check,400);}).observe(tgt,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','data-fen']});
  setInterval(check,2000);setTimeout(check,1500);
}

function boot(){createPanel();watchBoard();}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',boot):setTimeout(boot,500);
})();
