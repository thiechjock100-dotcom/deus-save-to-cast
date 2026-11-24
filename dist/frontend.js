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
  const style = ctx.dom.addStyle('.deus-cast-tools{display:grid;gap:8px;padding:8px 0;color:inherit}.deus-cast-tools button{cursor:pointer;border:1px solid #8b7499;border-radius:7px;background:#32283d;color:#f3e4fb;padding:6px 12px;justify-self:start}.deus-cast-tools textarea,.deus-cast-tools input{box-sizing:border-box;width:100%;padding:7px;color:inherit;background:transparent;border:1px solid #82738b;border-radius:5px}.deus-cast-tools label{display:grid;gap:3px}.deus-cast-tools pre{white-space:pre-wrap}');
  const drawer = document.createElement('details');
  drawer.className = 'deus-cast-drawer';
  drawer.style.cssText = 'position:fixed;right:12px;bottom:76px;z-index:1500;max-width:min(360px,90vw);max-height:55vh;overflow:auto;background:#282232;color:#eee4f3;padding:8px 12px;border:1px solid #786486;border-radius:9px';
  drawer.hidden = false;
  const title = document.createElement('summary');
  title.textContent = 'Cast';
  drawer.append(title);
  document.body.append(drawer);
  const recover = document.createElement('button');
  recover.textContent = 'Find New Faces in this chat';
  const results = document.createElement('div');
  drawer.append(recover, results);
  // Store one small flag per NPC so independent dismissals never overwrite each other.
  function denialKey(chatId, label) {
    return 'deus_save_to_cast:denied:' + JSON.stringify([chatId,label.trim().toLowerCase()]);
  }
  function syncDenial(key) {
    for (const root of document.querySelectorAll('.deus-cast-tools')) {
      if (root.dataset.denialKey === key) root.dispatchEvent(new Event('cast-denial'));
    }
  }
  function storageChanged(event) { if (event.key?.startsWith('deus_save_to_cast:denied:')) syncDenial(event.key); }
  window.addEventListener('storage',storageChanged);
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
      results.textContent = unique.size ? data.destination+' · '+unique.size+' found' : 'No New Faces tags found in the stored replies for '+data.destination+'.';
      const deniedRows=document.createElement('details');
      const deniedTitle=document.createElement('summary');
      deniedTitle.textContent='Denied characters';
      deniedRows.append(deniedTitle);
      results.append(deniedRows);
      deniedRows.hidden=true;
      for (const row of unique.values()) {
        chats.set(row.messageId, data.chatId);
        const host = document.createElement('div');
        const key=denialKey(data.chatId,faceName(row.profile));
        function place() {
          const target=localStorage.getItem(key)==='1' ? deniedRows : results;
          if(host.parentElement!==target) target.append(host);
          deniedRows.hidden=deniedRows.childElementCount===1;
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
    const action=node('button',rawProfile ? 'Save to Cast · '+name : 'Save to Cast');
    const status=node('small',''); status.setAttribute('aria-live','polite');
    const deny=node('button','Deny');
    const identity=faceName(profile);
    function refreshDenial() {
      const denied = localStorage.getItem(root.dataset.denialKey) === '1';
      action.hidden=denied;
      deny.textContent=denied ? 'Undo deny' : 'Deny';
      if (denied) status.textContent=name+' · Denied';
      else if(status.textContent.endsWith(' · Denied')) status.textContent='';
    }
    root.addEventListener('cast-denial',refreshDenial);
    // A message ID survives reloads and links inline controls back to their chat.
    const sourceKey='deus_save_to_cast:source:'+messageId;
    const knownChat=chats.get(messageId) || localStorage.getItem(sourceKey);
    if(knownChat) {
      root.dataset.denialKey=denialKey(knownChat,identity);
      localStorage.setItem(sourceKey,knownChat);
      refreshDenial();
    } else {
      call({type:'scope'}).then(s=>{
        if (!root.isConnected) return;
        chats.set(messageId,s.chatId);
        localStorage.setItem(sourceKey,s.chatId);
        root.dataset.denialKey=denialKey(s.chatId,identity);
        refreshDenial();
      }).catch(e=>{status.textContent=e.message;});
    }
    deny.onclick=async()=>{
      deny.disabled=true;
      try {
        if (!root.dataset.denialKey) {
          const scope=await call({type:'scope',chatId:chats.get(messageId)});
          root.dataset.denialKey=denialKey(scope.chatId,identity);
          localStorage.setItem(sourceKey,scope.chatId);
        }
        const key=root.dataset.denialKey;
        if(localStorage.getItem(key)==='1') localStorage.removeItem(key);
        else localStorage.setItem(key,'1');
        syncDenial(key);
      } catch(e){status.textContent=e.message;} finally {deny.disabled=false;}
    };
    action.onclick=async()=>{
      action.disabled=true;deny.disabled=true;status.textContent='';
      const request={name,chatId:chats.get(messageId)};
      if (!name || /^new face$/i.test(name)) request.name=window.prompt('Name for this cast entry')?.trim();
      if (!request.name){action.disabled=deny.disabled=false;return;}
      try {
        const s=await call({...request,type:'lookup'});
        const panel=node('div',''); action.hidden=true;
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
            status.textContent='Saved to '+s.destination;action.textContent='Update';close();
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
  return ()=>{live=false;window.removeEventListener('storage',storageChanged);observer.disconnect();drawer.remove();document.querySelectorAll(".dem-new-face__body > .deus-cast-tools").forEach(el=>el.remove());off();style();ctx.dom.cleanup();};
}
