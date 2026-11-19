export const ROOT = '/deals/';
export const categories = {
  'AI 工具': ['ai', 'sparkles'],
  '开发工具': ['developer', 'terminal'],
  '效率软件': ['productivity', 'notes'],
  '设计创作': ['design', 'pen'],
  '云服务': ['cloud', 'cloud'],
  '实用工具': ['utilities', 'layers'],
};

export const topics = {
  developers: {title: '独立开发者工具箱', text: '开发、测试、部署的实用工具与服务。', icon: 'code', match: d => ['开发工具', '云服务'].includes(d.category)},
  lifetime: {title: '少一笔订阅负担', text: '有买断选项的软件，集中比较授权条件。', icon: 'receipt', match: d => d.oneTime},
  creators: {title: '创作者的灵感清单', text: '写作、设计与内容创作的效率工具。', icon: 'pen', match: d => ['AI 工具', '设计创作'].includes(d.category)},
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
const h = escapeHtml;
export const urlFor = d => ROOT + 'offer/' + d.slug + '/';
export const icon = (key, size = 20) => `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="${ROOT}assets/icons.svg#${key}"/></svg>`;
export const officialLabel = d => d.verified ? '商家已核实' : '社区收录';
export function productIcon(d) {
  const [slug, symbol] = categories[d.category];
  return `<span class="product-icon color-${slug}">${icon(symbol, 25)}</span>`;
}
const dayFormats = new Map();
function calendarDay(now, zone = 'Asia/Shanghai') {
  if (!dayFormats.has(zone)) dayFormats.set(zone, new Intl.DateTimeFormat('sv-SE', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}));
  return dayFormats.get(zone).format(now);
}
const clockFormat = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
export function activity(d, now = new Date()) {
  const day = calendarDay(now, d.dateZone);
  if (d.endsAt ? now >= new Date(d.endsAt) : d.end && day > d.end) return 'ended';
  if (d.startsAt ? now < new Date(d.startsAt) : d.start && day < d.start) return 'upcoming';
  if (d.end && (d.start || (d.observedLive && d.observedLive <= day))) return 'live';
  return day > '2026-12-31' ? 'archive' : 'unknown';
}
export const statuses = {all:'进行与预告',live:'正在进行',ending:'即将结束',upcoming:'即将开始',ended:'已结束',unknown:'日期待确认',archive:'往期收录'};
export function endingSoon(d, now) {
  if (activity(d, now) !== 'live' || !d.end) return false;
  if (d.endsAt) return new Date(d.endsAt) - now <= 48 * 3600_000;
  const diff = Date.parse(d.end) - Date.parse(calendarDay(now, d.dateZone));
  return diff >= 0 && diff < 2 * 86400_000;
}
export function shortDate(date, precise) {
  if (precise) return clockFormat.format(new Date(precise)).replace('/', '.');
  return date ? date.slice(5).replace('-', '.') : '';
}
export function timing(d, now) {
  const state = activity(d, now);
  if (state === 'upcoming') return shortDate(d.start, d.startsAt) + ' 开始';
  if (d.end) return shortDate(d.end, d.endsAt) + (state === 'ended' ? ' 已结束' : ' 截止');
  return '截止日期未公布';
}
export const note = d => d.cardNote || d.renewal || d.eligibility || (d.oneTime ? '买断授权，更新条款见活动说明。' : '续费条件未公布。');
export const iconButton = (name, symbol, attrs='') => `<button class="icon-button" type="button" aria-label="${h(name)}" ${attrs}>${icon(symbol,18)}</button>`;
export function price(d) {
  let unit = '';
  if (/^[$€£]/.test(d.offer)) {
    if (d.oneTime) unit = '买断';
    else if (d.plan.includes('首年')) unit = '首年';
    else if (d.plan.includes('年付')) unit = '年';
    else if (d.plan.includes('月付') || d.plan.includes('月最低')) unit = '月';
  }
  const distinct = d.discount && d.discount !== d.offer && !/^(最高)?省/.test(d.offer);
  return `<div class="price-line"><strong class="price">${h(d.offer)}</strong>${unit ? `<span class="unit">/ ${unit}</span>` : ''}${d.original ? `<s>${h(d.original)}</s>` : ''}${distinct ? `<span class="discount">${h(d.discount)}</span>` : ''}</div>`;
}
export function coupon(d) {
  return `<div class="coupon">${d.code ? `<span>优惠码</span> <code>${h(d.code)}</code><button class="copy js-only" type="button" data-copy="${h(d.code)}" aria-label="复制 ${h(d.name)} 优惠码">复制</button>` : `<span>${d.noCode ? '无需优惠码 · 自动优惠' : '优惠码未公布'}</span>`}</div>`;
}
export function statusBadge(d, now) {
  const state = activity(d, now);
  const soon = endingSoon(d, now);
  return `<span class="tag ${soon ? 'ending' : state}">${soon ? (d.endsAt ? '48 小时内结束' : '即将结束') : statuses[state]}</span>`;
}
export function card(d, now) {
  return `<article class="deal-card" data-card="${h(d.slug)}">
    <div class="card-head">${productIcon(d)}<div class="product"><h3><a href="${urlFor(d)}" data-detail="${h(d.slug)}">${h(d.name)}</a></h3><p>${h(d.category)} · ${h(d.plan.split(' · ')[0])}</p></div>
    ${iconButton('收藏 '+d.name,'bookmark',`data-save="${d.slug}" aria-pressed="false"`)}</div>
    <p class="summary">${h(d.summary)}</p>
    <div class="tags">${statusBadge(d,now)}<span class="tag evidence">${officialLabel(d)}</span>${d.existing ? '<span class="tag">老用户可用</span>' : ''}${d.oneTime && !d.existing ? '<span class="tag">可买断</span>' : ''}</div>
    ${price(d)}<p class="renewal">${h(note(d))}</p>
    ${coupon(d)}
    <div class="card-foot"><span class="time">${icon('clock',15)}${h(timing(d,now))}</span><label class="compare-option js-only"><input type="checkbox" data-compare="${d.slug}" aria-label="将 ${h(d.name)} 加入对比">对比</label><a class="details-link" href="${urlFor(d)}" data-detail="${d.slug}">优惠详情</a></div>
  </article>`;
}
const fullDate = (date, point) => point ? `${new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(point))}（北京时间）` : date ? date + '（来源仅提供日期）' : '未公布';
export function detailRows(d) {
  return [
    ['优惠范围', d.terms], ['适用资格', d.eligibility || '来源未说明新老用户限制'],
    ['续费与更新', d.renewal || '未公布续费或更新条款'],
    ['开始时间', fullDate(d.start,d.startsAt)], ['截止时间', fullDate(d.end,d.endsAt)],
  ];
}
export function detailBody(d, now, standalone=false) {
  const tag = standalone ? 'h1' : 'h2';
  return `<div class="detail-body"><div class="detail-product">${productIcon(d)}<div><p class="small-label">${h(d.category)} · ${h(d.plan)}</p><${tag} id="offer-title">${h(d.name)}</${tag}></div></div>
    <p class="detail-summary">${h(d.summary)}</p>
    <div class="tags">${statusBadge(d,now)}<span class="tag evidence">${officialLabel(d)}</span></div>
    <div class="price-panel">${price(d)}${coupon(d)}</div>
    <div class="detail-actions"><a class="primary" href="${h(d.merchant)}" target="_blank" rel="noopener noreferrer">前往商家查看</a><button class="secondary js-only" data-save="${d.slug}" aria-pressed="false">收藏优惠</button>${standalone ? '' : `<a class="permalink" href="${urlFor(d)}">独立详情页</a>`}</div>
    <dl class="rows">${detailRows(d).map(([label,value])=>`<div><dt>${label}</dt><dd>${h(value)}</dd></div>`).join('')}
    <div><dt>信息来源</dt><dd><a href="${h(d.source)}" target="_blank" rel="noopener noreferrer">社区清单原始记录</a>${d.verified ? ` · <a href="${h(d.merchant)}" target="_blank" rel="noopener noreferrer">商家活动依据</a>` : ''}<small>${officialLabel(d)} · ${h(d.checked)} 核对</small></dd></div></dl></div>`;
}
