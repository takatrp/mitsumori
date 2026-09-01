(function () {
  'use strict';

  const config = window.MitsumoriPricingConfig;
  const core = window.MitsumoriPricingCore;
  if (!config || !core) throw new Error('料金設定又は計算処理を読み込めませんでした。');

  const $ = (id) => document.getElementById(id);
  const qsa = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const entityLabels = { corp: '法人', sole: '個人', income: '所得税確定申告' };
  const roleLabels = { playing: 'プレイング', manager: '管理者', executive: '経営者' };
  const interactionModeDescriptions = {
    internal: '所内で標準報酬、原価、利益率まで確認しています。「ノーマルモードに戻る」を押すと対面用の画面へ戻ります。',
    principal: 'ノーマルモードと同じ画面で金額を一緒に確認し、印刷・PDF時だけ所長パスワードで承認を代替するモードです。社内原価・利益率は表示しません。',
    prospect: '画面を一緒に見ながら算定根拠と受託業務を確認するモードです。社内原価・利益率は表示しません。'
  };
  const defaultActionModeNote = '顧客向け出力には社内原価・利益率・例外理由を含めません。';
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

  function diagramYen(value, fallback) {
    if (!Number.isFinite(value)) return fallback || '未入力';
    return value < 0 ? '−' + yen(Math.abs(value)) : yen(value);
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

  function baseState(preferencesInput) {
    const preferences = preferencesInput || {};
    return {
      entity: 'corp',
      interactionMode: 'prospect',
      document: { clientName: '', quoteDate: localToday(), quoteNumber: '', startDate: '', office: preferences.office || 'kobe', outputType: 'customer-only', scope: '', notes: '' },
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
        otherSpotSelected: false,
        annualAdjustment: 0,
        software: initialSoftware(),
        customSoftware: { id: 'custom', name: '', selected: false, quantity: 1, monthlyBillingPrice: null, monthlyDirectCost: null },
        income: initialIncomeServices()
      },
      cost: {
        rates: Object.assign({}, config.standardCostRates, preferences.standardCostRates || {}),
        monthlyHours: { playing: 0, manager: 0, executive: 0 },
        annualHours: { playing: 0, manager: 0, executive: 0 },
        targetProfitRate: null,
        overheadRate: null,
        otherAnnualDirectCost: 0
      },
      decision: { finalMonthlyFee: null, finalFeeConfirmed: false, confirmationSource: '', exceptionReason: '', exceptionMemo: '', costFloorExceptionReason: '', costFloorExceptionMemo: '' },
      approval: { status: 'unapproved', approvedBy: '', approvedAt: '', approvalNote: '', approvalFingerprint: '', approvalSource: '', invalidatedByChange: false },
      comparison: { currentMonthlyFee: 0, currentClosingFee: 0, currentConsumptionTaxFee: 0, currentAnnualFee: null, revisionDate: '', steps: 1, phases: [] },
      preferences: { internalModeTimeoutMinutes: Number.isFinite(Number(preferences.internalModeTimeoutMinutes)) ? Number(preferences.internalModeTimeoutMinutes) : config.internalModeTimeoutMinutes },
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
    merged.approval = Object.assign({}, defaults.approval, stored.approval || {});
    merged.comparison = Object.assign({}, defaults.comparison, stored.comparison || {});
    merged.preferences = Object.assign({}, defaults.preferences, stored.preferences || {});
    if (!['corp', 'sole', 'income'].includes(merged.entity)) merged.entity = 'corp';
    // 画面を開いた時は必ずノーマル表示から開始し、所内詳細はその都度明示操作で開く。
    merged.interactionMode = 'prospect';
    const storedServices = stored.services || {};
    if (!Object.prototype.hasOwnProperty.call(storedServices, 'otherSpotSelected')) {
      merged.services.otherSpotSelected = Number.isFinite(Number(storedServices.otherSpotFee)) && Number(storedServices.otherSpotFee) !== 0;
    } else {
      merged.services.otherSpotSelected = storedServices.otherSpotSelected === true;
    }
    return merged;
  }

  function parseStoredJson(storage, key) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function loadPreferences() {
    const stored = parseStoredJson(localStorage, config.storageKeys.preferences) || {};
    return {
      office: ['kobe', 'sakaiminato'].includes(stored.office) ? stored.office : 'kobe',
      standardCostRates: Object.assign({}, config.standardCostRates, stored.standardCostRates || {}),
      internalModeTimeoutMinutes: Number.isFinite(Number(stored.internalModeTimeoutMinutes)) && Number(stored.internalModeTimeoutMinutes) > 0
        ? Number(stored.internalModeTimeoutMinutes)
        : config.internalModeTimeoutMinutes
    };
  }

  function applyLegacyCostState(target, legacyCost) {
    if (!legacyCost || typeof legacyCost !== 'object') return target;
    const legacyRates = legacyCost.rates || {};
    const legacyHours = legacyCost.hours || {};
    const roleMap = { playing: 'play', manager: 'mgr', executive: 'exec' };
    Object.keys(roleMap).forEach((role) => {
      const rate = parseNumber(legacyRates[roleMap[role]]);
      const hours = parseNumber(legacyHours[roleMap[role]]);
      if (Number.isFinite(rate) && rate >= 0) target.cost.rates[role] = rate;
      if (Number.isFinite(hours) && hours >= 0) target.cost.monthlyHours[role] = hours;
    });
    return target;
  }

  function readLegacyCandidate(defaults) {
    const storedState = parseStoredJson(localStorage, config.storageKeys.state);
    if (storedState) return mergeStored(defaults, storedState);
    const legacyCost = parseStoredJson(localStorage, config.storageKeys.legacyCostState);
    if (legacyCost) return applyLegacyCostState(defaults, legacyCost);
    return null;
  }

  const devicePreferences = loadPreferences();
  let pendingRecovery = null;
  function loadState() {
    const defaults = baseState(devicePreferences);
    const sessionDraft = parseStoredJson(sessionStorage, config.storageKeys.sessionQuote);
    const restoreOnce = sessionStorage.getItem(config.storageKeys.restoreOnce);
    if (restoreOnce === 'session' && sessionDraft) {
      sessionStorage.removeItem(config.storageKeys.restoreOnce);
      return mergeStored(defaults, sessionDraft);
    }
    if (sessionDraft) {
      pendingRecovery = { type: 'session', data: sessionDraft };
      return defaults;
    }
    const legacyDraft = readLegacyCandidate(defaults);
    if (legacyDraft) {
      pendingRecovery = { type: 'legacy', data: legacyDraft };
      return defaults;
    }
    return defaults;
  }

  let state = loadState();
  let model = {};
  let initializing = true;
  let principalPrintAuthorizationFingerprint = '';
  let principalPrintAuthorizationTimer = null;
  let pendingPrincipalPrint = null;

  function saveState() {
    if (initializing || pendingRecovery) return;
    const approvalInvalidated = invalidateApprovalIfChanged();
    sessionStorage.setItem(config.storageKeys.sessionQuote, JSON.stringify(state));
    localStorage.setItem(config.storageKeys.preferences, JSON.stringify({
      office: state.document.office,
      standardCostRates: state.cost.rates,
      internalModeTimeoutMinutes: state.preferences.internalModeTimeoutMinutes
    }));
    if (approvalInvalidated) {
      renderApprovalPanel();
      renderValidation();
    }
  }

  function buildApprovalSnapshot() {
    const sortedAdjustments = Object.values(state.adjustments).map((item) => ({
      id: item.id,
      selected: item.selected === true,
      monthlyAmount: item.monthlyAmount,
      memo: item.memo || ''
    })).sort((a, b) => a.id.localeCompare(b.id));
    const software = Object.values(state.services.software).concat([state.services.customSoftware]).map((item) => ({
      id: item.id,
      name: item.name || '',
      selected: item.selected === true,
      quantity: item.quantity,
      monthlyBillingPrice: item.monthlyBillingPrice
    })).sort((a, b) => a.id.localeCompare(b.id));
    const income = Object.values(state.services.income).map((item) => ({
      id: item.id,
      selected: item.selected === true,
      quantity: item.quantity,
      price: item.price,
      priceConfirmed: item.priceConfirmed === true
    })).sort((a, b) => a.id.localeCompare(b.id));
    return {
      clientName: state.document.clientName,
      entity: state.entity,
      valueValues: state.valueValues,
      fiscalMonths: state.fiscalMonths,
      ownerLaborCompensation: state.ownerLaborCompensation,
      finalMonthlyFee: state.decision.finalMonthlyFee,
      finalFeeConfirmed: state.decision.finalFeeConfirmed,
      confirmationSource: state.decision.confirmationSource,
      adjustments: sortedAdjustments,
      services: {
        corporateClosingSelected: state.services.corporateClosingSelected,
        corporateReturnNotEngagedConfirmed: state.services.corporateReturnNotEngagedConfirmed,
        soleClosingSelected: state.services.soleClosingSelected,
        soleReturnNotEngagedConfirmed: state.services.soleReturnNotEngagedConfirmed,
        consumptionTaxStatusByEntity: state.services.consumptionTaxStatusByEntity,
        yearEndSelected: state.services.yearEndSelected,
        yearEndCount: state.services.yearEndCount,
        assetTaxSelected: state.services.assetTaxSelected,
        assetTaxCount: state.services.assetTaxCount,
        otherSpotName: state.services.otherSpotName,
        otherSpotFee: state.services.otherSpotFee,
        otherSpotSelected: state.services.otherSpotSelected,
        annualAdjustment: state.services.annualAdjustment,
        software,
        income
      },
      cost: {
        rates: state.cost.rates,
        monthlyHours: state.cost.monthlyHours,
        annualHours: state.cost.annualHours,
        targetProfitRate: state.cost.targetProfitRate,
        overheadRate: state.cost.overheadRate,
        otherAnnualDirectCost: state.cost.otherAnnualDirectCost
      },
      effectiveDate: state.document.startDate,
      scope: state.document.scope,
      notes: state.document.notes,
      exceptionReason: state.decision.exceptionReason,
      exceptionMemo: state.decision.exceptionMemo,
      costFloorExceptionReason: state.decision.costFloorExceptionReason,
      costFloorExceptionMemo: state.decision.costFloorExceptionMemo
    };
  }

  function currentApprovalFingerprint() {
    return core.calculateApprovalFingerprint(buildApprovalSnapshot());
  }

  function isPrincipalInputMode() {
    return state.interactionMode === 'principal';
  }

  function isPrincipalPrintAuthorized() {
    return isPrincipalInputMode()
      && principalPrintAuthorizationFingerprint !== ''
      && principalPrintAuthorizationFingerprint === currentApprovalFingerprint();
  }

  function clearPrincipalPrintAuthorization(shouldRender) {
    principalPrintAuthorizationFingerprint = '';
    if (principalPrintAuthorizationTimer) window.clearTimeout(principalPrintAuthorizationTimer);
    principalPrintAuthorizationTimer = null;
    if (shouldRender === true) renderPrintDocuments();
  }

  function invalidateApprovalIfChanged() {
    if (state.approval.status !== 'approved' || !state.approval.approvalFingerprint) return false;
    if (state.approval.approvalFingerprint === currentApprovalFingerprint()) return false;
    state.approval.status = 'unapproved';
    state.approval.invalidatedByChange = true;
    return true;
  }

  let internalIdleTimer = null;
  function stopInternalIdleTimer() {
    if (internalIdleTimer) window.clearTimeout(internalIdleTimer);
    internalIdleTimer = null;
  }

  function startInternalIdleTimer() {
    stopInternalIdleTimer();
    const minutes = Number(state.preferences.internalModeTimeoutMinutes) || config.internalModeTimeoutMinutes;
    internalIdleTimer = window.setTimeout(() => {
      setInteractionMode('prospect');
      $('mode-notice').textContent = '一定時間操作がなかったため、ノーマルモードへ戻りました。';
    }, Math.max(1, minutes) * 60 * 1000);
  }

  function handleInternalActivity() {
    if (state.interactionMode === 'internal') startInternalIdleTimer();
  }

  // 静的サイト上のアクセス制御ではなく、対面中に所内情報を誤表示しないための確認手順。
  function requestInternalMode() {
    $('internal-confirm-input').value = '';
    $('internal-confirm-error').classList.add('hidden');
    $('internal-confirm-dialog').showModal();
    $('internal-confirm-input').focus();
  }

  function confirmInternalMode() {
    const configuredCode = String(config.internalAccessConfirmationCode || '');
    const expected = configuredCode || config.internalDisplayConfirmationPhrase;
    if ($('internal-confirm-input').value !== expected) {
      $('internal-confirm-error').textContent = configuredCode ? '所内確認用コードが一致しません。' : '確認文「' + expected + '」を入力してください。';
      $('internal-confirm-error').classList.remove('hidden');
      return;
    }
    $('internal-confirm-dialog').close();
    setInteractionMode('internal');
  }

  function currentConsumptionTaxStatus() {
    const statuses = state.services.consumptionTaxStatusByEntity || {};
    return statuses[state.entity] || 'unconfirmed';
  }

  function setCurrentConsumptionTaxStatus(value) {
    if (!state.services.consumptionTaxStatusByEntity) state.services.consumptionTaxStatusByEntity = { corp: 'unconfirmed', sole: 'unconfirmed' };
    if (state.entity === 'corp' || state.entity === 'sole') state.services.consumptionTaxStatusByEntity[state.entity] = value;
  }

  function setInteractionMode(mode, shouldRecalculate) {
    if (!['internal', 'principal', 'prospect'].includes(mode)) return;
    if (mode !== 'principal') clearPrincipalPrintAuthorization(false);
    state.interactionMode = mode;
    document.body.classList.remove('mode-internal', 'mode-principal', 'mode-prospect');
    document.body.classList.add('mode-' + mode);
    const internalModeButton = $('internal-mode-toggle');
    const principalModeButton = $('principal-mode-toggle');
    const internal = mode === 'internal';
    const principal = mode === 'principal';
    const detailsVisible = internal;
    internalModeButton.classList.toggle('mode-active', internal);
    internalModeButton.setAttribute('aria-pressed', String(internal));
    internalModeButton.textContent = internal ? 'ノーマルモードに戻る' : '所内詳細';
    principalModeButton.classList.toggle('mode-active', principal);
    principalModeButton.setAttribute('aria-pressed', String(principal));
    principalModeButton.textContent = principal ? 'ノーマルモードに戻る' : '所長入力モード';
    $('mode-description').textContent = interactionModeDescriptions[mode];
    $('principal-mode-banner').classList.toggle('hidden', !principal);
    $('value-section-title').textContent = detailsVisible ? '1. 松本会計報酬算定上の付加価値額' : '付加価値算定プロセス';
    $('value-section-pill').textContent = internal ? '料金帯判定は12か月換算値' : '計算過程をその場で確認';
    $('band-table-summary').textContent = detailsVisible ? '現行の所内標準価格表を確認' : '標準報酬の区分を確認';
    $('service-section-title').textContent = internal ? '3. 受託業務・サービス' : 'お見積り内容の確認';
    $('service-section-pill').textContent = internal ? '既存価格を維持' : '選択内容を即時反映';
    $('year-end-scope').textContent = config.services.yearEndAdjustment.scope.join('、') + (detailsVisible ? '（実際の所内業務範囲は設定で編集）' : '');
    $('action-mode-note').textContent = principal ? '所長入力モード：印刷／PDFボタンを押した後、所長パスワードで出力を解除します。' : defaultActionModeNote;
    if (!internal && state.document.outputType !== 'customer-only') {
      state.document.outputType = 'customer-only';
      $('output-type').value = 'customer-only';
    }
    if (internal) {
      $('mode-notice').textContent = '';
      startInternalIdleTimer();
    } else {
      stopInternalIdleTimer();
      $('print-area').classList.add('hidden');
      state.previewVisible = false;
      if (shouldRecalculate !== false) {
        $('interaction-mode-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        (principal ? principalModeButton : internalModeButton).focus();
      }
    }
    applyOutputMode(state.document.outputType);
    if (shouldRecalculate !== false) recalculate(); else saveState();
  }

  function syncServiceSelectionControls() {
    $('corp-closing').checked = state.services.corporateClosingSelected;
    $('corp-closing-waiver').checked = state.services.corporateReturnNotEngagedConfirmed;
    $('sole-closing').checked = state.services.soleClosingSelected;
    $('sole-closing-waiver').checked = state.services.soleReturnNotEngagedConfirmed;
    $('consumption-tax-status').value = currentConsumptionTaxStatus();
    $('year-end-base').checked = state.services.yearEndSelected;
    $('asset-tax').checked = state.services.assetTaxSelected;
    $('custom-software-selected').checked = state.services.customSoftware.selected;
    $('other-spot-selected').checked = state.services.otherSpotSelected;
    $('corp-closing-waiver-row').classList.toggle('hidden', state.entity !== 'corp' || state.services.corporateClosingSelected);
    $('sole-closing-waiver-row').classList.toggle('hidden', state.entity !== 'sole' || state.services.soleClosingSelected);
    renderSoftware();
    renderIncomeServices();
  }

  function clearServiceSelections() {
    if (state.entity === 'income') {
      Object.values(state.services.income).forEach((item) => { item.selected = false; });
    } else {
      if (state.entity === 'corp') {
        state.services.corporateClosingSelected = false;
        state.services.corporateReturnNotEngagedConfirmed = false;
      } else {
        state.services.soleClosingSelected = false;
        state.services.soleReturnNotEngagedConfirmed = false;
      }
      setCurrentConsumptionTaxStatus('unconfirmed');
      state.services.yearEndSelected = false;
      state.services.assetTaxSelected = false;
      state.services.otherSpotSelected = false;
      Object.values(state.services.software).forEach((item) => { item.selected = false; });
      state.services.customSoftware.selected = false;
    }
    syncServiceSelectionControls();
    recalculate();
  }

  function caretPositionAfterMoneyFormat(formattedValue, logicalPosition) {
    if (logicalPosition <= 0) return 0;
    let consumed = 0;
    for (let index = 0; index < formattedValue.length; index += 1) {
      if (formattedValue[index] !== ',') consumed += 1;
      if (consumed >= logicalPosition) return index + 1;
    }
    return formattedValue.length;
  }

  function formatMoneyInputRealtime(event) {
    const input = event.target;
    if (event.isComposing || !input || !input.matches || !input.matches('input[data-money]')) return;
    const before = input.value;
    const formatted = core.formatMoneyInputText(before);
    if (formatted === before) return;
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    const logicalStart = selectionStart === null ? null : before.slice(0, selectionStart).replace(/,/g, '').length;
    const logicalEnd = selectionEnd === null ? null : before.slice(0, selectionEnd).replace(/,/g, '').length;
    input.value = formatted;
    if (logicalStart !== null && logicalEnd !== null && document.activeElement === input) {
      input.setSelectionRange(
        caretPositionAfterMoneyFormat(formatted, logicalStart),
        caretPositionAfterMoneyFormat(formatted, logicalEnd)
      );
    }
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

  function renderValueDiagram() {
    if (state.entity === 'income') return;
    const terms = config.valueAddedFields[state.entity].map((field) => ({
      label: field.label,
      value: state.valueValues[state.entity][field.key]
    }));
    if (state.entity === 'sole') {
      terms.push({ label: '事業主本人の労働対価相当額', value: state.ownerLaborCompensation });
    }
    $('value-diagram-terms').innerHTML = terms.map((term, index) => '<div class="value-term"><span class="value-term-name">' + escapeHtml(term.label) + '</span><strong class="value-term-amount">' + escapeHtml(diagramYen(term.value)) + '</strong></div>' + (index < terms.length - 1 ? '<span class="value-plus" aria-hidden="true">＋</span>' : '')).join('');

    const valueReady = model.valueResult && model.valueResult.status === 'calculated';
    const annualizedReady = model.annualized && model.annualized.status === 'calculated';
    const bandReady = model.bandResult && model.bandResult.status === 'calculated';
    $('value-diagram-period').textContent = valueReady ? diagramYen(model.valueResult.value) : '未確定';
    $('value-diagram-conversion').textContent = '× 12 ÷ ' + state.fiscalMonths + 'か月';
    $('value-diagram-annualized').textContent = annualizedReady ? diagramYen(model.annualized.annualizedValue) : '未確定';
    $('value-diagram-band').textContent = model.bandResult && model.bandResult.label ? model.bandResult.label : '判定前';
    $('value-diagram-fee').textContent = bandReady ? '月額基準：' + yen(model.bandResult.fee) : (model.bandResult && model.bandResult.status === 'manual_required' ? '月額基準：個別見積り' : '月額基準：判定前');
    const standardApplied = bandReady && state.decision.finalFeeConfirmed && state.decision.confirmationSource === 'standard' && state.decision.finalMonthlyFee === model.bandResult.fee;
    $('adopt-diagram-standard').disabled = !bandReady || standardApplied;
    $('adopt-diagram-standard').textContent = standardApplied ? '参考月額を反映済み' : '参考月額として反映';
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
      row.className = 'service-row software-row prospect-choice-row';
      row.dataset.softwareId = definition.id;
      row.innerHTML = '<label class="inline-check"><input type="checkbox"><span><b>' + escapeHtml(item.name) + '</b></span></label><span class="mini">月額</span><label class="field"><input type="text" inputmode="numeric" data-money aria-label="' + escapeHtml(item.name) + ' 月額料金"></label><label class="field internal-mode-only"><span class="field-name">月額直接原価</span><input type="text" inputmode="numeric" data-money placeholder="未設定"></label><span class="pill internal-mode-only" data-gross-profit>粗利益：未確定</span>';
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
      row.className = 'service-row prospect-choice-row';
      row.dataset.incomeServiceId = definition.id;
      row.innerHTML = '<label class="inline-check"><input type="checkbox"><span><b>' + escapeHtml(item.name) + '</b><br><span class="mini">' + escapeHtml(definition.note || '') + (definition.minimumPrice ? '（最低価格）' : '') + '</span></span></label><label class="field"><span class="field-name">数量</span><input type="number" min="1" step="1"></label><label class="field"><span class="field-name">単価</span><input type="text" inputmode="numeric" data-money ' + (definition.editable ? '' : 'readonly') + '></label>' + (definition.priceConfirmationRequired ? '<label class="inline-check"><input type="checkbox" data-confirm><span>単価を確認</span></label>' : '<span class="mini"><span class="internal-mode-only">所内標準価格</span><span class="prospect-only">表示単価</span></span>');
      const checkbox = row.querySelector('input[type="checkbox"]');
      const qtyInput = row.querySelector('input[type="number"]');
      const priceInput = row.querySelector('input[data-money]');
      const confirmInput = row.querySelector('input[data-confirm]');
      checkbox.checked = item.selected;
      qtyInput.value = item.quantity || 1;
      priceInput.value = formatNumber(item.price);
      if (confirmInput) confirmInput.checked = item.priceConfirmed;
      checkbox.addEventListener('change', () => {
        if (definition.pricingRole === 'base' && !checkbox.checked) {
          const dependency = core.validateIncomeTaxBaseRequirement({
            selectedItemIds: Object.values(state.services.income).filter((candidate) => candidate.selected && candidate.id !== definition.id).map((candidate) => candidate.id)
          });
          if (dependency.baseRequired) {
            item.selected = true;
            checkbox.checked = true;
            window.alert('加算項目が選択されているため、所得税確定申告基本報酬を外せません。');
            return;
          }
        }
        item.selected = checkbox.checked;
        if (item.selected && definition.requiresBase === true) {
          const baseDefinition = config.services.incomeTaxReturn.find((candidate) => candidate.pricingRole === 'base');
          if (baseDefinition) state.services.income[baseDefinition.id].selected = true;
          renderIncomeServices();
        }
        recalculate();
      });
      qtyInput.addEventListener('input', () => { item.quantity = Math.max(1, Math.floor(numberOrZero(qtyInput.value) || 1)); recalculate(); });
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
      lines.push({ amount: item.price, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)), frequency: 'annual', name: item.name, id: item.id, pricingRole: definition.pricingRole, requiresBase: definition.requiresBase });
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
      otherAnnualFee: state.services.otherSpotSelected ? numberOrZero(state.services.otherSpotFee) : 0,
      annualAdjustmentAmount: numberOrZero(state.services.annualAdjustment),
      taxRate: config.taxRate
    });
  }

  function calculateAll() {
    const adjustmentResult = core.calculateAdjustmentTotal(Object.values(state.adjustments));
    if (state.entity === 'income') {
      const estimate = computeAnnualEstimate(0);
      const comparison = core.calculateFeeDifference({ currentMonthlyFee: 0, proposedMonthlyFee: 0, currentAnnualFee: numberOrZero(state.comparison.currentAnnualFee), proposedAnnualFee: estimate.subtotal });
      return { adjustmentResult, valueResult: null, annualized: null, bandResult: null, boundary: null, costFloor: null, recommendation: null, profitStructure: null, estimate, comparison };
    }
    const valueResult = core.calculateValueAdded({ entityType: state.entity, values: state.valueValues[state.entity], ownerLaborCompensation: state.ownerLaborCompensation });
    const annualized = valueResult.status === 'calculated' ? core.annualizeValue(valueResult.value, Number(state.fiscalMonths)) : { status: 'invalid', annualizedValue: null, isShortPeriod: false, message: '' };
    const bandResult = annualized.status === 'calculated' ? core.determinePricingBand(state.entity, annualized.annualizedValue) : { status: 'invalid', fee: null, label: '', message: valueResult.message || annualized.message };
    const boundary = annualized.status === 'calculated' ? core.findBoundaryWarning(state.entity, annualized.annualizedValue, config.boundaryWarningRate) : { isNearBoundary: false };
    const costFloor = core.calculateCostFloor({
      entityType: state.entity,
      standardCostRates: state.cost.rates,
      monthlyHours: state.cost.monthlyHours,
      annualHours: state.cost.annualHours,
      otherAnnualDirectCost: state.cost.otherAnnualDirectCost,
      targetProfitRate: percentInputToRatio(state.cost.targetProfitRate),
      overheadRate: percentInputToRatio(state.cost.overheadRate),
      corporateClosingSelected: state.entity === 'corp' && state.services.corporateClosingSelected,
      soleClosingSelected: state.entity === 'sole' && state.services.soleClosingSelected,
      consumptionTaxStatus: currentConsumptionTaxStatus() === 'none' ? 'exempt' : currentConsumptionTaxStatus(),
      corporateClosingMultiplier: config.multipliers.corporateClosing,
      soleClosingMultiplier: config.multipliers.soleProprietorClosingAndReturn,
      consumptionTaxMultiplier: config.multipliers.consumptionTaxReturn,
      yearEndAdjustmentFee: yearEndFee(),
      depreciableAssetsFee: assetTaxFee(),
      otherAnnualSpotRevenue: state.services.otherSpotSelected ? numberOrZero(state.services.otherSpotFee) : 0,
      annualAdjustmentAmount: numberOrZero(state.services.annualAdjustment),
      softwareItems: selectedSoftware()
    });
    const recommendation = bandResult.status === 'calculated' && costFloor.status === 'calculated'
      ? core.calculateRecommendation({ bandResult, adjustmentAmount: adjustmentResult.monthlyAdjustmentAmount, costFloorResult: costFloor, finalMonthlyFee: state.decision.finalMonthlyFee, exceptionReason: (state.decision.exceptionReason + ' ' + state.decision.exceptionMemo).trim(), usesPhasedRevision: Number(state.comparison.steps) > 1 })
      : null;
    const estimate = computeAnnualEstimate(state.decision.finalMonthlyFee);
    const profitStructure = core.calculateProfitStructure({
      annualRevenue: estimate && estimate.subtotal,
      annualDirectCost: costFloor && costFloor.annualDirectCost,
      overheadRate: percentInputToRatio(state.cost.overheadRate),
      targetProfitRate: percentInputToRatio(state.cost.targetProfitRate)
    });
    const currentAnnualInput = Number.isFinite(state.comparison.currentAnnualFee) ? state.comparison.currentAnnualFee : undefined;
    const comparison = core.calculateFeeDifference({
      currentMonthlyFee: state.comparison.currentMonthlyFee,
      currentClosingFee: state.comparison.currentClosingFee,
      currentConsumptionTaxFee: state.comparison.currentConsumptionTaxFee,
      currentAnnualFee: currentAnnualInput,
      proposedMonthlyFee: numberOrZero(state.decision.finalMonthlyFee),
      proposedAnnualFee: estimate.subtotal
    });
    return { adjustmentResult, valueResult, annualized, bandResult, boundary, costFloor, recommendation, profitStructure, estimate, comparison };
  }

  function buildValidation(options) {
    const settings = Object.assign({ ignoreApproval: false }, options || {});
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
    const incomeBaseRequirement = core.validateIncomeTaxBaseRequirement({
      selectedItemIds: Object.values(state.services.income).filter((item) => item.selected).map((item) => item.id)
    });
    const fingerprint = currentApprovalFingerprint();
    const approvalChanged = state.approval.invalidatedByChange === true
      || (state.approval.status === 'approved' && state.approval.approvalFingerprint !== fingerprint);
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
      incomeBaseRequirementValid: incomeBaseRequirement.valid,
      consumptionTaxStatus: currentConsumptionTaxStatus() === 'none' ? 'exempt' : currentConsumptionTaxStatus(),
      annualTotal: model.estimate && model.estimate.subtotal,
      pricingBandStatus: model.bandResult && model.bandResult.status,
      bandResult: model.bandResult,
      boundaryWarning: Boolean(model.boundary && model.boundary.isNearBoundary),
      finalFeeConfirmed: state.decision.finalFeeConfirmed,
      specialServices,
      renderedText,
      approvalStatus: settings.ignoreApproval ? 'approved' : state.approval.status,
      approvalFingerprint: settings.ignoreApproval ? fingerprint : state.approval.approvalFingerprint,
      currentApprovalFingerprint: fingerprint,
      approvalChanged: settings.ignoreApproval ? false : approvalChanged
    });
    const errors = result.errors.slice();
    const add = (code, message) => { if (!errors.some((error) => error.code === code)) errors.push({ code, message }); };
    if (state.entity !== 'income' && model.recommendation && model.recommendation.exceptionReasonRequired && !model.recommendation.exceptionReasonProvided) add('exception_reason_missing', '基準額・原価下限・推奨額との乖離について例外理由を入力してください。');
    if (state.entity !== 'income' && !model.recommendation && Number.isFinite(state.decision.finalMonthlyFee) && model.bandResult && Number.isFinite(model.bandResult.fee) && state.decision.finalMonthlyFee < model.bandResult.fee && !(state.decision.exceptionReason + state.decision.exceptionMemo).trim()) add('exception_reason_missing', '最終月次顧問料が付加価値帯基準額を下回るため、例外理由を入力してください。');
    if (state.entity !== 'income' && model.adjustmentResult.status === 'invalid') add('invalid_adjustment_amount', '業務量・複雑性の調整額を数値で入力してください。');
    if (state.entity !== 'income' && model.costFloor.status !== 'calculated' && !(state.decision.costFloorExceptionReason && state.decision.costFloorExceptionMemo.trim())) add('cost_floor_exception_missing', '原価下限が未確定です。所内詳細で「原価下限未確認」の例外理由と詳細メモを入力してください。');
    if (!state.document.scope.trim()) add('scope_missing', '業務範囲は印刷／PDF出力の必須項目です。入力してください。');
    selectedSoftware().forEach((software) => {
      if (!Number.isFinite(software.monthlyBillingPrice) || software.monthlyBillingPrice < 0) add('software_billing_invalid', '選択したソフトウェアの月額料金を確認してください。');
      if (software.id === 'custom' && !String(software.name || '').trim()) add('custom_software_name_missing', '任意追加ソフトの名称を入力してください。');
    });
    if (state.services.otherSpotSelected && !String(state.services.otherSpotName || '').trim()) add('other_spot_name_missing', '選択したその他年次・スポット業務の名称を入力してください。');
    if (state.services.otherSpotSelected && (!Number.isFinite(state.services.otherSpotFee) || state.services.otherSpotFee <= 0)) add('other_spot_fee_invalid', '選択したその他年次・スポット業務の報酬額を入力してください。');
    return { allowed: errors.length === 0, errors };
  }

  function buildPrincipalPrintValidation() {
    const validation = buildValidation({ ignoreApproval: true });
    const principalDecisionCodes = new Set(['cost_floor_exception_missing', 'exception_reason_missing']);
    const errors = validation.errors.filter((error) => !principalDecisionCodes.has(error.code));
    return { allowed: errors.length === 0, errors };
  }

  function alertHtml(message, type) {
    return '<div class="alert ' + (type || 'warn') + '">' + escapeHtml(message) + '</div>';
  }

  function renderCalculations() {
    const customSoftware = state.services.customSoftware;
    $('custom-software-gross').textContent = '月額粗利益：' + (Number.isFinite(customSoftware.monthlyBillingPrice) && Number.isFinite(customSoftware.monthlyDirectCost) ? yen(customSoftware.monthlyBillingPrice - customSoftware.monthlyDirectCost) : '未確定');
    if (state.entity !== 'income') {
      renderValueDiagram();
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
      $('linked-revenue-months').textContent = Number.isFinite(model.costFloor.linkedRevenueMonths) ? model.costFloor.linkedRevenueMonths + 'か月' : '未確定';
      $('fixed-annual-revenue').textContent = Number.isFinite(model.costFloor.fixedAnnualRevenue) ? yen(model.costFloor.fixedAnnualRevenue) : '未確定';
      $('annual-revenue-at-floor').textContent = Number.isFinite(model.costFloor.annualRevenueAtFloor) ? yen(model.costFloor.annualRevenueAtFloor) : '未確定';
      $('floor-revenue-surplus').textContent = Number.isFinite(model.costFloor.revenueSurplusAtFloor) ? yen(model.costFloor.revenueSurplusAtFloor) : '未確定';
      const profit = model.profitStructure || {};
      $('direct-cost-profit').textContent = Number.isFinite(profit.directCostProfit) ? yen(profit.directCostProfit) : '未確定';
      $('direct-cost-profit-rate').textContent = Number.isFinite(profit.directCostProfitRate) ? percent(profit.directCostProfitRate * 100) : '未確定';
      $('allocated-overhead').textContent = Number.isFinite(profit.allocatedOverhead) ? yen(profit.allocatedOverhead) : '未確定';
      $('post-allocation-profit').textContent = Number.isFinite(profit.postAllocationProfit) ? yen(profit.postAllocationProfit) : '未確定';
      $('post-allocation-profit-rate').textContent = Number.isFinite(profit.postAllocationProfitRate) ? percent(profit.postAllocationProfitRate * 100) : '未確定';
      $('target-profit-amount').textContent = Number.isFinite(profit.targetProfitAmount) ? yen(profit.targetProfitAmount) : '未確定';
      $('target-profit-difference').textContent = Number.isFinite(profit.differenceFromTargetProfit) ? yen(profit.differenceFromTargetProfit) : '未確定';
      const costAlerts = [];
      if (model.costFloor.message) costAlerts.push(alertHtml(model.costFloor.message, model.costFloor.status === 'invalid' ? 'danger' : 'warn'));
      $('cost-alerts').innerHTML = costAlerts.join('');
      const decisionAlerts = [];
      if (!model.recommendation) decisionAlerts.push(alertHtml('原価下限が未確定のため、推奨月次顧問料は確定していません。最終額は担当者が判断してください。', 'warn'));
      if (model.recommendation && model.recommendation.exceptionReasonRequired && !model.recommendation.exceptionReasonProvided) decisionAlerts.push(alertHtml('最終月次顧問料が基準条件から外れるため、例外理由が必要です。', 'danger'));
      $('decision-alerts').innerHTML = decisionAlerts.join('');
      renderComparison();
    }
    renderProspectSummary();
    renderApprovalPanel();
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

  function adoptStandardFee() {
    if (!model.bandResult || !Number.isFinite(model.bandResult.fee)) return window.alert('標準額を自動算定できません。最終月次顧問料を手入力してください。');
    state.decision.finalMonthlyFee = model.bandResult.fee;
    state.decision.finalFeeConfirmed = true;
    state.decision.confirmationSource = 'standard';
    $('final-monthly-fee').value = formatNumber(state.decision.finalMonthlyFee);
    rebuildPhases();
    recalculate();
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

  function prospectChecklistLines() {
    const lines = [];
    if (state.entity === 'income') {
      config.services.incomeTaxReturn.forEach((definition) => {
        const item = state.services.income[definition.id];
        if (!item.selected) return;
        const amountReady = Number.isFinite(item.price) && (definition.pricingRole === 'adjustment' || item.price >= 0);
        const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
        lines.push({ name: item.name, detail: '単価 × ' + quantity + '件', annual: amountReady ? item.price * quantity : null, pending: !amountReady, optional: true });
      });
      return lines;
    }

    const fee = state.decision.finalMonthlyFee;
    const feeReady = Number.isFinite(fee) && fee > 0 && state.decision.finalFeeConfirmed;
    const breakdown = model.estimate && model.estimate.breakdown ? model.estimate.breakdown : {};
    lines.push({ name: '月次顧問料', detail: '月額 × 12か月', annual: feeReady ? fee * 12 : null, pending: !feeReady, optional: false });

    if (state.entity === 'corp' && state.services.corporateClosingSelected) {
      lines.push({ name: '法人決算・申告一式', detail: '月次顧問料 × ' + config.multipliers.corporateClosing + 'か月分', annual: feeReady ? breakdown.corporateClosingFee : null, pending: !feeReady, optional: true });
    }
    if (state.entity === 'sole' && state.services.soleClosingSelected) {
      lines.push({ name: '所得税決算・確定申告一式', detail: '月次顧問料 × ' + config.multipliers.soleProprietorClosingAndReturn + 'か月分', annual: feeReady ? breakdown.soleClosingFee : null, pending: !feeReady, optional: true });
    }
    if (currentConsumptionTaxStatus() === 'required') {
      lines.push({ name: '消費税申告書作成', detail: '月次顧問料 × ' + config.multipliers.consumptionTaxReturn + 'か月分', annual: feeReady ? breakdown.consumptionTaxReturnFee : null, pending: !feeReady, optional: true });
    }
    if (state.services.yearEndSelected) {
      lines.push({ name: '年末調整・源泉徴収票等', detail: '基本料金＋発行人数 ' + state.services.yearEndCount + '人分', annual: breakdown.yearEndAdjustmentFee, pending: !Number.isFinite(breakdown.yearEndAdjustmentFee), optional: true });
    }
    if (state.services.assetTaxSelected) {
      lines.push({ name: '償却資産税申告', detail: '対象市町村 ' + state.services.assetTaxCount + '件', annual: breakdown.depreciableAssetsFee, pending: !Number.isFinite(breakdown.depreciableAssetsFee), optional: true });
    }
    selectedSoftware().forEach((item) => {
      const amountReady = Number.isFinite(item.monthlyBillingPrice) && item.monthlyBillingPrice >= 0;
      const quantity = Math.max(0, Number(item.quantity) || 0);
      lines.push({ name: item.name, detail: '月額 × ' + quantity + '契約 × 12か月', annual: amountReady ? item.monthlyBillingPrice * quantity * 12 : null, pending: !amountReady, optional: true });
    });
    if (state.services.otherSpotSelected) {
      const amountReady = Number.isFinite(state.services.otherSpotFee) && state.services.otherSpotFee > 0;
      lines.push({ name: state.services.otherSpotName || 'その他年次・スポット業務', detail: '年額', annual: amountReady ? state.services.otherSpotFee : null, pending: !amountReady, optional: true });
    }
    if (numberOrZero(state.services.annualAdjustment) !== 0) {
      lines.push({ name: 'その他調整', detail: '事前設定済み', annual: numberOrZero(state.services.annualAdjustment), pending: false, optional: true });
    }
    return lines;
  }

  function renderProspectSummary() {
    const approved = state.approval.status === 'approved' && state.approval.approvalFingerprint === currentApprovalFingerprint();
    const principal = isPrincipalInputMode();
    const principalReady = principal && buildPrincipalPrintValidation().allowed;
    $('prospect-approval-label').textContent = principal
      ? (principalReady ? '印刷時に所長パスワード確認' : '入力中・出力前チェック未完了')
      : (approved ? '所内承認済み' : '参考表示・所内未承認');
    $('prospect-approval-label').classList.toggle('ok', approved || principalReady);
    const fee = state.decision.finalMonthlyFee;
    const feeReady = Number.isFinite(fee) && fee > 0 && state.decision.finalFeeConfirmed;
    $('corp-closing-impact').textContent = feeReady ? '年間 ' + yen(fee * config.multipliers.corporateClosing) + ' を加算（月額×' + config.multipliers.corporateClosing + '）' : '月次顧問料の確定後に年間加算額を表示';
    $('sole-closing-impact').textContent = feeReady ? '年間 ' + yen(fee * config.multipliers.soleProprietorClosingAndReturn) + ' を加算（月額×' + config.multipliers.soleProprietorClosingAndReturn + '）' : '月次顧問料の確定後に年間加算額を表示';
    const consumptionStatus = currentConsumptionTaxStatus();
    $('consumption-tax-impact').textContent = consumptionStatus === 'required'
      ? (feeReady ? '年間 ' + yen(fee * config.multipliers.consumptionTaxReturn) + ' を加算（月額×' + config.multipliers.consumptionTaxReturn + '）' : '月次顧問料の確定後に年間加算額を表示')
      : (consumptionStatus === 'none' ? '申告報酬の加算はありません' : '申告の有無を確認してください');

    const lines = prospectChecklistLines();
    const selectedCount = lines.filter((line) => line.optional).length;
    $('prospect-selection-status').textContent = '選択中 ' + selectedCount + '件';
    $('prospect-summary-lines').innerHTML = lines.map((line) => '<div class="prospect-line"><div><div class="prospect-line-name">' + escapeHtml(line.name) + '</div><div class="mini">' + escapeHtml(line.detail) + '</div></div><div class="prospect-line-amount">' + (line.pending ? '金額未確定' : yen(line.annual)) + '</div></div>').join('') || '<div class="empty-state">見積項目はまだ選択されていません</div>';

    const taxPending = state.entity !== 'income' && consumptionStatus === 'unconfirmed';
    const hasPending = lines.some((line) => line.pending) || taxPending;
    const estimateReady = model.estimate && model.estimate.status === 'calculated' && !hasPending;
    $('prospect-subtotal').textContent = estimateReady ? yen(model.estimate.subtotal) : '未確定';
    $('prospect-tax').textContent = estimateReady ? yen(model.estimate.consumptionTax) : '未確定';
    $('prospect-total').textContent = estimateReady ? yen(model.estimate.total) : '未確定';
    $('prospect-total-note').textContent = estimateReady
      ? 'チェック内容を反映した年間合計です。'
      : (taxPending ? '消費税申告の有無を確認すると年間合計を表示します。' : '金額未確定の項目があります。図解の月額基準を見積りへ反映するか、所内詳細で月次顧問料・単価を確認してください。');
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
    const approved = state.approval.status === 'approved' && state.approval.approvalFingerprint === currentApprovalFingerprint();
    const principalAuthorized = isPrincipalPrintAuthorized();
    $('print-approval-label').textContent = isPrincipalInputMode() ? '印刷前・所長パスワード未確認' : (approved ? '' : '参考表示・所内未承認');
    $('print-approval-label').classList.toggle('hidden', approved || principalAuthorized);
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
      ['月額連動月数', Number.isFinite(model.costFloor.linkedRevenueMonths) ? model.costFloor.linkedRevenueMonths + 'か月' : '未確定'],
      ['固定年間売上', Number.isFinite(model.costFloor.fixedAnnualRevenue) ? yen(model.costFloor.fixedAnnualRevenue) : '未確定'],
      ['原価下限月額', Number.isFinite(model.costFloor.monthlyCostFloor) ? yen(model.costFloor.monthlyCostFloor) : '未確定'],
      ['原価下限での年間売上', Number.isFinite(model.costFloor.annualRevenueAtFloor) ? yen(model.costFloor.annualRevenueAtFloor) : '未確定'],
      ['直接原価控除後利益', model.profitStructure && Number.isFinite(model.profitStructure.directCostProfit) ? yen(model.profitStructure.directCostProfit) : '未確定'],
      ['間接費配賦額', model.profitStructure && Number.isFinite(model.profitStructure.allocatedOverhead) ? yen(model.profitStructure.allocatedOverhead) : '未確定'],
      ['配賦後利益', model.profitStructure && Number.isFinite(model.profitStructure.postAllocationProfit) ? yen(model.profitStructure.postAllocationProfit) : '未確定'],
      ['配賦後利益率', model.profitStructure && Number.isFinite(model.profitStructure.postAllocationProfitRate) ? percent(model.profitStructure.postAllocationProfitRate * 100) : '未確定'],
      ['目標利益率', state.cost.targetProfitRate === null ? '未設定' : percent(Number(state.cost.targetProfitRate))],
      ['間接費率', state.cost.overheadRate === null ? '未設定' : percent(Number(state.cost.overheadRate))],
      ['ソフトウェア直接原価', model.costFloor.reason === 'software_direct_cost_missing' ? '未設定' : (Number.isFinite(model.costFloor.annualSoftwareDirectCost) ? yen(model.costFloor.annualSoftwareDirectCost) + '／年' : '—')]
    ]);
    $('internal-hours').innerHTML = Object.keys(roleLabels).map((role) => '<tr><td>' + roleLabels[role] + '</td><td class="money">' + yen(state.cost.rates[role]) + '／時</td><td class="money">' + state.cost.monthlyHours[role] + '</td><td class="money">' + state.cost.annualHours[role] + '</td></tr>').join('');
  }

  function approvalEligibility() {
    const errors = buildValidation({ ignoreApproval: true }).errors.slice();
    if (!String(state.approval.approvedBy || '').trim()) errors.push({ code: 'approver_missing', message: '承認者を入力してください。' });
    return { allowed: errors.length === 0, errors };
  }

  function renderApprovalPanel() {
    const approved = state.approval.status === 'approved' && state.approval.approvalFingerprint === currentApprovalFingerprint();
    $('approval-status').textContent = approved ? '承認済み' : '未承認';
    $('approval-status').classList.toggle('ok', approved);
    $('approval-change-alert').classList.toggle('hidden', state.approval.invalidatedByChange !== true);
    $('approval-target-monthly').textContent = state.entity === 'income' ? '対象外（単発報酬）' : (Number.isFinite(state.decision.finalMonthlyFee) ? yen(state.decision.finalMonthlyFee) + '／月' : '未確定');
    $('approval-cost-floor').textContent = state.entity === 'income' ? '対象外' : (model.costFloor && model.costFloor.status === 'calculated' ? yen(model.costFloor.monthlyCostFloor) + '／月' : '未確定');
    $('approval-recommended').textContent = state.entity === 'income' ? '対象外' : (model.recommendation ? yen(model.recommendation.recommendedMonthlyFee) + '／月' : '未確定');
    $('approval-exception').textContent = (state.decision.exceptionReason + ' ' + state.decision.exceptionMemo).trim() || 'なし';
    $('approve-quote-button').disabled = approved;
    $('approve-quote-button').textContent = approved ? 'この内容は承認済み' : 'この見積内容を承認';
    $('revoke-approval-button').disabled = !approved && !state.approval.approvalFingerprint;
    $('approval-approved-by').disabled = approved;
    $('approval-approved-at').disabled = approved;
    const priceMasterIncomplete = !config.priceMaster.effectiveDate || !config.priceMaster.lastReviewedDate || !config.priceMaster.approvedBy;
    $('price-master-warning').classList.toggle('hidden', !priceMasterIncomplete);
  }

  function approveCurrentQuote() {
    const eligibility = approvalEligibility();
    if (!eligibility.allowed) {
      $('approval-errors').innerHTML = eligibility.errors.map((error) => alertHtml(error.message, 'danger')).join('');
      return;
    }
    $('approval-errors').innerHTML = '';
    state.approval.status = 'approved';
    state.approval.approvedAt = state.approval.approvedAt || localToday();
    state.approval.approvalSource = ['standard', 'recommended', 'manual'].includes(state.decision.confirmationSource) ? state.decision.confirmationSource : 'manual';
    state.approval.invalidatedByChange = false;
    state.approval.approvalFingerprint = currentApprovalFingerprint();
    $('approval-approved-at').value = state.approval.approvedAt;
    recalculate();
  }

  function revokeApproval() {
    state.approval.status = 'unapproved';
    state.approval.approvalFingerprint = '';
    state.approval.approvalSource = '';
    state.approval.invalidatedByChange = false;
    recalculate();
  }

  function renderValidation() {
    const standardValidation = buildValidation();
    const principal = isPrincipalInputMode();
    const validation = principal ? buildPrincipalPrintValidation() : standardValidation;
    model.validation = validation;
    $('validation-count').textContent = validation.allowed ? (principal ? '所長確認後に出力可能' : '出力可能') : validation.errors.length + '件の確認事項';
    $('validation-errors').innerHTML = validation.allowed
      ? alertHtml(principal ? '出力前チェックを満たしています。顧客向け印刷／PDFボタンを押し、所長パスワードを入力してください。' : '顧客向け出力の必須チェックを満たしています。', 'ok')
      : validation.errors.map((error) => alertHtml(error.message, 'danger')).join('');
    if (principal) {
      $('action-mode-note').textContent = validation.allowed
        ? '所長入力モード：印刷／PDFボタンを押した後、所長パスワードで出力を解除します。'
        : '所長入力モード：' + validation.errors[0].message;
    }
    $('scope-text').setAttribute('aria-invalid', String(validation.errors.some((error) => error.code === 'scope_missing')));
    $('customer-print-button').disabled = !validation.allowed;
    $('internal-print-button').disabled = !standardValidation.allowed;
  }

  function applyOutputMode(mode) {
    document.body.classList.remove('output-customer-only', 'output-customer-reference', 'output-internal');
    document.body.classList.add('output-' + mode);
  }

  function recalculate() {
    model = calculateAll();
    invalidateApprovalIfChanged();
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

  function performPrint(internal, ignoreApproval) {
    model = calculateAll();
    renderCalculations();
    const validation = ignoreApproval === true ? buildPrincipalPrintValidation() : buildValidation();
    if (!validation.allowed) {
      if (ignoreApproval === true) clearPrincipalPrintAuthorization(true);
      window.alert('正式な出力を実行できません。\n\n' + validation.errors.map((error) => '・' + error.message).join('\n'));
      return;
    }
    if (!internal) {
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
    if (ignoreApproval === true) {
      if (principalPrintAuthorizationTimer) window.clearTimeout(principalPrintAuthorizationTimer);
      principalPrintAuthorizationTimer = window.setTimeout(() => clearPrincipalPrintAuthorization(true), 60000);
    }
    try {
      window.print();
    } catch (error) {
      if (ignoreApproval === true) clearPrincipalPrintAuthorization(true);
      window.alert('印刷／PDF画面を開けませんでした。ブラウザーの印刷機能を確認してください。');
    }
  }

  function requestPrincipalPrint() {
    model = calculateAll();
    renderCalculations();
    const validation = buildPrincipalPrintValidation();
    if (!validation.allowed) {
      window.alert('正式な出力を実行できません。\n\n' + validation.errors.map((error) => '・' + error.message).join('\n'));
      return;
    }
    pendingPrincipalPrint = { internal: false };
    $('principal-print-password').value = '';
    $('principal-print-error').classList.add('hidden');
    $('principal-print-dialog').showModal();
    $('principal-print-password').focus();
  }

  function confirmPrincipalPrint() {
    if (!pendingPrincipalPrint) return;
    if ($('principal-print-password').value !== config.principalPrintPassword) {
      $('principal-print-error').textContent = '所長パスワードが一致しません。';
      $('principal-print-error').classList.remove('hidden');
      $('principal-print-password').select();
      return;
    }
    const request = pendingPrincipalPrint;
    pendingPrincipalPrint = null;
    $('principal-print-password').value = '';
    $('principal-print-dialog').close();
    principalPrintAuthorizationFingerprint = currentApprovalFingerprint();
    performPrint(request.internal, true);
  }

  function cancelPrincipalPrint() {
    pendingPrincipalPrint = null;
    $('principal-print-password').value = '';
    $('principal-print-error').classList.add('hidden');
    $('principal-print-dialog').close();
  }

  function printDocument(internal) {
    if (isPrincipalInputMode() && !internal) {
      requestPrincipalPrint();
      return;
    }
    performPrint(internal, false);
  }

  function handleBeforePrint() {
    model = calculateAll();
    renderPrintDocuments();
    const blocked = !(isPrincipalPrintAuthorized() ? buildPrincipalPrintValidation() : buildValidation()).allowed;
    $('print-area').classList.toggle('print-blocked', blocked);
    if (!blocked) $('print-area').classList.remove('hidden');
  }

  function handleAfterPrint() {
    clearPrincipalPrintAuthorization(true);
    $('print-area').classList.remove('print-blocked');
    if (!state.previewVisible) $('print-area').classList.add('hidden');
  }

  function savePreferencesFromCandidate(candidate) {
    if (!candidate) return;
    const office = candidate.document && ['kobe', 'sakaiminato'].includes(candidate.document.office) ? candidate.document.office : devicePreferences.office;
    const rates = candidate.cost && candidate.cost.rates ? candidate.cost.rates : devicePreferences.standardCostRates;
    localStorage.setItem(config.storageKeys.preferences, JSON.stringify({
      office,
      standardCostRates: rates,
      internalModeTimeoutMinutes: candidate.preferences && candidate.preferences.internalModeTimeoutMinutes
        ? candidate.preferences.internalModeTimeoutMinutes
        : devicePreferences.internalModeTimeoutMinutes
    }));
  }

  function removeLegacyQuoteData() {
    config.storageKeys.all.forEach((key) => localStorage.removeItem(key));
  }

  function startNewQuote() {
    if (!window.confirm('現在の案件データと承認状態を消去し、新しい見積りを開始します。所内標準原価単価等の端末設定は維持します。よろしいですか？')) return;
    sessionStorage.removeItem(config.storageKeys.sessionQuote);
    sessionStorage.removeItem(config.storageKeys.restoreOnce);
    if (pendingRecovery && pendingRecovery.type === 'legacy') {
      savePreferencesFromCandidate(pendingRecovery.data);
      removeLegacyQuoteData();
    }
    window.location.reload();
  }

  function restorePendingDraft() {
    if (!pendingRecovery) return;
    if (pendingRecovery.type === 'legacy') {
      savePreferencesFromCandidate(pendingRecovery.data);
      sessionStorage.setItem(config.storageKeys.sessionQuote, JSON.stringify(pendingRecovery.data));
      removeLegacyQuoteData();
    }
    sessionStorage.setItem(config.storageKeys.restoreOnce, 'session');
    window.location.reload();
  }

  function discardPendingDraft() {
    if (pendingRecovery && pendingRecovery.type === 'legacy') {
      savePreferencesFromCandidate(pendingRecovery.data);
      removeLegacyQuoteData();
    }
    sessionStorage.removeItem(config.storageKeys.sessionQuote);
    sessionStorage.removeItem(config.storageKeys.restoreOnce);
    window.location.reload();
  }

  function showPendingRecovery() {
    if (!pendingRecovery) return;
    $('recovery-dialog-title').textContent = pendingRecovery.type === 'legacy' ? '旧版の保存データがあります' : '前回の作業中データがあります';
    $('recovery-dialog-message').textContent = pendingRecovery.type === 'legacy'
      ? '旧版の顧客・案件データは自動表示しません。復元するか、新しい見積りを開始してください。'
      : '前回の下書きは自動表示しません。復元するか、新しい見積りを開始してください。';
    $('recovery-dialog').showModal();
  }

  function bindStaticInputs() {
    document.addEventListener('input', formatMoneyInputRealtime, true);
    qsa('[data-entity]').forEach((button) => button.addEventListener('click', () => setEntity(button.dataset.entity)));
    $('internal-mode-toggle').addEventListener('click', () => {
      if (state.interactionMode === 'internal') setInteractionMode('prospect');
      else requestInternalMode();
    });
    $('principal-mode-toggle').addEventListener('click', () => {
      if (state.interactionMode === 'principal') setInteractionMode('prospect');
      else setInteractionMode('principal');
    });
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
    $('other-spot-selected').checked = state.services.otherSpotSelected;
    $('other-spot-selected').addEventListener('change', () => { state.services.otherSpotSelected = $('other-spot-selected').checked; recalculate(); });
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
    $('cost-floor-exception-reason').value = state.decision.costFloorExceptionReason;
    $('cost-floor-exception-reason').addEventListener('change', () => { state.decision.costFloorExceptionReason = $('cost-floor-exception-reason').value; recalculate(); });
    bindText('cost-floor-exception-memo', state.decision, 'costFloorExceptionMemo');
    bindText('approval-approved-by', state.approval, 'approvedBy', false);
    $('approval-approved-at').value = state.approval.approvedAt;
    $('approval-approved-at').addEventListener('input', () => { state.approval.approvedAt = $('approval-approved-at').value; saveState(); });
    bindText('approval-note', state.approval, 'approvalNote', false);
    $('internal-timeout-minutes').value = state.preferences.internalModeTimeoutMinutes;
    $('internal-timeout-minutes').addEventListener('change', () => {
      state.preferences.internalModeTimeoutMinutes = Math.max(1, Math.floor(numberOrZero($('internal-timeout-minutes').value) || config.internalModeTimeoutMinutes));
      $('internal-timeout-minutes').value = state.preferences.internalModeTimeoutMinutes;
      saveState();
      if (state.interactionMode === 'internal') startInternalIdleTimer();
    });
    const comparisonMoneyFields = {
      'current-monthly-fee': 'currentMonthlyFee', 'current-closing-fee': 'currentClosingFee', 'current-consumption-fee': 'currentConsumptionTaxFee', 'current-annual-fee': 'currentAnnualFee'
    };
    Object.entries(comparisonMoneyFields).forEach(([id, key]) => bindMoneyInput($(id), () => state.comparison[key], (value) => { state.comparison[key] = value; rebuildPhases(); }));
    $('revision-date').value = state.comparison.revisionDate;
    $('revision-date').addEventListener('input', () => { state.comparison.revisionDate = $('revision-date').value; rebuildPhases(); recalculate(); });
    $('revision-stages').value = String(state.comparison.steps);
    $('revision-stages').addEventListener('change', () => { state.comparison.steps = Number($('revision-stages').value); rebuildPhases(); recalculate(); });
    $('adopt-standard').addEventListener('click', adoptStandardFee);
    $('adopt-diagram-standard').addEventListener('click', adoptStandardFee);
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
    $('clear-service-selections').addEventListener('click', clearServiceSelections);
    $('approve-quote-button').addEventListener('click', approveCurrentQuote);
    $('revoke-approval-button').addEventListener('click', revokeApproval);
    $('internal-confirm-submit').addEventListener('click', confirmInternalMode);
    $('internal-confirm-cancel').addEventListener('click', () => $('internal-confirm-dialog').close());
    $('internal-confirm-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); confirmInternalMode(); } });
    $('principal-print-submit').addEventListener('click', confirmPrincipalPrint);
    $('principal-print-cancel').addEventListener('click', cancelPrincipalPrint);
    $('principal-print-password').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); confirmPrincipalPrint(); } });
    $('principal-print-dialog').addEventListener('cancel', (event) => { event.preventDefault(); cancelPrincipalPrint(); });
    $('recovery-restore').addEventListener('click', restorePendingDraft);
    $('recovery-new').addEventListener('click', discardPendingDraft);
    $('new-quote-button').addEventListener('click', startNewQuote);
    $('reset-button').addEventListener('click', startNewQuote);
    ['pointerdown', 'keydown', 'input', 'change'].forEach((eventName) => document.addEventListener(eventName, handleInternalActivity, { passive: true }));
  }

  function init() {
    document.title = '松本会計｜標準報酬算定ツール ' + config.appVersion;
    qsa('[data-app-version]').forEach((node) => { node.textContent = config.appVersion; });
    $('price-version-header').textContent = config.priceMaster.priceTableVersion;
    $('effective-date-header').textContent = config.priceMaster.effectiveDate || '所内設定が必要';
    $('internal-confirm-instruction').textContent = config.internalAccessConfirmationCode
      ? '所内確認用コードを入力してください。'
      : '確認文「' + config.internalDisplayConfirmationPhrase + '」を入力してください。';
    renderAdjustments();
    renderSoftware();
    renderIncomeServices();
    renderCostRows();
    bindStaticInputs();
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    setInteractionMode(state.interactionMode, false);
    applyOutputMode(state.document.outputType);
    initializing = false;
    setEntity(state.entity);
    if (state.previewVisible) $('print-area').classList.remove('hidden');
    showPendingRecovery();
  }

  init();
})();
