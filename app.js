
const $ = id => document.getElementById(id);
const canvas = $("board");
const ctx = canvas.getContext("2d");
const halfImg = new Image();
const fullImg = new Image();
halfImg.src = "./assets/courts/half-court.png";
fullImg.src = "./assets/courts/full-court.png";

let mode = "half";
let tool = "select";
let objects = [];
let lines = [];
let selectedId = null;
let dragging = null;
let dragStart = null;
let defenseVisible = false;
let autoLineMoveKind = "moveLine";
let autoBallLineKind = "pass";
let isRecording = false;
let playLogs = [];
let initialSnapshot = null;
let savedPlayback = false;

const clone = x => JSON.parse(JSON.stringify(x));
const O = (id,x,y)=>({id,t:"o",x,y});
const X = (id,x,y)=>({id,t:"d",x,y});
const B = (x,y)=>({id:"BALL",t:"b",x,y});

const halfDefault = [O("1",375,520),O("2",80,90),O("3",650,385),O("4",265,310),O("5",520,95),B(410,480)];
const fullDefault = [O("1",260,595),O("2",330,185),O("3",1090,595),O("4",760,420),O("5",780,190),B(295,595)];

function courtSize(){ return mode==="half" ? {w:750,h:700} : {w:1400,h:750}; }
function setCanvasSize(){ const s=courtSize(); canvas.width=s.w; canvas.height=s.h; render(); }
function snap(v,s=4){ return Math.round(v/s)*s; }
function pnt(e){
  const r=canvas.getBoundingClientRect();
  return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};
}
function snapShot(){ return {objects:clone(objects), lines:clone(lines)}; }
function loadSnap(s){ objects=clone(s.objects||[]); lines=clone(s.lines||[]); render(); }

function init(){
  objects = clone(mode==="half" ? halfDefault : fullDefault);
  lines = [];
  selectedId = null;
  defenseVisible = false;
  syncDefenseBtn();
  initialSnapshot = snapShot();
  render();
}

function drawCourt(){
  const img = mode==="half" ? halfImg : fullImg;
  if(img.complete && img.naturalWidth) ctx.drawImage(img,0,0,canvas.width,canvas.height);
  else { ctx.fillStyle="#e2aa56"; ctx.fillRect(0,0,canvas.width,canvas.height); }
}
function head(x1,y1,x2,y2,col){
  const a=Math.atan2(y2-y1,x2-x1),s=18;
  ctx.fillStyle=col; ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-s*Math.cos(a-Math.PI/6),y2-s*Math.sin(a-Math.PI/6));
  ctx.lineTo(x2-s*Math.cos(a+Math.PI/6),y2-s*Math.sin(a+Math.PI/6));
  ctx.closePath(); ctx.fill();
}
function drawStraight(l,col,dash=true){
  ctx.strokeStyle=col; ctx.lineWidth=5; ctx.lineCap="round"; ctx.lineJoin="round";
  if(dash) ctx.setLineDash([13,10]);
  ctx.beginPath(); ctx.moveTo(l.x1,l.y1); ctx.lineTo(l.x2,l.y2); ctx.stroke();
  ctx.setLineDash([]); head(l.x1,l.y1,l.x2,l.y2,col);
}
function zig(l){
  const {x1,y1,x2,y2}=l,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,px=-uy,py=ux;
  const pts=[{x:x1,y:y1}],step=25,amp=11;
  for(let d=step;d<len-step;d+=step){
    const side=Math.floor(d/step)%2?1:-1;
    pts.push({x:x1+ux*d+px*amp*side,y:y1+uy*d+py*amp*side});
  }
  pts.push({x:x2,y:y2}); return pts;
}
function drawLine(l){
  ctx.save();
  ctx.globalAlpha = l.alpha ?? 1;
  if(l.k==="pass") drawStraight(l,"#e8232e",true);
  if(l.k==="shoot") drawStraight(l,"#2563eb",true);
  if(l.k==="moveLine") drawStraight(l,"#16a34a",true);
  if(l.k==="drive"){
    const pts=zig(l);
    ctx.strokeStyle="#1764ff"; ctx.lineWidth=6; ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.stroke();
    head(pts.at(-2).x,pts.at(-2).y,l.x2,l.y2,"#1764ff");
  }
  ctx.restore();
}
function drawObj(o){
  const r=o.t==="b"?20:25;
  ctx.save();
  ctx.shadowColor="rgba(0,0,0,.28)"; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.arc(o.x,o.y,r,0,Math.PI*2);
  ctx.fillStyle=o.t==="o"?"#e8232e":o.t==="d"?"#2468e8":"#f58220";
  ctx.strokeStyle=o.t==="b"?"#111":"#fff"; ctx.lineWidth=3; ctx.fill(); ctx.stroke();
  ctx.shadowBlur=0;
  if(o.id===selectedId){ ctx.strokeStyle="#f4b43a"; ctx.lineWidth=5; ctx.beginPath(); ctx.arc(o.x,o.y,r+8,0,Math.PI*2); ctx.stroke(); }
  ctx.fillStyle="#fff"; ctx.font="900 18px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(o.t==="b"?"🏀":o.id,o.x,o.y);
  ctx.restore();
}
function ensureLineMeta(){
  lines.forEach((l,i)=>{
    if(!l.__id) l.__id = "line_" + Date.now() + "_" + i + "_" + Math.random().toString(36).slice(2);
    if(!l.stepNo) l.stepNo = i + 1;
    if(!l.fixedStepNo) l.fixedStepNo = l.stepNo;
    l.stepNo = Number(l.fixedStepNo);
  });
}
function getLineNo(l,i=1){ return Number(l.fixedStepNo || l.stepNo || i); }
function setLineNo(l,no){ l.fixedStepNo=Number(no); l.stepNo=Number(no); }
function lineMid(l){ return {x:(l.x1+l.x2)/2, y:(l.y1+l.y2)/2}; }

