function routeDigits(value){
  const m=String(value||'').match(/\d+/);
  if(!m) return null;
  const n=Number(m[0]);
  return Number.isFinite(n)&&n>=0&&n<=9999?Math.trunc(n):null;
}
function mainlineSri(routeNo){return String(routeNo).padStart(8,'0')+'__'}
function sqlQuote(v){return String(v).replace(/'/g,"''")}

async function arcgisMilepostQuery(where){
  const q=new URLSearchParams({
    where,
    outFields:'SRI,MP,ROUTE_SUBT,SLD_NAME,Longitude,Latitude',
    returnGeometry:'true',
    outSR:'3424',
    orderByFields:'MP ASC',
    resultRecordCount:'2000',
    f:'json'
  });
  const r=await fetch(`${NJDOT_MP_SERVICE}?${q.toString()}`);
  if(!r.ok) throw new Error(`NJDOT milepost service returned HTTP ${r.status}`);
  const j=await r.json();
  if(j.error) throw new Error(j.error.message||'NJDOT milepost service query failed');
  return (j.features||[]).map(f=>({
    sri:String(f.attributes?.SRI||''),
    mp:Number(f.attributes?.MP),
    name:String(f.attributes?.SLD_NAME||''),
    subtype:f.attributes?.ROUTE_SUBT,
    e:Number(f.geometry?.x), n:Number(f.geometry?.y),
    lon:Number(f.attributes?.Longitude), lat:Number(f.attributes?.Latitude)
  })).filter(p=>Number.isFinite(p.mp)&&Number.isFinite(p.e)&&Number.isFinite(p.n));
}

function interpolateMp(points,mp){
  if(!points.length)return null;
  for(const p of points) if(Math.abs(p.mp-mp)<1e-7) return {...p,mp};
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    if((a.mp<=mp&&mp<=b.mp)||(b.mp<=mp&&mp<=a.mp)){
      const den=b.mp-a.mp;if(Math.abs(den)<1e-12)continue;
      const t=(mp-a.mp)/den;
      const lerp=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)?x+(y-x)*t:NaN;
      return {sri:a.sri,mp,name:a.name||b.name,subtype:a.subtype,e:lerp(a.e,b.e),n:lerp(a.n,b.n),lat:lerp(a.lat,b.lat),lon:lerp(a.lon,b.lon)};
    }
  }
  return null;
}

function buildClippedRoute(points,fromMP,toMP){
  points=[...points].sort((a,b)=>a.mp-b.mp);
  const a=interpolateMp(points,fromMP),b=interpolateMp(points,toMP);
  if(!a||!b)return null;
  return [a,...points.filter(p=>p.mp>fromMP&&p.mp<toMP),b];
}

async function loadRouteCorridor(routeText,fromMP,toMP,sriOverride=''){
  const lo=Math.min(fromMP,toMP),hi=Math.max(fromMP,toMP),pad=0.21;
  const routeNo=routeDigits(routeText);
  if(routeNo===null&&!sriOverride.trim())throw new Error('Enter a valid NJ route number.');
  const preferred=sriOverride.trim()||mainlineSri(routeNo);
  let pts=await arcgisMilepostQuery(`SRI='${sqlQuote(preferred)}' AND MP>=${(lo-pad).toFixed(3)} AND MP<=${(hi+pad).toFixed(3)}`);
  let sri=preferred;
  let clipped=buildClippedRoute(pts,lo,hi);
  if(!clipped&&!sriOverride.trim()){
    const prefix=String(routeNo).padStart(8,'0');
    const all=await arcgisMilepostQuery(`SRI LIKE '${prefix}%' AND MP>=${(lo-pad).toFixed(3)} AND MP<=${(hi+pad).toFixed(3)}`);
    const groups=new Map();
    all.forEach(p=>{if(!groups.has(p.sri))groups.set(p.sri,[]);groups.get(p.sri).push(p)});
    const candidates=[];
    for(const [id,g] of groups){const c=buildClippedRoute(g,lo,hi);if(c)candidates.push({id,g,c,score:(id===mainlineSri(routeNo)?100000:0)+(id.endsWith('__')?10000:0)+g.length});}
    candidates.sort((a,b)=>b.score-a.score);
    if(candidates.length){sri=candidates[0].id;pts=candidates[0].g;clipped=candidates[0].c;}
  }
  if(!clipped||clipped.length<2)throw new Error(`Could not find milepost geometry covering MP ${lo.toFixed(1)}–${hi.toFixed(1)} for ${sri}. Check the route number/range or use the SRI override.`);
  return {routeNo,sri,points:clipped,fromMP:lo,toMP:hi,name:clipped.find(p=>p.name)?.name||''};
}

