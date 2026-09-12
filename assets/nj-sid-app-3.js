function nearEdges(tile,e,n,tol){
  const d={west:e-tile.xmin,east:tile.xmax-e,south:n-tile.ymin,north:tile.ymax-n};
  const hits=[];
  if(d.west<=tol) hits.push({dir:'W',x:tile.xmin-TILE,y:tile.ymin,dist:d.west});
  if(d.east<=tol) hits.push({dir:'E',x:tile.xmax,y:tile.ymin,dist:d.east});
  if(d.south<=tol) hits.push({dir:'S',x:tile.xmin,y:tile.ymin-TILE,dist:d.south});
  if(d.north<=tol) hits.push({dir:'N',x:tile.xmin,y:tile.ymax,dist:d.north});
  if(d.west<=tol&&d.south<=tol)hits.push({dir:'SW',x:tile.xmin-TILE,y:tile.ymin-TILE,dist:Math.hypot(d.west,d.south)});
  if(d.west<=tol&&d.north<=tol)hits.push({dir:'NW',x:tile.xmin-TILE,y:tile.ymax,dist:Math.hypot(d.west,d.north)});
  if(d.east<=tol&&d.south<=tol)hits.push({dir:'SE',x:tile.xmax,y:tile.ymin-TILE,dist:Math.hypot(d.east,d.south)});
  if(d.east<=tol&&d.north<=tol)hits.push({dir:'NE',x:tile.xmax,y:tile.ymax,dist:Math.hypot(d.east,d.north)});
  return hits.map(h=>({...h,id:TILE_INDEX[key(h.x,h.y)]})).filter(h=>h.id);
}

function drawPreview(tile,e,n){
  const c=document.getElementById('preview'),ctx=c.getContext('2d'); const W=c.width,H=c.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#fbfcfd';ctx.fillRect(0,0,W,H);
  const cell=W/3; ctx.font='bold 14px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const dx=col-1,dy=1-row; const x=tile.xmin+dx*TILE,y=tile.ymin+dy*TILE; const id=TILE_INDEX[key(x,y)];
    ctx.fillStyle=(dx===0&&dy===0)?'#eaf3ff':'#fff';ctx.fillRect(col*cell,row*cell,cell,cell);
    ctx.strokeStyle='#aeb9c4';ctx.strokeRect(col*cell,row*cell,cell,cell);
    if(id){ctx.fillStyle=(dx===0&&dy===0)?'#094d92':'#40505e';ctx.fillText(id,col*cell+cell/2,row*cell+cell/2)}
  }
  const px=cell+(e-tile.xmin)/TILE*cell, py=2*cell-(n-tile.ymin)/TILE*cell;
  ctx.beginPath();ctx.arc(px,py,6,0,Math.PI*2);ctx.fillStyle='#d02f2f';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
}

function showResult(e,n,meta={}){
  const tile=tileAt(e,n), res=document.getElementById('result');
  if(!tile){res.className='';res.innerHTML='<div class="status err">This point is outside the SID tile index contained in Index.dxf.</div>';return;}
  const tol=Math.max(0,Number(document.getElementById('edgeTol').value)||0), near=nearEdges(tile,e,n,tol);
  const src=meta.source?`<div class="k">Source</div><div>${meta.source}</div>`:'';
  const latlon=(Number.isFinite(meta.lat)&&Number.isFinite(meta.lon))?`<div class="k">Lat / Long</div><div>${meta.lat.toFixed(8)}, ${meta.lon.toFixed(8)}</div>`:'';
  const edgeText=near.length?`<div class="status warn"><b>Near tile edge:</b> also consider ${near.map(x=>`${x.id} (${x.dir}, ${fmt(x.dist,0)} ft)`).join(', ')}.</div>`:`<div class="status ok">Point is more than ${fmt(tol,0)} ft from the indexed tile edges.</div>`;
  res.className='';res.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div class="tileBadge">${tile.id}</div><button class="copy" onclick="navigator.clipboard&&navigator.clipboard.writeText('${tile.id}')">Copy tile</button></div>
    ${edgeText}
    <div class="kvs">${src}${latlon}
      <div class="k">Easting</div><div>${fmt(e)} ftUS</div>
      <div class="k">Northing</div><div>${fmt(n)} ftUS</div>
      <div class="k">Tile E range</div><div>${fmt(tile.xmin,0)} – ${fmt(tile.xmax,0)} ftUS</div>
      <div class="k">Tile N range</div><div>${fmt(tile.ymin,0)} – ${fmt(tile.ymax,0)} ftUS</div>
    </div>
    ${downloadPanel(tile,near)}
    <canvas id="preview" width="540" height="540" aria-label="3 by 3 SID tile neighborhood"></canvas>
    <div class="small">Red dot = location. Center square = primary tile.</div>
    <div class="mapTitle">Background map — Street / Aerial</div>
    <div id="map" aria-label="Street map showing location and SID tile footprint"></div>
    <div class="small">Choose Street or Aerial. Background tiles require internet; SID tile boundaries and the red location point are calculated directly from the embedded index.</div>`;
  drawPreview(tile,e,n);
  renderBackgroundMap(tile,e,n,meta.lat,meta.lon);
}

async function geocodeAddress(address){
  // U.S. Census Geocoder first
  const census=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try{
    const r=await fetch(census); if(r.ok){const j=await r.json();const m=j?.result?.addressMatches?.[0];if(m?.coordinates)return {lat:Number(m.coordinates.y),lon:Number(m.coordinates.x),label:m.matchedAddress||address,provider:'U.S. Census Geocoder'};}
  }catch(e){}
  // Fallback: OpenStreetMap Nominatim
  const nom=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`;
  const r2=await fetch(nom,{headers:{'Accept':'application/json'}}); if(!r2.ok)throw new Error('Address lookup failed'); const j2=await r2.json();
  if(!j2.length)throw new Error('Address not found'); return {lat:Number(j2[0].lat),lon:Number(j2[0].lon),label:j2[0].display_name||address,provider:'OpenStreetMap/Nominatim'};
}