let inlineTargetLine = null;
function hitWhiteCircle(p){
  ensureLineMeta();
  for(let i=lines.length-1;i>=0;i--){
    const m=lineMid(lines[i]);
    if(Math.hypot(p.x-m.x,p.y-m.y)<=34) return lines[i];
  }
  return null;
}
function render(){
  drawCourt();
  ensureLineMeta();
  lines.forEach((l,i)=>{
    l.alpha = i===lines.length-1 ? 1 : i===lines.length-2 ? .35 : .18;
    drawLine(l);
  });
  objects.forEach(drawObj);
  lines.forEach((l,i)=>{
    const m=lineMid(l);
    ctx.save();
    ctx.globalAlpha=1;
    ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(m.x,m.y,11,0,Math.PI*2); ctx.fill();
    if(inlineTargetLine && inlineTargetLine.__id===l.__id){
      ctx.strokeStyle="#f4b43a"; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(m.x,m.y,16,0,Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle="#111"; ctx.font="bold 11px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(String(getLineNo(l,i+1)),m.x,m.y);
    ctx.restore();
  });
}

function showNumberList(line, clientX, clientY){
  inlineTargetLine = line;
  const box = $("numberList");
  const maxNo = Math.max(10, ...lines.map((l,i)=>getLineNo(l,i+1)));
  box.innerHTML = "";
  for(let i=1;i<=maxNo;i++){
    const b=document.createElement("button");
    b.type="button"; b.textContent=String(i);
    if(getLineNo(line)===i) b.classList.add("active");
    b.onclick = e=>{
      e.preventDefault(); e.stopPropagation();
      setLineNo(line,i);
      inlineTargetLine=null;
      box.classList.add("hidden");
      render();
    };
    box.appendChild(b);
  }
  const plus=document.createElement("button");
  plus.type="button"; plus.textContent=`＋${maxNo+1}`;
  plus.onclick=e=>{
    e.preventDefault(); e.stopPropagation();
    setLineNo(line,maxNo+1);
    inlineTargetLine=null;
    box.classList.add("hidden");
    render();
  };
  box.appendChild(plus);

  const area=$("courtArea").getBoundingClientRect();
  box.style.left=Math.max(8,Math.min(area.width-96,clientX-area.left+10))+"px";
  box.style.top=Math.max(8,Math.min(area.height-270,clientY-area.top+10))+"px";
  box.classList.remove("hidden");
  render();
}
function hideNumberList(){
  $("numberList").classList.add("hidden");
  inlineTargetLine=null;
  render();
}

function hitObj(p){ return [...objects].reverse().find(o=>Math.hypot(o.x-p.x,o.y-p.y)<32); }
function showChoice(id,clientX,clientY){
  const box=$(id),area=$("courtArea").getBoundingClientRect();
  box.style.left=Math.max(8,clientX-area.left+12)+"px";
  box.style.top=Math.max(8,clientY-area.top-6)+"px";
  box.classList.remove("hidden");
}
function hideChoices(){ $("moveChoice").classList.add("hidden"); $("ballChoice").classList.add("hidden"); }

function pointerDown(e){
  if(savedPlayback) return;
  const p=pnt(e);
  const line=hitWhiteCircle(p);
  if(line){
    e.preventDefault(); e.stopPropagation();
    showNumberList(line,e.clientX,e.clientY);
    return;
  }
  hideNumberList();
  if(tool==="erase"){
    lines=lines.filter(l=>Math.hypot(p.x-lineMid(l).x,p.y-lineMid(l).y)>24);
    render(); return;
  }
  const o=hitObj(p);
  if(o){
    selectedId=o.id;
    dragging={o,dx:p.x-o.x,dy:p.y-o.y};
    dragStart={id:o.id,t:o.t,x:o.x,y:o.y};
    if(o.t==="o") showChoice("moveChoice",e.clientX,e.clientY);
    if(o.t==="b") showChoice("ballChoice",e.clientX,e.clientY);
    render();
  } else {
    selectedId=null; hideChoices(); render();
  }
}
function pointerMove(e){
  if(savedPlayback || !dragging) return;
  e.preventDefault();
  const p=pnt(e);
  dragging.o.x=snap(p.x-dragging.dx);
  dragging.o.y=snap(p.y-dragging.dy);
  if(defenseVisible && dragging.o.t!=="d") applyDefense();
  render();
}
function pointerUp(e){
  if(savedPlayback || !dragging) return;
  const moved=dragging.o;
  const start=dragStart;
  dragging=null; dragStart=null;
  if(start && moved && Math.hypot(moved.x-start.x,moved.y-start.y)>8){
    addAutoLine(start,moved);
    addLog(`${label(moved)}を移動`);
  }
  render();
}
function addAutoLine(start,endObj){
  let kind = "moveLine";
  if(start.t==="b") kind = autoBallLineKind==="shoot" ? "shoot" : "pass";
  if(start.t==="o") kind = autoLineMoveKind==="drive" ? "drive" : "moveLine";
  const maxNo = lines.reduce((m,l,i)=>Math.max(m,getLineNo(l,i+1)),0);
  const l={x1:start.x,y1:start.y,x2:endObj.x,y2:endObj.y,k:kind,__id:"line_"+Date.now()+"_"+Math.random().toString(36).slice(2),stepNo:maxNo+1,fixedStepNo:maxNo+1,moveRef:{id:endObj.id,t:endObj.t,x:endObj.x,y:endObj.y}};
  lines.push(l);
}

function label(o){ if(o.t==="b") return "ボール"; if(o.t==="o") return `選手${o.id}`; return `DF${o.id}`; }
function addLog(text){ if(!isRecording) return; playLogs.push(text); renderLogs(); }
function renderLogs(){
  const box=$("playLogList"); box.innerHTML="";
  if(!playLogs.length){ box.innerHTML='<div class="play-log-item">スタート後の動きがここに記録されます。</div>'; return; }
  playLogs.forEach((log,i)=>{ const d=document.createElement("div"); d.className="play-log-item"; d.textContent=`${i+1}. ${log}`; box.appendChild(d); });
  box.scrollTop=box.scrollHeight;
}

function startPlay(){
  isRecording=true;
  initialSnapshot=snapShot();
  playLogs=["初期ポジション決定"];
  $("startPlayBtn").classList.add("recording");
  $("startPlayBtn").textContent="記録中";
  renderLogs();
}
function buildFrames(){
  ensureLineMeta();
  const grouped={};
  lines.forEach((l,i)=>{
    const no=getLineNo(l,i+1);
    if(!grouped[no]) grouped[no]={no,moves:[],lines:[]};
    grouped[no].lines.push({...l,stepNo:no,fixedStepNo:no});
    if(l.moveRef) grouped[no].moves.push({...l.moveRef});
  });
  const sorted=Object.values(grouped).sort((a,b)=>a.no-b.no);
  let base=clone(initialSnapshot || snapShot());
  const built=[clone(base)];
  sorted.forEach(step=>{
    const next=clone(base);
    step.moves.forEach(m=>{
      const obj=next.objects.find(o=>o.id===m.id && o.t===m.t);
      if(obj){ obj.x=m.x; obj.y=m.y; }
    });
    next.lines=[...(next.lines||[]),...step.lines];
    built.push(clone(next));
    base=next;
  });
  return built;
}
const SAVED_KEY="tacticsBoardCleanSavedPlaysV10";
function getSaved(){ try{return JSON.parse(localStorage.getItem(SAVED_KEY)||"[]")}catch{return[]} }
function setSaved(list){ localStorage.setItem(SAVED_KEY,JSON.stringify(list)); }
function nextTitle(){ return "Play "+String(getSaved().length+1).padStart(3,"0"); }
function finishPlay(){
  if(!isRecording){ alert("先にスタートを押してください"); return; }
  const data={id:"play_"+Date.now(),title:nextTitle(),mode,frames:buildFrames(),logs:clone(playLogs),createdAt:new Date().toISOString()};
  const list=getSaved(); list.unshift(data); setSaved(list);
  isRecording=false; playLogs=[]; $("startPlayBtn").classList.remove("recording"); $("startPlayBtn").textContent="スタート";
  renderLogs(); renderSavedPlays(); alert(`「${data.title}」として保存しました`);
}
function renderSavedPlays(){
  const box=$("savedPlayList"); box.innerHTML="";
  const list=getSaved();
  if(!list.length){ box.innerHTML='<div class="saved-play-empty">保存プレーはありません</div>'; return; }
  list.forEach((p,idx)=>{
    const wrap=document.createElement("div"); wrap.className="saved-play-wrap";
    const btn=document.createElement("button"); btn.className="saved-play-btn"; btn.textContent=p.title; btn.onclick=()=>playSaved(p);
    const del=document.createElement("button"); del.className="delete-play-btn"; del.textContent="×"; del.onclick=()=>{ const n=getSaved(); n.splice(idx,1); setSaved(n); renderSavedPlays(); };
    wrap.appendChild(btn); wrap.appendChild(del); box.appendChild(wrap);
  });
}
function ease(t){ return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2; }
function interpObjects(from,to,t){
  const e=ease(t);
  return from.map(o=>{
    const target=(to||[]).find(x=>x.id===o.id && x.t===o.t) || o;
    return {...o,x:o.x+(target.x-o.x)*e,y:o.y+(target.y-o.y)*e};
  });
}
function playSaved(p){
  mode=p.mode||"half"; syncMode(); setCanvasSize();
  const frames=clone(p.frames||[]);
  if(frames.length<2){ alert("動きがありません"); return; }
  savedPlayback=true;
  let idx=0,start=performance.now(),duration=850;
  loadSnap(frames[0]);
  function step(now){
    const from=frames[idx],to=frames[idx+1];
    const t=Math.min(1,(now-start)/duration);
    objects=interpObjects(from.objects||[],to.objects||[],t);
    lines=to.lines||[];
    render();
    if(t>=1){
      idx++;
      if(idx>=frames.length-1){ savedPlayback=false; loadSnap(frames[frames.length-1]); return; }
      start=now;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setMode(m){ mode=m; objects=clone(m==="half"?halfDefault:fullDefault); lines=[]; selectedId=null; initialSnapshot=snapShot(); syncMode(); setCanvasSize(); }
function syncMode(){ $("halfBtn").classList.toggle("active",mode==="half"); $("fullBtn").classList.toggle("active",mode==="full"); }

function offense(){ return objects.filter(o=>o.t==="o"); }
function removeDefense(){ objects=objects.filter(o=>o.t!=="d"); }
function applyDefense(){
  removeDefense();
  const ball=objects.find(o=>o.t==="b");
  offense().forEach(o=>{
    const ratio = ball && Math.hypot(o.x-ball.x,o.y-ball.y)<300 ? .16 : .32;
    const hoop = mode==="half" ? {x:375,y:78} : (o.x<700?{x:78,y:375}:{x:1322,y:375});
    objects.push(X("X"+o.id,o.x+(hoop.x-o.x)*ratio,o.y+(hoop.y-o.y)*ratio));
  });
}
function syncDefenseBtn(){
  const oldBtn = $("defenseBtn");
  if(oldBtn){
    oldBtn.classList.toggle("active",defenseVisible);
    oldBtn.textContent=defenseVisible?"ディフェンス非表示":"ディフェンス表示";
  }
  const floatBtn = $("defenseFloatBtn");
  if(floatBtn){
    floatBtn.classList.toggle("defense-on", defenseVisible);
    floatBtn.textContent = defenseVisible ? "D✓" : "D";
    floatBtn.title = defenseVisible ? "ディフェンス非表示" : "ディフェンス表示";
  }
}

const POS_KEY="tacticsBoardCleanPositionsV10";
function getPositions(){ try{return JSON.parse(localStorage.getItem(POS_KEY)||"[]")}catch{return[]} }
function setPositions(x){ localStorage.setItem(POS_KEY,JSON.stringify(x)); }
function savePosition(){
  const title=$("positionName").value.trim();
  if(!title){ alert("名前を入力してください"); return; }
  const list=getPositions(); list.unshift({id:"pos_"+Date.now(),title,mode,objects:clone(objects),lines:clone(lines)});
  setPositions(list); $("positionName").value=""; renderPositions();
}
function loadPosition(p){ mode=p.mode||"half"; objects=clone(p.objects||[]); lines=clone(p.lines||[]); selectedId=null; initialSnapshot=snapShot(); syncMode(); setCanvasSize(); }
function renderPositions(){
  const list=getPositions(),half=$("halfPositionList"),full=$("fullPositionList");
  const draw=(box,items)=>{ box.innerHTML=""; if(!items.length){ box.innerHTML='<div class="category-empty">保存なし</div>'; return; }
    items.forEach((p,idx)=>{ const item=document.createElement("div"); item.className="custom-play-item";
      const b=document.createElement("button"); b.className="load"; b.textContent=p.title; b.onclick=()=>loadPosition(p);
      const d=document.createElement("button"); d.className="delete"; d.textContent="×"; d.onclick=()=>{ const n=getPositions().filter(x=>x.id!==p.id); setPositions(n); renderPositions(); };
      item.appendChild(b); item.appendChild(d); box.appendChild(item);
    });
  };
  draw(half,list.filter(x=>(x.mode||"half")==="half")); draw(full,list.filter(x=>x.mode==="full"));
}

function wire(){
  canvas.addEventListener("pointerdown",pointerDown);
  canvas.addEventListener("pointermove",pointerMove);
  canvas.addEventListener("pointerup",pointerUp);
  canvas.addEventListener("pointerleave",pointerUp);
  document.querySelectorAll(".tool").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tool").forEach(x=>x.classList.remove("active")); b.classList.add("active"); tool=b.dataset.tool;});
  $("chooseMoveBtn").onclick=()=>{autoLineMoveKind="moveLine"; hideChoices();};
  $("chooseDriveBtn").onclick=()=>{autoLineMoveKind="drive"; hideChoices();};
  $("choosePassBtn").onclick=()=>{autoBallLineKind="pass"; hideChoices();};
  $("chooseShootBtn").onclick=()=>{autoBallLineKind="shoot"; hideChoices();};
  $("halfBtn").onclick=()=>setMode("half");
  $("fullBtn").onclick=()=>setMode("full");
  const oldDefenseBtn = $("defenseBtn");
  if(oldDefenseBtn){
    oldDefenseBtn.onclick=()=>{ defenseVisible=!defenseVisible; defenseVisible?applyDefense():removeDefense(); syncDefenseBtn(); render(); };
  }
  $("startPlayBtn").onclick=startPlay;
  $("finishPlayBtn").onclick=finishPlay;
  $("savePositionBtn").onclick=savePosition;
  document.addEventListener("pointerdown",e=>{ if(!$("numberList").contains(e.target) && e.target!==canvas) $("numberList").classList.add("hidden"); },true);
}
halfImg.onload=()=>render(); fullImg.onload=()=>render();
wire(); init(); renderLogs(); renderSavedPlays(); renderPositions();


/* v10.1 左ツール削除・初期ポジション2列・リセット追加 */
function resetCurrentPositionV101(){
  if(!confirm("現在のポジションを初期状態にリセットしますか？")) return;
  defenseVisible = false;
  syncDefenseBtn();
  objects = clone(mode === "half" ? halfDefault : fullDefault);
  lines = [];
  selectedId = null;
  initialSnapshot = snapShot();
  hideNumberList?.();
  hideChoices?.();
  render();
}

(function wireResetPositionV101(){
  const left = document.getElementById("resetPositionBtn");
  if(left) left.onclick = resetCurrentPositionV101;

  const right = document.getElementById("resetPositionBtnRight");
  if(right) right.onclick = resetCurrentPositionV101;
})();

// ツールは選択のみ固定。消すボタンを消したので操作が複雑にならないようにする
tool = "select";


/* v10.2 選択メニュー3秒で自動非表示・重なり対策 */
let choiceHideTimerV102 = null;

function scheduleChoiceHideV102(){
  clearTimeout(choiceHideTimerV102);
  choiceHideTimerV102 = setTimeout(()=>hideChoices(), 3000);
}

// 既存showChoiceを上書き：少し小さく、画面外に出にくく、3秒で消える
function showChoice(id,clientX,clientY){
  const box=$(id);
  if(!box) return;

  const area=$("courtArea").getBoundingClientRect();
  const w = 150;
  const h = 92;

  box.style.left = Math.max(8, Math.min(area.width - w, clientX - area.left + 10)) + "px";
  box.style.top = Math.max(8, Math.min(area.height - h, clientY - area.top - 4)) + "px";
  box.classList.remove("hidden");
  scheduleChoiceHideV102();
}

function hideChoices(){
  clearTimeout(choiceHideTimerV102);
  const move=$("moveChoice");
  const ball=$("ballChoice");
  if(move) move.classList.add("hidden");
  if(ball) ball.classList.add("hidden");
}

// メニュー上にマウス/指がある時は勝手に消えにくくする
setTimeout(()=>{
  ["moveChoice","ballChoice"].forEach(id=>{
    const el=$(id);
    if(!el) return;
    el.addEventListener("pointerdown",()=>clearTimeout(choiceHideTimerV102),true);
    el.addEventListener("pointerenter",()=>clearTimeout(choiceHideTimerV102));
    el.addEventListener("pointerleave",()=>scheduleChoiceHideV102());
  });
},300);

// 重なり対策1：ヒット判定を「近い順」かつ、OF/ボールをDFより優先
function hitObj(p){
  const candidates = objects
    .map(o=>({...o,_dist:Math.hypot(o.x-p.x,o.y-p.y)}))
    .filter(o=>o._dist < 34)
    .sort((a,b)=>{
      const pa = a.t==="b" ? 0 : a.t==="o" ? 1 : 2;
      const pb = b.t==="b" ? 0 : b.t==="o" ? 1 : 2;
      if(pa !== pb) return pa - pb;
      return a._dist - b._dist;
    });

  if(!candidates.length) return null;

  const c = candidates[0];
  return objects.find(o=>o.id===c.id && o.t===c.t);
}

// 重なり対策2：ディフェンスを少し小さく描く
function drawObj(o){
  const r=o.t==="b"?20:(o.t==="d"?21:25);
  ctx.save();
  ctx.shadowColor="rgba(0,0,0,.28)";
  ctx.shadowBlur=6;
  ctx.beginPath();
  ctx.arc(o.x,o.y,r,0,Math.PI*2);
  ctx.fillStyle=o.t==="o"?"#e8232e":o.t==="d"?"#2468e8":"#f58220";
  ctx.strokeStyle=o.t==="b"?"#111":"#fff";
  ctx.lineWidth=3;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur=0;

  if(o.id===selectedId){
    ctx.strokeStyle="#f4b43a";
    ctx.lineWidth=5;
    ctx.beginPath();
    ctx.arc(o.x,o.y,r+8,0,Math.PI*2);
    ctx.stroke();
  }

  ctx.fillStyle="#fff";
  ctx.font=o.t==="d" ? "900 15px system-ui" : "900 18px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  ctx.fillText(o.t==="b"?"🏀":o.id,o.x,o.y);
  ctx.restore();
}

// 重なり対策3：DFはOFと完全に重ならないよう少し横に逃がす
function applyDefense(){
  removeDefense();
  const ball=objects.find(o=>o.t==="b");

  offense().forEach(o=>{
    const ratio = ball && Math.hypot(o.x-ball.x,o.y-ball.y)<300 ? .20 : .36;
    const hoop = mode==="half" ? {x:375,y:78} : (o.x<700?{x:78,y:375}:{x:1322,y:375});

    let dx = hoop.x - o.x;
    let dy = hoop.y - o.y;
    const len = Math.hypot(dx,dy) || 1;
    dx /= len;
    dy /= len;

    // リング方向に寄りつつ、少し横へオフセットしてOFを掴みやすくする
    const side = Number(o.id || 1) % 2 === 0 ? 1 : -1;
    const px = -dy * 18 * side;
    const py = dx * 18 * side;

    objects.push(X("X"+o.id, o.x+(hoop.x-o.x)*ratio + px, o.y+(hoop.y-o.y)*ratio + py));
  });
}


/* v10.3 初期ポジション設定中は線を出さない
   - スタート前に選手/ボールを動かしても線を作らない
   - スタート後だけ線を作る
   - 初期ポジション保存時は線を保存しない
*/
const originalAddAutoLineV103 = addAutoLine;
addAutoLine = function(start,endObj){
  // プレー作成の「スタート」前は、初期ポジション調整として扱う
  if(!isRecording){
    initialSnapshot = snapShot();
    return;
  }
  originalAddAutoLineV103(start,endObj);
};

function savePositionNoLinesV103(){
  const title = $("positionName").value.trim();
  if(!title){
    alert("名前を入力してください");
    return;
  }

  const list = getPositions();
  list.unshift({
    id:"pos_" + Date.now(),
    title,
    mode,
    objects:clone(objects),
    lines:[], // 初期ポジションには線を保存しない
  });

  setPositions(list);
  $("positionName").value = "";
  renderPositions();
}

setTimeout(()=>{
  const saveBtn = $("savePositionBtn");
  if(saveBtn) saveBtn.onclick = savePositionNoLinesV103;
}, 100);

// 既に線が出て見にくい場合用：リセットは線も消す
const originalResetCurrentPositionV103 = typeof resetCurrentPositionV101 === "function" ? resetCurrentPositionV101 : null;
function clearLinesForPositionV103(){
  if(isRecording) return;
  lines = [];
  initialSnapshot = snapShot();
  render();
}


/* v10.4 移動/ドライブ・パス/シュートの選択を改善
   - 選手を掴んだ瞬間には表示しない
   - ドロップ後だけ表示
   - 2.5秒で自動で消える
   - ボタンにカーソルを合わせるだけで選択
   - 他機能は維持
*/
let lastDroppedStartV104 = null;
let lastDroppedObjV104 = null;
let choiceHideTimerV104 = null;

function scheduleChoiceHideV104(){
  clearTimeout(choiceHideTimerV104);
  choiceHideTimerV104 = setTimeout(()=>hideChoices(), 2500);
}

function showChoice(id,clientX,clientY){
  const box=$(id);
  if(!box) return;

  const area=$("courtArea").getBoundingClientRect();
  const w = 138;
  const h = 52;

  box.style.left = Math.max(8, Math.min(area.width - w, clientX - area.left + 10)) + "px";
  box.style.top = Math.max(8, Math.min(area.height - h, clientY - area.top + 10)) + "px";
  box.classList.remove("hidden");
  scheduleChoiceHideV104();
}

function hideChoices(){
  clearTimeout(choiceHideTimerV104);
  const move=$("moveChoice");
  const ball=$("ballChoice");
  if(move) move.classList.add("hidden");
  if(ball) ball.classList.add("hidden");
}

function changeLastAutoLineKindV104(kind){
  if(!lastDroppedStartV104 || !lastDroppedObjV104) return;

  const last = lines[lines.length - 1];
  if(last && last.moveRef && last.moveRef.id === lastDroppedObjV104.id && last.moveRef.t === lastDroppedObjV104.t){
    last.k = kind;
  }

  if(lastDroppedStartV104.t === "o"){
    autoLineMoveKind = kind === "drive" ? "drive" : "moveLine";
  }

  if(lastDroppedStartV104.t === "b"){
    autoBallLineKind = kind === "shoot" ? "shoot" : "pass";
  }

  hideChoices();
  render();
}

function pointerDown(e){
  if(savedPlayback) return;
  const p=pnt(e);
  const line=hitWhiteCircle(p);
  if(line){
    e.preventDefault(); e.stopPropagation();
    showNumberList(line,e.clientX,e.clientY);
    return;
  }

  hideNumberList();
  hideChoices();

  if(tool==="erase"){
    lines=lines.filter(l=>Math.hypot(p.x-lineMid(l).x,p.y-lineMid(l).y)>24);
    render(); return;
  }

  const o=hitObj(p);
  if(o){
    selectedId=o.id;
    dragging={o,dx:p.x-o.x,dy:p.y-o.y};
    dragStart={id:o.id,t:o.t,x:o.x,y:o.y};
    render();
  } else {
    selectedId=null;
    render();
  }
}

function pointerUp(e){
  if(savedPlayback || !dragging) return;

  const moved=dragging.o;
  const start=dragStart;
  dragging=null;
  dragStart=null;

  if(start && moved && Math.hypot(moved.x-start.x,moved.y-start.y)>8){
    addAutoLine(start,moved);
    addLog(`${label(moved)}を移動`);

    lastDroppedStartV104 = start;
    lastDroppedObjV104 = moved;

    // ドロップ後だけ選択アイコンを出す
    if(start.t === "o"){
      showChoice("moveChoice", e.clientX, e.clientY);
    }else if(start.t === "b"){
      showChoice("ballChoice", e.clientX, e.clientY);
    }
  }

  render();
}

// hoverだけで選択。クリック不要
setTimeout(()=>{
  const moveBtn = $("chooseMoveBtn");
  const driveBtn = $("chooseDriveBtn");
  const passBtn = $("choosePassBtn");
  const shootBtn = $("chooseShootBtn");

  if(moveBtn){
    moveBtn.onpointerenter = ()=>changeLastAutoLineKindV104("moveLine");
    moveBtn.onclick = ()=>changeLastAutoLineKindV104("moveLine");
  }
  if(driveBtn){
    driveBtn.onpointerenter = ()=>changeLastAutoLineKindV104("drive");
    driveBtn.onclick = ()=>changeLastAutoLineKindV104("drive");
  }
  if(passBtn){
    passBtn.onpointerenter = ()=>changeLastAutoLineKindV104("pass");
    passBtn.onclick = ()=>changeLastAutoLineKindV104("pass");
  }
  if(shootBtn){
    shootBtn.onpointerenter = ()=>changeLastAutoLineKindV104("shoot");
    shootBtn.onclick = ()=>changeLastAutoLineKindV104("shoot");
  }

  ["moveChoice","ballChoice"].forEach(id=>{
    const el=$(id);
    if(!el) return;
    el.addEventListener("pointerenter",()=>clearTimeout(choiceHideTimerV104));
    el.addEventListener("pointerleave",()=>scheduleChoiceHideV104());
  });
}, 300);


/* v10.5 初期コートサイズ修正・ドロップ後メニュー選択安定 */

// 起動直後にコートが小さくなる問題を修正
function fixInitialCourtSizeV105(){
  setCanvasSize();
  render();
  setTimeout(()=>{ setCanvasSize(); render(); }, 80);
  setTimeout(()=>{ setCanvasSize(); render(); }, 300);
}

window.addEventListener("load", fixInitialCourtSizeV105);
window.addEventListener("resize", ()=>{
  setCanvasSize();
  render();
});

// 選択メニュー：選択するまでは3秒残す。選択したら即消える。
let choiceHideTimerV105 = null;
let choiceVisibleV105 = false;

function scheduleChoiceHideV105(){
  clearTimeout(choiceHideTimerV105);
  choiceHideTimerV105 = setTimeout(()=>{
    choiceVisibleV105 = false;
    hideChoices();
  }, 3000);
}

function showChoice(id,clientX,clientY){
  const box=$(id);
  if(!box) return;

  const area=$("courtArea").getBoundingClientRect();
  const w = 142;
  const h = 54;

  box.style.left = Math.max(8, Math.min(area.width - w, clientX - area.left + 10)) + "px";
  box.style.top = Math.max(8, Math.min(area.height - h, clientY - area.top + 10)) + "px";
  box.classList.remove("hidden");

  choiceVisibleV105 = true;
  scheduleChoiceHideV105();
}

function hideChoices(){
  clearTimeout(choiceHideTimerV105);
  choiceVisibleV105 = false;
  const move=$("moveChoice");
  const ball=$("ballChoice");
  if(move) move.classList.add("hidden");
  if(ball) ball.classList.add("hidden");
}

function chooseLastKindV105(kind){
  if(!lastDroppedStartV104 || !lastDroppedObjV104) return;

  const last = lines[lines.length - 1];
  if(last && last.moveRef && last.moveRef.id === lastDroppedObjV104.id && last.moveRef.t === lastDroppedObjV104.t){
    last.k = kind;
  }

  if(lastDroppedStartV104.t === "o"){
    autoLineMoveKind = kind === "drive" ? "drive" : "moveLine";
  }
  if(lastDroppedStartV104.t === "b"){
    autoBallLineKind = kind === "shoot" ? "shoot" : "pass";
  }

  hideChoices();
  render();
}

// メニュー内に入っても即mouseleaveで消えないよう、タイマーだけ管理
setTimeout(()=>{
  const setup = (id,kind)=>{
    const el=$(id);
    if(!el) return;
    el.onpointerenter = (e)=>{
      e.preventDefault();
      clearTimeout(choiceHideTimerV105);
      chooseLastKindV105(kind); // カーソルを合わせた瞬間に選択
    };
    el.onclick = (e)=>{
      e.preventDefault();
      chooseLastKindV105(kind);
    };
  };

  setup("chooseMoveBtn","moveLine");
  setup("chooseDriveBtn","drive");
  setup("choosePassBtn","pass");
  setup("chooseShootBtn","shoot");

  ["moveChoice","ballChoice"].forEach(id=>{
    const box=$(id);
    if(!box) return;
    box.onpointerenter = ()=>clearTimeout(choiceHideTimerV105);
    box.onpointerleave = ()=>scheduleChoiceHideV105();
  });
}, 500);

// ドロップ後だけメニューを出す処理を再固定
function pointerDown(e){
  if(savedPlayback) return;
  const p=pnt(e);
  const line=hitWhiteCircle(p);
  if(line){
    e.preventDefault(); e.stopPropagation();
    showNumberList(line,e.clientX,e.clientY);
    return;
  }

  hideNumberList();
  hideChoices();

  if(tool==="erase"){
    lines=lines.filter(l=>Math.hypot(p.x-lineMid(l).x,p.y-lineMid(l).y)>24);
    render(); return;
  }

  const o=hitObj(p);
  if(o){
    selectedId=o.id;
    dragging={o,dx:p.x-o.x,dy:p.y-o.y};
    dragStart={id:o.id,t:o.t,x:o.x,y:o.y};
    render();
  } else {
    selectedId=null;
    render();
  }
}

function pointerUp(e){
  if(savedPlayback || !dragging) return;

  const moved=dragging.o;
  const start=dragStart;
  dragging=null;
  dragStart=null;

  if(start && moved && Math.hypot(moved.x-start.x,moved.y-start.y)>8){
    addAutoLine(start,moved);
    addLog(`${label(moved)}を移動`);

    lastDroppedStartV104 = start;
    lastDroppedObjV104 = moved;

    if(start.t === "o"){
      showChoice("moveChoice", e.clientX, e.clientY);
    }else if(start.t === "b"){
      showChoice("ballChoice", e.clientX, e.clientY);
    }
  }

  render();
}

// 既存イベントが古い関数を持っていた場合に備えて再配線
setTimeout(()=>{
  canvas.removeEventListener("pointerdown", pointerDown);
  canvas.removeEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointerup", pointerUp);
  fixInitialCourtSizeV105();
}, 600);


/* v10.6 操作バーを下中央固定・選択後も3秒残す */
let bottomChoiceTimerV106 = null;
let lastChoiceKindV106 = null;

function clearChoiceSelectionV106(){
  ["chooseMoveBtn","chooseDriveBtn","choosePassBtn","chooseShootBtn"].forEach(id=>{
    const b=$(id);
    if(b){
      b.classList.remove("selected-choice");
      b.textContent = b.dataset.baseText || b.textContent.replace(" ✓","");
    }
  });
}

function markChoiceV106(id){
  clearChoiceSelectionV106();
  const b=$(id);
  if(!b) return;
  b.dataset.baseText = b.dataset.baseText || b.textContent.replace(" ✓","");
  b.textContent = b.dataset.baseText + " ✓";
  b.classList.add("selected-choice");
}

function scheduleBottomChoiceHideV106(){
  clearTimeout(bottomChoiceTimerV106);
  bottomChoiceTimerV106 = setTimeout(()=>{
    hideChoices();
  },3000);
}

function showChoice(id,clientX,clientY){
  const box=$(id);
  if(!box) return;

  clearChoiceSelectionV106();

  // 下中央固定なので座標は使わない
  box.classList.remove("hidden");
  scheduleBottomChoiceHideV106();
}

function hideChoices(){
  clearTimeout(bottomChoiceTimerV106);
  const move=$("moveChoice");
  const ball=$("ballChoice");
  if(move) move.classList.add("hidden");
  if(ball) ball.classList.add("hidden");
  clearChoiceSelectionV106();
}

function chooseLastKindV106(kind, buttonId){
  if(!lastDroppedStartV104 || !lastDroppedObjV104) return;

  const last = lines[lines.length - 1];
  if(last && last.moveRef && last.moveRef.id === lastDroppedObjV104.id && last.moveRef.t === lastDroppedObjV104.t){
    last.k = kind;
  }

  if(lastDroppedStartV104.t === "o"){
    autoLineMoveKind = kind === "drive" ? "drive" : "moveLine";
  }
  if(lastDroppedStartV104.t === "b"){
    autoBallLineKind = kind === "shoot" ? "shoot" : "pass";
  }

  markChoiceV106(buttonId);
  render();

  // 選択後も3秒残す
  scheduleBottomChoiceHideV106();
}

setTimeout(()=>{
  const setup = (id,kind)=>{
    const el=$(id);
    if(!el) return;

    el.dataset.baseText = el.textContent.replace(" ✓","");

    el.onpointerenter = (e)=>{
      e.preventDefault();
      chooseLastKindV106(kind,id);
    };

    el.onclick = (e)=>{
      e.preventDefault();
      chooseLastKindV106(kind,id);
    };
  };

  setup("chooseMoveBtn","moveLine");
  setup("chooseDriveBtn","drive");
  setup("choosePassBtn","pass");
  setup("chooseShootBtn","shoot");

  ["moveChoice","ballChoice"].forEach(id=>{
    const box=$(id);
    if(!box) return;
    box.onpointerenter = ()=>clearTimeout(bottomChoiceTimerV106);
    box.onpointerleave = ()=>scheduleBottomChoiceHideV106();
  });
},700);

// ドロップ後だけ下中央に出す処理を再固定
function pointerUp(e){
  if(savedPlayback || !dragging) return;

  const moved=dragging.o;
  const start=dragStart;
  dragging=null;
  dragStart=null;

  if(start && moved && Math.hypot(moved.x-start.x,moved.y-start.y)>8){
    addAutoLine(start,moved);
    addLog(`${label(moved)}を移動`);

    lastDroppedStartV104 = start;
    lastDroppedObjV104 = moved;

    if(start.t === "o"){
      showChoice("moveChoice", e.clientX, e.clientY);
    }else if(start.t === "b"){
      showChoice("ballChoice", e.clientX, e.clientY);
    }
  }

  render();
}


/* v10.7 アイコンがすぐ消える問題を修正・選手の近くに表示 */
let choiceStableTimerV107 = null;
let lastChoiceShowAtV107 = 0;

function scheduleBottomChoiceHideV106(){
  clearTimeout(choiceStableTimerV107);
  choiceStableTimerV107 = setTimeout(()=>{
    hideChoices();
  }, 3000);
}

function showChoice(id,clientX,clientY){
  const box=$(id);
  if(!box) return;

  const area=$("courtArea").getBoundingClientRect();

  // 選手マークのすぐ横ではなく、少し斜め下に離して表示
  const w = 170;
  const h = 58;
  let x = clientX - area.left + 42;
  let y = clientY - area.top + 34;

  // 右に出しにくい時は左側へ
  if(x + w > area.width - 8){
    x = clientX - area.left - w - 42;
  }

  // 下に出しにくい時は上側へ
  if(y + h > area.height - 8){
    y = clientY - area.top - h - 42;
  }

  box.style.left = Math.max(8, Math.min(area.width - w, x)) + "px";
  box.style.top = Math.max(8, Math.min(area.height - h, y)) + "px";
  box.classList.remove("hidden");
  box.classList.add("hold");

  lastChoiceShowAtV107 = Date.now();
  scheduleBottomChoiceHideV106();
}

function hideChoices(){
  clearTimeout(choiceStableTimerV107);
  const move=$("moveChoice");
  const ball=$("ballChoice");

  if(move){
    move.classList.add("hidden");
    move.classList.remove("hold");
  }
  if(ball){
    ball.classList.add("hidden");
    ball.classList.remove("hold");
  }

  if(typeof clearChoiceSelectionV106 === "function"){
    clearChoiceSelectionV106();
  }
}

function chooseLastKindV106(kind, buttonId){
  if(!lastDroppedStartV104 || !lastDroppedObjV104) return;

  const last = lines[lines.length - 1];
  if(last && last.moveRef && last.moveRef.id === lastDroppedObjV104.id && last.moveRef.t === lastDroppedObjV104.t){
    last.k = kind;
  }

  if(lastDroppedStartV104.t === "o"){
    autoLineMoveKind = kind === "drive" ? "drive" : "moveLine";
  }
  if(lastDroppedStartV104.t === "b"){
    autoBallLineKind = kind === "shoot" ? "shoot" : "pass";
  }

  if(typeof markChoiceV106 === "function"){
    markChoiceV106(buttonId);
  }

  render();

  // 選択後も3秒残す
  scheduleBottomChoiceHideV106();
}

// 「出た瞬間にpointerleave扱い」で消えるのを防ぐため、mouseleave直後は消さない
setTimeout(()=>{
  ["moveChoice","ballChoice"].forEach(id=>{
    const box=$(id);
    if(!box) return;

    box.onpointerenter = ()=>clearTimeout(choiceStableTimerV107);
    box.onpointerleave = ()=>{
      const justShown = Date.now() - lastChoiceShowAtV107 < 700;
      if(justShown){
        scheduleBottomChoiceHideV106();
      }else{
        scheduleBottomChoiceHideV106();
      }
    };
  });

  const setup = (id,kind)=>{
    const el=$(id);
    if(!el) return;
    el.dataset.baseText = el.dataset.baseText || el.textContent.replace(" ✓","");

    el.onpointerenter = (e)=>{
      e.preventDefault();
      clearTimeout(choiceStableTimerV107);
      chooseLastKindV106(kind,id);
    };

    el.onclick = (e)=>{
      e.preventDefault();
      clearTimeout(choiceStableTimerV107);
      chooseLastKindV106(kind,id);
    };
  };

  setup("chooseMoveBtn","moveLine");
  setup("chooseDriveBtn","drive");
  setup("choosePassBtn","pass");
  setup("chooseShootBtn","shoot");
}, 800);

// ドロップ後に近くへ表示する処理を再固定
function pointerUp(e){
  if(savedPlayback || !dragging) return;

  const moved=dragging.o;
  const start=dragStart;
  dragging=null;
  dragStart=null;

  if(start && moved && Math.hypot(moved.x-start.x,moved.y-start.y)>8){
    addAutoLine(start,moved);
    addLog(`${label(moved)}を移動`);

    lastDroppedStartV104 = start;
    lastDroppedObjV104 = moved;

    if(start.t === "o"){
      showChoice("moveChoice", e.clientX, e.clientY);
    }else if(start.t === "b"){
      showChoice("ballChoice", e.clientX, e.clientY);
    }
  }

  render();
}


/* v10.8 fixed from uploaded: 機能を壊さず、リセット/Dをコート内に移動 */
function toggleDefenseV108Fixed(){
  defenseVisible = !defenseVisible;
  defenseVisible ? applyDefense() : removeDefense();
  syncDefenseBtn();
  render();
}

function resetPositionV108Fixed(){
  if(!confirm("現在のポジションをリセットしますか？")) return;
  defenseVisible = false;
  objects = clone(mode === "half" ? halfDefault : fullDefault);
  lines = [];
  selectedId = null;
  initialSnapshot = snapShot();
  hideNumberList?.();
  hideChoices?.();
  syncDefenseBtn();
  render();
}

setTimeout(()=>{
  const d = $("defenseFloatBtn");
  if(d) d.onclick = toggleDefenseV108Fixed;

  const r = $("resetFloatBtn");
  if(r) r.onclick = resetPositionV108Fixed;

  const rr = $("resetPositionBtnRight");
  if(rr) rr.onclick = resetPositionV108Fixed;

  syncDefenseBtn();
}, 300);


/* v10.8.1 削除ボタン復活・D/リセット位置固定 */
setTimeout(()=>{
  const d = $("defenseFloatBtn");
  if(d){
    d.style.left = "auto";
    d.style.bottom = "auto";
    d.style.top = "16px";
    d.style.right = "16px";
  }

  const r = $("resetFloatBtn");
  if(r){
    r.style.left = "auto";
    r.style.top = "auto";
    r.style.right = "16px";
    r.style.bottom = "16px";
  }

  renderPositions();
}, 500);


/* v10.8.3 白丸番号の削除＋重なり対策
   - 白丸番号リストに「×削除」を追加
   - 削除すると白丸と線を一緒に削除
   - 白丸が選手に重なっている時は、選手マークを優先して動かせる
*/
let numberListTargetLineV1083 = null;

function deleteLineV1083(line){
  if(!line) return;
  lines = lines.filter(l => l.__id !== line.__id);
  numberListTargetLineV1083 = null;
  inlineTargetLine = null;
  const box = $("numberList");
  if(box) box.classList.add("hidden");
  render();
}

function showNumberList(line, clientX, clientY){
  inlineTargetLine = line;
  numberListTargetLineV1083 = line;

  const box = $("numberList");
  const maxNo = Math.max(10, ...lines.map((l,i)=>getLineNo(l,i+1)));
  box.innerHTML = "";

  for(let i=1;i<=maxNo;i++){
    const b=document.createElement("button");
    b.type="button";
    b.textContent=String(i);
    if(getLineNo(line)===i) b.classList.add("active");
    b.onclick = e=>{
      e.preventDefault();
      e.stopPropagation();
      setLineNo(line,i);
      inlineTargetLine=null;
      numberListTargetLineV1083=null;
      box.classList.add("hidden");
      render();
    };
    box.appendChild(b);
  }

  const plus=document.createElement("button");
  plus.type="button";
  plus.textContent=`＋${maxNo+1}`;
  plus.onclick=e=>{
    e.preventDefault();
    e.stopPropagation();
    setLineNo(line,maxNo+1);
    inlineTargetLine=null;
    numberListTargetLineV1083=null;
    box.classList.add("hidden");
    render();
  };
  box.appendChild(plus);

  const del=document.createElement("button");
  del.type="button";
  del.textContent="× 削除";
  del.className="delete-line-btn";
  del.onclick=e=>{
    e.preventDefault();
    e.stopPropagation();
    deleteLineV1083(line);
  };
  box.appendChild(del);

  const area=$("courtArea").getBoundingClientRect();
  box.style.left=Math.max(8,Math.min(area.width-96,clientX-area.left+10))+"px";
  box.style.top=Math.max(8,Math.min(area.height-310,clientY-area.top+10))+"px";
  box.classList.remove("hidden");
  render();
}

// 重なり対策：白丸と選手が重なる場合は、選手・ボールを優先してドラッグできるようにする
function pointerDown(e){
  if(savedPlayback) return;

  const p=pnt(e);

  hideChoices();

  // 先に選手/ボールを判定。重なっている時に動かせなくなるのを防ぐ。
  const o=hitObj(p);
  if(o){
    hideNumberList();
    selectedId=o.id;
    dragging={o,dx:p.x-o.x,dy:p.y-o.y};
    dragStart={id:o.id,t:o.t,x:o.x,y:o.y};
    render();
    return;
  }

  const line=hitWhiteCircle(p);
  if(line){
    e.preventDefault();
    e.stopPropagation();
    showNumberList(line,e.clientX,e.clientY);
    return;
  }

  hideNumberList();

  if(tool==="erase"){
    lines=lines.filter(l=>Math.hypot(p.x-lineMid(l).x,p.y-lineMid(l).y)>24);
    render();
    return;
  }

  selectedId=null;
  render();
}


/* v11.5 スペース機能を完全停止して、選手移動を復旧 */
window.spaceModeV110 = false;
window.spaceModeV114 = false;
window.spacesV110 = [];
window.spacesV114 = [];

setTimeout(()=>{
  const sp = document.getElementById("spaceFloatBtn");
  if(sp) sp.remove();
}, 100);

/* 再生操作：速度 0.1 / 0.5 / 1 / 1.5、戻る/再生/進む */
let playbackStateV115 = {
  frames: [],
  idx: 0,
  playing: false,
  speed: 1,
  raf: null,
  start: 0,
  durationBase: 850
};

function setSpeedV115(speed){
  playbackStateV115.speed = Number(speed);
  document.querySelectorAll(".speed-row button").forEach(b=>{
    b.classList.toggle("active", Number(b.dataset.speed) === playbackStateV115.speed);
  });
}

function pausePlaybackV115(){
  playbackStateV115.playing = false;
  if(playbackStateV115.raf) cancelAnimationFrame(playbackStateV115.raf);
  playbackStateV115.raf = null;
  const btn = $("playPauseBtnV115");
  if(btn){
    btn.classList.remove("playing");
    btn.title = "再生";
  }
}

function loadPlaybackFrameV115(frame){
  objects = clone(frame.objects || []);
  lines = clone(frame.lines || []);
  render();
}

function playStepV115(direction=1){
  if(!playbackStateV115.frames.length){
    alert("保存プレーを選択してください");
    return;
  }
  pausePlaybackV115();
  playbackStateV115.idx = Math.max(0, Math.min(playbackStateV115.frames.length - 1, playbackStateV115.idx + direction));
  loadPlaybackFrameV115(playbackStateV115.frames[playbackStateV115.idx]);
}

function animatePlaybackV115(){
  const st = playbackStateV115;
  if(!st.playing || !st.frames.length) return;

  const from = st.frames[st.idx];
  const to = st.frames[st.idx + 1];

  if(!from || !to){
    pausePlaybackV115();
    return;
  }

  const duration = st.durationBase / Math.max(0.1, st.speed);
  st.start = performance.now();

  function step(now){
    if(!st.playing) return;

    const t = Math.min(1, (now - st.start) / duration);
    objects = interpObjects(from.objects || [], to.objects || [], t);
    lines = to.lines || [];
    render();

    if(t >= 1){
      st.idx++;
      if(st.idx >= st.frames.length - 1){
        loadPlaybackFrameV115(st.frames[st.frames.length - 1]);
        pausePlaybackV115();
        return;
      }
      animatePlaybackV115();
      return;
    }

    st.raf = requestAnimationFrame(step);
  }

  st.raf = requestAnimationFrame(step);
}

function playPauseV115(){
  if(!playbackStateV115.frames.length){
    alert("保存プレーを選択してください");
    return;
  }

  if(playbackStateV115.playing){
    pausePlaybackV115();
    return;
  }

  if(playbackStateV115.idx >= playbackStateV115.frames.length - 1){
    playbackStateV115.idx = 0;
    loadPlaybackFrameV115(playbackStateV115.frames[0]);
  }

  playbackStateV115.playing = true;
  const btn = $("playPauseBtnV115");
  if(btn){
    btn.classList.add("playing");
    btn.title = "停止";
  }
  animatePlaybackV115();
}

// 保存プレー選択時は「読み込み」だけ。再生は▶で開始。
function playSaved(p){
  pausePlaybackV115();

  mode = p.mode || "half";
  syncMode();
  setCanvasSize();

  const frames = clone(p.frames || []);
  if(!frames.length){
    alert("保存プレーのデータがありません");
    return;
  }

  playbackStateV115.frames = frames;
  playbackStateV115.idx = 0;
  savedPlayback = false;
  loadPlaybackFrameV115(frames[0]);
}

setTimeout(()=>{
  const back = $("playBackBtnV115");
  const pause = $("playPauseBtnV115");
  const fwd = $("playForwardBtnV115");

  if(back) back.onclick = ()=>playStepV115(-1);
  if(pause) pause.onclick = ()=>playPauseV115();
  if(fwd) fwd.onclick = ()=>playStepV115(1);

  document.querySelectorAll(".speed-row button").forEach(btn=>{
    btn.onclick = ()=>setSpeedV115(btn.dataset.speed);
  });

  setSpeedV115(1);
}, 500);


/* v11.6 ドライブ時はボールも一緒に動く */
function getBallV116(){
  return objects.find(o => o.t === "b");
}

function findPlayerByMoveRefV116(moveRef){
  if(!moveRef || moveRef.t !== "o") return null;
  return objects.find(o => o.id === moveRef.id && o.t === "o");
}

function setBallNearPlayerV116(playerObj){
  const ball = getBallV116();
  if(!ball || !playerObj) return null;

  const nx = snap(playerObj.x + 24);
  const ny = snap(playerObj.y - 6);
  ball.x = nx;
  ball.y = ny;
  return {id:ball.id, t:ball.t, x:nx, y:ny};
}

function addHiddenBallFollowV116(stepNo, moveRef){
  const player = findPlayerByMoveRefV116(moveRef);
  if(!player) return;

  const ballMove = setBallNearPlayerV116(player);
  if(!ballMove) return;

  const exists = lines.some(l =>
    l.hiddenBallFollow &&
    getLineNo(l) === stepNo &&
    l.moveRef &&
    l.moveRef.id === ballMove.id &&
    l.moveRef.t === ballMove.t
  );
  if(exists) return;

  lines.push({
    x1: ballMove.x,
    y1: ballMove.y,
    x2: ballMove.x,
    y2: ballMove.y,
    k: "ballFollow",
    hidden: true,
    hiddenBallFollow: true,
    __id: "ball_follow_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    stepNo,
    fixedStepNo: stepNo,
    moveRef: ballMove
  });
}

const drawLineBeforeV116 = drawLine;
drawLine = function(l){
  if(l && l.hidden) return;
  drawLineBeforeV116(l);
};

function applyDriveBallFollowV116(){
  const last = [...lines].reverse().find(l => !l.hidden);
  if(!last || last.k !== "drive" || !last.moveRef || last.moveRef.t !== "o") return;

  const stepNo = getLineNo(last, lines.length);
  addHiddenBallFollowV116(stepNo, last.moveRef);
  render();
}

function wrapDriveKindFunctionV116(name){
  const oldFn = window[name] || eval("typeof " + name + " !== 'undefined' ? " + name + " : null");
  if(typeof oldFn !== "function") return;

  const wrapped = function(...args){
    const result = oldFn.apply(this,args);
    const kind = args[0];
    if(kind === "drive") applyDriveBallFollowV116();
    return result;
  };

  try{
    eval(name + " = wrapped");
  }catch(e){}
}

setTimeout(()=>{
  wrapDriveKindFunctionV116("chooseLastKindV106");
  wrapDriveKindFunctionV116("chooseLastKindV105");
  wrapDriveKindFunctionV116("changeLastAutoLineKindV104");
}, 300);

// すでにドライブ選択状態で動かした場合にも追従
const oldPointerUpV116 = pointerUp;
pointerUp = function(e){
  oldPointerUpV116(e);
  applyDriveBallFollowV116();
};

// buildFramesを上書き：隠しボール移動は再生には使うが、線としては表示しない
function buildFrames(){
  ensureLineMeta();
  const grouped={};

  lines.forEach((l,i)=>{
    const no=getLineNo(l,i+1);
    if(!grouped[no]) grouped[no]={no,moves:[],lines:[]};

    if(!l.hidden){
      grouped[no].lines.push({...l,stepNo:no,fixedStepNo:no});
    }

    if(l.moveRef){
      grouped[no].moves.push({...l.moveRef});
    }
  });

  const sorted=Object.values(grouped).sort((a,b)=>a.no-b.no);
  let base=clone(initialSnapshot || snapShot());
  const built=[clone(base)];

  sorted.forEach(step=>{
    const next=clone(base);

    step.moves.forEach(m=>{
      const obj=next.objects.find(o=>o.id===m.id && o.t===m.t);
      if(obj){
        obj.x=m.x;
        obj.y=m.y;
      }
    });

    next.lines=[...(next.lines||[]),...step.lines];
    built.push(clone(next));
    base=next;
  });

  return built;
}

// render上書き：hidden線の番号も出さない
render = function(){
  drawCourt();
  ensureLineMeta();

  const visibleLines = lines.filter(l => !l.hidden);

  visibleLines.forEach((l,i)=>{
    l.alpha = i===visibleLines.length-1 ? 1 : i===visibleLines.length-2 ? .35 : .18;
    drawLine(l);
  });

  objects.forEach(drawObj);

  visibleLines.forEach((l,i)=>{
    const m=lineMid(l);
    ctx.save();
    ctx.globalAlpha=1;
    ctx.fillStyle="#fff";
    ctx.beginPath();
    ctx.arc(m.x,m.y,11,0,Math.PI*2);
    ctx.fill();

    if(inlineTargetLine && inlineTargetLine.__id===l.__id){
      ctx.strokeStyle="#f4b43a";
      ctx.lineWidth=4;
      ctx.beginPath();
      ctx.arc(m.x,m.y,16,0,Math.PI*2);
      ctx.stroke();
    }

    ctx.fillStyle="#111";
    ctx.font="bold 11px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(String(getLineNo(l,i+1)),m.x,m.y);
    ctx.restore();
  });
};


/* v11.7 ドライブ時ボール追従を確実に修正
   - ドライブボタンを選んだ瞬間に、直前に動かした選手へボールを移動
   - 再生時も同じ番号でボールが同時に動く
*/

function ballObjV117(){
  return objects.find(o => o.t === "b");
}

function moveBallToPlayerV117(player){
  const ball = ballObjV117();
  if(!ball || !player) return null;

  ball.x = snap(player.x + 22);
  ball.y = snap(player.y);
  return {id:ball.id, t:ball.t, x:ball.x, y:ball.y};
}

function addBallFollowHiddenLineV117(player, stepNo){
  const ballMove = moveBallToPlayerV117(player);
  if(!ballMove) return;

  // 同じステップ番号の隠し移動を一度だけ入れる
  const already = lines.some(l =>
    l.hiddenBallFollowV117 &&
    getLineNo(l) === Number(stepNo) &&
    l.moveRef &&
    l.moveRef.id === ballMove.id
  );
  if(already) return;

  lines.push({
    x1: ballMove.x,
    y1: ballMove.y,
    x2: ballMove.x,
    y2: ballMove.y,
    k: "ballFollow",
    hidden: true,
    hiddenBallFollowV117: true,
    __id: "ball_follow_v117_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    stepNo: Number(stepNo),
    fixedStepNo: Number(stepNo),
    moveRef: ballMove
  });
}

function applyDriveBallFollowV117(){
  const lastVisible = [...lines].reverse().find(l => !l.hidden);
  if(!lastVisible || !lastVisible.moveRef || lastVisible.moveRef.t !== "o") return;

  // 最後の線をドライブにする
  lastVisible.k = "drive";

  const player = objects.find(o => o.t === "o" && o.id === lastVisible.moveRef.id);
  if(!player) return;

  const stepNo = getLineNo(lastVisible, lines.length);
  addBallFollowHiddenLineV117(player, stepNo);
  render();
}

// ドライブボタンを直接つかまえて確実に動かす
setTimeout(()=>{
  const driveBtn = $("chooseDriveBtn");
  if(driveBtn){
    driveBtn.onpointerenter = (e)=>{
      e.preventDefault();
      applyDriveBallFollowV117();
      if(typeof markChoiceV106 === "function") markChoiceV106("chooseDriveBtn");
      if(typeof scheduleBottomChoiceHideV106 === "function") scheduleBottomChoiceHideV106();
    };
    driveBtn.onclick = (e)=>{
      e.preventDefault();
      applyDriveBallFollowV117();
      if(typeof markChoiceV106 === "function") markChoiceV106("chooseDriveBtn");
      if(typeof scheduleBottomChoiceHideV106 === "function") scheduleBottomChoiceHideV106();
    };
  }
}, 900);

// すでにドライブモードの場合、離した瞬間にも追従
const pointerUpBeforeV117 = pointerUp;
pointerUp = function(e){
  pointerUpBeforeV117(e);

  const lastVisible = [...lines].reverse().find(l => !l.hidden);
  if(lastVisible && lastVisible.k === "drive" && lastVisible.moveRef && lastVisible.moveRef.t === "o"){
    const player = objects.find(o => o.t === "o" && o.id === lastVisible.moveRef.id);
    if(player){
      addBallFollowHiddenLineV117(player, getLineNo(lastVisible, lines.length));
      render();
    }
  }
};

// drawLine: 隠し線を描かない
const drawLineBeforeV117 = drawLine;
drawLine = function(l){
  if(l && l.hidden) return;
  drawLineBeforeV117(l);
};

// buildFrames: 隠し線は描画しないがmoveRefは使う
function buildFrames(){
  ensureLineMeta();
  const grouped={};

  lines.forEach((l,i)=>{
    const no=getLineNo(l,i+1);
    if(!grouped[no]) grouped[no]={no,moves:[],lines:[]};

    if(!l.hidden){
      grouped[no].lines.push({...l,stepNo:no,fixedStepNo:no});
    }

    if(l.moveRef){
      grouped[no].moves.push({...l.moveRef});
    }
  });

  const sorted=Object.values(grouped).sort((a,b)=>a.no-b.no);
  let base=clone(initialSnapshot || snapShot());
  const built=[clone(base)];

  sorted.forEach(step=>{
    const next=clone(base);

    step.moves.forEach(m=>{
      const obj=next.objects.find(o=>o.id===m.id && o.t===m.t);
      if(obj){
        obj.x=m.x;
        obj.y=m.y;
      }
    });

    next.lines=[...(next.lines||[]),...step.lines];
    built.push(clone(next));
    base=next;
  });

  return built;
}

// render: 隠し線と隠し番号を表示しない
render = function(){
  drawCourt();
  ensureLineMeta();

  const visibleLines = lines.filter(l => !l.hidden);

  visibleLines.forEach((l,i)=>{
    l.alpha = i===visibleLines.length-1 ? 1 : i===visibleLines.length-2 ? .35 : .18;
    drawLine(l);
  });

  objects.forEach(drawObj);

  visibleLines.forEach((l,i)=>{
    const m=lineMid(l);
    ctx.save();
    ctx.globalAlpha=1;
    ctx.fillStyle="#fff";
    ctx.beginPath();
    ctx.arc(m.x,m.y,11,0,Math.PI*2);
    ctx.fill();

    if(inlineTargetLine && inlineTargetLine.__id===l.__id){
      ctx.strokeStyle="#f4b43a";
      ctx.lineWidth=4;
      ctx.beginPath();
      ctx.arc(m.x,m.y,16,0,Math.PI*2);
      ctx.stroke();
    }

    ctx.fillStyle="#111";
    ctx.font="bold 11px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(String(getLineNo(l,i+1)),m.x,m.y);
    ctx.restore();
  });
};


/* v11.8 ムーブライブラリ
   - 左側にムーブテンプレート一覧
   - 右の保存プレーをドラッグして左に登録
   - ☆でも登録可能
   - 左のムーブをクリックするとコートへ読み込み
   - v12.2: 保存プレー側を削除してもライブラリ登録は残す
   - v12.2: ライブラリは鍵マークで削除ロック/解除
*/
const MOVE_LIBRARY_KEY_V118 = "tacticsBoardMoveLibraryV118";
let draggingSavedPlayIdV118 = null;

function getMoveLibraryV118(){
  try{
    return JSON.parse(localStorage.getItem(MOVE_LIBRARY_KEY_V118) || "[]");
  }catch(e){
    return [];
  }
}

function setMoveLibraryV118(list){
  localStorage.setItem(MOVE_LIBRARY_KEY_V118, JSON.stringify(list));
}

function isInMoveLibraryV118(playId){
  return getMoveLibraryV118().some(x => x.id === playId);
}

function addToMoveLibraryV118(play){
  if(!play) return;
  const list = getMoveLibraryV118();

  if(list.some(x => x.id === play.id)){
    renderMoveLibraryV118();
    renderSavedPlays();
    return;
  }

  list.unshift({
    id: play.id,
    title: play.title,
    mode: play.mode,
    frames: play.frames,
    logs: play.logs || [],
    createdAt: play.createdAt || new Date().toISOString(),
    locked: true
  });

  setMoveLibraryV118(list);
  renderMoveLibraryV118();
  renderSavedPlays();
}

function updateMoveLibraryItemV122(playId, patch){
  const list = getMoveLibraryV118().map(x => x.id === playId ? {...x, ...patch} : x);
  setMoveLibraryV118(list);
  renderMoveLibraryV118();
  renderSavedPlays();
}

function isMoveLibraryLockedV122(play){
  // 既存登録分は安全側でロック扱いにする
  return play.locked !== false;
}

function toggleMoveLibraryLockV122(playId){
  const item = getMoveLibraryV118().find(x => x.id === playId);
  if(!item) return;
  updateMoveLibraryItemV122(playId, {locked: !isMoveLibraryLockedV122(item)});
}

function removeFromMoveLibraryV118(playId, force=false){
  const item = getMoveLibraryV118().find(x => x.id === playId);
  if(item && isMoveLibraryLockedV122(item) && !force){
    alert("ライブラリはロック中です。鍵を開けてから削除してください。");
    renderMoveLibraryV118();
    renderSavedPlays();
    return;
  }
  const list = getMoveLibraryV118().filter(x => x.id !== playId);
  setMoveLibraryV118(list);
  renderMoveLibraryV118();
  renderSavedPlays();
}

function findSavedPlayByIdV118(id){
  return getSaved().find(p => p.id === id);
}

function loadLibraryPlayV118(play){
  if(!play) return;
  playSaved(play);
}

function renderMoveLibraryV118(){
  const box = $("moveLibraryList");
  if(!box) return;

  const list = getMoveLibraryV118();
  box.innerHTML = "";

  if(!list.length){
    box.innerHTML = '<div class="library-empty">保存プレーをここへドラッグ、または☆で登録できます。</div>';
    return;
  }

  list.forEach(play=>{
    const item = document.createElement("div");
    item.className = "library-item" + (isMoveLibraryLockedV122(play) ? " locked" : " unlocked");

    const load = document.createElement("button");
    load.className = "library-load";
    load.textContent = play.title;
    load.onclick = ()=>loadLibraryPlayV118(play);

    const lock = document.createElement("button");
    lock.className = "library-lock" + (isMoveLibraryLockedV122(play) ? " locked" : " unlocked");
    lock.textContent = isMoveLibraryLockedV122(play) ? "🔒" : "🔓";
    lock.title = isMoveLibraryLockedV122(play) ? "削除ロック中" : "削除ロック解除中";
    lock.onclick = ()=>toggleMoveLibraryLockV122(play.id);

    const del = document.createElement("button");
    del.className = "library-delete" + (isMoveLibraryLockedV122(play) ? " locked" : "");
    del.textContent = "×";
    del.title = isMoveLibraryLockedV122(play) ? "鍵を開けると削除できます" : "ライブラリから削除";
    del.disabled = isMoveLibraryLockedV122(play);
    del.onclick = ()=>removeFromMoveLibraryV118(play.id);

    item.appendChild(load);
    item.appendChild(lock);
    item.appendChild(del);
    box.appendChild(item);
  });
}

function setupMoveLibraryDropV118(){
  const drop = $("moveLibraryDrop");
  if(!drop) return;

  drop.addEventListener("dragover", e=>{
    e.preventDefault();
    drop.classList.add("drag-over");
  });

  drop.addEventListener("dragleave", ()=>{
    drop.classList.remove("drag-over");
  });

  drop.addEventListener("drop", e=>{
    e.preventDefault();
    drop.classList.remove("drag-over");

    const id = e.dataTransfer.getData("text/plain") || draggingSavedPlayIdV118;
    const play = findSavedPlayByIdV118(id);
    if(play) addToMoveLibraryV118(play);
  });
}

// renderSavedPlaysを上書き：☆とドラッグ対応
function renderSavedPlays(){
  const box=$("savedPlayList");
  if(!box) return;
  box.innerHTML="";

  const list=getSaved();
  if(!list.length){
    box.innerHTML='<div class="saved-play-empty">保存プレーはありません</div>';
    renderMoveLibraryV118();
    return;
  }

  list.forEach((p,idx)=>{
    const wrap=document.createElement("div");
    wrap.className="saved-play-wrap";

    const fav=document.createElement("button");
    fav.className="favorite-play-btn" + (isInMoveLibraryV118(p.id) ? " registered" : "");
    fav.textContent=isInMoveLibraryV118(p.id) ? "★" : "☆";
    fav.title="ムーブライブラリに登録";
    fav.onclick=()=>{
      if(isInMoveLibraryV118(p.id)){
        removeFromMoveLibraryV118(p.id);
      }else{
        addToMoveLibraryV118(p);
      }
    };

    const btn=document.createElement("button");
    btn.className="saved-play-btn";
    btn.textContent=p.title;
    btn.draggable=true;
    btn.onclick=()=>playSaved(p);

    btn.addEventListener("dragstart", e=>{
      draggingSavedPlayIdV118 = p.id;
      btn.classList.add("dragging");
      e.dataTransfer.setData("text/plain", p.id);
      e.dataTransfer.effectAllowed = "copy";
    });

    btn.addEventListener("dragend", ()=>{
      draggingSavedPlayIdV118 = null;
      btn.classList.remove("dragging");
    });

    const del=document.createElement("button");
    del.className="delete-play-btn";
    del.textContent="×";
    del.onclick=()=>{
      const n=getSaved();
      n.splice(idx,1);
      setSaved(n);
      // v12.2: 保存プレー側を削除してもムーブライブラリは残す
      renderSavedPlays();
    };

    wrap.appendChild(fav);
    wrap.appendChild(btn);
    wrap.appendChild(del);
    box.appendChild(wrap);
  });

  renderMoveLibraryV118();
}

setTimeout(()=>{
  setupMoveLibraryDropV118();
  renderMoveLibraryV118();
  renderSavedPlays();
}, 500);


/* v12.0 画像保存・動画保存・スマホ共有 */
let lastExportBlobV120 = null;
let lastExportFileNameV120 = "tactics-board.png";
let exportingVideoV120 = false;

function setExportStatusV120(text){
  const el = $("exportStatusV120");
  if(el) el.textContent = text;
}

function padV120(n){ return String(n).padStart(2,"0"); }
function timestampV120(){
  const d = new Date();
  return `${d.getFullYear()}${padV120(d.getMonth()+1)}${padV120(d.getDate())}_${padV120(d.getHours())}${padV120(d.getMinutes())}`;
}

function canvasToBlobV120(type="image/png", quality=.95){
  return new Promise((resolve,reject)=>{
    try{
      canvas.toBlob(blob=>{
        if(blob) resolve(blob);
        else reject(new Error("画像データを作成できませんでした"));
      }, type, quality);
    }catch(err){ reject(err); }
  });
}

function downloadBlobV120(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

async function saveImageV120(){
  try{
    render();
    const blob = await canvasToBlobV120("image/png");
    const name = `tactics-board_${mode}_${timestampV120()}.png`;
    lastExportBlobV120 = blob;
    lastExportFileNameV120 = name;
    downloadBlobV120(blob, name);
    setExportStatusV120("画像を保存しました。スマホではダウンロード/写真アプリを確認してください。");
  }catch(err){
    console.error(err);
    alert("画像保存に失敗しました。もう一度試してください。");
  }
}

function bestVideoMimeV120(){
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  if(typeof MediaRecorder === "undefined") return "";
  return candidates.find(t=>MediaRecorder.isTypeSupported(t)) || "";
}

function extFromMimeV120(mime){
  return mime.includes("mp4") ? "mp4" : "webm";
}

function sleepV120(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function renderPlaybackForRecordV120(frames, speed=1){
  const durationBase = (playbackStateV115 && playbackStateV115.durationBase) ? playbackStateV115.durationBase : 850;
  const duration = durationBase / Math.max(.1, Number(speed)||1);
  loadPlaybackFrameV115(frames[0]);
  await sleepV120(250);

  for(let i=0;i<frames.length-1;i++){
    const from = frames[i];
    const to = frames[i+1];
    const start = performance.now();
    await new Promise(resolve=>{
      function step(now){
        const t = Math.min(1, (now - start) / duration);
        objects = interpObjects(from.objects || [], to.objects || [], t);
        lines = to.lines || [];
        render();
        if(t >= 1) resolve();
        else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    await sleepV120(120);
  }
  loadPlaybackFrameV115(frames[frames.length-1]);
  await sleepV120(350);
}

async function saveVideoV120(){
  if(exportingVideoV120) return;

  if(typeof MediaRecorder === "undefined" || !canvas.captureStream){
    alert("このブラウザは動画保存に対応していません。最新版のSafari/Chromeで試してください。");
    return;
  }

  const frames = clone(playbackStateV115?.frames || []);
  if(frames.length < 2){
    alert("先に右側の『保存プレー』または左のムーブを選択してください。選択したプレーを動画保存します。");
    return;
  }

  const mime = bestVideoMimeV120();
  if(!mime){
    alert("この端末では動画形式に対応していません。画像保存を使ってください。");
    return;
  }

  const btn = $("saveVideoBtnV120");
  const shareBtn = $("sharePlayBtnV120");
  try{
    exportingVideoV120 = true;
    if(btn) btn.disabled = true;
    if(shareBtn) shareBtn.disabled = true;
    pausePlaybackV115?.();
    setExportStatusV120("動画を作成中です。画面を閉じずにお待ちください…");

    const stream = canvas.captureStream(30);
    const chunks = [];
    const recorder = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:4500000});

    const stopped = new Promise(resolve=>{
      recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = resolve;
    });

    recorder.start(200);
    await renderPlaybackForRecordV120(frames, playbackStateV115?.speed || 1);
    await sleepV120(250);
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(t=>t.stop());

    const blob = new Blob(chunks, {type:mime});
    const ext = extFromMimeV120(mime);
    const name = `tactics-board_${mode}_${timestampV120()}.${ext}`;
    lastExportBlobV120 = blob;
    lastExportFileNameV120 = name;
    downloadBlobV120(blob, name);
    setExportStatusV120(ext === "mp4" ? "MP4動画を保存しました。" : "動画を保存しました。Androidではそのまま再生できます。iPhoneで送れない時は共有ボタンも試してください。");
  }catch(err){
    console.error(err);
    alert("動画保存に失敗しました。端末やブラウザを変えて試してください。");
    setExportStatusV120("動画保存に失敗しました。画像保存は利用できます。");
  }finally{
    exportingVideoV120 = false;
    if(btn) btn.disabled = false;
    if(shareBtn) shareBtn.disabled = false;
  }
}

async function sharePlayV120(){
  try{
    if(!lastExportBlobV120){
      render();
      lastExportBlobV120 = await canvasToBlobV120("image/png");
      lastExportFileNameV120 = `tactics-board_${mode}_${timestampV120()}.png`;
    }

    const file = new File([lastExportBlobV120], lastExportFileNameV120, {type:lastExportBlobV120.type || "application/octet-stream"});

    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:"Tactics Board", text:"作戦ボード"});
      setExportStatusV120("共有しました。");
    }else if(navigator.share){
      await navigator.share({title:"Tactics Board", text:"作戦ボード"});
    }else{
      downloadBlobV120(lastExportBlobV120, lastExportFileNameV120);
      setExportStatusV120("このブラウザは直接共有に非対応のため、保存しました。");
    }
  }catch(err){
    if(err && err.name === "AbortError") return;
    console.error(err);
    alert("共有に失敗しました。先に画像保存または動画保存を使ってください。");
  }
}

setTimeout(()=>{
  const img = $("saveImageBtnV120");
  const vid = $("saveVideoBtnV120");
  const share = $("sharePlayBtnV120");
  if(img) img.onclick = saveImageV120;
  if(vid) vid.onclick = saveVideoV120;
  if(share) share.onclick = sharePlayV120;
}, 500);

/* v12.1 fixed export: 画像/動画/共有を安全な別キャンバスで作成
   - file:// で背景画像を描いたcanvasが汚染されても保存できるよう、コートをベクター描画
   - GitHub Pages(https)ではもちろん動作
   - MediaRecorderは端末対応形式を自動選択。失敗時は形式なしでも再試行
*/
let exportCanvasV121 = null;
let exportCtxV121 = null;

function exportSizeV121(){
  return mode === "half" ? {w:750,h:700} : {w:1400,h:750};
}

function ensureExportCanvasV121(){
  const s = exportSizeV121();
  if(!exportCanvasV121){
    exportCanvasV121 = document.createElement("canvas");
  }
  exportCanvasV121.width = s.w;
  exportCanvasV121.height = s.h;
  exportCtxV121 = exportCanvasV121.getContext("2d");
  return exportCanvasV121;
}

function drawRoundedRectV121(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y);
  c.lineTo(x+w-r,y);
  c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r);
  c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h);
  c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r);
  c.quadraticCurveTo(x,y,x+r,y);
  c.closePath();
}

function drawCourtVectorV121(c,w,h,kind){
  c.fillStyle = "#e2aa56";
  c.fillRect(0,0,w,h);
  c.strokeStyle = "#fff";
  c.lineWidth = 5;
  c.lineCap = "round";
  c.lineJoin = "round";

  if(kind === "half"){
    // outer
    c.strokeRect(40,38,675,650);
    // key
    c.strokeRect(267,40,220,267);
    // free throw semicircle
    c.beginPath(); c.arc(377,307,82,0,Math.PI); c.stroke();
    // top circle lower visible
    c.beginPath(); c.arc(377,684,82,Math.PI,0); c.stroke();
    // 3pt arc
    c.beginPath(); c.moveTo(82,40); c.lineTo(82,164); c.arc(379,164,297,Math.PI,0); c.lineTo(676,40); c.stroke();
    // backboard/rim
    c.beginPath(); c.moveTo(338,94); c.lineTo(418,94); c.stroke();
    c.beginPath(); c.arc(379,115,12,0,Math.PI*2); c.stroke();
    c.beginPath(); c.arc(379,112,34,0.15*Math.PI,0.85*Math.PI); c.stroke();
    // lane marks rough
    [118,164,211,257].forEach(y=>{ c.beginPath(); c.moveTo(257,y); c.lineTo(267,y); c.moveTo(487,y); c.lineTo(497,y); c.stroke(); });
    // side inbound marks
    c.beginPath(); c.moveTo(25,455); c.lineTo(40,455); c.moveTo(715,455); c.lineTo(730,455); c.stroke();
  }else{
    c.strokeRect(62,52,1285,650);
    c.beginPath(); c.moveTo(705,52); c.lineTo(705,702); c.stroke();
    c.beginPath(); c.arc(705,377,82,0,Math.PI*2); c.stroke();
    // left key and arc
    c.strokeRect(62,273,268,212);
    c.beginPath(); c.arc(330,379,80,-Math.PI/2,Math.PI/2); c.stroke();
    c.beginPath(); c.moveTo(62,91); c.lineTo(191,91); c.arc(191,377,286,-Math.PI/2,Math.PI/2); c.lineTo(62,663); c.stroke();
    // right key and arc
    c.strokeRect(1078,273,268,212);
    c.beginPath(); c.arc(1078,379,80,Math.PI/2,Math.PI*1.5); c.stroke();
    c.beginPath(); c.moveTo(1346,91); c.lineTo(1218,91); c.arc(1218,377,286,-Math.PI/2,Math.PI/2,true); c.lineTo(1346,663); c.stroke();
    // backboard/rim
    c.beginPath(); c.moveTo(118,340); c.lineTo(118,416); c.moveTo(1291,340); c.lineTo(1291,416); c.stroke();
    c.beginPath(); c.arc(140,378,12,0,Math.PI*2); c.arc(1270,378,12,0,Math.PI*2); c.stroke();
    c.beginPath(); c.arc(140,378,31,-Math.PI/2,Math.PI/2); c.arc(1270,378,31,Math.PI/2,Math.PI*1.5); c.stroke();
    [142,188,234,280].forEach(x=>{ c.beginPath(); c.moveTo(x,264); c.lineTo(x,273); c.moveTo(x,485); c.lineTo(x,494); c.stroke(); });
    [1128,1174,1220,1266].forEach(x=>{ c.beginPath(); c.moveTo(x,264); c.lineTo(x,273); c.moveTo(x,485); c.lineTo(x,494); c.stroke(); });
  }
}

function headV121(c,x1,y1,x2,y2,col){
  const a=Math.atan2(y2-y1,x2-x1),s=18;
  c.fillStyle=col; c.beginPath();
  c.moveTo(x2,y2);
  c.lineTo(x2-s*Math.cos(a-Math.PI/6),y2-s*Math.sin(a-Math.PI/6));
  c.lineTo(x2-s*Math.cos(a+Math.PI/6),y2-s*Math.sin(a+Math.PI/6));
  c.closePath(); c.fill();
}
function drawStraightV121(c,l,col,dash=true){
  c.strokeStyle=col; c.lineWidth=5; c.lineCap="round"; c.lineJoin="round";
  if(dash) c.setLineDash([13,10]); else c.setLineDash([]);
  c.beginPath(); c.moveTo(l.x1,l.y1); c.lineTo(l.x2,l.y2); c.stroke();
  c.setLineDash([]); headV121(c,l.x1,l.y1,l.x2,l.y2,col);
}
function zigV121(l){
  const {x1,y1,x2,y2}=l,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,px=-uy,py=ux;
  const pts=[{x:x1,y:y1}],step=25,amp=11;
  for(let d=step;d<len-step;d+=step){
    const side=Math.floor(d/step)%2?1:-1;
    pts.push({x:x1+ux*d+px*amp*side,y:y1+uy*d+py*amp*side});
  }
  pts.push({x:x2,y:y2}); return pts;
}
function drawLineExportV121(c,l){
  if(!l || l.hidden) return;
  c.save(); c.globalAlpha = l.alpha ?? 1;
  if(l.k==="pass") drawStraightV121(c,l,"#e8232e",true);
  if(l.k==="shoot") drawStraightV121(c,l,"#2563eb",true);
  if(l.k==="moveLine") drawStraightV121(c,l,"#16a34a",true);
  if(l.k==="drive"){
    const pts=zigV121(l);
    c.strokeStyle="#1764ff"; c.lineWidth=6; c.lineCap="round"; c.lineJoin="round"; c.setLineDash([]);
    c.beginPath(); pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y)); c.stroke();
    headV121(c,pts.at(-2).x,pts.at(-2).y,l.x2,l.y2,"#1764ff");
  }
  c.restore();
}
function drawObjExportV121(c,o){
  const r=o.t==="b"?20:(o.t==="d"?21:25);
  c.save();
  c.shadowColor="rgba(0,0,0,.28)"; c.shadowBlur=6;
  c.beginPath(); c.arc(o.x,o.y,r,0,Math.PI*2);
  c.fillStyle=o.t==="o"?"#e8232e":o.t==="d"?"#2468e8":"#f58220";
  c.strokeStyle=o.t==="b"?"#111":"#fff"; c.lineWidth=3; c.fill(); c.stroke();
  c.shadowBlur=0;
  c.fillStyle="#fff"; c.font=o.t==="d" ? "900 15px system-ui" : "900 18px system-ui";
  c.textAlign="center"; c.textBaseline="middle";
  c.fillText(o.t==="b"?"🏀":o.id,o.x,o.y);
  c.restore();
}
function renderSnapshotToExportCanvasV121(snapshot, drawStepNumbers=true){
  const ex = ensureExportCanvasV121();
  const c = exportCtxV121;
  drawCourtVectorV121(c, ex.width, ex.height, mode);
  const visibleLines = (snapshot.lines || []).filter(l => !l.hidden);
  visibleLines.forEach((l,i)=>{
    l.alpha = i===visibleLines.length-1 ? 1 : i===visibleLines.length-2 ? .35 : .18;
    drawLineExportV121(c,l);
  });
  (snapshot.objects || []).forEach(o=>drawObjExportV121(c,o));
  if(drawStepNumbers){
    visibleLines.forEach((l,i)=>{
      const m=lineMid(l);
      c.save(); c.fillStyle="#fff"; c.beginPath(); c.arc(m.x,m.y,11,0,Math.PI*2); c.fill();
      c.fillStyle="#111"; c.font="bold 11px system-ui"; c.textAlign="center"; c.textBaseline="middle";
      c.fillText(String(getLineNo(l,i+1)),m.x,m.y);
      c.restore();
    });
  }
  return ex;
}
function currentSnapshotV121(){ return {objects:clone(objects), lines:clone(lines)}; }
function exportCanvasToBlobV121(type="image/png", quality=.95){
  const ex = renderSnapshotToExportCanvasV121(currentSnapshotV121(), true);
  return new Promise((resolve,reject)=>{
    try{ ex.toBlob(b=>b?resolve(b):reject(new Error("blob empty")), type, quality); }
    catch(e){ reject(e); }
  });
}
async function saveImageV121(){
  try{
    const blob = await exportCanvasToBlobV121("image/png");
    const name = `tactics-board_${mode}_${timestampV120()}.png`;
    lastExportBlobV120 = blob;
    lastExportFileNameV120 = name;
    downloadBlobV120(blob,name);
    setExportStatusV120("画像を保存しました。ローカル表示でも保存できる方式に修正済みです。");
  }catch(err){
    console.error(err);
    alert("画像保存に失敗しました。GitHub Pagesにアップしてからもう一度試してください。");
  }
}
function bestVideoMimeV121(){
  if(typeof MediaRecorder === "undefined") return "";
  const ua = navigator.userAgent || "";
  const isApple = /iPhone|iPad|Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|Edg|OPR/.test(ua);
  const mp4 = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4;codecs=h264,aac","video/mp4"];
  const webm = ["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"];
  const candidates = isApple ? [...mp4,...webm] : [...webm,...mp4];
  return candidates.find(t=>MediaRecorder.isTypeSupported(t)) || "";
}
async function recordExportFramesV121(frames, speed=1){
  const oldSnap = currentSnapshotV121();
  const oldMode = mode;
  const durationBase = (playbackStateV115 && playbackStateV115.durationBase) ? playbackStateV115.durationBase : 850;
  const duration = durationBase / Math.max(.1, Number(speed)||1);
  const chunks=[];
  let stream, recorder, mime;
  try{
    renderSnapshotToExportCanvasV121(frames[0], true);
    const ex = ensureExportCanvasV121();
    if(!ex.captureStream){ throw new Error("captureStream unsupported"); }
    stream = ex.captureStream(30);
    mime = bestVideoMimeV121();
    try{
      recorder = mime ? new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond:4500000}) : new MediaRecorder(stream,{videoBitsPerSecond:4500000});
    }catch(e){
      recorder = new MediaRecorder(stream);
      mime = recorder.mimeType || "video/webm";
    }
    const stopped = new Promise((resolve,reject)=>{
      recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = e=>reject(e.error || e);
      recorder.onstop = resolve;
    });
    recorder.start(200);
    await sleepV120(250);
    for(let i=0;i<frames.length-1;i++){
      const from=frames[i], to=frames[i+1];
      const start=performance.now();
      await new Promise(resolve=>{
        function step(now){
          const t=Math.min(1,(now-start)/duration);
          const snap={objects:interpObjects(from.objects||[],to.objects||[],t), lines:to.lines||[]};
          renderSnapshotToExportCanvasV121(snap,true);
          if(t>=1) resolve(); else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
      await sleepV120(120);
    }
    renderSnapshotToExportCanvasV121(frames[frames.length-1], true);
    await sleepV120(350);
    recorder.stop();
    await stopped;
    if(!chunks.length) throw new Error("recorded chunks empty");
    return new Blob(chunks,{type:mime || recorder.mimeType || chunks[0].type || "video/webm"});
  }finally{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    // 画面側も最後に戻す
    objects=oldSnap.objects; lines=oldSnap.lines; mode=oldMode; syncMode?.(); setCanvasSize?.(); render?.();
  }
}
function getSelectedFramesV121(){
  let frames = clone(playbackStateV115?.frames || []);
  if(frames.length >= 2) return frames;
  const saved = getSaved?.() || [];
  if(saved.length && saved[0].frames && saved[0].frames.length >= 2){
    return clone(saved[0].frames);
  }
  return [];
}
async function saveVideoV121(){
  if(exportingVideoV120) return;
  if(typeof MediaRecorder === "undefined"){
    alert("このブラウザは動画保存に対応していません。Safari/Chromeを最新版にしてください。");
    return;
  }
  const frames = getSelectedFramesV121();
  if(frames.length < 2){
    alert("先にプレーを作成して保存し、保存プレーを選択してください。");
    return;
  }
  const btn=$("saveVideoBtnV120"), shareBtn=$("sharePlayBtnV120");
  try{
    exportingVideoV120=true;
    if(btn) btn.disabled=true;
    if(shareBtn) shareBtn.disabled=true;
    pausePlaybackV115?.();
    setExportStatusV120("動画を作成中です。画面を閉じずにお待ちください…");
    const blob = await recordExportFramesV121(frames, playbackStateV115?.speed || 1);
    const type = blob.type || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const name = `tactics-board_${mode}_${timestampV120()}.${ext}`;
    lastExportBlobV120=blob;
    lastExportFileNameV120=name;
    downloadBlobV120(blob,name);
    setExportStatusV120(ext==="mp4" ? "MP4動画を保存しました。" : "WebM動画を保存しました。Android/Chrome向けです。iPhoneで送る場合は共有も試してください。");
  }catch(err){
    console.error(err);
    alert("動画保存に失敗しました。GitHub Pagesへアップ後、ChromeまたはSafari最新版で試してください。");
    setExportStatusV120("動画保存に失敗しました。画像保存は使えます。ブラウザの動画録画対応が原因の可能性があります。");
  }finally{
    exportingVideoV120=false;
    if(btn) btn.disabled=false;
    if(shareBtn) shareBtn.disabled=false;
  }
}
async function sharePlayV121(){
  try{
    if(!lastExportBlobV120){
      lastExportBlobV120 = await exportCanvasToBlobV121("image/png");
      lastExportFileNameV120 = `tactics-board_${mode}_${timestampV120()}.png`;
    }
    const file = new File([lastExportBlobV120], lastExportFileNameV120, {type:lastExportBlobV120.type || "application/octet-stream"});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:"Tactics Board", text:"作戦ボード"});
      setExportStatusV120("共有しました。");
    }else if(navigator.share){
      await navigator.share({title:"Tactics Board", text:"作戦ボード"});
    }else{
      downloadBlobV120(lastExportBlobV120,lastExportFileNameV120);
      setExportStatusV120("直接共有に非対応のため、保存しました。");
    }
  }catch(err){
    if(err && err.name === "AbortError") return;
    console.error(err);
    alert("共有に失敗しました。先に画像保存または動画保存を使ってください。");
  }
}
setTimeout(()=>{
  const img=$("saveImageBtnV120"), vid=$("saveVideoBtnV120"), share=$("sharePlayBtnV120");
  if(img) img.onclick=saveImageV121;
  if(vid) vid.onclick=saveVideoV121;
  if(share) share.onclick=sharePlayV121;
  setExportStatusV120("v12.1：画像保存はローカル/GitHub対応。動画は保存プレー選択後に作成できます。");
}, 900);


