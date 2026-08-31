import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, '..');

const configModule = await import('../pricing-config.js');
const coreModule = await import('../pricing-core.js');

// 親ディレクトリに "type": "module" がある開発環境と、
// package.jsonのないGitHub Pagesリポジトリ（CommonJS扱い）の両方に対応する。
const config = globalThis.MitsumoriPricingConfig || configModule.default || configModule;
const core = globalThis.MitsumoriPricingCore || coreModule.default || coreModule;

assert.ok(config, 'pricing-config.js をNode.jsから読み込めません。');
assert.ok(core, 'pricing-core.js をNode.jsから読み込めません。');

let passed = 0;
const failures = [];

function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`✗ ${name}`);
    console.error(error.stack || error.message || error);
  }
}

function expectBand(entityType, value, fee) {
  const result = core.determinePricingBand(entityType, value);
  assert.equal(result.status, 'calculated');
  assert.equal(result.fee, fee);
}

const corporateCases = [
  [0, 35000],
  [4999999, 35000],
  [5000000, 37000],
  [9999999, 37000],
  [10000000, 39000],
  [99999999, 55000],
  [100000000, 73000],
  [9999999999, 260000]
];
corporateCases.forEach(([value, fee]) => {
  test(`法人料金帯 ${value.toLocaleString('ja-JP')}円 → ${fee.toLocaleString('ja-JP')}円`, () => {
    expectBand('corp', value, fee);
  });
});

test('法人100億円は個別見積りで、0円に置換しない', () => {
  const result = core.determinePricingBand('corp', 10000000000);
  assert.equal(result.status, 'manual_required');
  assert.equal(result.fee, null);
  assert.equal(result.reason, 'upper_band');
});

test('法人の負の付加価値額は個別判断で、0円に置換しない', () => {
  const result = core.determinePricingBand('corp', -1);
  assert.equal(result.status, 'manual_required');
  assert.equal(result.fee, null);
  assert.match(result.message, /マイナス/);
});

const soleCases = [
  [0, 27000],
  [4999999, 27000],
  [5000000, 29000],
  [99999999, 47000]
];
soleCases.forEach(([value, fee]) => {
  test(`個人料金帯 ${value.toLocaleString('ja-JP')}円 → ${fee.toLocaleString('ja-JP')}円`, () => {
    expectBand('sole', value, fee);
  });
});

test('個人1億円は個別見積りで、0円に置換しない', () => {
  const result = core.determinePricingBand('sole', 100000000);
  assert.equal(result.status, 'manual_required');
  assert.equal(result.fee, null);
});

test('個人の負の付加価値額は0円に置換しない', () => {
  const result = core.determinePricingBand('sole', -1000000);
  assert.equal(result.status, 'manual_required');
  assert.equal(result.fee, null);
});

test('料金帯ラベルは上限を含まないことを明示する', () => {
  assert.equal(core.formatBandLabel(config.pricingBands.corp[0]), '0円以上 5,000,000円未満');
  assert.equal(core.formatBandLabel(config.pricingBands.sole.at(-1)), '100,000,000円以上');
});

test('6か月500万円を12か月換算すると1,000万円', () => {
  const result = core.annualizeValue(5000000, 6);
  assert.equal(result.status, 'calculated');
  assert.equal(result.annualizedValue, 10000000);
  assert.equal(result.isShortPeriod, true);
});

test('12か月換算は入力値と一致する', () => {
  const result = core.annualizeValue({ value: 12345678, fiscalMonths: 12 });
  assert.equal(result.annualizedValue, 12345678);
  assert.equal(result.isShortPeriod, false);
});

test('事業年度月数は1～12か月の整数に限定する', () => {
  assert.equal(core.annualizeValue(100, 0).status, 'invalid');
  assert.equal(core.annualizeValue(100, 13).status, 'invalid');
  assert.equal(core.annualizeValue(100, 6.5).status, 'invalid');
});

const zeroSoleFields = {
  preDeductionProfit: 0,
  familyEmployeeWages: 0,
  laborCosts: 0,
  interestExpense: 0,
  rentExpense: 0,
  leaseExpense: 0,
  taxesAndDues: 0,
  depreciation: 0
};

test('個人の初期設定3,000,000円を付加価値額へ加算する', () => {
  assert.equal(config.ownerLaborCompensation, 3000000);
  const result = core.calculateValueAdded({ entityType: 'sole', values: zeroSoleFields });
  assert.equal(result.status, 'calculated');
  assert.equal(result.value, 3000000);
  assert.equal(result.ownerLaborCompensation, 3000000);
});

