import {dayNumber,shift,clock,validDate,validCoords,uid} from './workspace-model.mjs';

const mins=time=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time||'')?Number(time.slice(0,2))*60+Number(time.slice(3)):null;
const duration=p=>Math.min(720,Math.max(15,Number(p.minutes)||75));
export const autoDates=(start,end)=>validDate(start)&&validDate(end)?dayNumber(end)-dayNumber(start)+1:0;
export const planStops=(selected,existing,initial)=>{
  const all=[...selected,...existing,initial].filter(p=>p&&validCoords(p.coords));
  return [...new Map(all.map(p=>[p.id,p])).values()];
};
export function autoPlan({selected,project,allPlaces,initial,start,end,from,to,maxStops,buffer,matrix,stops}){
  const count=autoDates(start,end), first=mins(from), last=mins(to);
  if(count<1||count>31||first===null||last===null||last<=first)throw Error('请选择 1–31 天的有效日期范围和每日时段');
  const byId=new Map(allPlaces.map(p=>[p.id,p]));
  const index=new Map(stops.map((p,i)=>[p.id,i]));
  const selectedIds=new Set(selected.map(p=>p.id));
  const preserved=new Map(project.schedule.filter(i=>selectedIds.has(i.placeId)).map(i=>[i.placeId,i]));
  const warnings=[], unplaced=[], items=[], pending=[];
  const skip=(p,reason)=>unplaced.push({id:p.id,name:p.name,reason});
  for(const p of selected){
    const existing=preserved.get(p.id);
    if(existing){
      if(!existing.date||existing.date<start||existing.date>end||mins(existing.start)===null)skip(p,'已有事项未定时，或日期在本次范围之外');
      continue;
    }
    if(!validCoords(p.coords)){skip(p,'缺少地图坐标');continue;}
    if(p.type==='event'||p.kind==='event'||project.statuses[p.id]==='booked'){
      skip(p,'请先核对场次或预订时间，并添加固定事项');continue;
    }
    pending.push(p);
  }
  function transfer(a,b){
    if(!a||!b||a.id===b.id||String(a.coords)===String(b.coords))return {minutes:0,km:0};
    if(!validCoords(a.coords)||!validCoords(b.coords))return null;
    if(a.timeZone&&b.timeZone&&a.timeZone!==b.timeZone)return null;
    const i=index.get(a.id),j=index.get(b.id);
    if(matrix?.durations&&i!==undefined&&j!==undefined){
      const seconds=matrix.durations[i]?.[j];
      if(!Number.isFinite(seconds))return null;
      const meters=matrix.distances?.[i]?.[j];
      return {minutes:Math.max(1,Math.ceil(seconds/60)),km:Number.isFinite(meters)?Math.round(meters/100)/10:null,road:true};
    }
    const r=Math.PI/180;
    const [x,y]=a.coords,[u,v]=b.coords;
    const h=Math.sin((v-y)*r/2)**2+Math.cos(y*r)*Math.cos(v*r)*Math.sin((u-x)*r/2)**2;
    const distance=12742*Math.asin(Math.sqrt(Math.min(1,h)));
    if(distance>350)return null;
    const km=Math.round(distance*13)/10;
    return {minutes:Math.max(5,Math.ceil(10+km/55*60)),km,road:false};
  }
  function occupied(date){
    const rows=[];
    for(const i of project.schedule){
      if(!i.date||date<i.date||date>(i.endDate||i.date))continue;
      const place=byId.get(i.placeId);
      const from=mins(i.start), to=mins(i.end);
      // Untimed entries do not consume the entire day, but are shown for manual review.
      if(date===i.date&&from===null){
        if(i.fixed)warnings.push(date+' · '+i.title+' 缺少开始时间，加入前请核对。');
        continue;
      }
      const begin=date===i.date?from:0;
      const finish=date===(i.endDate||i.date)?to??Math.min(1440,begin+(place?duration(place):60)):1440;
      rows.push({begin,finish:Math.max(begin+1,finish),place,tz:i.tz||place?.timeZone||''});
    }
    return rows.sort((a,b)=>a.begin-b.begin);
  }
  let previous=initial, usedEstimates=false;
  for(let offset=0;offset<count&&pending.length;offset++){
    const date=shift(start,offset), busy=occupied(date);
    const zones=new Set(busy.map(row=>row.tz).filter(Boolean));
    if(zones.size>1){warnings.push(date+' · 已有行程涉及多个时区，留作手动安排。');continue;}
    const bookedZone=[...zones][0];
    const regionChange=previous?.timeZone&&((bookedZone&&bookedZone!==previous.timeZone)
      ||(!bookedZone&&pending.every(p=>p.timeZone&&p.timeZone!==previous.timeZone)));
    if(regionChange){
      warnings.push(date+' · 切换地区和时区，请另行安排上一站到新地区的交通。');
      previous=null;
    }
    let zone=bookedZone||previous?.timeZone||'';
    let now=first, daily=0;
    const add=(fields)=>items.push({id:uid(),date,endDate:date,tz:zone,fixed:false,...fields});
    function addDrive(from,to,leg){
      if(!leg.minutes)return;
      usedEstimates||=!leg.road;
      add({title:from.name+' → '+to.name,type:'drive',start:clock(now),end:clock(now+leg.minutes),
        notes:leg.road?'道路矩阵车程，未查询实时路况。':'距离推算，出发前请核对道路与车程。',
        route:{stops:[from.coords,to.coords],minutes:leg.minutes,km:leg.km,estimated:!leg.road,provider:leg.road?'道路矩阵':'距离推算'}});
      now+=leg.minutes;
    }
    for(const next of [...busy,{begin:last,finish:last,sentinel:true}]){
      while(daily<maxStops&&now<Math.min(last,next.begin)){
        const options=pending.flatMap((p,i)=>{
          if(zone&&p.timeZone&&zone!==p.timeZone)return [];
          const inbound=transfer(previous,p);
          const onward=transfer(p,next.place);
          if(!inbound||!onward)return [];
          const wait=inbound.minutes?buffer:0;
          if(now+inbound.minutes+wait+duration(p)+onward.minutes+(onward.minutes?buffer:0)>Math.min(last,next.begin))return [];
          const anchor=previous?0:onward.minutes;
          return [{p,i,inbound,onward,wait,score:inbound.minutes+anchor+onward.minutes*.35}];
        }).sort((a,b)=>a.score-b.score||a.i-b.i);
        const choice=options[0];
        if(!choice)break;
        const {p,i,inbound,wait}=choice;
        zone ||= p.timeZone||'';
        if(inbound.minutes)addDrive(previous,p,inbound);
        now+=wait;
        add({placeId:p.id,title:p.name,type:p.type,start:clock(now),end:clock(now+duration(p)),address:p.address||'',
          notes:[p.hours&&'已记录开放时间：'+p.hours,p.booking&&'预约：'+p.booking,'请核对当日开放和门票'].filter(Boolean).join(' · ')});
        now+=duration(p);
        previous=p;daily++;pending.splice(i,1);
      }
      if(!next.sentinel){
        if(next.place&&previous&&now<=next.begin){
          const leg=transfer(previous,next.place);
          if(daily&&leg?.minutes&&now+leg.minutes+buffer<=next.begin)addDrive(previous,next.place,leg);
        }
        if(next.place)previous=next.place;
        else if(next.finish>first)warnings.push(date+' · 已有事项没有关联地点，衔接车程需手动核对。');
        now=Math.max(now,next.finish);
      }
    }
  }
  for(const p of pending)skip(p,'当前日期、每日时段或可衔接路线不足。可增加一天、延长时段，或拆成不同地区的行程。');
  return {items,unplaced,preserved:[...preserved.values()].filter(i=>i.date>=start&&i.date<=end&&mins(i.start)!==null).map(i=>i.title),warnings:[...new Set(warnings)],usedEstimates};
}
