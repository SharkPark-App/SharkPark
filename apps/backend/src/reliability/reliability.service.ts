import { Injectable, Logger } from '@nestjs/common';
import {
  ReliabilityScore,
  ReliabilityInput,
  ReliabilityFactors,
  FactorScore,
  ConfidenceLevel,
  ReliabilityWeights,
  ReliabilityThresholds,
  ReliabilityScoreSummary,
  SourceType,
} from './interfaces';

/**
 * Computes confidence levels for occupancy data using multi-factor weighted scoring.
 * Score = Σ(factor_normalized × weight) × sourceWeight × 100
 * sourceWeight: AUTHED=1.0, ANONYMOUS=0.3–0.6 (by penetration rate), FLAGGED=0
 * Thresholds: HIGH >= 70, MEDIUM >= 40, LOW < 40
 */
@Injectable()
export class ReliabilityService {
  private readonly logger = new Logger(ReliabilityService.name);

  private readonly defaultWeights: ReliabilityWeights = {
    penetrationRate: 0.3,
    dataFreshness: 0.21,
    eventFrequency: 0.17,
    sampleSize: 0.13,
    historicalAccuracy: 0.04,
    userReports: 0.15,
  };

  private readonly defaultThresholds: ReliabilityThresholds = {
    highConfidence: 70,
    mediumConfidence: 40,
    penetrationRateTarget: 0.5,
    freshnessWindowMinutes: 60,
    eventFrequencyTarget: 10,
    sampleSizeTarget: 20,
    userReportsTarget: 5,
    userReportsWindowMinutes: 60,
  };

  computeReliability(
    lotId: string,
    input: ReliabilityInput,
    weights: ReliabilityWeights = this.defaultWeights,
    thresholds: ReliabilityThresholds = this.defaultThresholds,
    // Defaults to AUTHED (1.0 multiplier) so existing call sites that don't yet
    // track per-event source attribution preserve their score. Opt callers in to
    // ANONYMOUS / FLAGGED weighting as source tracking is wired through.
    sourceType: SourceType = 'AUTHED',
  ): ReliabilityScore {
    // Clone + normalize weights to avoid mutating the default object
    const w = { ...weights };
    const weightSum = Object.values(w).reduce((sum, v) => sum + v, 0);
    if (Math.abs(weightSum - 1.0) > 0.001) {
      this.logger.warn(`Weights sum to ${weightSum}, normalizing...`);
      Object.keys(w).forEach((key) => {
        w[key as keyof ReliabilityWeights] /= weightSum;
      });
    }

    const factors = this.computeFactors(input, w, thresholds);

    const rawScore =
      factors.penetrationRate.weightedScore +
      factors.dataFreshness.weightedScore +
      factors.eventFrequency.weightedScore +
      factors.sampleSize.weightedScore +
      factors.historicalAccuracy.weightedScore +
      factors.userReports.weightedScore;

    const sourceWeight = this.getSourceWeight(sourceType, input.penetrationRate, thresholds);
    const score = Math.round(rawScore * sourceWeight * 100);

    const confidence = this.getConfidenceLevel(score, thresholds);
    const isColdStart = this.isColdStartMode(input, thresholds);
    const explanation = this.generateExplanation(confidence, isColdStart, factors);

    return {
      score,
      confidence,
      factors,
      computedAt: new Date().toISOString(),
      lotId,
      isColdStart,
      explanation,
    };
  }

  computeReliabilitySummary(
    lotId: string,
    input: ReliabilityInput,
    sourceType: SourceType = 'AUTHED',
  ): ReliabilityScoreSummary {
    const { score, confidence, isColdStart, computedAt } = this.computeReliability(
      lotId,
      input,
      this.defaultWeights,
      this.defaultThresholds,
      sourceType,
    );
    return { lotId, score, confidence, isColdStart, computedAt };
  }

  private computeFactors(
    input: ReliabilityInput,
    weights: ReliabilityWeights,
    thresholds: ReliabilityThresholds,
  ): ReliabilityFactors {
    return {
      penetrationRate: this.computeFactor(
        'Penetration Rate',
        input.penetrationRate,
        weights.penetrationRate,
        thresholds.penetrationRateTarget,
      ),
      dataFreshness: this.computeFreshnessFactor(
        input.minutesSinceLastEvent,
        weights.dataFreshness,
        thresholds.freshnessWindowMinutes,
      ),
      eventFrequency: this.computeFactor(
        'Event Frequency',
        input.eventsInLastHour,
        weights.eventFrequency,
        thresholds.eventFrequencyTarget,
      ),
      sampleSize: this.computeFactor(
        'Sample Size',
        input.uniqueDevicesInLastHour,
        weights.sampleSize,
        thresholds.sampleSizeTarget,
      ),
      historicalAccuracy: this.computeHistoricalAccuracyFactor(
        input.historicalAccuracy,
        weights.historicalAccuracy,
      ),
      userReports: this.computeUserReportsFactor(
        input.uniqueReportersInWindow ?? 0,
        weights.userReports,
        thresholds.userReportsTarget,
      ),
    };
  }

