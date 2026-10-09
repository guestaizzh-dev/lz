import 'reflect-metadata';
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Database } from './database.js';
import { CatalogController, CatalogService } from './catalog.js';
import { AuthService, AdminGuard, UserGuard, OptionalUserGuard, AdminAuthController } from './auth.js';
import { LearningController, LearningService } from './learning.js';
import { CurriculumAdminController, CurriculumAdminService } from './curriculum-admin.js';
import { MediaController, MediaService } from './media.js';
import { ShoppingController, ShoppingAdminController, ShoppingService } from './shopping.js';
import { OrdersController, OrdersAdminController, OrdersService } from './orders.js';
import { IdentityController, IdentityService } from './identity.js';
import { PersonalController } from './personal.js';
import { AdminController, AdminService } from './admin.js';
import { pathToFileURL } from 'node:url';
import { DomainController, DomainService } from './domain.js';
import { TeachingAdminController, TeachingController, TeachingService } from './teaching.js';

@Controller('health')
class HealthController {
  constructor(private readonly db: Database) {}
  @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'daoxue-api' };
  }
}

@Module({ controllers: [HealthController, CatalogController, AdminAuthController, AdminController, IdentityController, PersonalController, LearningController, CurriculumAdminController, MediaController, ShoppingController, ShoppingAdminController, OrdersController, OrdersAdminController, DomainController, TeachingAdminController, TeachingController], providers: [Database, CatalogService, AuthService, AdminGuard, UserGuard, OptionalUserGuard, AdminService, IdentityService, LearningService, CurriculumAdminService, MediaService, ShoppingService, OrdersService, DomainService, TeachingService] })
class AppModule {}

export async function createApp(logger: false | undefined = undefined) {
  if (process.env.NODE_ENV === 'production' && (process.env.DEV_OTP_CODE || !process.env.OTP_HASH_SECRET)) throw new Error('Production requires OTP_HASH_SECRET and forbids DEV_OTP_CODE');
  const app = await NestFactory.create(AppModule, { logger });
  app.use(helmet());
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
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
