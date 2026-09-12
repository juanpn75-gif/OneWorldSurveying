const TILE_INDEX=window.TILE_INDEX||{};
const TILE=5000;

function key(x,y){return `${Math.round(x)},${Math.round(y)}`}
function tileAt(e,n){
  const x=Math.floor((e+1e-7)/TILE)*TILE, y=Math.floor((n+1e-7)/TILE)*TILE;
  const id=TILE_INDEX[key(x,y)];
  return id?{id,xmin:x,ymin:y,xmax:x+TILE,ymax:y+TILE}:null;
}

// EPSG:3424 forward Transverse Mercator: NAD83 / New Jersey (ftUS)
function latLonToNJSP(latDeg, lonDeg){
  const a=6378137.0, invF=298.257222101, f=1/invF, e2=f*(2-f), ep2=e2/(1-e2);
  const k0=0.9999, lat0=38.8333333333333*Math.PI/180, lon0=-74.5*Math.PI/180;
  const phi=latDeg*Math.PI/180, lam=lonDeg*Math.PI/180;
  const s=Math.sin(phi), c=Math.cos(phi), t=Math.tan(phi);
  const N=a/Math.sqrt(1-e2*s*s), T=t*t, C=ep2*c*c, A=(lam-lon0)*c;
  const e4=e2*e2, e6=e4*e2;
  const meridian=p=>a*((1-e2/4-3*e4/64-5*e6/256)*p-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*p)+(15*e4/256+45*e6/1024)*Math.sin(4*p)-(35*e6/3072)*Math.sin(6*p));
  const xM=150000+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120);
  const yM=k0*((meridian(phi)-meridian(lat0))+N*t*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
  const mToFtUS=3937/1200;
  return {e:xM*mToFtUS,n:yM*mToFtUS};
}