  // User reports are a NEGATIVE-only signal: their PRESENCE is evidence of
  // disagreement with the live count, but their ABSENCE proves nothing —
  // most users never submit reports, and silence is the default state.
  // Treating "0 reports" as 1.0 ("everyone agrees") inflates the overall
  // reliability score by up to `weight` points across every lot at every
  // moment, which is exactly the bug we hit: lots showing 100% on this
  // factor at 6am when no humans were even on campus to file a report.
  //
  // Mirror the historical-accuracy pattern: when we have no signal, return
  // a neutral 0.5 so the factor neither props the score up nor drags it
  // down. Once at least one report arrives, switch to the penalty curve.
  private computeUserReportsFactor(
    reporterCount: number,
    weight: number,
    target: number,
  ): FactorScore {
    if (reporterCount <= 0) {
      return {
        name: 'User Reports',
        rawValue: 0,
        normalizedValue: 0.5,
        weight,
        weightedScore: 0.5 * weight,
      };
    }
    const safeTarget = target > 0 ? target : 1;
    const penalty = Math.min(1, reporterCount / safeTarget);
    const normalizedValue = 1 - penalty;
    return {
      name: 'User Reports',
      rawValue: reporterCount,
      normalizedValue,
      weight,
      weightedScore: normalizedValue * weight,
    };
  }

  /**
   * Scales the final score by contributor source trust:
   *   FLAGGED   → 0      (score zeroed; data is considered tainted)
   *   ANONYMOUS → 0.3–0.6 (interpolated by penetration rate vs target)
   *   AUTHED    → 1.0    (full weight; Azure AD identity verified)
   */
  private getSourceWeight(
    sourceType: SourceType,
    penetrationRate: number,
    thresholds: ReliabilityThresholds,
  ): number {
    switch (sourceType) {
      case 'FLAGGED':
        return 0;
      case 'AUTHED':
        return 1.0;
      case 'ANONYMOUS':
        return 0.3 + 0.3 * Math.min(1, penetrationRate / thresholds.penetrationRateTarget);
    }
  }

  /** Generic factor: normalized = min(1, value / target) */
  private computeFactor(name: string, value: number, weight: number, target: number): FactorScore {
    const normalizedValue = Math.min(1, Math.max(0, value / target));
    return { name, rawValue: value, normalizedValue, weight, weightedScore: normalizedValue * weight };
  }

  /** Freshness factor: normalized = max(0, 1 - minutes / window) */
  private computeFreshnessFactor(minutes: number, weight: number, windowMinutes: number): FactorScore {
    const normalizedValue = Math.max(0, 1 - minutes / windowMinutes);
    return { name: 'Data Freshness', rawValue: minutes, normalizedValue, weight, weightedScore: normalizedValue * weight };
  }

  /** Historical accuracy: uses 0.5 (neutral) if no data available */
  private computeHistoricalAccuracyFactor(accuracy: number | null, weight: number): FactorScore {
    const effectiveAccuracy = accuracy ?? 0.5;
    const normalizedValue = Math.min(1, Math.max(0, effectiveAccuracy));
    return {
      name: 'Historical Accuracy',
      rawValue: accuracy ?? -1,
      normalizedValue,
      weight,
      weightedScore: normalizedValue * weight,
    };
  }

  private getConfidenceLevel(score: number, thresholds: ReliabilityThresholds): ConfidenceLevel {
    if (score >= thresholds.highConfidence) return 'HIGH';
    if (score >= thresholds.mediumConfidence) return 'MEDIUM';
    return 'LOW';
  }

  private isColdStartMode(input: ReliabilityInput, thresholds: ReliabilityThresholds): boolean {
    return (
      input.penetrationRate < thresholds.penetrationRateTarget * 0.1 ||
      input.eventsInLastHour < 2 ||
      input.uniqueDevicesInLastHour < 3 ||
      input.minutesSinceLastEvent > thresholds.freshnessWindowMinutes * 2
    );
  }

  private generateExplanation(
    confidence: ConfidenceLevel,
    isColdStart: boolean,
    factors: ReliabilityFactors,
  ): string {
    if (isColdStart) {
      return 'Limited data available. Occupancy estimates may not reflect actual conditions.';
    }

    // Find the weakest factor
    const factorArray = [
      factors.penetrationRate,
      factors.dataFreshness,
      factors.eventFrequency,
      factors.sampleSize,
      factors.userReports,
    ];

    const weakestFactor = factorArray.reduce((min, f) =>
      f.normalizedValue < min.normalizedValue ? f : min,
    );


    if (weakestFactor === factors.userReports && confidence !== 'HIGH') {
      return confidence === 'MEDIUM'
        ? 'Moderate confidence. Recent user reports suggest the live count may not match conditions on the ground.'
        : 'Low confidence due to recent user reports. Use estimates with caution.';
    }

    switch (confidence) {
      case 'HIGH':
        return 'High confidence in occupancy data. Sufficient user participation and recent activity.';
      case 'MEDIUM':
        return `Moderate confidence. ${weakestFactor.name} could be improved for better accuracy.`;
      case 'LOW':
        return `Low confidence due to limited ${weakestFactor.name.toLowerCase()}. Use estimates with caution.`;
    }
  }

  getDefaultWeights(): ReliabilityWeights {
    return { ...this.defaultWeights };
  }

  getDefaultThresholds(): ReliabilityThresholds {
    return { ...this.defaultThresholds };
  }

  computeReliabilityBatch(
    inputs: Array<{ lotId: string; input: ReliabilityInput; sourceType?: SourceType }>,
  ): ReliabilityScore[] {
    return inputs.map(({ lotId, input, sourceType }) =>
      this.computeReliability(lotId, input, this.defaultWeights, this.defaultThresholds, sourceType),
    );
  }
}