/* v12.5 選択中プレーを分かりやすく表示
   ※プレー作成・再生・保存・動画保存など既存機能は変更しない
*/
let selectedPlayV125 = null;

function ensureSelectedPlayPanelV125(){
  let panel = $("selectedPlayPanelV125");
  if(panel) return panel;

  const playCard = document.querySelector(".play-create-card");
  if(!playCard) return null;

  panel = document.createElement("div");
  panel.id = "selectedPlayPanelV125";
  panel.className = "selected-play-panel no-selection";
  panel.innerHTML = `
    <div class="selected-play-label">選択中プレー</div>
    <div id="selectedPlayTitleV125" class="selected-play-title">未選択</div>
    <div id="selectedPlaySourceV125" class="selected-play-source">保存プレーを選択してください</div>
  `;

  const title = playCard.querySelector("h2");
  if(title && title.nextSibling){
    playCard.insertBefore(panel, title.nextSibling);
  }else{
    playCard.insertBefore(panel, playCard.firstChild);
  }
  return panel;
}

function setSelectedPlayV125(play, sourceText){
  if(!play) return;
  selectedPlayV125 = {
    id: play.id,
    title: play.title || "無題プレー",
    source: sourceText || "保存プレー"
  };
  updateSelectedPlayPanelV125();
}

