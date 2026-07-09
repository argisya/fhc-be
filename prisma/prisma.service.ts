import 'dotenv/config';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // 1. Ambil URL database dari environment variable (.env)
    const connectionString = process.env.DATABASE_URL;
    // 2. Buat connection pool standar PostgreSQL
    const pool = new Pool({ connectionString });
    // 3. Bungkus pool dengan adapter resmi Prisma
    const adapter = new PrismaPg(pool);

    // 4. Teruskan adapter ke dalam konstruktor PrismaClient (Wajib di Prisma v7!)
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
