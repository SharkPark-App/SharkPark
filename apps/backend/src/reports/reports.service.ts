import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Filter from 'bad-words';
import { PrismaService } from '../database/database.module';
import { CreateReportDto, REPORT_MESSAGE_MAX_LENGTH } from './dto/create-report.dto';
import { Report, ReportType, User } from '@prisma/client';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  // Single Filter instance: word lists are immutable per process, so the
  // cost of constructing the regexes inside `bad-words` should be paid once.
  // Default behavior censors profanity by replacing each match with asterisks
  // (`s***`) — we want to keep the report (it may still describe a real
  // incident) but redact slurs/abuse before they hit the DB.
  private readonly profanityFilter = new Filter();

  constructor(private readonly prisma: PrismaService) {}

  async createReport(dto: CreateReportDto, user: User): Promise<Report> {
    const lot = await this.prisma.lot.findUnique({
      where: { id: dto.lotId },
      select: { id: true },
    });

    if (!lot) {
      throw new NotFoundException(`Parking lot '${dto.lotId}' not found.`);
    }

    // DTO has @MaxLength(REPORT_MESSAGE_MAX_LENGTH); this is a defense-in-depth
    // trim+truncate in case a future call site bypasses the validation pipe.
    const trimmed = dto.message?.trim();
    let message: string | null = null;
    if (trimmed && trimmed.length > 0) {
      const truncated = trimmed.slice(0, REPORT_MESSAGE_MAX_LENGTH);
      message = this.profanityFilter.clean(truncated);
    }

    return await this.prisma.report.create({
      data: {
        lot_id: dto.lotId,
        user_id: user.id,
        type: dto.type.toUpperCase() as ReportType,
        message,
      },
    });
  }

  /**
   * Retention prune: redact (set `message = NULL`) on `reports` rows older
   * than `retentionDays` whose message is still populated. We keep the row
   * (type + lot + timestamp are aggregate-level reliability signals used
   * elsewhere) but drop the free-text message, which is the only PII-bearing
   * column and the only one likely to hold inadvertent personal info
   * (license plates, names, etc.).
   *
   * Default 90 days mirrors the operational window we use for incident
   * triage; older reports are still useful for trend analysis without the
   * verbatim text.
   */
  async pruneOldMessages(
    retentionDays: number = 90,
  ): Promise<{ messages_redacted: number; cutoff: string }> {
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      throw new Error(
        `pruneOldMessages: retentionDays must be >= 1, got ${retentionDays}`,
      );
    }
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.report.updateMany({
      where: { created_at: { lt: cutoff }, message: { not: null } },
      data: { message: null },
    });
    this.logger.log(
      `[retention] Redacted message on ${count} reports older than ${retentionDays}d (cutoff=${cutoff.toISOString()})`,
    );
    return { messages_redacted: count, cutoff: cutoff.toISOString() };
  }
}
