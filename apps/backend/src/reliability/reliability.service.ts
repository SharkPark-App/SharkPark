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
 * Score = Σ(factor_normalized × weight) × 100
 * Thresholds: HIGH >= 70, MEDIUM >= 40, LOW < 40
 */
@Injectable()
export class ReliabilityService {
  private readonly logger = new Logger(ReliabilityService.name);

  private readonly defaultWeights: ReliabilityWeights = {
    penetrationRate: 0.35,
    dataFreshness: 0.25,
    eventFrequency: 0.2,
    sampleSize: 0.15,
    historicalAccuracy: 0.05,
  };

  private readonly defaultThresholds: ReliabilityThresholds = {
    highConfidence: 70,
    mediumConfidence: 40,
    penetrationRateTarget: 0.5,
    freshnessWindowMinutes: 60,
    eventFrequencyTarget: 10,
    sampleSizeTarget: 20,
  };

  computeReliability(
    lotId: string,
    input: ReliabilityInput,
    weights: ReliabilityWeights = this.defaultWeights,
    thresholds: ReliabilityThresholds = this.defaultThresholds,
    sourceType: SourceType = 'ANONYMOUS',
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
      factors.historicalAccuracy.weightedScore;

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
    sourceType: SourceType = 'ANONYMOUS',
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
    ];

    const weakestFactor = factorArray.reduce((min, f) =>
      f.normalizedValue < min.normalizedValue ? f : min,
    );

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
