import { BadRequestException, Body, ConflictException, Controller, Injectable, NotFoundException, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { PaymentChannels } from './payment-channels.js';
import { CourseSalesService } from './course-sales.js';
import { MembershipSalesService } from './membership-sales.js';
import { ProductSalesService } from './product-sales.js';
import { BookingSalesService } from './booking-sales.js';
import { CohortSalesService } from './cohort-sales.js';
import { DigitalSales } from './digital-sales.js';

const enabled = () => process.env.PAYMENT_SIMULATION_ENABLED === 'true';

/**
 * 模拟收款：只走业务服务真正的“已验证收款”入口，所有资金事实标记为 SIMULATED。
 * 用于没有真实商户号时跑通购买→授权→退款链路，不产生真实资金。
 */
@Injectable()
export class PaymentSimulation {
  constructor(
    private readonly db: Database,
    private readonly channels: PaymentChannels,
    private readonly courses: CourseSalesService,
    private readonly memberships: MembershipSalesService,
    private readonly products: ProductSalesService,
    private readonly bookings: BookingSalesService,
    private readonly cohorts: CohortSalesService,
    private readonly digital: DigitalSales,
  ) {}

  private target(kind: string) {
    if (kind === 'COURSE') return this.courses;
    if (kind === 'MEMBERSHIP') return this.memberships;
    if (kind === 'PHYSICAL') return this.products;
    if (kind === 'EVENT' || kind === 'CONSULTATION') return this.bookings;
    if (kind === 'COHORT') return this.cohorts;
    if (kind === 'DIGITAL') return this.digital;
    return null;
  }

  async pay(orderId: string, actorId: string) {
    if (!enabled()) throw new ServiceUnavailableException('模拟收款未开启');
    const order = await this.db.tradeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.state !== 'PENDING') throw new ConflictException('订单当前不可支付');
    const service = this.target(order.kind);
    if (!service) throw new BadRequestException('该订单类型暂不支持模拟收款');
    const attempt = (await this.db.paymentAttempt.findFirst({ where: { orderId, channel: 'SIMULATED' } })) ?? await this.db.paymentAttempt.create({
      data: {
        orderId,
        channel: 'SIMULATED',
        requestKey: 'sim-' + randomUUID(),
        state: 'CREATED',
        amount: order.payableTotal,
        currency: order.currency,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    const total = Number(order.payableTotal);
    const data = {
      appid: 'SIMULATED',
      mchid: 'SIMULATED',
      out_trade_no: order.orderNo,
      trade_type: 'APP',
      trade_state: 'SUCCESS',
      transaction_id: 'SIM-' + randomUUID(),
      success_time: new Date().toISOString(),
      amount: { total, currency: order.currency },
    };
    const result = await service.confirmPayment(data as never, undefined, 'SIMULATED' as never);
    await this.db.auditLog.create({
      data: {
        actorId,
        action: 'payment.simulated',
        resource: 'trade_order',
        resourceId: order.id,
        changes: { amount: total, channel: 'SIMULATED', attemptId: attempt.id, kind: order.kind },
      },
    });
    return { orderId: order.id, orderNo: order.orderNo, kind: order.kind, amount: total, channel: 'SIMULATED', result };
  }
}

@Controller('admin/payments')
@UseGuards(AdminGuard)
export class PaymentSimulationController {
  constructor(private readonly simulation: PaymentSimulation) {}

  @Post('simulate')
  simulate(@Req() req: AuthRequest, @Body() body: { orderId?: string }) {
    requireRoles(req, ['ADMIN', 'FINANCE']);
    if (!body?.orderId) throw new BadRequestException('缺少订单号');
    return this.simulation.pay(body.orderId, req.actor.id);
  }
}