function pointInRect(p,r){return p.e>=r.xmin&&p.e<=r.xmax&&p.n>=r.ymin&&p.n<=r.ymax}
function orient(ax,ay,bx,by,cx,cy){return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax)}
function onSeg(ax,ay,bx,by,cx,cy){return cx>=Math.min(ax,bx)-1e-9&&cx<=Math.max(ax,bx)+1e-9&&cy>=Math.min(ay,by)-1e-9&&cy<=Math.max(ay,by)+1e-9}
function segsIntersect(a,b,c,d){
  const o1=orient(a.e,a.n,b.e,b.n,c.e,c.n),o2=orient(a.e,a.n,b.e,b.n,d.e,d.n),o3=orient(c.e,c.n,d.e,d.n,a.e,a.n),o4=orient(c.e,c.n,d.e,d.n,b.e,b.n);
  if(((o1>0&&o2<0)||(o1<0&&o2>0))&&((o3>0&&o4<0)||(o3<0&&o4>0)))return true;
  if(Math.abs(o1)<1e-9&&onSeg(a.e,a.n,b.e,b.n,c.e,c.n))return true;
  if(Math.abs(o2)<1e-9&&onSeg(a.e,a.n,b.e,b.n,d.e,d.n))return true;
  if(Math.abs(o3)<1e-9&&onSeg(c.e,c.n,d.e,d.n,a.e,a.n))return true;
  if(Math.abs(o4)<1e-9&&onSeg(c.e,c.n,d.e,d.n,b.e,b.n))return true;
  return false;
}
function segmentIntersectsRect(a,b,r){
  if(pointInRect(a,r)||pointInRect(b,r))return true;
  const bl={e:r.xmin,n:r.ymin},br={e:r.xmax,n:r.ymin},tr={e:r.xmax,n:r.ymax},tl={e:r.xmin,n:r.ymax};
  return segsIntersect(a,b,bl,br)||segsIntersect(a,b,br,tr)||segsIntersect(a,b,tr,tl)||segsIntersect(a,b,tl,bl);
}
function pointSegDist(p,a,b){
  const dx=b.e-a.e,dy=b.n-a.n,den=dx*dx+dy*dy;
  if(den<=1e-18)return Math.hypot(p.e-a.e,p.n-a.n);
  let t=((p.e-a.e)*dx+(p.n-a.n)*dy)/den;t=Math.max(0,Math.min(1,t));
  return Math.hypot(p.e-(a.e+t*dx),p.n-(a.n+t*dy));
}
function pointRectDist(p,r){const dx=Math.max(r.xmin-p.e,0,p.e-r.xmax),dy=Math.max(r.ymin-p.n,0,p.n-r.ymax);return Math.hypot(dx,dy)}
function segmentRectDist(a,b,r){
  if(segmentIntersectsRect(a,b,r))return 0;
  const corners=[{e:r.xmin,n:r.ymin},{e:r.xmax,n:r.ymin},{e:r.xmax,n:r.ymax},{e:r.xmin,n:r.ymax}];
  return Math.min(pointRectDist(a,r),pointRectDist(b,r),...corners.map(c=>pointSegDist(c,a,b)));
}
function polylineRectDist(points,r){let best=Infinity;for(let i=0;i<points.length-1;i++){best=Math.min(best,segmentRectDist(points[i],points[i+1],r));if(best<=0)return 0;}return best}

