export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Describes who contributed the occupancy data being scored.
 *   ANONYMOUS  — unhashed device, no Azure AD token: weight 0.3–0.6 (scales
 *                with penetration rate relative to the configured target)
 *   AUTHED     — Azure AD bearer present: weight 1.0
 *   FLAGGED    — device/user marked as bad actor: weight 0 (score zeroed out)
 */
export type SourceType = 'ANONYMOUS' | 'AUTHED' | 'FLAGGED';

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
  userReports: FactorScore;
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
  uniqueReportersInWindow: number;
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
  userReports: number;
}

export interface ReliabilityThresholds {
  highConfidence: number;
  mediumConfidence: number;
  penetrationRateTarget: number;
  freshnessWindowMinutes: number;
  eventFrequencyTarget: number;
  sampleSizeTarget: number;  
  userReportsTarget: number;
  userReportsWindowMinutes: number;
}