test('事業主本人の労働対価相当額の設定変更を反映する', () => {
  const result = core.calculateValueAdded({
    entityType: 'sole',
    values: zeroSoleFields,
    ownerLaborCompensation: 4200000
  });
  assert.equal(result.value, 4200000);
});

test('付加価値項目の未入力と0円を区別する', () => {
  const complete = core.calculateValueAdded({ entityType: 'sole', values: zeroSoleFields });
  const incomplete = core.calculateValueAdded({
    entityType: 'sole',
    values: { ...zeroSoleFields, depreciation: '' }
  });
  assert.equal(complete.status, 'calculated');
  assert.equal(incomplete.status, 'invalid');
  assert.deepEqual(incomplete.missingFields, ['depreciation']);
});

test('料金帯の境界前後5％以内で警告する', () => {
  const below = core.findBoundaryWarning('corp', 4750000);
  const above = core.findBoundaryWarning('corp', 5250000);
  assert.equal(below.isNearBoundary, true);
  assert.equal(above.isNearBoundary, true);
  assert.equal(below.boundary, 5000000);
  assert.equal(above.adjacentFee, 35000);
});

test('料金帯の境界5％範囲外では警告しない', () => {
  assert.equal(core.findBoundaryWarning('corp', 4749999).isNearBoundary, false);
  assert.equal(core.findBoundaryWarning('corp', 5250001).isNearBoundary, false);
});

test('調整項目を選択して0円の場合は警告する', () => {
  const result = core.calculateAdjustmentTotal([
    { selected: true, amount: 0 },
    { selected: true, amount: 5000 },
    { selected: false, amount: 9000 }
  ]);
  assert.equal(result.monthlyAdjustmentAmount, 5000);
  assert.equal(result.hasUnsetSelectedItem, true);
  assert.match(result.warnings[0].message, /未設定/);
});

test('法人決算は設定上、初期選択かつ4か月分', () => {
  assert.equal(config.services.corporateClosing.defaultSelected, true);
  assert.equal(config.multipliers.corporateClosing, 4);
  const estimate = core.calculateAnnualEstimate({
    entityType: 'corp',
    monthlyAdvisoryFee: 35000,
    corporateClosingSelected: true,
    consumptionTaxStatus: 'exempt'
  });
  assert.equal(estimate.breakdown.corporateClosingFee, 140000);
});

test('消費税申告ありは2か月分、免税又は申告不要は0円', () => {
  const required = core.calculateAnnualEstimate({
    entityType: 'corp', monthlyAdvisoryFee: 35000, consumptionTaxStatus: 'required'
  });
  const exempt = core.calculateAnnualEstimate({
    entityType: 'corp', monthlyAdvisoryFee: 35000, consumptionTaxStatus: 'exempt'
  });
  assert.equal(required.breakdown.consumptionTaxReturnFee, 70000);
  assert.equal(exempt.breakdown.consumptionTaxReturnFee, 0);
});

test('個人顧問先は所得税決算・確定申告4か月分と消費税2か月分', () => {
  const estimate = core.calculateAnnualEstimate({
    entityType: 'sole',
    monthlyAdvisoryFee: 27000,
    soleClosingSelected: true,
    consumptionTaxStatus: 'required'
  });
  assert.equal(estimate.breakdown.soleClosingFee, 108000);
  assert.equal(estimate.breakdown.consumptionTaxReturnFee, 54000);
});

test('単発所得税確定申告は個人顧問先の4か月分を加算しない', () => {
  const estimate = core.calculateAnnualEstimate({
    entityType: 'income',
    serviceLines: [{ amount: 30000, frequency: 'annual' }]
  });
  assert.equal(estimate.breakdown.soleClosingFee, 0);
  assert.equal(estimate.subtotal, 30000);
});

test('サービス料金は月額、数量、倍率、償却資産税を計算する', () => {
  assert.equal(core.calculateServiceFee({ kind: 'monthly', price: 12000 }, { quantity: 1 }).annualAmount, 144000);
  assert.equal(core.calculateServiceFee({ kind: 'per_quantity', price: 3000 }, { quantity: 4 }).annualAmount, 12000);
  assert.equal(core.calculateServiceFee({ kind: 'monthly_multiplier', months: 4 }, { monthlyAdvisoryFee: 35000 }).annualAmount, 140000);
  assert.equal(core.calculateServiceFee({ kind: 'base_plus_extra', basePrice: 10000, extraPrice: 3000 }, { quantity: 3 }).annualAmount, 16000);
});

