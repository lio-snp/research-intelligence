/* Shared, DOM-free publication filtering and authorship evidence rules. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PublicationModel = model;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const defaults = {libraryQuery:'',paperYear:'all',paperType:'all',paperTheme:'all',paperResearcher:'all',readingStatus:'all',paperDepth:'all',paperPage:1,previewId:null};
  const typeLabels = {journal:'期刊论文',conference:'会议论文',preprint:'预印本',working_paper:'工作论文',book_chapter:'书籍章节',other:'其他研究'};
  const statusLabels = {published:'已发表',accepted:'已接收',preprint:'预印本',working_paper:'工作论文'};
  const depthLabels = {metadata:'书目信息',abstract:'摘要概览',full_text:'全文解读'};
  const normalize = text => String(text || '').normalize('NFKC').toLocaleLowerCase();

  function authorPosition(paper, researcherId) {
    const entry = (paper.authorships || []).find(a => a.researcherId === researcherId);
    const complete = paper.authorListComplete === true && paper.authorOrderVerified === true && !!paper.authorEvidence?.url;
    const index = entry ? (paper.authors || []).indexOf(entry.name) : -1;
    return {entry:entry || null, verified:complete && index >= 0 && entry.position === index + 1, position:complete && index >= 0 && entry.position === index + 1 ? entry.position : null, total:complete ? paper.authors.length : null};
  }

  function filterPapers(papers, state = {}, notes = {}) {
    const f = {...defaults,...state};
    const query = normalize(f.libraryQuery).trim().split(/\s+/).filter(Boolean);
    return papers.filter(p => {
      const versionText = (p.versions || []).map(v => [v.title,v.doi,...(v.authors || [])].join(' '));
      const text = normalize([p.title,...(p.authors || []),p.venue,p.doi,p.abstractSummary,p.researchQuestion,...versionText].join(' '));
      return query.every(word => text.includes(word)) &&
        (f.paperYear === 'all' || (f.paperYear === 'unknown' ? !p.year : String(p.year) === f.paperYear)) &&
        (f.paperType === 'all' || p.publicationType === f.paperType) &&
        (f.paperTheme === 'all' || (f.paperTheme === 'untagged' ? !p.themes?.length : p.themes?.includes(f.paperTheme))) &&
        (f.paperResearcher === 'all' || p.researcherIds?.includes(f.paperResearcher)) &&
        (f.readingStatus === 'all' || (notes[p.id]?.status || 'unread') === f.readingStatus) &&
        (f.paperDepth === 'all' || p.readDepth === f.paperDepth);
    }).sort((a,b) => (b.year || 0) - (a.year || 0) || (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  }

  function paginate(papers, requestedPage = 1, size = 20) {
    const pageCount = Math.max(1,Math.ceil(papers.length / size));
    const page = Math.min(pageCount,Math.max(1,Number(requestedPage) || 1));
    return {page,pageCount,total:papers.length,items:papers.slice((page-1)*size,page*size),start:papers.length ? (page-1)*size+1 : 0,end:Math.min(page*size,papers.length)};
  }

  function recentPapers(researcher, papers) {
    if (researcher.publicationCoverage?.paperIds) {
      const ids = new Set(researcher.publicationCoverage.paperIds);
      return papers.filter(p => ids.has(p.id));
    }
    return papers.filter(p => p.researcherIds?.includes(researcher.id));
  }

  return {defaults,typeLabels,statusLabels,depthLabels,authorPosition,filterPapers,paginate,recentPapers};
});
