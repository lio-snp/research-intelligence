'use strict';

const $ = id => document.getElementById(id);
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = url => { try { const u = new URL(url); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const link = (label, url) => safeURL(url) ? `<a href="${e(safeURL(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
const button = (label, action, id = '', cls = '') => `<button type="button" class="${cls}" data-action="${action}" data-id="${e(id)}">${e(label)}</button>`;
const badge = (label, cls = '') => `<span class="badge ${cls}">${e(label)}</span>`;
const stages = {candidate:'待判断',reading:'阅读中',contact:'准备联系',contacted:'已联系',paused:'暂缓'};
const statuses = {unread:'未读',reading:'阅读中',read:'已读'};
const meta = name => document.querySelector(`meta[name="${name}"]`)?.content || '';
const runtime = {mode:meta('ri-mode') === 'public' ? 'public' : 'local', version:meta('ri-version') || '3.2.0'};
const isPublic = () => runtime.mode === 'public';
const optionalArray = value => Array.isArray(value) ? value : [];
const emptyWorkspace = () => ({schemaVersion:1,revision:0,updatedAt:null,researcherNotes:{},paperNotes:{},ideas:[],customResearchers:[]});
const publicDisabledActions = new Set(['ideas','add-candidate','edit-candidate','new-idea','edit-idea','brief','download-brief','export','import','confirm-import']);
let catalog, workspace, busy = false, pendingImport = null, briefText = '', noticeTimer, atlasController, atlasModel, paperOrigin = null;
const atlasState = {selected:null,camera:null,overview:true,expanded:false};
const dirty = new Set();
let view = {page:'themes', theme:null, atlasTheme:null, type:null, id:null, search:'', institution:'all', verification:'all', stage:'all', scholarTab:'publications', candidateTab:'profiles', themeLens:'cluster', themeEntity:'all', authorContext:null, ...PublicationModel.defaults};
function normalizeCatalog(raw = {}) {
  const rawQuestions = optionalArray(raw.questions);
  const questions = rawQuestions.map(q => {
    const paperIds = optionalArray(q.paperIds);
    const id = q.id || (paperIds.length === 1 ? `q_${paperIds[0]}` : '');
    return {...q,id,paperIds,clusterIds:optionalArray(q.clusterIds),basis:q.basis || (q.evidence?.field === 'summary.question' || q.evidenceField === 'researchQuestion' ? 'full_text_summary' : 'abstract_summary')};
  });
  const questionClusters = optionalArray(raw.questionClusters).map(c => ({...c,paperIds:optionalArray(c.paperIds),questionIds:optionalArray(c.questionIds),researcherIds:optionalArray(c.researcherIds),themes:optionalArray(c.themes),basis:c.basis || 'editorial_synthesis'}));
  const normalizedPapers = optionalArray(raw.papers).map(p => {
    const paperQuestions = questions.filter(q => q.paperIds.includes(p.id));
    const q = paperQuestions[0];
    const questionId = p.questionId ?? q?.id ?? (p.researchQuestion ? `q_${p.id}` : null);
    const researchQuestion = p.researchQuestion || q?.text || '';
    const draft = {...p,authors:optionalArray(p.authors),authorships:optionalArray(p.authorships),researcherIds:optionalArray(p.researcherIds),themes:optionalArray(p.themes),paradigms:optionalArray(p.paradigms),sources:optionalArray(p.sources),versions:optionalArray(p.versions),questionId,researchQuestion};
    return {...draft,questionStatus:PublicationModel.normalizedQuestionStatus(draft,questions)};
  });
  const coverage = raw.questionCoverage || PublicationModel.questionCoverage(normalizedPapers,questions,questionClusters,optionalArray(raw.themes));
  return {
    ...raw,
    themes: optionalArray(raw.themes),
    paradigms: optionalArray(raw.paradigms),
    researchers: optionalArray(raw.researchers).map(r => ({...r,themes:optionalArray(r.themes),topics:optionalArray(r.topics),sources:optionalArray(r.sources),researchLines:optionalArray(r.researchLines),questionsToVerify:optionalArray(r.questionsToVerify)})),
    questions,
    questionClusters,
    questionCoverage: coverage,
    programs: optionalArray(raw.programs).map(g => ({...g,paperIds:optionalArray(g.paperIds)})),
    papers: normalizedPapers,
    publicationStats: raw.publicationStats || {}
  };
}
const allResearchers = () => {
  const records = new Map(catalog.researchers.map(r => [r.id,r]));
  // A later source verification must not be hidden by an older personal seed edit.
  if(!isPublic()) for(const r of optionalArray(workspace.customResearchers)) if(records.get(r.id)?.verification !== 'verified') records.set(r.id,r);
  return [...records.values()];
};
const researcher = id => allResearchers().find(r => r.id === id);
const paper = id => catalog.papers.find(p => p.id === id);
const question = id => catalog.questions.find(q => q.id === id);
const paperQuestion = p => PublicationModel.questionForPaper(p,catalog.questions);
const cluster = id => catalog.questionClusters.find(c => c.id === id);
const authorPapers = id => catalog.papers.filter(p => p.researcherIds.includes(id));
const selectedPapers = id => authorPapers(id).filter(p=>p.selectedReading).sort((a,b)=>(a.readingOrder||99)-(b.readingOrder||99));
const researcherNote = id => workspace.researcherNotes[id] || {stage:'candidate',note:'',nextAction:''};
const paperNote = id => workspace.paperNotes[id] || {status:'unread',note:'',extension:''};
const verified = r => r.verification === 'verified';
const sources = list => `<div class="source-list">${(list || []).map(s => link(s.label,s.url)).join('')}</div>`;
const empty = (title, text) => `<div class="empty"><h3>${e(title)}</h3><p>${e(text)}</p></div>`;
const intro = (eyebrow,title,text) => `<div class="intro"><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1><p>${e(text)}</p></div>`;
const section = (title,body,extra='') => `<section class="section"><div class="section-head"><h2>${e(title)}</h2>${extra}</div>${body}</section>`;
const crumbs = items => `<div class="crumbs">${[button('主题地图','themes'),...items].join('<span> / </span>')}</div>`;
const themeChips = ids => `<div class="chips">${ids.map(id => {const t=catalog.themes.find(t=>t.id===id);return t ? button(t.name,'theme',id,'chip') : '';}).join('')}</div>`;
const optionHTML = (options,current) => Object.entries(options).sort(([a],[b])=>a==='all'?-1:b==='all'?1:/^\d{4}$/.test(a)&&/^\d{4}$/.test(b)?Number(b)-Number(a):0).map(([value,label])=>`<option value="${e(value)}" ${value===current?'selected':''}>${e(label)}</option>`).join('');
const selectField = (label,name,options,value) => `<label class="field">${e(label)}<select name="${name}">${optionHTML(options,value)}</select></label>`;
const textField = (label,name,value='',limit=3000,rows=4) => `<label class="field">${e(label)}<textarea name="${name}" maxlength="${limit}" rows="${rows}">${e(value)}</textarea></label>`;
const inputField = (label,name,value='',limit=160,required=false,type='text') => `<label class="field">${e(label)}<input name="${name}" type="${type}" value="${e(value)}" maxlength="${limit}" ${required?'required':''}></label>`;

function notify(message,error=false) {
  clearTimeout(noticeTimer); $('notice').textContent=message; $('notice').className=error?'error':'';
  if($('modal').open && $('modal-notice')) $('modal-notice').textContent=error?message:'';
  if (!error) noticeTimer=setTimeout(()=>{$('notice').textContent='';},6500);
}
function saveState() {
  $('save-state').textContent = isPublic() ? `公开静态只读 · v${runtime.version}` : workspace.updatedAt ? `本机已保存 · ${new Date(workspace.updatedAt).toLocaleString('zh-CN')} · r${workspace.revision}` : '本地已连接 · 尚无个人记录';
}
async function api(path, body) {
  if(isPublic() && (path !== './catalog.json' || body !== undefined)) throw new Error('公开静态版只读取资料快照，不连接保存接口。');
  const response = await fetch(path, body===undefined ? {cache:'no-store'} : {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) { const err=new Error(result.error||`请求失败 ${response.status}`); err.status=response.status; throw err; }
  return result;
}
async function commit(mutate) {
  if(isPublic()) throw new Error('公开静态版只读，不保存个人记录。');
  if(busy) throw new Error('正在保存上一条记录，请稍后再试。');
  busy=true;
  try {
    let next=structuredClone(workspace); mutate(next);
    try { workspace=await api('/api/workspace',next); }
    catch(err) {
      if(err.status!==409) throw err;
      const latest=await api('/api/workspace');
      // Reapply only this form's edit; do not replace unrelated concurrent records.
      next=structuredClone(latest); mutate(next); workspace=await api('/api/workspace',next);
    }
    saveState();
  } finally {busy=false;}
}
function canLeave() { if(busy){notify('保存中，请稍候。',true);return false;} if(!isPublic() && dirty.size && !confirm('还有未保存的输入。放弃这些输入并继续吗？')) return false; dirty.clear(); return true; }
function navigate(update,scroll=true) {
  if(!canLeave())return;
  const newRoute = (update.page && update.page!==view.page) || (update.id && update.id!==view.id) || (update.theme && update.theme!==view.theme);
  if(newRoute) view={...view,...PublicationModel.defaults,scholarTab:'publications',themeEntity:'all',authorContext:null};
  view={...view,...update}; render(scroll);
}
function render(scroll=true) {
  disposeAtlas();
  if(isPublic() && view.page === 'ideas') view = {...view,page:'reading'};
  const active=['candidates','reading','ideas'].includes(view.page)?view.page:'themes';
  document.querySelectorAll('[data-nav]').forEach(b=>{b.hidden=isPublic()&&b.dataset.privateAction==='true';b.classList.toggle('active',b.dataset.nav===active);if(b.dataset.nav===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const handlers={themes:renderThemes,theme:renderTheme,candidates:renderCandidates,focus:renderFocus,paper:renderPaper,reading:renderReading,ideas:renderIdeas,search:renderSearch};
  $('content').innerHTML=(handlers[view.page]||renderThemes)();
  mountAtlas();
  saveState(); if(scroll){window.scrollTo({top:0});$('content').focus({preventScroll:true});}
}
function personCard(r) {
  const c=r.publicationCoverage, n=researcherNote(r.id);
  const meta = isPublic() ? (c?.status==='reviewed_sources'?'来源列表已核对':'目录仍有缺口') : `${stages[n.stage]} · ${c?.status==='reviewed_sources'?'来源列表已核对':'目录仍有缺口'}`;
  return `<article class="card"><div class="badges">${badge(r.institution||'机构待补充')}${badge(verified(r)?'官网身份已核实':'候选 · 待核实',verified(r)?'blue':'pending')}</div><h3>${button(r.name,'researcher',r.id)}</h3><p>${e((r.topics||[]).join(' · '))}</p><div class="candidate-coverage"><span>近 ${c?.windowYears||3} 年 · <strong>${c?.collectedCount||0}</strong> 篇收录</span><span>作者已核 ${c?.authorVerifiedCount||0} 篇</span></div><div class="card-bottom"><span class="meta">${e(meta)}</span>${button('查看论文 →','researcher',r.id)}</div></article>`;
}
function paperButton(label,action,p,contextId='',cls='') {
  return `<button class="${cls}" data-action="${action}" data-id="${e(p.id)}" data-scholar="${e(contextId||'')}">${e(label)}</button>`;
}
function authorLine(p,contextId='',full=false) {
  const tracked=contextId&&p.researcherIds.includes(contextId)?[contextId]:p.researcherIds;
  const names=p.authors||[];
  const renderNames=list=>list.map(name=>{
    const a=(p.authorships||[]).find(a=>a.name===name), target=a?.researcherId&&tracked.includes(a.researcherId);
    return target?`<strong class="author-target">${e(name)}</strong>`:e(name);
  }).join('<span class="author-separator"> · </span>');
  const positions=tracked.map(id=>{
    const r=researcher(id), position=PublicationModel.authorPosition(p,id);
    return `<span class="author-position ${position.verified?'verified':'unverified'}">${e(r?.name||id)}<span>${position.verified?`第 ${position.position} / 共 ${position.total} 位`:'位次待核验'}</span></span>`;
  }).join('');
  let line=renderNames(names);
  if(names.length>8&&!full){
    const targets=(p.authorships||[]).filter(a=>tracked.includes(a.researcherId)).map(a=>a.name);
    const visible=[...new Set([...names.slice(0,3),...targets])];
    line=`${renderNames(visible)}<span class="muted"> …</span><details class="byline-more"><summary>展开完整署名${p.authorListComplete?' · '+names.length+' 位':''}</summary><div>${renderNames(names)}</div></details>`;
  }
  return `<div class="byline">${line||'<span class="muted">作者名单待补全</span>'}</div><div class="author-positions">${positions}</div>${!p.authorListComplete?'<p class="evidence-note">作者名单尚不完整，不据此计算总人数与位次。</p>':!p.authorOrderVerified?'<p class="evidence-note">姓名已收录，原文署名顺序仍待核验。</p>':''}`;
}
function paperMeta(p) {
  const type=PublicationModel.typeLabels[p.publicationType]||'研究论文', status=PublicationModel.statusLabels[p.publicationStatus];
  const genericVenue=/^(working paper|preprint|corr|working paper\s*\/\s*preprint)$/i.test(p.venue||'');
  return `<span>${e(p.year||'年份待核验')}</span><span>${e(type)}</span>${!genericVenue?`<span>${e(p.venue||'发表来源待补')}</span>`:''}${p.publicationStatus!=='published'&&status!==type?`<span>${e(status||'状态待核验')}</span>`:''}${p.coverageScope&&p.coverageScope!=='recent'?'<span>时间窗外 · 补充文献</span>':''}`;
}
function paperExcerpt(p) {
  if(isPublic()) return p.abstractSummary || p.summary?.question || '书目已收录，内容概览待补。';
  return p.readingReason || p.abstractSummary || '书目已收录，中文摘要概览待补。';
}
function questionStatusBadge(p) {
  const status = PublicationModel.normalizedQuestionStatus(p,catalog.questions);
  return badge(PublicationModel.questionStatusLabels[status] || '问题状态待核验', status === 'extracted' ? 'blue' : 'pending');
}
function questionBasisBadge(q) {
  return badge(PublicationModel.questionBasisLabels[q?.basis] || (q?.basis || '问题依据待核验'), q?.basis === 'full_text_summary' ? 'blue' : '');
}
function clustersForPaper(p) {
  return catalog.questionClusters.filter(c => c.paperIds?.includes(p.id));
}
function questionEvidence(q) {
  if(!q?.evidence) return '';
  const source = q.evidence.source || {};
  const sourceLine = source.url ? link(source.label || '问题证据来源',source.url) : e(source.label || '');
  const kindLabels = {abstract:'摘要概览归纳',abstract_summary:'摘要概览归纳',full_text:'全文归纳',full_text_summary:'全文归纳'};
  const kind = kindLabels[source.kind] && kindLabels[source.kind] !== PublicationModel.questionBasisLabels[q.basis] ? ` · ${kindLabels[source.kind]}` : '';
  return `<details class="question-evidence"><summary>查看问题提炼依据</summary><p>${e(q.evidence.excerpt || '证据摘录待补。')}</p>${sourceLine?`<p class="evidence-note">${sourceLine}${kind}${source.checkedAt?` · 核验于 ${e(source.checkedAt)}`:''}</p>`:''}</details>`;
}
function paperQuestionBlock(p,{compact=false}={}) {
  const q = paperQuestion(p);
  const status = PublicationModel.normalizedQuestionStatus(p,catalog.questions);
  const text = PublicationModel.paperQuestionText(p,catalog.questions);
  const cls = compact ? 'paper-question compact' : 'paper-question panel';
  if(status !== 'extracted') {
    return `<div class="${cls}"><div class="paper-question-head"><h4>论文核心问题</h4>${questionStatusBadge(p)}</div><p>${status === 'pending_evidence' ? '待补来源：尚缺可读摘要或全文依据，不从标题推断核心问题。' : status === 'stale_evidence' ? '证据已变化：需要复核摘要或全文后再展示核心问题。' : '待提炼：已有资料尚未整理成论文核心问题。'}</p></div>`;
  }
  const related = clustersForPaper(p);
  const compactSource = compact && q?.evidence?.source?.url && q.evidence.source.url !== p.url && q.evidence.source.url !== p.abstractAvailability?.source?.url ? `<p class="evidence-note">${link(q.evidence.source.label || '问题依据',q.evidence.source.url)}</p>` : '';
  return `<div class="${cls}"><div class="paper-question-head"><h4>论文核心问题</h4><div class="badges">${questionStatusBadge(p)}${questionBasisBadge(q)}</div></div><p>${e(text || '核心问题文本待补。')}</p>${compact?compactSource:questionEvidence(q)}${related.length?`<div class="chips">${related.map(c=>button(c.title || c.question || c.id,'cluster',c.id,'chip')).join('')}</div>`:'<p class="evidence-note">已提炼，但尚未归入主题问题簇。</p>'}</div>`;
}
function paperRow(p,contextId='',preview=false) {
  const progress = isPublic() ? '' : badge('我的进度：'+statuses[paperNote(p.id).status]);
  const selectedLabel = p.selectedReading ? badge(isPublic()?'代表性阅读':'重点选读') : '';
  return `<article class="paper-row publication-row ${preview&&view.previewId===p.id?'is-selected':''}" data-paper-row="${e(p.id)}"><div class="paper-meta">${paperMeta(p)}</div><h3>${paperButton(p.title,preview?'preview-paper':'paper',p,contextId,'paper-title')}</h3>${authorLine(p,contextId)}<p class="paper-excerpt">${e(paperExcerpt(p))}</p><div class="row-actions"><div class="badges">${badge(PublicationModel.depthLabels[p.readDepth]||'书目信息',p.readDepth==='full_text'?'blue':p.readDepth==='metadata'?'pending':'')}${questionStatusBadge(p)}${selectedLabel}${progress}</div><div class="paper-actions">${preview?paperButton('预览','preview-paper',p,contextId):''}${paperButton('进入阅读 →','paper',p,contextId)}</div></div></article>`;
}
function paperList(ps,contextId='') { return ps.length?`<div class="panel">${ps.map(p=>paperRow(p,contextId)).join('')}</div>`:empty('暂时没有论文','这里的空白表示资料尚未补齐，不代表这位学者没有发表。'); }

function contributionInfo(p) {
  const facts=(p.authorships||[]).filter(a=>a.source&&(a.corresponding||a.equalContribution||(a.roles||[]).length)).map(a=>`<p><strong>${e(a.name)}</strong>：${e([a.corresponding?'通讯作者':'',a.equalContribution?'共同贡献':'',...(a.roles||[])].filter(Boolean).join(' · '))} ${link('贡献证据',typeof a.source==='string'?a.source:a.source.url)}</p>`).join('');
  const contribution=p.contribution||{};
  return `<div class="contribution-note"><p>署名位次不等于贡献排名；不据此推断谁主导研究。</p>${facts}${contribution.note||!facts?`<p class="muted">${e(contribution.note||'通讯作者、共同贡献及具体贡献声明待核验。')}</p>`:''}${contribution.source?link('贡献声明来源',typeof contribution.source==='string'?contribution.source:contribution.source.url):''}</div>`;
}
function abstractSourceInfo(p) {
  const info=p.abstractAvailability;
  if(!info)return '';
  const source=typeof info==='object'?(typeof info.source==='string'?info.source:info.source?.url):'';
  const reason=typeof info==='string'?info:info.reason;
  if(p.readDepth==='metadata')return `<p class="evidence-note">${e(reason||'已检查的来源暂未提供可读取的摘要。')}${source?' '+link('已检查来源',source):''}</p>`;
  return `${source?`<p class="evidence-note">${link('摘要来源',source)}</p>`:''}${reason?`<details class="evidence-note"><summary>摘要依据与版本说明</summary><p>${e(reason)}</p></details>`:''}`;
}
function paperPreview(p,contextId='') {
  if(!p)return `<div class="preview-placeholder"><span class="preview-mark">↗</span><h3>给一篇论文，多一点上下文。</h3><p>选择左侧标题，查看作者、内容概览和原始来源。</p></div>`;
  return `<div class="preview-heading"><div class="eyebrow">PAPER PREVIEW</div><span>${e(PublicationModel.depthLabels[p.readDepth]||'书目信息')}</span></div>${button('↑ 回到论文列表','preview-return','','preview-return')}<div class="paper-meta">${paperMeta(p)}</div><h3>${e(p.title)}</h3>${authorLine(p,contextId)}${paperQuestionBlock(p,{compact:true})}<div class="preview-summary"><h4>${p.readDepth==='metadata'?'内容整理状态':p.readDepth==='full_text'?'全文归纳':'摘要概览归纳'}</h4><p>${e(p.abstractSummary||p.summary?.question||p.researchQuestion||'已建立可追溯的书目记录，摘要与研究结论尚未核读；这里暂不生成方法或结果判断。')}</p>${p.summary?.method?`<h4>方法</h4><p>${e(p.summary.method)}</p>`:''}</div>${abstractSourceInfo(p)}${contributionInfo(p)}<div class="preview-links">${link('原始来源',p.url)}${p.authorEvidence?.url?link('署名来源',p.authorEvidence.url):''}</div><p class="evidence-note">${p.date?'出版 / 公开日期：'+e(p.date):p.year?'仅核到年份，具体日期待核验。':'公开年份与日期待核验。'}</p>${paperButton('打开完整阅读页 →','paper',p,contextId,'primary preview-open')}`;
}
function renderLibrary(ps,{contextId='',showTheme=true,showResearcher=true,compactHeading=false,showQuestionFilter=true,clusters=null}={}) {
  const questionFiltered=PublicationModel.filterByQuestionState(ps,catalog.questions,clusters || catalog.questionClusters,showQuestionFilter ? view.questionFilter : 'all');
  const filtered=PublicationModel.filterPapers(questionFiltered,view,isPublic()?{}:workspace.paperNotes), page=PublicationModel.paginate(filtered,view.paperPage);
  const current=filtered.find(p=>p.id===view.previewId)||page.items[0];
  view.previewId=current?.id||null;
  const context=contextId||(view.paperResearcher!=='all'?view.paperResearcher:'');
  const years={all:'全部年份',...Object.fromEntries([...new Set(ps.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a).map(y=>[String(y),String(y)])),...(ps.some(p=>!p.year)?{unknown:'年份待核验'}:{})};
  const people={all:'全部学者',...Object.fromEntries(allResearchers().filter(r=>ps.some(p=>p.researcherIds.includes(r.id))).map(r=>[r.id,r.name]))};
  let previousYear=null;
  const rows=page.items.map(p=>{const y=p.year||'年份待核验'; const heading=y!==previousYear?`<div class="publication-year"><span>${e(y)}</span><span>${filtered.filter(item=>(item.year||'年份待核验')===y).length} 篇</span></div>`:'';previousYear=y;return heading+paperRow(p,context,true);}).join('');
  return `<section class="publication-library" aria-label="论文目录"><div class="library-head ${compactHeading?'compact':''}"><div>${compactHeading?'':'<h2>论文目录</h2>'}<p>选择标题预览，或打开完整阅读页。</p></div><span class="count" role="status">${filtered.length} / ${ps.length} 篇</span></div><form id="library-search" class="library-search" role="search"><label class="sr-only" for="library-query">在当前论文中搜索</label><input id="library-query" name="query" type="search" value="${e(view.libraryQuery)}" placeholder="在当前论文中搜索标题、作者、关键词或论文核心问题"><button type="submit">检索</button>${button('重置筛选','library-reset')}</form><div class="filters library-filters">${filter('年份','paperYear',years,view.paperYear)}${filter('发表类型','paperType',{all:'全部类型',...PublicationModel.typeLabels},view.paperType)}${showTheme?filter('研究主题','paperTheme',{all:'全部主题',...Object.fromEntries(catalog.themes.map(t=>[t.id,t.name])),untagged:'主题尚未标注'},view.paperTheme):''}${showResearcher?filter('关注的学者','paperResearcher',people,view.paperResearcher):''}${showQuestionFilter?filter('问题整理','questionFilter',{all:'全部问题状态',extracted:'已提炼',ungrouped:'未归簇',pending_extraction:'待提炼',pending_evidence:'待补来源',stale_evidence:'证据已变化'},view.questionFilter):''}${isPublic()?'':filter('我的阅读状态','readingStatus',{all:'全部进度',...statuses},view.readingStatus)}${filter('资料深度','paperDepth',{all:'全部深度',...PublicationModel.depthLabels},view.paperDepth)}</div><div class="library-layout"><div class="library-results">${page.items.length?`<div class="publication-list">${rows}</div><div class="pagination"><span>第 ${page.start}–${page.end} 篇 · 共 ${page.total} 篇</span><div><button data-action="library-page" data-id="${page.page-1}" ${page.page===1?'disabled':''}>上一页</button><span>${page.page} / ${page.pageCount}</span><button data-action="library-page" data-id="${page.page+1}" ${page.page===page.pageCount?'disabled':''}>下一页</button></div></div>`:empty(ps.length?'没有符合筛选的论文':'这份目录还需要补充',ps.length?'更换条件或重置筛选，原有论文仍然保留。':'没有收录不等于没有发表；可以先检查学者的官方来源。')}</div><aside class="paper-preview" id="paper-preview" aria-label="论文预览" tabindex="-1">${paperPreview(current,context)}</aside></div></section>`;
}

function coverageSummary(r) {
  const c=r.publicationCoverage;
  if(!c)return `<div class="coverage-summary"><p>近年论文目录尚未逐项核对。</p></div>`;
  return `<div class="coverage-summary"><div class="coverage-metrics"><div><strong>${c.collectedCount}</strong><span>近 ${c.windowYears} 年收录</span></div><div><strong>${c.authorVerifiedCount}<small> / ${c.collectedCount}</small></strong><span>作者位次已核验</span></div><div><strong>${c.abstractCount}<small> / ${c.collectedCount}</small></strong><span>已有摘要 / 全文解读</span></div><div class="coverage-period"><span>${e(c.windowStart)} — ${e(c.windowEnd)}</span><span>${c.status==='reviewed_sources'?'已核对列出的来源':'目录仍有待补项'} · ${e(c.checkedAt||'尚未检查')}</span></div></div><details class="coverage-details"><summary>查看收录范围、来源与缺口${c.gaps?.length?' · '+c.gaps.length+' 项提醒':''}</summary><p>${e(c.note)}</p>${c.extended?'<p>近三年不足五篇时回溯五年；这只是整理口径，不是学者评价。</p>':''}${c.boundaryDateCount?`<p>${c.boundaryDateCount} 篇在边界年份内日期精度不足，是否落在精确时间范围内仍待核验。</p>`:''}${c.gaps?.length?`<ul>${c.gaps.map(g=>`<li>${e(g)}</li>`).join('')}</ul>`:''}${sources(c.sourcesChecked||[])}<p class="evidence-note">按这些来源进行核对，不代表互联网全量收录；身份核验、作者核验和内容解读分别计数。</p></details></div>`;
}
function viewTabs(items,current,action,label) {
  return `<div class="view-tabs" role="group" aria-label="${e(label)}">${items.map(([id,name])=>`<button data-action="${action}" data-id="${id}" aria-pressed="${id===current}" class="${id===current?'active':''}">${e(name)}</button>`).join('')}</div>`;
}
function renderThemes() {
  atlasState.selected=view.atlasTheme;
  return `<div class="map-page-heading"><div><div class="eyebrow">01 / RESEARCH THEME MAP</div><h1>把研究主题，放回学科版图。</h1></div><p>底图负责定位学科与子领域。<br>主题覆盖层说明问题、方法与研究视角。</p></div>`+ResearchAtlas.render(atlasModel,atlasState);
}
function disposeAtlas() {
  atlasController?.dispose();
  atlasController=null;
}
function mountAtlas() {
  const root=$('research-atlas');
  if(view.page!=='themes'||!root)return;
  atlasController=ResearchAtlas.mount(root,atlasModel,atlasState,{
    onSelect(id){view.atlasTheme=id;},
    onOpen(id){navigate({page:'theme',theme:id,atlasTheme:id});}
  });
}
function entityCard(item,type) {return `<article class="card"><div class="eyebrow">${type==='program'?'阅读归纳 · SYNTHESIS':type==='question'?'论文核心问题 · PAPER':type==='cluster'?'主题问题簇 · CLUSTER':'研究范式 · TAG'}</div><h3>${button(item.title||item.text||item.question||item.name,type,item.id)}</h3>${item.summary||item.description?`<p>${e(item.summary||item.description)}</p>`:''}<div class="card-bottom"><span class="meta">${(item.paperIds||[]).length} 篇依据</span>${button('查看依据 →',type,item.id)}</div></article>`;}
function expandable(items,renderItem,count=4) {return `<div class="grid">${items.slice(0,count).map(renderItem).join('')}</div>${items.length>count?`<details><summary>展开其余 ${items.length-count} 项（共 ${items.length} 项）</summary><div class="grid">${items.slice(count).map(renderItem).join('')}</div></details>`:''}`;}
function scopedCluster(cluster, papers) {
  const ids = new Set(papers.map(p => p.id));
  const paperIds = PublicationModel.uniq((cluster.paperIds || []).filter(id => ids.has(id)));
  const scopedPapers = papers.filter(p => paperIds.includes(p.id));
  const researcherIds = PublicationModel.uniq(scopedPapers.flatMap(p => p.researcherIds || []));
  const questionIds = PublicationModel.uniq((cluster.questionIds || []).filter(id => catalog.questions.some(q => q.id === id && q.paperIds?.some(pid => paperIds.includes(pid)))));
  return {...cluster,paperIds,questionIds,researcherIds};
}
function clusterCard(c, themePapers = catalog.papers) {
  const scoped = scopedCluster(c,themePapers);
  const single = scoped.paperIds.length === 1;
  const scopedTheme = themePapers !== catalog.papers;
  return `<article class="card question-cluster-card"><div class="eyebrow">${single?(scopedTheme?'本主题仅一篇依据 · SINGLE IN THEME':'单篇依据 · SINGLE PAPER'):'主题问题簇 · CLUSTER'}</div><h3>${button(scoped.title || scoped.question || scoped.id,'cluster',scoped.id)}</h3><p class="cluster-question">${e(scoped.question || scoped.description || '问题簇说明待补。')}</p>${scoped.description?`<p>${e(scoped.description)}</p>`:''}<div class="cluster-metrics"><span><strong>${scoped.paperIds.length}</strong> 篇论文</span><span><strong>${scoped.researcherIds.length}</strong> 位学者</span></div><div class="card-bottom"><span class="meta">编辑归纳</span>${button('查看来源论文 →','cluster',scoped.id)}</div></article>`;
}
function themeCoverageBar(papers, clusters) {
  const c = PublicationModel.questionCoverage(papers,catalog.questions,clusters);
  const ratio = c.papers ? `${c.extracted} / ${c.papers}` : '0 / 0';
  const stale = c.staleEvidence ? `<div><strong>${c.staleEvidence}</strong><span>待复核</span></div>` : '';
  return `<div class="question-coverage"><div class="coverage-metrics"><div><strong>${ratio}</strong><span>核心问题</span></div><div><strong>${c.clustered}<small> / ${c.extracted}</small></strong><span>已归簇</span></div><div><strong>${c.awaitingExtraction}</strong><span>待提炼</span></div><div><strong>${c.awaitingEvidence}</strong><span>待补来源</span></div>${stale}<div><strong>${c.unclustered}</strong><span>未归簇</span></div></div><p class="evidence-note">计数按当前主题内不同论文记录去重；多簇成员只计一次。预印本与发表版本仍可能分开收录。</p></div>`;
}
function renderTheme() {
  const t=catalog.themes.find(t=>t.id===view.theme);if(!t)return empty('主题不存在','请返回主题地图。');
  const ps=catalog.papers.filter(p=>p.themes?.includes(t.id)), ids=new Set(ps.map(p=>p.id));
  const rs=allResearchers().filter(r=>r.themes?.includes(t.id)||ps.some(p=>p.researcherIds?.includes(r.id))).sort((a,b)=>Number(verified(b))-Number(verified(a)));
  const clusters=catalog.questionClusters.map(c=>scopedCluster(c,ps)).filter(c=>c.paperIds.length).sort((a,b)=>b.paperIds.length-a.paperIds.length || (a.title || a.question || '').localeCompare(b.title || b.question || ''));
  const gs=catalog.programs.filter(g=>g.paperIds?.some(id=>ids.has(id)));
  const paradigms=catalog.paradigms.filter(g=>ps.some(p=>p.paradigms?.includes(g.id)));
  const lenses={cluster:{label:'主题问题簇',items:clusters},researcher:{label:'学者',items:rs},paradigm:{label:'研究范式',items:paradigms},program:{label:'研究线',items:gs}};
  const lens=lenses[view.themeLens]||lenses.cluster, item=lens.items.find(x=>x.id===view.themeEntity);
  const scoped=!item?ps:ps.filter(p=>view.themeLens==='researcher'?p.researcherIds.includes(item.id):view.themeLens==='paradigm'?p.paradigms.includes(item.id):item.paperIds.includes(p.id));
  const context=view.themeLens==='researcher'&&item?item.id:'';
  const options=Object.fromEntries(lens.items.map(x=>[x.id,view.themeLens==='researcher'?`${x.name} · ${ps.filter(p=>p.researcherIds.includes(x.id)).length} 篇已关联`:x.name||x.title||x.text]));
  const clusterCards=view.themeLens==='cluster'&&!item?`<div class="cluster-card-set">${expandable(clusters,c=>clusterCard(c,ps),6)}</div>`:'';
  return crumbs([e(t.name)])+intro('02 / THEME WORKSPACE',t.name,'从主题问题簇、学者、范式或研究线，浏览同一组论文。'+t.description)+themeCoverageBar(ps,clusters)+`<div class="theme-lenses">${viewTabs(Object.entries(lenses).map(([id,l])=>[id,`${l.label} · ${l.items.length}`]),view.themeLens,'theme-lens','主题的四种浏览角度')}<div class="lens-selection">${filter('按'+lens.label+'查看','themeEntity',{all:'全部'+lens.label,...options},view.themeEntity)}${item?button('打开'+lens.label+'详情 →',view.themeLens,item.id):'<p>这些是并列的阅读入口，不需要按固定顺序探索。</p>'}</div>${item&&(item.question||item.summary||item.description)?`<p class="lens-description">${e(item.question||item.summary||item.description)}</p>`:''}${context&&!scoped.length?'<p class="evidence-note">这位学者是主题候选，但已收录论文尚未关联到本主题；可打开学者详情查看全部目录。</p>':''}${clusterCards}</div>${renderLibrary(scoped,{contextId:context,showTheme:false,showResearcher:!context,showQuestionFilter:true,clusters})}<p class="library-boundary">主题问题簇是编辑归纳，不是已证明的新研究空白。当前 ${ps.length} 篇关联论文不代表整个领域；同一主题也不代表学者之间存在合作。</p>`;
}
function renderCandidates() {
  const rs=allResearchers().filter(r=>(view.institution==='all'||r.institution===view.institution)&&(view.verification==='all'||(view.verification==='verified'?verified(r):!verified(r)))&&(view.stage==='all'||researcherNote(r.id).stage===view.stage)).sort((a,b)=>Number(verified(b))-Number(verified(a)));
  const schools={all:'全部学校',...Object.fromEntries([...new Set(allResearchers().map(r=>r.institution).filter(Boolean))].sort().map(s=>[s,s]))};
  const table=`<div class="coverage-table-wrap"><table class="coverage-table"><caption class="sr-only">每位候选学者的近年论文整理进度</caption><thead><tr><th scope="col">学者</th><th scope="col">收录范围</th><th scope="col">论文</th><th scope="col">作者已核</th><th scope="col">内容解读</th><th scope="col">检索状态</th></tr></thead><tbody>${rs.map(r=>{const c=r.publicationCoverage;return `<tr><th scope="row">${button(r.name,'researcher',r.id)}<small>${e(r.institution)}</small></th><td>近 ${c?.windowYears||3} 年<small>${e(c?.windowStart||'待检查')}</small></td><td>${c?.collectedCount||0}</td><td>${c?.authorVerifiedCount||0} / ${c?.collectedCount||0}</td><td>${c?.abstractCount||0} / ${c?.collectedCount||0}</td><td>${badge(c?.status==='reviewed_sources'?'来源列表已核对':'仍有待补项',c?.status==='reviewed_sources'?'blue':'pending')}<small>${e(c?.checkedAt||'未检查')}</small></td></tr>`;}).join('')}</tbody></table></div>`;
  const addAction = isPublic() ? '' : button('＋ 添加候选导师','add-candidate','','primary');
  return intro(isPublic()?'SCHOLAR DIRECTORY':'CANDIDATE POOL',isPublic()?'沿着论文，了解学者的研究。':'把名单，变成有依据的选择。','身份核验、论文收录、作者核验与内容解读分别管理；不据此给学者排名。')+`<div class="actions">${addAction}<span class="count">当前 ${rs.length} / ${allResearchers().length} 位</span></div>${viewTabs([['profiles',isPublic()?'学者画像':'候选画像'],['coverage','整理进度']],view.candidateTab,'candidate-tab',isPublic()?'学者目录视图':'候选池视图')}<div class="filters">${filter('学校','institution',schools,view.institution)}${filter('身份资料','verification',{all:'全部资料',verified:'官网已核实',pending:'待核实'},view.verification)}${isPublic()?'':filter('我的阶段','stage',{all:'全部阶段',...stages},view.stage)}</div>${rs.length?(view.candidateTab==='coverage'?table:`<div class="grid candidate-grid">${rs.map(personCard).join('')}</div>`):empty('当前筛选没有结果','尝试更换学校或资料状态。')}<p class="library-boundary">“来源列表已核对”仅指已列来源，不代表没有遗漏。点开学者可查看来源、时间边界和具体缺口。</p>`;
}
function filter(label,name,options,current) {return `<label>${e(label)}<select data-filter="${name}" aria-label="${e(label)}">${optionHTML(options,current)}</select></label>`;}
function renderFocus() {
  if(view.type==='researcher')return renderResearcher();
  if(view.type==='cluster'){
    const item=cluster(view.id);
    if(!item)return empty('问题簇不存在','请返回主题地图。');
    const themeScope=view.theme?catalog.papers.filter(p=>p.themes?.includes(view.theme)):catalog.papers;
    const scoped=scopedCluster(item,themeScope);
    const ps=catalog.papers.filter(p=>scoped.paperIds.includes(p.id));
    const authors=allResearchers().filter(r=>ps.some(p=>p.researcherIds?.includes(r.id)));
    const scopeText=view.theme?`当前范围：${catalog.themes.find(t=>t.id===view.theme)?.name || '所选主题'}。簇计数与主题页保持一致。`:'当前范围：跨主题全部关联论文；这里明确展示的是全库范围。';
    return crumbs([view.theme?button(catalog.themes.find(t=>t.id===view.theme)?.name || '返回主题','theme',view.theme):'跨主题全部',e(item.title||item.question||item.id)])+intro('03 / QUESTION CLUSTER',item.title||item.question||item.id,item.question||item.description||'这个主题问题簇由论文核心问题归纳而来。')+`<div class="panel cluster-focus"><p>${e(item.description||'簇说明待补。')}</p><div class="cluster-metrics"><span><strong>${scoped.paperIds.length}</strong> 篇论文</span><span><strong>${scoped.researcherIds.length}</strong> 位学者</span><span><strong>${scoped.questionIds.length || scoped.paperIds.length}</strong> 个论文核心问题</span></div><p class="evidence-note">${e(scopeText)}</p></div>`+renderLibrary(ps,{showTheme:!view.theme,showQuestionFilter:true,clusters:[scoped]})+section('依据论文中的学者',`<div class="grid candidate-grid">${authors.map(personCard).join('')}</div>`)+`<p class="library-boundary">问题簇是编辑归纳；来源论文与论文核心问题仍是可追溯依据。</p>`;
  }
  const list=view.type==='question'?catalog.questions:view.type==='program'?catalog.programs:catalog.paradigms;
  const item=list.find(x=>x.id===view.id);
  if(!item)return empty('条目不存在','请返回主题地图。');
  const ps=view.type==='paradigm'?catalog.papers.filter(p=>p.paradigms?.includes(item.id)):catalog.papers.filter(p=>item.paperIds?.includes(p.id));
  const authors=allResearchers().filter(r=>ps.some(p=>p.researcherIds?.includes(r.id)));
  const title=item.title||item.text||item.name;
  const eyebrow=view.type==='question'?'03 / PAPER QUESTION':'03 / FOCUS';
  const description=view.type==='question'?'这是单篇论文的核心问题，由已有摘要或全文归纳而来，不是跨论文问题簇。':item.summary||item.description||'这个条目由下列论文整理而来，不是已确认的新研究空白。';
  return crumbs([e(title)])+intro(eyebrow,title,description)+renderLibrary(ps)+section('依据论文中的学者',`<div class="grid candidate-grid">${authors.map(personCard).join('')}</div>`)+`<p class="library-boundary">这里的关系来自列出的论文。研究线是对选读的归纳，不代表完整研究生涯，也不自动推断其他合作关系。</p>`;
}
function renderResearcher() {
  const r=researcher(view.id);if(!r)return empty('找不到导师','请返回候选池。');
  if(isPublic() && view.scholarTab === 'notes') view.scholarTab = 'publications';
  const ps=PublicationModel.recentPapers(r,catalog.papers), selected=selectedPapers(r.id), n=researcherNote(r.id), fit=r.fit;
  const tabs=[['publications',`近年全部收录 · ${ps.length}`],['selected',`重点阅读 · ${selected.length}`],['lines','研究脉络']];
  if(!isPublic()) tabs.push(['notes','我的记录']);
  const header=crumbs([button(isPublic()?'学者目录':'导师候选池','candidates'),e(r.name)])+intro('03 / RESEARCHER FOCUS',r.name,`${r.institution} · ${r.department||'院系待核实'}`)+`<div class="scholar-meta">${badge(verified(r)?'官网身份已核实':'身份资料待核实',verified(r)?'blue':'pending')}${badge(r.position||'任职待核实')}${r.homepage?link('官方主页',r.homepage):''}</div>`+coverageSummary(r)+viewTabs(tabs,view.scholarTab,'scholar-tab','学者内容分区');
  if(view.scholarTab==='publications')return header+renderLibrary(ps,{contextId:r.id,showResearcher:false});
  if(view.scholarTab==='selected')return header+`<p class="tab-explanation">按阅读建议排列，可能包含时间窗以外的经典选文。这不是完整发表列表。</p>`+paperList(selected,r.id);
  const sourcePanel=`<div class="panel"><h3>来源与待核实信息</h3>${sources(r.sources)}${isPublic()?'':`<div class="warning"><strong>招生状态：未核实</strong><br>${e(r.recruitment?.note||'具体年份、名额和资助需另行确认。')}</div>${r.questionsToVerify?.length?`<ul class="detail-list">${r.questionsToVerify.map(q=>`<li>${e(q)}</li>`).join('')}</ul>`:''}`}</div>`;
  if(view.scholarTab==='notes')return header+`<div class="layout section"><div class="panel"><div class="eyebrow">MY RECORD</div><h3>我的判断与行动</h3><form id="researcher-note" data-save="researcher" data-id="${e(r.id)}">${selectField('当前阶段','stage',stages,n.stage)}${textField('我的判断','note',n.note,3000,5)}${textField('下一步行动','nextAction',n.nextAction,300,3)}<button class="primary" type="submit">保存导师记录</button><p class="form-note">写入本机，与来源资料分开保存。</p></form><div class="actions">${button('生成联系准备单','brief',r.id)}${!verified(r)?button('补充候选资料','edit-candidate',r.id):''}</div></div><aside>${sourcePanel}</aside></div>`;
  const localFit = !isPublic() && fit ? section('与你的交集 · 阅读建议',`<div class="fit-grid">${Object.entries({overlap:'研究交集',preparation:'需要准备什么',ecosystem:'发表与方法语境',caution:'判断边界'}).map(([key,label])=>`<div class="panel"><h3>${label}</h3><p>${e(fit[key])}</p></div>`).join('')}</div>`) : '';
  const localNextStep = !isPublic() && r.suggestedNextStep ? section('下一步阅读建议',`<div class="callout"><p>${e(r.suggestedNextStep)}</p></div>`) : '';
  return header+`<div class="layout section"><div><div class="panel"><h3>研究背景</h3><p>${e(r.summary)}</p><p class="form-note">方向标签：${e((r.topics||[]).join(' · '))}</p>${themeChips(r.themes||[])}</div>${r.researchLines?.length?section('从选读归纳的研究线',`<div class="grid">${r.researchLines.map(g=>entityCard(g,'program')).join('')}</div>`):section('研究线待归纳',empty('先建立论文依据，再归纳研究脉络','当前已有书目不等于已经完成研究生涯评述。'))}${localFit}${localNextStep}</div><aside>${sourcePanel}</aside></div>`;
}
function renderPaper() {
  const p=paper(view.id);if(!p)return empty('找不到论文','请返回阅读清单。');
  const n=paperNote(p.id), labels={question:'旧版论文问题',gap:'论文针对的缺口',insight:'核心思路',method:'方法',evidence:'证据与结果',limitation:'局限与阅读边界'};
  const context=p.researcherIds.includes(view.authorContext)?view.authorContext:'';
  const contextName=context?researcher(context)?.name:'';
  const summarySections=p.summary?Object.entries(labels).filter(([key])=>p.summary[key] && key !== 'question'):[];
  const body=summarySections.length?`<div class="section prose">${summarySections.map(([key,label])=>`<section><h3>${label}${key==='limitation'?' · '+(p.limitationBasis==='author_stated'?'作者陈述':'整理者提醒'):''}</h3><p>${e(p.summary[key])}</p></section>`).join('')}</div>`:p.abstractSummary?`<div class="section prose"><h3>${p.readDepth==='full_text'?'全文归纳':'摘要概览归纳'}</h3><p>${e(p.abstractSummary)}</p><p class="evidence-note">基于${p.readDepth==='full_text'?'全文归纳':'摘要'}整理；具体设定、完整实验与稳健性以原文为准。</p></div>`:section('内容解读待补',empty('书目已收录，尚未核读摘要或全文','这里不根据标题推断研究结论。可以打开原始来源，并将实际阅读所得记在右侧。'));
  const versions=p.versions?.length?`<details class="panel paper-versions"><summary>版本与署名记录 · ${p.versions.length} 条</summary>${p.versions.map(v=>`<div class="version-record"><h4>${e(v.title||p.title)}</h4><p>${e(v.year||'年份待核验')} · ${e(v.venue||PublicationModel.statusLabels[v.publicationStatus]||'来源记录')}</p><p>${e((v.authors||[]).join(' · '))}</p>${link('查看此记录',v.url)}</div>`).join('')}</details>`:'';
  const extensionBlock = !isPublic() && p.suggestedExtension ? section('可以延伸的问题 · 建议',`<div class="callout"><p>${e(p.suggestedExtension)}</p><p class="form-note">尚未完成相关文献查重或新颖性验证。</p>${button('新建我的想法','new-idea',p.id,'primary')}</div>`) : !isPublic() ? `<div class="actions section">${button('基于论文新建我的想法','new-idea',p.id)}</div>` : '';
  const progressBadge = isPublic() ? '' : badge('我的进度：'+statuses[n.status]);
  const readingPanel = isPublic() ? '' : `<div class="panel"><div class="eyebrow">MY READING</div><h3>我的阅读笔记</h3><form id="paper-note" data-save="paper" data-id="${e(p.id)}">${selectField('我的阅读状态','status',statuses,n.status)}${textField('我的笔记','note',n.note,5000,6)}${textField('我的延伸问题','extension',n.extension,3000,4)}<button class="primary" type="submit">保存阅读记录</button><p class="form-note">资料整理与个人阅读进度分开；不会自动将论文标为已读。</p></form></div>`;
  return crumbs([button('返回论文列表','paper-back'),e('论文资料卡')])+`<div class="paper-heading">${intro('04 / PAPER & IDEA',p.title,`${p.year||'年份待核验'} · ${p.venue||'来源待补'}`)}</div><div class="layout"><div><div class="panel paper-authorship">${contextName?`<div class="eyebrow">正在查看 ${e(contextName)} 的署名</div>`:'<div class="eyebrow">AUTHORS & EVIDENCE</div>'}${authorLine(p,context,true)}${contributionInfo(p)}${p.authorEvidence?.url?link(p.authorOrderVerified?'核对原始署名':'查看作者线索',p.authorEvidence.url):''}</div><div class="reading-evidence badges">${p.coverageScope&&p.coverageScope!=='recent'?badge('时间窗外 · 补充文献','pending'):''}${badge('资料：'+(PublicationModel.depthLabels[p.readDepth]||'书目信息'),p.readDepth==='full_text'?'blue':p.readDepth==='metadata'?'pending':'')}${questionStatusBadge(p)}${p.verifiedAt?badge('核验于 '+p.verifiedAt):''}${progressBadge}</div>${p.readDepth==='abstract'?'<p class="evidence-note">以下基于摘要与元数据；不等于全文核读。</p>':''}${paperQuestionBlock(p)}${body}${abstractSourceInfo(p)}${!isPublic()&&p.readingReason?section('为什么值得读',`<div class="panel"><p>${e(p.readingReason)}</p></div>`):''}${extensionBlock}${versions}</div><aside>${readingPanel}<div class="panel"><h3>回到原始来源</h3>${link('打开来源',p.url)}${sources(p.sources)}<p class="evidence-note">${p.date?'公开 / 出版日期：'+e(p.date):'具体公开 / 出版日期待核验。'}</p>${p.doi?`<p class="evidence-note">DOI · ${e(p.doi)}</p>`:''}<p class="form-note">主题、范式和问题簇标签是整理者归纳。</p>${themeChips(p.themes)}<div class="chips">${p.paradigms.map(id=>button(catalog.paradigms.find(x=>x.id===id)?.name||id,'paradigm',id,'chip')).join('')}${clustersForPaper(p).map(c=>button(c.title||c.question||c.id,'cluster',c.id,'chip')).join('')}</div></div></aside></div>`;
}
function renderReading() {
  const stats=catalog.publicationStats||{};
  const description = isPublic() ? '按学者、主题与年份浏览。作者署名、来源证据和资料深度分别保留。' : '按学者、主题与年份浏览。作者署名、来源证据和你的阅读进度分别保留。';
  return `<div class="library-page-heading">${intro('PUBLICATION LIBRARY','近年论文库',description)}</div><div class="library-overview"><span><strong>${catalog.papers.length}</strong> 项已收录研究</span><span><strong>${stats.withPapers||0} / ${allResearchers().length}</strong> 位学者有论文收录</span><span><strong>${stats.verifiedBylines||0}</strong> 篇署名已核</span><span><strong>${stats.abstracts||0}</strong> 篇已整理内容</span></div>${renderLibrary(catalog.papers,{compactHeading:true})}<p class="library-boundary">默认近三年，不足五篇时回溯五年；另保留 ${stats.outsideWindow||0} 篇时间窗外的补充文献，并单独标注。已确认的预印本与发表版本已关联；未核清的版本仍可能分开收录。保留原有 ${stats.fullTexts||0} 篇全文解读；不把作者位次当作贡献排名。资料更新时间：${e(catalog.updatedAt)}。</p>`;
}
function renderIdeas() {
  if(isPublic()) return intro('PUBLIC STATIC','公开静态只读版','这个版本只展示主题地图、学者资料和论文库；个人想法、笔记和联系准备单保留在本地开发版。')+empty('个人工作区未发布','公开页面不会读取浏览器本地记录，也不会连接保存接口。');
  return intro('MY IDEAS','让想法，有来处。','记录你自己的问题与假设，一条想法可以连接多篇论文。系统建议不会自动变成你的观点。')+`<div class="actions">${button('＋ 新建想法','new-idea','','primary')}</div><div class="section">${workspace.ideas.length?`<div class="grid">${workspace.ideas.map(i=>`<article class="card"><div class="eyebrow">PERSONAL / ${e(new Date(i.updatedAt).toLocaleDateString('zh-CN'))}</div><h3>${e(i.title)}</h3><p class="idea-body">${e(i.body)}</p><div class="chips">${i.paperIds.map(id=>paper(id)?button(paper(id).title,'paper',id,'chip'):badge('来源论文暂不在当前资料库','pending')).join('')}</div><div>${button('编辑想法','edit-idea',i.id)}</div></article>`).join('')}</div>`:empty('先留下一个具体问题','例如：我想检验什么？用什么数据？哪项结果会否定我的假设？')}</div>`;
}
function renderSearch() {
  const q=view.search.toLocaleLowerCase(), match=x=>JSON.stringify(x).toLocaleLowerCase().includes(q);
  const rs=allResearchers().filter(r=>match([r.name,r.institution,r.topics]));
  const searchHits=PublicationModel.searchQuestions(view.search,catalog.questions,catalog.questionClusters);
  const questionPaperIds = new Set(searchHits.questions.flatMap(item => item.paperIds || []));
  const ps=PublicationModel.filterPapers(catalog.papers,{libraryQuery:view.search}).concat(catalog.papers.filter(p=>questionPaperIds.has(p.id)));
  const uniquePs=[...new Map(ps.map(p=>[p.id,p])).values()];
  return intro('SEARCH',`“${view.search}” 的搜索结果`,`${rs.length} 位导师 · ${uniquePs.length} 篇论文 · ${searchHits.clusters.length} 个问题簇 · ${searchHits.questions.length} 个论文核心问题`)+(rs.length?section('导师',`<div class="grid candidate-grid">${rs.map(personCard).join('')}</div>`):'')+(searchHits.clusters.length?section('主题问题簇',`<div class="grid">${searchHits.clusters.map(c=>clusterCard(c)).join('')}</div>`):'')+(searchHits.questions.length?section('论文核心问题',`<div class="grid">${searchHits.questions.map(q=>entityCard(q,'question')).join('')}</div>`):'')+(uniquePs.length?renderLibrary(uniquePs):'')+(!rs.length&&!uniquePs.length&&!searchHits.clusters.length&&!searchHits.questions.length?empty('没有找到匹配条目','试试作者姓氏、学校简称、问题文字或论文中的关键词。'):'');
}

function openModal(title,body) {$('modal-title').textContent=title;$('modal-body').innerHTML='<p id="modal-notice" class="modal-error" role="alert"></p>'+body;$('modal').showModal();}
function closeModal() {if(busy)return;if(dirty.has('modal-form')&&!confirm('放弃尚未保存的输入吗？'))return;dirty.delete('modal-form');$('modal').close();pendingImport=null;}
function openCandidate(id) {
  if(isPublic()){notify('公开静态版只读，不能添加或编辑候选资料。',true);return;}
  if(!canLeave())return;const r=id?researcher(id):null;if(r&&verified(r))return;
  openModal(r?'补充候选资料':'添加候选导师',`<p class="form-note">个人录入始终标为待核实，不会因为填写主页就升级成官网已核实。</p><form id="modal-form" data-save="candidate" data-id="${e(id||'')}">${inputField('姓名','name',r?.name,120,true)}${inputField('学校 / 机构（建议使用 HKU、HKUST 等简称）','institution',r?.institution,160,true)}${inputField('院系','department',r?.department)}${inputField('官方主页','homepage',r?.homepage,500,false,'url')}${inputField('方向关键词（以中文或英文逗号分隔）','topics',r?.topics.join(', '),600)}<div class="form-note">关联主题（个人整理）</div><div class="check-list">${catalog.themes.map(t=>`<label><input type="checkbox" name="themes" value="${t.id}" ${r?.themes.includes(t.id)?'checked':''}>${e(t.name)}</label>`).join('')}</div>${textField('候选说明','summary',r?.summary,800,3)}<button type="submit" class="primary">保存候选资料</button></form>`);
}
function openIdea(id,paperId) {
  if(isPublic()){notify('公开静态版只读，个人想法保留在本地开发版。',true);return;}
  if(!canLeave())return;const idea=workspace.ideas.find(i=>i.id===id);const selected=idea?.paperIds||(paperId?[paperId]:[]);
  openModal(idea?'编辑我的想法':'新建我的想法',`<p class="form-note">只填写你自己的观点。系统延伸建议不是已确认的新颖研究问题。</p><form id="modal-form" data-save="idea" data-id="${e(id||'')}">${inputField('想法标题','title',idea?.title,160,true)}${textField('问题、假设与验证方法','body',idea?.body,3000,6)}<div class="form-note">关联论文（可多选）</div><div class="check-list">${catalog.papers.map(p=>`<label><input type="checkbox" name="paperIds" value="${p.id}" ${selected.includes(p.id)?'checked':''}>${e(p.title)}</label>`).join('')}</div><button type="submit" class="primary">保存想法</button></form>`);
}
function makeBrief(id) {
  if(isPublic()){notify('公开静态版不生成联系准备单；请在本地开发版处理个人 outreach。',true);return;}
  if(dirty.size){notify('请先保存当前输入，再生成联系准备单。',true);return;}
  const r=researcher(id), n=researcherNote(id);
  const ps=authorPapers(id).filter(p=>p.selectedReading||paperNote(p.id).status!=='unread');
  briefText=[`${r.name} — 联系准备单`,`生成时间：${new Date().toLocaleString('zh-CN')}`,`${r.institution} · ${r.department}`,`主页：${r.homepage||'待补充'}`,`招生状态：未核实（请确认目标年份、名额及资助）`,'','研究交集（整理建议，并非导师确认）：',r.fit?.overlap||'待判断','','重点选读及我正在读/已读的论文：',...ps.map(p=>{const position=PublicationModel.authorPosition(p,id);return `${p.title}\n${p.authors.join(' · ')}\n署名位次：${position.verified?`${position.position}/${position.total}`:'待核验'}（不等于贡献排名）\n${p.url}\n我的状态：${statuses[paperNote(p.id).status]}；资料：${PublicationModel.depthLabels[p.readDepth]}\n我的笔记：${paperNote(p.id).note||'尚未记录'}`;}),...(!ps.length?['尚未选定阅读论文。']:[]),'','我的判断：',n.note||'尚未记录','下一步：',n.nextAction||r.suggestedNextStep||'先核实资料','','待确认：',...(r.questionsToVerify||['目标年份是否招生？']), '', '这不是已发送的邮件。请完成实际阅读后，再写给导师。'].join('\n');
  openModal('联系准备单',`<pre class="brief">${e(briefText)}</pre><div class="actions">${button('下载准备单 (.txt)','download-brief','','primary')}</div><p class="form-note">仅使用已保存记录；不会发送给任何人。</p>`);
}
function download(name,text,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function backup() {if(isPublic()) throw new Error('公开静态版不导出个人记录。');download(`research-intelligence-notes-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,JSON.stringify({format:'research-intelligence-notes',version:1,exportedAt:new Date().toISOString(),workspace},null,2));}
async function previewImport(file) {
  if(isPublic()){notify('公开静态版只读，不导入个人备份。',true);return;}
  if(!file)return;
  try {
    if(file.size>1024*1024)throw new Error('备份超过 1 MB，未导入。');
    const parsed=JSON.parse(await file.text());
    if(parsed.format!=='research-intelligence-notes'||parsed.version!==1||!parsed.workspace)throw new Error('这不是本应用的个人记录备份。');
    const w=parsed.workspace;
    if(!w.researcherNotes||!w.paperNotes||!Array.isArray(w.ideas)||!Array.isArray(w.customResearchers))throw new Error('备份结构不完整，未导入。');
    pendingImport=w;
    openModal('确认导入个人备份',`<p>即将替换当前个人记录：${Object.keys(w.researcherNotes).length} 条导师记录、${Object.keys(w.paperNotes).length} 条阅读记录、${w.ideas.length} 个想法、${w.customResearchers.length} 位个人候选。</p><div class="warning">这是替换，不是合并。基础导师与论文资料不变。继续前会先下载当前记录作为备份；服务器将再次校验输入。</div><div class="actions" style="margin-top:20px">${button('备份当前记录并替换','confirm-import','','primary')}</div>`);
  }catch(err){notify(err.message,true);}
  finally{$('import-file').value='';}
}
async function confirmImport() {
  if(isPublic()){notify('公开静态版只读，不替换个人记录。',true);return;}
  if(!pendingImport||busy)return;backup();busy=true;
  try{workspace=await api('/api/workspace',{...pendingImport,revision:workspace.revision});pendingImport=null;$('modal').close();dirty.clear();render(false);notify('备份已导入，当前记录已替换。');}
  catch(err){notify(err.status===409?'其他页面更新了记录。本次导入未覆盖，请刷新后重新导入。':err.message,true);}
  finally{busy=false;}
}
async function saveForm(form) {
  if(isPublic()){notify('公开静态版只读，不保存个人记录。',true);return;}
  const fd=new FormData(form), type=form.dataset.save, id=form.dataset.id;
  const get=key=>String(fd.get(key)||'').trim();
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try {
    if(type==='researcher'){const note={stage:get('stage'),note:get('note'),nextAction:get('nextAction')};await commit(w=>{w.researcherNotes[id]=note;});}
    else if(type==='paper'){const note={status:get('status'),note:get('note'),extension:get('extension')};await commit(w=>{w.paperNotes[id]=note;});}
    else if(type==='candidate'){
      if(!get('name')||!get('institution'))throw new Error('姓名和机构不能为空。');
      if(get('homepage')&&!safeURL(get('homepage')))throw new Error('主页必须是 http 或 https 地址。');
      const item={id:id||'custom_'+crypto.randomUUID(),name:get('name'),institution:get('institution'),department:get('department'),homepage:get('homepage'),themes:fd.getAll('themes'),topics:get('topics').split(/[,，]/).map(s=>s.trim()).filter(Boolean),summary:get('summary'),verification:'user_added',verifiedAt:null,sources:[],recruitment:{status:'unknown',note:'招生年份及名额未核实'}};
      await commit(w=>{w.customResearchers=w.customResearchers.filter(r=>r.id!==item.id);w.customResearchers.push(item);});
    } else if(type==='idea'){
      if(!get('title'))throw new Error('想法标题不能为空。');
      const now=new Date().toISOString(), old=workspace.ideas.find(i=>i.id===id);
      const idea={id:id||'idea_'+crypto.randomUUID(),title:get('title'),body:get('body'),paperIds:fd.getAll('paperIds'),createdAt:old?.createdAt||now,updatedAt:now};
      await commit(w=>{w.ideas=w.ideas.filter(i=>i.id!==idea.id);w.ideas.unshift(idea);});
    }
    dirty.delete(form.id);if(form.id==='modal-form')$('modal').close();render(false);notify('已保存到本机。刷新或重新启动服务后仍然保留。');
  }catch(err){notify(`保存失败：${err.message} 输入仍保留。`,true);}
  finally{submit.disabled=false;}
}

