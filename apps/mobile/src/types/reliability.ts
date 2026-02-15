/** Reliability Meter Types */

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface FactorScore {
  name: string;
  rawValue: number;
  normalizedValue: number;
  weight: number;
  weightedScore: number;
}

export interface ReliabilityFactors {
  penetrationRate: FactorScore;
  dataFreshness: FactorScore;
  eventFrequency: FactorScore;
  sampleSize: FactorScore;
  historicalAccuracy: FactorScore;
}

export interface ReliabilityScore {
  score: number;
  confidence: ConfidenceLevel;
  factors: ReliabilityFactors;
  computedAt: string;
  lotId: string;
  isColdStart: boolean;
  explanation: string;
}

export interface ReliabilityScoreSummary {
  lotId: string;
  score: number;
  confidence: ConfidenceLevel;
  isColdStart: boolean;
  computedAt: string;
}

export interface ReliabilityConfig {
  weights: {
    penetrationRate: number;
    dataFreshness: number;
    eventFrequency: number;
    sampleSize: number;
    historicalAccuracy: number;
  };
  thresholds: {
    highConfidence: number;
    mediumConfidence: number;
    penetrationRateTarget: number;
    freshnessWindowMinutes: number;
    eventFrequencyTarget: number;
    sampleSizeTarget: number;
  };
}

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  HIGH: '#22C55E',
  MEDIUM: '#F59E0B',
  LOW: '#EF4444',
};

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  HIGH: 'High Confidence',
  MEDIUM: 'Moderate Confidence',
  LOW: 'Low Confidence',
};

export const CONFIDENCE_ICONS: Record<ConfidenceLevel, string> = {
  HIGH: 'checkmark.shield.fill',
  MEDIUM: 'exclamationmark.shield.fill',
  LOW: 'xmark.shield.fill',
};
