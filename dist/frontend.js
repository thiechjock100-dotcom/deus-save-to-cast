export function setup(ctx) {
  const session = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let sequence = 0;
  const pending = new Map();
  const off = ctx.onBackendMessage(m => pending.get(m.requestId)?.(m));
  function call(data) {
    return new Promise((resolve,reject) => {
      const requestId = session + "-" + (++sequence);
      const timer = setTimeout(()=>{pending.delete(requestId); reject(Error("No reply. Check extension permissions and retry."));},20000);
      pending.set(requestId,m=>{
        clearTimeout(timer); pending.delete(requestId);
        if (m.error) reject(Error(m.error)); else resolve(m.result);
      });
      ctx.sendToBackend({...data,requestId});
    });
  }
  let live=true;
  const chats = new Map();
  const style = ctx.dom.addStyle(`
.deus-cast-drawer{position:fixed;right:14px;bottom:76px;z-index:1500;box-sizing:border-box;max-width:calc(100vw - 24px);max-height:65vh;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#785d84 #221d2b;color:#f0e8f4;background:linear-gradient(155deg,#36293e,#231d2c 52%);border:1px solid #69506f;border-radius:14px;box-shadow:0 12px 38px #100a1980;font:14px/1.45 system-ui}
.deus-cast-drawer[open]{width:365px;padding-bottom:12px}
.deus-cast-drawer>summary{display:flex;align-items:center;gap:12px;padding:9px 15px;color:#efcf94;font:600 19px/1.3 Georgia,serif;cursor:pointer;list-style:none}
.deus-cast-drawer summary::-webkit-details-marker{display:none}
.deus-cast-drawer>summary::before{content:'✦';font:15px Georgia;color:#d8af75}
.deus-cast-drawer>summary::after,.cast-group>summary::after{content:'⌄';margin-left:auto;font:16px system-ui;color:#c5aecf}
.deus-cast-drawer[open]>summary::after,.cast-group[open]>summary::after{transform:rotate(180deg)}
.deus-cast-drawer[open]>summary{padding:15px 17px;border-bottom:1px solid #59455d}
.deus-cast-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;padding:7px 0;color:inherit}
.deus-cast-tools button,.deus-cast-drawer>button{font:600 12px/1.3 system-ui;color:#eddfef;background:#413349;border:1px solid #705978;border-radius:7px;padding:6px 10px;cursor:pointer}
.deus-cast-tools button:hover,.deus-cast-drawer>button:hover{background:#56425f}
.deus-cast-tools button:focus-visible,.deus-cast-drawer :focus-visible{outline:2px solid #ebc684;outline-offset:2px}
.deus-cast-tools button:disabled{opacity:.6;cursor:wait}
.deus-cast-drawer>button{margin:12px 14px 0}
.cast-results{padding:8px 14px 0}
.cast-results:empty{display:none}
.cast-context{font-size:12px;color:#bfaac8;margin:0 0 9px}
.cast-section,.cast-group{margin:7px 0 0;padding:0;border-top:1px solid #57435d}
.cast-section>header,.cast-group>summary{display:flex;align-items:center;gap:8px;padding:9px 2px;color:#e7d5e9;font-weight:600;list-style:none}
.cast-group>summary{cursor:pointer}.cast-count{font:600 11px system-ui;color:#dbc59f;background:#443647;border-radius:5px;padding:2px 6px}
.cast-results .deus-cast-tools{display:grid;grid-template-columns:minmax(0,1fr) auto auto;background:#2e2637;border-radius:7px;padding:8px 9px;margin-bottom:4px}
.cast-name{min-width:0;overflow-wrap:anywhere;font:600 15px/1.3 Georgia,serif;color:#f2e6dd}
.deus-cast-tools small{flex-basis:100%;grid-column:1/-1;color:#d3bddc}.deus-cast-tools small:empty{display:none}
.deus-cast-tools .cast-secondary{color:#cdbbd4;background:transparent;border-color:transparent}
.deus-cast-tools .cast-editor{grid-column:1/-1;flex-basis:100%;min-width:0;padding:10px 0}
.cast-editor label{display:grid;gap:4px;margin:9px 0;font:12px system-ui;color:#d2bfd8}
.cast-editor input,.cast-editor textarea{box-sizing:border-box;width:100%;background:#211b28;color:#f0e8f4;border:1px solid #635069;padding:8px;border-radius:6px;font:13px/1.45 system-ui}
.cast-editor pre{white-space:pre-wrap;overflow-wrap:anywhere}.cast-editor button{margin-right:5px}
.deus-cast-drawer [hidden],.deus-cast-tools [hidden]{display:none!important}
`);
  const drawer = document.createElement('details');
  drawer.className = 'deus-cast-drawer';
  drawer.hidden = false;
  const title = document.createElement('summary');
  title.textContent = 'Cast';
  drawer.append(title);
  document.body.append(drawer);
  const recover = document.createElement('button');
  recover.textContent = 'Find New Faces in this chat';
  const results = document.createElement('div');
  results.className='cast-results';
  drawer.append(recover, results);
  // Store one small flag per NPC so independent dismissals never overwrite each other.
  function denialKey(chatId, label) {
    return 'deus_save_to_cast:denied:' + JSON.stringify([chatId,label.trim().toLowerCase()]);
  }
  let revision = 0;
  drawer.addEventListener('toggle', () => {
    if (!drawer.open) { revision++; results.replaceChildren(); recover.disabled=false; }
  });
  recover.onclick = async () => {
    const current = ++revision;
    const anchor = ctx.messages.getLatestMessageId?.();
    recover.disabled = true;
    results.textContent = 'Looking through earlier replies…';
    try {
      const data = await call({type:'history', chatId:chats.get(anchor)});
      if (current !== revision || !live) return;
      if (anchor !== ctx.messages.getLatestMessageId?.()) throw Error('The chat changed. Search again.');
      const unique = new Map();
      for (const row of data.faces) unique.set(faceName(row.profile).toLowerCase(), row);
      results.replaceChildren();
      const context=document.createElement('p');
      context.className='cast-context';
      context.textContent=unique.size ? data.destination : 'No New Faces found in '+data.destination+'.';
      results.append(context);
      function group(label,folded) {
        const el=document.createElement(folded?'details':'section');
        el.className=folded?'cast-group':'cast-section';
        const heading=document.createElement(folded?'summary':'header');
        heading.textContent=label;
        const count=document.createElement('span');
        count.className='cast-count';
        heading.append(count);
        el.append(heading);
        results.append(el);
        el.hidden=true;
        return {el,count};
      }
      const fresh=group('New faces',false), saved=group('Already saved',true), denied=group('Denied',true);
      for (const row of unique.values()) {
        chats.set(row.messageId, data.chatId);
        const host = document.createElement('div');
        function place() {
          const flags=host.querySelector('.deus-cast-tools')?.dataset;
          const target=flags?.denied==='true' ? denied : flags?.saved==='true' ? saved : fresh;
          if(host.parentElement!==target.el) target.el.append(host);
          for(const item of [fresh,saved,denied]){
            const size=item.el.childElementCount-1;
            item.el.hidden=size===0;
            item.count.textContent=String(size);
          }
        }
        place();
        add(host,row.messageId,row.profile);
        host.querySelector('.deus-cast-tools')?.addEventListener('cast-denial',place);
      }
    } catch(e) { if(current === revision) results.textContent=e.message; }
    finally { if(current === revision) recover.disabled=false; }
  };

  function faceName(profile) {
    for (const field of ['Called','Seen as','Name']) {
      const value = profile.split(/\r?\n/).find(line=>line.trimStart().toLowerCase().startsWith(field.toLowerCase()+':'))?.split(':').slice(1).join(':').split('|')[0].trim();
      if (value && !/^(?:[-–—]|none|n\/a)$/i.test(value)) return value;
    }
    return profile.split('·')[0].split('\n')[0].trim() || 'New face';
  }
  function add(card,messageId,rawProfile) {
    const body = rawProfile ? card : card.querySelector('.dem-new-face__body');
    const profile = rawProfile || body?.querySelector('pre code,pre')?.textContent.trim() || body?.textContent.match(/```(?:yaml|text)?\s*([\s\S]*?)```/)?.[1].trim();
    if (!profile || body.querySelector('.deus-cast-tools')) return;
    const name = card.querySelector('.dem-card__title')?.textContent.trim() || faceName(profile);
    const root = document.createElement('div');
    root.className = 'deus-cast-tools';
    body.append(root);
    function node(tag,text,parent=root) {
      const el = document.createElement(tag); el.textContent=text; parent.append(el); return el;
    }
    if(rawProfile) node('span',name).className='cast-name';
    const action=node('button',rawProfile ? 'Save' : 'Save to Cast');
    const status=node('small',''); status.setAttribute('aria-live','polite');
    const deny=node('button','Deny');
    deny.className='cast-secondary';
    root.append(status);
    const identity=faceName(profile);
    let scope;
    let isSaved=false;
    function apply(denied,saved) {
      root.dataset.denied=String(denied);
      root.dataset.saved=String(saved);
      isSaved=saved;
      action.hidden=denied;
      action.textContent=saved ? 'Update' : rawProfile ? 'Save' : 'Save to Cast';
      deny.textContent=denied ? 'Undo deny' : 'Deny';
      status.textContent=rawProfile ? '' : denied ? name+' · Denied' : saved ? name+' · Already saved' : '';
      root.dispatchEvent(new Event('cast-denial'));
    }
    const sourceKey='deus_save_to_cast:source:'+messageId;
    async function remember() {
      action.disabled=deny.disabled=true;
      try {
        scope=chats.get(messageId) || localStorage.getItem(sourceKey) || (await call({type:'scope'})).chatId;
        chats.set(messageId,scope);
        localStorage.setItem(sourceKey,scope);
        const key=denialKey(scope,identity);
        const state=await call({type:'remember',identity,name,chatId:scope,legacyDenied:localStorage.getItem(key)==='1'});
        localStorage.removeItem(key);
        root.dataset.denialKey=key;
        apply(state.denied,state.saved);
      } catch(e){status.textContent=e.message;} finally {action.disabled=deny.disabled=false;}
    }
    root.addEventListener('cast-refresh',remember);
    remember();
    deny.onclick=async()=>{
      action.disabled=deny.disabled=true;
      try {
        const state=await call({type:'decision',chatId:scope,identity,denied:root.dataset.denied!=='true'});
        apply(state.denied,isSaved);
        refreshOthers();
      } catch(e){status.textContent=e.message;} finally {action.disabled=deny.disabled=false;}
    };
    function refreshOthers() {
      for (const other of document.querySelectorAll('.deus-cast-tools')) {
        if(other!==root && other.dataset.denialKey===root.dataset.denialKey) other.dispatchEvent(new Event('cast-refresh'));
      }
    }
    action.onclick=async()=>{
      action.disabled=true;deny.disabled=true;status.textContent='';
      const request={name,chatId:chats.get(messageId)};
      if (!name || /^new face$/i.test(name)) request.name=window.prompt('Name for this cast entry')?.trim();
      if (!request.name){action.disabled=deny.disabled=false;return;}
      try {
        const s=await call({...request,type:'lookup'});
        const panel=node('div',''); panel.className='cast-editor'; action.hidden=true;
        node('strong',s.destination,panel);
        if(s.old) {node('p','Previously saved',panel);node('pre',s.old.content,panel);}
        function field(title,tag,value) {
          const label=node('label',title,panel);const el=node(tag,'',label);el.value=value;return el;
        }
        const aliases=profile.match(/^(?:Aliases?|Called|Seen as):\s*(.+)$/im)?.[1]?.split(/[,|]/) || [];
        const keys=field('Names and aliases (comma-separated)','input',[...new Set([request.name,...(s.old?.keys || []),...aliases.map(a=>a.trim()).filter(a=>a && !/^(none|n\/a|[-—])$/i.test(a))])].join(', '));
        const merged=s.old && !s.old.content.includes(profile) ? s.old.content+'\n\n'+profile : s.old?.content || profile;
        const content=field('Profile to keep','textarea',merged);content.rows=9;
        const save=node('button',s.old?'Save update':'Save character',panel);
        const cancel=node('button','Cancel',panel);
        function close(){panel.remove();action.hidden=false;action.disabled=deny.disabled=false;}
        cancel.onclick=close;
        save.onclick=async()=>{
          save.disabled=cancel.disabled=true;
          try {
            await call({...request,type:'save',chatId:s.chatId,characterId:s.characterId,previous:s.old,content:content.value,keys:keys.value.split(',')});
            close();apply(false,true);refreshOthers();
          } catch(e){status.textContent=e.message;save.disabled=cancel.disabled=false;}
        };
      } catch(e){status.textContent=e.message;action.disabled=deny.disabled=false;}
    };
  }
  function scan() {
    for (const {messageId,element} of ctx.dom.listMessageElements()) {
      for (const card of element.querySelectorAll('.dem-card.dem-new-face')) add(card,messageId);
    }
  }
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(live)scan();});}});
  observer.observe(document.body,{childList:true,subtree:true});scan();
  return ()=>{live=false;observer.disconnect();drawer.remove();document.querySelectorAll(".dem-new-face__body > .deus-cast-tools").forEach(el=>el.remove());off();style();ctx.dom.cleanup();};
}
