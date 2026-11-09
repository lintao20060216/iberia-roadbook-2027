const radians=Math.PI/180;
const palette=['#aa5d3f','#4a7770','#7d6896','#b6833d','#557b9c','#8a634b','#54774c'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const minutesFromClock=t=>{const [h,m]=String(t||'').split(':').map(Number);return Number.isFinite(m)&&h>=0&&h<24&&m>=0&&m<60?h*60+m:null};
function distance(a,b){
  const [x,y]=a.coords.map(v=>v*radians),[u,v]=b.coords.map(n=>n*radians);
  const chord=Math.sin((v-y)/2)**2+Math.cos(y)*Math.cos(v)*Math.sin((u-x)/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1,chord)));
}
function estimates(a,b){
  const km=distance(a,b);
  return {mins:Math.round(km*(a.city===b.city?12:1.18)+(km>3?7:0)),km:Math.round(km*1.27),mode:a.city===b.city?(km<=4?'步行估算':'市内交通待确认'):'自驾估算'};
}
const fixedStart=(date,item,locks)=>locks[item.id]?.date===date?minutesFromClock(locks[item.id].time):null;
const localOffset=p=>p.country==='葡萄牙'||p.id==='lisbon'||p.id==='evora'?-60:0;
function evaluate(buckets,end,locks,metric,limit){
  let prev=anchors.start;
  const days=buckets.map((items,i)=>{
    const date=travelDays[i], legs=[], activities=[], origin=prev;
    const start=9*60;
    let clock=start,drive=0,clash=false,totalKm=0;
    function transit(item){
      if(prev.id===item.id)return;
      const trip=metric(prev,item);
      if(prev.city!==item.city)drive+=trip.mins;
      legs.push({...trip,from:prev.id,to:item.id,coords:[prev.coords,item.coords]});
      totalKm+=trip.km; clock+=trip.mins+localOffset(item)-localOffset(prev); prev=item;
    }
    for(const item of items){
      transit(item);
      const fixed=fixedStart(date,item,locks);
      if(fixed!==null){if(clock>fixed)clash=true;clock=Math.max(clock,fixed);}
      activities.push({id:item.id,start:clock,locked:locks[item.id]?.date===date});
      clock+=item.minutes+25;
    }
    if(i>=13)transit(end);
    const close=i===14?16*60:i===9?17*60:Math.max(20*60,...items.map(item=>{
      const fixed=fixedStart(date,item,locks);
      return fixed===null?0:Math.min(24*60,fixed+item.minutes+25);
    }));
    return {date,origin:origin.id,destination:prev.id,activities,legs,drive,totalKm,clash,late:Math.max(0,clock-close),over:Math.max(0,drive-limit),color:palette[i%palette.length]};
  });
  const penalty=days.reduce((n,d)=>n+(d.clash?10000:0)+(d.over+d.late)*90,0);
  return {days,penalty,cost:penalty+days.reduce((n,d)=>n+d.drive+d.legs.reduce((s,l)=>s+l.mins,0)*.2+d.activities.length**2*24,0)};
}
const waypoints=[
  {id:'bcn-stop',name:'巴塞罗那',city:'巴塞罗那',coords:anchors.start.coords,minutes:25},
  {id:'zaragoza',name:'萨拉戈萨',city:'萨拉戈萨',coords:[-0.8891,41.6488],minutes:30},
  {id:'madrid-stop',name:'马德里',city:'马德里',coords:[-3.7038,40.4168],minutes:30},
  {id:'caceres',name:'卡塞雷斯',city:'卡塞雷斯',coords:[-6.3722,39.4753],minutes:30},
  {id:'badajoz',name:'巴达霍斯',city:'巴达霍斯',coords:[-6.9707,38.8794],minutes:30},
  {id:'trujillo',name:'特鲁希略',city:'特鲁希略',coords:[-5.882,39.461],minutes:30},
  {id:'lleida',name:'莱里达',city:'莱里达',coords:[.626,41.617],minutes:30},
  {id:'calatayud',name:'卡拉塔尤德',city:'卡拉塔尤德',coords:[-1.644,41.354],minutes:30},
  {id:'talavera',name:'塔拉韦拉',city:'塔拉韦拉',coords:[-4.830,39.963],minutes:30},
  {id:'guadalajara',name:'瓜达拉哈拉',city:'瓜达拉哈拉',coords:[-3.167,40.633],minutes:30},
  {id:'navalmoral',name:'纳瓦尔莫拉尔',city:'纳瓦尔莫拉尔',coords:[-5.545,39.889],minutes:30},
  {id:'evora',name:'埃武拉',city:'埃武拉',coords:[-7.907,38.571],minutes:30}
];
function stageDrive(buckets,end,locks,metric,limit){
  let draft=evaluate(buckets,end,locks,metric,limit);
  for(let i=0;i<waypoints.length&&draft.days.some(d=>d.over>0);i++){
    let best=null;
    for(const stop of waypoints){
      if(stop.city===end.city||buckets.some(day=>day.includes(stop)))continue;
      for(let d=1;d<14;d++){
        if(d===9||buckets[d].length)continue;
        const prev=buckets.findLastIndex((day,index)=>index<d&&day.length);
        const next=buckets.findIndex((day,index)=>index>d&&day.length);
        const spacing=Math.min(d-Math.max(prev,0),(next<0?14:next)-d);
        buckets[d].push(stop);
        const result=evaluate(buckets,end,locks,metric,limit);
        if(result.penalty<draft.penalty&&(!best||result.cost<best.result.cost||result.cost===best.result.cost&&(spacing>best.spacing||spacing===best.spacing&&d>best.d)))best={d,stop,result,spacing};
        buckets[d].pop();
      }
    }
    if(!best)break;
    buckets[best.d].push(best.stop);draft=best.result;
  }
}
function optimize(end,selected,locks,metric,limit,allowApprox){
  let buckets=travelDays.map(()=>[]);
  const excluded=[];
  const grouped=new Set();
  const priority={booked:0,must:1,want:2};
  const sorted=[...selected].sort((a,b)=>Number(Boolean(locks[b.id]?.date))-Number(Boolean(locks[a.id]?.date))||priority[a.status]-priority[b.status]);
  for(const p of sorted){
    const lock=locks[p.id]?.date;
    const why=p.approx&&!allowApprox?'待确认具体集合点':p.kind==='event'&&(!lock||fixedStart(lock,p,locks)===null)?'待确认活动日期与开场时间':p.status==='booked'&&!lock?'请填写预订日期':null;
    if(why){excluded.push({id:p.id,why});continue;}
    if(p.group&&grouped.has(p.group)&&!lock){excluded.push({id:p.id,why:'已选用同一体验的另一地点'});continue;}
    if(lock&&travelDays.includes(lock)){
      const bucket=buckets[travelDays.indexOf(lock)];
      bucket.push(p); bucket.sort((a,b)=>(fixedStart(lock,a,locks)??Infinity)-(fixedStart(lock,b,locks)??Infinity));
      if(p.group)grouped.add(p.group);
    }
  }
  stageDrive(buckets,end,locks,metric,limit);
  for(const p of sorted){
    if(locks[p.id]?.date||excluded.some(e=>e.id===p.id))continue;
    if(p.group&&grouped.has(p.group)){excluded.push({id:p.id,why:'已选用同一体验的另一地点'});continue;}
    let best=null;
    const alternatives=[];
    const now=evaluate(buckets,end,locks,metric,limit);
    for(let d=0;d<buckets.length;d++){
      if(d===9||d===14&&p.city!==end.city)continue;
      for(let slot=0;slot<=buckets[d].length;slot++){
        buckets[d].splice(slot,0,p);
        const result=evaluate(buckets,end,locks,metric,limit);
        const score=result.cost+(d===0&&p.city!=='巴塞罗那'?160:0)+(d===14&&p.city!==end.city?180:0);
        if(result.penalty<=now.penalty&&(!best||score<best.score))best={d,slot,score};
        else if(!result.days[d].clash&&result.days[d].late===0)alternatives.push({d,slot,score});
        buckets[d].splice(slot,1);
      }
    }
    if(best){
      buckets[best.d].splice(best.slot,0,p);
      if(p.group)grouped.add(p.group);
      continue;
    }
    // A diversion can be feasible after adding an overnight stop between two existing days.
    for(const alt of alternatives.sort((a,b)=>a.score-b.score).slice(0,4)){
      const revised=buckets.map(day=>[...day]);
      revised[alt.d].splice(alt.slot,0,p);
      stageDrive(revised,end,locks,metric,limit);
      const result=evaluate(revised,end,locks,metric,limit);
      if(result.penalty<=now.penalty&&(!best||result.cost<best.score))best={revised,score:result.cost};
    }
    if(best){buckets=best.revised;if(p.group)grouped.add(p.group);}
    else excluded.push({id:p.id,why:'与驾驶上限或已锁定时段冲突'});
  }
  // Remove stopovers that became unnecessary once the activities were inserted.
  for(const bucket of buckets){
    const index=bucket.findIndex(p=>waypoints.includes(p));
    if(index<0)continue;
    const before=evaluate(buckets,end,locks,metric,limit);
    const [stop]=bucket.splice(index,1);
    const after=evaluate(buckets,end,locks,metric,limit);
    if(after.cost>before.cost||after.penalty>before.penalty)bucket.splice(index,0,stop);
  }
  const draft=evaluate(buckets,end,locks,metric,limit);
  return {end:end.id,days:draft.days,excluded,extras:waypoints.filter(b=>buckets.some(day=>day.includes(b)))};
}
function providerRequest(profile,endpoint,coords,token,query,origin){
  const points=coords.map(p=>p.join(',')).join(';');
  const url=token?new URL('https://api.mapbox.com/'+(endpoint==='table'?'directions-matrix/v1/':'directions/v5/')+'mapbox/'+profile+'/'+points):new URL('https://routing.openstreetmap.de/routed-'+(profile==='walking'?'foot':'car')+'/'+endpoint+'/v1/'+(profile==='walking'?'foot':'driving')+'/'+points);
  for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
  if(token)url.searchParams.set('access_token',token);
  return fetch(url,{headers:{'User-Agent':'Iberia Roadbook private trip planner','Referer':origin+'/'},signal:AbortSignal.timeout(6500)}).then(async r=>{if(!r.ok)throw Error('routing '+r.status);return r.json()});
}
async function planTrips(body,token,origin){
  const records=body.records||{},submittedLocks=body.locks||{};
  const locks=Object.fromEntries(Object.entries(submittedLocks).filter(([,lock])=>travelDays.includes(lock?.date)));
  const catalog=places.map(p=>{
    const custom=records[p.id]?.coords;
    return Array.isArray(custom)&&custom.length===2&&custom.every(Number.isFinite)&&custom[0]>=-14&&custom[0]<=6&&custom[1]>=34&&custom[1]<=45?{...p,coords:custom,approx:false}:p;
  });
  const selected=catalog.filter(p=>['want','must','booked'].includes(records[p.id]?.status)).map(p=>({...p,status:records[p.id].status}));
  const limit=Math.max(120,Math.min(600,Number(body.limit)||270));
  const matrixPoints=[anchors.start,anchors.madrid,anchors.lisbon,...waypoints,...selected.filter(p=>(!p.approx||body.allowApprox)&&(p.kind!=='event'||locks[p.id]?.date))];
  let routingToken=token;
  const pointsIndex=new Map(matrixPoints.map((p,i)=>[p.id,i]));
  let matrix=null,last=0;
  async function routeCall(profile,endpoint,coords,query){
    if(!routingToken){const wait=1050-(Date.now()-last);if(wait>0)await sleep(wait);}
    last=Date.now();
    return providerRequest(profile,endpoint,coords,routingToken,query,origin);
  }
  async function loadMatrix(maxPoints){
    const points=matrixPoints.slice(0,maxPoints).map(p=>p.coords);
    const result=await routeCall('driving','table',points,{annotations:'duration,distance'});
    return Array.isArray(result.durations)?result:null;
  }
  if(routingToken){
    try{matrix=await loadMatrix(25);}catch{}
    if(!matrix)routingToken=null;
  }
  if(!routingToken){
    try{matrix=await loadMatrix(50);}catch{}
  }
  function metric(a,b){
    const fallback=estimates(a,b);
    if(a.city===b.city)return fallback;
    const i=pointsIndex.get(a.id),j=pointsIndex.get(b.id),sec=matrix?.durations?.[i]?.[j];
    return typeof sec==='number'?{mins:Math.round(sec/60),km:Math.round((matrix.distances?.[i]?.[j]??fallback.km*1000)/1000),mode:'道路车程'}:fallback;
  }
  const plans=['madrid','lisbon'].map(k=>optimize(anchors[k],selected,locks,metric,limit,Boolean(body.allowApprox)));
  for(const plan of plans){
    const legs=plan.days.flatMap(d=>d.legs);
    const driveLegs=legs.filter(l=>l.mode==='道路车程'||l.mode==='自驾估算');
    // A single overview request per variant when possible. Interleaved walking gaps
    // are carried as bridge waypoints and dropped from the returned road geometry.
    if(driveLegs.length&&matrix){
      const allPoints=[driveLegs[0].coords[0]],indices=[];
      for(const l of driveLegs){
        if(String(allPoints.at(-1))!==String(l.coords[0]))allPoints.push(l.coords[0]);
        indices.push(allPoints.length-1);allPoints.push(l.coords[1]);
      }
      if(allPoints.length<=(routingToken?25:75)){
        try{
          const r=await routeCall('driving','route',allPoints,{steps:'true',overview:'false',geometries:'geojson'});
          driveLegs.forEach((l,i)=>{
            const road=r.routes?.[0]?.legs?.[indices[i]];
            const geometry=road?.steps?.flatMap(s=>s.geometry?.coordinates||[]);
            if(geometry?.length>1){
              const stride=Math.max(1,Math.ceil(geometry.length/200));
              l.road=geometry.filter((_,i)=>i%stride===0||i===geometry.length-1);
            }
          });
        }catch{}
      }
    }
    for(const day of plan.days){
      day.drive=day.legs.filter(l=>l.mode==='道路车程'||l.mode==='自驾估算').reduce((n,l)=>n+l.mins,0);
      day.totalKm=day.legs.reduce((n,l)=>n+l.km,0);
      day.over=Math.max(0,day.drive-limit);
    }
    plan.totalDrive=plan.days.reduce((n,d)=>n+d.drive,0);
    plan.totalKm=plan.days.reduce((n,d)=>n+d.totalKm,0);
    plan.longDays=plan.days.filter(d=>d.drive>=240).length;
    plan.mustKept=plan.days.flatMap(d=>d.activities).filter(a=>records[a.id]?.status==='must').length;
    plan.exact=Boolean(matrix?.durations)&&driveLegs.every(l=>l.mode==='道路车程'&&l.road?.length);
  }
  return {plans,provider:matrix?.durations?(routingToken?'Mapbox':'OSRM / OpenStreetMap'):'直线距离估算',generated:new Date().toISOString()};
}