test('年間見積は全構成要素、消費税及び税込合計を計算する', () => {
  const estimate = core.calculateAnnualEstimate({
    entityType: 'corp',
    monthlyAdvisoryFee: 35000,
    corporateClosingFee: 140000,
    consumptionTaxReturnFee: 70000,
    yearEndAdjustmentFee: 20000,
    depreciableAssetsFee: 13000,
    softwareMonthlyFee: 15000,
    annualAdjustmentAmount: -5000,
    otherAnnualFee: 17000,
    taxRate: 0.10
  });
  assert.equal(estimate.breakdown.monthlyAdvisoryAnnual, 420000);
  assert.equal(estimate.breakdown.softwareAnnual, 180000);
  assert.equal(estimate.subtotal, 855000);
  assert.equal(estimate.consumptionTax, 85500);
  assert.equal(estimate.total, 940500);
});

test('消費税は現行と同じ四捨五入で計算する', () => {
  const tax = core.calculateConsumptionTax({ amount: 10005, taxRate: 0.10 });
  assert.equal(tax.tax, 1001);
  assert.equal(tax.total, 11006);
});

const costInput = {
  monthlyHours: { playing: 2, manager: 1, executive: 0 },
  annualHours: { playing: 10, manager: 0, executive: 0 },
  softwareItems: [{ id: 'test-software', selected: true, monthlyDirectCost: 1000 }],
  otherAnnualDirectCost: 12000,
  targetProfitRate: 30,
  overheadRate: 10,
  softwareMonthlyRevenue: 15000,
  closingFee: 140000,
  consumptionTaxReturnFee: 70000,
  yearEndAdjustmentFee: 20000,
  depreciableAssetsFee: 13000,
  otherAnnualSpotRevenue: 17000
};

test('年間直接原価、必要年間売上、非月次売上、原価下限月額を計算する', () => {
  const result = core.calculateCostFloor(costInput);
  assert.equal(result.status, 'calculated');
  assert.equal(result.monthlyLaborCost, 21000);
  assert.equal(result.annualSpotLaborCost, 60000);
  assert.equal(result.annualDirectCost, 336000);
  assert.equal(result.requiredAnnualRevenue, 560000);
  assert.equal(result.nonMonthlyRevenue, 440000);
  assert.equal(result.monthlyCostFloor, 10000);
});

test('目標利益率と間接費率の合計100％以上は算出不可', () => {
  const result = core.calculateCostFloor({ ...costInput, targetProfitRate: 60, overheadRate: 40 });
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'rate_total_at_least_100_percent');
  assert.equal(result.monthlyCostFloor, null);
});

test('ソフトウェア直接原価未設定では原価下限を確定しない', () => {
  const result = core.calculateCostFloor({
    ...costInput,
    softwareItems: [{ id: 'fx2-cloud', selected: true, monthlyDirectCost: null }]
  });
  assert.equal(result.status, 'manual_required');
  assert.equal(result.reason, 'software_direct_cost_missing');
  assert.equal(result.annualDirectCost, null);
  assert.match(result.message, /未設定/);
});

test('原価下限の計算結果が負の場合は0円にする', () => {
  const result = core.calculateCostFloor({
    monthlyHours: {},
    annualHours: {},
    otherAnnualDirectCost: 12000,
    targetProfitRate: 0,
    overheadRate: 0,
    nonMonthlyRevenue: 120000
  });
  assert.equal(result.monthlyCostFloor, 0);
  assert.ok(result.rawMonthlyCostFloor < 0);
});

test('推奨報酬は業務内容基準額と原価下限の高い方で、最終額は自動確定しない', () => {
  const result = core.calculateRecommendation({ bandFee: 39000, adjustmentAmount: 1000, costFloor: 45000 });
  assert.equal(result.basisAmount, 40000);
  assert.equal(result.recommendedMonthlyFee, 45000);
  assert.equal(result.finalMonthlyFee, null);
  assert.equal(result.finalConfirmed, false);
});