function updateSelectedPlayPanelV125(){
  const panel = ensureSelectedPlayPanelV125();
  const title = $("selectedPlayTitleV125");
  const source = $("selectedPlaySourceV125");

  if(!panel || !title || !source) return;

  if(!selectedPlayV125){
    panel.classList.add("no-selection");
    title.textContent = "未選択";
    source.textContent = "保存プレーを選択してください";
    return;
  }

  panel.classList.remove("no-selection");
  title.textContent = selectedPlayV125.title;
  source.textContent = selectedPlayV125.source + " / 動画保存の対象";
}

function isSelectedPlayV125(play){
  return !!(play && selectedPlayV125 && play.id === selectedPlayV125.id);
}

const playSavedBeforeV125 = playSaved;
playSaved = function(play){
  setSelectedPlayV125(play, "保存プレー");
  const result = playSavedBeforeV125(play);
  updateSelectedPlayPanelV125();

  setTimeout(()=>{
    if(typeof renderSavedPlays === "function") renderSavedPlays();
    if(typeof renderMoveLibraryV118 === "function") renderMoveLibraryV118();
  }, 0);

  return result;
};

const loadLibraryPlayBeforeV125 = typeof loadLibraryPlayV118 === "function" ? loadLibraryPlayV118 : null;
if(loadLibraryPlayBeforeV125){
  loadLibraryPlayV118 = function(play){
    setSelectedPlayV125(play, "ムーブライブラリ");
    const result = playSavedBeforeV125(play);
    updateSelectedPlayPanelV125();

    setTimeout(()=>{
      if(typeof renderSavedPlays === "function") renderSavedPlays();
      if(typeof renderMoveLibraryV118 === "function") renderMoveLibraryV118();
    }, 0);

    return result;
  };
}

