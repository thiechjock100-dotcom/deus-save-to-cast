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
  const faces = new Map();
  const detach = ["face","extra"].map(tagName=>ctx.messages.registerTagInterceptor({tagName},p=>{
    if (!p.messageId || !p.chatId || p.isUser || p.isStreaming) return;
    chats.set(p.messageId,p.chatId);
    const list=faces.get(p.messageId) || new Set();
    list.add(p.content.trim()); faces.set(p.messageId,list);
    requestAnimationFrame(()=>{if(live) scan();});
  }));
  const style = ctx.dom.addStyle('.deus-cast-tools{display:grid;gap:8px;padding:8px 0;color:inherit}.deus-cast-tools button{cursor:pointer;border:1px solid #8b7499;border-radius:7px;background:#32283d;color:#f3e4fb;padding:6px 12px;justify-self:start}.deus-cast-tools textarea,.deus-cast-tools input{box-sizing:border-box;width:100%;padding:7px;color:inherit;background:transparent;border:1px solid #82738b;border-radius:5px}.deus-cast-tools label{display:grid;gap:3px}.deus-cast-tools pre{white-space:pre-wrap}');
  const drawer = document.createElement('details');
  drawer.className = 'deus-cast-drawer';
  drawer.style.cssText = 'position:fixed;right:12px;bottom:76px;z-index:1500;max-width:min(360px,90vw);max-height:55vh;overflow:auto;background:#282232;color:#eee4f3;padding:8px 12px;border:1px solid #786486;border-radius:9px';
  drawer.hidden = true;
  const title = document.createElement('summary');
  title.textContent = 'Cast';
  drawer.append(title);
  document.body.append(drawer);
  const rows = new Map();
  function faceName(profile) {
    return profile.match(/^(?:Called|Seen as):[ \t]*([^|\n]+)/im)?.[1]?.trim() ||
      profile.match(/^Name:[ \t]*([^|\n]+)/im)?.[1]?.trim() ||
      profile.split('·')[0].split('\n')[0].trim() || 'New face';
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
    action.onclick=async()=>{
      action.disabled=true;status.textContent='';
      const request={name,chatId:chats.get(messageId)};
      if (!name || /^new face$/i.test(name)) request.name=window.prompt('Name for this cast entry')?.trim();
      if (!request.name){action.disabled=false;return;}
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
        function close(){panel.remove();action.hidden=false;action.disabled=false;}
        cancel.onclick=close;
        save.onclick=async()=>{
          save.disabled=cancel.disabled=true;
          try {
            await call({...request,type:'save',chatId:s.chatId,characterId:s.characterId,previous:s.old,content:content.value,keys:keys.value.split(',')});
            status.textContent='Saved to '+s.destination;action.textContent='Update';close();
          } catch(e){status.textContent=e.message;save.disabled=cancel.disabled=false;}
        };
      } catch(e){status.textContent=e.message;action.disabled=false;}
    };
  }
  function scan() {
    const wanted = new Map();
    for (const {messageId, element} of ctx.dom.listMessageElements()) {
      const cards = element.querySelectorAll('.dem-card.dem-new-face');
      for (const card of cards) add(card,messageId);
      if (cards.length) continue;
      for (const profile of faces.get(messageId) || []) {
        if (!profile) continue;
        const key = JSON.stringify([chats.get(messageId), faceName(profile).toLowerCase()]);
        wanted.set(key, {profile,messageId});
      }
    }
    for (const [key,row] of rows) {
      if (wanted.get(key)?.profile === row.profile) continue;
      row.host.remove();
      rows.delete(key);
    }
    for (const [key,{profile,messageId}] of wanted) {
      if (rows.has(key)) continue;
      const host = document.createElement('div');
      drawer.append(host);
      rows.set(key,{host,profile});
      add(host,messageId,profile);
    }
    drawer.hidden = !rows.size;
  }
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(live)scan();});}});
  observer.observe(document.body,{childList:true,subtree:true});scan();
  return ()=>{live=false;observer.disconnect();drawer.remove();document.querySelectorAll(".dem-new-face__body > .deus-cast-tools").forEach(el=>el.remove());off();detach.forEach(fn=>fn());style();ctx.dom.cleanup();};
}