test('基準額又は原価下限を下回る最終額は例外理由を必要とする', () => {
  const withoutReason = core.calculateRecommendation({
    bandFee: 39000,
    adjustmentAmount: 1000,
    costFloor: 45000,
    finalMonthlyFee: 38000
  });
  const withReason = core.calculateRecommendation({
    bandFee: 39000,
    adjustmentAmount: 1000,
    costFloor: 45000,
    finalMonthlyFee: 38000,
    exceptionReason: '段階改定'
  });
  assert.equal(withoutReason.exceptionReasonRequired, true);
  assert.ok(withoutReason.exceptionReasons.includes('below_band_fee'));
  assert.ok(withoutReason.exceptionReasons.includes('below_cost_floor'));
  assert.equal(withoutReason.canFinalize, false);
  assert.equal(withReason.canFinalize, true);
});

test('現行報酬との差額、年間改定率及び15％超警告を計算する', () => {
  const result = core.calculateFeeDifference({ currentMonthlyFee: 35000, proposedMonthlyFee: 42000 });
  assert.equal(result.monthlyDifference, 7000);
  assert.equal(result.annualDifference, 84000);
  assert.equal(result.revisionRate, 0.2);
  assert.equal(result.largeRevisionWarning, true);
});

test('2段階・3段階の均等差額案は編集可能かつ自動確定しない', () => {
  const two = core.buildPhasedRevision({ currentMonthlyFee: 35000, targetMonthlyFee: 41000, steps: 2, startDate: '2026-10-01' });
  const three = core.buildPhasedRevision({ currentMonthlyFee: 35000, targetMonthlyFee: 41000, steps: 3, startDate: '2026-10-01' });
  assert.deepEqual(two.phases.map((phase) => phase.amount), [38000, 41000]);
  assert.deepEqual(three.phases.map((phase) => phase.amount), [37000, 39000, 41000]);
  assert.equal(three.phases[1].effectiveDate, '2027-10-01');
  assert.equal(three.phases.every((phase) => phase.editable && !phase.confirmed), true);
  assert.equal(three.autoConfirmed, false);
});

const validOutput = {
  clientName: '株式会社テスト',
  quoteDate: '2026-08-16',
  quoteNumber: 'M-2026-001',
  effectiveDate: '2026-10-01',
  entityType: 'corp',
  finalMonthlyFee: 35000,
  corporateClosingSelected: true,
  consumptionTaxStatus: 'exempt',
  annualTotal: 560000,
  pricingBandStatus: 'calculated',
  specialServices: []
};

test('必要項目が揃った外部出力を許可する', () => {
  assert.equal(core.validateExternalOutput(validOutput).allowed, true);
});

[
  ['clientName', 'client_name_missing'],
  ['quoteDate', 'quote_date_missing'],
  ['quoteNumber', 'quote_number_missing'],
  ['effectiveDate', 'effective_date_missing']
].forEach(([field, code]) => {
  test(`外部出力: ${field}未入力を禁止する`, () => {
    const result = core.validateExternalOutput({ ...validOutput, [field]: '' });
    assert.equal(result.allowed, false);
    assert.ok(result.errorCodes.includes(code));
  });
});

test('外部出力: 最終報酬未確定を禁止する', () => {
  const result = core.validateExternalOutput({ ...validOutput, finalMonthlyFee: null });
  assert.ok(result.errorCodes.includes('final_monthly_fee_unconfirmed'));
});

test('外部出力: 消費税未確認を禁止する', () => {
  const result = core.validateExternalOutput({ ...validOutput, consumptionTaxStatus: 'unconfirmed' });
  assert.ok(result.errorCodes.includes('consumption_tax_unconfirmed'));
});

test('外部出力: 年間0円を禁止する', () => {
  const result = core.validateExternalOutput({ ...validOutput, annualTotal: 0 });
  assert.ok(result.errorCodes.includes('annual_total_not_positive'));
});

test('外部出力: 個別見積りの最終額未入力を禁止する', () => {
  const result = core.validateExternalOutput({
    ...validOutput,
    pricingBandStatus: 'manual_required',
    finalMonthlyFee: null
  });
  assert.ok(result.errorCodes.includes('manual_pricing_unconfirmed'));
});

test('外部出力: 特殊業務の単価未確認を禁止する', () => {
  const result = core.validateExternalOutput({
    ...validOutput,
    specialServices: [{ selected: true, priceConfirmationRequired: true, priceConfirmed: false }]
  });
  assert.ok(result.errorCodes.includes('special_price_unconfirmed'));
});

