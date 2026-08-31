(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = config;
  } else {
    root.MitsumoriPricingConfig = config;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  const pricingBands = {
    corp: [
      { min: 0, max: 5000000, fee: 35000 },
      { min: 5000000, max: 10000000, fee: 37000 },
      { min: 10000000, max: 20000000, fee: 39000 },
      { min: 20000000, max: 30000000, fee: 41000 },
      { min: 30000000, max: 50000000, fee: 45000 },
      { min: 50000000, max: 70000000, fee: 49000 },
      { min: 70000000, max: 100000000, fee: 55000 },
      { min: 100000000, max: 200000000, fee: 73000 },
      { min: 200000000, max: 300000000, fee: 89000 },
      { min: 300000000, max: 500000000, fee: 105000 },
      { min: 500000000, max: 700000000, fee: 119000 },
      { min: 700000000, max: 1000000000, fee: 125000 },
      { min: 1000000000, max: 2000000000, fee: 143000 },
      { min: 2000000000, max: 3000000000, fee: 170000 },
      { min: 3000000000, max: 5000000000, fee: 215000 },
      { min: 5000000000, max: 10000000000, fee: 260000 },
      { min: 10000000000, max: Infinity, fee: null }
    ],
    sole: [
      { min: 0, max: 5000000, fee: 27000 },
      { min: 5000000, max: 10000000, fee: 29000 },
      { min: 10000000, max: 20000000, fee: 31000 },
      { min: 20000000, max: 30000000, fee: 33000 },
      { min: 30000000, max: 50000000, fee: 37000 },
      { min: 50000000, max: 70000000, fee: 41000 },
      { min: 70000000, max: 100000000, fee: 47000 },
      { min: 100000000, max: Infinity, fee: null }
    ]
  };

  const commonValueAddedFields = [
    {
      key: 'laborCosts',
      label: '人件費',
      required: true,
      allowNegative: false,
      minimum: 0,
      help: '役員報酬、給与、賞与、法定福利費及び福利厚生費を含めるかは、確定した所内方針に従ってください。現在は所内定義の設定が必要です。',
      scopeStatus: 'internal_policy_required'
    },
    {
      key: 'interestExpense',
      label: '支払利息',
      required: true,
      allowNegative: false,
      minimum: 0,
      help: '割引料その他を含めるかは、確定した所内方針に従ってください。現在は所内定義の設定が必要です。',
      scopeStatus: 'internal_policy_required'
    },
    {
      key: 'rentExpense',
      label: '賃借料',
      required: true,
      allowNegative: false,
      minimum: 0,
      help: 'リース料との二重計上を避けてください。'
    },
    {
      key: 'leaseExpense',
      label: 'リース料',
      required: true,
      allowNegative: false,
      minimum: 0,
      help: '賃借料との二重計上を避けてください。'
    },
    { key: 'taxesAndDues', label: '租税公課', required: true, allowNegative: false, minimum: 0 },
    { key: 'depreciation', label: '減価償却費', required: true, allowNegative: false, minimum: 0 }
  ];

  const valueAddedFields = {
    corp: [
      {
        key: 'ordinaryProfit',
        label: '経常利益',
        required: true,
        allowNegative: true,
        minimum: null,
        help: '臨時的な営業外損益等により大きく変動する場合は、直近1期だけでなく複数期平均の検討が必要です。'
      }
    ].concat(commonValueAddedFields),
    sole: [
      {
        key: 'preDeductionProfit',
        label: '青色申告特別控除前の所得金額',
        required: true,
        allowNegative: true,
        minimum: null,
        help: '臨時的な損益等により大きく変動する場合は、直近1期だけでなく複数期平均の検討が必要です。'
      },
      { key: 'familyEmployeeWages', label: '青色事業専従者給与', required: true, allowNegative: false, minimum: 0 }
    ].concat(commonValueAddedFields)
  };

  const software = [
    { id: 'fx4-cloud', name: 'FX4クラウド', monthlyBillingPrice: 60000, monthlyDirectCost: null },
    { id: 'fx2-cloud', name: 'FX2クラウド', monthlyBillingPrice: 15000, monthlyDirectCost: null },
    { id: 'fx-my-star-cloud', name: 'FXまいスタークラウド', monthlyBillingPrice: 12000, monthlyDirectCost: null },
    { id: 'custom', name: '任意追加ソフト', monthlyBillingPrice: null, monthlyDirectCost: null, editable: true }
  ];

  const incomeTaxReturnItems = [
    { id: 'income-basic', name: '所得税確定申告 基本報酬', kind: 'spot', price: 30000, pricingRole: 'base', requiresBase: false, note: '給与・年金・医療費・寄附金控除等の一般申告' },
    { id: 'real-estate-income', name: '不動産所得加算', kind: 'spot', price: 20000, pricingRole: 'addon', requiresBase: true, note: '収支内訳書又は青色申告決算書の作成を要するもの' },
    { id: 'additional-property', name: '物件数加算（2件目以降）', kind: 'per_quantity', price: 5000, pricingRole: 'addon', requiresBase: true, note: '賃貸物件・駐車場等が複数ある場合（5,000円／件）' },
    { id: 'depreciation-loan-review', name: '減価償却・借入金確認加算', kind: 'spot', price: 5000, pricingRole: 'addon', requiresBase: true, note: '減価償却資産明細、借入金利子、修繕費等の確認を要する場合' },
    { id: 'stock-transfer', name: '株式譲渡加算', kind: 'spot', price: 20000, pricingRole: 'addon', requiresBase: true, note: '上場株式等の譲渡所得計算を要する場合' },
    { id: 'real-estate-transfer', name: '土地建物等譲渡所得加算', kind: 'spot', price: 50000, pricingRole: 'addon', requiresBase: true, minimumPrice: true, priceConfirmationRequired: true, editable: true, note: '取得費・譲渡費用・特例判定等を要するもの（50,000円〜）' },
    { id: 'inherited-property-special-rule', name: '相続財産取得費加算の特例加算', kind: 'spot', price: 30000, pricingRole: 'addon', requiresBase: true, minimumPrice: true, priceConfirmationRequired: true, editable: true, note: '相続財産を譲渡した場合の取得費加算の特例（30,000円〜）' },
    { id: 'first-year-engagement', name: '初年度受託加算', kind: 'spot', price: 10000, pricingRole: 'addon', requiresBase: true, note: '資料整理・前提確認に手間を要する場合' },
    { id: 'blue-return-application', name: '青色申告承認申請書提出', kind: 'spot', price: 5000, pricingRole: 'addon', requiresBase: true, note: '新規に青色申告承認申請書を提出する場合' },
    { id: 'housing-loan-first-year', name: '住宅ローン控除（初年度）', kind: 'spot', price: 20000, pricingRole: 'addon', requiresBase: true, note: '通常の初年度申告。計算明細書・残高証明書等の確認を含む' },
    { id: 'housing-loan-certified', name: '住宅ローン控除（初年度・認定住宅等）', kind: 'spot', price: 25000, pricingRole: 'addon', requiresBase: true, minimumPrice: true, priceConfirmationRequired: true, editable: true, note: '認定住宅、補助金確認、添付資料が多い場合（25,000〜30,000円）' },
    { id: 'housing-loan-later', name: '住宅ローン控除（2年目以降）', kind: 'spot', price: 5000, pricingRole: 'addon', requiresBase: true, editable: true, note: '年末調整で処理できない場合の確定申告対応（5,000〜10,000円）' },
    { id: 'year-end-document-review', name: '年調書類確認のみ', kind: 'spot', price: 3000, pricingRole: 'standalone', requiresBase: false, editable: true, note: '申告作成を伴わない軽微対応（3,000〜5,000円）' },
    { id: 'simultaneous-engagement-adjustment', name: '同時受託調整', kind: 'spot', price: -5000, pricingRole: 'adjustment', requiresBase: true, editable: true, note: '夫婦・親族等で同時受託する場合の配慮（▲5,000〜▲10,000円）' },
    { id: 'organized-material-adjustment', name: '資料整理済み調整', kind: 'spot', price: -5000, pricingRole: 'adjustment', requiresBase: true, note: 'Excel等で収入・経費が整理済みで確認中心の場合（▲5,000円）' },
    { id: 'material-deficiency', name: '資料不備・再整理対応加算', kind: 'spot', price: 5000, pricingRole: 'addon', requiresBase: true, minimumPrice: true, priceConfirmationRequired: true, editable: true, note: '資料不足、再集計、問い合わせ往復が多い場合（5,000〜10,000円）' }
  ];

  const adjustmentCategoryDefinitions = {
    '記帳・資料負荷': ['記帳代行', '証憑整理', '現金取引が多い', '資料提出が遅い', '資料不備・再提出が多い', '仕訳量が多い'],
    '事業・組織規模': ['複数店舗・複数拠点', '部門別管理', '多数の銀行口座', '関連会社', '複数事業', '従業員数が多い'],
    '税務難易度': ['輸出入', '消費税還付', '税額控除', '補助金・圧縮記帳', '組織再編', 'グループ通算', '特殊な資本取引', '税務調査リスクが高い'],
    '経営支援': ['予算策定', '継続MAS', '経営会議への参加', '資金繰り支援', '金融機関対応', '部門別業績管理', '事業承継支援'],
    '対応負荷': ['臨時相談が多い', '緊急対応が多い', '経営者以外との調整が多い', '担当者変更が多い', '訪問時間・移動負担が大きい']
  };

  const adjustmentCategories = Object.keys(adjustmentCategoryDefinitions).map(function (category, categoryIndex) {
    return {
      id: 'adjustment-category-' + (categoryIndex + 1),
      label: category,
      items: adjustmentCategoryDefinitions[category].map(function (label, itemIndex) {
        return {
          id: 'adjustment-' + (categoryIndex + 1) + '-' + (itemIndex + 1),
          label: label,
          defaultMonthlyAmount: 0,
          memo: ''
        };
      })
    };
  });

  const storageKeys = {
    sessionQuote: 'mk_mitsumori_session_quote',
    restoreOnce: 'mk_mitsumori_restore_once',
    preferences: 'mk_mitsumori_preferences',
    legacyEntity: 'mk_ent',
    legacyCostState: 'mk_cost_state',
    state: 'mk_mitsumori_state',
    quote: 'mk_mitsumori_quote',
    adjustments: 'mk_mitsumori_adjustments',
    costAnalysis: 'mk_mitsumori_cost_analysis',
    all: [
      'mk_ent',
      'mk_cost_state',
      'mk_mitsumori_state',
      'mk_mitsumori_quote',
      'mk_mitsumori_adjustments',
      'mk_mitsumori_cost_analysis'
    ]
  };

  const priceMaster = {
    priceTableVersion: 'r6.0',
    effectiveDate: '',
    lastReviewedDate: '',
    approvedBy: '',
    notes: 'r5.0時点の現行所内標準価格を据え置いて移管。適用開始日、最終確認日及び承認者は所内設定が必要です。'
  };

  return deepFreeze({
    appVersion: 'r6.3',
    taxRate: 0.10,
    priceMaster: priceMaster,
    priceTableVersion: priceMaster.priceTableVersion,
    effectiveDate: priceMaster.effectiveDate,
    lastReviewedDate: priceMaster.lastReviewedDate,
    approvedBy: priceMaster.approvedBy,
    notes: priceMaster.notes,
    pricingBands: pricingBands,
    multipliers: {
      corporateClosing: 4,
      consumptionTaxReturn: 2,
      soleProprietorClosingAndReturn: 4
    },
    boundaryWarningRate: 0.05,
    ownerLaborCompensation: 3000000,
    ownerLaborCompensationSettings: {
      label: '事業主本人の労働対価相当額',
      description: '個人事業者について、法人の役員報酬に相当する事業主本人の労働対価を報酬算定上加算します。',
      editable: true,
      allowNegative: false,
      minimum: 0
    },
    internalModeTimeoutMinutes: 15,
    internalAccessConfirmationCode: '',
    internalDisplayConfirmationPhrase: '所内詳細を表示',
    standardCostRates: {
      playing: 6000,
      manager: 9000,
      executive: 15000
    },
    valueAddedFields: valueAddedFields,
    valueAddedDefinition: {
      label: '松本会計報酬算定上の付加価値額',
      notice: '本指標は、税理士法人松本会計が標準報酬を検討するための内部算定指標です。統計法令その他で定められた唯一の付加価値額ではありません。'
    },
    services: {
      monthlyAdvisory: { id: 'monthly-advisory', name: '月次顧問料', kind: 'monthly', price: null },
      corporateClosing: { id: 'corporate-closing', name: '法人決算・申告一式', kind: 'monthly_multiplier', months: 4, defaultSelected: true },
      soleProprietorClosingAndReturn: { id: 'sole-closing-return', name: '所得税決算・確定申告一式', kind: 'monthly_multiplier', months: 4, defaultSelected: true },
      consumptionTaxReturn: { id: 'consumption-tax-return', name: '消費税申告書作成', kind: 'monthly_multiplier', months: 2 },
      yearEndAdjustment: {
        basic: { id: 'year-end-adjustment-basic', name: '年末調整 基本料金', kind: 'spot', price: 20000 },
        withholdingSlip: { id: 'withholding-slip', name: '源泉徴収票発行人数', kind: 'per_quantity', price: 3000 },
        scope: [
          '扶養控除等申告書等の確認',
          '源泉徴収票作成',
          '給与支払報告書',
          '法定調書合計表',
          '電子申告又は提出'
        ],
        scopeStatus: 'internal_policy_required'
      },
      depreciableAssets: { id: 'depreciable-assets', name: '償却資産税申告', kind: 'base_plus_extra', basePrice: 10000, extraPrice: 3000 },
      software: software,
      incomeTaxReturn: incomeTaxReturnItems
    },
    adjustmentCategories: adjustmentCategories,
    consumptionTaxStatuses: {
      exempt: '免税又は申告不要',
      required: '申告あり',
      unconfirmed: '未確認'
    },
    outputTypes: {
      customerQuote: '顧客向け見積書のみ',
      customerQuoteWithBasis: '顧客向け見積書＋算定根拠',
      internalFull: '社内用見積書＋算定根拠＋原価分析'
    },
    storageKeys: storageKeys
  });
});