function corridorSidTiles(points,buffer){
  const minE=Math.min(...points.map(p=>p.e))-buffer,maxE=Math.max(...points.map(p=>p.e))+buffer,minN=Math.min(...points.map(p=>p.n))-buffer,maxN=Math.max(...points.map(p=>p.n))+buffer;
  const x0=Math.floor(minE/TILE)*TILE,x1=Math.floor(maxE/TILE)*TILE,y0=Math.floor(minN/TILE)*TILE,y1=Math.floor(maxN/TILE)*TILE;
  const hits=[];
  for(let x=x0;x<=x1;x+=TILE)for(let y=y0;y<=y1;y+=TILE){
    const id=TILE_INDEX[key(x,y)];if(!id)continue;
    const r={id,xmin:x,ymin:y,xmax:x+TILE,ymax:y+TILE};
    const d=polylineRectDist(points,r);
    if(d<=buffer+1e-7){
      let nearIndex=0,near=Infinity;
      for(let i=0;i<points.length;i++){const q=pointRectDist(points[i],r);if(q<near){near=q;nearIndex=i}}
      hits.push({...r,dist:d,nearIndex});
    }
  }
  hits.sort((a,b)=>a.nearIndex-b.nearIndex||a.id.localeCompare(b.id,undefined,{numeric:true}));
  return hits;
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function routeTileRows(tiles){return tiles.map((t,i)=>`<div class="dlRow"><div class="tilePick"><input class="routeTileCheck" type="checkbox" data-id="${t.id}" checked onchange="updateSelectedCount()" aria-label="Select ${t.id}"><div><span class="small">${i+1}.</span> <span class="dlName">${t.id}</span></div></div><div class="dlActions"><a class="btn success smallBtn" href="${sidHttpUrl(t.id)}" target="_blank" rel="noopener">Download ZIP</a></div></div>`).join('')}
function downloadCorridorManifest(ids,meta){
  const rows=[['Tile','ZIP_URL','S3_URI','Route','From_MP','To_MP','Buffer_ft','SRI'],...ids.map(id=>[id,sidHttpUrl(id),sidS3Uri(id),meta.route,meta.from,meta.to,meta.buffer,meta.sri])];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  saveTextFile(`NJ_SID_Route_${meta.route}_MP_${meta.from}_${meta.to}.csv`,csv,'text/csv');
}
function drawCorridorPreview(points,tiles,buffer){
  const c=document.getElementById('corridorPreview');if(!c)return;const ctx=c.getContext('2d'),W=c.width,H=c.height,pad=28;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const minE=Math.min(...tiles.map(t=>t.xmin)),maxE=Math.max(...tiles.map(t=>t.xmax)),minN=Math.min(...tiles.map(t=>t.ymin)),maxN=Math.max(...tiles.map(t=>t.ymax));
  const sx=(W-2*pad)/(maxE-minE||1),sy=(H-2*pad)/(maxN-minN||1),sc=Math.min(sx,sy),ox=(W-(maxE-minE)*sc)/2,oy=(H-(maxN-minN)*sc)/2;
  const X=e=>ox+(e-minE)*sc,Y=n=>H-(oy+(n-minN)*sc);
  for(const t of tiles){const x=X(t.xmin),y=Y(t.ymax),w=TILE*sc,h=TILE*sc;ctx.fillStyle='#eaf3ff';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#6b91b8';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);if(w>46&&h>26){ctx.fillStyle='#174f84';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t.id,x+w/2,y+h/2)}}
  if(buffer>0){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(X(p.e),Y(p.n)):ctx.moveTo(X(p.e),Y(p.n)));ctx.strokeStyle='rgba(11,102,195,.16)';ctx.lineWidth=Math.max(2,buffer*2*sc);ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke()}
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(X(p.e),Y(p.n)):ctx.moveTo(X(p.e),Y(p.n)));ctx.strokeStyle='#0b66c3';ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  const a=points[0],b=points[points.length-1];for(const [p,label] of [[a,`MP ${a.mp.toFixed(1)}`],[b,`MP ${b.mp.toFixed(1)}`]]){ctx.beginPath();ctx.arc(X(p.e),Y(p.n),5,0,Math.PI*2);ctx.fillStyle='#d02f2f';ctx.fill();ctx.font='bold 11px system-ui';ctx.fillStyle='#18212b';ctx.textAlign='left';ctx.fillText(label,X(p.e)+7,Y(p.n)-7)}
}

function showCorridorResult(route,buffer,tiles){
  const res=document.getElementById('result'),ids=tiles.map(t=>t.id),routeLabel=route.routeNo!==null?String(route.routeNo):route.sri;
  const meta={route:routeLabel,from:route.fromMP.toFixed(1),to:route.toMP.toFixed(1),buffer:Math.round(buffer),sri:route.sri};
  res.className='';
  res.innerHTML=`<div class="corridorBox"><h3>Route ${escapeHtml(routeLabel)} corridor</h3><div class="small">MP <b>${route.fromMP.toFixed(1)}</b> – <b>${route.toMP.toFixed(1)}</b> • ${fmt(buffer,0)} ft each side • SRI <b>${escapeHtml(route.sri)}</b></div>${route.name?`<div class="small" style="margin-top:4px">NJDOT segment: ${escapeHtml(route.name)}</div>`:''}<div class="corridorStats"><div class="corridorStat"><b>${ids.length}</b><span>SID tiles</span></div><div class="corridorStat"><b>${route.points.length}</b><span>Centerline vertices</span></div></div><div class="status ok">Selected every indexed 5,000-ft SID tile that intersects the buffered milepost centerline.</div><div class="btns"><button id="downloadSelectedBtn" class="btn primary smallBtn" onclick="browserDownloadIds(selectedRouteIds())">Download selected in browser (${ids.length})</button><button class="btn secondary smallBtn" onclick="setAllRouteChecks(true)">Select all</button><button class="btn secondary smallBtn" onclick="setAllRouteChecks(false)">Clear</button><button class="btn secondary smallBtn" onclick='downloadCorridorManifest(${JSON.stringify(ids)},${JSON.stringify(meta)})'>Export CSV manifest</button><button class="btn secondary smallBtn" onclick="copyTextValue(selectedRouteIds().join(', '))">Copy selected tile IDs</button><button class="btn secondary smallBtn" onclick="copySelectedUrls()">Copy selected URLs</button></div><div id="browserDlStatus" class="browserDlStatus">Browser-only mode: no scripts or command-line tools. Multiple downloads may require one browser permission prompt.</div><canvas id="corridorPreview" class="corridorCanvas" width="900" height="520" aria-label="Route corridor and selected SID tiles"></canvas><div class="small">Blue line = NJDOT milepost centerline. Light blue = selected SID tiles. The translucent band represents the chosen corridor buffer.</div><div class="tileList">${routeTileRows(tiles)}</div><div class="small" style="margin-top:8px">Direct downloads are NJOGIS 2020 MG3 ZIP packages. Extract each ZIP with normal Windows File Explorer to obtain the MrSID file and related contents.</div></div>`;
  drawCorridorPreview(route.points,tiles,buffer);
  updateSelectedCount();
}
