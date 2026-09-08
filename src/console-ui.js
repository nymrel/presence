/**
 * The human-facing surface. Mobile-first, because the whole product is
 * "the operator's phone buzzes and five seconds later the agent is unblocked".
 *
 * The page must never display a successful handoff unless the relay accepted
 * both attachment and release. A fail-closed server with a falsely optimistic
 * UI is still a false-confidence bug.
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
  .btn:disabled,.locked{opacity:.45;cursor:not-allowed;pointer-events:none}
  .primary{background:#3d7dff;color:#fff}
  .go{background:#1fbf75;color:#04160d}
  .ghost{background:#1a1f29;color:#9aa5b5;border:1px solid #272f3c}
  .pill{display:inline-block;font-size:11.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;
        padding:5px 9px;border-radius:99px;background:#1d2836;color:#7fb0ff;border:1px solid #26364b}
  .pill.yield{background:#2b2418;color:#e0b070;border-color:#453721}
  .note{font-size:13px;color:#798394;margin-top:12px;line-height:1.5}
  .status{font-size:14px;color:#8b95a6;margin-top:14px;text-align:center;min-height:22px}
  .status.warn{color:#e0b070}
  .status.ok{color:#75dba7}
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

function safeExternalHref(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

/** The gate console — what the operator lands on. */
export function gatePage(gate, { nonce = '' } = {}) {
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
      <div class="note" style="margin-top:8px">Do it there. Starting over elsewhere may throw away the work the agent already completed.</div>
    </div>
    <div class="note">Presence will not touch this step. It relays no input into a challenge — you act in the real session and tell it when you're through.</div>
    <button class="btn go" id="done">Done — I completed it</button>
  ` : isYield ? `
    <a class="btn go locked" id="open" href="${esc(safeExternalHref(gate.handoffUrl))}" target="_blank" rel="noopener" aria-disabled="true">Open in my browser</a>
    <div class="note">This opens in your own browser, in your own session. Presence never sees what you enter — it only waits for you to say you're done.</div>
    <button class="btn primary" id="done">I've done it</button>
  ` : `
    <div class="note">Tap the picture to click. It's the agent's live session — your taps go straight into it.</div>
    <input class="kbd" id="kbd" placeholder="Type here to type into the page" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="btn primary" id="done">Done — agent can continue</button>
  `}
  <button class="btn ghost" id="cancel">Can't do this now</button>
  <div class="status" id="status">Connecting to the local rail…</div>
</div>
<script nonce="${esc(nonce)}">
const ID=${JSON.stringify(gate.id)}, MODE=${JSON.stringify(gate.mode)};
const $=(s)=>document.querySelector(s), status=$('#status');
let closed=false, attached=false;

function lockActions(locked){
  for(const node of document.querySelectorAll('#done,#cancel,#kbd,#open')){
    if('disabled' in node) node.disabled=locked;
    node.classList.toggle('locked',locked);
    node.setAttribute('aria-disabled',locked?'true':'false');
  }
}
lockActions(true);

async function post(path, body){
  let r;
  try{
    r=await fetch('/h/'+ID+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});
  }catch{
    status.className='status warn';
    status.textContent='Local rail is unreachable. Nothing was released.';
    return null;
  }
  if(!r.ok){
    status.className='status warn';
    status.textContent='Rail refused that: '+(await r.text());
    return null;
  }
  try{return await r.json();}catch{return {};}
}

const attachPromise=post('/attach',{
  device:/Mobi|Android|iPhone/i.test(navigator.userAgent)?'phone':'workstation'
}).then((result)=>{
  if(!result){lockActions(true);return false;}
  attached=true;
  lockActions(false);
  if(result.assurance==='webauthn-verified'){
    status.className='status ok';
    status.textContent='Verified human attachment.';
  }else{
    status.className='status warn';
    status.textContent='LAN console attached · identity not verified.';
  }
  return true;
});

async function requireAttachment(){
  if(attached)return true;
  return await attachPromise;
}

function finish(title,sub){
  closed=true;
  document.getElementById('root').innerHTML=
    '<div class="done"><h2>'+title+'</h2><div class="task">'+sub+'</div></div>';
}

$('#done').onclick=async()=>{
  if(!(await requireAttachment()))return;
  const released=await post('/release',{outcome:'resumed'});
  if(!released)return;
  finish('Handed back','The rail accepted the release. The agent can re-read the live state.');
};
$('#cancel').onclick=async()=>{
  if(!(await requireAttachment()))return;
  const released=await post('/release',{outcome:'abandoned'});
  if(!released)return;
  finish('Left for later','The rail recorded an abandoned handoff.');
};

if(MODE==='attach'){
  const img=$('#frame');
  if(img)img.addEventListener('click',async(e)=>{
    if(!(await requireAttachment()))return;
    const r=img.getBoundingClientRect();
    const x=Math.round((e.clientX-r.left)/r.width*img.naturalWidth);
    const y=Math.round((e.clientY-r.top)/r.height*img.naturalHeight);
    const sent=await post('/input',{kind:'pointer',action:'click',x,y,button:'left'});
    if(sent&&navigator.vibrate)navigator.vibrate(8);
  });
  const kbd=$('#kbd');
  if(kbd)kbd.addEventListener('keydown',async(e)=>{
    if(e.key.length===1||['Backspace','Enter','Tab'].includes(e.key)){
      if(!(await requireAttachment()))return;
      await post('/input',{kind:'key',action:'down',key:e.key,code:e.code});
    }
  });
  if(img)setInterval(()=>{if(!closed)img.src='/h/'+ID+'/frame?t='+Date.now();},1200);
}
setInterval(async()=>{
  if(closed)return;
  try{
    const s=await(await fetch('/h/'+ID+'/state')).json();
    if(['released','abandoned','timeout','refused'].includes(s.state)&&!closed)
      finish('Closed','This gate is no longer waiting.');
  }catch{
    status.className='status warn';
    status.textContent='Local rail is unreachable. No success is assumed.';
  }
},3000);
</script></body></html>`;
}

