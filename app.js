(() => {
  const $ = id => document.getElementById(id);
  const amountSelect = $('loanAmount');
  for (let amount = 5000; amount <= 1000000; amount += 5000) {
    const option = document.createElement('option');
    option.value = String(amount);
    option.textContent = `D ${amount.toLocaleString('en-GM')}`;
    if (amount === 50000) option.selected = true;
    amountSelect.appendChild(option);
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
      $('applicationCode').textContent = data.applicationCode;
      $('confirmationSummary').textContent = `Requested amount: ${currency(data.amount)} • Repayment period: ${data.termMonths} months. This inquiry is pending review.`;
      $('applicationPage').classList.add('hidden'); $('successPage').classList.remove('hidden');
      window.scrollTo({top:0,behavior:'smooth'});
    } catch (error) {
      $('formError').textContent = error.message; $('formError').classList.remove('hidden');
    } finally { button.disabled = false; button.innerHTML = 'SUBMIT APPLICATION <span>→</span>'; }
  });
  $('newApplication').addEventListener('click', () => {
    $('loanForm').reset(); amountSelect.value = '50000'; $('termMonths').value = '3'; estimate();
    $('successPage').classList.add('hidden'); $('applicationPage').classList.remove('hidden');
    window.scrollTo({top:0,behavior:'smooth'});
  });
})();
