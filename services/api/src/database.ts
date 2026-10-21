import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    // Prisma DateTime columns store UTC; database defaults and raw SQL must use UTC too.
    super({ adapter: new PrismaPg({ connectionString, max: 10, connectionTimeoutMillis: 5000, options: '-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=5000' }) });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
