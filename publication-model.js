/* Shared, DOM-free publication filtering and authorship evidence rules. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PublicationModel = model;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const defaults = {libraryQuery:'',paperYear:'all',paperType:'all',paperTheme:'all',paperResearcher:'all',readingStatus:'all',paperDepth:'all',questionFilter:'all',paperPage:1,previewId:null};
  const typeLabels = {journal:'期刊论文',conference:'会议论文',preprint:'预印本',working_paper:'工作论文',book_chapter:'书籍章节',other:'其他研究'};
  const statusLabels = {published:'已发表',accepted:'已接收',preprint:'预印本',working_paper:'工作论文'};
  const depthLabels = {metadata:'书目信息',abstract:'摘要概览',full_text:'全文解读'};
  const questionStatusLabels = {extracted:'已提炼',pending_evidence:'待补来源',pending_extraction:'待提炼',stale_evidence:'证据已变化'};
  const questionBasisLabels = {abstract_summary:'摘要概览归纳',full_text_summary:'全文归纳'};
  const normalize = text => String(text || '').normalize('NFKC').toLocaleLowerCase();

  function uniq(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function questionIdForPaper(paper) {
    return paper?.questionId || (paper?.id ? `q_${paper.id}` : null);
  }

  function questionForPaper(paper, questions = []) {
    if (!paper) return null;
    const qid = paper.questionId || questionIdForPaper(paper);
    return questions.find(q => q.id === qid || q.paperIds?.includes(paper.id)) || null;
  }

  function paperQuestionText(paper, questions = []) {
    return paper?.researchQuestion || questionForPaper(paper, questions)?.text || '';
  }

  function normalizedQuestionStatus(paper, questions = []) {
    if (paper?.readDepth === 'metadata') return 'pending_evidence';
    if (['extracted','pending_evidence','pending_extraction','stale_evidence'].includes(paper?.questionStatus)) return paper.questionStatus;
    if (questionForPaper(paper, questions) || paperQuestionText(paper, questions)) return 'extracted';
    return 'pending_extraction';
  }

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
      const text = normalize([p.title,...(p.authors || []),p.venue,p.doi,p.abstractSummary,p.researchQuestion,p.summary?.question,...versionText].join(' '));
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

  function filterByQuestionState(papers, questions = [], clusters = [], filter = 'all') {
    if (filter === 'all') return papers;
    const clusteredIds = new Set(clusters.flatMap(c => c.paperIds || []));
    return papers.filter(p => {
      const status = normalizedQuestionStatus(p, questions);
      if (filter === 'ungrouped') return status === 'extracted' && !clusteredIds.has(p.id);
      return status === filter;
    });
  }

  function questionCoverage(papers = [], questions = [], clusters = [], themes = []) {
    const paperMap = new Map(papers.map(p => [p.id,p]));
    const extractedPaperIds = new Set();
    const awaitingExtraction = new Set();
    const awaitingEvidence = new Set();
    const staleEvidence = new Set();
    for (const p of papers) {
      const status = normalizedQuestionStatus(p, questions);
      if (status === 'extracted') extractedPaperIds.add(p.id);
      else if (status === 'pending_evidence') awaitingEvidence.add(p.id);
      else if (status === 'stale_evidence') staleEvidence.add(p.id);
      else awaitingExtraction.add(p.id);
    }
    const scopedClusters = clusters.map(c => ({...c,paperIds:uniq((c.paperIds || []).filter(id => paperMap.has(id)))})).filter(c => c.paperIds.length);
    const clusteredPaperIds = new Set(scopedClusters.flatMap(c => c.paperIds).filter(id => extractedPaperIds.has(id)));
    const themeStats = themes.map(theme => {
      const scoped = papers.filter(p => p.themes?.includes(theme.id));
      return {themeId:theme.id,...questionCoverage(scoped,questions,clusters,[])};
    });
    return {
      papers: papers.length,
      extracted: extractedPaperIds.size,
      clustered: clusteredPaperIds.size,
      unclustered: [...extractedPaperIds].filter(id => !clusteredPaperIds.has(id)).length,
      awaitingExtraction: awaitingExtraction.size,
      awaitingEvidence: awaitingEvidence.size,
      staleEvidence: staleEvidence.size,
      clusters: scopedClusters.length,
      multiPaperClusters: scopedClusters.filter(c => c.paperIds.length > 1).length,
      singlePaperClusters: scopedClusters.filter(c => c.paperIds.length === 1).length,
      byTheme: themeStats
    };
  }

  function searchQuestions(query, questions = [], clusters = []) {
    const words = normalize(query).trim().split(/\s+/).filter(Boolean);
    const match = value => {
      const text = normalize(JSON.stringify(value || ''));
      return words.every(word => text.includes(word));
    };
    return {
      clusters: words.length ? clusters.filter(c => match([c.title,c.question,c.description,c.paperIds,c.questionIds])) : [],
      questions: words.length ? questions.filter(q => match([q.text,q.evidence?.excerpt,q.paperIds,q.clusterIds])) : []
    };
  }

  return {defaults,typeLabels,statusLabels,depthLabels,questionStatusLabels,questionBasisLabels,normalize,uniq,questionIdForPaper,questionForPaper,paperQuestionText,normalizedQuestionStatus,authorPosition,filterPapers,paginate,recentPapers,filterByQuestionState,questionCoverage,searchQuestions};
});
