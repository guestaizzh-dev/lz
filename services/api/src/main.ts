import {ClientDiagnosticsController} from './client-diagnostics.js';
import {OperationsIncidents,OperationsIncidentsController} from './operations-incidents.js';
import {ReconciliationService,ReconciliationController} from './reconciliation.js';
import {PartnerCommerce,PartnerCommerceController} from './partner-commerce.js';
import {Categories,CategoriesCatalogController,CategoriesAdminController} from './categories.js';
import {PublicImages,ImagesAdminController,ImagesPublicController} from './public-images.js';
import {LiveBroadcasts,LiveBroadcastController} from './live-broadcasts.js';
import {LiveRecordings} from './live-recordings.js';
import {OfflineCourses,OfflineCourseCatalogController,OfflineCourseLearnerController,OfflineCourseAdminController} from './offline-courses.js';
import {ConsumptionRewards,ConsumptionRuleController,ConsumptionAdminController} from './consumption-rewards.js';
import {AppleRefundReviews,AppleRefundReviewsController} from './apple-refund-reviews.js';
import {MemberGifts,MemberGiftsController,MemberGiftsAdminController} from './member-gifts.js';
import {OperatingCommerce,OperatingCommerceAdminController} from './operating-commerce.js';
import {Advertising,AdvertisingController,AdvertisingAdminController} from './advertising.js';
import {CharitySettlementsController} from './charity-settlements.js';
import {Charity,CharityCatalogController,CharityController,CharityAdminController} from './charity.js';
import {ProductPromotions,ProductPromotionsAdminController} from './product-promotions.js';
import {PointsRedemptions,PointsRewardsCatalogController,PointsRedemptionsController,PointsRewardsAdminController} from './points-redemptions.js';
import {Referrals,ReferralsController,ReferralsAdminController,ReferralLandingController} from './referrals.js';
import {Logistics,LogisticsController,LogisticsAdminController} from './logistics.js';
import {CourseCaseTeachingController,CommunityEnhancements,CommunityEnhancementsCatalogController,CommunityEnhancementsController,CommunityEnhancementsAdminController} from './community-enhancements.js';
import {GroupPurchases,GroupCatalogController,GroupAdminController} from './group-purchases.js';
import {MarketingService,MarketingCatalogController,MarketingController,MarketingAdminController} from './marketing.js';
import {Notifications,NotificationsController} from './notifications.js';
import { MediaIngest, MediaIngestController, ForumMediaIngestController, HomeHeroUploadController } from './media-ingest.js';
import {BookingSalesService,BookingSalesController,BookingOrdersAdminController} from './booking-sales.js';
import { OperationsAdmin, OperationsAdminController, FinanceAdminController } from './operations-admin.js';
import {CohortSalesService,CohortSalesController,CohortOrdersAdminController} from './cohort-sales.js';
import {EventOperationsService,EventStaffController,EventCredentialController,EventWorkbenchController,EventWorkbenchAdminController} from './event-operations.js';
import { CohortsService, CohortsCatalogController, CohortsController, CohortsAdminController } from './cohorts.js';
import { BookingsService, BookingsCatalogController, BookingsController, BookingsAdminController } from './bookings.js';
import { ContentRelationsController } from './content-relations.js';
import 'reflect-metadata';
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common';
import { AdminAudit } from './admin-audit.js';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Database } from './database.js';
import { MembershipBenefitsService, MembershipBenefitsController, MembershipBenefitsAdminController } from './membership-benefits.js';
import { MembershipSalesService, MembershipSalesController, MembershipOrdersAdminController } from './membership-sales.js';
import { CatalogController, CatalogService } from './catalog.js';
import { AuthService, AdminGuard, UserGuard, OptionalUserGuard, AdminAuthController } from './auth.js';
import { LearningController, LearningService } from './learning.js';
import { CurriculumAdminController, CurriculumAdminService } from './curriculum-admin.js';
import { MediaController, MediaService } from './media.js';
import { ShoppingController, ShoppingAdminController, ShoppingService } from './shopping.js';
import { OrdersController, OrdersAdminController, OrdersService } from './orders.js';
import { ProductSalesService, ProductSalesController, ProductOrdersAdminController } from './product-sales.js';
import { IdentityController, IdentityService } from './identity.js';
import {SocialAuth,SocialAuthController,SocialBindingController} from './social-auth.js';
import {LoginProviders} from './login-providers.js';
import {OfflineLicenses,OfflineLicensesController} from './offline-licenses.js';
import {LiveMics,LiveMicsController,LiveMicsAdminController} from './live-mics.js';
import {ConsultRtc,ConsultRtcController} from './consult-rtc.js';
import {Gifts,GiftsController,GiftsFinanceController} from './gifts.js';
import {GiftSettlementsController} from './gift-settlements.js';
import {GiftsAdminController} from './gifts-admin.js';
import { PersonalController } from './personal.js';
import { AdminController, AdminService } from './admin.js';
import { pathToFileURL } from 'node:url';
import { DomainController, DomainService } from './domain.js';
import { TeachingAdminController, TeachingController, TeachingService } from './teaching.js';
import { CommentAdminController, ArticleInteractionController, ContentService } from './content.js';
import { ReadingController, DiscoveryController, DiscoveryService } from './discovery.js';
import { EditorialController, LiveDiscoveryAdminController } from './editorial.js';
import {ServiceDeliveries,ServiceDeliveriesAdminController} from './service-deliveries.js';
import { ProgressionController } from './progression.js';
import { FeedbackController, FeedbackAdminController, FeedbackService } from './feedback.js';
import { PracticesController, PracticesAdminController, PracticesService } from './practices.js';
import { QuestionsController, QuestionsAdminController, QuestionsService } from './questions.js';
import { ForumController, ForumAdminController, ForumService } from './forum.js';
import { ShareController, ShareService } from './share.js';
import { validateProductionConfig } from './runtime-config.js';
import { CourseReviewsService, CourseReviewsController, CourseReviewsAdminController } from './course-reviews.js';
import { CourseSalesService, CourseSalesController, CourseOrdersAdminController, WechatCallbackController, AlipayCallbackController } from './course-sales.js';
import { CourseVersionsService, CourseVersionsController, CourseVersionsAdminController } from './course-versions.js';
import { WechatPayService } from './wechat-pay.js';
import { PaymentChannels } from './payment-channels.js';
import { PaymentSimulation, PaymentSimulationController } from './payment-simulation.js';
import { DigitalGoods, DigitalController, DigitalAdminController } from './digital.js';
import { DigitalSales, DigitalSalesController, DigitalOrdersAdminController } from './digital-sales.js';
import { AlipayService } from './alipay.js';
import { AppleStoreService } from './apple-store.js';
import { AppleCommerceService, AppleCommerceController, AppleCallbackController, AppleProductsController, AppleTransactionsController, AppleMembershipProductsController } from './apple-commerce.js';
import { AppleMembershipService } from './apple-membership.js';
import { randomUUID } from 'node:crypto';
import { AdminPermissions } from './admin-permissions.js';
import { AdminManagement, ManagementController } from './admin-management.js';
import { SystemConfig, ConfigController, PublicConfigController } from './system-config.js';
import { EventsAdmin, EventsAdminController } from './events-admin.js';
import { LiveService, LiveController, LiveAdminController, LiveHostController } from './live.js';
import { ZegoService } from './zego.js';
import {LivePolls,LivePollController,LivePollAdminController,LivePollHostController} from './live-polls.js';
import { LiveChatService, LiveChatController, LiveChatAdminController, LiveChatHostController } from './live-chat.js';
import { installLiveSocket } from './live-socket.js';

