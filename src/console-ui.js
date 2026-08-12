/**
 * The human-facing surface. Mobile-first, because the whole product is
 * "the operator's phone buzzes and five seconds later the agent is unblocked".
 *
 * Design constraint that drove every choice here: the operator must not have to
 * reconstruct context. The page opens already showing what the agent saw, what
 * the agent was doing, and exactly one thing to do next.
 */

const BASE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  :root{color-scheme:dark}
  body{background:#0b0d10;color:#e8ecf1;font:16px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
  .wrap{max-width:720px;margin:0 auto;padding:16px 16px 40px}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7c8798;font-weight:600}
  h1{font-size:23px;line-height:1.25;margin:6px 0 2px;font-weight:650;letter-spacing:-.01em}
  .host{font-size:13px;color:#8b95a6;font-variant-numeric:tabular-nums;word-break:break-all}
  .card{background:#141820;border:1px solid #222833;border-radius:14px;padding:16px;margin:14px 0}
  .task{color:#aeb8c7;font-size:14.5px}
  .instruction{font-size:17px;font-weight:550;color:#fff;margin-top:10px}
  .frame{width:100%;border-radius:10px;border:1px solid #262d3a;display:block;background:#0e1116}
  .btn{display:block;width:100%;border:0;border-radius:13px;padding:19px 16px;font-size:17px;font-weight:650;
       text-align:center;text-decoration:none;cursor:pointer;margin-top:11px;font-family:inherit}
  .primary{background:#3d7dff;color:#fff}
  .go{background:#1fbf75;color:#04160d}
  .ghost{background:#1a1f29;color:#9aa5b5;border:1px solid #272f3c}
  .pill{display:inline-block;font-size:11.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;
        padding:5px 9px;border-radius:99px;background:#1d2836;color:#7fb0ff;border:1px solid #26364b}
  .pill.yield{background:#2b2418;color:#e0b070;border-color:#453721}
  .note{font-size:13px;color:#798394;margin-top:12px;line-height:1.5}
  .status{font-size:14px;color:#8b95a6;margin-top:14px;text-align:center}
  .done{text-align:center;padding:52px 16px}
  .done h2{font-size:24px;margin-bottom:8px}
  .kbd{width:100%;background:#0e1218;border:1px solid #2a3341;border-radius:11px;color:#e8ecf1;
       padding:14px;font-size:16px;font-family:inherit;margin-top:11px}
  .empty{text-align:center;color:#6b7585;padding:64px 20px}
  .row{display:flex;gap:10px;align-items:center;justify-content:space-between}
  a.gate{display:block;text-decoration:none;color:inherit}
`;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** The gate console — what the operator lands on. */
export function gatePage(gate) {
  const isYield = gate.mode === 'yield';
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Presence — ${esc(gate.host)}</title><style>${BASE_CSS}</style></head><body>
<div class="wrap" id="root">
  <div class="eyebrow">An agent needs you</div>
  <h1>${esc(gate.instruction)}</h1>
  <div class="host">${esc(gate.host)}</div>

  <div class="card">
    <div class="row">
      <span class="pill ${isYield ? 'yield' : ''}">${isYield ? 'Your browser' : 'Live session'}</span>
      <span class="host">${esc(gate.gate_kind.replace(/_/g, ' '))}</span>
    </div>
    <div class="task" style="margin-top:12px">${esc(gate.task)}</div>
  </div>

  ${gate.frameSha ? `<img class="frame" id="frame" src="/h/${gate.id}/frame?t=0" alt="What the agent is looking at">` : ''}

  ${isYield && gate.yieldTarget === 'agent_window' ? `
    <div class="card" style="border-color:#453721;background:#1c1810">
      <div class="instruction" style="font-size:15.5px">The browser window is already open on your workstation, on this exact step.</div>
      <div class="note" style="margin-top:8px">Do it there. This site won't let the session be reopened somewhere else, so starting over in a new browser would throw away everything the agent already filled in.</div>
    </div>
    <div class="note">Presence will not touch this step. It relays no input into a challenge — you tick it yourself, in the real session, and tell it when you're through.</div>
    <button class="btn go" id="done">Done — I ticked it</button>
  ` : isYield ? `
    <a class="btn go" id="open" href="${esc(gate.handoffUrl || '#')}" target="_blank" rel="noopener">Open in my browser</a>
    <div class="note">This opens in your own browser, in your own session. Presence does not touch it and never sees what you enter — it only waits for you to say you're done.</div>
    <button class="btn primary" id="done">I've done it</button>
  ` : `
    <div class="note">Tap the picture to click. It's the agent's live session — your taps go straight into it.</div>
    <input class="kbd" id="kbd" placeholder="Type here to type into the page" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="btn primary" id="done">Done — agent can continue</button>
  `}
  <button class="btn ghost" id="cancel">Can't do this now</button>
  <div class="status" id="status"></div>
</div>
<script>
const ID=${JSON.stringify(gate.id)}, MODE=${JSON.stringify(gate.mode)};
const $=(s)=>document.querySelector(s), status=$('#status');
let closed=false;

async function post(path, body){
  const r = await fetch('/h/'+ID+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});
  if(!r.ok) status.textContent = 'Rail refused that: ' + (await r.text());
  return r;
}
fetch('/h/'+ID+'/attach',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({device: /Mobi|Android|iPhone/i.test(navigator.userAgent)?'phone':'workstation'})});

function finish(kind,title,sub){
  closed=true;
  document.getElementById('root').innerHTML =
    '<div class="done"><h2>'+title+'</h2><div class="task">'+sub+'</div></div>';
}
$('#done').onclick = async ()=>{ await post('/release',{outcome:'resumed'}); finish('ok','Handed back','The agent is picking it up from here.'); };
$('#cancel').onclick = async ()=>{ await post('/release',{outcome:'abandoned'}); finish('no','Left for later','The agent will stop cleanly instead of waiting.'); };

if(MODE==='attach'){
  const img=$('#frame');
  img.addEventListener('click',(e)=>{
    const r=img.getBoundingClientRect();
    const x=Math.round((e.clientX-r.left)/r.width*img.naturalWidth);
    const y=Math.round((e.clientY-r.top)/r.height*img.naturalHeight);
    post('/input',{kind:'pointer',action:'click',x,y,button:'left'});
    if(navigator.vibrate)navigator.vibrate(8);
  });
  $('#kbd').addEventListener('keydown',(e)=>{
    if(e.key.length===1||['Backspace','Enter','Tab'].includes(e.key))
      post('/input',{kind:'key',action:'down',key:e.key,code:e.code});
  });
  setInterval(()=>{ if(!closed) $('#frame').src='/h/'+ID+'/frame?t='+Date.now(); },1200);
}
setInterval(async ()=>{
  if(closed)return;
  const s=await (await fetch('/h/'+ID+'/state')).json();
  if(['released','abandoned','timeout','refused'].includes(s.state) && !closed)
    finish('ok','Closed','This gate is no longer waiting.');
},3000);
</script></body></html>`;
}

/** The pager — the one URL the operator bookmarks. Buzzes when a gate opens. */
export function pagerPage() {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Presence</title><style>${BASE_CSS}</style></head><body>
<div class="wrap">
  <div class="eyebrow">Presence</div>
  <h1 style="margin-bottom:14px">Waiting on you</h1>
  <div id="list"><div class="empty">Nothing needs you right now.<br>Leave this open — it'll buzz.</div></div>
  <div class="status" id="s">watching…</div>
</div>
<script>
let seen=new Set(), primed=false;
if('Notification' in window && Notification.permission==='default'){
  document.body.addEventListener('click',()=>Notification.requestPermission(),{once:true});
}
async function tick(){
  try{
    const gates = await (await fetch('/pager/gates')).json();
    const list=document.getElementById('list');
    if(!gates.length){ list.innerHTML='<div class="empty">Nothing needs you right now.<br>Leave this open — it\\'ll buzz.</div>'; }
    else {
      list.innerHTML = gates.map(g=>
        '<a class="gate card" href="/h/'+g.id+'">'
        + '<div class="row"><span class="pill '+(g.mode==='yield'?'yield':'')+'">'
        + (g.mode==='yield'?'Your browser':'Live session')+'</span><span class="host">'+g.host+'</span></div>'
        + '<div class="instruction">'+g.instruction+'</div>'
        + '<div class="task" style="margin-top:6px">'+g.task+'</div></a>').join('');
    }
    for(const g of gates){
      if(!seen.has(g.id)){
        seen.add(g.id);
        if(primed){
          if(navigator.vibrate) navigator.vibrate([120,60,120]);
          if('Notification' in window && Notification.permission==='granted')
            new Notification('An agent needs you', {body:g.instruction+' — '+g.host, tag:g.id});
        }
      }
    }
    primed=true;
    document.getElementById('s').textContent='watching · '+new Date().toLocaleTimeString();
  }catch(e){ document.getElementById('s').textContent='rail offline'; }
}
tick(); setInterval(tick,2000);
</script></body></html>`;
}
