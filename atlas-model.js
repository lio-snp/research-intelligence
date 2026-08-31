(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResearchAtlasModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const VALID_ROLES = new Set(['problem', 'method', 'perspective', 'belongs']);
  const TOPIC_BOX = {width: 280, height: 130};
  const DEFAULT_SIZE = {
    discipline: {rx:190, ry:145},
    subfield: {rx:112, ry:68}
  };
  const definition = {
    nodes: [
      {id:'finance',code:'FIN',kind:'discipline',parentId:null,name:'Finance',zh:'金融学',tone:'finance',x:340,y:184.1,rx:280,ry:147.7,labelX:340,labelY:81.2},
      {id:'cs',code:'CS',kind:'discipline',parentId:null,name:'Computer Science',zh:'计算机科学',tone:'cs',x:1088,y:194.6,rx:332,ry:161.7,labelX:1105,labelY:74.9},
      {id:'management',code:'MGT',kind:'discipline',parentId:null,name:'Business & Management',mapName:'Management',zh:'商业与管理',tone:'management',x:210,y:557.2,rx:187,ry:116.9,labelX:207,labelY:478.1},
      {id:'economics',code:'ECON',kind:'discipline',parentId:null,name:'Economics',zh:'经济学',tone:'economics',x:568,y:558.6,rx:186,ry:115.5,labelX:552,labelY:479.5},
      {id:'math',code:'MATH',kind:'discipline',parentId:null,name:'Mathematics & Statistics',zh:'数学与统计',tone:'math',x:981,y:555.1,rx:226,ry:140,labelX:996,labelY:465.5},
      {id:'or',code:'OR',kind:'discipline',parentId:null,name:'Operations Research & Control',zh:'运筹与控制',tone:'decision',x:1405,y:556.5,rx:218,ry:125.3,labelX:1405,labelY:483},
      {id:'markets',kind:'subfield',parentId:'finance',name:'Financial Markets',zh:'金融市场',tone:'finance',x:348,y:219.1,rx:204,ry:88.2,labelX:345,labelY:175},
      {id:'ai',kind:'subfield',parentId:'cs',name:'AI / ML',zh:'人工智能 / 机器学习',tone:'cs',x:1084,y:228.2,rx:271,ry:109.9,labelX:1098,labelY:152.6},
      {id:'theory',kind:'subfield',parentId:'ai',name:'ML Theory',zh:'机器学习理论',tone:'cs',x:955,y:239.4,rx:114,ry:47.6,labelX:955,labelY:234.5},
      {id:'rl',kind:'subfield',parentId:'ai',name:'Reinforcement Learning',mapName:'RL',zh:'强化学习',tone:'cs',x:1200,y:245,rx:103,ry:51.1,labelX:1200,labelY:239.4},
      {id:'is',kind:'subfield',parentId:'management',name:'Information Systems',zh:'信息系统',tone:'management',x:211,y:574,rx:144,ry:62.3,labelX:211,labelY:567},
      {id:'econometrics',kind:'subfield',parentId:'economics',name:'Econometrics',zh:'计量经济学',tone:'economics',x:566,y:583.1,rx:140,ry:58.1,labelX:566,labelY:576.1},
      {id:'statistics',kind:'subfield',parentId:'math',name:'Statistics',zh:'统计学',tone:'math',x:876,y:578.9,rx:109,ry:59.5,labelX:876,labelY:539},
      {id:'timeseries',kind:'subfield',parentId:'statistics',name:'Time Series Analysis',mapName:'Time Series',zh:'时间序列分析',tone:'math',x:876,y:600.6,rx:88,ry:33.6,labelX:876,labelY:600.6},
      {id:'optimization',kind:'subfield',parentId:'math',name:'Optimization',zh:'数学优化',tone:'math',x:1099,y:583.1,rx:92,ry:49.7,labelX:1099,labelY:578.9},
      {id:'sequential',kind:'subfield',parentId:'or',name:'Sequential Decisions',zh:'序贯决策',tone:'decision',x:1408,y:580.3,rx:163,ry:61.6,labelX:1408,labelY:574}
    ],
    themes: [
      {id:'asset',mapName:'Asset Pricing',zh:'资产定价',kind:'领域内子问题',parentId:'markets',x:348,y:259,tone:'finance',description:'资产定价研究金融市场中的价格、回报与风险补偿。它首先属于金融市场问题；使用 AI 或计量工具，不改变这个问题归属。',links:[{nodeId:'markets',role:'belongs',label:'子领域归属'}]},
      {id:'finai',mapName:'Financial AI',zh:'金融 × 人工智能',kind:'交叉研究',parentId:null,x:698,y:177.1,tone:'cross',description:'以金融问题为出发点，借助 AI 的学习、预测与推理方法。问题来自哪里，与方法来自哪里，要分别看清。',links:[{nodeId:'finance',role:'problem',label:'问题领域'},{nodeId:'ai',role:'method',label:'方法来源'}]},
      {id:'digital',mapName:'Digital Finance & IS',zh:'数字金融 × 信息系统',kind:'场景与视角',parentId:null,x:212,y:365.4,tone:'management',description:'把数字平台、技术与金融行为放在一起研究。金融提供应用场景，信息系统提供理解技术、组织与用户行为的研究视角。',links:[{nodeId:'finance',role:'problem',label:'金融场景'},{nodeId:'is',role:'perspective',label:'研究视角'}]},
      {id:'ts',mapName:'Time Series & Econometrics',zh:'时间序列 × 计量',kind:'方法与推断',parentId:null,x:580,y:374.5,tone:'economics',description:'时间序列关注数据随时间的变化与依赖；计量经济学把统计方法用于经济问题中的估计、识别和推断。两者有交集，也各有自己的范围。',links:[{nodeId:'econometrics',role:'problem',label:'经济推断'},{nodeId:'timeseries',role:'method',label:'统计方法'}]},
      {id:'ml',mapName:'ML Theory & Optimization',zh:'学习理论 × 优化',kind:'理论与工具',parentId:null,x:959,y:357,tone:'math',description:'机器学习理论研究学习、泛化与算法保证；数学优化提供求解和分析工具。优化也服务于机器学习之外的许多问题。',links:[{nodeId:'theory',role:'problem',label:'学习问题'},{nodeId:'optimization',role:'method',label:'数学工具'}]},
      {id:'decision',mapName:'Decision Making & RL',zh:'决策 × 强化学习',kind:'问题与方法',parentId:null,x:1333,y:359.1,tone:'decision',description:'决策问题连接运筹与控制；强化学习提供一类从反馈中学习策略的方法。强化学习不是全部决策研究。',links:[{nodeId:'sequential',role:'problem',label:'决策问题'},{nodeId:'rl',role:'method',label:'学习方法'}]}
    ]
  };

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }

  function finiteNumber(value, field, id) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${id}.${field} must be a finite number`);
  }

  function hasFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isNodePositioned(node) {
    return ['x','y','rx','ry','labelX','labelY'].every(field => hasFiniteNumber(node[field]));
  }

  function suppliedInvalidLayout(item, fields) {
    return fields.find(field => Object.prototype.hasOwnProperty.call(item, field) && !hasFiniteNumber(item[field]));
  }

  function hasOwn(item, field) {
    return Object.prototype.hasOwnProperty.call(item, field);
  }

  function requirePair(item, a, b) {
    if (hasOwn(item, a) !== hasOwn(item, b)) throw new Error(`${item.id}.${a} and ${b} must be supplied together or omitted together`);
  }

  function subfieldFitsParent(node, parent) {
    if (!parent || !isNodePositioned(node) || !isNodePositioned(parent)) return true;
    const dx = Math.abs(node.x - parent.x);
    const dy = Math.abs(node.y - parent.y);
    return dx + node.rx <= parent.rx * .98 && dy + node.ry <= parent.ry * .98;
  }

  function assertUnique(items, type) {
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error(`${type} id is required`);
      if (seen.has(item.id)) throw new Error(`duplicate ${type} id: ${item.id}`);
      seen.add(item.id);
    }
  }

  function validateGraph(nodes, themes) {
    assertUnique(nodes, 'node');
    assertUnique(themes, 'theme');
    const nodeIds = new Set(nodes.map(n => n.id));
    for (const node of nodes) {
      if (!['discipline', 'subfield'].includes(node.kind)) throw new Error(`${node.id}.kind is invalid`);
      if (node.parentId !== null && !nodeIds.has(node.parentId)) throw new Error(`${node.id}.parentId target is missing`);
      ['x','y','rx','ry','labelX','labelY'].forEach(field => finiteNumber(node[field], field, node.id));
      if (node.rx <= 0 || node.ry <= 0) throw new Error(`${node.id}.rx and ry must be positive`);
      if (node.kind === 'subfield' && !subfieldFitsParent(node, nodes.find(item => item.id === node.parentId))) {
        throw new Error(`${node.id} must fit inside parent ${node.parentId}`);
      }
    }
    for (const theme of themes) {
      ['x','y'].forEach(field => finiteNumber(theme[field], field, theme.id));
      if (theme.parentId !== null && !nodeIds.has(theme.parentId)) throw new Error(`${theme.id}.parentId target is missing`);
      if (!Array.isArray(theme.links)) throw new Error(`${theme.id}.links must be an array`);
      for (const link of theme.links) {
        if (!nodeIds.has(link.nodeId)) throw new Error(`${theme.id}.links target is missing: ${link.nodeId}`);
        if (!VALID_ROLES.has(link.role)) throw new Error(`${theme.id}.links role is invalid: ${link.role}`);
      }
    }
    for (const node of nodes) {
      const path = new Set();
      let cursor = node;
      while (cursor) {
        if (path.has(cursor.id)) throw new Error(`cycle detected at ${cursor.id}`);
        path.add(cursor.id);
        cursor = cursor.parentId ? nodes.find(n => n.id === cursor.parentId) : null;
      }
    }
  }

  function boundsOf(nodes, themes) {
    const boxes = [];
    for (const node of nodes) boxes.push({x1:node.x-node.rx-8,y1:node.y-node.ry-8,x2:node.x+node.rx+8,y2:node.y+node.ry+8});
    for (const theme of themes) boxes.push({x1:theme.x-TOPIC_BOX.width/2-8,y1:theme.y-TOPIC_BOX.height/2-8,x2:theme.x+TOPIC_BOX.width/2+8,y2:theme.y+TOPIC_BOX.height/2+8});
    if (!boxes.length) return {x:0,y:0,width:1,height:1};
    const x1 = Math.min(...boxes.map(b => b.x1));
    const y1 = Math.min(...boxes.map(b => b.y1));
    const x2 = Math.max(...boxes.map(b => b.x2));
    const y2 = Math.max(...boxes.map(b => b.y2));
    return {x:x1,y:y1,width:x2-x1,height:y2-y1};
  }

  function themeOverlaps(a, b) {
    return Math.abs(a.x - b.x) < TOPIC_BOX.width && Math.abs(a.y - b.y) < TOPIC_BOX.height;
  }

  function firstFreeThemePoint(x, y, occupied) {
    const candidates = [{x, y}];
    const offsets = [
      [0, -165], [0, 165], [-330, 0], [330, 0],
      [-250, -150], [250, -150], [-250, 150], [250, 150],
      [0, -330], [0, 330], [-520, 0], [520, 0]
    ];
    for (const [dx, dy] of offsets) candidates.push({x:x + dx, y:y + dy});
    return candidates.find(point => !occupied.some(theme => themeOverlaps(point, theme))) || {x:x + occupied.length * 34, y:y + occupied.length * 24};
  }

  function fallbackTheme(item, index, occupied, nodes) {
    const maxNodeRight = Math.max(1640, ...nodes.filter(isNodePositioned).map(node => node.x + node.rx));
    const maxThemeRight = Math.max(1640, ...occupied.filter(theme => hasFiniteNumber(theme.x)).map(theme => theme.x + TOPIC_BOX.width / 2));
    const x = Math.max(maxNodeRight, maxThemeRight) + 240 + (index % 2) * 320;
    const y = 260 + Math.floor(index / 2) * 170;
    return {
      id:item.id,
      name:item.name,
      mapName:item.name,
      zh:'待定位',
      kind:'待定位主题',
      description:item.description || '这个主题还没有人工确认的学科位置；先保留入口，不推断学科关系。',
      links:[],
      parentId:null,
      x,
      y,
      tone:'pending',
      unmapped:true
    };
  }

  function countPendingSiblings(nodes, parentId) {
    return nodes.filter(item => item.parentId === parentId && !isNodePositioned(item)).length;
  }

  function layoutChildInsideParent(node, parent, siblingIndex, siblingCount) {
    if (node.rx * 1.2 > parent.rx || node.ry * 1.2 > parent.ry) throw new Error(`${node.id} requires explicit coordinates because it does not fit inside ${parent.id}`);
    if (siblingCount > 4) throw new Error(`${node.id} requires explicit coordinates because ${parent.id} has too many auto-placed children`);
    const angle = -Math.PI / 2 + siblingIndex * (Math.PI * 2 / Math.max(4, siblingCount));
    node.x = parent.x + Math.cos(angle) * Math.max(0, parent.rx - node.rx) * .58;
    node.y = parent.y + Math.sin(angle) * Math.max(0, parent.ry - node.ry) * .58;
    node.labelX = hasFiniteNumber(node.labelX) ? node.labelX : node.x;
    node.labelY = hasFiniteNumber(node.labelY) ? node.labelY : node.y;
    if (!subfieldFitsParent(node, parent)) throw new Error(`${node.id} requires explicit coordinates because auto placement exceeded ${parent.id}`);
  }

  function parentOrdered(nodes) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const visited = new Set();
    const visiting = new Set();
    const ordered = [];
    function visit(node) {
      if (visited.has(node.id)) return;
      if (visiting.has(node.id)) throw new Error(`cycle detected at ${node.id}`);
      visiting.add(node.id);
      if (node.parentId && byId.has(node.parentId)) visit(byId.get(node.parentId));
      visiting.delete(node.id);
      visited.add(node.id);
      ordered.push(node);
    }
    nodes.forEach(visit);
    return ordered;
  }

  function layoutNodes(nodes) {
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
      const badField = suppliedInvalidLayout(node, ['x','y','rx','ry','labelX','labelY']);
      if (badField) throw new Error(`${node.id}.${badField} must be omitted or a finite number`);
      requirePair(node, 'x', 'y');
      requirePair(node, 'rx', 'ry');
      requirePair(node, 'labelX', 'labelY');
    }
    let newDisciplineCount = 0;
    const pending = new Set(nodes);
    let changed = true;
    while (pending.size && changed) {
      changed = false;
      for (const node of [...pending]) {
      if (isNodePositioned(node)) continue;
      const size = DEFAULT_SIZE[node.kind];
      if (!size) continue;
      node.rx = hasFiniteNumber(node.rx) ? node.rx : size.rx;
      node.ry = hasFiniteNumber(node.ry) ? node.ry : size.ry;
      if (node.kind === 'discipline') {
        const maxRight = Math.max(1640, ...nodes.filter(isNodePositioned).map(item => item.x + item.rx));
        node.x = maxRight + 300 + (newDisciplineCount % 2) * 360;
        node.y = 300 + Math.floor(newDisciplineCount / 2) * 420;
        node.labelX = hasFiniteNumber(node.labelX) ? node.labelX : node.x;
        node.labelY = hasFiniteNumber(node.labelY) ? node.labelY : node.y - node.ry - 52;
        newDisciplineCount += 1;
        pending.delete(node);
        changed = true;
        continue;
      }
      const parent = nodeById.get(node.parentId);
      if (!parent || !isNodePositioned(parent)) continue;
      const siblings = nodes.filter(item => item.parentId === node.parentId && !isNodePositioned(item));
      layoutChildInsideParent(node, parent, siblings.indexOf(node), Math.max(1, countPendingSiblings(nodes, node.parentId)));
      pending.delete(node);
      changed = true;
      }
    }
    if (nodes.some(node => !isNodePositioned(node))) throw new Error('some nodes require explicit coordinates because their parents could not be placed');
    nodes.splice(0, nodes.length, ...parentOrdered(nodes));
  }

  function layoutSourceTheme(theme, nodes, occupied) {
    const badField = suppliedInvalidLayout(theme, ['x','y']);
    if (badField) throw new Error(`${theme.id}.${badField} must be omitted or a finite number`);
    requirePair(theme, 'x', 'y');
    if (hasFiniteNumber(theme.x) && hasFiniteNumber(theme.y)) return theme;
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const anchors = (theme.links || []).map(link => nodeById.get(link.nodeId)).filter(Boolean);
    if (!anchors.length) return null;
    const seed = {
      x: anchors.reduce((sum, node) => sum + node.x, 0) / anchors.length,
      y: anchors.reduce((sum, node) => sum + node.y, 0) / anchors.length
    };
    const point = firstFreeThemePoint(seed.x, seed.y, occupied);
    theme.x = point.x;
    theme.y = point.y;
    return theme;
  }

  function prepare(catalogThemes, source) {
    const base = clone(source || definition);
    const input = Array.isArray(catalogThemes) ? catalogThemes : [];
    layoutNodes(base.nodes);
    const catalogIds = new Set();
    for (const item of input) {
      if (!item || typeof item.id !== 'string') throw new Error('catalog theme id is required');
      if (catalogIds.has(item.id)) throw new Error(`duplicate catalog theme id: ${item.id}`);
      catalogIds.add(item.id);
    }
    let nextFallback = 0;
    const occupied = [];
    const themes = input.map(item => {
      const seeded = base.themes.find(t => t.id === item.id);
      if (seeded) {
        const theme = layoutSourceTheme({...seeded, name:item.name || seeded.mapName, description:seeded.description || item.description || ''}, base.nodes, occupied);
        if (theme) {
          occupied.push(theme);
          return theme;
        }
      }
      const theme = fallbackTheme(item, nextFallback, occupied.concat(base.themes), base.nodes);
      nextFallback += 1;
      occupied.push(theme);
      return theme;
    });
    const nodes = base.nodes;
    validateGraph(nodes, themes);
    return {nodes, themes, nodeById:new Map(nodes.map(n => [n.id, n])), themeById:new Map(themes.map(t => [t.id, t])), bounds:boundsOf(nodes, themes)};
  }

  function ancestry(nodeId, model) {
    const graph = model && model.nodeById ? model : prepare([]);
    const start = graph.nodeById.get(nodeId);
    if (!start) return [];
    const path = [];
    const seen = new Set();
    let cursor = start;
    while (cursor) {
      if (seen.has(cursor.id)) throw new Error(`cycle detected at ${cursor.id}`);
      seen.add(cursor.id);
      path.unshift(cursor);
      cursor = cursor.parentId ? graph.nodeById.get(cursor.parentId) : null;
    }
    return path;
  }

  validateGraph(definition.nodes, definition.themes);
  return {definition, prepare, ancestry};
});
