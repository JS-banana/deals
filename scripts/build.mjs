import {readFile, writeFile, mkdir, cp, rename, rm, mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ROOT, categories, topics, activity, statuses, card, detailBody, escapeHtml as h, icon, urlFor} from '../site/catalog.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const text = file => readFile(path.join(project,file),'utf8');
const data = JSON.parse(await text('data/deals.json'));
const icons = JSON.parse(await text('site/icons.json'));
const origin = 'https://js-banana.github.io';
const absolute = route => origin + ROOT + route;
const now = new Date();
const slugs = new Set();
for (const d of data) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug) || slugs.has(d.slug)) throw Error('无效或重复的产品标识 '+d.slug);
  slugs.add(d.slug);
  for (const key of ['name','summary','offer','plan','terms','checked']) if (!d[key]) throw Error(d.slug+' 缺少 '+key);
  for (const key of ['merchant','source']) if (new URL(d[key]).protocol !== 'https:') throw Error(d.slug+' 链接须为 HTTPS');
  for (const key of ['start','end','checked']) if (d[key] && !/^\d{4}-\d{2}-\d{2}$/.test(d[key])) throw Error(d.slug+' 日期错误');
  for (const key of ['startsAt','endsAt']) if(d[key] && (!/(Z|[+-]\d\d:\d\d)$/.test(d[key]) || !Number.isFinite(Date.parse(d[key])))) throw Error(d.slug+' 时间错误');
  if (!categories[d.category] || (d.start && d.end && d.start>d.end)) throw Error(d.slug+' 分类或时间范围错误');
}
if (!data.length) throw Error('优惠目录为空');
const deals = data;
const cats = Object.entries(categories).filter(([name])=>data.some(d=>d.category===name));
const updated = deals.map(d=>d.checked).sort().at(-1);
const out = await mkdtemp(path.join(project,'.build-'));
const write = async (name, contents) => {
  const dest = path.join(out,name);
  await mkdir(path.dirname(dest),{recursive:true});
  await writeFile(dest,contents);
};

