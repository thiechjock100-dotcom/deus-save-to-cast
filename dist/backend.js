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
async function handle(p) {
  const chat = p.chatId ? await spindle.chats.get(p.chatId) : await spindle.chats.getActive();
  const char = chat && await spindle.characters.get(chat.character_id);
  if (!char) throw Error("Open a chat with an RPG character card.");
  if (p.characterId && char.id !== p.characterId) throw Error("The active RPG changed. Reopen this card.");
  const owned = (await collect(opts => books.list(opts))).filter(b => b.metadata?.deusCastOwner === char.id);
  if (owned.length > 1) throw Error("Multiple cast books belong to this card. Resolve the duplicate in World Books.");
  let book = owned[0];
  const entries = book ? await collect(opts => books.entries.list(book.id, opts)) : [];
  const name = String(p.name || '').trim();
  if (!name) throw Error("Give this NPC a name first.");
  const matches = entries.filter(e => [e.comment, ...e.key].some(k => normalize(k) === normalize(name)));
  if (matches.length > 1) throw Error("Several entries share that name. Use a unique full name.");
  const old = matches[0];
  const state = {characterId: char.id, chatId: chat.id, destination: char.name + " · Cast", old: old ? {id:old.id, content:old.content, keys:old.key} : null};
  if (p.type === "lookup") return state;
  if (!p.characterId || !p.content?.trim() || !Array.isArray(p.keys)) throw Error("Review the profile before saving.");
  if (JSON.stringify(state.old) !== JSON.stringify(p.previous)) throw Error("The saved profile changed. Reopen the review.");
  if (!book) book = await books.create({name:state.destination, metadata:{deusCastOwner:char.id}});
  const fresh = await spindle.characters.get(char.id);
  if (!fresh.world_book_ids.includes(book.id)) await spindle.characters.update(char.id, {world_book_ids:[...fresh.world_book_ids,book.id]});
  const key = [...new Set([name,...p.keys.map(k=>k.trim()).filter(Boolean)])];
  const change = {key, content:p.content.trim()};
  if (old) await books.entries.update(old.id,change);
  else await books.entries.create(book.id,{...change,comment:name,constant:false,selective:false,disabled:false});
  return {saved:true};
}
let queue = Promise.resolve();
spindle.onFrontendMessage((p,userId) => {
  if (!p || !["lookup","save"].includes(p.type) || !p.requestId) return;
  queue = queue.then(async () => {
    try { spindle.sendToFrontend({requestId:p.requestId,result:await handle(p)},userId); }
    catch (e) { spindle.sendToFrontend({requestId:p.requestId,error:String(e.message || e)},userId); }
  }).catch(e=>spindle.log.error(String(e)));
});