/** The pager — the one URL the operator bookmarks. Buzzes when a gate opens. */
export function pagerPage({ nonce = '' } = {}) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Presence</title><style>${BASE_CSS}</style></head><body>
<div class="wrap">
  <div class="eyebrow">Presence</div>
  <h1 style="margin-bottom:14px">Waiting on you</h1>
  <div id="list"><div class="empty">Nothing needs you right now.<br>Leave this open — it'll buzz.</div></div>
  <div class="status" id="s">watching…</div>
</div>
<script nonce="${esc(nonce)}">
let seen=new Set(),primed=false;
if('Notification'in window&&Notification.permission==='default'){
  document.body.addEventListener('click',()=>Notification.requestPermission(),{once:true});
}
async function tick(){
  try{
    const gates=await(await fetch('/pager/gates')).json();
    const list=document.getElementById('list');
    const empty=()=>{
      const node=document.createElement('div');
      node.className='empty';
      node.append('Nothing needs you right now.',document.createElement('br'),"Leave this open — it'll buzz.");
      return node;
    };
    const gateCard=(g)=>{
      const id=typeof g.id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(g.id)?g.id:null;
      if(!id)return null;
      const card=document.createElement('a');
      card.className='gate card';
      card.href='/h/'+id;
      const row=document.createElement('div');
      row.className='row';
      const pill=document.createElement('span');
      pill.className='pill'+(g.mode==='yield'?' yield':'');
      pill.textContent=g.mode==='yield'?'Your browser':'Live session';
      const host=document.createElement('span');
      host.className='host';
      host.textContent=String(g.host??'');
      row.append(pill,host);
      const instruction=document.createElement('div');
      instruction.className='instruction';
      instruction.textContent=String(g.instruction??'');
      const task=document.createElement('div');
      task.className='task';
      task.style.marginTop='6px';
      task.textContent=String(g.task??'');
      card.append(row,instruction,task);
      return card;
    };
    const cards=gates.map(gateCard).filter(Boolean);
    list.replaceChildren(...(cards.length?cards:[empty()]));
    for(const g of gates){
      if(!seen.has(g.id)){
        seen.add(g.id);
        if(primed){
          if(navigator.vibrate)navigator.vibrate([120,60,120]);
          if('Notification'in window&&Notification.permission==='granted')
            new Notification('An agent needs you',{body:g.instruction+' — '+g.host,tag:g.id});
        }
      }
    }
    primed=true;
    document.getElementById('s').textContent='watching · '+new Date().toLocaleTimeString();
  }catch{document.getElementById('s').textContent='rail offline';}
}
tick();setInterval(tick,2000);
</script></body></html>`;
}
