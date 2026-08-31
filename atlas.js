(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResearchAtlas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const NS = 'http://www.w3.org/2000/svg';
  const tones = {
    finance: {fill:'#e4edf6',stroke:'#bdcfe0',ink:'#476985'},
    cs: {fill:'#f6edd8',stroke:'#ddcda7',ink:'#826b37'},
    economics: {fill:'#e8eedc',stroke:'#c3d0ad',ink:'#617649'},
    math: {fill:'#eeebf5',stroke:'#d0c5e0',ink:'#75618e'},
    decision: {fill:'#e2eee7',stroke:'#b9d0c2',ink:'#4e7962'},
    management: {fill:'#f5e8df',stroke:'#dfc8b9',ink:'#956c54'},
    pending: {fill:'#f0eee7',stroke:'#d3cfc2',ink:'#726e5f'}
  };

  function shapeVariant(node) {
    return [...String(node.id || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  }

  // These are cartographic grouping cells, not numerical contour lines.
  function regionPath(node) {
    const {x,y,rx,ry} = node;
    if (node.kind !== 'discipline') {
      return `M ${x-rx*.9} ${y-ry*.72} Q ${x-rx*.54} ${y-ry} ${x-rx*.08} ${y-ry*.94} L ${x+rx*.66} ${y-ry*.78} Q ${x+rx} ${y-ry*.58} ${x+rx*.94} ${y-ry*.12} L ${x+rx*.84} ${y+ry*.53} Q ${x+rx*.56} ${y+ry*.92} ${x+rx*.06} ${y+ry*.88} L ${x-rx*.68} ${y+ry*.72} Q ${x-rx} ${y+ry*.5} ${x-rx*.9} ${y-ry*.72} Z`;
    }
    const variant=shapeVariant(node);
    const topLeft=[.82,.76,.88][variant],topRight=[.91,.84,.88][variant];
    const lowerLeft=[.83,.91,.87][variant],lowerRight=[.9,.84,.94][variant];
    return `M ${x-rx*.86} ${y-ry*topLeft} Q ${x-rx*.52} ${y-ry*1.03} ${x-rx*.08} ${y-ry*.94} L ${x+rx*.66} ${y-ry*topRight} Q ${x+rx*.98} ${y-ry*.61} ${x+rx*.91} ${y-ry*.12} L ${x+rx*lowerRight} ${y+ry*.58} Q ${x+rx*.57} ${y+ry*1.02} ${x+rx*.08} ${y+ry*.91} L ${x-rx*.66} ${y+ry*lowerLeft} Q ${x-rx*1.02} ${y+ry*.53} ${x-rx*.94} ${y-ry*.12} Z`;
  }

  function fitScale(width, height, bounds) {
    // Keep readable space between labels; smaller windows pan across the map.
    return Math.max(.62, Math.min((width-64)/Math.max(bounds.width,1), (height-68)/Math.max(bounds.height,1)));
  }

  function project(point, camera, width, height, scale) {
    return {x:width/2+(point.x-camera.cx)*scale,y:height/2+(point.y-camera.cy)*scale};
  }

  function zoomCamera(camera, factor, anchor, width, height, baseScale) {
    const zoom = clamp(camera.zoom*factor,1,3.4);
    const previous = baseScale*camera.zoom, next = baseScale*zoom;
    return {
      cx:camera.cx+(anchor.x-width/2)*(1/previous-1/next),
      cy:camera.cy+(anchor.y-height/2)*(1/previous-1/next),
      zoom
    };
  }

  function overlap(a,b,pad=6) {
    return a.x < b.x+b.width+pad && a.x+a.width+pad > b.x && a.y < b.y+b.height+pad && a.y+a.height+pad > b.y;
  }

  function curvePoint(start,c1,c2,end,t) {
    const u=1-t;
    return {x:u*u*u*start.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*end.x,y:u*u*u*start.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*end.y};
  }

  function inside(point,rect,pad=4) {
    return point.x>rect.x-pad&&point.x<rect.x+rect.width+pad&&point.y>rect.y-pad&&point.y<rect.y+rect.height+pad;
  }

  function curveHits(start,c1,c2,end,obstacles,limit=Infinity) {
    const xs=[start.x,c1.x,c2.x,end.x],ys=[start.y,c1.y,c2.y,end.y];
    const bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
    const nearby=obstacles.filter(rect=>overlap(bounds,rect,4));
    let hits=0;
    for(let step=1;step<128;step++){
      const p=curvePoint(start,c1,c2,end,step/128);
      for(const rect of nearby)if(inside(p,rect))hits++;
      if(hits>=limit)break;
    }
    return hits;
  }

  function curveLength(start,c1,c2,end) {
    let length=0,previous=start;
    for(let step=1;step<=12;step++){
      const p=curvePoint(start,c1,c2,end,step/12);
      length+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;
    }
    return length;
  }

  function routeCurve(start,end,obstacles) {
    const dx=end.x-start.x,dy=end.y-start.y,horizontal=Math.abs(dx)>Math.abs(dy);
    const initial=horizontal
      ? [{x:start.x+dx*.48,y:start.y},{x:end.x-dx*.48,y:end.y}]
      : [{x:start.x,y:start.y+dy*.48},{x:end.x,y:end.y-dy*.48}];
    const candidates=[initial,
      [{x:end.x,y:start.y},{x:end.x,y:start.y}],
      [{x:start.x,y:end.y},{x:start.x,y:end.y}],
      [{x:start.x+dx*.65,y:start.y},{x:end.x,y:end.y-dy*.65}],
      [{x:start.x,y:start.y+dy*.65},{x:end.x-dx*.65,y:end.y}]
    ];
    for(const offset of [-60,60,-100,100,-150,150,-220,220,-280,280]){
      candidates.push(horizontal
        ? [{x:start.x+dx*.22,y:start.y+offset},{x:end.x-dx*.22,y:end.y+offset}]
        : [{x:start.x+offset,y:start.y+dy*.22},{x:end.x+offset,y:end.y-dy*.22}]);
    }
    const corridor={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(dx),height:Math.abs(dy)};
    for(const rect of obstacles.filter(rect=>overlap(corridor,rect,12))){
      for(const gap of [18,32,52]){
        for(const side of horizontal?[rect.y-gap,rect.y+rect.height+gap]:[rect.x-gap,rect.x+rect.width+gap]){
          candidates.push(horizontal?[{x:start.x,y:side},{x:end.x,y:side}]:[{x:side,y:start.y},{x:side,y:end.y}]);
        }
      }
    }
    let best=initial,bestHits=Infinity,bestLength=Infinity;
    for(const candidate of candidates){
      const hits=curveHits(start,candidate[0],candidate[1],end,obstacles,bestHits+1);
      const length=curveLength(start,candidate[0],candidate[1],end);
      if(!hits&&length<=Math.hypot(dx,dy)*1.03+2)return candidate;
      if(hits<bestHits||(hits===bestHits&&length<bestLength)){best=candidate;bestHits=hits;bestLength=length;}
    }
    return best;
  }

  function routeConnection(starts,target,obstacles) {
    let best=null,bestHits=Infinity,bestLength=Infinity;
    const halfW=target.width/2+5,halfH=target.height/2+5;
    const sides=[{x:target.x-halfW,y:target.y},{x:target.x+halfW,y:target.y},{x:target.x,y:target.y-halfH},{x:target.x,y:target.y+halfH}];
    for(const start of starts){
      // A line cannot avoid a heading if its source dot is already inside it.
      if(obstacles.some(rect=>inside(start,rect)))continue;
      const vx=start.x-target.x,vy=start.y-target.y;
      const edge=Math.min(halfW/(Math.abs(vx)||1),halfH/(Math.abs(vy)||1),1);
      const ends=[{x:target.x+vx*edge,y:target.y+vy*edge},...sides];
      for(const end of ends){
        if(obstacles.some(rect=>inside(end,rect)))continue;
        const [c1,c2]=routeCurve(start,end,obstacles);
        const hits=curveHits(start,c1,c2,end,obstacles,bestHits+1);
        const length=curveLength(start,c1,c2,end);
        if(hits<bestHits||(hits===bestHits&&length<bestLength)){
          best={start,end,c1,c2};bestHits=hits;bestLength=length;
        }
      }
    }
    return best;
  }

  function svgElement(tag, attributes) {
    const element = document.createElementNS(NS,tag);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
    return element;
  }

  function render(model, state) {
    return `<section class="research-atlas" id="research-atlas" aria-label="Research Theme Map 学科区域地图">
      <div class="map-toolbar">
        <div class="map-key" aria-label="地图图例"><span class="map-basis"><b>CURATED BASEMAP</b><em>编辑分类底图</em></span><span><i class="map-key-region"></i>学科地块</span><span><i class="map-key-subfield"></i>子领域</span><span><i class="map-key-topic"></i>研究主题覆盖层</span></div>
        <div class="map-tools">
          <label class="map-locator"><span class="sr-only">定位研究主题</span><select aria-label="定位研究主题"><option value="">定位主题…</option>${model.themes.map(t=>`<option value="${escape(t.id)}">${escape(t.mapName)} · ${escape(t.zh)}</option>`).join('')}</select></label>
          <button type="button" data-map-action="expand" class="map-expand" aria-label="展开地图" aria-pressed="false"><span aria-hidden="true">⤢</span><span class="map-expand-copy">展开</span></button>
        </div>
      </div>
      <div class="map-viewport" tabindex="0" role="group" aria-roledescription="可平移缩放的学科地图" aria-label="研究主题主图" aria-describedby="map-instructions">
        <svg class="map-drawing" aria-hidden="true"><g class="map-regions"></g><g class="map-edges"></g></svg>
        <div class="map-labels" aria-hidden="true"></div>
        <div class="map-topics" role="group" aria-label="地图中的研究主题">${model.themes.map(t=>`<button type="button" class="map-topic${t.unmapped?' map-topic-pending':''}" data-map-theme="${escape(t.id)}" aria-pressed="${state.selected===t.id}" aria-controls="map-inspector" aria-label="${escape(t.name)}，${escape(t.zh)}，查看学科归属"><span class="map-topic-name">${escape(t.mapName)}</span><span class="map-topic-zh"><i aria-hidden="true"></i>${escape(t.zh)}</span></button>`).join('')}</div>
        <div class="map-edge-labels" aria-hidden="true"></div>
        <div class="map-corner-note" aria-hidden="true"><span class="map-live-dot"></span><span>BASEMAP · ${model.nodes.filter(n=>n.kind==='discipline').length} 学科 · ${model.themes.length} 主题</span></div>
        <div class="map-camera-tools" role="group" aria-label="地图缩放与聚焦">
          <button type="button" data-map-action="out" aria-label="缩小地图">−</button><output class="map-zoom" aria-label="相对全景的缩放比例">100%</output><button type="button" data-map-action="in" aria-label="放大地图">＋</button><span class="map-tool-divider"></span><button type="button" data-map-action="overview" class="map-overview">全景</button><button type="button" data-map-action="focus" class="map-focus" disabled>聚焦所选</button>
        </div>
      </div>
      <div class="map-reading-strip"><p id="map-instructions"><span class="map-desktop-hint">拖动平移 · Ctrl / ⌘ + 滚轮缩放</span><span class="map-mobile-hint">左右拖动，或用「定位主题」探索地图</span><span class="map-keyboard-hint"> · 方向键平移，＋ / − 缩放，Home 复位</span></p><span class="map-level">全景 · 学科与主题</span></div>
      <div class="map-inspector" id="map-inspector"></div>
      <p class="sr-only" id="map-status" role="status" aria-live="polite"></p>
    </section>
    <p class="map-disclaimer"><strong>地图依据：</strong>底图使用通行的学科与子领域名称，并按本项目的研究范围进行编辑映射；主题是覆盖层。地块面积、距离和位置不代表论文数量、热度、重要性或严格的文献计量相似度。</p>`;
  }

  function mount(root, model, state, options={}) {
    const viewport = root.querySelector('.map-viewport');
    const drawing = root.querySelector('.map-drawing');
    const regions = root.querySelector('.map-regions');
    const edges = root.querySelector('.map-edges');
    const labels = root.querySelector('.map-labels');
    const edgeLabels = root.querySelector('.map-edge-labels');
    const inspector = root.querySelector('.map-inspector');
    const locator = root.querySelector('.map-locator select');
    const status = root.querySelector('#map-status');
    const buttons = new Map([...root.querySelectorAll('[data-map-theme]')].map(el=>[el.dataset.mapTheme,el]));
    const nodeElements = new Map();
    const abort = new AbortController();
    const listener = {signal:abort.signal};
    let width=0,height=0,base=1,scale=1,frame=0,drag=null,disposed=false,lastDrag=0;
    let previousOverflow='',inertElements=[];
    const bounds = model.bounds;
    const ancestry = id => {
      const path=[];
      for(let node=model.nodeById.get(id);node;node=model.nodeById.get(node.parentId)) path.unshift(node);
      return path;
    };

    for (const node of model.nodes) {
      const tone=tones[node.tone]||tones.pending;
      const path=svgElement('path', {d:regionPath(node),fill:node.kind==='discipline'?tone.fill:'#ffffff',stroke:tone.stroke,'stroke-width':node.kind==='discipline'?1.15:1,'fill-opacity':node.kind==='discipline'?'.94':'.58','vector-effect':'non-scaling-stroke','stroke-linejoin':'round','data-map-node':node.id,'data-map-kind':node.kind});
      regions.appendChild(path);
      const label=document.createElement('div');
      label.className=`map-label ${node.kind==='discipline'?'map-domain-label':'map-field-label'}${node.name.length>23?' map-long-label':''}`;
      label.dataset.nodeLabel=node.id;
      label.innerHTML=`${node.kind==='discipline'?`<span class="map-label-code">${escape(node.code||node.id.toUpperCase())}</span>`:''}<span class="map-label-en">${escape(node.mapName||node.name)}</span><span class="map-label-zh">${escape(node.zh)}</span>`;
      label.title=`${node.name} · ${node.zh}`;
      labels.appendChild(label);
      nodeElements.set(node.id,{path,label,depth:ancestry(node.id).length-1});
    }

    const point = value => project(value,state.camera,width,height,scale);
    const requestDraw = () => { if(!frame&&!disposed) frame=requestAnimationFrame(()=>{frame=0;draw();}); };
    const announce = text => {status.textContent=text;};

    const isCropped = () => bounds.width*base>width-63 || bounds.height*base>height-67;

    function resetCamera() {
      state.camera={cx:bounds.x+bounds.width/2,cy:bounds.y+bounds.height/2,zoom:1};
      if(isCropped()&&model.themeById.has('finai')) state.camera.cx=model.themeById.get('finai').x;
      state.overview=true;
    }

    function measure() {
      if(disposed)return;
      width=viewport.clientWidth;height=viewport.clientHeight;
      if(!width||!height)return;
      base=fitScale(width,height,bounds);
      root.classList.toggle('map-cropped',isCropped());
      if(!state.camera||state.overview)resetCamera();
      requestDraw();
    }

    function draw() {
      if(disposed||!width||!height||!state.camera)return;
      scale=base*state.camera.zoom;
      const camera=state.camera, selected=model.themeById.get(state.selected);
      const related=new Set(selected ? selected.links.flatMap(l=>ancestry(l.nodeId).map(n=>n.id)) : []);
      const detailed=camera.zoom>=1.35;
      drawing.setAttribute('viewBox',`0 0 ${width} ${height}`);
      regions.setAttribute('transform',`translate(${width/2-camera.cx*scale} ${height/2-camera.cy*scale}) scale(${scale})`);
      const obstacles=[];

      for(const node of model.nodes) {
        const {path,label,depth}=nodeElements.get(node.id);
        const active=!selected||related.has(node.id);
        const visible=depth<2||node.parentId==='ai'||detailed||related.has(node.id);
        path.setAttribute('opacity',active?'1':'.43');
        path.style.display=visible?'':'none';
        path.setAttribute('stroke-width',selected&&related.has(node.id)?'1.7':node.kind==='discipline'?'1.15':'1');
        label.classList.toggle('map-label-muted',!active);
        label.hidden=!visible;
        const centered=node.id==='statistics'&&!detailed&&!related.has('timeseries');
        const p=point({x:node.labelX??node.x,y:centered?node.y:(node.labelY??node.y)});
        const isDomain=node.kind==='discipline';
        label.style.left=`${p.x}px`;label.style.top=`${p.y}px`;
        label.style.width=`${isDomain?clamp(node.rx*scale*1.82,180,282):clamp(node.rx*scale*1.75,106,205)}px`;
        label.style.setProperty('--label-size',`${isDomain?clamp(21*Math.sqrt(scale/.62),18,25):clamp(13*Math.sqrt(scale/.62),12,16)}px`);
        if(visible){
          const viewportRect=viewport.getBoundingClientRect();
          for(const text of label.children){
            const rect=text.getBoundingClientRect();
            obstacles.push({x:rect.x-viewportRect.x,y:rect.y-viewportRect.y,width:rect.width,height:rect.height});
          }
        }
      }

      for(const theme of model.themes) {
        const button=buttons.get(theme.id),p=point(theme);
        button.style.left=`${p.x}px`;button.style.top=`${p.y}px`;
        button.style.width=`${clamp(300*scale,170,228)}px`;
        button.style.setProperty('--topic-accent',(tones[theme.tone]||tones.finance).ink);
        button.classList.toggle('map-topic-selected',theme.id===state.selected);
        button.setAttribute('aria-pressed',String(theme.id===state.selected));
        obstacles.push({x:p.x-button.offsetWidth/2,y:p.y-button.offsetHeight/2,width:button.offsetWidth,height:button.offsetHeight});
      }
      drawConnections(selected,obstacles);
      root.querySelector('.map-zoom').textContent=`${Math.round(camera.zoom*100)}%`;
      root.querySelector('[data-map-action="out"]').disabled=camera.zoom<=1.001;
      root.querySelector('[data-map-action="in"]').disabled=camera.zoom>=3.399;
      root.querySelector('[data-map-action="focus"]').disabled=!selected;
      root.querySelector('.map-level').textContent=detailed?'细看 · 子领域与关系':selected?'已选主题 · 显示相关路径':'全景 · 学科与主题';
    }

    function drawConnections(theme,obstacles) {
      edges.replaceChildren();edgeLabels.replaceChildren();
      if(!theme)return;
      const p=point(theme), button=buttons.get(theme.id);
      for(const relation of theme.links) {
        if(relation.role==='belongs')continue;
        const node=model.nodeById.get(relation.nodeId);
        const dx=theme.x-node.x,dy=theme.y-node.y;
        const norm=Math.sqrt(dx*dx/(node.rx*node.rx)+dy*dy/(node.ry*node.ry))||1;
        const children=model.nodes.filter(n=>n.parentId===node.id);
        const angle=Math.atan2(dy/node.ry,dx/node.rx),radius=children.length ? .86 : .96;
        const sources=[{x:node.x+dx/norm*.96,y:node.y+dy/norm*.96},...[0,-.65,.65,-1.15,1.15,-1.7,1.7].map(turn=>({x:node.x+Math.cos(angle+turn)*node.rx*radius,y:node.y+Math.sin(angle+turn)*node.ry*radius}))];
        const starts=sources.filter(source=>children.every(c=>((source.x-c.x)/c.rx)**2+((source.y-c.y)/c.ry)**2>1.1)).map(point);
        const route=routeConnection(starts,{...p,width:button.offsetWidth,height:button.offsetHeight},obstacles);
        if(!route)continue;
        const {start,end,c1,c2}=route;
        edges.appendChild(svgElement('path',{d:`M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,fill:'none',stroke:'#6d7c73','stroke-width':1.65,'stroke-dasharray':relation.role==='method'?'5 4':relation.role==='perspective'?'2 4':'none','stroke-linecap':'round'}));
        edges.appendChild(svgElement('circle',{cx:start.x,cy:start.y,r:3.2,fill:'#fffdf8',stroke:'#6d7c73','stroke-width':1.5}));
        let middle=curvePoint(start,c1,c2,end,.5);
        const label=document.createElement('span');
        label.className='map-edge-label';label.textContent=relation.label;
        edgeLabels.appendChild(label);
        const w=label.offsetWidth,h=label.offsetHeight;
        const offsets=[[0,-22],[0,22],[-36,-22],[36,-22],[0,-48],[0,48],[-65,0],[65,0],[-36,48],[36,48]];
        let box=null;
        for(const t of [.5,.3,.7,.15,.85]){
          middle=curvePoint(start,c1,c2,end,t);
          for(const [ox,oy] of offsets){
            const candidate={x:middle.x+ox-w/2,y:middle.y+oy-h/2,width:w,height:h};
            if(candidate.x<10||candidate.y<10||candidate.x+w>width-10||candidate.y+h>height-66)continue;
            if(!obstacles.some(o=>overlap(candidate,o,4))){box=candidate;break;}
          }
          if(box)break;
        }
        // The inspector always exposes the same relation if the current viewport has no free label space.
        if(!box){label.remove();continue;}
        label.style.left=`${box.x}px`;label.style.top=`${box.y}px`;
        edges.appendChild(svgElement('path',{d:`M ${middle.x} ${middle.y} L ${box.x+w/2} ${box.y+h/2}`,stroke:'#95a095','stroke-width':.8,fill:'none'}));
        obstacles.push(box);
      }
    }

    function updateInspector() {
      const theme=model.themeById.get(state.selected);
      locator.value=theme?.id||'';
      if(!theme) {
        inspector.innerHTML=`<div class="map-inspector-lead"><span class="map-inspector-index" aria-hidden="true">↗</span><div><div class="map-inspector-eyebrow">READ THE LANDSCAPE</div><h2>从一个主题，找到它的学科来路。</h2><p>点选地图上的主题，查看它属于哪里、借用了什么方法，再进入具体研究。</p></div></div><div class="map-inspector-guide"><span><i class="map-sample-line"></i>问题 / 归属</span><span><i class="map-sample-line method"></i>方法来源</span><span><i class="map-sample-line perspective"></i>研究视角</span></div>`;
        return;
      }
      inspector.innerHTML=`<div class="map-inspector-content"><div class="map-inspector-heading"><div><div class="map-inspector-eyebrow">${escape(theme.kind)}${theme.unmapped?' · 待定位':''}</div><h2>${escape(theme.name)}</h2></div><div class="map-inspector-actions"><button type="button" class="map-clear" data-map-action="clear" aria-label="取消主题选择">取消选择</button><button type="button" class="primary" data-map-action="open">进入主题工作区 <span aria-hidden="true">↗</span></button></div></div><p class="map-theme-description">${escape(theme.description)}</p><div class="map-breadcrumbs">${theme.links.map(l=>`<div class="map-breadcrumb"><span class="map-relation-type"><i class="map-sample-line ${l.role==='method'?'method':l.role==='perspective'?'perspective':''}"></i>${escape(l.label)}</span><span>${ancestry(l.nodeId).map(n=>escape(n.zh)).join('<b aria-hidden="true"> / </b>')}${l.role==='belongs'?'<b aria-hidden="true"> / </b>'+escape(theme.zh):''}</span></div>`).join('')||'<span class="map-unmapped-note">该主题已保留；补充学科关系前，不猜测它的归属。</span>'}</div></div>`;
    }

    function select(id,focus=false) {
      if(id&&!model.themeById.has(id))return;
      state.selected=id||null;
      options.onSelect?.(state.selected);
      updateInspector();
      if(focus&&id)focusTheme();else requestDraw();
      const theme=model.themeById.get(id);
      announce(theme?`已选择 ${theme.name}。${theme.description}`:'已取消选择，显示全部学科与主题。');
    }

    function focusTheme() {
      const theme=model.themeById.get(state.selected);if(!theme)return;
      const sources=theme.links.map(l=>model.nodeById.get(l.nodeId));
      const points=[{x:theme.x,y:theme.y,rx:160,ry:75},...sources];
      const minX=Math.min(...points.map(p=>p.x-p.rx)),maxX=Math.max(...points.map(p=>p.x+p.rx));
      const minY=Math.min(...points.map(p=>p.y-p.ry)),maxY=Math.max(...points.map(p=>p.y+p.ry));
      const fitted=Math.min((width-120)/(maxX-minX+90),(height-120)/(maxY-minY+90));
      state.camera={cx:(minX+maxX)/2,cy:(minY+maxY)/2,zoom:clamp(fitted/base,1,2.7)};
      if(isCropped()){state.camera.cx=theme.x;state.camera.cy=theme.y;state.camera.zoom=Math.max(state.camera.zoom,1.18);}
      state.overview=false;requestDraw();
    }

    function zoom(factor,anchor={x:width/2,y:height/2}) {
      state.camera=zoomCamera(state.camera,factor,anchor,width,height,base);
      state.overview=false;requestDraw();
    }

    function restoreBackground() {
      document.body.style.overflow=previousOverflow;
      inertElements.forEach(([element,previous])=>{element.inert=previous;});inertElements=[];
    }

    function expand(force) {
      const expanded=force??!state.expanded;
      if(expanded===!!state.expanded)return;
      state.expanded=expanded;
      const button=root.querySelector('[data-map-action="expand"]');
      root.classList.toggle('map-expanded',expanded);
      button.setAttribute('aria-label',expanded?'收起地图':'展开地图');
      button.setAttribute('aria-pressed',String(expanded));
      button.querySelector('.map-expand-copy').textContent=expanded?'收起':'展开';
      if(expanded){
        previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
        for(let current=root;current&&current!==document.body;current=current.parentElement){
          for(const sibling of current.parentElement.children){
            if(sibling===current)continue;
            inertElements.push([sibling,sibling.inert]);sibling.inert=true;
          }
        }
        root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
      }else{restoreBackground();root.removeAttribute('role');root.removeAttribute('aria-modal');}
      button.focus({preventScroll:true});measure();
      announce(expanded?'地图已展开。按 Escape 可收起。':'地图已收起。');
    }

    root.addEventListener('click',event=>{
      const topic=event.target.closest('[data-map-theme]');
      if(topic){select(topic.dataset.mapTheme,isCropped());return;}
      const action=event.target.closest('[data-map-action]')?.dataset.mapAction;
      if(action==='in')zoom(1.25);
      else if(action==='out')zoom(1/1.25);
      else if(action==='overview'){resetCamera();requestDraw();announce('已回到地图初始视野。');}
      else if(action==='focus')focusTheme();
      else if(action==='clear')select(null);
      else if(action==='open'&&state.selected)options.onOpen?.(state.selected);
      else if(action==='expand')expand();
    },listener);
    locator.addEventListener('change',()=>select(locator.value,!!locator.value),listener);

    viewport.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.isPrimary===false||event.target.closest('button,select'))return;
      drag={pointer:event.pointerId,x:event.clientX,y:event.clientY,cx:state.camera.cx,cy:state.camera.cy,moved:false,touch:event.pointerType==='touch'};
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('map-dragging');
      if(event.pointerType!=='touch')viewport.focus({preventScroll:true});
    },listener);
    viewport.addEventListener('pointermove',event=>{
      if(!drag||drag.pointer!==event.pointerId)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      drag.moved=true;
      state.camera.cx=drag.cx-dx/scale;
      if(!drag.touch||state.expanded)state.camera.cy=drag.cy-dy/scale;
      state.overview=false;requestDraw();
    },listener);
    const endDrag=event=>{
      if(!drag||drag.pointer!==event.pointerId)return;
      if(drag.moved)lastDrag=Date.now();
      if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
      drag=null;viewport.classList.remove('map-dragging');
    };
    viewport.addEventListener('pointerup',endDrag,listener);
    viewport.addEventListener('pointercancel',endDrag,listener);
    viewport.addEventListener('lostpointercapture',endDrag,listener);
    viewport.addEventListener('wheel',event=>{
      if(!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();const rect=viewport.getBoundingClientRect();
      zoom(Math.exp(clamp(-event.deltaY*.006,-.22,.22)),{x:event.clientX-rect.left,y:event.clientY-rect.top});
    },{...listener,passive:false});
    viewport.addEventListener('dblclick',event=>{
      if(event.target.closest('button')||Date.now()-lastDrag<150)return;
      const rect=viewport.getBoundingClientRect();zoom(1.4,{x:event.clientX-rect.left,y:event.clientY-rect.top});
    },listener);
    viewport.addEventListener('keydown',event=>{
      if(event.target!==viewport)return;
      const movement={ArrowLeft:[-70,0],ArrowRight:[70,0],ArrowUp:[0,-70],ArrowDown:[0,70]}[event.key];
      if(movement){event.preventDefault();state.camera.cx+=movement[0]/scale;state.camera.cy+=movement[1]/scale;state.overview=false;requestDraw();}
      else if(['+','=','-','_','Home'].includes(event.key)){
        event.preventDefault();if(event.key==='Home'){resetCamera();requestDraw();}else zoom(['+','='].includes(event.key)?1.25:1/1.25);
      }
    },listener);
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){
        if(state.expanded){event.preventDefault();expand(false);}
        else if(state.selected){event.preventDefault();select(null);viewport.focus({preventScroll:true});}
      }
      if(event.key==='Tab'&&state.expanded){
        const focusable=[...root.querySelectorAll('button:not([disabled]),select,[tabindex="0"]')].filter(el=>el.getClientRects().length);
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    },listener);
    viewport.addEventListener('focusin',event=>{
      const button=event.target.closest('[data-map-theme]');if(!button||!state.camera)return;
      const p=point(model.themeById.get(button.dataset.mapTheme));
      const halfW=button.offsetWidth/2+18,halfH=button.offsetHeight/2+18;
      const dx=p.x-clamp(p.x,halfW,width-halfW),dy=p.y-clamp(p.y,halfH,height-halfH-62);
      if(dx||dy){state.camera.cx+=dx/scale;state.camera.cy+=dy/scale;state.overview=false;requestDraw();}
    },listener);

    const observer=new ResizeObserver(measure);observer.observe(viewport);
    if(state.selected&&!model.themeById.has(state.selected))state.selected=null;
    // Expanded mode is local to this visit; camera and theme survive navigation.
    state.expanded=false;
    updateInspector();measure();

    return {select,focus:focusTheme,dispose(){
      disposed=true;cancelAnimationFrame(frame);observer.disconnect();abort.abort();
      if(state.expanded){restoreBackground();state.expanded=false;}
    }};
  }

  return {render,mount,regionPath,fitScale,project,zoomCamera,overlap,routeCurve,curvePoint,routeConnection};
});
