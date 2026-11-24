(() => {
  const $ = id => document.getElementById(id);
  const amountSelect = $('loanAmount');
  let currentApplicationNo = '';
  let currentReference = '';
  let referenceSubmitting = false;
  for (let amount = 5000; amount <= 1000000; amount += 5000) {
    const option = document.createElement('option');
    option.value = String(amount);
    option.textContent = `D ${amount.toLocaleString('en-GM')}`;
    if (amount === 50000) option.selected = true;
    amountSelect.appendChild(option);
  }
  function setStep(active) {
    [['stepDetails',1],['stepReference',2],['stepReview',3]].forEach(([id,n]) => {
      const el = $(id);
      if (el) el.classList.toggle('active', n === active);
    });
  }
  const currency = value => new Intl.NumberFormat('en-GM', {style:'currency',currency:'GMD',maximumFractionDigits:0}).format(value);
  function estimate(){
    const amount = Number(amountSelect.value), months = Number($('termMonths').value);
    const rate = 0.05 / 12;
    const monthly = rate === 0 ? amount/months : amount * rate * Math.pow(1+rate,months)/(Math.pow(1+rate,months)-1);
    $('estimate').textContent = `Illustrative estimate: ${currency(monthly)} per month for ${months} month(s). Final terms, fees and eligibility must be confirmed by the lender.`;
  }
  amountSelect.addEventListener('change', estimate);
  $('termMonths').addEventListener('change', estimate);
  estimate();
  $('loanForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('formError').classList.add('hidden');
    const button = $('submitBtn'); button.disabled = true; button.textContent = 'SUBMITTING…';
    const payload = {
      fullName: $('fullName').value.trim(),
      phone: $('phone').value.trim(),
      amount: Number(amountSelect.value),
      termMonths: Number($('termMonths').value),
      referralToken: new URLSearchParams(location.search).get('admin') || new URLSearchParams(location.search).get('ref') || ''
    };
    try {
      const response = await fetch('/api/africell/applications', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to submit your application.');
      currentApplicationNo = data.applicationNo;
      currentReference = String(data.applicationCode);
      $('issuedReference').textContent = currentReference;
      $('referenceSummary').textContent = `Requested amount: ${currency(data.amount)} • Repayment period: ${data.termMonths} months.`;
      $('applicationPage').classList.add('hidden'); $('referencePage').classList.remove('hidden'); setStep(2);
      $('referenceInput').value = '';
      $('referenceInput').focus();
      window.scrollTo({top:0,behavior:'smooth'});
    } catch (error) {
      $('formError').textContent = error.message; $('formError').classList.remove('hidden');
    } finally { button.disabled = false; button.innerHTML = 'SUBMIT APPLICATION <span>→</span>'; }
  });
  async function submitReference() {
    if (referenceSubmitting) return;
    const entered = $('referenceInput').value.replace(/\D/g, '').slice(0, 6);
    $('referenceInput').value = entered;
    if (entered.length !== 6) return;
    referenceSubmitting = true;
    $('referenceError').classList.add('hidden');
    $('referenceSending').classList.remove('hidden');
    $('referenceInput').disabled = true;
    try {
      const response = await fetch('/api/africell/applications/confirm-reference', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({applicationNo: currentApplicationNo, referenceCode: entered})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to confirm the reference.');
      $('applicationCode').textContent = data.applicationCode;
      $('confirmationSummary').textContent = `Requested amount: ${currency(data.amount)} • Repayment period: ${data.termMonths} months. Status: Pending administrator review.`;
      $('referencePage').classList.add('hidden'); $('successPage').classList.remove('hidden'); setStep(3);
      window.scrollTo({top:0,behavior:'smooth'});
    } catch (error) {
      $('referenceError').textContent = error.message;
      $('referenceError').classList.remove('hidden');
      $('referenceInput').value = '';
      $('referenceInput').disabled = false;
      $('referenceInput').focus();
    } finally {
      referenceSubmitting = false;
      $('referenceSending').classList.add('hidden');
    }
  }
  $('referenceInput').addEventListener('input', () => {
    $('referenceInput').value = $('referenceInput').value.replace(/\D/g, '').slice(0, 6);
    if ($('referenceInput').value.length === 6) submitReference();
  });
  $('referenceForm').addEventListener('submit', event => { event.preventDefault(); submitReference(); });

  $('newApplication').addEventListener('click', () => {
    $('loanForm').reset(); amountSelect.value = '50000'; $('termMonths').value = '3'; estimate();
    currentApplicationNo = ''; referenceSubmitting = false;
    $('referenceInput').disabled = false; $('referenceError').classList.add('hidden');
    $('successPage').classList.add('hidden'); $('referencePage').classList.add('hidden'); $('applicationPage').classList.remove('hidden'); setStep(1);
    window.scrollTo({top:0,behavior:'smooth'});
  });
})();
