export type NativePaymentKind =
  'CENTER' | 'COURSE' | 'MEMBERSHIP' | 'PHYSICAL' | 'DIGITAL' | 'BOOKING' | 'COHORT';
export const nativeOrderPaths: Record<string, string> = {
  CENTER: '/membership-center/orders/',
  COURSE: '/commerce/course-orders/',
  MEMBERSHIP: '/commerce/membership-orders/',
  PHYSICAL: '/commerce/product-orders/',
  DIGITAL: '/commerce/digital-orders/',
  BOOKING: '/commerce/booking-orders/',
  COHORT: '/commerce/cohort-orders/',
};
export function openNativePayment(kind: NativePaymentKind, id: string): Promise<void> {
  return new Promise((resolve, reject) =>
    uni.navigateTo({
      url: '/pages/payment/native?kind=' + kind + '&id=' + encodeURIComponent(id),
      success: () => resolve(),
      fail: () => reject(new Error('无法打开微信付款码，请返回订单重试')),
    }),
  );
}