@Controller('health')
class HealthController {
  constructor(private readonly db: Database) {}
  @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'daoxue-api' };
  }
}

@Module({ controllers: [ClientDiagnosticsController,OperationsIncidentsController,ReconciliationController,PartnerCommerceController,DigitalOrdersAdminController,CategoriesCatalogController,CategoriesAdminController,ImagesAdminController,ImagesPublicController,LiveBroadcastController,DigitalSalesController,DigitalController,DigitalAdminController,PaymentSimulationController,OfflineCourseAdminController,OfflineCourseCatalogController,OfflineCourseLearnerController,ConsumptionRuleController,ConsumptionAdminController,ServiceDeliveriesAdminController,AppleRefundReviewsController,MemberGiftsController,MemberGiftsAdminController,OperatingCommerceAdminController,AdvertisingController,AdvertisingAdminController,CharitySettlementsController,CharityCatalogController,CharityController,CharityAdminController,ProductPromotionsAdminController,PointsRewardsCatalogController,PointsRedemptionsController,PointsRewardsAdminController,ReferralLandingController,ReferralsController,ReferralsAdminController,LogisticsController,LogisticsAdminController,CourseCaseTeachingController,CommunityEnhancementsCatalogController,CommunityEnhancementsController,CommunityEnhancementsAdminController,GroupCatalogController,GroupAdminController,MarketingCatalogController,MarketingController,MarketingAdminController,GiftSettlementsController,GiftsController,GiftsFinanceController,GiftsAdminController,ConsultRtcController,LiveMicsController,LiveMicsAdminController,OfflineLicensesController,SocialAuthController,SocialBindingController,LivePollController,LivePollAdminController,LivePollHostController,NotificationsController,MediaIngestController,ForumMediaIngestController,HomeHeroUploadController, OperationsAdminController, FinanceAdminController, LiveHostController,LiveChatHostController,LiveChatController,LiveChatAdminController,LiveController,LiveAdminController,CohortSalesController,CohortOrdersAdminController,BookingSalesController,BookingOrdersAdminController,EventStaffController,EventCredentialController,EventWorkbenchController,EventWorkbenchAdminController,CohortsCatalogController, CohortsController, CohortsAdminController, BookingsCatalogController, BookingsController, BookingsAdminController, ContentRelationsController, ProductSalesController, ProductOrdersAdminController, AppleMembershipProductsController, MembershipSalesController, MembershipOrdersAdminController, MembershipBenefitsController, MembershipBenefitsAdminController, AppleCommerceController, AppleCallbackController, AppleProductsController, AppleTransactionsController, CourseVersionsController, CourseVersionsAdminController, ManagementController, ConfigController, PublicConfigController, EventsAdminController, CourseSalesController, CourseOrdersAdminController, WechatCallbackController, AlipayCallbackController, CourseReviewsController, CourseReviewsAdminController, ForumController, ForumAdminController, HealthController, ProgressionController, FeedbackController, FeedbackAdminController, PracticesController, PracticesAdminController, QuestionsController, QuestionsAdminController, CatalogController, AdminAuthController, AdminController, IdentityController, PersonalController, LearningController, CurriculumAdminController, MediaController, ShoppingController, ShoppingAdminController, OrdersController, OrdersAdminController, DomainController, TeachingAdminController, TeachingController, CommentAdminController, ArticleInteractionController, ReadingController, DiscoveryController, ShareController, EditorialController, LiveDiscoveryAdminController], providers: [OperationsIncidents,ReconciliationService,PartnerCommerce,Categories,PublicImages,LiveBroadcasts,LiveRecordings,DigitalGoods,DigitalSales,{provide:"DIGITAL_SALES",useExisting:DigitalSales},PaymentSimulation,OfflineCourses,ConsumptionRewards,ServiceDeliveries,AppleRefundReviews,MemberGifts,OperatingCommerce,Advertising,Charity,ProductPromotions,PointsRedemptions,Referrals,Logistics,CommunityEnhancements,GroupPurchases,MarketingService,Gifts,{provide:"GIFT_SALES",useExisting:Gifts},ConsultRtc,LiveMics,{provide:"LIVE_SERVICE",useExisting:LiveService},OfflineLicenses,SocialAuth,LoginProviders,LivePolls,Notifications,MediaIngest, OperationsAdmin, LiveChatService,LiveService,ZegoService,CohortSalesService,{provide:"COHORT_SALES",useExisting:CohortSalesService},BookingSalesService,{provide:"BOOKING_SALES",useExisting:BookingSalesService},EventOperationsService,CohortsService, BookingsService, ProductSalesService, {provide:"PRODUCT_SALES",useExisting:ProductSalesService}, AppleMembershipService, MembershipSalesService, {provide:"MEMBERSHIP_SALES",useExisting:MembershipSalesService}, MembershipBenefitsService, {provide:APP_INTERCEPTOR,useClass:AdminAudit},AppleStoreService, AppleCommerceService, {provide:'APPLE_COMMERCE',useExisting:AppleCommerceService}, AdminPermissions, AdminManagement, SystemConfig, EventsAdmin, CourseVersionsService, WechatPayService, AlipayService, PaymentChannels, CourseSalesService, CourseReviewsService, ForumService, Database, FeedbackService, PracticesService, QuestionsService, CatalogService, AuthService, AdminGuard, UserGuard, OptionalUserGuard, AdminService, IdentityService, LearningService, CurriculumAdminService, MediaService, ShoppingService, OrdersService, DomainService, TeachingService, ContentService, ShareService, DiscoveryService] })
class AppModule {}

