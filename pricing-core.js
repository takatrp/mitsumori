(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pricing-config.js'));
  } else {
    root.MitsumoriPricingCore = factory(root.MitsumoriPricingConfig);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (config) {
  'use strict';

  if (!config) throw new Error('MitsumoriPricingConfig is required.');

  const MESSAGES = {
    negativeValue: '付加価値額がマイナスであるため、標準報酬は自動算定できません。業務内容、必要工数及び原価下限から個別に判断してください。',
    manualPricing: '月次顧問料：別途お見積り',
    boundary: '料金帯の境界付近です。前後の帯、直近複数期の付加価値額及び業務内容を確認し、最終報酬を個別に決定してください。',
    shortPeriod: '短期事業年度のため、12か月換算値を料金帯判定に使用しています。',
    adjustmentMissing: '調整項目が選択されていますが、調整額が未設定です。',
    softwareCostMissing: 'ソフトウェア直接原価が未設定のため、原価下限及び利益率は確定していません。',
    largeRevision: '改定幅が大きいため、段階改定又は業務範囲の見直しを検討してください。'
  };

  const VALUE_ALIASES = {
    ordinaryProfit: ['ordinaryProfit', 'c_ordinary'],
    preDeductionProfit: ['preDeductionProfit', 's_preprofit'],
    familyEmployeeWages: ['familyEmployeeWages', 's_family'],
    laborCosts: ['laborCosts', 'labor', 'c_labor', 's_labor'],
    interestExpense: ['interestExpense', 'interest', 'c_int', 's_int'],
    rentExpense: ['rentExpense', 'rent', 'c_rent', 's_rent'],
    leaseExpense: ['leaseExpense', 'lease', 'c_lease', 's_lease'],
    taxesAndDues: ['taxesAndDues', 'taxes', 'c_tax', 's_tax'],
    depreciation: ['depreciation', 'c_dep', 's_dep']
  };

  function isMissing(value) {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  }

  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string') return NaN;
    const normalized = value.trim().replace(/,/g, '');
    if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return NaN;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : NaN;
  }

  function finiteOr(value, fallback) {
    if (isMissing(value)) return fallback;
    const number = toNumber(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function normalizeEntity(entityType) {
    const value = String(entityType || '').trim().toLowerCase();
    if (['corp', 'corporation', 'company', '法人'].includes(value)) return 'corp';
    if (['sole', 'individual', 'sole_proprietor', '個人', '個人事業者'].includes(value)) return 'sole';
    if (['income', 'income_tax', '所得税確定申告'].includes(value)) return 'income';
    return null;
  }

  function formatInteger(value) {
    return Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 20 });
  }

  function formatBandLabel(bandOrMin, maxValue) {
    const band = typeof bandOrMin === 'object' && bandOrMin !== null
      ? (bandOrMin.band || bandOrMin)
      : { min: bandOrMin, max: maxValue };
    const min = toNumber(band.min);
    const max = band.max === Infinity ? Infinity : toNumber(band.max);
    if (!Number.isFinite(min) || (!Number.isFinite(max) && max !== Infinity)) return '';
    if (max === Infinity) return formatInteger(min) + '円以上';
    return formatInteger(min) + '円以上 ' + formatInteger(max) + '円未満';
  }

  function readAliasedValue(values, key) {
    const aliases = VALUE_ALIASES[key] || [key];
    for (let index = 0; index < aliases.length; index += 1) {
      const alias = aliases[index];
      if (Object.prototype.hasOwnProperty.call(values, alias)) return values[alias];
    }
    return undefined;
  }

  function calculateValueAdded(input, valuesArgument, optionsArgument) {
    let payload;
    if (typeof input === 'string') {
      payload = Object.assign({}, optionsArgument || {}, {
        entityType: input,
        values: valuesArgument || {}
      });
    } else {
      payload = input || {};
    }

    const entityType = normalizeEntity(payload.entityType || payload.entity || payload.type);
    if (!entityType || entityType === 'income') {
      return {
        status: 'invalid',
        value: null,
        missingFields: [],
        invalidFields: [],
        reason: 'unsupported_entity',
        message: '法人又は個人を指定してください。'
      };
    }

    const values = payload.values || payload.fields || payload;
    const definitions = config.valueAddedFields[entityType];
    const missingFields = [];
    const invalidFields = [];
    const normalizedValues = {};

    definitions.forEach(function (definition) {
      const raw = readAliasedValue(values, definition.key);
      if (isMissing(raw)) {
        missingFields.push(definition.key);
        return;
      }
      const number = toNumber(raw);
      if (!Number.isFinite(number)) {
        invalidFields.push(definition.key);
        return;
      }
      normalizedValues[definition.key] = number;
    });

    if (missingFields.length || invalidFields.length) {
      return {
        status: 'invalid',
        value: null,
        missingFields: missingFields,
        invalidFields: invalidFields,
        reason: missingFields.length ? 'missing_required_values' : 'invalid_values',
        message: missingFields.length
          ? '付加価値額の必須項目に未入力があります。0円の場合は0を入力してください。'
          : '付加価値額の入力値を確認してください。'
      };
    }

    let ownerLaborCompensation = 0;
    if (entityType === 'sole') {
      const rawOwnerAmount = Object.prototype.hasOwnProperty.call(payload, 'ownerLaborCompensation')
        ? payload.ownerLaborCompensation
        : (typeof config.ownerLaborCompensation === 'number'
          ? config.ownerLaborCompensation
          : config.ownerLaborCompensation.defaultAmount);
      ownerLaborCompensation = toNumber(rawOwnerAmount);
      if (!Number.isFinite(ownerLaborCompensation) || ownerLaborCompensation < 0) {
        return {
          status: 'invalid',
          value: null,
          missingFields: [],
          invalidFields: ['ownerLaborCompensation'],
          reason: 'invalid_owner_labor_compensation',
          message: '事業主本人の労働対価相当額を0円以上で入力してください。'
        };
      }
    }

    const fieldTotal = Object.keys(normalizedValues).reduce(function (sum, key) {
      return sum + normalizedValues[key];
    }, 0);
    return {
      status: 'calculated',
      entityType: entityType,
      value: fieldTotal + ownerLaborCompensation,
      fieldTotal: fieldTotal,
      ownerLaborCompensation: ownerLaborCompensation,
      values: normalizedValues,
      missingFields: [],
      invalidFields: []
    };
  }

  function annualizeValue(valueOrInput, fiscalMonthsArgument) {
    const payload = typeof valueOrInput === 'object' && valueOrInput !== null
      ? valueOrInput
      : { value: valueOrInput, fiscalMonths: fiscalMonthsArgument };
    const value = toNumber(Object.prototype.hasOwnProperty.call(payload, 'value') ? payload.value : payload.inputValue);
    const fiscalMonths = toNumber(payload.fiscalMonths !== undefined ? payload.fiscalMonths : payload.months);
    if (!Number.isFinite(value) || !Number.isInteger(fiscalMonths) || fiscalMonths < 1 || fiscalMonths > 12) {
      return {
        status: 'invalid',
        inputValue: Number.isFinite(value) ? value : null,
        fiscalMonths: Number.isFinite(fiscalMonths) ? fiscalMonths : null,
        annualizedValue: null,
        isShortPeriod: false,
        message: '対象事業年度の月数は1か月以上12か月以下の整数で入力してください。'
      };
    }
    return {
      status: 'calculated',
      inputValue: value,
      fiscalMonths: fiscalMonths,
      annualizedValue: value * 12 / fiscalMonths,
      isShortPeriod: fiscalMonths < 12,
      message: fiscalMonths < 12 ? MESSAGES.shortPeriod : ''
    };
  }

  function determinePricingBand(entityOrInput, valueArgument) {
    const payload = typeof entityOrInput === 'object' && entityOrInput !== null
      ? entityOrInput
      : { entityType: entityOrInput, value: valueArgument };
    const entityType = normalizeEntity(payload.entityType || payload.entity || payload.type);
    const value = toNumber(payload.value !== undefined ? payload.value : payload.annualizedValue);

    if (!entityType || entityType === 'income' || !Number.isFinite(value)) {
      return {
        status: 'invalid',
        entityType: entityType,
        value: Number.isFinite(value) ? value : null,
        fee: null,
        band: null,
        bandIndex: -1,
        label: '',
        reason: 'invalid_input',
        message: '料金帯を判定できる法人又は個人の付加価値額を指定してください。'
      };
    }
    if (value < 0) {
      return {
        status: 'manual_required',
        entityType: entityType,
        value: value,
        fee: null,
        band: null,
        bandIndex: -1,
        label: '個別判断',
        reason: 'negative_value',
        message: MESSAGES.negativeValue
      };
    }

    const bands = config.pricingBands[entityType];
    for (let index = 0; index < bands.length; index += 1) {
      const band = bands[index];
      if (value >= band.min && value < band.max) {
        const manual = band.fee === null;
        return {
          status: manual ? 'manual_required' : 'calculated',
          entityType: entityType,
          value: value,
          fee: manual ? null : band.fee,
          band: band,
          bandIndex: index,
          label: formatBandLabel(band),
          reason: manual ? 'upper_band' : null,
          message: manual ? MESSAGES.manualPricing : ''
        };
      }
    }

    return {
      status: 'invalid',
      entityType: entityType,
      value: value,
      fee: null,
      band: null,
      bandIndex: -1,
      label: '',
      reason: 'band_not_found',
      message: '料金帯を判定できませんでした。'
    };
  }

  function findBoundaryWarning(entityOrInput, valueArgument, warningRateArgument) {
    const payload = typeof entityOrInput === 'object' && entityOrInput !== null
      ? entityOrInput
      : { entityType: entityOrInput, value: valueArgument, warningRate: warningRateArgument };
    const entityType = normalizeEntity(payload.entityType || payload.entity || payload.type);
    const value = toNumber(payload.value !== undefined ? payload.value : payload.annualizedValue);
    let warningRate = payload.warningRate === undefined ? config.boundaryWarningRate : toNumber(payload.warningRate);
    if (Number.isFinite(warningRate) && warningRate > 1) warningRate /= 100;

    if (!entityType || entityType === 'income' || !Number.isFinite(value) || value < 0 || !Number.isFinite(warningRate) || warningRate < 0) {
      return {
        isNearBoundary: false,
        warning: false,
        boundary: null,
        absoluteDifference: null,
        difference: null,
        differenceRate: null,
        currentBand: null,
        adjacentBand: null,
        message: ''
      };
    }

    const bands = config.pricingBands[entityType];
    const boundaries = bands.slice(1).map(function (band, index) {
      return { amount: band.min, upperBandIndex: index + 1 };
    });
    let nearest = null;
    boundaries.forEach(function (boundary) {
      const absoluteDifference = Math.abs(value - boundary.amount);
      if (!nearest || absoluteDifference < nearest.absoluteDifference) {
        nearest = {
          amount: boundary.amount,
          upperBandIndex: boundary.upperBandIndex,
          absoluteDifference: absoluteDifference
        };
      }
    });

    if (!nearest) {
      return {
        isNearBoundary: false,
        warning: false,
        boundary: null,
        absoluteDifference: null,
        difference: null,
        differenceRate: null,
        currentBand: null,
        adjacentBand: null,
        message: ''
      };
    }

    const differenceRate = nearest.absoluteDifference / nearest.amount;
    const isNearBoundary = differenceRate <= warningRate + Number.EPSILON;
    const currentResult = determinePricingBand(entityType, value);
    const currentBandIndex = currentResult.bandIndex;
    let adjacentBandIndex;
    if (value < nearest.amount) adjacentBandIndex = nearest.upperBandIndex;
    else adjacentBandIndex = nearest.upperBandIndex - 1;
    const adjacentBand = bands[adjacentBandIndex] || null;

    return {
      isNearBoundary: isNearBoundary,
      warning: isNearBoundary,
      warningRate: warningRate,
      boundary: nearest.amount,
      difference: value - nearest.amount,
      absoluteDifference: nearest.absoluteDifference,
      differenceRate: differenceRate,
      currentBand: currentResult.band,
      currentBandIndex: currentBandIndex,
      currentBandLabel: currentResult.label,
      currentFee: currentResult.fee,
      adjacentBand: adjacentBand,
      adjacentBandIndex: adjacentBandIndex,
      adjacentBandLabel: adjacentBand ? formatBandLabel(adjacentBand) : '',
      adjacentFee: adjacentBand ? adjacentBand.fee : null,
      message: isNearBoundary ? MESSAGES.boundary : ''
    };
  }

  function calculateServiceFee(service, context) {
    const item = service || {};
    const options = context || {};
    const quantity = finiteOr(options.quantity !== undefined ? options.quantity : item.quantity, 1);
    const kind = item.kind || 'spot';
    if (!Number.isFinite(quantity)) return { status: 'invalid', annualAmount: null, monthlyAmount: null, reason: 'invalid_quantity' };

    let unitPrice;
    let annualAmount;
    let monthlyAmount = 0;

    if (kind === 'monthly_multiplier' || kind === 'mult_m') {
      const monthlyAdvisoryFee = toNumber(options.monthlyAdvisoryFee);
      const months = toNumber(item.months !== undefined ? item.months : options.months);
      if (!Number.isFinite(monthlyAdvisoryFee) || !Number.isFinite(months)) {
        return { status: 'invalid', annualAmount: null, monthlyAmount: null, reason: 'monthly_fee_or_multiplier_missing' };
      }
      unitPrice = monthlyAdvisoryFee * months;
      annualAmount = unitPrice * quantity;
    } else if (kind === 'base_plus_extra' || kind === 'asset_tax') {
      const basePrice = toNumber(item.basePrice !== undefined ? item.basePrice : item.base);
      const extraPrice = toNumber(item.extraPrice !== undefined ? item.extraPrice : item.extra);
      if (!Number.isFinite(basePrice) || !Number.isFinite(extraPrice)) {
        return { status: 'invalid', annualAmount: null, monthlyAmount: null, reason: 'service_price_missing' };
      }
      unitPrice = quantity > 0 ? basePrice + Math.max(0, quantity - 1) * extraPrice : 0;
      annualAmount = unitPrice;
    } else {
      unitPrice = toNumber(item.price !== undefined ? item.price : item.monthlyBillingPrice);
      if (!Number.isFinite(unitPrice)) {
        return { status: 'invalid', annualAmount: null, monthlyAmount: null, reason: 'service_price_missing' };
      }
      if (kind === 'monthly' || (kind === 'fixed' && item.unit === '月額')) {
        monthlyAmount = unitPrice * quantity;
        annualAmount = monthlyAmount * 12;
      } else {
        annualAmount = unitPrice * quantity;
      }
    }

    return {
      status: 'calculated',
      serviceId: item.id || null,
      kind: kind,
      quantity: quantity,
      unitPrice: unitPrice,
      monthlyAmount: monthlyAmount,
      annualAmount: annualAmount
    };
  }

  function calculateConsumptionTax(amountOrInput, taxRateArgument) {
    const payload = typeof amountOrInput === 'object' && amountOrInput !== null
      ? amountOrInput
      : { amount: amountOrInput, taxRate: taxRateArgument };
    const amount = toNumber(payload.amount !== undefined ? payload.amount : payload.subtotal);
    const taxRate = payload.taxRate === undefined ? config.taxRate : toNumber(payload.taxRate);
    if (!Number.isFinite(amount) || !Number.isFinite(taxRate) || taxRate < 0) {
      return { status: 'invalid', taxableAmount: null, taxRate: null, tax: null, total: null };
    }
    const rawTax = amount * taxRate;
    const rounding = payload.rounding || 'round';
    const tax = rounding === 'floor' ? Math.floor(rawTax) : (rounding === 'ceil' ? Math.ceil(rawTax) : Math.round(rawTax));
    return {
      status: 'calculated',
      taxableAmount: amount,
      taxRate: taxRate,
      tax: tax,
      total: amount + tax
    };
  }

  function sumSoftwareBilling(items) {
    if (!Array.isArray(items)) return 0;
    return items.reduce(function (sum, item) {
      if (!item || item.selected === false) return sum;
      const price = finiteOr(item.monthlyBillingPrice !== undefined ? item.monthlyBillingPrice : item.price, 0);
      const quantity = finiteOr(item.quantity, 1);
      return sum + (Number.isFinite(price) && Number.isFinite(quantity) ? price * quantity : 0);
    }, 0);
  }

  function calculateAnnualEstimate(input) {
    const payload = input || {};
    const entityType = normalizeEntity(payload.entityType || payload.entity || payload.type);
    const monthlyAdvisoryFee = finiteOr(payload.monthlyAdvisoryFee !== undefined ? payload.monthlyAdvisoryFee : payload.finalMonthlyFee, 0);
    const softwareMonthlyFee = payload.softwareMonthlyFee !== undefined
      ? toNumber(payload.softwareMonthlyFee)
      : sumSoftwareBilling(payload.softwareItems);
    const monthlyOtherFees = finiteOr(payload.monthlyOtherFees, 0);
    const monthlyAdjustmentAmount = finiteOr(payload.monthlyAdjustmentAmount, 0);

    const numericFields = [monthlyAdvisoryFee, softwareMonthlyFee, monthlyOtherFees, monthlyAdjustmentAmount];
    if (numericFields.some(function (value) { return !Number.isFinite(value); })) {
      return { status: 'invalid', subtotal: null, consumptionTax: null, total: null, reason: 'invalid_monthly_amount' };
    }

    let corporateClosingFee = finiteOr(payload.corporateClosingFee, 0);
    let soleClosingFee = finiteOr(payload.soleClosingFee !== undefined ? payload.soleClosingFee : payload.personalClosingFee, 0);
    let consumptionTaxReturnFee = finiteOr(payload.consumptionTaxReturnFee !== undefined ? payload.consumptionTaxReturnFee : payload.consumptionTaxFee, 0);
    if (entityType === 'corp' && payload.corporateClosingSelected === true && payload.corporateClosingFee === undefined) {
      corporateClosingFee = monthlyAdvisoryFee * config.multipliers.corporateClosing;
    }
    if (entityType === 'sole' && payload.soleClosingSelected === true && payload.soleClosingFee === undefined && payload.personalClosingFee === undefined) {
      soleClosingFee = monthlyAdvisoryFee * config.multipliers.soleProprietorClosingAndReturn;
    }
    const taxStatus = payload.consumptionTaxStatus;
    if ((taxStatus === 'required' || taxStatus === '申告あり') && payload.consumptionTaxReturnFee === undefined && payload.consumptionTaxFee === undefined) {
      consumptionTaxReturnFee = monthlyAdvisoryFee * config.multipliers.consumptionTaxReturn;
    }
    if (taxStatus === 'exempt' || taxStatus === '免税又は申告不要') consumptionTaxReturnFee = 0;

    const annualAmounts = {
      corporateClosingFee: corporateClosingFee,
      soleClosingFee: soleClosingFee,
      consumptionTaxReturnFee: consumptionTaxReturnFee,
      yearEndAdjustmentFee: finiteOr(payload.yearEndAdjustmentFee, 0),
      depreciableAssetsFee: finiteOr(payload.depreciableAssetsFee, 0),
      otherAnnualFee: finiteOr(payload.otherAnnualFee !== undefined ? payload.otherAnnualFee : payload.otherAnnualSpotFee, 0),
      annualAdjustmentAmount: finiteOr(payload.annualAdjustmentAmount !== undefined ? payload.annualAdjustmentAmount : payload.adjustmentAmount, 0)
    };
    if (Object.keys(annualAmounts).some(function (key) { return !Number.isFinite(annualAmounts[key]); })) {
      return { status: 'invalid', subtotal: null, consumptionTax: null, total: null, reason: 'invalid_annual_amount' };
    }

    let serviceLinesTotal = 0;
    const lineResults = [];
    if (Array.isArray(payload.serviceLines)) {
      for (let index = 0; index < payload.serviceLines.length; index += 1) {
        const line = payload.serviceLines[index] || {};
        let amount;
        if (line.service) {
          const result = calculateServiceFee(line.service, line);
          if (result.status !== 'calculated') return { status: 'invalid', subtotal: null, consumptionTax: null, total: null, reason: 'invalid_service_line', lineIndex: index };
          amount = result.annualAmount;
          lineResults.push(result);
        } else {
          const baseAmount = toNumber(line.amount);
          const quantity = finiteOr(line.quantity, 1);
          if (!Number.isFinite(baseAmount) || !Number.isFinite(quantity)) return { status: 'invalid', subtotal: null, consumptionTax: null, total: null, reason: 'invalid_service_line', lineIndex: index };
          amount = baseAmount * quantity * (line.frequency === 'monthly' ? 12 : 1);
          lineResults.push({ status: 'calculated', annualAmount: amount, quantity: quantity });
        }
        serviceLinesTotal += amount;
      }
    }

    const monthlyAdvisoryAnnual = monthlyAdvisoryFee * 12;
    const softwareAnnual = softwareMonthlyFee * 12;
    const monthlyOtherAnnual = monthlyOtherFees * 12;
    const monthlyAdjustmentAnnual = monthlyAdjustmentAmount * 12;
    const annualFixedTotal = Object.keys(annualAmounts).reduce(function (sum, key) { return sum + annualAmounts[key]; }, 0);
    const subtotal = monthlyAdvisoryAnnual + softwareAnnual + monthlyOtherAnnual + monthlyAdjustmentAnnual + annualFixedTotal + serviceLinesTotal;
    const taxResult = calculateConsumptionTax({ amount: subtotal, taxRate: payload.taxRate, rounding: payload.taxRounding });
    if (taxResult.status !== 'calculated') return { status: 'invalid', subtotal: null, consumptionTax: null, total: null, reason: 'invalid_tax_rate' };

    return {
      status: 'calculated',
      entityType: entityType,
      breakdown: {
        monthlyAdvisoryAnnual: monthlyAdvisoryAnnual,
        corporateClosingFee: corporateClosingFee,
        soleClosingFee: soleClosingFee,
        consumptionTaxReturnFee: consumptionTaxReturnFee,
        yearEndAdjustmentFee: annualAmounts.yearEndAdjustmentFee,
        depreciableAssetsFee: annualAmounts.depreciableAssetsFee,
        softwareAnnual: softwareAnnual,
        monthlyOtherAnnual: monthlyOtherAnnual,
        monthlyAdjustmentAnnual: monthlyAdjustmentAnnual,
        otherAnnualFee: annualAmounts.otherAnnualFee,
        annualAdjustmentAmount: annualAmounts.annualAdjustmentAmount,
        serviceLinesTotal: serviceLinesTotal
      },
      serviceLines: lineResults,
      subtotal: subtotal,
      consumptionTax: taxResult.tax,
      tax: taxResult.tax,
      total: taxResult.total,
      taxIncludedTotal: taxResult.total,
      taxRate: taxResult.taxRate
    };
  }

  function calculateAdjustmentTotal(items) {
    const adjustments = Array.isArray(items) ? items : [];
    const warnings = [];
    let total = 0;
    adjustments.forEach(function (item, index) {
      if (!item || item.selected !== true) return;
      const amount = finiteOr(item.monthlyAmount !== undefined ? item.monthlyAmount : item.amount, 0);
      if (!Number.isFinite(amount)) {
        warnings.push({ index: index, code: 'invalid_adjustment_amount', message: '調整額を数値で入力してください。' });
        return;
      }
      total += amount;
      if (amount === 0) warnings.push({ index: index, code: 'adjustment_amount_missing', message: MESSAGES.adjustmentMissing });
    });
    return {
      status: warnings.some(function (warning) { return warning.code === 'invalid_adjustment_amount'; }) ? 'invalid' : 'calculated',
      monthlyAdjustmentAmount: total,
      warnings: warnings,
      hasUnsetSelectedItem: warnings.some(function (warning) { return warning.code === 'adjustment_amount_missing'; })
    };
  }

  function normalizeRate(value) {
    const number = toNumber(value);
    if (!Number.isFinite(number)) return NaN;
    return number > 1 ? number / 100 : number;
  }

  function readRoleValue(source, role) {
    const aliases = {
      playing: ['playing', 'play'],
      manager: ['manager', 'mgr'],
      executive: ['executive', 'exec']
    }[role];
    const object = source || {};
    for (let index = 0; index < aliases.length; index += 1) {
      if (Object.prototype.hasOwnProperty.call(object, aliases[index])) return finiteOr(object[aliases[index]], 0);
    }
    return 0;
  }

  function calculateAnnualCost(input) {
    const payload = input || {};
    const ratesSource = payload.standardCostRates || payload.rates || config.standardCostRates;
    const monthlyHoursSource = payload.monthlyHours || {};
    const annualHoursSource = payload.annualHours || payload.spotHours || {};
    const roles = ['playing', 'manager', 'executive'];
    const rates = {};
    const monthlyLaborByRole = {};
    const annualSpotLaborByRole = {};

    for (let index = 0; index < roles.length; index += 1) {
      const role = roles[index];
      rates[role] = readRoleValue(ratesSource, role);
      const monthlyHours = readRoleValue(monthlyHoursSource, role);
      const annualHours = readRoleValue(annualHoursSource, role);
      if (![rates[role], monthlyHours, annualHours].every(function (value) { return Number.isFinite(value) && value >= 0; })) {
        return { status: 'invalid', annualDirectCost: null, reason: 'invalid_rate_or_hours' };
      }
      monthlyLaborByRole[role] = monthlyHours * rates[role];
      annualSpotLaborByRole[role] = annualHours * rates[role];
    }

    const monthlyLaborCost = roles.reduce(function (sum, role) { return sum + monthlyLaborByRole[role]; }, 0);
    const annualSpotLaborCost = roles.reduce(function (sum, role) { return sum + annualSpotLaborByRole[role]; }, 0);
    const missingSoftwareCosts = [];
    let softwareMonthlyDirectCost = 0;

    if (Array.isArray(payload.softwareItems)) {
      payload.softwareItems.forEach(function (item, index) {
        if (!item || item.selected === false) return;
        const rawCost = item.monthlyDirectCost !== undefined ? item.monthlyDirectCost : item.directCost;
        if (isMissing(rawCost) || !Number.isFinite(toNumber(rawCost))) {
          missingSoftwareCosts.push(item.id || item.name || String(index));
          return;
        }
        const cost = toNumber(rawCost);
        const quantity = finiteOr(item.quantity, 1);
        if (cost < 0 || !Number.isFinite(quantity) || quantity < 0) {
          missingSoftwareCosts.push(item.id || item.name || String(index));
          return;
        }
        softwareMonthlyDirectCost += cost * quantity;
      });
    } else if (payload.softwareSelected === true || payload.softwareMonthlyDirectCost !== undefined) {
      if (isMissing(payload.softwareMonthlyDirectCost) || !Number.isFinite(toNumber(payload.softwareMonthlyDirectCost))) {
        missingSoftwareCosts.push('softwareMonthlyDirectCost');
      } else {
        softwareMonthlyDirectCost = toNumber(payload.softwareMonthlyDirectCost);
        if (softwareMonthlyDirectCost < 0) missingSoftwareCosts.push('softwareMonthlyDirectCost');
      }
    }

    if (missingSoftwareCosts.length) {
      return {
        status: 'manual_required',
        annualDirectCost: null,
        monthlyLaborCost: monthlyLaborCost,
        annualSpotLaborCost: annualSpotLaborCost,
        softwareMonthlyDirectCost: null,
        missingSoftwareCosts: missingSoftwareCosts,
        reason: 'software_direct_cost_missing',
        message: MESSAGES.softwareCostMissing
      };
    }

    const otherAnnualDirectCost = finiteOr(payload.otherAnnualDirectCost !== undefined ? payload.otherAnnualDirectCost : payload.otherDirectCost, 0);
    if (!Number.isFinite(otherAnnualDirectCost) || otherAnnualDirectCost < 0) {
      return { status: 'invalid', annualDirectCost: null, reason: 'invalid_other_direct_cost' };
    }
    const annualLaborCost = monthlyLaborCost * 12 + annualSpotLaborCost;
    const annualSoftwareDirectCost = softwareMonthlyDirectCost * 12;
    return {
      status: 'calculated',
      rates: rates,
      monthlyLaborByRole: monthlyLaborByRole,
      annualSpotLaborByRole: annualSpotLaborByRole,
      monthlyLaborCost: monthlyLaborCost,
      annualSpotLaborCost: annualSpotLaborCost,
      annualLaborCost: annualLaborCost,
      softwareMonthlyDirectCost: softwareMonthlyDirectCost,
      annualSoftwareDirectCost: annualSoftwareDirectCost,
      otherAnnualDirectCost: otherAnnualDirectCost,
      annualDirectCost: annualLaborCost + annualSoftwareDirectCost + otherAnnualDirectCost,
      missingSoftwareCosts: []
    };
  }

  function calculateNonMonthlyRevenue(input) {
    const payload = input || {};
    if (payload.nonMonthlyRevenue !== undefined) return toNumber(payload.nonMonthlyRevenue);
    const softwareMonthlyRevenue = payload.softwareMonthlyRevenue !== undefined
      ? toNumber(payload.softwareMonthlyRevenue)
      : sumSoftwareBilling(payload.softwareItems);
    const values = [
      softwareMonthlyRevenue * 12,
      finiteOr(payload.closingFee !== undefined ? payload.closingFee : payload.corporateClosingFee, 0),
      finiteOr(payload.soleClosingFee !== undefined ? payload.soleClosingFee : payload.personalClosingFee, 0),
      finiteOr(payload.consumptionTaxReturnFee !== undefined ? payload.consumptionTaxReturnFee : payload.consumptionTaxFee, 0),
      finiteOr(payload.yearEndAdjustmentFee, 0),
      finiteOr(payload.depreciableAssetsFee, 0),
      finiteOr(payload.otherAnnualSpotRevenue !== undefined ? payload.otherAnnualSpotRevenue : payload.otherAnnualFee, 0)
    ];
    return values.every(Number.isFinite) ? values.reduce(function (sum, value) { return sum + value; }, 0) : NaN;
  }

  function calculateCostFloor(input) {
    const payload = input || {};
    const annualCost = calculateAnnualCost(payload);
    if (annualCost.status !== 'calculated') {
      return Object.assign({}, annualCost, {
        requiredAnnualRevenue: null,
        nonMonthlyRevenue: null,
        rawMonthlyCostFloor: null,
        monthlyCostFloor: null
      });
    }

    if (isMissing(payload.targetProfitRate)) {
      return Object.assign({}, annualCost, {
        status: 'manual_required',
        requiredAnnualRevenue: null,
        nonMonthlyRevenue: null,
        rawMonthlyCostFloor: null,
        monthlyCostFloor: null,
        reason: 'target_profit_rate_missing',
        message: '目標利益率を入力してください。'
      });
    }
    const targetProfitRate = normalizeRate(payload.targetProfitRate);
    const overheadRate = isMissing(payload.overheadRate) ? 0 : normalizeRate(payload.overheadRate);
    if (!Number.isFinite(targetProfitRate) || !Number.isFinite(overheadRate) || targetProfitRate < 0 || overheadRate < 0) {
      return Object.assign({}, annualCost, {
        status: 'invalid',
        requiredAnnualRevenue: null,
        nonMonthlyRevenue: null,
        rawMonthlyCostFloor: null,
        monthlyCostFloor: null,
        reason: 'invalid_profit_or_overhead_rate'
      });
    }
    if (targetProfitRate + overheadRate >= 1) {
      return Object.assign({}, annualCost, {
        status: 'invalid',
        targetProfitRate: targetProfitRate,
        overheadRate: overheadRate,
        requiredAnnualRevenue: null,
        nonMonthlyRevenue: null,
        rawMonthlyCostFloor: null,
        monthlyCostFloor: null,
        reason: 'rate_total_at_least_100_percent',
        message: '目標利益率と間接費率の合計が100％以上のため、原価下限を算出できません。'
      });
    }

    const nonMonthlyRevenue = calculateNonMonthlyRevenue(payload);
    if (!Number.isFinite(nonMonthlyRevenue)) {
      return Object.assign({}, annualCost, {
        status: 'invalid',
        requiredAnnualRevenue: null,
        nonMonthlyRevenue: null,
        rawMonthlyCostFloor: null,
        monthlyCostFloor: null,
        reason: 'invalid_non_monthly_revenue'
      });
    }
    const requiredAnnualRevenue = annualCost.annualDirectCost / (1 - targetProfitRate - overheadRate);
    const rawMonthlyCostFloor = (requiredAnnualRevenue - nonMonthlyRevenue) / 12;
    return Object.assign({}, annualCost, {
      status: 'calculated',
      targetProfitRate: targetProfitRate,
      overheadRate: overheadRate,
      requiredAnnualRevenue: requiredAnnualRevenue,
      nonMonthlyRevenue: nonMonthlyRevenue,
      rawMonthlyCostFloor: rawMonthlyCostFloor,
      monthlyCostFloor: Math.max(0, Math.ceil(rawMonthlyCostFloor))
    });
  }

  function calculateRecommendation(input) {
    const payload = input || {};
    const bandResult = payload.bandResult || null;
    const bandFee = toNumber(payload.bandFee !== undefined ? payload.bandFee : (bandResult ? bandResult.fee : undefined));
    const adjustmentAmount = finiteOr(payload.adjustmentAmount !== undefined ? payload.adjustmentAmount : payload.monthlyAdjustmentAmount, 0);
    const costFloorResult = payload.costFloorResult || null;
    const costFloor = toNumber(payload.costFloor !== undefined ? payload.costFloor : (payload.monthlyCostFloor !== undefined ? payload.monthlyCostFloor : (costFloorResult ? costFloorResult.monthlyCostFloor : undefined)));
    if (!Number.isFinite(bandFee) || !Number.isFinite(adjustmentAmount) || !Number.isFinite(costFloor)) {
      return {
        status: 'manual_required',
        basisAmount: null,
        recommendedMonthlyFee: null,
        finalMonthlyFee: null,
        finalConfirmed: false,
        exceptionReasonRequired: false,
        exceptionReasons: [],
        canFinalize: false,
        reason: 'basis_or_cost_floor_unconfirmed'
      };
    }

    const basisAmount = bandFee + adjustmentAmount;
    const recommendedMonthlyFee = Math.max(basisAmount, costFloor);
    const finalRaw = payload.finalMonthlyFee;
    const finalMonthlyFee = isMissing(finalRaw) ? null : toNumber(finalRaw);
    const finalConfirmed = Number.isFinite(finalMonthlyFee);
    const exceptionReasons = [];
    if (finalConfirmed) {
      if (finalMonthlyFee < bandFee) exceptionReasons.push('below_band_fee');
      if (finalMonthlyFee < costFloor) exceptionReasons.push('below_cost_floor');
      if (recommendedMonthlyFee > 0 && Math.abs(finalMonthlyFee - recommendedMonthlyFee) / recommendedMonthlyFee >= 0.10 - Number.EPSILON) {
        exceptionReasons.push('deviation_at_least_10_percent');
      }
      if (payload.stagedRevision === true || payload.usesPhasedRevision === true) exceptionReasons.push('phased_revision');
    }
    const exceptionReasonRequired = exceptionReasons.length > 0;
    const exceptionReason = String(payload.exceptionReason || '').trim();
    return {
      status: 'calculated',
      bandFee: bandFee,
      adjustmentAmount: adjustmentAmount,
      basisAmount: basisAmount,
      valueAndWorkBasisAmount: basisAmount,
      costFloor: costFloor,
      recommendedMonthlyFee: recommendedMonthlyFee,
      finalMonthlyFee: finalConfirmed ? finalMonthlyFee : null,
      finalConfirmed: finalConfirmed,
      exceptionReasonRequired: exceptionReasonRequired,
      exceptionReasons: exceptionReasons,
      exceptionReasonProvided: exceptionReason.length > 0,
      canFinalize: finalConfirmed && (!exceptionReasonRequired || exceptionReason.length > 0)
    };
  }

  function calculateFeeDifference(input) {
    const payload = input || {};
    const currentMonthlyFee = finiteOr(payload.currentMonthlyFee, 0);
    const proposedMonthlyFee = finiteOr(payload.proposedMonthlyFee !== undefined ? payload.proposedMonthlyFee : payload.finalMonthlyFee, 0);
    const currentAnnualFee = payload.currentAnnualFee !== undefined
      ? toNumber(payload.currentAnnualFee)
      : currentMonthlyFee * 12
        + finiteOr(payload.currentClosingFee, 0)
        + finiteOr(payload.currentConsumptionTaxFee, 0)
        + finiteOr(payload.currentOtherAnnualFee, 0);
    const proposedAnnualFee = payload.proposedAnnualFee !== undefined
      ? toNumber(payload.proposedAnnualFee)
      : proposedMonthlyFee * 12
        + finiteOr(payload.proposedClosingFee, 0)
        + finiteOr(payload.proposedConsumptionTaxFee, 0)
        + finiteOr(payload.proposedOtherAnnualFee, 0);
    if (![currentMonthlyFee, proposedMonthlyFee, currentAnnualFee, proposedAnnualFee].every(Number.isFinite)) {
      return { status: 'invalid', monthlyDifference: null, annualDifference: null, revisionRate: null };
    }
    const annualDifference = proposedAnnualFee - currentAnnualFee;
    const revisionRate = currentAnnualFee > 0 ? annualDifference / currentAnnualFee : null;
    const largeRevisionWarning = revisionRate !== null && Math.abs(revisionRate) > 0.15;
    return {
      status: 'calculated',
      currentMonthlyFee: currentMonthlyFee,
      proposedMonthlyFee: proposedMonthlyFee,
      monthlyDifference: proposedMonthlyFee - currentMonthlyFee,
      currentAnnualFee: currentAnnualFee,
      proposedAnnualFee: proposedAnnualFee,
      annualDifference: annualDifference,
      revisionRate: revisionRate,
      revisionRatePercent: revisionRate === null ? null : revisionRate * 100,
      largeRevisionWarning: largeRevisionWarning,
      message: largeRevisionWarning ? MESSAGES.largeRevision : ''
    };
  }

  function addMonths(dateString, months) {
    if (!dateString) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString));
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const targetMonthIndex = monthIndex + months;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const date = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
    return date.toISOString().slice(0, 10);
  }

  function buildPhasedRevision(input) {
    const payload = input || {};
    const currentMonthlyFee = toNumber(payload.currentMonthlyFee);
    const targetMonthlyFee = toNumber(payload.targetMonthlyFee !== undefined ? payload.targetMonthlyFee : payload.finalMonthlyFee);
    const stepMap = { lump: 1, once: 1, one: 1, two: 2, three: 3 };
    let steps = stepMap[payload.planType] || stepMap[payload.steps] || toNumber(payload.steps);
    if (!Number.isFinite(currentMonthlyFee) || !Number.isFinite(targetMonthlyFee) || !Number.isInteger(steps) || steps < 1 || steps > 3) {
      return { status: 'invalid', phases: [], autoConfirmed: false, reason: 'invalid_revision_plan' };
    }
    const intervalMonths = Number.isInteger(toNumber(payload.intervalMonths)) ? toNumber(payload.intervalMonths) : 12;
    const difference = targetMonthlyFee - currentMonthlyFee;
    const phases = [];
    for (let index = 1; index <= steps; index += 1) {
      const amount = index === steps ? targetMonthlyFee : Math.round(currentMonthlyFee + difference * index / steps);
      phases.push({
        step: index,
        amount: amount,
        effectiveDate: addMonths(payload.startDate, (index - 1) * intervalMonths),
        editable: true,
        confirmed: false
      });
    }
    return {
      status: 'calculated',
      planType: steps === 1 ? 'lump' : (steps === 2 ? 'two' : 'three'),
      steps: steps,
      currentMonthlyFee: currentMonthlyFee,
      targetMonthlyFee: targetMonthlyFee,
      difference: difference,
      phases: phases,
      autoConfirmed: false
    };
  }

  function validateExternalOutput(input) {
    const payload = input || {};
    const errors = [];
    function add(code, message) {
      if (!errors.some(function (error) { return error.code === code; })) errors.push({ code: code, message: message });
    }
    function requiredText(value, code, message) {
      if (isMissing(value)) add(code, message);
    }

    requiredText(payload.clientName !== undefined ? payload.clientName : payload.addressee, 'client_name_missing', '宛名を入力してください。');
    requiredText(payload.quoteDate, 'quote_date_missing', '見積日を入力してください。');
    requiredText(payload.quoteNumber, 'quote_number_missing', '見積番号を入力してください。');
    requiredText(payload.effectiveDate, 'effective_date_missing', '適用開始日を入力してください。');

    const entityType = normalizeEntity(payload.entityType || payload.entity || payload.type);
    if (!entityType) add('entity_type_missing', '法人、個人又は所得税確定申告の区分を選択してください。');

    const finalMonthlyFee = toNumber(payload.finalMonthlyFee);
    if ((entityType === 'corp' || entityType === 'sole') && (!Number.isFinite(finalMonthlyFee) || finalMonthlyFee <= 0)) {
      add('final_monthly_fee_unconfirmed', '最終月次顧問料を確定してください。');
    }

    if (entityType === 'corp') {
      const filingConfirmed = payload.requiredFilingConfirmed === true
        || payload.corporateClosingSelected === true
        || payload.corporateReturnNotEngagedConfirmed === true;
      if (!filingConfirmed) add('corporate_filing_unconfirmed', '法人決算・申告業務の受託有無を確認してください。');
    }
    if (entityType === 'sole') {
      const filingConfirmed = payload.requiredFilingConfirmed === true
        || payload.soleClosingSelected === true
        || payload.soleReturnNotEngagedConfirmed === true;
      if (!filingConfirmed) add('sole_filing_unconfirmed', '所得税決算・確定申告業務の受託有無を確認してください。');
    }
    if (entityType === 'income' && payload.requiredFilingConfirmed === false) {
      add('income_filing_unconfirmed', '所得税確定申告業務の内容を確認してください。');
    }

    if (entityType === 'corp' || entityType === 'sole') {
      const taxStatus = payload.consumptionTaxStatus;
      if (!['required', 'exempt', '申告あり', '免税又は申告不要'].includes(taxStatus)) {
        add('consumption_tax_unconfirmed', '消費税申告の有無を確認してください。');
      }
    }

    const annualTotalCandidate = payload.annualTotal !== undefined
      ? payload.annualTotal
      : (payload.annualEstimateTotal !== undefined
        ? payload.annualEstimateTotal
        : (payload.estimate && (payload.estimate.subtotal !== undefined ? payload.estimate.subtotal : payload.estimate.total)));
    const annualTotal = toNumber(annualTotalCandidate);
    if (!Number.isFinite(annualTotal) || annualTotal <= 0) add('annual_total_not_positive', '年間見積額は0円を超える必要があります。');

    const bandStatus = payload.pricingBandStatus || (payload.bandResult && payload.bandResult.status);
    if (bandStatus === 'manual_required' && (!Number.isFinite(finalMonthlyFee) || finalMonthlyFee <= 0)) {
      add('manual_pricing_unconfirmed', '個別見積り対象の最終月次顧問料を手入力してください。');
    }
    if (payload.boundaryWarning === true && payload.finalFeeConfirmed !== true) {
      add('boundary_fee_unconfirmed', '料金帯の境界付近のため、最終月次顧問料を確認してください。');
    }

    if (payload.specialPriceConfirmed === false) {
      add('special_price_unconfirmed', '特殊業務の単価を確認してください。');
    }
    if (Array.isArray(payload.specialServices)) {
      payload.specialServices.forEach(function (service) {
        if (service && service.selected === true && service.priceConfirmationRequired === true && service.priceConfirmed !== true) {
          add('special_price_unconfirmed', '特殊業務の単価を確認してください。');
        }
      });
    }

    const forbiddenStrings = ['宛名未入力', '別途お見積り', '未確認', '＿＿', '〇〇'];
    const textSources = [
      payload.clientName,
      payload.addressee,
      payload.outputText,
      payload.externalDocumentText,
      payload.renderedText
    ].filter(function (value) { return typeof value === 'string'; });
    forbiddenStrings.forEach(function (forbidden) {
      if (textSources.some(function (text) { return text.includes(forbidden); })) {
        add('forbidden_placeholder', '外部出力に未確定の文字列「' + forbidden + '」が残っています。');
      }
    });

    return {
      allowed: errors.length === 0,
      valid: errors.length === 0,
      errors: errors,
      errorCodes: errors.map(function (error) { return error.code; })
    };
  }

  return Object.freeze({
    annualizeValue: annualizeValue,
    calculateValueAdded: calculateValueAdded,
    determinePricingBand: determinePricingBand,
    findBoundaryWarning: findBoundaryWarning,
    formatBandLabel: formatBandLabel,
    calculateServiceFee: calculateServiceFee,
    calculateConsumptionTax: calculateConsumptionTax,
    calculateAnnualEstimate: calculateAnnualEstimate,
    calculateAdjustmentTotal: calculateAdjustmentTotal,
    calculateAnnualCost: calculateAnnualCost,
    calculateCostFloor: calculateCostFloor,
    calculateRecommendation: calculateRecommendation,
    calculateFeeDifference: calculateFeeDifference,
    buildPhasedRevision: buildPhasedRevision,
    validateExternalOutput: validateExternalOutput,
    messages: Object.freeze(MESSAGES)
  });
});
