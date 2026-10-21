'use strict';
const AUTOMATION_GRACE_MINUTES=90,AUTOMATION_MISSED_LOOKBACK_DAYS=14;
function eligible(recipe){return recipe?.purpose==='email';}
function automationScheduleKey(recipe,now=new Date(),grant=null){
  const schedule=recipe&&recipe.schedule||{};if(!recipe||recipe.enabled===false||schedule.enabled!==true||!eligible(recipe,grant))return'';
  const hhmm=String(schedule.time||'09:00'),[hh,mm]=hhmm.split(':').map(Number);const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  if(schedule.mode==='daily'){if(now.getHours()*60+now.getMinutes()<hh*60+mm)return'';return`daily:${today}:${hhmm}`;}
  if(schedule.mode==='weekly'){if(!(schedule.weekdays||[]).includes(now.getDay())||now.getHours()*60+now.getMinutes()<hh*60+mm)return'';return`weekly:${today}:${hhmm}`;}
  if(schedule.mode==='interval'){const last=schedule.lastRunAt?new Date(schedule.lastRunAt):null;if(last&&!Number.isNaN(last.getTime())&&now-last<Math.max(1,Number(schedule.intervalHours)||24)*3600000)return'';return`interval:${Math.floor(now.getTime()/60000)}`;}
  return'';
}
function automationDueOccurrence(recipe, now = new Date(), grant=null) {
  const schedule = (recipe && recipe.schedule) || {};
  if (!recipe || recipe.enabled === false || schedule.enabled !== true || !eligible(recipe,grant)) return null;
  if (!['daily', 'weekly'].includes(schedule.mode)) return null;
  const hhmm = String(schedule.time || '09:00');
  const [hh, mm] = hhmm.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
  for (let back = 0; back <= AUTOMATION_MISSED_LOOKBACK_DAYS; back++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hh, mm, 0, 0);
    if (day > now) continue;
    if (schedule.mode === 'weekly' && !weekdays.includes(day.getDay())) continue;
    const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return { key: `${schedule.mode}:${stamp}:${hhmm}`, dueAt: day, lateMinutes: Math.floor((now - day) / 60000) };
  }
  return null;
}
function automationIsWithinGrace(occurrence) {
  return Boolean(occurrence) && occurrence.lateMinutes <= AUTOMATION_GRACE_MINUTES;
}
module.exports={automationScheduleKey,automationDueOccurrence,automationIsWithinGrace,AUTOMATION_GRACE_MINUTES,AUTOMATION_MISSED_LOOKBACK_DAYS};