function njspToLatLon(eFt,nFt){
  const a=6378137.0, invF=298.257222101, f=1/invF, e2=f*(2-f), ep2=e2/(1-e2);
  const k0=0.9999, lat0=38.8333333333333*Math.PI/180, lon0=-74.5*Math.PI/180;
  const ftToM=1200/3937, x=eFt*ftToM-150000, y=nFt*ftToM;
  const e4=e2*e2, e6=e4*e2;
  const meridian=p=>a*((1-e2/4-3*e4/64-5*e6/256)*p-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*p)+(15*e4/256+45*e6/1024)*Math.sin(4*p)-(35*e6/3072)*Math.sin(6*p));
  const M0=meridian(lat0), M=M0+y/k0;
  const mu=M/(a*(1-e2/4-3*e4/64-5*e6/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const J1=3*e1/2-27*e1**3/32, J2=21*e1**2/16-55*e1**4/32, J3=151*e1**3/96, J4=1097*e1**4/512;
  const fp=mu+J1*Math.sin(2*mu)+J2*Math.sin(4*mu)+J3*Math.sin(6*mu)+J4*Math.sin(8*mu);
  const s=Math.sin(fp), c=Math.cos(fp), t=Math.tan(fp), C1=ep2*c*c, T1=t*t;
  const N1=a/Math.sqrt(1-e2*s*s), R1=a*(1-e2)/(1-e2*s*s)**1.5, D=x/(N1*k0);
  const lat=fp-(N1*t/R1)*(D**2/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/c;
  return {lat:lat*180/Math.PI,lon:lon*180/Math.PI};
}

let sidMapState=null;

function wmWorldPx(lat,lon,z){
  const scale=256*Math.pow(2,z);
  const clamped=Math.max(-85.05112878,Math.min(85.05112878,lat));
  const sin=Math.sin(clamped*Math.PI/180);
  return {
    x:(lon+180)/360*scale,
    y:(0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale
  };
}
function wmLatLonFromWorld(x,y,z){
  const scale=256*Math.pow(2,z);
  const lon=x/scale*360-180;
  const n=Math.PI-2*Math.PI*y/scale;
  const lat=180/Math.PI*Math.atan(Math.sinh(n));
  return {lat,lon};
}
function mapTileUrl(base,z,x,y){
  const max=Math.pow(2,z);
  x=((x%max)+max)%max;
  if(y<0||y>=max)return '';
  if(base==='aerial') return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
}
function mapSvg(tag,attrs={}){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
  return el;
}
function tilePolygonLatLon(x,y){
  // Use all four State Plane corners. This is more accurate than drawing a lat/lon rectangle.
  return [
    njspToLatLon(x,y),
    njspToLatLon(x+TILE,y),
    njspToLatLon(x+TILE,y+TILE),
    njspToLatLon(x,y+TILE)
  ];
}
function renderNativeMapContents(){
  const st=sidMapState;if(!st)return;
  const mapEl=st.el, w=mapEl.clientWidth, h=mapEl.clientHeight;
  if(w<40||h<40)return;
  const tilePane=mapEl.querySelector('.map-tiles'), svg=mapEl.querySelector('.map-overlay');
  tilePane.innerHTML=''; while(svg.firstChild)svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const cp=wmWorldPx(st.center.lat,st.center.lon,st.zoom);
  const left=cp.x-w/2, top=cp.y-h/2;
  const minTX=Math.floor(left/256)-1,maxTX=Math.floor((left+w)/256)+1;
  const minTY=Math.floor(top/256)-1,maxTY=Math.floor((top+h)/256)+1;
  for(let ty=minTY;ty<=maxTY;ty++)for(let tx=minTX;tx<=maxTX;tx++){
    const url=mapTileUrl(st.base,st.zoom,tx,ty); if(!url)continue;
    const img=document.createElement('img'); img.alt=''; img.draggable=false; img.referrerPolicy='no-referrer';
    img.src=url; img.style.left=(tx*256-left)+'px'; img.style.top=(ty*256-top)+'px';
    img.onerror=()=>{img.style.visibility='hidden'}; tilePane.appendChild(img);
  }
  function screenPt(ll){const p=wmWorldPx(ll.lat,ll.lon,st.zoom);return {x:p.x-left,y:p.y-top}}
  // 3x3 indexed neighborhood
  for(let row=-1;row<=1;row++)for(let col=-1;col<=1;col++){
    const x=st.tile.xmin+col*TILE,y=st.tile.ymin+row*TILE,id=TILE_INDEX[key(x,y)];if(!id)continue;
    const pts=tilePolygonLatLon(x,y).map(screenPt);
    const points=pts.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const primary=col===0&&row===0;
    const poly=mapSvg('polygon',{points,fill:primary?'rgba(11,102,195,.11)':'rgba(255,255,255,.025)',stroke:primary?'#0b66c3':'#6f7d8a','stroke-width':primary?4:1.5,'vector-effect':'non-scaling-stroke'});
    svg.appendChild(poly);
    const cx=pts.reduce((a,p)=>a+p.x,0)/4,cy=pts.reduce((a,p)=>a+p.y,0)/4;
    const boxW=Math.max(44,id.length*7+10);
    svg.appendChild(mapSvg('rect',{x:cx-boxW/2,y:cy-10,width:boxW,height:20,rx:4,fill:'rgba(255,255,255,.9)',stroke:'#7f8c99','stroke-width':1}));
    const text=mapSvg('text',{x:cx,y:cy+4,'text-anchor':'middle','font-size':12,'font-weight':800,fill:'#263645'});text.textContent=id;svg.appendChild(text);
  }
  const loc=screenPt({lat:st.lat,lon:st.lon});
  svg.appendChild(mapSvg('circle',{cx:loc.x,cy:loc.y,r:8,fill:'#d02f2f',stroke:'#fff','stroke-width':3}));
}
function fitPrimaryTileOnMap(){
  const st=sidMapState;if(!st)return;
  const corners=tilePolygonLatLon(st.tile.xmin,st.tile.ymin);
  const center={lat:(corners[0].lat+corners[2].lat)/2,lon:(corners[0].lon+corners[2].lon)/2};
  st.center=center;
  const w=Math.max(250,st.el.clientWidth-70),h=Math.max(220,st.el.clientHeight-70);
  let best=12;
  for(let z=12;z<=19;z++){
    const p=corners.map(c=>wmWorldPx(c.lat,c.lon,z));
    const ww=Math.max(...p.map(q=>q.x))-Math.min(...p.map(q=>q.x));
    const hh=Math.max(...p.map(q=>q.y))-Math.min(...p.map(q=>q.y));
    if(ww<=w&&hh<=h)best=z;else break;
  }
  st.zoom=best;renderNativeMapContents();
}
function renderBackgroundMap(tile,e,n,lat,lon){
  const mapEl=document.getElementById('map');if(!mapEl)return;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)){const p=njspToLatLon(e,n);lat=p.lat;lon=p.lon;}
  mapEl.innerHTML=`<div class="map-tiles"></div><svg class="map-overlay" preserveAspectRatio="none"></svg>
    <div class="map-controls"><button type="button" data-map="zin" title="Zoom in">+</button><button type="button" data-map="zout" title="Zoom out">−</button><select data-map="base" title="Background map"><option value="street">Street</option><option value="aerial">Aerial</option></select><button type="button" data-map="fit" title="Fit SID tile">⌂</button></div>
    <div class="map-hint">Drag to pan • mouse wheel to zoom</div><div class="map-attrib"></div>`;
  sidMapState={el:mapEl,tile,e,n,lat,lon,center:{lat,lon},zoom:15,base:'street',drag:null};
  const attrib=()=>{const a=mapEl.querySelector('.map-attrib');a.innerHTML=sidMapState.base==='aerial'?'Tiles: Esri World Imagery':'Tiles: Esri World Street Map';};
  attrib();
  mapEl.querySelector('[data-map="zin"]').onclick=()=>{sidMapState.zoom=Math.min(19,sidMapState.zoom+1);renderNativeMapContents()};
  mapEl.querySelector('[data-map="zout"]').onclick=()=>{sidMapState.zoom=Math.max(12,sidMapState.zoom-1);renderNativeMapContents()};
  mapEl.querySelector('[data-map="fit"]').onclick=fitPrimaryTileOnMap;
  mapEl.querySelector('[data-map="base"]').onchange=e2=>{sidMapState.base=e2.target.value;attrib();renderNativeMapContents()};
  mapEl.addEventListener('wheel',ev=>{ev.preventDefault();sidMapState.zoom=Math.max(12,Math.min(19,sidMapState.zoom+(ev.deltaY<0?1:-1)));renderNativeMapContents()},{passive:false});
  mapEl.addEventListener('pointerdown',ev=>{if(ev.target.closest('.map-controls'))return;mapEl.setPointerCapture(ev.pointerId);const cp=wmWorldPx(sidMapState.center.lat,sidMapState.center.lon,sidMapState.zoom);sidMapState.drag={x:ev.clientX,y:ev.clientY,cx:cp.x,cy:cp.y};mapEl.querySelector('.map-hint').style.display='none'});
  mapEl.addEventListener('pointermove',ev=>{if(!sidMapState?.drag)return;const d=sidMapState.drag;const p=wmLatLonFromWorld(d.cx-(ev.clientX-d.x),d.cy-(ev.clientY-d.y),sidMapState.zoom);sidMapState.center=p;renderNativeMapContents()});
  const endDrag=()=>{if(sidMapState)sidMapState.drag=null};mapEl.addEventListener('pointerup',endDrag);mapEl.addEventListener('pointercancel',endDrag);
  fitPrimaryTileOnMap();
  // Keep exact searched location in view if it lies on an edge of the fit.
  setTimeout(renderNativeMapContents,60);
}

function dmsToDecimal(dir,d,m,s){
  let v=Number(d)+Number(m)/60+Number(s)/3600;
  if(/[SW]/i.test(dir))v=-v;
  return v;
}
function parseCoordText(s){
  s=s.trim().replace(/°/g,' ').replace(/[′']/g,' ').replace(/[″"]/g,' ');
  // DMS with N/S and E/W, either leading or trailing direction
  const p1=/([NS])\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)[,;\s]+([EW])\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i.exec(s);
  if(p1) return {lat:dmsToDecimal(p1[1],p1[2],p1[3],p1[4]),lon:dmsToDecimal(p1[5],p1[6],p1[7],p1[8])};
  const p2=/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\s*([NS])[,;\s]+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\s*([EW])/i.exec(s);
  if(p2) return {lat:dmsToDecimal(p2[4],p2[1],p2[2],p2[3]),lon:dmsToDecimal(p2[8],p2[5],p2[6],p2[7])};
  // Decimal latitude, longitude
  const nums=s.match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length>=2){let lat=Number(nums[0]),lon=Number(nums[1]); if(/[W]/i.test(s)&&lon>0)lon=-lon; if(/[S]/i.test(s)&&lat>0)lat=-lat; return {lat,lon};}
  return null;
}

function fmt(x,d=2){return Number(x).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d})}
function setMsg(text,type=''){document.getElementById('msg').innerHTML=text?`<div class="status ${type}">${text}</div>`:''}

