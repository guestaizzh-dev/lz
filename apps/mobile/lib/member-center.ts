import { request } from './api';
export type MemberGrade = {
  tier: number;
  title: string;
  price: number;
  voucherQuantity: number;
  goodsBasisPoints: number;
  bookBasisPoints: number;
  active: boolean;
  version: number;
};
export type LongTermMember = {
  id: string;
  tier: number;
  priceCredit: number;
  giftTarget: number;
  state: string;
  createdAt: string;
  orderId: string;
};
export type CenterOverview = {
  serviceReady?: boolean;
  displayTier?: number;
  grades: MemberGrade[];
  member: LongTermMember | null;
  voucher: {
    value: number;
    price: number;
    availableValue?: number;
    title?: string;
    active?: boolean;
    available: number;
    held: number;
    used: number;
    refundHeld: number;
    expiresAt: null;
  };
  longTerm: boolean;
  refundPolicy: string;
};
export type CenterTerms = {
  kind: string;
  title: string;
  tier: number;
  quantity: number;
  price: number;
  giftQuantity: number;
  previousId: string | null;
  voucherPolicy?: { version: number; price: number; faceValue: number; title: string };
  grade: {
    price: number;
    voucherQuantity: number;
    goodsBasisPoints: number;
    bookBasisPoints: number;
    version: number;
  } | null;
};
export type CenterQuote = CenterTerms & {
  quoteHash: string;
  paymentEnabled: boolean;
  channel: string;
  unavailableReason: string;
};
export type VoucherLot = {
  id: string;
  orderId: string;
  quantity: number;
  remaining: number;
  used: number;
  held: number;
  refunded: number;
  refundHeld: number;
  suspended: boolean;
  source: string;
  faceValue: number;
  unitPrice: number;
  createdAt: string;
};
export type CenterRefund = {
  id: string;
  state: string;
  version: number;
  requestedAmount: string;
  approvedAmount: string | null;
  description: string;
  reviewNote: string | null;
  createdAt: string;
};
export type CenterOrder = {
  id: string;
  orderNo: string;
  state: string;
  version: number;
  amount: string;
  paidAmount: string;
  refundedAmount: string;
  terms: CenterTerms;
  channel: string;
  paidAt: string | null;
  createdAt: string;
  canPay: boolean;
  canCancel: boolean;
  canRefund: boolean;
  lot: VoucherLot | null;
  member: LongTermMember | null;
  refunds: CenterRefund[];
};
export const gradeNames = ['注册会员', '铜牌会员', '银牌会员', '金牌会员', '钻石会员'];
export const discountText = (rate: number) =>
  rate === 10000 ? '原价' : (rate / 1000).toFixed(1).replace(/\.0$/, '') + '折';
export async function getMemberOverview(authenticated: boolean): Promise<CenterOverview> {
  try {
    return await request<CenterOverview>('/membership-center');
  } catch (e) {
    if ((e as Error & { status?: number }).status !== 404) throw e;
    // The App may be installed before the matching service release. These approved terms are preview only.
    const legacy = authenticated
      ? await request<{ tier: number } | null>('/learning/membership')
      : null;
    const terms = [
      [36500, 50, 9500, 9900],
      [99800, 100, 9000, 9800],
      [168000, 200, 8500, 9700],
      [298000, 300, 8000, 9600],
    ];
    return {
      serviceReady: false,
      displayTier: legacy?.tier ?? 0,
      grades: terms.map((r, i) => ({
        tier: i + 1,
        title: gradeNames[i + 1],
        price: r[0],
        voucherQuantity: r[1],
        goodsBasisPoints: r[2],
        bookBasisPoints: r[3],
        active: false,
        version: 0,
      })),
      member: null,
      voucher: {
        value: 300,
        price: 300,
        available: 0,
        held: 0,
        used: 0,
        refundHeld: 0,
        expiresAt: null,
      },
      longTerm: true,
      refundPolicy:
        '会员开通及升级付款7天内未使用本次权益可退；升级退款恢复原等级。独立购券按未使用且未占用份数原路退回。',
    };
  }
}
