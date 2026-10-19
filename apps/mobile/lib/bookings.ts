export type Offering={id:string;version:number;title:string;teacherName:string;mode:string;durationMinutes:number;leadMinutes:number;cancelBeforeMinutes:number;locationPolicy:string;deliveryPolicy:string;price:number|null;bookingEnabled:boolean};
export type Slot={id:string;startsAt:string;endsAt:string;available:number;state:string;version:number};
export type Ticket={purchaseAvailable:boolean;id:string;title:string;price:number|null;available:number;perUserLimit:number;bookingEnabled:boolean};
export type EventSession={id:string;startsAt:string;endsAt:string;location:string;cancelDeadline:string;publicOpenAt:string;memberOpenAt:string|null;priorityEligible:boolean;priorityWindow:boolean;serverTime:string;available:number;tickets:Ticket[]};
export type Booking={pointsCost?:string|null;pointsRedemptionId?:string|null;orderId?:string|null;id:string;kind:string;title:string;startsAt:string;endsAt:string;location:string;policy:string;quantity:number;state:string;cancelAt:string;canCancel:boolean;checkedCount:number;fulfilment?:{revision:number;outcome:string;deliveredCount:number;publicSummary:string;createdAt:string}|null;originalStartsAt:string;originalEndsAt:string;changeReason:string|null;scheduleVersion:number;scheduleCancelled?:boolean;schedulePending:boolean};
export const bookingStates:Record<string,string>={CONFIRMED:'已确认',PENDING:'待确认',CANCEL_PENDING:'取消处理中',CANCELLED:'已取消',COMPLETED:'已完成',NO_SHOW:'未到场',REFUNDED:'已退款'};

export const fulfilmentOutcomes:Record<string,string>={COMPLETED:'服务已完成',PARTIAL:'部分完成',NOT_DELIVERED:'到场未交付',NO_SHOW:'未到场'};