const brand = `<a class="brand" href="${ROOT}" aria-label="好价清单首页"><img src="${ROOT}assets/brand.svg" width="36" height="36" alt=""><span>好价清单<small>DEAL INDEX</small></span></a>`;
const links = (route, text, attrs='')=>`<a href="${ROOT}${route}" ${attrs}>${text}</a>`;
const asJson = value=>JSON.stringify(value).replace(/</g,'\\u003c');
const footer = `<footer class="shell footer"><div>${brand}<p>2026 黑五软件优惠清单</p></div><nav aria-label="网站信息">${links('about/','收录标准')}<a href="https://github.com/trungdq88/Awesome-Black-Friday-Cyber-Monday">数据来源</a><a href="https://github.com/JS-banana/deals/issues">反馈纠错</a>${links('sitemap.xml','网站地图')}</nav></footer>`;
const compareBar = `<aside id="compare-bar" class="compare-bar" hidden aria-label="优惠对比"><div><strong id="compare-count"></strong><small>最多选择 3 项</small></div><button id="clear-compare">清空</button><button id="show-compare" class="primary">比较优惠</button></aside>`;
const pages = [];
function page({route='',title,description,body,json={},schema,active='',noindex=false}) {
  const url = absolute(route);
  const header = `<a class="skip-link" href="#content">跳到主要内容</a>
  <div class="topline"><div class="shell"><span><b>黑五特辑</b> · 全球软件优惠</span><span lang="en">BLACK FRIDAY 2026</span></div></div>
  <header><div class="shell header-inner">${brand}<nav class="main-nav" aria-label="主导航">
  ${links('#discover','发现优惠',`data-nav="discover" class="${active==='discover'?'active':''}"`)}
  ${links('?status=ending#discover','即将结束','data-nav="ending"')}${links('#collections','精选专题','data-nav="collections"')}</nav>
  <div class="header-tools">${links('about/','收录标准','class="standards"')}${links('?saved=1#discover',icon('bookmark',18)+'<span>我的收藏</span><b id="saved-count" hidden></b>','class="saved-nav js-only" data-nav="saved"')}</div></div></header>`;
  if (!noindex) pages.push(url);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${h(title)}</title><meta name="description" content="${h(description)}"><meta name="theme-color" content="#1a2720">
  ${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
  <meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="好价清单"><meta property="og:title" content="${h(title)}"><meta property="og:description" content="${h(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${absolute('assets/share.png')}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="${ROOT}assets/brand.svg" type="image/svg+xml"><link rel="stylesheet" href="${ROOT}assets/style.css">
  ${schema ? `<script type="application/ld+json">${asJson({'@context':'https://schema.org',...schema})}</script>` : ''}</head>
  <body>${header}<main id="content" class="shell">${body}</main>${footer}${compareBar}
  <dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-head"><span id="dialog-title"></span><button class="icon-button" data-close aria-label="关闭">${icon('close',20)}</button></div><div id="dialog-body"></div></dialog>
  <div id="toast" role="status" aria-live="polite"></div><script id="page-data" type="application/json">${asJson(json)}</script><script type="module" src="${ROOT}assets/app.js"></script></body></html>`;
}
const search = `<form class="search" role="search" action="${ROOT}#discover" id="search-form">${icon('search')}<input id="search" name="q" type="search" aria-label="搜索工具、用途或优惠" placeholder="搜索工具、用途或优惠…" autocomplete="off"><button>搜索</button></form>`;
function hero(d) {
  const pct = d.discountPercent;
  const archived = ['ended','archive'].includes(activity(d,now));
  return `<section class="hero"><div class="hero-left"><div class="eyebrow"><i></i> BLACK FRIDAY, THOUGHTFULLY PICKED.</div><h1>好工具，<mark>好价格。</mark></h1><p>优惠力度、适用条件、续费价格，一次看清。</p>${search}
  <div class="quick">试试这些 ${links('category/ai/#discover','AI 工具','data-quick="ai"')} ${links('topic/lifetime/','买断软件','data-quick="lifetime"')} ${links('?existing=1#discover','老用户可用','data-quick="existing"')}</div></div>
  <article class="feature" data-feature="${d.slug}"><div class="feature-top">BLACK FRIDAY EDIT <span>${archived ? '往期精选' : '编辑精选'}</span></div><h2>${h(d.name)}</h2><p>${h(d.summary)}</p><div class="feature-pct">${pct ?? h(d.discount)}${pct ? '<small>% OFF</small>' : ''}</div><div class="ticket-art" aria-hidden="true">%</div>
  <div class="feature-bottom"><span><b>${h(d.offer)}</b> / 活动价</span>${d.original ? `<span><b>${h(d.original)}</b> / 原价</span>` : ''}<a href="${urlFor(d)}" data-detail="${d.slug}">优惠详情</a></div></article></section>
  <div class="season"><span><b>11.27</b> 黑色星期五</span><i></i><span><b>11.30</b> 网络星期一</span></div>`;
}
function topicCards() {
  return `<section id="collections" class="collections"><h2>从你的需要出发</h2><div class="topic-grid">${Object.entries(topics).map(([key,t])=>links('topic/'+key+'/',`<span class="topic-icon">${icon(t.icon,24)}</span><span><strong>${t.title}</strong><small>${t.text}</small></span>`,'class="topic-card"')).join('')}</div></section>`;
}
const breadcrumbs = current=>`<nav class="crumbs" aria-label="面包屑">${links('','好价清单')} <span>/</span> ${h(current)}</nav>`;
function categoryBar(selected) {
  return `<nav class="categories" aria-label="优惠分类">${[['全部优惠',['all','grid']],...cats].map(([name,[key,symbol]])=> links(key==='all'?'#discover':'category/'+key+'/#discover',icon(symbol,18)+h(name),`class="category ${selected===key?'selected':''}" data-category="${key}"`)).join('')}</nav>`;
}
function listing({kind='home', key='all', name='发现好价',intro='', list=deals}={}) {
  const isHome = kind === 'home';
  return `${isHome ? hero(deals[0]) : breadcrumbs(name)}
    <section id="discover" class="discovery"><div class="heading"><div><${isHome?'h2':'h1'} id="list-title" tabindex="-1">${h(name)}</${isHome?'h2':'h1'}><p id="result-count" aria-live="polite">${list.length} 条优惠</p></div><span class="meta">${icon('globe',16)} 原币标价 · 按来源日期</span></div>
    ${!isHome ? `<p class="intro">${h(intro)}</p>${search}` : ''}
    ${categoryBar(kind==='category'?key:isHome?'all':'')}
    <div class="filters js-only"><div class="tabs" aria-label="活动状态">${['all','live','ending','upcoming','ended'].map(k=>`<button type="button" data-status="${k}" aria-pressed="${k==='all'}">${statuses[k]}</button>`).join('')}</div>
    <div class="options"><label><input type="checkbox" id="existing"> 老用户可用</label><label><input type="checkbox" id="lifetime"> 一次买断</label><select id="sort" aria-label="优惠排序"><option value="curated">编辑精选</option><option value="ending">最早结束</option><option value="discount">折扣最大</option></select></div></div>
    <div class="filter-state" hidden><span id="filter-label"></span><button id="clear-filters">清空筛选</button></div>
    <div id="grid" class="grid">${list.map(d=>card(d,now)).join('')}</div><div id="more-wrap" class="more-wrap" hidden><button id="more"></button></div>
    </section>${topicCards()}`;
}
function listSchema(name,list,desc) {
  return {'@type':'CollectionPage',name,description:desc,inLanguage:'zh-CN',mainEntity:{'@type':'ItemList',numberOfItems:list.length,itemListElement:list.map((d,i)=>({'@type':'ListItem',position:i+1,name:d.name,url:origin+urlFor(d)}))}};
}
async function buildListing(kind,key,name,intro,list,route,title){
  await write(route+'index.html',page({route,title,description:intro,body:listing({kind,key,name,intro,list}),active:'discover',json:{kind,key,name,deals:list},schema:listSchema(title,list,intro)}));
}
await buildListing('home','all','发现好价','查找 2026 黑色星期五与网络星期一的软件优惠。按用途比较实付价格、折扣、续费条件、优惠码和截止日期，每条活动都可追溯来源。',deals,'','2026 黑五软件优惠与折扣码 · 好价清单');
for(const [name,[key]] of cats) {
  const list = deals.filter(d=>d.category===name);
  await buildListing('category',key,name,`${name}的 2026 黑五活动，收录 ${list.slice(0,3).map(d=>d.name).join('、')} 等产品的优惠范围、价格和使用条件。`,list,'category/'+key+'/',name+'黑五优惠与活动时间 · 好价清单');
}
for(const [key,t] of Object.entries(topics)) {
  const list = deals.filter(t.match);
  if(list.length) await buildListing('topic',key,t.title,t.text,list,'topic/'+key+'/',t.title+' · 2026 黑五专题 · 好价清单');
}
for(const d of deals) {
  const catRoute='category/'+categories[d.category][0]+'/';
  const route='offer/'+d.slug+'/';
  const crumb = `<nav class="crumbs" aria-label="面包屑">${links('','好价清单')}<span>/</span>${links(catRoute,h(d.category))}<span>/</span>${h(d.name)}</nav>`;
  const similar = deals.filter(item=>item.category===d.category&&item!==d).slice(0,3);
  const related = similar.length ? `<section class="related"><h2>同类优惠</h2><div class="grid">${similar.map(item=>card(item,now)).join('')}</div></section>` : '';
  await write(route+'index.html',page({route,title:d.name+' 黑五优惠 · '+d.offer+' · 好价清单',description:`${d.summary} ${d.plan}，${d.offer}。${d.terms}`,body:crumb+`<article class="standalone">${detailBody(d,now,true)}</article>`+related,json:{kind:'offer',current:d.slug,deals:[d,...similar]},schema:{'@type':'BreadcrumbList',itemListElement:[['好价清单',''],[d.category,catRoute],[d.name,route]].map(([name,part],i)=>({'@type':'ListItem',position:i+1,name,item:absolute(part)}))}}));
}
const about = `<article class="about"><h1>收录标准</h1><p>好价清单整理全球软件的黑五活动。每条记录都保留来源，方便你在购买前复核。</p><h2>商家已核实与社区收录</h2><p>“商家已核实”表示核对时能在商家公开页面找到当季活动依据。“社区收录”来自社区清单；进入详情可查看对应的原始记录与核对日期。</p><h2>价格、日期与资格</h2><p>按来源保留原币、套餐、首期价格和续费条件。精确时间换算为北京时间；只公布日期的活动保留原日期。已知时区的活动按当地日历判断状态，其余按北京时间的日历日期展示。未知条件会注明。活动价以商家结算页为准。</p><h2>收藏与反馈</h2><p>收藏保存在当前浏览器。发现价格变化或链接失效，可以通过<a href="https://github.com/JS-banana/deals/issues">问题反馈</a>附上活动地址。</p><p>首批数据来自 <a href="https://github.com/trungdq88/Awesome-Black-Friday-Cyber-Monday">Awesome Black Friday / Cyber Monday</a>。最近一次资料核对为 ${updated}。</p></article>`;
await write('about/index.html',page({route:'about/',title:'收录标准与数据来源 · 好价清单',description:'了解好价清单的软件优惠数据来源、核实标准、时间口径及反馈方式。',body:breadcrumbs('收录标准')+about}));
await write('404.html',page({route:'404.html',title:'页面未找到 · 好价清单',description:'回到软件黑五优惠目录。',noindex:true,body:`<article class="about"><h1>这个页面不存在</h1>${links('','返回发现优惠','class="primary"')}</article>`}));
await write('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+pages.map(url=>`  <url><loc>${h(url)}</loc></url>`).join('\n')+'\n</urlset>\n');
await write('robots.txt','User-agent: *\nAllow: /\nSitemap: '+absolute('sitemap.xml')+'\n');
await write('.nojekyll','');
await write('assets/icons.svg','<svg xmlns="http://www.w3.org/2000/svg">'+Object.entries(icons).map(([key,shape])=>`<symbol id="${key}" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${shape}</g></symbol>`).join('')+'</svg>');
for(const name of ['brand.svg','style.css','app.js','catalog.js','share.png']) await cp(path.join(project,'site',name),path.join(out,'assets',name));
const dist = path.join(project,'dist');
await rm(dist,{recursive:true,force:true});
await rename(out,dist);
console.log(`已生成 ${deals.length} 条优惠、${cats.length} 个分类、${pages.length} 个可索引页面。`);