renderSavedPlays = function(){
  const box=$("savedPlayList");
  if(!box) return;
  box.innerHTML="";

  const list=getSaved();
  if(!list.length){
    box.innerHTML='<div class="saved-play-empty">保存プレーはありません</div>';
    if(typeof renderMoveLibraryV118 === "function") renderMoveLibraryV118();
    updateSelectedPlayPanelV125();
    return;
  }

  list.forEach((p,idx)=>{
    const wrap=document.createElement("div");
    wrap.className="saved-play-wrap" + (isSelectedPlayV125(p) ? " selected-play-active" : "");

    const fav=document.createElement("button");
    fav.className="favorite-play-btn" + (isInMoveLibraryV118(p.id) ? " registered" : "");
    fav.textContent=isInMoveLibraryV118(p.id) ? "★" : "☆";
    fav.title="ムーブライブラリに登録";
    fav.onclick=()=>{
      if(isInMoveLibraryV118(p.id)){
        removeFromMoveLibraryV118(p.id);
      }else{
        addToMoveLibraryV118(p);
      }
    };

    const btn=document.createElement("button");
    btn.className="saved-play-btn";
    btn.textContent=p.title;
    btn.draggable=true;
    btn.onclick=()=>playSaved(p);

    btn.addEventListener("dragstart", e=>{
      draggingSavedPlayIdV118 = p.id;
      btn.classList.add("dragging");
      e.dataTransfer.setData("text/plain", p.id);
      e.dataTransfer.effectAllowed = "copy";
    });

    btn.addEventListener("dragend", ()=>{
      draggingSavedPlayIdV118 = null;
      btn.classList.remove("dragging");
    });

    const del=document.createElement("button");
    del.className="delete-play-btn";
    del.textContent="×";
    del.onclick=()=>{
      const n=getSaved();
      n.splice(idx,1);
      setSaved(n);
      renderSavedPlays();
    };

    wrap.appendChild(fav);
    wrap.appendChild(btn);
    wrap.appendChild(del);
    box.appendChild(wrap);
  });

  updateSelectedPlayPanelV125();
  if(typeof renderMoveLibraryV118 === "function") renderMoveLibraryV118();
};

renderMoveLibraryV118 = function(){
  const box = $("moveLibraryList");
  if(!box) return;

  const list = getMoveLibraryV118();
  box.innerHTML = "";

  if(!list.length){
    box.innerHTML = '<div class="library-empty">保存プレーをここへドラッグ、または☆で登録できます。</div>';
    return;
  }

  list.forEach(play=>{
    const item = document.createElement("div");
    item.className =
      "library-item" +
      (isMoveLibraryLockedV122(play) ? " locked" : " unlocked") +
      (isSelectedPlayV125(play) ? " selected-play-active" : "");

    const load = document.createElement("button");
    load.className = "library-load";
    load.textContent = play.title;
    load.onclick = ()=>loadLibraryPlayV118(play);

    const lock = document.createElement("button");
    lock.className = "library-lock" + (isMoveLibraryLockedV122(play) ? " locked" : " unlocked");
    lock.textContent = isMoveLibraryLockedV122(play) ? "🔒" : "🔓";
    lock.title = isMoveLibraryLockedV122(play) ? "削除ロック中" : "削除ロック解除中";
    lock.onclick = ()=>toggleMoveLibraryLockV122(play.id);

    const del = document.createElement("button");
    del.className = "library-delete" + (isMoveLibraryLockedV122(play) ? " locked" : "");
    del.textContent = "×";
    del.title = isMoveLibraryLockedV122(play) ? "鍵を開けると削除できます" : "ライブラリから削除";
    del.disabled = isMoveLibraryLockedV122(play);
    del.onclick = ()=>removeFromMoveLibraryV118(play.id);

    item.appendChild(load);
    item.appendChild(lock);
    item.appendChild(del);
    box.appendChild(item);
  });
};

setTimeout(()=>{
  ensureSelectedPlayPanelV125();
  updateSelectedPlayPanelV125();
  if(typeof renderSavedPlays === "function") renderSavedPlays();
  if(typeof renderMoveLibraryV118 === "function") renderMoveLibraryV118();
}, 1000);

/* v12.6 動画コート修正・名前変更・iPhone共有導線
   既存機能は上書き最小限：保存/ライブラリ表示とエクスポートだけを補強
*/
let selectedPlayDataV126 = null;
let selectedPlaySourceV126 = "保存プレー";

