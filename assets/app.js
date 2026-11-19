import {ROOT, activity, categories, card, detailBody, endingSoon, escapeHtml as h, icon, statuses} from './catalog.js';

const page = JSON.parse(document.querySelector('#page-data').textContent);
const deals = page.deals || [];
const bySlug = new Map(deals.map(d=>[d.slug,d]));
const $ = id => document.getElementById(id);
const grid = $('grid');
const dialog = $('dialog');
const home = page.kind === 'home';
const storageKey = 'deal-index:favorite-offers';
const compare = new Set();
function readSaved() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter(s=>typeof s==='string') : []);
  } catch { return new Set(); }
}
let saved = readSaved();
let storageWritable = true;
let limit = 6;
let state;
let opener;
let pinnedNav;
let toastTimer;
const scrollTo = id => $(id)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>$('toast').classList.remove('visible'),2100);
}
function initialState() {
  const params = new URLSearchParams(location.search);
  const noCurrent = deals.length && deals.every(d=>['ended','archive'].includes(activity(d)));
  const selectedStatus = params.get('status');
  return {
    category: home && Object.values(categories).some(([s])=>s===params.get('category')) ? params.get('category') : 'all',
    status: ['all','live','ending','upcoming','ended'].includes(selectedStatus) ? selectedStatus : noCurrent ? 'ended' : 'all',
    query: params.get('q') || '', sort: ['ending','discount'].includes(params.get('sort')) ? params.get('sort') : 'curated',
    existing: params.get('existing') === '1', lifetime: params.get('lifetime') === '1', saved: params.get('saved') === '1',
  };
}
function writeState() {
  const url = new URL(location.href);
  for (const [key,value] of Object.entries({category:state.category!=='all'&&state.category,status:state.status!=='all'&&state.status,q:state.query,sort:state.sort!=='curated'&&state.sort,existing:state.existing&&'1',lifetime:state.lifetime&&'1',saved:state.saved&&'1'})) {
    if (value) url.searchParams.set(key,value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null,'',url);
}
function filtered(now) {
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = deals.filter(d=>{
    const a = activity(d,now);
    if ((state.saved && !saved.has(d.slug)) || (state.existing && !d.existing) || (state.lifetime && !d.oneTime)) return false;
    if (state.category !== 'all' && categories[d.category][0] !== state.category) return false;
    if (state.status === 'ending' && !endingSoon(d,now)) return false;
    if (state.status === 'ended' && a!=='ended' && a!=='archive') return false;
    if (state.status === 'all' && !state.saved && (a === 'ended' || a === 'archive')) return false;
    if (['upcoming','live'].includes(state.status) && a!==state.status) return false;
    const content = [d.name,d.summary,d.category,d.plan,d.code,d.terms,d.eligibility].filter(Boolean).join(' ').toLowerCase();
    return words.every(word=>content.includes(word));
  });
  if (state.sort === 'discount') list.sort((a,b)=>(b.discountPercent ?? -1)-(a.discountPercent ?? -1));
  if (state.sort === 'ending') list.sort((a,b)=>(a.end || '9999').localeCompare(b.end || '9999'));
  return list;
}
function markSaved() {
  $('saved-count').hidden = !saved.size;
  $('saved-count').textContent = saved.size;
  document.querySelectorAll('[data-save]').forEach(el=>{
    const id = el.dataset.save;
    const on = saved.has(id);
    el.setAttribute('aria-pressed',String(on));
    if (el.classList.contains('icon-button')) el.setAttribute('aria-label',(on?'取消收藏 ':'收藏 ')+(bySlug.get(id)?.name||'优惠'));
    else el.textContent = on?'已收藏':'收藏优惠';
  });
}
function markCompare() {
  document.querySelectorAll('[data-compare]').forEach(el=>el.checked=compare.has(el.dataset.compare));
  $('compare-bar').hidden = !compare.size;
  document.body.classList.toggle('comparing',!!compare.size);
  $('compare-count').textContent = '已选 '+compare.size+' 项优惠';
  $('show-compare').disabled = compare.size<2;
}
function nav() {
  const key=state?.saved?'saved':state?.status==='ending'?'ending':pinnedNav || (grid?'discover':'');
  document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===key));
}
function render() {
  const now = new Date();
  const list = filtered(now);
  const name = Object.entries(categories).find(([,v])=>v[0]===state.category)?.[0];
  $('list-title').textContent = state.saved?'我的收藏':name || page.name;
  $('result-count').textContent = list.length + ' 条优惠';
  const selectedCategory = home ? state.category : page.kind==='category' ? page.key : '';
  document.querySelectorAll('[data-category]').forEach(el=>{
    const selected=el.dataset.category===selectedCategory;
    el.classList.toggle('selected',selected);
    if(selected) el.setAttribute('aria-current','true'); else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-status]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.status===state.status)));
  $('existing').checked = state.existing;
  $('lifetime').checked = state.lifetime;
  $('sort').value = state.sort;
  if ($('search').value !== state.query) $('search').value = state.query;
  const labels = [name,state.query && '搜索「'+state.query+'」',state.saved&&'我的收藏',state.status!=='all'&&statuses[state.status],state.existing&&'老用户可用',state.lifetime&&'一次买断'].filter(Boolean);
  document.querySelector('.filter-state').hidden = !labels.length;
  $('filter-label').textContent = labels.join(' · ');
  const emptyTitle = state.saved && !saved.size ? '还没有收藏的优惠' : '没有找到符合条件的优惠';
  const emptyBody = state.saved && !saved.size ? '点击卡片上的书签，就能在这里再次找到它。' : '可以清空筛选，或换个关键词继续找。';
  grid.innerHTML = list.length ? list.slice(0,limit).map(d=>card(d,now)).join('') : `<div class="empty">${icon(state.saved?'bookmark':'search',32)}<h3>${emptyTitle}</h3><p>${emptyBody}</p><button data-reset>浏览全部优惠</button></div>`;
  $('more-wrap').hidden = list.length<=limit;
  $('more').textContent = '查看更多优惠（剩余 '+Math.max(0,list.length-limit)+' 条）';
  markSaved();
  markCompare();
  nav();
}
function update(changes,reset=false) {
  limit = 6;
  pinnedNav = '';
  if (reset) state = {category:'all',query:'',status:'all',sort:'curated',existing:false,lifetime:false,saved:false};
  Object.assign(state,changes);
  render();
  writeState();
}
function save(id) {
  // Merge other tabs when storage is available; retain in-memory changes when writes fail.
  if (storageWritable) saved = readSaved();
  const adding = !saved.has(id);
  if (adding) saved.add(id); else saved.delete(id);
  let persisted=true;
  try { localStorage.setItem(storageKey,JSON.stringify([...saved])); } catch { persisted=false; storageWritable=false; }
  if (grid && state.saved) render(); else markSaved();
  toast(adding ? (persisted ? '已收藏，保存在当前浏览器' : '已收藏，仅在本页有效') : '已取消收藏');
}
function openDialog(title,body,trigger,variant) {
  opener=trigger;
  $('dialog-title').textContent=title;
  $('dialog-body').innerHTML=body;
  dialog.className=variant;
  dialog.showModal();
  dialog.scrollTop=0;
  document.body.classList.add('modal-open');
  markSaved();
}
function comparison() {
  const chosen = [...compare].map(slug=>bySlug.get(slug)).filter(Boolean);
  const rows = [
    ['套餐范围', d=>d.plan],['活动价', d=>d.offer],['原价',d=>d.original || '未公布'],['折扣',d=>d.discount || '未公布'],
    ['续费与更新',d=>d.renewal || '未公布'],['适用资格',d=>d.eligibility || '未说明'],['优惠码',d=>d.code || (d.noCode?'无需优惠码':'未公布')],
    ['活动截止',d=>d.endsAt ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(d.endsAt))+'（北京时间）' : d.end || '未公布'],['条款',d=>d.terms],
  ];
  return `<div class="compare-content"><div class="table-scroll" tabindex="0" aria-label="优惠比较表，可横向滚动"><table><thead><tr><th scope="col">比较项目</th>${chosen.map(d=>`<th scope="col">${h(d.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([name,get])=>`<tr><th scope="row">${name}</th>${chosen.map(d=>`<td>${h(get(d))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
async function copy(button) {
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent='已复制';
    setTimeout(()=>{button.textContent='复制';},1800);
    toast('优惠码已复制');
  } catch {
    const code = button.closest('.coupon').querySelector('code');
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    toast('已选中优惠码，可手动复制');
  }
}
document.addEventListener('click',event=>{
  const el=event.target.closest('a,button');
  if (!el || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const {detail,save:id,copy:code,status,category,quick,nav:key}=el.dataset;
  if (detail && bySlug.has(detail)) {
    event.preventDefault();
    openDialog('优惠详情',detailBody(bySlug.get(detail),new Date()),el,'detail-dialog');
  } else if (id) save(id);
  else if (code) copy(el);
  else if (el.hasAttribute('data-close')) dialog.close();
  else if (el.id==='show-compare') openDialog('优惠对比',comparison(),el,'compare-dialog');
  else if (el.id==='clear-compare') {compare.clear();markCompare();}
  else if (grid && status) update({status});
  else if (home && category) {event.preventDefault();update({category});}
  else if (home && quick) {
    event.preventDefault();
    update(quick==='ai'?{category:'ai'}:{[quick]:true},true);scrollTo('discover');
  } else if (home && ['discover','ending','saved'].includes(key)) {
    event.preventDefault();
    update(key==='ending'?{status:'ending'}:key==='saved'?{saved:!state.saved}:{},true);scrollTo('discover');
  } else if (grid && key==='collections') {
    event.preventDefault();pinnedNav='collections';nav();scrollTo('collections');
  } else if (grid && (el.id==='clear-filters'||el.hasAttribute('data-reset'))) {
    update(deals.every(d=>['ended','archive'].includes(activity(d)))?{status:'ended'}:{},true);
    $('list-title').focus({preventScroll:true});
  } else if (el.id==='more') {
    const firstNew=limit;
    limit+=12;render();
    grid.children[firstNew]?.querySelector('h3 a')?.focus({preventScroll:true});
  }
});
document.addEventListener('change',event=>{
  const el=event.target, id=el.dataset.compare;
  if(id) {
    if(el.checked && compare.size===3) {el.checked=false;toast('最多同时对比 3 项优惠');}
    else if(el.checked) compare.add(id); else compare.delete(id);
    markCompare();
  } else if(grid && ['existing','lifetime','sort'].includes(el.id)) update({[el.id]:el.id==='sort'?el.value:el.checked});
});
dialog.addEventListener('click',event=>{
  if(event.target!==dialog) return;
  const r=dialog.getBoundingClientRect();
  if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) dialog.close();
});
dialog.addEventListener('close',()=>{
  document.body.classList.remove('modal-open');
  (opener?.isConnected ? opener : $('list-title'))?.focus({preventScroll:true});
});
window.addEventListener('storage',event=>{
  if (event.key!==storageKey && event.key!==null) return;
  saved=readSaved();
  if(grid && state.saved) render(); else markSaved();
});
if (grid) {
  state=initialState();
  const feature = document.querySelector('[data-feature]');
  if (feature && ['ended','archive'].includes(activity(bySlug.get(feature.dataset.feature)))) {
    feature.querySelector('.feature-top span').textContent = '往期精选';
  }
  $('search').addEventListener('input',event=>update({query:event.target.value}));
  $('search-form').addEventListener('submit',event=>{event.preventDefault();scrollTo('discover');});
  render();
} else {
  markSaved();
  if(page.kind==='offer') {
    const article=document.querySelector('.standalone');
    article.innerHTML=detailBody(bySlug.get(page.current),new Date(),true);
    document.querySelectorAll('[data-card]').forEach(el=>{el.outerHTML=card(bySlug.get(el.dataset.card),new Date());});
    markSaved();
  }
}
document.documentElement.classList.add('interactive');
