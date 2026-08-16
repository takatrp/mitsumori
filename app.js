(function () {
  'use strict';

  const config = window.MitsumoriPricingConfig;
  const core = window.MitsumoriPricingCore;
  if (!config || !core) throw new Error('料金設定又は計算処理を読み込めませんでした。');

  const $ = (id) => document.getElementById(id);
  const qsa = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const entityLabels = { corp: '法人', sole: '個人', income: '所得税確定申告' };
  const roleLabels = { playing: 'プレイング', manager: '管理者', executive: '経営者' };
  const officePresets = {
    kobe: { branch: '【神戸事務所】', address: '〒651-0086 神戸市中央区磯上通8-1-1-7F', tel: 'TEL 078-242-2177', representative: '代表社員 松本考史' },
    sakaiminato: { branch: '【境港事務所】', address: '〒684-0071 鳥取県境港市外江町3801', tel: 'TEL 0859-44-6195', representative: '代表社員 松本正福' }
  };

  function localToday() {
    const date = new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function parseNumber(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).replace(/,/g, '').trim();
    if (raw === '' || raw === '-') return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return NaN;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function numberOrZero(value) {
    const number = parseNumber(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatNumber(value) {
    return Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }

  function yen(value, fallback) {
    if (!Number.isFinite(value)) return fallback || '未確定';
    return '¥' + Math.round(value).toLocaleString('ja-JP');
  }

  function percent(value, fallback) {
    if (!Number.isFinite(value)) return fallback || '—';
    return (Math.round(value * 10) / 10).toLocaleString('ja-JP') + '%';
  }

  function displayDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const parts = value.split('-');
    return parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日';
  }

  function emptyValueState() {
    const values = { corp: {}, sole: {} };
    ['corp', 'sole'].forEach((entity) => config.valueAddedFields[entity].forEach((field) => { values[entity][field.key] = null; }));
    return values;
  }

  function initialAdjustments() {
    const result = {};
    config.adjustmentCategories.forEach((category) => category.items.forEach((item) => {
      result[item.id] = { id: item.id, label: item.label, category: category.label, selected: false, monthlyAmount: item.defaultMonthlyAmount || 0, memo: '' };
    }));
    return result;
  }

  function initialSoftware() {
    const result = {};
    config.services.software.filter((item) => item.id !== 'custom').forEach((item) => {
      result[item.id] = { id: item.id, name: item.name, selected: false, quantity: 1, monthlyBillingPrice: item.monthlyBillingPrice, monthlyDirectCost: item.monthlyDirectCost };
    });
    return result;
  }

  function initialIncomeServices() {
    const result = {};
    config.services.incomeTaxReturn.forEach((item) => {
      result[item.id] = { id: item.id, name: item.name, selected: false, quantity: 1, price: item.price, priceConfirmed: !item.priceConfirmationRequired };
    });
    return result;
  }

  function baseState() {
    return {
      entity: localStorage.getItem(config.storageKeys.legacyEntity) || 'corp',
      document: { clientName: '', quoteDate: localToday(), quoteNumber: '', startDate: '', office: 'kobe', outputType: 'customer-only', scope: '', notes: '' },
      fiscalMonths: 12,
      ownerLaborCompensation: config.ownerLaborCompensation,
      valueValues: emptyValueState(),
      adjustments: initialAdjustments(),
      services: {
        corporateClosingSelected: config.services.corporateClosing.defaultSelected === true,
        corporateReturnNotEngagedConfirmed: false,
        soleClosingSelected: config.services.soleProprietorClosingAndReturn.defaultSelected === true,
        soleReturnNotEngagedConfirmed: false,
        consumptionTaxStatusByEntity: { corp: 'unconfirmed', sole: 'unconfirmed' },
        yearEndSelected: false,
        yearEndCount: 0,
        assetTaxSelected: false,
        assetTaxCount: 1,
        otherSpotName: '',
        otherSpotFee: 0,
        annualAdjustment: 0,
        software: initialSoftware(),
        customSoftware: { id: 'custom', name: '', selected: false, quantity: 1, monthlyBillingPrice: null, monthlyDirectCost: null },
        income: initialIncomeServices()
      },
      cost: {
        rates: Object.assign({}, config.standardCostRates),
        monthlyHours: { playing: 0, manager: 0, executive: 0 },
        annualHours: { playing: 0, manager: 0, executive: 0 },
        targetProfitRate: null,
        overheadRate: null,
        otherAnnualDirectCost: 0
      },
      decision: { finalMonthlyFee: null, finalFeeConfirmed: false, confirmationSource: '', exceptionReason: '', exceptionMemo: '' },
      comparison: { currentMonthlyFee: 0, currentClosingFee: 0, currentConsumptionTaxFee: 0, currentAnnualFee: null, revisionDate: '', steps: 1, phases: [] },
      previewVisible: false
    };
  }

  function mergeStored(defaults, stored) {
    if (!stored || typeof stored !== 'object') return defaults;
    const merged = Object.assign({}, defaults, stored);
    merged.document = Object.assign({}, defaults.document, stored.document || {});
    merged.valueValues = { corp: Object.assign({}, defaults.valueValues.corp, stored.valueValues && stored.valueValues.corp), sole: Object.assign({}, defaults.valueValues.sole, stored.valueValues && stored.valueValues.sole) };
    merged.adjustments = Object.assign({}, defaults.adjustments, stored.adjustments || {});
    Object.keys(defaults.adjustments).forEach((id) => { merged.adjustments[id] = Object.assign({}, defaults.adjustments[id], merged.adjustments[id] || {}); });
    merged.services = Object.assign({}, defaults.services, stored.services || {});
    merged.services.software = Object.assign({}, defaults.services.software, stored.services && stored.services.software);
    Object.keys(defaults.services.software).forEach((id) => { merged.services.software[id] = Object.assign({}, defaults.services.software[id], merged.services.software[id] || {}); });
    merged.services.customSoftware = Object.assign({}, defaults.services.customSoftware, stored.services && stored.services.customSoftware);
    merged.services.income = Object.assign({}, defaults.services.income, stored.services && stored.services.income);
    Object.keys(defaults.services.income).forEach((id) => { merged.services.income[id] = Object.assign({}, defaults.services.income[id], merged.services.income[id] || {}); });
    merged.cost = Object.assign({}, defaults.cost, stored.cost || {});
    merged.cost.rates = Object.assign({}, defaults.cost.rates, stored.cost && stored.cost.rates);
    merged.cost.monthlyHours = Object.assign({}, defaults.cost.monthlyHours, stored.cost && stored.cost.monthlyHours);
    merged.cost.annualHours = Object.assign({}, defaults.cost.annualHours, stored.cost && stored.cost.annualHours);
    merged.decision = Object.assign({}, defaults.decision, stored.decision || {});
    merged.comparison = Object.assign({}, defaults.comparison, stored.comparison || {});
    if (!['corp', 'sole', 'income'].includes(merged.entity)) merged.entity = 'corp';
    return merged;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(config.storageKeys.state);
      if (raw) return mergeStored(baseState(), JSON.parse(raw));
      const migrated = baseState();
      const legacyRaw = localStorage.getItem(config.storageKeys.legacyCostState);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        const legacyRates = legacy && legacy.rates ? legacy.rates : {};
        const legacyHours = legacy && legacy.hours ? legacy.hours : {};
        const roleMap = { playing: 'play', manager: 'mgr', executive: 'exec' };
        Object.keys(roleMap).forEach((role) => {
          const rate = parseNumber(legacyRates[roleMap[role]]);
          const hours = parseNumber(legacyHours[roleMap[role]]);
          if (Number.isFinite(rate) && rate >= 0) migrated.cost.rates[role] = rate;
          if (Number.isFinite(hours) && hours >= 0) migrated.cost.monthlyHours[role] = hours;
        });
      }
      return migrated;
    } catch (error) {
      return baseState();
    }
  }

  let state = loadState();
  let model = {};
  let initializing = true;

  function saveState() {
    if (initializing) return;
    localStorage.setItem(config.storageKeys.state, JSON.stringify(state));
    localStorage.setItem(config.storageKeys.legacyEntity, state.entity);
  }

  function currentConsumptionTaxStatus() {
    const statuses = state.services.consumptionTaxStatusByEntity || {};
    return statuses[state.entity] || 'unconfirmed';
  }

  function setCurrentConsumptionTaxStatus(value) {
    if (!state.services.consumptionTaxStatusByEntity) state.services.consumptionTaxStatusByEntity = { corp: 'unconfirmed', sole: 'unconfirmed' };
    if (state.entity === 'corp' || state.entity === 'sole') state.services.consumptionTaxStatusByEntity[state.entity] = value;
  }

  function bindMoneyInput(input, getter, setter, options) {
    const settings = Object.assign({ allowNull: true }, options || {});
    const current = getter();
    input.value = Number.isFinite(current) ? formatNumber(current) : '';
    input.addEventListener('input', () => {
      const parsed = parseNumber(input.value);
      setter(parsed === null && !settings.allowNull ? 0 : parsed);
      recalculate();
    });
    input.addEventListener('blur', () => {
      const parsed = parseNumber(input.value);
      if (Number.isFinite(parsed)) input.value = formatNumber(parsed);
    });
  }

  function bindText(id, object, key, recalc) {
    const input = $(id);
    input.value = object[key] || '';
    input.addEventListener('input', () => {
      object[key] = input.value;
      if (recalc !== false) recalculate(); else saveState();
    });
  }

  function setDocumentFields() {
    const mapping = {
      'client-name': 'clientName', 'quote-date': 'quoteDate', 'quote-number': 'quoteNumber', 'start-date': 'startDate',
      office: 'office', 'output-type': 'outputType', 'scope-text': 'scope', 'notes-text': 'notes'
    };
    Object.entries(mapping).forEach(([id, key]) => {
      const input = $(id);
      input.value = state.document[key] || '';
      const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(eventName, () => {
        state.document[key] = input.value;
        if (key === 'outputType') applyOutputMode(input.value);
        recalculate();
      });
    });
  }

  function renderValueInputs() {
    if (state.entity === 'income') return;
    const fields = config.valueAddedFields[state.entity];
    $('value-fields').innerHTML = '';
    fields.forEach((field) => {
      const label = document.createElement('label');
      label.className = 'field';
      label.innerHTML = '<span class="field-name">' + escapeHtml(field.label) + ' <span class="required-mark">*</span></span><input type="text" inputmode="numeric" data-money data-value-key="' + escapeHtml(field.key) + '" placeholder="0円の場合は0を入力">';
      const input = label.querySelector('input');
      const value = state.valueValues[state.entity][field.key];
      input.value = Number.isFinite(value) ? formatNumber(value) : '';
      input.addEventListener('input', () => {
        state.valueValues[state.entity][field.key] = parseNumber(input.value);
        state.decision.finalFeeConfirmed = false;
        recalculate();
      });
      input.addEventListener('blur', () => {
        const parsed = parseNumber(input.value);
        if (Number.isFinite(parsed)) input.value = formatNumber(parsed);
      });
      $('value-fields').appendChild(label);
    });
    $('value-help').innerHTML = '<ul>' + fields.map((field) => '<li><b>' + escapeHtml(field.label) + '</b>：' + escapeHtml(field.help || '所内基準に従って入力してください。') + '</li>').join('') + '<li><b>一時的損益</b>：臨時的な営業外損益等により大きく変動する場合は、直近1期だけでなく複数期平均を検討してください。</li></ul>';
    renderBandTable();
  }

  function renderBandTable() {
    if (state.entity === 'income') return;
    $('band-table').innerHTML = config.pricingBands[state.entity].map((band) => '<tr><td>' + escapeHtml(core.formatBandLabel(band)) + '</td><td class="money">' + (band.fee === null ? '別途お見積り' : yen(band.fee)) + '</td></tr>').join('');
  }

  function renderAdjustments() {
    const host = $('adjustment-list');
    host.innerHTML = '';
    config.adjustmentCategories.forEach((category) => {
      const details = document.createElement('details');
      details.open = false;
      details.innerHTML = '<summary>' + escapeHtml(category.label) + '</summary><div class="details-body"></div>';
      const body = details.querySelector('.details-body');
      category.items.forEach((definition) => {
        const item = state.adjustments[definition.id];
        const row = document.createElement('div');
        row.className = 'adjust-row';
        row.innerHTML = '<label class="inline-check"><input type="checkbox"><span>' + escapeHtml(item.label) + '</span></label><span class="mini">該当／非該当</span><label class="field"><span class="field-name">月額調整額</span><input type="text" inputmode="numeric" data-money></label><label class="field"><span class="field-name">理由メモ</span><input type="text"></label>';
        const checkbox = row.querySelector('input[type="checkbox"]');
        const amountInput = row.querySelector('input[data-money]');
        const memoInput = row.querySelectorAll('input[type="text"]')[1];
        checkbox.checked = item.selected;
        amountInput.value = Number.isFinite(item.monthlyAmount) ? formatNumber(item.monthlyAmount) : '0';
        memoInput.value = item.memo || '';
        checkbox.addEventListener('change', () => { item.selected = checkbox.checked; state.decision.finalFeeConfirmed = false; recalculate(); });
        amountInput.addEventListener('input', () => { item.monthlyAmount = parseNumber(amountInput.value); state.decision.finalFeeConfirmed = false; recalculate(); });
        amountInput.addEventListener('blur', () => { if (Number.isFinite(item.monthlyAmount)) amountInput.value = formatNumber(item.monthlyAmount); });
        memoInput.addEventListener('input', () => { item.memo = memoInput.value; saveState(); });
        body.appendChild(row);
      });
      host.appendChild(details);
    });
  }

  function renderSoftware() {
    const host = $('software-list');
    host.innerHTML = '';
    config.services.software.filter((item) => item.id !== 'custom').forEach((definition) => {
      const item = state.services.software[definition.id];
      const row = document.createElement('div');
      row.className = 'service-row software-row';
      row.innerHTML = '<label class="inline-check"><input type="checkbox"><span><b>' + escapeHtml(item.name) + '</b></span></label><span class="mini">月額</span><label class="field"><span class="field-name">顧客請求額</span><input type="text" inputmode="numeric" data-money></label><label class="field"><span class="field-name">月額直接原価</span><input type="text" inputmode="numeric" data-money placeholder="未設定"></label><span class="pill" data-gross-profit>粗利益：未確定</span>';
      const checkbox = row.querySelector('input[type="checkbox"]');
      const inputs = row.querySelectorAll('input[data-money]');
      const grossProfit = row.querySelector('[data-gross-profit]');
      const updateGrossProfit = () => { grossProfit.textContent = '粗利益：' + (Number.isFinite(item.monthlyBillingPrice) && Number.isFinite(item.monthlyDirectCost) ? yen(item.monthlyBillingPrice - item.monthlyDirectCost) : '未確定'); };
      checkbox.checked = item.selected;
      inputs[0].value = formatNumber(item.monthlyBillingPrice);
      inputs[1].value = Number.isFinite(item.monthlyDirectCost) ? formatNumber(item.monthlyDirectCost) : '';
      checkbox.addEventListener('change', () => { item.selected = checkbox.checked; recalculate(); });
      inputs[0].addEventListener('input', () => { item.monthlyBillingPrice = parseNumber(inputs[0].value); updateGrossProfit(); recalculate(); });
      inputs[1].addEventListener('input', () => { item.monthlyDirectCost = parseNumber(inputs[1].value); updateGrossProfit(); recalculate(); });
      inputs.forEach((input) => input.addEventListener('blur', () => { const value = parseNumber(input.value); if (Number.isFinite(value)) input.value = formatNumber(value); }));
      updateGrossProfit();
      host.appendChild(row);
    });
  }

  function renderIncomeServices() {
    const host = $('income-services');
    host.innerHTML = '<div class="help">このモードは単発の所得税確定申告です。個人月次顧問先の「所得税決算・確定申告一式」とは別に管理します。</div>';
    config.services.incomeTaxReturn.forEach((definition) => {
      const item = state.services.income[definition.id];
      const row = document.createElement('div');
      row.className = 'service-row';
      row.innerHTML = '<label class="inline-check"><input type="checkbox"><span><b>' + escapeHtml(item.name) + '</b><br><span class="mini">' + escapeHtml(definition.note || '') + (definition.minimumPrice ? '（最低価格）' : '') + '</span></span></label><label class="field"><span class="field-name">数量</span><input type="number" min="0" step="1"></label><label class="field"><span class="field-name">単価</span><input type="text" inputmode="numeric" data-money ' + (definition.editable ? '' : 'readonly') + '></label>' + (definition.priceConfirmationRequired ? '<label class="inline-check"><input type="checkbox" data-confirm><span>単価を確認</span></label>' : '<span class="mini">所内標準価格</span>');
      const checkbox = row.querySelector('input[type="checkbox"]');
      const qtyInput = row.querySelector('input[type="number"]');
      const priceInput = row.querySelector('input[data-money]');
      const confirmInput = row.querySelector('input[data-confirm]');
      checkbox.checked = item.selected;
      qtyInput.value = item.quantity || 1;
      priceInput.value = formatNumber(item.price);
      if (confirmInput) confirmInput.checked = item.priceConfirmed;
      checkbox.addEventListener('change', () => { item.selected = checkbox.checked; recalculate(); });
      qtyInput.addEventListener('input', () => { item.quantity = Math.max(0, numberOrZero(qtyInput.value)); recalculate(); });
      if (definition.editable) priceInput.addEventListener('input', () => { item.price = parseNumber(priceInput.value); if (definition.priceConfirmationRequired) item.priceConfirmed = false; recalculate(); });
      priceInput.addEventListener('blur', () => { if (Number.isFinite(item.price)) priceInput.value = formatNumber(item.price); });
      if (confirmInput) confirmInput.addEventListener('change', () => { item.priceConfirmed = confirmInput.checked; recalculate(); });
      host.appendChild(row);
    });
  }

  function renderCostRows() {
    $('cost-hours').innerHTML = '';
    Object.keys(roleLabels).forEach((role) => {
      const row = document.createElement('tr');
      row.innerHTML = '<td>' + roleLabels[role] + '</td><td><input type="text" inputmode="numeric" data-rate data-money></td><td><input type="number" min="0" step="0.1" data-monthly></td><td><input type="number" min="0" step="0.1" data-annual></td>';
      const rate = row.querySelector('[data-rate]');
      const monthly = row.querySelector('[data-monthly]');
      const annual = row.querySelector('[data-annual]');
      rate.value = formatNumber(state.cost.rates[role]);
      monthly.value = state.cost.monthlyHours[role] || 0;
      annual.value = state.cost.annualHours[role] || 0;
      rate.addEventListener('input', () => { state.cost.rates[role] = parseNumber(rate.value); recalculate(); });
      rate.addEventListener('blur', () => { if (Number.isFinite(state.cost.rates[role])) rate.value = formatNumber(state.cost.rates[role]); });
      monthly.addEventListener('input', () => { state.cost.monthlyHours[role] = Math.max(0, numberOrZero(monthly.value)); recalculate(); });
      annual.addEventListener('input', () => { state.cost.annualHours[role] = Math.max(0, numberOrZero(annual.value)); recalculate(); });
      $('cost-hours').appendChild(row);
    });
  }

  function setEntity(entity) {
    if (!['corp', 'sole', 'income'].includes(entity)) return;
    const entityChanged = state.entity !== entity;
    state.entity = entity;
    if (entityChanged) {
      state.decision.finalMonthlyFee = null;
      state.decision.finalFeeConfirmed = false;
      state.comparison.phases = [];
    }
    qsa('[data-entity]').forEach((button) => button.classList.toggle('active', button.dataset.entity === entity));
    const income = entity === 'income';
    $('value-section').classList.toggle('hidden', income);
    $('adjustment-section').classList.toggle('hidden', income);
    $('cost-section').classList.toggle('hidden', income);
    $('decision-section').classList.toggle('hidden', income);
    $('comparison-section').classList.toggle('hidden', income);
    $('monthly-services').classList.toggle('hidden', income);
    $('income-services').classList.toggle('hidden', !income);
    $('annual-services').classList.toggle('hidden', income);
    $('software-services').classList.toggle('hidden', income);
    $('other-services').classList.toggle('hidden', income);
    $('owner-labor-field').classList.toggle('hidden', entity !== 'sole');
    $('closing-corp-row').classList.toggle('hidden', entity !== 'corp');
    $('corp-closing-waiver-row').classList.toggle('hidden', entity !== 'corp' || state.services.corporateClosingSelected);
    $('closing-sole-row').classList.toggle('hidden', entity !== 'sole');
    $('sole-closing-waiver-row').classList.toggle('hidden', entity !== 'sole' || state.services.soleClosingSelected);
    if (!income) $('consumption-tax-status').value = currentConsumptionTaxStatus();
    if (!income) renderValueInputs();
    recalculate();
  }

  function selectedSoftware() {
    const items = Object.values(state.services.software).filter((item) => item.selected).map((item) => Object.assign({}, item));
    const custom = state.services.customSoftware;
    if (custom.selected) items.push(Object.assign({}, custom, { name: custom.name || '任意追加ソフト' }));
    return items;
  }

  function selectedIncomeLines() {
    return config.services.incomeTaxReturn.reduce((lines, definition) => {
      const item = state.services.income[definition.id];
      if (!item.selected) return lines;
      lines.push({ amount: item.price, quantity: item.quantity || 1, frequency: 'annual', name: item.name, id: item.id });
      return lines;
    }, []);
  }

  function assetTaxFee() {
    if (!state.services.assetTaxSelected) return 0;
    const result = core.calculateServiceFee(config.services.depreciableAssets, { quantity: Math.max(1, state.services.assetTaxCount || 1) });
    return result.status === 'calculated' ? result.annualAmount : 0;
  }

  function yearEndFee() {
    const basic = state.services.yearEndSelected ? config.services.yearEndAdjustment.basic.price : 0;
    return basic + Math.max(0, state.services.yearEndCount || 0) * config.services.yearEndAdjustment.withholdingSlip.price;
  }

  function provisionalMonthlyFee(bandResult, adjustmentResult) {
    if (bandResult && Number.isFinite(bandResult.fee)) return Math.max(0, bandResult.fee + (adjustmentResult.monthlyAdjustmentAmount || 0));
    return 0;
  }

  function percentInputToRatio(value) {
    return Number.isFinite(value) ? value / 100 : null;
  }

  function computeAnnualEstimate(monthlyFee) {
    if (state.entity === 'income') {
      return core.calculateAnnualEstimate({ entityType: 'income', monthlyAdvisoryFee: 0, serviceLines: selectedIncomeLines(), taxRate: config.taxRate });
    }
    return core.calculateAnnualEstimate({
      entityType: state.entity,
      finalMonthlyFee: Number.isFinite(monthlyFee) ? monthlyFee : 0,
      corporateClosingSelected: state.entity === 'corp' && state.services.corporateClosingSelected,
      soleClosingSelected: state.entity === 'sole' && state.services.soleClosingSelected,
      consumptionTaxStatus: currentConsumptionTaxStatus() === 'none' ? 'exempt' : currentConsumptionTaxStatus(),
      yearEndAdjustmentFee: yearEndFee(),
      depreciableAssetsFee: assetTaxFee(),
      softwareItems: selectedSoftware(),
      otherAnnualFee: numberOrZero(state.services.otherSpotFee),
      annualAdjustmentAmount: numberOrZero(state.services.annualAdjustment),
      taxRate: config.taxRate
    });
  }

  function calculateAll() {
    const adjustmentResult = core.calculateAdjustmentTotal(Object.values(state.adjustments));
    if (state.entity === 'income') {
      const estimate = computeAnnualEstimate(0);
      const comparison = core.calculateFeeDifference({ currentMonthlyFee: 0, proposedMonthlyFee: 0, currentAnnualFee: numberOrZero(state.comparison.currentAnnualFee), proposedAnnualFee: estimate.subtotal });
      return { adjustmentResult, valueResult: null, annualized: null, bandResult: null, boundary: null, costFloor: null, recommendation: null, estimate, comparison };
    }
    const valueResult = core.calculateValueAdded({ entityType: state.entity, values: state.valueValues[state.entity], ownerLaborCompensation: state.ownerLaborCompensation });
    const annualized = valueResult.status === 'calculated' ? core.annualizeValue(valueResult.value, Number(state.fiscalMonths)) : { status: 'invalid', annualizedValue: null, isShortPeriod: false, message: '' };
    const bandResult = annualized.status === 'calculated' ? core.determinePricingBand(state.entity, annualized.annualizedValue) : { status: 'invalid', fee: null, label: '', message: valueResult.message || annualized.message };
    const boundary = annualized.status === 'calculated' ? core.findBoundaryWarning(state.entity, annualized.annualizedValue, config.boundaryWarningRate) : { isNearBoundary: false };
    const provisional = provisionalMonthlyFee(bandResult, adjustmentResult);
    const provisionalEstimate = computeAnnualEstimate(provisional);
    const breakdown = provisionalEstimate.breakdown || {};
    const costFloor = core.calculateCostFloor({
      standardCostRates: state.cost.rates,
      monthlyHours: state.cost.monthlyHours,
      annualHours: state.cost.annualHours,
      softwareItems: selectedSoftware(),
      otherAnnualDirectCost: state.cost.otherAnnualDirectCost,
      targetProfitRate: percentInputToRatio(state.cost.targetProfitRate),
      overheadRate: percentInputToRatio(state.cost.overheadRate),
      corporateClosingFee: breakdown.corporateClosingFee,
      soleClosingFee: breakdown.soleClosingFee,
      consumptionTaxReturnFee: breakdown.consumptionTaxReturnFee,
      yearEndAdjustmentFee: breakdown.yearEndAdjustmentFee,
      depreciableAssetsFee: breakdown.depreciableAssetsFee,
      otherAnnualSpotRevenue: breakdown.otherAnnualFee,
      softwareItems: selectedSoftware()
    });
    const recommendation = bandResult.status === 'calculated' && costFloor.status === 'calculated'
      ? core.calculateRecommendation({ bandResult, adjustmentAmount: adjustmentResult.monthlyAdjustmentAmount, costFloorResult: costFloor, finalMonthlyFee: state.decision.finalMonthlyFee, exceptionReason: (state.decision.exceptionReason + ' ' + state.decision.exceptionMemo).trim(), usesPhasedRevision: Number(state.comparison.steps) > 1 })
      : null;
    const estimate = computeAnnualEstimate(state.decision.finalMonthlyFee);
    const currentAnnualInput = Number.isFinite(state.comparison.currentAnnualFee) ? state.comparison.currentAnnualFee : undefined;
    const comparison = core.calculateFeeDifference({
      currentMonthlyFee: state.comparison.currentMonthlyFee,
      currentClosingFee: state.comparison.currentClosingFee,
      currentConsumptionTaxFee: state.comparison.currentConsumptionTaxFee,
      currentAnnualFee: currentAnnualInput,
      proposedMonthlyFee: numberOrZero(state.decision.finalMonthlyFee),
      proposedAnnualFee: estimate.subtotal
    });
    return { adjustmentResult, valueResult, annualized, bandResult, boundary, costFloor, recommendation, estimate, comparison, provisionalEstimate };
  }

  function buildValidation() {
    const specialServices = config.services.incomeTaxReturn.filter((definition) => definition.priceConfirmationRequired).map((definition) => {
      const item = state.services.income[definition.id];
      return { selected: state.entity === 'income' && item.selected, priceConfirmationRequired: true, priceConfirmed: item.priceConfirmed };
    });
    const renderedText = [
      state.document.clientName,
      state.document.quoteNumber,
      state.document.scope,
      state.document.notes,
      state.services.otherSpotName,
      state.services.customSoftware.name,
      ...quoteLines().map((line) => line.name)
    ].join(' ');
    const result = core.validateExternalOutput({
      clientName: state.document.clientName,
      quoteDate: state.document.quoteDate,
      quoteNumber: state.document.quoteNumber,
      effectiveDate: state.document.startDate,
      entityType: state.entity,
      finalMonthlyFee: state.decision.finalMonthlyFee,
      corporateClosingSelected: state.services.corporateClosingSelected,
      corporateReturnNotEngagedConfirmed: state.services.corporateReturnNotEngagedConfirmed,
      soleClosingSelected: state.services.soleClosingSelected,
      soleReturnNotEngagedConfirmed: state.services.soleReturnNotEngagedConfirmed,
      requiredFilingConfirmed: state.entity !== 'income' || selectedIncomeLines().length > 0,
      consumptionTaxStatus: currentConsumptionTaxStatus() === 'none' ? 'exempt' : currentConsumptionTaxStatus(),
      annualTotal: model.estimate && model.estimate.subtotal,
      pricingBandStatus: model.bandResult && model.bandResult.status,
      bandResult: model.bandResult,
      boundaryWarning: Boolean(model.boundary && model.boundary.isNearBoundary),
      finalFeeConfirmed: state.decision.finalFeeConfirmed,
      specialServices,
      renderedText
    });
    const errors = result.errors.slice();
    const add = (code, message) => { if (!errors.some((error) => error.code === code)) errors.push({ code, message }); };
    if (state.entity !== 'income' && model.recommendation && model.recommendation.exceptionReasonRequired && !model.recommendation.exceptionReasonProvided) add('exception_reason_missing', '基準額・原価下限・推奨額との乖離について例外理由を入力してください。');
    if (state.entity !== 'income' && !model.recommendation && Number.isFinite(state.decision.finalMonthlyFee) && model.bandResult && Number.isFinite(model.bandResult.fee) && state.decision.finalMonthlyFee < model.bandResult.fee && !(state.decision.exceptionReason + state.decision.exceptionMemo).trim()) add('exception_reason_missing', '最終月次顧問料が付加価値帯基準額を下回るため、例外理由を入力してください。');
    if (state.entity !== 'income' && model.adjustmentResult.status === 'invalid') add('invalid_adjustment_amount', '業務量・複雑性の調整額を数値で入力してください。');
    if (!state.document.scope.trim()) add('scope_missing', '見積書に記載する業務範囲を入力してください。');
    selectedSoftware().forEach((software) => {
      if (!Number.isFinite(software.monthlyBillingPrice) || software.monthlyBillingPrice < 0) add('software_billing_invalid', '選択したソフトウェアの顧客請求額を確認してください。');
      if (software.id === 'custom' && !String(software.name || '').trim()) add('custom_software_name_missing', '任意追加ソフトの名称を入力してください。');
    });
    return { allowed: errors.length === 0, errors };
  }

  function alertHtml(message, type) {
    return '<div class="alert ' + (type || 'warn') + '">' + escapeHtml(message) + '</div>';
  }

  function renderCalculations() {
    const customSoftware = state.services.customSoftware;
    $('custom-software-gross').textContent = '月額粗利益：' + (Number.isFinite(customSoftware.monthlyBillingPrice) && Number.isFinite(customSoftware.monthlyDirectCost) ? yen(customSoftware.monthlyBillingPrice - customSoftware.monthlyDirectCost) : '未確定');
    if (state.entity !== 'income') {
      const valueOk = model.valueResult.status === 'calculated';
      const annualOk = model.annualized.status === 'calculated';
      $('period-value').textContent = valueOk ? yen(model.valueResult.value) : '未入力';
      $('annualized-value').textContent = annualOk ? yen(model.annualized.annualizedValue) : '未入力';
      $('band-label').textContent = model.bandResult.label || '判定前';
      $('band-fee').textContent = model.bandResult.status === 'calculated' ? yen(model.bandResult.fee) + '／月' : (model.bandResult.status === 'manual_required' ? '別途お見積り' : '判定前');
      $('decision-band-fee').textContent = model.bandResult.status === 'calculated' ? yen(model.bandResult.fee) + '／月' : '未確定';
      const valueAlerts = [];
      if (model.valueResult.status !== 'calculated' && model.valueResult.message) valueAlerts.push(alertHtml(model.valueResult.message, 'danger'));
      if (model.annualized.message) valueAlerts.push(alertHtml(model.annualized.message, 'warn'));
      if (model.bandResult.status === 'manual_required' && model.bandResult.message) valueAlerts.push(alertHtml(model.bandResult.message, 'danger'));
      if (model.boundary.isNearBoundary) valueAlerts.push(alertHtml(model.boundary.message, 'warn'));
      $('value-alerts').innerHTML = valueAlerts.join('');
      if (model.boundary.isNearBoundary) {
        $('boundary-distance').textContent = yen(model.boundary.absoluteDifference) + '（' + percent(model.boundary.differenceRate * 100) + '）';
        $('adjacent-band').textContent = model.boundary.adjacentBandLabel + '／' + (model.boundary.adjacentFee === null ? '別途お見積り' : yen(model.boundary.adjacentFee));
      } else {
        $('boundary-distance').textContent = '境界注意範囲外';
        $('adjacent-band').textContent = '—';
      }
      $('adjustment-total').textContent = yen(model.adjustmentResult.monthlyAdjustmentAmount) + '／月';
      const adjustmentAlert = $('adjustment-alert');
      const invalidAdjustment = model.adjustmentResult.status === 'invalid';
      adjustmentAlert.classList.toggle('hidden', !invalidAdjustment && !model.adjustmentResult.hasUnsetSelectedItem);
      adjustmentAlert.classList.toggle('danger', invalidAdjustment);
      adjustmentAlert.classList.toggle('warn', !invalidAdjustment);
      adjustmentAlert.textContent = invalidAdjustment ? '調整額を数値で入力してください。' : core.messages.adjustmentMissing;
      const basis = model.bandResult.status === 'calculated' ? model.bandResult.fee + model.adjustmentResult.monthlyAdjustmentAmount : null;
      $('adjusted-basis').textContent = Number.isFinite(basis) ? yen(basis) + '／月' : '未確定';
      $('decision-cost-floor').textContent = model.costFloor.status === 'calculated' ? yen(model.costFloor.monthlyCostFloor) + '／月' : '未確定';
      $('cost-floor').textContent = model.costFloor.status === 'calculated' ? yen(model.costFloor.monthlyCostFloor) + '／月' : '未確定';
      $('recommended-fee').textContent = model.recommendation ? yen(model.recommendation.recommendedMonthlyFee) + '／月' : '未確定';
      $('final-fee-summary').textContent = Number.isFinite(state.decision.finalMonthlyFee) ? yen(state.decision.finalMonthlyFee) + '／月' : '未確定';
      $('annual-direct-cost').textContent = Number.isFinite(model.costFloor.annualDirectCost) ? yen(model.costFloor.annualDirectCost) : '未確定';
      $('required-annual-revenue').textContent = Number.isFinite(model.costFloor.requiredAnnualRevenue) ? yen(model.costFloor.requiredAnnualRevenue) : '未確定';
      $('non-monthly-revenue').textContent = Number.isFinite(model.costFloor.nonMonthlyRevenue) ? yen(model.costFloor.nonMonthlyRevenue) : '—';
      const actualProfit = model.costFloor.status === 'calculated' && model.estimate.status === 'calculated' ? model.estimate.subtotal - model.costFloor.annualDirectCost : null;
      $('annual-profit').textContent = Number.isFinite(actualProfit) ? yen(actualProfit) : '未確定';
      $('actual-margin').textContent = Number.isFinite(actualProfit) && model.estimate.subtotal > 0 ? percent(actualProfit / model.estimate.subtotal * 100) : '未確定';
      const costAlerts = [];
      if (model.costFloor.message) costAlerts.push(alertHtml(model.costFloor.message, model.costFloor.status === 'invalid' ? 'danger' : 'warn'));
      if (state.cost.overheadRate === null) costAlerts.push(alertHtml('間接費率は未設定です。算定時は0％として扱われます。所内基準を確認してください。', 'warn'));
      $('cost-alerts').innerHTML = costAlerts.join('');
      const decisionAlerts = [];
      if (!model.recommendation) decisionAlerts.push(alertHtml('原価下限が未確定のため、推奨月次顧問料は確定していません。最終額は担当者が判断してください。', 'warn'));
      if (model.recommendation && model.recommendation.exceptionReasonRequired && !model.recommendation.exceptionReasonProvided) decisionAlerts.push(alertHtml('最終月次顧問料が基準条件から外れるため、例外理由が必要です。', 'danger'));
      $('decision-alerts').innerHTML = decisionAlerts.join('');
      renderComparison();
    }
    renderValidation();
    renderPrintDocuments();
  }

  function renderComparison() {
    const comparison = model.comparison;
    $('standard-annual-fee').textContent = model.estimate.status === 'calculated' ? yen(model.estimate.subtotal) : '—';
    $('current-annual-summary').textContent = comparison.status === 'calculated' ? yen(comparison.currentAnnualFee) : '—';
    $('annual-difference').textContent = comparison.status === 'calculated' ? yen(comparison.annualDifference) : '—';
    $('revision-rate').textContent = comparison.status === 'calculated' && Number.isFinite(comparison.revisionRatePercent) ? percent(comparison.revisionRatePercent) : '—';
    $('monthly-difference').textContent = comparison.status === 'calculated' ? yen(comparison.monthlyDifference) : '—';
    $('revision-warning').classList.toggle('hidden', !(comparison.status === 'calculated' && comparison.largeRevisionWarning));
    renderPhasePlan();
  }

  function rebuildPhases() {
    const result = core.buildPhasedRevision({ currentMonthlyFee: numberOrZero(state.comparison.currentMonthlyFee), targetMonthlyFee: numberOrZero(state.decision.finalMonthlyFee), steps: Number(state.comparison.steps), startDate: state.comparison.revisionDate || state.document.startDate });
    state.comparison.phases = result.status === 'calculated' ? result.phases : [];
  }

  function renderPhasePlan() {
    const host = $('phase-plan');
    if (!state.comparison.phases.length) rebuildPhases();
    host.innerHTML = '<div class="mini">段階額は均等差額による参考値です。自動確定されません。各段階の金額・適用時期を編集してください。</div>';
    state.comparison.phases.forEach((phase, index) => {
      const row = document.createElement('div');
      row.className = 'phase-row';
      row.innerHTML = '<b>第' + (index + 1) + '段階</b><label class="field"><span class="field-name">月額</span><input type="text" inputmode="numeric" data-money></label><label class="field"><span class="field-name">適用時期</span><input type="date"></label>';
      const amount = row.querySelector('[data-money]');
      const date = row.querySelector('input[type="date"]');
      amount.value = formatNumber(phase.amount);
      date.value = phase.effectiveDate || '';
      amount.addEventListener('input', () => { phase.amount = parseNumber(amount.value); state.decision.exceptionReason = Number(state.comparison.steps) > 1 ? '段階改定' : state.decision.exceptionReason; saveState(); });
      date.addEventListener('input', () => { phase.effectiveDate = date.value; saveState(); });
      host.appendChild(row);
    });
  }

  function quoteLines() {
    const lines = [];
    const estimate = model.estimate;
    if (!estimate || estimate.status !== 'calculated') return lines;
    if (state.entity === 'income') {
      selectedIncomeLines().forEach((line) => lines.push({ name: line.name, unit: yen(line.amount), quantity: line.quantity, annual: line.amount * line.quantity }));
      return lines;
    }
    const fee = numberOrZero(state.decision.finalMonthlyFee);
    if (fee > 0) lines.push({ name: '月次顧問料', unit: yen(fee) + '／月', quantity: 12, annual: fee * 12 });
    selectedSoftware().forEach((item) => lines.push({ name: item.name, unit: yen(item.monthlyBillingPrice) + '／月', quantity: 12, annual: item.monthlyBillingPrice * 12 }));
    const b = estimate.breakdown;
    if (b.corporateClosingFee) lines.push({ name: '法人決算・申告一式', unit: yen(b.corporateClosingFee), quantity: 1, annual: b.corporateClosingFee });
    if (b.soleClosingFee) lines.push({ name: '所得税決算・確定申告一式', unit: yen(b.soleClosingFee), quantity: 1, annual: b.soleClosingFee });
    if (b.consumptionTaxReturnFee) lines.push({ name: '消費税申告書作成', unit: yen(b.consumptionTaxReturnFee), quantity: 1, annual: b.consumptionTaxReturnFee });
    if (b.yearEndAdjustmentFee) lines.push({ name: '年末調整・源泉徴収票等', unit: yen(b.yearEndAdjustmentFee), quantity: 1, annual: b.yearEndAdjustmentFee });
    if (b.depreciableAssetsFee) lines.push({ name: '償却資産税申告', unit: yen(b.depreciableAssetsFee), quantity: state.services.assetTaxCount, annual: b.depreciableAssetsFee });
    if (b.otherAnnualFee) lines.push({ name: state.services.otherSpotName || 'その他年次・スポット報酬', unit: yen(b.otherAnnualFee), quantity: 1, annual: b.otherAnnualFee });
    if (b.annualAdjustmentAmount) lines.push({ name: '年間調整', unit: yen(b.annualAdjustmentAmount), quantity: 1, annual: b.annualAdjustmentAmount });
    return lines;
  }

  function renderPrintDocuments() {
    const estimate = model.estimate;
    const office = officePresets[state.document.office] || officePresets.kobe;
    $('print-client').textContent = state.document.clientName || '宛名未入力';
    $('print-suffix').textContent = state.entity === 'corp' ? '御中' : '様';
    $('print-date').textContent = displayDate(state.document.quoteDate);
    $('print-number').textContent = state.document.quoteNumber;
    $('print-office').textContent = office.branch;
    $('print-address').textContent = office.address;
    $('print-tel').textContent = office.tel;
    $('print-representative').textContent = office.representative;
    $('print-start-date').textContent = displayDate(state.document.startDate);
    $('print-scope').textContent = state.document.scope || '';
    $('print-notes').textContent = state.document.notes || '';
    $('print-total').textContent = estimate && estimate.status === 'calculated' ? yen(estimate.total) + '（税込）' : '未確定';
    $('quote-rows').innerHTML = quoteLines().map((line) => '<tr><td>' + escapeHtml(line.name) + '</td><td>' + escapeHtml(line.unit) + '</td><td>' + escapeHtml(line.quantity) + '</td><td class="money">' + yen(line.annual) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty-state">見積項目がありません</td></tr>';
    $('quote-totals').innerHTML = estimate && estimate.status === 'calculated' ? '<tr><th>小計</th><td class="money">' + yen(estimate.subtotal) + '</td></tr><tr><th>消費税 ' + (config.taxRate * 100) + '%</th><td class="money">' + yen(estimate.consumptionTax) + '</td></tr><tr><th>税込合計</th><td class="money"><b>' + yen(estimate.total) + '</b></td></tr>' : '';
    $('reference-entity').textContent = entityLabels[state.entity];
    $('reference-months').textContent = state.entity === 'income' ? '該当なし' : state.fiscalMonths + 'か月';
    $('reference-period-value').textContent = model.valueResult && model.valueResult.status === 'calculated' ? yen(model.valueResult.value) : '—';
    $('reference-annualized-value').textContent = model.annualized && model.annualized.status === 'calculated' ? yen(model.annualized.annualizedValue) : '—';
    $('internal-price-version').textContent = config.priceMaster.priceTableVersion;
    $('internal-effective-date').textContent = config.priceMaster.effectiveDate || '所内設定が必要';
    renderInternalSheets();
  }

  function tableRows(rows) {
    return rows.map((row) => '<tr><th>' + escapeHtml(row[0]) + '</th><td class="money">' + escapeHtml(row[1]) + '</td></tr>').join('');
  }

  function renderInternalSheets() {
    if (state.entity === 'income') {
      $('internal-summary').innerHTML = tableRows([['区分', '単発の所得税確定申告'], ['年間見積額', model.estimate.status === 'calculated' ? yen(model.estimate.subtotal) : '未確定']]);
      $('internal-adjustments').innerHTML = '<tr><td colspan="3">対象外</td></tr>';
      $('internal-comparison').innerHTML = '<tr><td>対象外</td></tr>';
      $('internal-cost-summary').innerHTML = '<tr><td>対象外</td></tr>';
      $('internal-hours').innerHTML = '';
      return;
    }
    const recommendation = model.recommendation;
    const rows = [
      ['区分', entityLabels[state.entity]],
      ['入力期間の付加価値額', model.valueResult.status === 'calculated' ? yen(model.valueResult.value) : '未確定'],
      ['12か月換算後の付加価値額', model.annualized.status === 'calculated' ? yen(model.annualized.annualizedValue) : '未確定'],
      ['料金帯', model.bandResult.label || '未確定'],
      ['付加価値帯による基準額', model.bandResult.status === 'calculated' ? yen(model.bandResult.fee) : '別途お見積り'],
      ['業務量・複雑性調整額', yen(model.adjustmentResult.monthlyAdjustmentAmount) + '／月'],
      ['付加価値・業務内容基準額', recommendation ? yen(recommendation.basisAmount) : '未確定'],
      ['原価下限月額', model.costFloor.status === 'calculated' ? yen(model.costFloor.monthlyCostFloor) : '未確定'],
      ['推奨月次顧問料', recommendation ? yen(recommendation.recommendedMonthlyFee) : '未確定'],
      ['最終月次顧問料', Number.isFinite(state.decision.finalMonthlyFee) ? yen(state.decision.finalMonthlyFee) : '未確定'],
      ['事業主本人の労働対価相当額', state.entity === 'sole' ? yen(state.ownerLaborCompensation) : '対象外'],
      ['例外理由', (state.decision.exceptionReason + ' ' + state.decision.exceptionMemo).trim() || 'なし']
    ];
    $('internal-summary').innerHTML = tableRows(rows);
    const selected = Object.values(state.adjustments).filter((item) => item.selected);
    $('internal-adjustments').innerHTML = selected.map((item) => '<tr><td>' + escapeHtml(item.category + '／' + item.label) + '</td><td class="money">' + yen(item.monthlyAmount) + '</td><td>' + escapeHtml(item.memo || '') + '</td></tr>').join('') || '<tr><td colspan="3">該当項目なし</td></tr>';
    const comparisonRows = [
      ['現行月次顧問料', yen(state.comparison.currentMonthlyFee)],
      ['現行決算報酬', yen(state.comparison.currentClosingFee)],
      ['現行消費税報酬', yen(state.comparison.currentConsumptionTaxFee)],
      ['現行年間報酬', model.comparison.status === 'calculated' ? yen(model.comparison.currentAnnualFee) : '—'],
      ['標準年間報酬', model.estimate.status === 'calculated' ? yen(model.estimate.subtotal) : '—'],
      ['年間差額', model.comparison.status === 'calculated' ? yen(model.comparison.annualDifference) : '—'],
      ['改定率', Number.isFinite(model.comparison.revisionRatePercent) ? percent(model.comparison.revisionRatePercent) : '—']
    ];
    state.comparison.phases.forEach((phase, index) => comparisonRows.push(['第' + (index + 1) + '段階', yen(phase.amount) + '／' + (displayDate(phase.effectiveDate) || '時期未設定')]));
    $('internal-comparison').innerHTML = tableRows(comparisonRows);
    $('internal-cost-summary').innerHTML = tableRows([
      ['年間直接原価', Number.isFinite(model.costFloor.annualDirectCost) ? yen(model.costFloor.annualDirectCost) : '未確定'],
      ['必要年間売上', Number.isFinite(model.costFloor.requiredAnnualRevenue) ? yen(model.costFloor.requiredAnnualRevenue) : '未確定'],
      ['非月次顧問売上', Number.isFinite(model.costFloor.nonMonthlyRevenue) ? yen(model.costFloor.nonMonthlyRevenue) : '未確定'],
      ['原価下限月額', Number.isFinite(model.costFloor.monthlyCostFloor) ? yen(model.costFloor.monthlyCostFloor) : '未確定'],
      ['目標利益率', state.cost.targetProfitRate === null ? '未設定' : percent(Number(state.cost.targetProfitRate))],
      ['間接費率', state.cost.overheadRate === null ? '未設定' : percent(Number(state.cost.overheadRate))],
      ['ソフトウェア直接原価', model.costFloor.reason === 'software_direct_cost_missing' ? '未設定' : (Number.isFinite(model.costFloor.annualSoftwareDirectCost) ? yen(model.costFloor.annualSoftwareDirectCost) + '／年' : '—')]
    ]);
    $('internal-hours').innerHTML = Object.keys(roleLabels).map((role) => '<tr><td>' + roleLabels[role] + '</td><td class="money">' + yen(state.cost.rates[role]) + '／時</td><td class="money">' + state.cost.monthlyHours[role] + '</td><td class="money">' + state.cost.annualHours[role] + '</td></tr>').join('');
  }

  function renderValidation() {
    const validation = buildValidation();
    model.validation = validation;
    $('validation-count').textContent = validation.allowed ? '出力可能' : validation.errors.length + '件の確認事項';
    $('validation-errors').innerHTML = validation.allowed ? alertHtml('顧客向け出力の必須チェックを満たしています。', 'ok') : validation.errors.map((error) => alertHtml(error.message, 'danger')).join('');
    $('customer-print-button').disabled = !validation.allowed;
    $('internal-print-button').disabled = !(model.estimate && model.estimate.status === 'calculated' && model.estimate.subtotal !== 0);
  }

  function applyOutputMode(mode) {
    document.body.classList.remove('output-customer-only', 'output-customer-reference', 'output-internal');
    document.body.classList.add('output-' + mode);
  }

  function recalculate() {
    model = calculateAll();
    renderCalculations();
    saveState();
  }

  function preview() {
    state.previewVisible = true;
    $('print-area').classList.remove('hidden');
    applyOutputMode(state.document.outputType);
    renderPrintDocuments();
    saveState();
    $('print-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function printDocument(internal) {
    model = calculateAll();
    renderCalculations();
    if (!internal) {
      const validation = buildValidation();
      if (!validation.allowed) {
        window.alert('顧客向け出力を実行できません。\n\n' + validation.errors.map((error) => '・' + error.message).join('\n'));
        return;
      }
      if (state.document.outputType === 'internal') {
        state.document.outputType = 'customer-only';
        $('output-type').value = 'customer-only';
      }
    } else {
      state.document.outputType = 'internal';
      $('output-type').value = 'internal';
    }
    state.previewVisible = true;
    $('print-area').classList.remove('hidden');
    applyOutputMode(state.document.outputType);
    renderPrintDocuments();
    saveState();
    window.print();
  }

  function handleBeforePrint() {
    model = calculateAll();
    renderPrintDocuments();
    const internal = state.document.outputType === 'internal';
    const blocked = !internal && !buildValidation().allowed;
    $('print-area').classList.toggle('print-blocked', blocked);
    if (!blocked) $('print-area').classList.remove('hidden');
  }

  function handleAfterPrint() {
    $('print-area').classList.remove('print-blocked');
    if (!state.previewVisible) $('print-area').classList.add('hidden');
  }

  function resetTool() {
    if (!window.confirm('この見積ツールの入力内容を初期化します。他のツールの保存内容は削除しません。よろしいですか？')) return;
    config.storageKeys.all.forEach((key) => localStorage.removeItem(key));
    state = baseState();
    window.location.reload();
  }

  function bindStaticInputs() {
    qsa('[data-entity]').forEach((button) => button.addEventListener('click', () => setEntity(button.dataset.entity)));
    setDocumentFields();
    $('period-months').value = state.fiscalMonths;
    $('period-months').addEventListener('input', () => { state.fiscalMonths = Number($('period-months').value); state.decision.finalFeeConfirmed = false; recalculate(); });
    bindMoneyInput($('owner-labor'), () => state.ownerLaborCompensation, (value) => { state.ownerLaborCompensation = value; state.decision.finalFeeConfirmed = false; });
    $('corp-closing').checked = state.services.corporateClosingSelected;
    $('corp-closing').addEventListener('change', () => {
      state.services.corporateClosingSelected = $('corp-closing').checked;
      if (state.services.corporateClosingSelected) state.services.corporateReturnNotEngagedConfirmed = false;
      $('corp-closing-waiver-row').classList.toggle('hidden', state.services.corporateClosingSelected || state.entity !== 'corp');
      recalculate();
    });
    $('corp-closing-waiver').checked = state.services.corporateReturnNotEngagedConfirmed;
    $('corp-closing-waiver').addEventListener('change', () => { state.services.corporateReturnNotEngagedConfirmed = $('corp-closing-waiver').checked; recalculate(); });
    $('sole-closing').checked = state.services.soleClosingSelected;
    $('sole-closing').addEventListener('change', () => {
      state.services.soleClosingSelected = $('sole-closing').checked;
      if (state.services.soleClosingSelected) state.services.soleReturnNotEngagedConfirmed = false;
      $('sole-closing-waiver-row').classList.toggle('hidden', state.services.soleClosingSelected || state.entity !== 'sole');
      recalculate();
    });
    $('sole-closing-waiver').checked = state.services.soleReturnNotEngagedConfirmed;
    $('sole-closing-waiver').addEventListener('change', () => { state.services.soleReturnNotEngagedConfirmed = $('sole-closing-waiver').checked; recalculate(); });
    $('consumption-tax-status').value = currentConsumptionTaxStatus();
    $('consumption-tax-status').addEventListener('change', () => { setCurrentConsumptionTaxStatus($('consumption-tax-status').value); recalculate(); });
    $('year-end-base').checked = state.services.yearEndSelected;
    $('year-end-base').addEventListener('change', () => { state.services.yearEndSelected = $('year-end-base').checked; recalculate(); });
    $('year-end-count').value = state.services.yearEndCount;
    $('year-end-count').addEventListener('input', () => { state.services.yearEndCount = Math.max(0, Math.floor(numberOrZero($('year-end-count').value))); recalculate(); });
    $('asset-tax').checked = state.services.assetTaxSelected;
    $('asset-tax').addEventListener('change', () => { state.services.assetTaxSelected = $('asset-tax').checked; recalculate(); });
    $('asset-tax-count').value = state.services.assetTaxCount;
    $('asset-tax-count').addEventListener('input', () => { state.services.assetTaxCount = Math.max(1, Math.floor(numberOrZero($('asset-tax-count').value))); recalculate(); });
    $('year-end-scope').textContent = config.services.yearEndAdjustment.scope.join('、') + '（実際の所内業務範囲は設定で編集）';
    bindText('custom-software-name', state.services.customSoftware, 'name');
    bindMoneyInput($('custom-software-price'), () => state.services.customSoftware.monthlyBillingPrice, (value) => { state.services.customSoftware.monthlyBillingPrice = value; });
    bindMoneyInput($('custom-software-cost'), () => state.services.customSoftware.monthlyDirectCost, (value) => { state.services.customSoftware.monthlyDirectCost = value; });
    $('custom-software-selected').checked = state.services.customSoftware.selected;
    $('custom-software-selected').addEventListener('change', () => { state.services.customSoftware.selected = $('custom-software-selected').checked; recalculate(); });
    bindText('other-spot-name', state.services, 'otherSpotName');
    bindMoneyInput($('other-spot-fee'), () => state.services.otherSpotFee, (value) => { state.services.otherSpotFee = value; }, { allowNull: false });
    bindMoneyInput($('annual-adjustment'), () => state.services.annualAdjustment, (value) => { state.services.annualAdjustment = value; }, { allowNull: false });
    $('target-margin').value = state.cost.targetProfitRate === null ? '' : state.cost.targetProfitRate;
    $('target-margin').addEventListener('input', () => { state.cost.targetProfitRate = parseNumber($('target-margin').value); recalculate(); });
    $('overhead-rate').value = state.cost.overheadRate === null ? '' : state.cost.overheadRate;
    $('overhead-rate').addEventListener('input', () => { state.cost.overheadRate = parseNumber($('overhead-rate').value); recalculate(); });
    bindMoneyInput($('other-direct-cost'), () => state.cost.otherAnnualDirectCost, (value) => { state.cost.otherAnnualDirectCost = value; }, { allowNull: false });
    bindMoneyInput($('final-monthly-fee'), () => state.decision.finalMonthlyFee, (value) => { state.decision.finalMonthlyFee = value; state.decision.finalFeeConfirmed = Number.isFinite(value) && value > 0; state.decision.confirmationSource = 'manual'; rebuildPhases(); });
    $('exception-reason').value = state.decision.exceptionReason;
    $('exception-reason').addEventListener('change', () => { state.decision.exceptionReason = $('exception-reason').value; recalculate(); });
    bindText('exception-memo', state.decision, 'exceptionMemo');
    const comparisonMoneyFields = {
      'current-monthly-fee': 'currentMonthlyFee', 'current-closing-fee': 'currentClosingFee', 'current-consumption-fee': 'currentConsumptionTaxFee', 'current-annual-fee': 'currentAnnualFee'
    };
    Object.entries(comparisonMoneyFields).forEach(([id, key]) => bindMoneyInput($(id), () => state.comparison[key], (value) => { state.comparison[key] = value; rebuildPhases(); }));
    $('revision-date').value = state.comparison.revisionDate;
    $('revision-date').addEventListener('input', () => { state.comparison.revisionDate = $('revision-date').value; rebuildPhases(); recalculate(); });
    $('revision-stages').value = String(state.comparison.steps);
    $('revision-stages').addEventListener('change', () => { state.comparison.steps = Number($('revision-stages').value); rebuildPhases(); recalculate(); });
    $('adopt-standard').addEventListener('click', () => {
      if (!model.bandResult || !Number.isFinite(model.bandResult.fee)) return window.alert('標準額を自動算定できません。最終月次顧問料を手入力してください。');
      state.decision.finalMonthlyFee = model.bandResult.fee;
      state.decision.finalFeeConfirmed = true;
      state.decision.confirmationSource = 'standard';
      $('final-monthly-fee').value = formatNumber(state.decision.finalMonthlyFee);
      rebuildPhases();
      recalculate();
    });
    $('adopt-recommended').addEventListener('click', () => {
      if (!model.recommendation || !Number.isFinite(model.recommendation.recommendedMonthlyFee)) return window.alert('原価下限等が未確定のため、推奨額を採用できません。');
      state.decision.finalMonthlyFee = model.recommendation.recommendedMonthlyFee;
      state.decision.finalFeeConfirmed = true;
      state.decision.confirmationSource = 'recommended';
      $('final-monthly-fee').value = formatNumber(state.decision.finalMonthlyFee);
      rebuildPhases();
      recalculate();
    });
    $('preview-button').addEventListener('click', preview);
    $('customer-print-button').addEventListener('click', () => printDocument(false));
    $('internal-print-button').addEventListener('click', () => printDocument(true));
    $('reset-button').addEventListener('click', resetTool);
  }

  function init() {
    document.title = '松本会計｜標準報酬算定ツール ' + config.appVersion;
    qsa('[data-app-version]').forEach((node) => { node.textContent = config.appVersion; });
    $('price-version-header').textContent = config.priceMaster.priceTableVersion;
    $('effective-date-header').textContent = config.priceMaster.effectiveDate || '所内設定が必要';
    renderAdjustments();
    renderSoftware();
    renderIncomeServices();
    renderCostRows();
    bindStaticInputs();
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    applyOutputMode(state.document.outputType);
    initializing = false;
    setEntity(state.entity);
    if (state.previewVisible) $('print-area').classList.remove('hidden');
  }

  init();
})();