export async function createApp(logger: false | undefined = undefined) {
  validateProductionConfig(process.env);
  const app = await NestFactory.create(AppModule, { logger, rawBody:true });
  if(process.env.TRUST_PROXY)app.getHttpAdapter().getInstance().set('trust proxy',process.env.TRUST_PROXY.split(','));
  app.use(helmet());
  app.use((req: {requestId?:string}, res: {setHeader:(key:string,value:string)=>void}, next:()=>void) => { req.requestId=randomUUID();res.setHeader('X-Request-ID',req.requestId);next(); });
  const incidents=app.get(OperationsIncidents);
  app.use((req:{originalUrl?:string},res:{statusCode:number;once:(event:string,callback:()=>void)=>void},next:()=>void)=>{const start=performance.now(),path=req.originalUrl??'';if(path.startsWith('/api/v1/')&&!path.startsWith('/api/v1/media/')&&!/\/(?:media|digital-files|images|evidence|ingest|bill)(?:[/?]|$)/.test(path)&&!req.originalUrl?.includes('/upload'))res.once('finish',()=>incidents.observe(path.split('?')[0]==='/api/v1/auth/sms'&&res.statusCode===503?400:res.statusCode,performance.now()-start));next();});
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  installLiveSocket(app.getHttpServer(),app.get(Database),app.get(LiveService));
  if (process.env.NODE_ENV !== 'production') {
    const spec = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('道学书院 API').setVersion('1').build());
    SwaggerModule.setup('api/docs', app, spec);
  }
  return app;
}

async function main() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.API_HOST ?? '127.0.0.1');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'API startup failed');
  process.exitCode = 1;
});