function safeFileNameV126(name, fallback="tactics-board"){
  const s = String(name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~\[\]`;\s]+/g,"_")
    .replace(/^_+|_+$/g,"")
    .slice(0,80);
  return s || fallback;
}

function rememberSelectedPlayV126(play, source){
  if(!play) return;
  selectedPlayDataV126 = clone(play);
  selectedPlaySourceV126 = source || selectedPlaySourceV126 || "保存プレー";
  if(typeof selectedPlayV125 !== "undefined"){
    selectedPlayV125 = {id:play.id, title:play.title || "無題プレー", source:selectedPlaySourceV126};
    updateSelectedPlayPanelV125?.();
  }
}

function selectedModeV126(){
  return selectedPlayDataV126?.mode || mode || "half";
}
function exportSizeForModeV126(m){
  return m === "full" ? {w:1400,h:750} : {w:750,h:700};
}

function ensureExportCanvasForModeV126(m){
  const s = exportSizeForModeV126(m);
  if(!exportCanvasV121) exportCanvasV121 = document.createElement("canvas");
  exportCanvasV121.width = s.w;
  exportCanvasV121.height = s.h;
  exportCtxV121 = exportCanvasV121.getContext("2d");
  return exportCanvasV121;
}

function drawCourtImageOrVectorV126(c,w,h,m){
  const img = m === "full" ? fullImg : halfImg;
  c.clearRect(0,0,w,h);
  if(img && img.complete && img.naturalWidth){
    c.drawImage(img,0,0,w,h);
  }else{
    drawCourtVectorV121(c,w,h,m);
  }
}

function renderSnapshotToExportCanvasV126(snapshot, drawStepNumbers=true, exportMode){
  const m = exportMode || selectedModeV126();
  const ex = ensureExportCanvasForModeV126(m);
  const c = exportCtxV121;
  drawCourtImageOrVectorV126(c, ex.width, ex.height, m);

  const visibleLines = (snapshot.lines || []).filter(l => !l.hidden);
  visibleLines.forEach((l,i)=>{
    const line = {...l, alpha: i===visibleLines.length-1 ? 1 : i===visibleLines.length-2 ? .35 : .18};
    drawLineExportV121(c,line);
  });
  (snapshot.objects || []).forEach(o=>drawObjExportV121(c,o));

  if(drawStepNumbers){
    visibleLines.forEach((l,i)=>{
      const mid = lineMid(l);
      c.save();
      c.fillStyle="#fff";
      c.beginPath();
      c.arc(mid.x,mid.y,11,0,Math.PI*2);
      c.fill();
      c.fillStyle="#111";
      c.font="bold 11px system-ui";
      c.textAlign="center";
      c.textBaseline="middle";
      c.fillText(String(getLineNo(l,i+1)),mid.x,mid.y);
      c.restore();
    });
  }
  return ex;
}

// 既存の画像書き出しも同じコート画像で統一
renderSnapshotToExportCanvasV121 = function(snapshot, drawStepNumbers=true){
  return renderSnapshotToExportCanvasV126(snapshot, drawStepNumbers, selectedModeV126());
};

function getSelectedPlayForExportV126(){
  if(selectedPlayDataV126 && selectedPlayDataV126.frames && selectedPlayDataV126.frames.length >= 2){
    return clone(selectedPlayDataV126);
  }
  const frames = clone(playbackStateV115?.frames || []);
  if(frames.length >= 2){
    return {id:"current", title:selectedPlayV125?.title || "selected_play", mode:mode, frames};
  }
  const saved = getSaved?.() || [];
  const first = saved.find(p=>p.frames && p.frames.length >= 2);
  return first ? clone(first) : null;
}

function getSelectedFramesV121(){
  const p = getSelectedPlayForExportV126();
  return p ? clone(p.frames || []) : [];
}

async function recordExportFramesV126(play, speed=1){
  const frames = clone(play.frames || []);
  const exportMode = play.mode || "half";
  const oldSnap = currentSnapshotV121();
  const oldMode = mode;
  const durationBase = (playbackStateV115 && playbackStateV115.durationBase) ? playbackStateV115.durationBase : 850;
  const duration = durationBase / Math.max(.1, Number(speed)||1);
  const chunks=[];
  let stream, recorder, mime;
  try{
    renderSnapshotToExportCanvasV126(frames[0], true, exportMode);
    const ex = ensureExportCanvasForModeV126(exportMode);
    if(!ex.captureStream) throw new Error("captureStream unsupported");
    stream = ex.captureStream(30);
    mime = bestVideoMimeV121();
    try{
      recorder = mime ? new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond:4500000}) : new MediaRecorder(stream,{videoBitsPerSecond:4500000});
    }catch(e){
      recorder = new MediaRecorder(stream);
      mime = recorder.mimeType || "video/webm";
    }
    const stopped = new Promise((resolve,reject)=>{
      recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = e=>reject(e.error || e);
      recorder.onstop = resolve;
    });
    recorder.start(200);
    await sleepV120(250);
    for(let i=0;i<frames.length-1;i++){
      const from=frames[i], to=frames[i+1];
      const start=performance.now();
      await new Promise(resolve=>{
        function step(now){
          const t=Math.min(1,(now-start)/duration);
          const snap={objects:interpObjects(from.objects||[],to.objects||[],t), lines:to.lines||[]};
          renderSnapshotToExportCanvasV126(snap,true,exportMode);
          if(t>=1) resolve(); else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
      await sleepV120(120);
    }
    renderSnapshotToExportCanvasV126(frames[frames.length-1], true, exportMode);
    await sleepV120(350);
    recorder.stop();
    await stopped;
    if(!chunks.length) throw new Error("recorded chunks empty");
    return new Blob(chunks,{type:mime || recorder.mimeType || chunks[0].type || "video/webm"});
  }finally{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    objects=oldSnap.objects; lines=oldSnap.lines; mode=oldMode; syncMode?.(); setCanvasSize?.(); render?.();
  }
}

async function saveVideoV126(){
  if(exportingVideoV120) return;
  if(typeof MediaRecorder === "undefined"){
    alert("このブラウザは動画保存に対応していません。Safari/Chromeを最新版にしてください。");
    return;
  }
  const play = getSelectedPlayForExportV126();
  if(!play || !play.frames || play.frames.length < 2){
    alert("先にプレーを作成して保存し、保存プレーを選択してください。");
    return;
  }
  const base = safeFileNameV126(prompt("保存する動画名を入力してください", play.title || "tactics-board") || play.title || "tactics-board");
  const btn=$("saveVideoBtnV120"), shareBtn=$("sharePlayBtnV120");
  try{
    exportingVideoV120=true;
    if(btn) btn.disabled=true;
    if(shareBtn) shareBtn.disabled=true;
    pausePlaybackV115?.();
    setExportStatusV120(`動画を作成中です：${base}　画面を閉じずにお待ちください…`);
    const blob = await recordExportFramesV126(play, playbackStateV115?.speed || 1);
    const type = blob.type || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const name = `${base}.${ext}`;
    lastExportBlobV120=blob;
    lastExportFileNameV120=name;
    downloadBlobV120(blob,name);
    setExportStatusV120(`動画を保存しました：${name}　iPhoneで写真アプリへ入れる場合は「共有」→「ビデオを保存」を選んでください。`);
  }catch(err){
    console.error(err);
    alert("動画保存に失敗しました。GitHub Pages上でSafari/Chrome最新版を試してください。");
    setExportStatusV120("動画保存に失敗しました。画像保存は使えます。ブラウザの動画録画対応が原因の可能性があります。");
  }finally{
    exportingVideoV120=false;
    if(btn) btn.disabled=false;
    if(shareBtn) shareBtn.disabled=false;
  }
}

function renameSavedPlayV126(playId){
  const list = getSaved();
  const p = list.find(x=>x.id===playId);
  if(!p) return;
  const name = prompt("保存プレー名を変更", p.title || "");
  if(name === null) return;
  const title = name.trim();
  if(!title) return;
  p.title = title;
  setSaved(list);
  if(selectedPlayV125 && selectedPlayV125.id === playId){ selectedPlayV125.title = title; }
  if(selectedPlayDataV126 && selectedPlayDataV126.id === playId){ selectedPlayDataV126.title = title; }
  updateSelectedPlayPanelV125?.();
  renderSavedPlays?.();
  renderMoveLibraryV118?.();
}

function renameLibraryPlayV126(playId){
  const list = getMoveLibraryV118();
  const p = list.find(x=>x.id===playId);
  if(!p) return;
  const name = prompt("ライブラリ名を変更", p.title || "");
  if(name === null) return;
  const title = name.trim();
  if(!title) return;
  p.title = title;
  setMoveLibraryV118(list);
  if(selectedPlayV125 && selectedPlayV125.id === playId){ selectedPlayV125.title = title; }
  if(selectedPlayDataV126 && selectedPlayDataV126.id === playId){ selectedPlayDataV126.title = title; }
  updateSelectedPlayPanelV125?.();
  renderMoveLibraryV118?.();
  renderSavedPlays?.();
}

const playSavedBeforeV126 = playSaved;
playSaved = function(play){
  rememberSelectedPlayV126(play,"保存プレー");
  const r = playSavedBeforeV126(play);
  rememberSelectedPlayV126(play,"保存プレー");
  return r;
};

if(typeof loadLibraryPlayV118 === "function"){
  const loadLibraryBeforeV126 = loadLibraryPlayV118;
  loadLibraryPlayV118 = function(play){
    rememberSelectedPlayV126(play,"ムーブライブラリ");
    const r = loadLibraryBeforeV126(play);
    rememberSelectedPlayV126(play,"ムーブライブラリ");
    return r;
  };
}

// 表示だけ再構成：既存データ/鍵/削除仕様は維持し、✏️を追加
renderSavedPlays = function(){
  const box=$("savedPlayList");
  if(!box) return;
  box.innerHTML="";
  const list=getSaved();
  if(!list.length){
    box.innerHTML='<div class="saved-play-empty">保存プレーはありません</div>';
    updateSelectedPlayPanelV125?.();
    return;
  }
  list.forEach((p,idx)=>{
    const wrap=document.createElement("div");
    wrap.className="saved-play-wrap v126-layout" + (isSelectedPlayV125?.(p) ? " selected-play-active" : "");

    const fav=document.createElement("button");
    fav.className="favorite-play-btn" + (isInMoveLibraryV118(p.id) ? " registered" : "");
    fav.textContent=isInMoveLibraryV118(p.id) ? "★" : "☆";
    fav.title="ムーブライブラリに登録";
    fav.onclick=()=>{ isInMoveLibraryV118(p.id) ? removeFromMoveLibraryV118(p.id) : addToMoveLibraryV118(p); };

    const btn=document.createElement("button");
    btn.className="saved-play-btn";
    btn.textContent=p.title;
    btn.draggable=true;
    btn.onclick=()=>playSaved(p);
    btn.addEventListener("dragstart", e=>{
      draggingSavedPlayIdV118 = p.id;
      btn.classList.add("dragging");
      e.dataTransfer.setData("text/plain", p.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    btn.addEventListener("dragend", ()=>{ draggingSavedPlayIdV118=null; btn.classList.remove("dragging"); });

    const rename=document.createElement("button");
    rename.className="rename-play-btn-v126";
    rename.textContent="✏️";
    rename.title="名前変更";
    rename.onclick=()=>renameSavedPlayV126(p.id);

    const del=document.createElement("button");
    del.className="delete-play-btn";
    del.textContent="×";
    del.onclick=()=>{
      const n=getSaved();
      n.splice(idx,1);
      setSaved(n);
      renderSavedPlays();
    };

    wrap.appendChild(fav); wrap.appendChild(btn); wrap.appendChild(rename); wrap.appendChild(del);
    box.appendChild(wrap);
  });
  updateSelectedPlayPanelV125?.();
  renderMoveLibraryV118?.();
};

renderMoveLibraryV118 = function(){
  const box=$("moveLibraryList");
  if(!box) return;
  const list=getMoveLibraryV118();
  box.innerHTML="";
  if(!list.length){
    box.innerHTML='<div class="library-empty">保存プレーをここへドラッグ、または☆で登録できます。</div>';
    return;
  }
  list.forEach(play=>{
    const item=document.createElement("div");
    item.className="library-item v126-layout" + (isMoveLibraryLockedV122(play) ? " locked" : " unlocked") + (isSelectedPlayV125?.(play) ? " selected-play-active" : "");

    const load=document.createElement("button");
    load.className="library-load";
    load.textContent=play.title;
    load.onclick=()=>loadLibraryPlayV118(play);

    const rename=document.createElement("button");
    rename.className="library-rename-v126";
    rename.textContent="✏️";
    rename.title="ライブラリ名変更";
    rename.onclick=()=>renameLibraryPlayV126(play.id);

    const lock=document.createElement("button");
    lock.className="library-lock" + (isMoveLibraryLockedV122(play) ? " locked" : " unlocked");
    lock.textContent=isMoveLibraryLockedV122(play) ? "🔒" : "🔓";
    lock.title=isMoveLibraryLockedV122(play) ? "削除ロック中" : "削除ロック解除中";
    lock.onclick=()=>toggleMoveLibraryLockV122(play.id);

    const del=document.createElement("button");
    del.className="library-delete" + (isMoveLibraryLockedV122(play) ? " locked" : "");
    del.textContent="×";
    del.title=isMoveLibraryLockedV122(play) ? "鍵を開けると削除できます" : "ライブラリから削除";
    del.disabled=isMoveLibraryLockedV122(play);
    del.onclick=()=>removeFromMoveLibraryV118(play.id);

    item.appendChild(load); item.appendChild(rename); item.appendChild(lock); item.appendChild(del);
    box.appendChild(item);
  });
};

setTimeout(()=>{
  const vid=$("saveVideoBtnV120");
  if(vid) vid.onclick=saveVideoV126;
  const share=$("sharePlayBtnV120");
  if(share) share.onclick=sharePlayV121;
  setExportStatusV120("v12.6：動画は画面と同じコート画像で保存。動画名・保存プレー名・ライブラリ名を変更できます。iPhoneは共有→ビデオを保存。");
  renderSavedPlays?.();
  renderMoveLibraryV118?.();
}, 1200);


/* v12.7 文字サイズ自動調整：長い名前も枠内に収める */
function fitTextInsideButtonV127(btn, maxPx=18, minPx=10){
  if(!btn) return;
  btn.classList.add('fit-text-v127');
  btn.style.fontSize = maxPx + 'px';
  // 描画後に横幅を見て縮小
  requestAnimationFrame(()=>{
    let size = maxPx;
    const limit = Math.max(20, btn.clientWidth - 8);
    while(size > minPx && btn.scrollWidth > limit){
      size -= 1;
      btn.style.fontSize = size + 'px';
    }
  });
}
function fitAllNamesV127(){
  document.querySelectorAll('#halfPositionList .load, #fullPositionList .load').forEach(btn=>fitTextInsideButtonV127(btn, 14, 9));
  document.querySelectorAll('#savedPlayList .saved-play-btn').forEach(btn=>fitTextInsideButtonV127(btn, 15, 10));
  document.querySelectorAll('#moveLibraryList .library-load').forEach(btn=>fitTextInsideButtonV127(btn, 15, 10));
}

(function installFitTextV127(){
  const wrap = (name)=>{
    try{
      const oldFn = window[name] || eval('typeof '+name+' !== "undefined" ? '+name+' : null');
      if(typeof oldFn !== 'function' || oldFn.__fitWrappedV127) return;
      const wrapped = function(...args){
        const result = oldFn.apply(this,args);
        setTimeout(fitAllNamesV127, 0);
        setTimeout(fitAllNamesV127, 120);
        return result;
      };
      wrapped.__fitWrappedV127 = true;
      try{ window[name] = wrapped; }catch(e){}
      try{ eval(name + ' = wrapped'); }catch(e){}
    }catch(e){}
  };
  wrap('renderPositions');
  wrap('renderSavedPlays');
  wrap('renderMoveLibraryV118');
  wrap('renderMoveLibraryV122');
  wrap('renderMoveLibrary');
  setTimeout(fitAllNamesV127, 300);
  setTimeout(fitAllNamesV127, 1000);
})();

/* v12.8 名前表示の自動フィット（保存プレー・ムーブライブラリ） */
function fitPlayNameButtonsV128(){
  const targets = document.querySelectorAll('.saved-play-btn, .library-load');
  targets.forEach(btn=>{
    btn.style.fontSize = '';
    let size = parseFloat(getComputedStyle(btn).fontSize) || 15;
    let guard = 0;
    while(btn.scrollWidth > btn.clientWidth && size > 10 && guard < 12){
      size -= 1;
      btn.style.fontSize = size + 'px';
      guard++;
    }
  });
}
(function installFitHookV128(){
  const hook = (name)=>{
    const old = window[name] || (typeof globalThis[name] === 'function' ? globalThis[name] : null);
    if(typeof old !== 'function') return;
    const wrapped = function(...args){
      const result = old.apply(this,args);
      setTimeout(fitPlayNameButtonsV128, 0);
      setTimeout(fitPlayNameButtonsV128, 80);
      return result;
    };
    try{ eval(name + ' = wrapped'); }catch(e){ try{ window[name] = wrapped; }catch(_){} }
  };
  hook('renderSavedPlays');
  hook('renderMoveLibraryV118');
  window.addEventListener('load', ()=>setTimeout(fitPlayNameButtonsV128, 300));
  window.addEventListener('resize', ()=>setTimeout(fitPlayNameButtonsV128, 100));
  setTimeout(fitPlayNameButtonsV128, 500);
})();

/* v12.9 ライブラリ操作ボタン小型化＋ドラッグ順番変更
   - ムーブライブラリ内の項目をドラッグして順番変更
   - 既存の保存プレー→ライブラリ登録は維持
*/
let draggingLibraryPlayIdV129 = null;
let dragOverLibraryPlayIdV129 = null;
let dragOverLibrarySideV129 = null;

function moveLibraryItemV129(fromId, toId, side){
  if(!fromId || !toId || fromId === toId) return;
  const list = getMoveLibraryV118();
  const fromIndex = list.findIndex(x => x.id === fromId);
  const toIndexRaw = list.findIndex(x => x.id === toId);
  if(fromIndex < 0 || toIndexRaw < 0) return;

  const [moved] = list.splice(fromIndex, 1);
  let toIndex = list.findIndex(x => x.id === toId);
  if(side === 'after') toIndex += 1;
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, moved);
  setMoveLibraryV118(list);
}

function moveLibraryItemToEndV129(fromId){
  if(!fromId) return;
  const list = getMoveLibraryV118();
  const fromIndex = list.findIndex(x => x.id === fromId);
  if(fromIndex < 0) return;
  const [moved] = list.splice(fromIndex, 1);
  list.push(moved);
  setMoveLibraryV118(list);
}

function clearLibraryDropMarksV129(){
  document.querySelectorAll('.library-drop-before-v129,.library-drop-after-v129').forEach(el=>{
    el.classList.remove('library-drop-before-v129','library-drop-after-v129');
  });
}

const renderMoveLibraryBeforeV129 = typeof renderMoveLibraryV118 === 'function' ? renderMoveLibraryV118 : null;
renderMoveLibraryV118 = function(){
  const box = $('moveLibraryList');
  if(!box || typeof getMoveLibraryV118 !== 'function'){
    if(renderMoveLibraryBeforeV129) return renderMoveLibraryBeforeV129();
    return;
  }

  const list = getMoveLibraryV118();
  box.innerHTML = '';

  if(!list.length){
    box.innerHTML = '<div class="library-empty">保存プレーをここへドラッグ、または☆で登録できます。</div>';
    return;
  }

  const hint = document.createElement('div');
  hint.className = 'library-reorder-hint-v129';
  hint.textContent = 'ドラッグで順番変更できます';
  box.appendChild(hint);

  list.forEach(play=>{
    const item = document.createElement('div');
    item.className =
      'library-item v126-layout' +
      (isMoveLibraryLockedV122(play) ? ' locked' : ' unlocked') +
      (isSelectedPlayV125(play) ? ' selected-play-active' : '');
    item.draggable = true;
    item.dataset.playId = play.id;

    const load = document.createElement('button');
    load.className = 'library-load';
    load.textContent = play.title || '無題プレー';
    load.onclick = ()=>loadLibraryPlayV118(play);

    const rename = document.createElement('button');
    rename.className = 'library-rename-v126';
    rename.textContent = '✎';
    rename.title = '名前変更';
    rename.onclick = (e)=>{
      e.stopPropagation();
      const next = prompt('ライブラリ名を変更', play.title || '');
      if(!next || !next.trim()) return;
      updateMoveLibraryItemV122(play.id, {title: next.trim()});
      if(selectedPlayV125 && selectedPlayV125.id === play.id){
        selectedPlayV125.title = next.trim();
        updateSelectedPlayPanelV125?.();
      }
      renderMoveLibraryV118();
    };

    const lock = document.createElement('button');
    lock.className = 'library-lock' + (isMoveLibraryLockedV122(play) ? ' locked' : ' unlocked');
    lock.textContent = isMoveLibraryLockedV122(play) ? '🔒' : '🔓';
    lock.title = isMoveLibraryLockedV122(play) ? '削除ロック中' : '削除ロック解除中';
    lock.onclick = (e)=>{ e.stopPropagation(); toggleMoveLibraryLockV122(play.id); };

    const del = document.createElement('button');
    del.className = 'library-delete' + (isMoveLibraryLockedV122(play) ? ' locked' : '');
    del.textContent = '×';
    del.title = isMoveLibraryLockedV122(play) ? '鍵を開けると削除できます' : 'ライブラリから削除';
    del.disabled = isMoveLibraryLockedV122(play);
    del.onclick = (e)=>{ e.stopPropagation(); removeFromMoveLibraryV118(play.id); };

    item.addEventListener('dragstart', e=>{
      draggingLibraryPlayIdV129 = play.id;
      item.classList.add('library-dragging-v129');
      e.dataTransfer.setData('application/x-library-play-id', play.id);
      e.dataTransfer.setData('text/plain', 'library:' + play.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', ()=>{
      draggingLibraryPlayIdV129 = null;
      dragOverLibraryPlayIdV129 = null;
      dragOverLibrarySideV129 = null;
      clearLibraryDropMarksV129();
      item.classList.remove('library-dragging-v129');
    });

    item.addEventListener('dragover', e=>{
      if(!draggingLibraryPlayIdV129 || draggingLibraryPlayIdV129 === play.id) return;
      e.preventDefault();
      clearLibraryDropMarksV129();
      const rect = item.getBoundingClientRect();
      const side = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
      dragOverLibraryPlayIdV129 = play.id;
      dragOverLibrarySideV129 = side;
      item.classList.add(side === 'after' ? 'library-drop-after-v129' : 'library-drop-before-v129');
      e.dataTransfer.dropEffect = 'move';
    });

    item.addEventListener('drop', e=>{
      if(!draggingLibraryPlayIdV129) return;
      e.preventDefault();
      e.stopPropagation();
      moveLibraryItemV129(draggingLibraryPlayIdV129, play.id, dragOverLibrarySideV129 || 'before');
      draggingLibraryPlayIdV129 = null;
      dragOverLibraryPlayIdV129 = null;
      dragOverLibrarySideV129 = null;
      clearLibraryDropMarksV129();
      renderMoveLibraryV118();
    });

    item.appendChild(load);
    item.appendChild(rename);
    item.appendChild(lock);
    item.appendChild(del);
    box.appendChild(item);
  });

  setTimeout(()=>{
    if(typeof fitPlayNameButtonsV128 === 'function') fitPlayNameButtonsV128();
    if(typeof fitAllNamesV127 === 'function') fitAllNamesV127();
  },0);
};

(function installLibraryDropEndV129(){
  setTimeout(()=>{
    const drop = $('moveLibraryDrop');
    if(!drop) return;
    drop.addEventListener('dragover', e=>{
      if(draggingLibraryPlayIdV129){
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    }, true);
    drop.addEventListener('drop', e=>{
      if(!draggingLibraryPlayIdV129) return;
      e.preventDefault();
      e.stopPropagation();
      moveLibraryItemToEndV129(draggingLibraryPlayIdV129);
      draggingLibraryPlayIdV129 = null;
      clearLibraryDropMarksV129();
      renderMoveLibraryV118();
    }, true);
    renderMoveLibraryV118();
  }, 300);
})();

/* v13.1 Smart Defense AI
   - 他機能はそのまま
   - DボタンON時の表示専用ディフェンスを賢く変更
   - ボール位置・リング・ボールサイド・ヘルプサイド・ドライブラインを見て配置
   - 保存データ本体にはDFを混ぜない
*/
function clampV131(v,min,max){ return Math.max(min, Math.min(max, v)); }
function lerpPointV131(a,b,t){ return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t}; }
function distV131(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }
function normV131(dx,dy){ const l=Math.hypot(dx,dy)||1; return {x:dx/l,y:dy/l}; }
function hoopForV131(o,courtMode){
  if(courtMode === 'half') return {x:375,y:78};
  return (o.x < 700) ? {x:78,y:375} : {x:1322,y:375};
}
function courtBoundsV131(courtMode){ return courtMode === 'half' ? {w:750,h:700} : {w:1400,h:750}; }
function ballSideScoreV131(player, ball, hoop){
  if(!ball) return 9999;
  // ボールに近く、ボールとリングを結ぶ線に近い選手ほどボールサイド扱い
  const vx = hoop.x - ball.x, vy = hoop.y - ball.y;
  const wx = player.x - ball.x, wy = player.y - ball.y;
  const len = Math.hypot(vx,vy) || 1;
  const cross = Math.abs(vx*wy - vy*wx) / len;
  return distV131(player, ball) + cross * 0.55;
}
function projectHelpPointV131(player, ball, hoop, courtMode){
  const b = courtBoundsV131(courtMode);
  const paint = courtMode === 'half'
    ? {x:375,y:210}
    : (player.x < 700 ? {x:190,y:375} : {x:1210,y:375});
  // ヘルプサイドはリングとペイント寄りに下げる。ただし完全に捨てない。
  const towardPaint = lerpPointV131(player, paint, 0.46);
  const towardHoop = lerpPointV131(player, hoop, 0.18);
  const x = (towardPaint.x + towardHoop.x) / 2;
  const y = (towardPaint.y + towardHoop.y) / 2;
  return {x:clampV131(x, 22, b.w-22), y:clampV131(y, 22, b.h-22)};
}
function isDrivingLikeV131(player, ball, hoop){
  if(!ball) return false;
  // ボールが選手近く、選手/ボールがリングへ近づいている位置ならドライブ寄りに判断
  const closeBall = distV131(player, ball) < 80;
  const closeToPaint = distV131(player, hoop) < (hoop.x===375 ? 390 : 520);
  return closeBall && closeToPaint;
}
function computeDefenseObjectsV130(sourceObjects, courtMode){
  const src = (sourceObjects || []).filter(o => o && o.t !== 'd');
  const ball = src.find(o => o.t === 'b');
  const offensePlayers = src.filter(o => o.t === 'o');
  if(!offensePlayers.length) return [];

  const ballOwner = ball
    ? offensePlayers.slice().sort((a,b)=>distV131(a,ball)-distV131(b,ball))[0]
    : offensePlayers[0];
  const hoop = hoopForV131(ballOwner || offensePlayers[0], courtMode);
  const b = courtBoundsV131(courtMode);
  const driving = ballOwner && isDrivingLikeV131(ballOwner, ball, hoop);

  return offensePlayers.map((o,idx)=>{
    const playerHoop = hoopForV131(o, courtMode);
    const idNum = Number(o.id || idx+1);
    let target;

    if(ball && ballOwner && o.id === ballOwner.id){
      // ボールマンDF：ゴールとボールの間。近い時ほどプレッシャー。
      const pressure = distV131(o, playerHoop) < 260 ? 0.16 : 0.21;
      target = lerpPointV131(o, playerHoop, pressure);
      // 少しボールライン外側にずらし、OFと重なりにくくする。
      const n = normV131(playerHoop.x - o.x, playerHoop.y - o.y);
      const side = idNum % 2 === 0 ? 1 : -1;
      target.x += -n.y * 12 * side;
      target.y += n.x * 12 * side;
    }else{
      const score = ballSideScoreV131(o, ball, hoop);
      const nearBall = ball && distV131(o, ball) < 330;
      const passLane = ball ? lerpPointV131(o, ball, 0.34) : lerpPointV131(o, playerHoop, 0.28);
      const help = projectHelpPointV131(o, ball, playerHoop, courtMode);

      if(driving && ballOwner){
        const driveLine = lerpPointV131(ballOwner, playerHoop, 0.45);
        const helpDistance = distV131(o, driveLine);
        if(helpDistance < 360 || score < 520){
          // ドライブ時：近いDFはヘルプ位置へ早めに寄る
          target = lerpPointV131(o, driveLine, helpDistance < 260 ? 0.52 : 0.38);
        }else{
          target = help;
        }
      }else if(nearBall || score < 430){
        // ボールサイド：パスコースを消す位置
        target = lerpPointV131(passLane, playerHoop, 0.16);
      }else{
        // ヘルプサイド：ペイント寄りに下げる
        target = help;
      }

      // マークマンを完全には離しすぎない
      target = lerpPointV131(target, o, 0.18);
    }

    // 重なり防止：各DFを少しずつ横へ逃がす
    const n2 = normV131(playerHoop.x - o.x, playerHoop.y - o.y);
    const side2 = idNum % 2 === 0 ? 1 : -1;
    target.x += -n2.y * (12 + (idx%3)*5) * side2;
    target.y += n2.x * (12 + (idx%3)*5) * side2;

    const d = X('X' + o.id, clampV131(target.x, 18, b.w-18), clampV131(target.y, 18, b.h-18));
    d.ai = 'smart';
    return d;
  });
}

function displayObjectsV130(sourceObjects, courtMode){
  const base = (sourceObjects || []).filter(o => o && o.t !== 'd');
  if(!defenseVisible) return base;
  return base.concat(computeDefenseObjectsV130(base, courtMode || mode));
}

function stripDefenseFromLiveObjectsV130(){
  objects = (objects || []).filter(o => o && o.t !== 'd');
}

applyDefense = function(){ stripDefenseFromLiveObjectsV130(); render(); };
removeDefense = function(){ stripDefenseFromLiveObjectsV130(); render(); };

function toggleDefenseV130(){
  defenseVisible = !defenseVisible;
  stripDefenseFromLiveObjectsV130();
  syncDefenseBtn();
  render();
}

setTimeout(()=>{
  const d = $('defenseFloatBtn');
  if(d) d.onclick = toggleDefenseV130;
  syncDefenseBtn();
}, 900);

snapShot = function(){
  return { objects: clone((objects || []).filter(o => o && o.t !== 'd')), lines: clone(lines || []) };
};

render = function(){
  drawCourt();
  ensureLineMeta();
  const visibleLines = (lines || []).filter(l => !l.hidden);
  visibleLines.forEach((l,i)=>{ l.alpha = i===visibleLines.length-1 ? 1 : i===visibleLines.length-2 ? .35 : .18; drawLine(l); });
  displayObjectsV130(objects, mode).forEach(drawObj);
  visibleLines.forEach((l,i)=>{
    const m=lineMid(l);
    ctx.save();
    ctx.globalAlpha=1;
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(m.x,m.y,11,0,Math.PI*2); ctx.fill();
    if(inlineTargetLine && inlineTargetLine.__id===l.__id){ ctx.strokeStyle='#f4b43a'; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(m.x,m.y,16,0,Math.PI*2); ctx.stroke(); }
    ctx.fillStyle='#111'; ctx.font='bold 11px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(getLineNo(l,i+1)),m.x,m.y);
    ctx.restore();
  });
};

if(typeof loadPlaybackFrameV115 === 'function'){
  loadPlaybackFrameV115 = function(frame){
    objects = clone((frame.objects || []).filter(o => o && o.t !== 'd'));
    lines = clone(frame.lines || []);
    render();
  };
}

if(typeof renderSnapshotToExportCanvasV126 === 'function'){
  renderSnapshotToExportCanvasV126 = function(snapshot, drawStepNumbers=true, exportMode){
    const m = exportMode || selectedModeV126?.() || mode;
    const ex = ensureExportCanvasForModeV126(m);
    const c = ex.getContext('2d');
    c.clearRect(0,0,ex.width,ex.height);
    const img = m === 'half' ? halfImg : fullImg;
    if(img.complete && img.naturalWidth) c.drawImage(img,0,0,ex.width,ex.height);
    else { c.fillStyle = '#e2aa56'; c.fillRect(0,0,ex.width,ex.height); }
    const visibleLines = (snapshot.lines || []).filter(l => !l.hidden);
    visibleLines.forEach(line=>drawLineExportV121(c,line));
    displayObjectsV130(snapshot.objects || [], m).forEach(o=>drawObjExportV121(c,o));
    if(drawStepNumbers){
      visibleLines.forEach((l,i)=>{ const mid=lineMid(l); c.save(); c.fillStyle='#fff'; c.beginPath(); c.arc(mid.x,mid.y,11,0,Math.PI*2); c.fill(); c.fillStyle='#111'; c.font='bold 11px system-ui'; c.textAlign='center'; c.textBaseline='middle'; c.fillText(String(getLineNo(l,i+1)),mid.x,mid.y); c.restore(); });
    }
    return ex;
  };
}

const setModeBeforeV130 = setMode;
setMode = function(m){
  const keepDefense = defenseVisible;
  setModeBeforeV130(m);
  defenseVisible = keepDefense;
  stripDefenseFromLiveObjectsV130();
  syncDefenseBtn();
  render();
};

setTimeout(()=>{
  if($('exportStatusV120')) setExportStatusV120('v13.1：スマートDF採用。ボールマン・パスコース・ヘルプ・ドライブヘルプを見て動きます。');
  render();
}, 1000);


/* v13.2 再生速度を0.1〜1.5倍で完全連動
   - 再生ボタンの速度選択を拡張
   - 通常再生・動画保存・スマートDF追従に同じ倍率を使用
*/
const SPEED_OPTIONS_V132 = [0.1,0.25,0.5,0.75,1,1.25,1.5];

function nearestSpeedV132(v){
  const n = Number(v) || 1;
  return SPEED_OPTIONS_V132.reduce((best,x)=>Math.abs(x-n)<Math.abs(best-n)?x:best,1);
}

const setSpeedBeforeV132 = typeof setSpeedV115 === 'function' ? setSpeedV115 : null;
setSpeedV115 = function(speed){
  const fixed = nearestSpeedV132(speed);
  if(playbackStateV115) playbackStateV115.speed = fixed;
  document.querySelectorAll('.speed-row button').forEach(b=>{
    const active = Number(b.dataset.speed) === fixed;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if($('exportStatusV120')){
    setExportStatusV120(`再生速度：${fixed}倍　動画保存にも同じ速度を反映します。`);
  }
};

setTimeout(()=>{
  document.querySelectorAll('.speed-row button').forEach(btn=>{
    btn.onclick = ()=>setSpeedV115(btn.dataset.speed);
  });
  setSpeedV115(playbackStateV115?.speed || 1);
  if($('exportStatusV120')) setExportStatusV120('v13.2：再生速度を0.1〜1.5倍で選択可能。動画保存・スマートDFにも同じ速度を反映します。');
}, 1200);


/* v13.3 Premium Canvas Rendering - 機能はそのまま、見た目のみ強化 */
(function(){
  function premiumHead(x1,y1,x2,y2,col){
    const a=Math.atan2(y2-y1,x2-x1),s=18;
    ctx.save();
    ctx.fillStyle=col;
    ctx.shadowColor=col;
    ctx.shadowBlur=10;
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-s*Math.cos(a-Math.PI/6),y2-s*Math.sin(a-Math.PI/6));
    ctx.lineTo(x2-s*Math.cos(a+Math.PI/6),y2-s*Math.sin(a+Math.PI/6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  window.drawLine = drawLine = function(l){
    if(l && l.hidden) return;
    ctx.save();
    ctx.globalAlpha = l.alpha ?? 1;
    const palette = {
      pass:{col:'#ef334e', dash:[15,10], width:5},
      shoot:{col:'#2f7cff', dash:[15,10], width:5},
      moveLine:{col:'#1fd18a', dash:[15,10], width:5},
      drive:{col:'#8d99a8', dash:null, width:6}
    };
    if(l.k === 'drive'){
      const pts = zig(l);
      ctx.strokeStyle = '#7c8796';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(15,23,42,.32)';
      ctx.shadowBlur = 7;
      ctx.beginPath();
      pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.stroke();
      premiumHead(pts.at(-2).x,pts.at(-2).y,l.x2,l.y2,'#7c8796');
      ctx.restore();
      return;
    }
    const p = palette[l.k] || palette.moveLine;
    ctx.strokeStyle = p.col;
    ctx.lineWidth = p.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = p.col;
    ctx.shadowBlur = 8;
    if(p.dash) ctx.setLineDash(p.dash);
    ctx.beginPath();
    ctx.moveTo(l.x1,l.y1);
    ctx.lineTo(l.x2,l.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    premiumHead(l.x1,l.y1,l.x2,l.y2,p.col);
    ctx.restore();
  };

  window.drawObj = drawObj = function(o){
    const r=o.t==='b'?20:(o.t==='d'?22:26);
    const colors = o.t==='o'
      ? {a:'#ff405d',b:'#c8122f',stroke:'#ffffff'}
      : o.t==='d'
        ? {a:'#4285ff',b:'#0f4fd8',stroke:'#dbeafe'}
        : {a:'#ffb24a',b:'#d46413',stroke:'#111827'};
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.38)';
    ctx.shadowBlur=10;
    ctx.shadowOffsetY=3;
    ctx.beginPath();
    ctx.arc(o.x,o.y,r,0,Math.PI*2);
    const g=ctx.createRadialGradient(o.x-r*.35,o.y-r*.45,r*.1,o.x,o.y,r*1.15);
    g.addColorStop(0,'#ffffff');
    g.addColorStop(.08,colors.a);
    g.addColorStop(1,colors.b);
    ctx.fillStyle=g;
    ctx.fill();
    ctx.shadowBlur=0;
    ctx.lineWidth=o.t==='b'?3:3.5;
    ctx.strokeStyle=colors.stroke;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(o.x,o.y,r-5,Math.PI*1.1,Math.PI*1.65);
    ctx.strokeStyle='rgba(255,255,255,.32)';
    ctx.lineWidth=3;
    ctx.stroke();
    if(o.id===selectedId){
      ctx.strokeStyle='#f7c85f';
      ctx.lineWidth=5;
      ctx.shadowColor='#f7c85f';
      ctx.shadowBlur=12;
      ctx.beginPath();
      ctx.arc(o.x,o.y,r+8,0,Math.PI*2);
      ctx.stroke();
    }
    ctx.shadowBlur=0;
    ctx.fillStyle='#fff';
    ctx.font=o.t==='d' ? '1000 14px system-ui' : '1000 18px system-ui';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    if(o.t==='b'){
      ctx.font='24px system-ui';
      ctx.fillText('🏀',o.x,o.y+1);
    }else{
      ctx.fillText(o.id,o.x,o.y+1);
    }
    ctx.restore();
  };

  if(typeof render === 'function'){
    const oldRender = render;
    window.render = render = function(){ oldRender(); };
    setTimeout(()=>render(),80);
  }
})();

/* v13.4 サムネイル対応：動画の上部にプレー名ヘッダーを入れる
   - スマホの写真アプリで真っ黒サムネになりにくいよう、録画開始時にタイトル付き1枚目を長めに保持
   - 通常画面・作成・再生・保存プレー・ライブラリ機能は変更なし
*/
let exportVideoCanvasV134 = null;
let exportVideoCtxV134 = null;

function headerHeightV134(m){
  return m === 'full' ? 118 : 96;
}

function ensureVideoExportCanvasV134(m){
  const court = exportSizeForModeV126 ? exportSizeForModeV126(m) : (m === 'full' ? {w:1400,h:750} : {w:750,h:700});
  const headerH = headerHeightV134(m);
  if(!exportVideoCanvasV134) exportVideoCanvasV134 = document.createElement('canvas');
  exportVideoCanvasV134.width = court.w;
  exportVideoCanvasV134.height = court.h + headerH;
  exportVideoCtxV134 = exportVideoCanvasV134.getContext('2d');
  return exportVideoCanvasV134;
}

function fitTextV134(ctx, text, maxWidth, startSize, minSize){
  let size = startSize;
  while(size > minSize){
    ctx.font = `900 ${size}px system-ui,-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif`;
    if(ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function drawVideoHeaderV134(ctx, w, h, title, source, speed){
  const safeTitle = String(title || 'Tactics Board').trim() || 'Tactics Board';
  const grad = ctx.createLinearGradient(0,0,w,h);
  grad.addColorStop(0,'#08111f');
  grad.addColorStop(.55,'#0f1f35');
  grad.addColorStop(1,'#16263b');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);

  // subtle court/app accent line
  ctx.fillStyle = '#f4b43a';
  ctx.fillRect(0,h-6,w,6);
  ctx.globalAlpha = .16;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(w-90, h/2, h*.52, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const pad = Math.max(24, Math.round(w*.035));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const titleSize = fitTextV134(ctx, safeTitle, w - pad*2 - 130, h > 105 ? 44 : 34, 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${titleSize}px system-ui,-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif`;
  ctx.fillText(safeTitle, pad, h*.42);

  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = `800 ${h > 105 ? 17 : 14}px system-ui,-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif`;
  const meta = `${source || 'PLAY'}  /  ${speed || 1}x  /  NINJA Tactics Board`;
  ctx.fillText(meta, pad, h*.73);

  // badge
  const badge = 'PLAY';
  ctx.font = `900 ${h > 105 ? 18 : 15}px system-ui`;
  const bw = ctx.measureText(badge).width + 34;
  const bh = h > 105 ? 38 : 32;
  const bx = w - pad - bw;
  const by = Math.round(h*.36 - bh/2);
  ctx.fillStyle = 'rgba(244,180,58,.95)';
  roundRectV134(ctx,bx,by,bw,bh,16,true,false);
  ctx.fillStyle = '#10141c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge,bx+bw/2,by+bh/2+1);
}

function roundRectV134(ctx,x,y,w,h,r,fill,stroke){
  const rr = Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.lineTo(x+w-rr,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
  ctx.lineTo(x+w,y+h-rr);
  ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
  ctx.lineTo(x+rr,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
  ctx.lineTo(x,y+rr);
  ctx.quadraticCurveTo(x,y,x+rr,y);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

function renderSnapshotToExportVideoCanvasV134(snapshot, drawStepNumbers=true, exportMode, playTitle='', source='', speed=1){
  const m = exportMode || selectedModeV126?.() || mode;
  const ex = ensureVideoExportCanvasV134(m);
  const c = exportVideoCtxV134 || ex.getContext('2d');
  const headerH = headerHeightV134(m);
  const court = exportSizeForModeV126 ? exportSizeForModeV126(m) : {w:ex.width,h:ex.height-headerH};

  c.clearRect(0,0,ex.width,ex.height);
  drawVideoHeaderV134(c, ex.width, headerH, playTitle, source, speed);

  c.save();
  c.translate(0,headerH);
  const img = m === 'half' ? halfImg : fullImg;
  if(img && img.complete && img.naturalWidth) c.drawImage(img,0,0,court.w,court.h);
  else if(typeof drawCourtVectorV121 === 'function') drawCourtVectorV121(c,court.w,court.h,m);
  else { c.fillStyle = '#e2aa56'; c.fillRect(0,0,court.w,court.h); }

  const visibleLines = (snapshot.lines || []).filter(l => !l.hidden);
  visibleLines.forEach((l,i)=>{
    const line = {...l, alpha: i===visibleLines.length-1 ? 1 : i===visibleLines.length-2 ? .35 : .18};
    drawLineExportV121(c,line);
  });
  const objs = (typeof displayObjectsV130 === 'function') ? displayObjectsV130(snapshot.objects || [], m) : (snapshot.objects || []);
  objs.forEach(o=>drawObjExportV121(c,o));

  if(drawStepNumbers){
    visibleLines.forEach((l,i)=>{
      const mid = lineMid(l);
      c.save();
      c.fillStyle='#fff';
      c.beginPath();
      c.arc(mid.x,mid.y,12,0,Math.PI*2);
      c.fill();
      c.fillStyle='#111';
      c.font='900 11px system-ui';
      c.textAlign='center';
      c.textBaseline='middle';
      c.fillText(String(getLineNo(l,i+1)),mid.x,mid.y);
      c.restore();
    });
  }
  c.restore();
  return ex;
}

async function recordExportFramesV134(play, speed=1){
  const frames = clone(play.frames || []);
  const exportMode = play.mode || 'half';
  const playTitle = play.title || selectedPlayV125?.title || 'Tactics Board';
  const source = selectedPlaySourceV126 || selectedPlayV125?.source || '保存プレー';
  const oldSnap = currentSnapshotV121 ? currentSnapshotV121() : {objects:clone(objects), lines:clone(lines)};
  const oldMode = mode;
  const durationBase = (playbackStateV115 && playbackStateV115.durationBase) ? playbackStateV115.durationBase : 850;
  const duration = durationBase / Math.max(.1, Number(speed)||1);
  const chunks=[];
  let stream, recorder, mime;
  try{
    renderSnapshotToExportVideoCanvasV134(frames[0], true, exportMode, playTitle, source, speed);
    const ex = ensureVideoExportCanvasV134(exportMode);
    if(!ex.captureStream) throw new Error('captureStream unsupported');
    stream = ex.captureStream(30);
    mime = bestVideoMimeV121 ? bestVideoMimeV121() : '';
    try{
      recorder = mime ? new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond:5000000}) : new MediaRecorder(stream,{videoBitsPerSecond:5000000});
    }catch(e){
      recorder = new MediaRecorder(stream);
      mime = recorder.mimeType || 'video/webm';
    }
    const stopped = new Promise((resolve,reject)=>{
      recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = e=>reject(e.error || e);
      recorder.onstop = resolve;
    });
    recorder.start(200);

    // サムネイル対策：最初のタイトル付きフレームを長めに録画する
    await sleepV120(1500);

    for(let i=0;i<frames.length-1;i++){
      const from=frames[i], to=frames[i+1];
      const start=performance.now();
      await new Promise(resolve=>{
        function step(now){
          const t=Math.min(1,(now-start)/duration);
          const snap={objects:interpObjects(from.objects||[],to.objects||[],t), lines:to.lines||[]};
          renderSnapshotToExportVideoCanvasV134(snap,true,exportMode,playTitle,source,speed);
          if(t>=1) resolve(); else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
      await sleepV120(120);
    }
    renderSnapshotToExportVideoCanvasV134(frames[frames.length-1], true, exportMode, playTitle, source, speed);
    await sleepV120(550);
    recorder.stop();
    await stopped;
    if(!chunks.length) throw new Error('recorded chunks empty');
    return new Blob(chunks,{type:mime || recorder.mimeType || chunks[0].type || 'video/webm'});
  }finally{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    objects=oldSnap.objects; lines=oldSnap.lines; mode=oldMode; syncMode?.(); setCanvasSize?.(); render?.();
  }
}

// v13.4: 動画保存だけタイトル付きヘッダー版に差し替え
if(typeof saveVideoV126 === 'function'){
  saveVideoV126 = async function(){
    if(exportingVideoV120) return;
    if(typeof MediaRecorder === 'undefined'){
      alert('このブラウザは動画保存に対応していません。Safari/Chromeを最新版にしてください。');
      return;
    }
    const play = getSelectedPlayForExportV126();
    if(!play || !play.frames || play.frames.length < 2){
      alert('先にプレーを作成して保存し、保存プレーを選択してください。');
      return;
    }
    const base = safeFileNameV126(prompt('保存する動画名を入力してください', play.title || 'tactics-board') || play.title || 'tactics-board');
    play.title = base || play.title || 'Tactics Board';
    const btn=$('saveVideoBtnV120'), shareBtn=$('sharePlayBtnV120');
    try{
      exportingVideoV120=true;
      if(btn) btn.disabled=true;
      if(shareBtn) shareBtn.disabled=true;
      pausePlaybackV115?.();
      setExportStatusV120(`動画を作成中です：${base}　上部にプレー名を入れてサムネイル対応しています…`);
      const blob = await recordExportFramesV134(play, playbackStateV115?.speed || 1);
      const type = blob.type || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${base}.${ext}`;
      lastExportBlobV120=blob;
      lastExportFileNameV120=name;
      downloadBlobV120(blob,name);
      setExportStatusV120(`動画を保存しました：${name}　上部にプレー名入り。iPhoneは共有→「ビデオを保存」で写真アプリへ入れられます。`);
    }catch(err){
      console.error(err);
      alert('動画保存に失敗しました。GitHub Pages上でSafari/Chrome最新版を試してください。');
      setExportStatusV120('動画保存に失敗しました。画像保存は使えます。ブラウザの動画録画対応が原因の可能性があります。');
    }finally{
      exportingVideoV120=false;
      if(btn) btn.disabled=false;
      if(shareBtn) shareBtn.disabled=false;
    }
  };
  const vid=$('saveVideoBtnV120');
  if(vid) vid.onclick = saveVideoV126;
}

if($('exportStatusV120')){
  setExportStatusV120('v13.4：動画の上部にプレー名を表示。スマホ保存時のサムネイルで判別しやすくしました。');
}

/* v13.5 コート上部に選択中プレー名を表示
   - 名前変更ボタンなどの修正機能は追加しない
   - 保存プレー/ムーブライブラリを再生・選択した時だけ表示
*/
function ensureCourtPlayTitleV135(){
  let box = document.getElementById('courtPlayTitleV135');
  if(box) return box;
  const area = document.getElementById('courtArea');
  if(!area) return null;
  box = document.createElement('div');
  box.id = 'courtPlayTitleV135';
  box.className = 'court-play-title-v135';
  box.innerHTML = '<div class="court-play-title-main" id="courtPlayTitleMainV135"></div><div class="court-play-title-sub" id="courtPlayTitleSubV135"></div>';
  area.appendChild(box);
  return box;
}
function updateCourtPlayTitleV135(){
  const box = ensureCourtPlayTitleV135();
  if(!box) return;
  const main = document.getElementById('courtPlayTitleMainV135');
  const sub = document.getElementById('courtPlayTitleSubV135');
  const title = (typeof selectedPlayV125 !== 'undefined' && selectedPlayV125 && selectedPlayV125.title)
    || (typeof selectedPlayDataV126 !== 'undefined' && selectedPlayDataV126 && selectedPlayDataV126.title)
    || '';
  const source = (typeof selectedPlayV125 !== 'undefined' && selectedPlayV125 && selectedPlayV125.source)
    || (typeof selectedPlaySourceV126 !== 'undefined' && selectedPlaySourceV126)
    || '';
  if(!title){
    box.classList.remove('active');
    if(main) main.textContent = '';
    if(sub) sub.textContent = '';
    return;
  }
  if(main) main.textContent = title;
  if(sub) sub.textContent = source ? source : 'PLAY';
  box.classList.add('active');
}
(function installCourtPlayTitleV135(){
  const wrap = (name)=>{
    try{
      const oldFn = window[name] || eval('typeof '+name+' !== "undefined" ? '+name+' : null');
      if(typeof oldFn !== 'function' || oldFn.__courtTitleWrappedV135) return;
      const wrapped = function(...args){
        const result = oldFn.apply(this,args);
        setTimeout(updateCourtPlayTitleV135,0);
        setTimeout(updateCourtPlayTitleV135,120);
        return result;
      };
      wrapped.__courtTitleWrappedV135 = true;
      try{ window[name] = wrapped; }catch(e){}
      try{ eval(name + ' = wrapped'); }catch(e){}
    }catch(e){}
  };
  wrap('setSelectedPlayV125');
  wrap('rememberSelectedPlayV126');
  wrap('playSaved');
  wrap('loadLibraryPlayV118');
  wrap('updateSelectedPlayPanelV125');
  window.addEventListener('load', ()=>setTimeout(updateCourtPlayTitleV135,300));
  setTimeout(updateCourtPlayTitleV135,500);
  setTimeout(updateCourtPlayTitleV135,1400);
})();

/* v13.6 画像保存・共有もサムネイル対応
   - 画像保存にも動画と同じ上部タイトルヘッダーを付ける
   - 共有で未保存の場合は、タイトル付き画像を生成して共有
   - 動画保存はv13.4のタイトル付き録画を維持
*/
function getExportTitleInfoV136(){
  const title = (typeof selectedPlayV125 !== 'undefined' && selectedPlayV125 && selectedPlayV125.title)
    || (typeof selectedPlayDataV126 !== 'undefined' && selectedPlayDataV126 && selectedPlayDataV126.title)
    || (typeof getSelectedPlayForExportV126 === 'function' && getSelectedPlayForExportV126() && getSelectedPlayForExportV126().title)
    || 'Tactics Board';
  const source = (typeof selectedPlayV125 !== 'undefined' && selectedPlayV125 && selectedPlayV125.source)
    || (typeof selectedPlaySourceV126 !== 'undefined' && selectedPlaySourceV126)
    || 'PLAY';
  const m = (typeof selectedModeV126 === 'function' ? selectedModeV126() : mode) || mode || 'half';
  return {title, source, mode:m};
}

function renderCurrentTitledImageCanvasV136(){
  const info = getExportTitleInfoV136();
  const snap = (typeof currentSnapshotV121 === 'function') ? currentSnapshotV121() : {objects:clone(objects), lines:clone(lines)};
  if(typeof renderSnapshotToExportVideoCanvasV134 === 'function'){
    return renderSnapshotToExportVideoCanvasV134(snap, true, info.mode, info.title, info.source, playbackStateV115?.speed || 1);
  }
  if(typeof renderSnapshotToExportCanvasV121 === 'function'){
    return renderSnapshotToExportCanvasV121(snap, true);
  }
  return canvas;
}

function titledImageBlobV136(type='image/png', quality=.95){
  const ex = renderCurrentTitledImageCanvasV136();
  return new Promise((resolve,reject)=>{
    try{
      ex.toBlob(b=>b?resolve(b):reject(new Error('blob empty')), type, quality);
    }catch(e){ reject(e); }
  });
}

async function saveImageV136(){
  try{
    const info = getExportTitleInfoV136();
    const blob = await titledImageBlobV136('image/png');
    const base = (typeof safeFileNameV126 === 'function') ? safeFileNameV126(info.title || 'tactics-board') : (info.title || 'tactics-board').replace(/[\\/:*?"<>|]/g,'_');
    const name = `${base || 'tactics-board'}_thumbnail_${timestampV120()}.png`;
    lastExportBlobV120 = blob;
    lastExportFileNameV120 = name;
    downloadBlobV120(blob,name);
    setExportStatusV120(`画像を保存しました：${name}　上部にプレー名入りでサムネイルとして判別しやすくしました。`);
  }catch(err){
    console.error(err);
    alert('画像保存に失敗しました。GitHub Pagesにアップしてからもう一度試してください。');
  }
}

async function sharePlayV136(){
  try{
    if(!lastExportBlobV120){
      const info = getExportTitleInfoV136();
      lastExportBlobV120 = await titledImageBlobV136('image/png');
      const base = (typeof safeFileNameV126 === 'function') ? safeFileNameV126(info.title || 'tactics-board') : (info.title || 'tactics-board').replace(/[\\/:*?"<>|]/g,'_');
      lastExportFileNameV120 = `${base || 'tactics-board'}_thumbnail_${timestampV120()}.png`;
    }
    const file = new File([lastExportBlobV120], lastExportFileNameV120, {type:lastExportBlobV120.type || 'application/octet-stream'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Tactics Board', text:'作戦ボード'});
      setExportStatusV120('共有しました。サムネイル画像/タイトル付き動画として判別しやすくしています。');
    }else if(navigator.share){
      await navigator.share({title:'Tactics Board', text:'作戦ボード'});
      setExportStatusV120('共有しました。');
    }else{
      downloadBlobV120(lastExportBlobV120,lastExportFileNameV120);
      setExportStatusV120('直接共有に非対応のため、保存しました。');
    }
  }catch(err){
    console.error(err);
    if(err && err.name !== 'AbortError') alert('共有に失敗しました。先に画像保存または動画保存を試してください。');
  }
}

setTimeout(()=>{
  const img=$('saveImageBtnV120');
  const share=$('sharePlayBtnV120');
  if(img) img.onclick = saveImageV136;
  if(share) share.onclick = sharePlayV136;
  if($('exportStatusV120')){
    setExportStatusV120('v13.6：画像保存・動画保存・共有で、上部にプレー名が入るサムネイル対応を追加しました。');
  }
}, 1400);


/* v13.7 動画録画エンジン再構築
   - 0秒/黒画面対策として captureStream(0) + requestFrame を優先
   - 最初にプレー名付きサムネイル画面を約2秒保持
   - 録画専用Canvasだけを録画し、コート/選手/線/スマートDF/速度を維持
*/
function sleepV137(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }
function frameRateV137(){ return 30; }
function requestVideoFrameV137(track){
  try{
    if(track && typeof track.requestFrame === 'function') track.requestFrame();
  }catch(e){}
}
function selectedSpeedV137(){
  const s = Number(playbackStateV115?.speed || 1);
  return Math.max(.1, Math.min(1.5, s || 1));
}
function videoMimeV137(){
  if(typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.find(t=>{
    try{return MediaRecorder.isTypeSupported(t)}catch(e){return false}
  }) || '';
}
function selectedPlayTitleV137(play){
  return (play && play.title) || selectedPlayV125?.title || selectedPlayDataV126?.title || 'Tactics Board';
}
function selectedPlaySourceV137(){
  return selectedPlaySourceV126 || selectedPlayV125?.source || '保存プレー';
}
function makeInterpolatedSnapshotV137(from,to,t){
  return {
    objects: interpObjects(from.objects || [], to.objects || [], t),
    lines: to.lines || []
  };
}
async function drawCaptureHoldV137(track, snap, frames, exportMode, playTitle, source, speed, delay){
  for(let i=0;i<frames;i++){
    renderSnapshotToExportVideoCanvasV134(snap, true, exportMode, playTitle, source, speed);
    requestVideoFrameV137(track);
    await sleepV137(delay);
  }
}
async function recordExportFramesV137(play, speed=1){
  const frames = clone(play.frames || []);
  if(frames.length < 2) throw new Error('frames empty');

  const exportMode = play.mode || 'half';
  const playTitle = selectedPlayTitleV137(play);
  const source = selectedPlaySourceV137();
  const fps = frameRateV137();
  const frameDelay = Math.round(1000 / fps);
  const durationBase = (playbackStateV115 && playbackStateV115.durationBase) ? playbackStateV115.durationBase : 850;
  const moveDuration = durationBase / Math.max(.1, Number(speed)||1);
  const transitionFrames = Math.max(4, Math.round((moveDuration / 1000) * fps));

  const oldSnap = (typeof currentSnapshotV121 === 'function') ? currentSnapshotV121() : {objects:clone(objects), lines:clone(lines)};
  const oldMode = mode;
  const chunks = [];
  let stream = null;
  let recorder = null;
  let track = null;
  let mime = '';

  try{
    // 先に必ずタイトル+コートを描いてから録画を開始する
    renderSnapshotToExportVideoCanvasV134(frames[0], true, exportMode, playTitle, source, speed);
    const ex = ensureVideoExportCanvasV134(exportMode);
    if(!ex.captureStream) throw new Error('captureStream unsupported');

    // requestFrame対応ブラウザでは0fpsストリームで手動フレーム送出。黒画面/0秒対策。
    try{
      stream = ex.captureStream(0);
    }catch(e){
      stream = ex.captureStream(fps);
    }
    track = stream.getVideoTracks()[0];
    mime = videoMimeV137();
    try{
      recorder = mime
        ? new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond:6500000})
        : new MediaRecorder(stream,{videoBitsPerSecond:6500000});
    }catch(e){
      recorder = new MediaRecorder(stream);
      mime = recorder.mimeType || 'video/webm';
    }

    const stopped = new Promise((resolve,reject)=>{
      recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = e=>reject(e.error || e);
      recorder.onstop = resolve;
    });

    recorder.start(250);

    // 録画開始直後は数フレーム送ってから本編へ。サムネイル対策としてタイトル画面を約2秒。
    await drawCaptureHoldV137(track, frames[0], fps*2, exportMode, playTitle, source, speed, frameDelay);

    for(let i=0;i<frames.length-1;i++){
      const from = frames[i];
      const to = frames[i+1];
      for(let f=0; f<=transitionFrames; f++){
        const t = Math.min(1, f / transitionFrames);
        const snap = makeInterpolatedSnapshotV137(from,to,t);
        renderSnapshotToExportVideoCanvasV134(snap, true, exportMode, playTitle, source, speed);
        requestVideoFrameV137(track);
        await sleepV137(frameDelay);
      }
      // 各ステップ終わりで少し止めて、線と番号を読みやすくする
      await drawCaptureHoldV137(track, frames[i+1], Math.max(2, Math.round(fps*.12)), exportMode, playTitle, source, speed, frameDelay);
    }

    await drawCaptureHoldV137(track, frames[frames.length-1], fps, exportMode, playTitle, source, speed, frameDelay);
    await sleepV137(250);
    if(recorder.state !== 'inactive') recorder.stop();
    await stopped;

    if(!chunks.length) throw new Error('recorded chunks empty');
    const blob = new Blob(chunks,{type:mime || recorder.mimeType || chunks[0].type || 'video/webm'});
    if(blob.size < 1500) throw new Error('recorded blob too small');
    return blob;
  }finally{
    try{ if(recorder && recorder.state !== 'inactive') recorder.stop(); }catch(e){}
    if(stream) stream.getTracks().forEach(t=>t.stop());
    objects = oldSnap.objects;
    lines = oldSnap.lines;
    mode = oldMode;
    try{ syncMode?.(); setCanvasSize?.(); render?.(); }catch(e){}
  }
}

async function saveVideoV137(){
  if(exportingVideoV120) return;
  if(typeof MediaRecorder === 'undefined'){
    alert('このブラウザは動画保存に対応していません。Safari/Chromeを最新版にしてください。');
    return;
  }
  const play = getSelectedPlayForExportV126();
  if(!play || !play.frames || play.frames.length < 2){
    alert('先にプレーを作成して保存し、保存プレーを選択してください。');
    return;
  }
  const defaultName = selectedPlayTitleV137(play);
  const base = safeFileNameV126(prompt('保存する動画名を入力してください', defaultName) || defaultName || 'tactics-board');
  play.title = base || defaultName || 'Tactics Board';
  const btn=$('saveVideoBtnV120'), shareBtn=$('sharePlayBtnV120');
  try{
    exportingVideoV120 = true;
    if(btn) btn.disabled = true;
    if(shareBtn) shareBtn.disabled = true;
    pausePlaybackV115?.();
    setExportStatusV120(`動画を作成中です：${base}　最初にプレー名入りサムネイル画面を録画します…`);
    const blob = await recordExportFramesV137(play, selectedSpeedV137());
    const type = blob.type || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const name = `${base || 'tactics-board'}.${ext}`;
    lastExportBlobV120 = blob;
    lastExportFileNameV120 = name;
    downloadBlobV120(blob,name);
    setExportStatusV120(`動画を保存しました：${name}　最初の画面にプレー名が入るのでサムネイルで判別しやすくなります。`);
  }catch(err){
    console.error(err);
    alert('動画保存に失敗しました。GitHub Pages上でSafari/Chrome最新版を試してください。');
    setExportStatusV120('動画保存に失敗しました。録画非対応ブラウザの場合は画像保存を使ってください。');
  }finally{
    exportingVideoV120 = false;
    if(btn) btn.disabled = false;
    if(shareBtn) shareBtn.disabled = false;
  }
}
setTimeout(()=>{
  const vid = $('saveVideoBtnV120');
  if(vid) vid.onclick = saveVideoV137;
  if($('exportStatusV120')){
    setExportStatusV120('v13.7：動画録画エンジンを再構築。0秒・黒画面対策、プレー名サムネイル画面を最初に録画します。');
  }
}, 1500);
