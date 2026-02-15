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

export interface ReliabilityInput {
  penetrationRate: number;
  minutesSinceLastEvent: number;
  eventsInLastHour: number;
  uniqueDevicesInLastHour: number;
  historicalAccuracy: number | null;
}

export interface ReliabilityScoreSummary {
  lotId: string;
  score: number;
  confidence: ConfidenceLevel;
  isColdStart: boolean;
  computedAt: string;
}

export interface ReliabilityWeights {
  penetrationRate: number;
  dataFreshness: number;
  eventFrequency: number;
  sampleSize: number;
  historicalAccuracy: number;
}

export interface ReliabilityThresholds {
  highConfidence: number;
  mediumConfidence: number;
  penetrationRateTarget: number;
  freshnessWindowMinutes: number;
  eventFrequencyTarget: number;
  sampleSizeTarget: number;
}
