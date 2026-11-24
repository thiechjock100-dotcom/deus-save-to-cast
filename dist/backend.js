const books = spindle.world_books;
const normalize = text => text.trim().toLowerCase();
async function collect(list) {
  const rows = [];
  while (true) {
    const page = await list({offset: rows.length, limit: 100});
    rows.push(...page.data);
    if (!page.data.length || rows.length >= page.total) return rows;
  }
}
async function handle(p, userId) {
  const chat = p.chatId ? await spindle.chats.get(p.chatId, userId) : await spindle.chats.getActive(userId);
  if (p.type === "scope" && chat) return {chatId:chat.id};
  const char = chat && await spindle.characters.get(chat.character_id, userId);
  if (!char) throw Error("Open a chat with an RPG character card.");
  if (p.characterId && char.id !== p.characterId) throw Error("The active RPG changed. Reopen this card.");
  if (p.type === "history") {
    const messages = await spindle.chat.getMessages(chat.id, {light:true, includeExtra:false, ownMetadataOnly:true});
    const faces = [];
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const match of msg.content.matchAll(/<(face|extra)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
        const profile = match[2].trim();
        if (profile) faces.push({messageId:msg.id,profile});
      }
    }
    return {chatId:chat.id, destination:char.name, faces};
  }
  const owned = (await collect(opts => books.list({...opts, userId}))).filter(b => b.metadata?.deusCastOwner === char.id);
  if (owned.length > 1) throw Error("Multiple cast books belong to this card. Resolve the duplicate in World Books.");
  let book = owned[0];
  const entries = book ? await collect(opts => books.entries.list(book.id, {...opts, userId})) : [];
  const name = String(p.name || '').trim();
  if (!name) throw Error("Give this NPC a name first.");
  const matches = entries.filter(e => [e.comment, ...e.key].some(k => normalize(k) === normalize(name)));
  if (matches.length > 1) throw Error("Several entries share that name. Use a unique full name.");
  const old = matches[0];
  const state = {characterId: char.id, chatId: chat.id, destination: char.name + " · Cast", old: old ? {id:old.id, content:old.content, keys:old.key} : null};
  if (p.type === "lookup") return state;
  if (!p.characterId || !p.content?.trim() || !Array.isArray(p.keys)) throw Error("Review the profile before saving.");
  if (JSON.stringify(state.old) !== JSON.stringify(p.previous)) throw Error("The saved profile changed. Reopen the review.");
  if (!book) book = await books.create({name:state.destination, metadata:{deusCastOwner:char.id}}, userId);
  const fresh = await spindle.characters.get(char.id, userId);
  if (!fresh.world_book_ids.includes(book.id)) await spindle.characters.update(char.id, {world_book_ids:[...fresh.world_book_ids,book.id]}, userId);
  const key = [...new Set([name,...p.keys.map(k=>k.trim()).filter(Boolean)])];
  const change = {key, content:p.content.trim()};
  if (old) await books.entries.update(old.id,change, userId);
  else await books.entries.create(book.id,{...change,comment:name,constant:false,selective:false,disabled:false}, userId);
  return {saved:true};
}
let queue = Promise.resolve();
spindle.onFrontendMessage((p,userId) => {
  if (!p || !["lookup","save","history","scope"].includes(p.type) || !p.requestId) return;
  queue = queue.then(async () => {
    try { spindle.sendToFrontend({requestId:p.requestId,result:await handle(p, userId)},userId); }
    catch (e) { spindle.sendToFrontend({requestId:p.requestId,error:String(e.message || e)},userId); }
  }).catch(e=>spindle.log.error(String(e)));
});