document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.pane').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.pane).classList.add('active');setMsg('')}));

document.getElementById('coordBtn').onclick=()=>{const p=parseCoordText(document.getElementById('coordText').value);if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)){setMsg('Could not read the coordinate. Try DMS such as N 40 26 23.78, W 74 23 11.81 or decimal degrees.', 'err');return;} const sp=latLonToNJSP(p.lat,p.lon);setMsg('Coordinate converted to NJ State Plane.','ok');showResult(sp.e,sp.n,{lat:p.lat,lon:p.lon,source:'Entered coordinate'});};
document.getElementById('testBtn').onclick=()=>{document.getElementById('coordText').value='N 40 26 23.78, W 74 23 11.81';document.getElementById('coordBtn').click()};
document.getElementById('spBtn').onclick=()=>{const e=Number(document.getElementById('easting').value.replace(/,/g,'')),n=Number(document.getElementById('northing').value.replace(/,/g,''));if(!Number.isFinite(e)||!Number.isFinite(n)){setMsg('Enter valid Easting and Northing values.','err');return;}setMsg('State Plane coordinate located in the SID index.','ok');showResult(e,n,{source:'Entered NJ State Plane'});};
document.getElementById('geocodeBtn').onclick=async()=>{const btn=document.getElementById('geocodeBtn'),address=document.getElementById('addr').value.trim();if(!address){setMsg('Enter an address.','err');return;}btn.disabled=true;btn.textContent='Looking up…';setMsg('Looking up address…');try{const g=await geocodeAddress(address);const sp=latLonToNJSP(g.lat,g.lon);setMsg(`Matched by ${g.provider}: ${g.label}`,'ok');showResult(sp.e,sp.n,{lat:g.lat,lon:g.lon,source:g.provider});}catch(e){setMsg('Address lookup could not be completed. Check your internet connection, or use the Lat / Long or NJ State Plane tab.','err');}finally{btn.disabled=false;btn.textContent='Find SID tile';}};
document.getElementById('routeBtn').onclick=async()=>{
  const btn=document.getElementById('routeBtn'),routeText=document.getElementById('routeNumber').value.trim(),from=Number(document.getElementById('routeFromMP').value),to=Number(document.getElementById('routeToMP').value),buffer=Math.max(0,Number(document.getElementById('routeBuffer').value)||0),sri=document.getElementById('routeSri').value.trim();
  if(!Number.isFinite(from)||!Number.isFinite(to)){setMsg('Enter valid From and To mileposts.','err');return}
  btn.disabled=true;btn.textContent='Finding corridor…';setMsg('Requesting NJDOT milepost centerline…');
  try{const route=await loadRouteCorridor(routeText,from,to,sri);const tiles=corridorSidTiles(route.points,buffer);if(!tiles.length)throw new Error('No SID tiles intersected the selected corridor.');setMsg(`Found ${tiles.length} SID tile${tiles.length===1?'':'s'} for Route ${route.routeNo??route.sri}, MP ${route.fromMP.toFixed(1)}–${route.toMP.toFixed(1)}.`,'ok');showCorridorResult(route,buffer,tiles)}catch(err){setMsg(err.message||'Route corridor lookup failed.','err');document.getElementById('result').className='resultEmpty';document.getElementById('result').textContent='Route corridor lookup did not return a usable result.'}finally{btn.disabled=false;btn.textContent='Find corridor SID tiles'}
};
document.getElementById('routeNumber').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('routeBtn').click()});
document.getElementById('routeFromMP').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('routeBtn').click()});
document.getElementById('routeToMP').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('routeBtn').click()});
document.getElementById('addr').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('geocodeBtn').click()});