test('外部出力: 禁止プレースホルダー文字列を検出する', () => {
  const result = core.validateExternalOutput({ ...validOutput, outputText: '月額は別途お見積りです。' });
  assert.ok(result.errorCodes.includes('forbidden_placeholder'));
});

test('外部出力: 境界付近の最終額未確認を禁止する', () => {
  const result = core.validateExternalOutput({ ...validOutput, boundaryWarning: true, finalFeeConfirmed: false });
  assert.ok(result.errorCodes.includes('boundary_fee_unconfirmed'));
});

test('現行価格、倍率、ソフトウェア請求額を変更していない', () => {
  assert.deepEqual(config.pricingBands.corp.map((band) => band.fee), [35000, 37000, 39000, 41000, 45000, 49000, 55000, 73000, 89000, 105000, 119000, 125000, 143000, 170000, 215000, 260000, null]);
  assert.deepEqual(config.pricingBands.sole.map((band) => band.fee), [27000, 29000, 31000, 33000, 37000, 41000, 47000, null]);
  assert.equal(config.multipliers.corporateClosing, 4);
  assert.equal(config.multipliers.consumptionTaxReturn, 2);
  assert.deepEqual(config.services.software.slice(0, 3).map((item) => item.monthlyBillingPrice), [60000, 15000, 12000]);
  assert.deepEqual(config.services.software.slice(0, 3).map((item) => item.monthlyDirectCost), [null, null, null]);
});

test('見込客確認モード追加後も価格表版はr6.0を維持する', () => {
  assert.equal(config.appVersion, 'r6.1');
  assert.equal(config.priceMaster.priceTableVersion, 'r6.0');
});

test('localStorage.clear()を使用していない', () => {
  // 非同期検証は末尾の専用処理で行うため、ここでは設定キーの安全性を確認する。
  assert.equal(config.storageKeys.all.length > 0, true);
});

test('削除対象キーはmitsumori専用キー又は既存の2キーだけ', () => {
  const legacyKeys = new Set(['mk_ent', 'mk_cost_state']);
  config.storageKeys.all.forEach((key) => {
    assert.ok(legacyKeys.has(key) || key.startsWith('mk_mitsumori_'), `許可されていない削除対象キー: ${key}`);
  });
});

try {
  const sourceFiles = ['index.html', 'pricing-config.js', 'pricing-core.js', 'app.js'];
  for (const fileName of sourceFiles) {
    try {
      const source = await readFile(join(repositoryRoot, fileName), 'utf8');
      assert.doesNotMatch(source, /localStorage\s*\.\s*clear\s*\(/, `${fileName} に localStorage.clear() が残っています。`);
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }
  console.log('✓ ソース全体に localStorage.clear() がない');
  passed += 1;
} catch (error) {
  failures.push({ name: 'ソース全体のlocalStorage.clear()検査', error });
  console.error('✗ ソース全体のlocalStorage.clear()検査');
  console.error(error.stack || error.message || error);
}

try {
  const [htmlSource, appSource] = await Promise.all([
    readFile(join(repositoryRoot, 'index.html'), 'utf8'),
    readFile(join(repositoryRoot, 'app.js'), 'utf8')
  ]);
  assert.match(htmlSource, /data-interaction-mode="prospect"/);
  assert.match(htmlSource, /id="prospect-summary"/);
  assert.match(htmlSource, /class="card internal-mode-only" id="cost-section"/);
  assert.match(htmlSource, /class="card internal-mode-only" id="validation-section"/);
  assert.match(htmlSource, /class="field internal-mode-only"><span class="field-name">松本会計の月額直接原価/);
  assert.match(appSource, /function setInteractionMode\(/);
  assert.match(appSource, /function renderProspectSummary\(/);
  assert.match(appSource, /config\.multipliers\.corporateClosing/);
  assert.match(appSource, /config\.multipliers\.consumptionTaxReturn/);
  console.log('✓ 見込客確認モードと社内情報の表示分離を実装している');
  passed += 1;
} catch (error) {
  failures.push({ name: '見込客確認モードのソース検査', error });
  console.error('✗ 見込客確認モードのソース検査');
  console.error(error.stack || error.message || error);
}

if (failures.length) {
  console.error(`\n${passed}件成功 / ${failures.length}件失敗`);
  process.exitCode = 1;
} else {
  console.log(`\n全${passed}件の料金計算検証に成功しました。`);
}
