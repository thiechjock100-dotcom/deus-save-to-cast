export function setup(ctx) {
  const pending = new Map();
  const off = ctx.onBackendMessage(m => pending.get(m.requestId)?.(m));
  function call(data) {
    return new Promise((resolve,reject) => {
      const requestId = ctx.uuid.v4();
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
  function add(card,messageId,rawProfile) {
    const body = rawProfile ? card : card.querySelector('.dem-new-face__body');
    const profile = rawProfile || body?.querySelector('pre code,pre')?.textContent.trim() || body?.textContent.match(/```(?:yaml|text)?\s*([\s\S]*?)```/)?.[1].trim();
    if (!profile || body.querySelector('.deus-cast-tools')) return;
    const name = card.querySelector('.dem-card__title')?.textContent.trim() || profile.match(/^(?:Called|Seen as|Name):\s*([^|\n]+)/im)?.[1]?.trim() || 'New face';
    const root = ctx.dom.inject(body,'<div class="deus-cast-tools"></div>','beforeend').querySelector('.deus-cast-tools');
    if (!root) return;
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
  function scan(){for(const {messageId,element} of ctx.dom.listMessageElements()) {
    const cards=element.querySelectorAll('.dem-card.dem-new-face');
    if(cards.length){for(const card of cards) add(card,messageId);continue;}
    for(const profile of faces.get(messageId) || []){
      if(!profile || [...element.querySelectorAll('.deus-cast-fallback')].some(el=>el.dataset.profile===profile))continue;
      const host=ctx.dom.inject(element,'<div class="deus-cast-fallback"></div>','beforeend').querySelector('.deus-cast-fallback');
      if(host){host.dataset.profile=profile;add(host,messageId,profile);}
    }
  }}
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(live)scan();});}});
  observer.observe(document.body,{childList:true,subtree:true});scan();
  return ()=>{live=false;observer.disconnect();off();detach.forEach(fn=>fn());style();ctx.dom.cleanup();};
}