// NJOGIS 2020 MrSID (MG3) public AWS S3 source.
const SID_BUCKET='njogis-imagery';
const SID_PREFIX='2020/MG3';
function sidFilename(id){return `${id}.zip`}
function sidS3Uri(id){return `s3://${SID_BUCKET}/${SID_PREFIX}/${sidFilename(id)}`}
function sidHttpUrl(id){return `https://${SID_BUCKET}.s3.amazonaws.com/${SID_PREFIX}/${encodeURIComponent(sidFilename(id))}`}
function sidListUrl(id){return `https://${SID_BUCKET}.s3.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(SID_PREFIX+'/'+id)}`}
async function copyTextValue(text){
  try{await navigator.clipboard.writeText(text);setMsg('Copied to clipboard.','ok')}
  catch(e){prompt('Copy this text:',text)}
}
function saveTextFile(name,text,mime='text/plain'){
  const blob=new Blob([text],{type:mime}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}
function setBrowserDlStatus(text,type=''){
  const el=document.getElementById('browserDlStatus');
  if(el){el.className='browserDlStatus'+(type?' '+type:'');el.textContent=text;}
  else setMsg(text,type);
}
function browserDownloadIds(ids){
  ids=[...new Set((ids||[]).filter(Boolean))];
  if(!ids.length){setBrowserDlStatus('No SID tiles are selected.','warn');return;}
  setBrowserDlStatus(`Starting ${ids.length} browser download${ids.length===1?'':'s'}… If Edge/Chrome asks, choose “Allow” for multiple downloads.`);
  let completed=0;
  ids.forEach((id,i)=>{
    setTimeout(()=>{
      const frame=document.createElement('iframe');
      frame.style.display='none';
      frame.setAttribute('aria-hidden','true');
      frame.src=sidHttpUrl(id);
      document.body.appendChild(frame);
      setTimeout(()=>frame.remove(),30000);
      completed++;
      setBrowserDlStatus(`Requested ${completed} of ${ids.length}: ${id}.zip${completed===ids.length?' — browser queue complete.':''}`,completed===ids.length?'ok':'');
    },i*1100);
  });
}
function selectedRouteIds(){
  return [...document.querySelectorAll('.routeTileCheck:checked')].map(x=>x.dataset.id).filter(Boolean);
}
function updateSelectedCount(){
  const n=selectedRouteIds().length, b=document.getElementById('downloadSelectedBtn');
  if(b)b.textContent=`Download selected in browser (${n})`;
}
function setAllRouteChecks(checked){
  document.querySelectorAll('.routeTileCheck').forEach(x=>x.checked=checked);
  updateSelectedCount();
}
function copySelectedUrls(){
  const ids=selectedRouteIds();
  if(!ids.length){setBrowserDlStatus('No SID tiles are selected.','warn');return;}
  copyTextValue(ids.map(sidHttpUrl).join('\n'));
}
function downloadPanel(tile,near){
  const ids=[tile.id,...near.map(x=>x.id)].filter(Boolean), unique=[...new Set(ids)];
  const row=(id,label)=>`<div class="dlRow"><div><span class="dlName">${id}</span> <span class="small">${label}</span></div><div class="dlActions"><a class="btn success smallBtn" href="${sidHttpUrl(id)}" target="_blank" rel="noopener">Download Tile ZIP</a><a class="btn secondary smallBtn" href="${sidListUrl(id)}" target="_blank" rel="noopener">Check S3 name</a></div></div>`;
  const rows=[row(tile.id,'primary tile'),...near.map(x=>row(x.id,`${x.dir} adjacent`))].join('');
  return `<div class="downloadBox"><h3>2020 MrSID (MG3) download</h3><div class="small">Browser-only download from the public NJOGIS imagery bucket. Each tile is stored as <b>${sidFilename(tile.id)}</b>. No PowerShell, BAT file, AWS CLI, or software installation is required.</div>${rows}<div class="btns" style="margin-top:10px"><button class="btn primary smallBtn" onclick='browserDownloadIds(${JSON.stringify(unique)})'>Download all shown (${unique.length})</button><button class="btn secondary smallBtn" onclick="copyTextValue('${unique.map(id=>sidHttpUrl(id)).join('\\n')}')">Copy download URLs</button></div><div class="small" style="margin-top:7px">If Edge/Chrome asks whether this file may download multiple files, choose <b>Allow</b>. You can always use the individual Download Tile ZIP buttons.</div></div>`;
}
// ---- Route Corridor SID Finder -------------------------------------------------
// Public NJDOT ArcGIS feature layer exposed through the NJDOT ArcGIS Hub.
const NJDOT_MP_SERVICE='https://services.arcgis.com/HggmsDF7UJsNN1FK/arcgis/rest/services/New_Jersey_Standard_Route_Id_And_Milepost/FeatureServer/0/query';
