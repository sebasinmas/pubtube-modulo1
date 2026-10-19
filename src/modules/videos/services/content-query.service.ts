import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import { videos } from '../../../db/schema.js';
import type { DrizzleDb } from '../../../db/types.js';
import {
  GetContentQueryDto,
  GetContentResponseDto,
} from '../dto/get-content.dto.js';
import type { VideoRow } from '../../../db/schema.js';

@Injectable()
export class ContentQueryService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: DrizzleDb) {}

  async obtenerContenidos(
    query: GetContentQueryDto,
  ): Promise<GetContentResponseDto<VideoRow>> {
    const page = query.page ?? 1;
    const size = query.size ?? 10;
    const offset = (page - 1) * size;

    const condition = query.status
      ? eq(videos.status, query.status)
      : undefined;

    const [items, totalResult] = await Promise.all([
      this.db
        .select()
        .from(videos)
        .where(condition)
        .orderBy(desc(videos.created_at))
        .limit(size)
        .offset(offset),
      this.db.select({ count: count() }).from(videos).where(condition),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);
    const totalPages = total > 0 ? Math.ceil(total / size) : 0;

    return new GetContentResponseDto({
      items,
      totalItems: total,
      totalPages,
      currentPage: page,
    });
  }
}