document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;
  if(isPublic() && publicDisabledActions.has(action)){notify('公开静态版只读；个人记录、导入导出和联系准备单保留在本地开发版。',true);return;}
  if(['themes','candidates','reading','ideas'].includes(action)){navigate({page:action,theme:null,institution:'all',verification:'all',stage:'all',...PublicationModel.defaults});return;}
  if(action==='theme')navigate({page:'theme',theme:id,atlasTheme:id});
  else if(['researcher','question','program','paradigm'].includes(action))navigate({page:'focus',type:action,id});
  else if(action==='cluster')navigate({page:'focus',type:'cluster',id,theme:view.page==='theme'?view.theme:null});
  else if(action==='paper'){
    if(view.page!=='paper')paperOrigin={...view};
    navigate({page:'paper',id,authorContext:b.dataset.scholar||null});
  }
  else if(action==='paper-back')navigate(paperOrigin||{page:'reading',...PublicationModel.defaults});
  else if(action==='preview-paper'){
    const p=paper(id), preview=$('paper-preview');if(!p||!preview)return;
    view.previewId=id;
    preview.innerHTML=paperPreview(p,b.dataset.scholar||'');
    document.querySelectorAll('[data-paper-row]').forEach(row=>row.classList.toggle('is-selected',row.dataset.paperRow===id));
    if(window.matchMedia('(max-width: 950px)').matches)preview.scrollIntoView({block:'start'});
    preview.focus({preventScroll:true});
  }
  else if(action==='preview-return'){
    const row=[...document.querySelectorAll('[data-paper-row]')].find(row=>row.dataset.paperRow===view.previewId);
    row?.scrollIntoView({block:'start'});row?.querySelector('button')?.focus({preventScroll:true});
  }
  else if(action==='scholar-tab')navigate({scholarTab:id,...PublicationModel.defaults},false);
  else if(action==='candidate-tab')navigate({candidateTab:id},false);
  else if(action==='theme-lens')navigate({themeLens:id,themeEntity:'all',...PublicationModel.defaults},false);
  else if(action==='library-reset')navigate({...PublicationModel.defaults},false);
  else if(action==='library-page'){
    navigate({paperPage:Number(id),previewId:null},false);
    document.querySelector('.library-head')?.scrollIntoView({block:'start'});
  }
  else if(action==='add-candidate')openCandidate();
  else if(action==='edit-candidate')openCandidate(id);
  else if(action==='new-idea')openIdea(null,id);
  else if(action==='edit-idea')openIdea(id);
  else if(action==='brief')makeBrief(id);
  else if(action==='download-brief')download('advisor-contact-brief.txt',briefText,'text/plain;charset=utf-8');
  else if(action==='export'){backup();notify('已导出已保存的个人记录。基础来源资料独立保留在 data/catalog.json。');}
  else if(action==='import'){if(canLeave())$('import-file').click();}
  else if(action==='confirm-import')confirmImport();
  else if(action==='retry')boot();
});
document.addEventListener('submit',event=>{
  if(event.target.matches('[data-save]')){event.preventDefault();saveForm(event.target);}
  else if(event.target.id==='library-search'){
    event.preventDefault();navigate({libraryQuery:String(new FormData(event.target).get('query')||'').trim(),paperPage:1,previewId:null},false);
    $('library-query')?.focus({preventScroll:true});
  }
});
document.addEventListener('input',event=>{const form=event.target.closest('[data-save]');if(form)dirty.add(form.id);});
document.addEventListener('change',event=>{
  const name=event.target.dataset.filter;
  if(name){
    navigate({...(name==='themeEntity'?PublicationModel.defaults:{}),[name]:event.target.value,paperPage:1,previewId:null},false);
    document.querySelector(`[data-filter="${name}"]`)?.focus({preventScroll:true});
  }
  const form=event.target.closest('[data-save]');if(form)dirty.add(form.id);
});
$('search-form').addEventListener('submit',event=>{event.preventDefault();const search=$('global-search').value.trim();if(search)navigate({page:'search',search});});
$('modal-close').addEventListener('click',closeModal);
$('modal').addEventListener('cancel',event=>{event.preventDefault();closeModal();});
$('import-file')?.addEventListener('change',event=>previewImport(event.target.files[0]));
window.addEventListener('beforeunload',event=>{if(!isPublic()&&(dirty.size||busy)){event.preventDefault();event.returnValue='';}});
function applyRuntimeChrome() {
  document.documentElement.dataset.riMode = runtime.mode;
  document.querySelectorAll('[data-private-action]').forEach(el=>{el.hidden=isPublic();});
  const scholarNav = document.querySelector('[data-nav="candidates"]');
  if(scholarNav) scholarNav.textContent = isPublic() ? '学者目录' : '导师候选池';
  if($('version-badge')) $('version-badge').textContent = isPublic() ? `V${runtime.version} · PUBLIC READ-ONLY` : `V${runtime.version} · LOCAL`;
  if($('mode-tagline')) $('mode-tagline').textContent = isPublic() ? '公开稳定版 · 静态只读' : '从研究兴趣，到下一步行动';
  const footerLead = document.querySelector('footer span:first-child');
  if(footerLead) footerLead.textContent = isPublic() ? '公开静态快照。资料可读，个人记录不发布。' : '资料有出处，判断留边界。仅在本机运行。';
}
async function boot() {
  applyRuntimeChrome();
  try{
    if(isPublic()){
      catalog=normalizeCatalog(await api('./catalog.json'));
      workspace=emptyWorkspace();
    } else {
      const [catalogData,workspaceData]=await Promise.all([api('/api/catalog'),api('/api/workspace')]);
      catalog=normalizeCatalog(catalogData);workspace=workspaceData;
    }
    atlasModel=ResearchAtlasModel.prepare(catalog.themes);render();
  }catch(err){$('content').innerHTML=empty(isPublic()?'暂时无法读取公开静态资料':'暂时无法读取本地资料',err.message)+button('重新连接','retry');$('save-state').textContent=isPublic()?'公开静态资料未载入':'未连接';}
}
boot();
