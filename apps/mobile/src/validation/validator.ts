import { ValidationEvent, ValidationEventType, BluetoothState, EventPatternAnalysis, ValidationStatus } from './types';

/**
 * Tunable thresholds for parking behavior analysis.
 * All values can be overridden per-lot by passing a partial object to analyzeEventPatterns.
 */
export interface AnalysisThresholds {
  // Speed transition
  speedDropSignificant: number;  // mph — speed drop above this → high parking confidence
  speedDropMild: number;         // mph — speed drop above this → moderate confidence
  speedIncreaseThrough: number;  // mph — net speed increase above this → driving-through

  // Dwell time (minutes)
  dwellLong: number;   // > this → strong parking signal
  dwellMedium: number; // > this → mild parking signal
  dwellShort: number;  // < this → drive-through signal

  // Overall confidence classification
  confidenceParked: number;     // above → PARKED
  confidenceDroveThrough: number; // below → DROVE_THROUGH
  confidencePreliminary: number;  // above → preliminary PARKED (non-final analysis)
}

export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  speedDropSignificant: 10,
  speedDropMild: 5,
  speedIncreaseThrough: 5,
  dwellLong: 5,
  dwellMedium: 2,
  dwellShort: 1,
  confidenceParked: 0.7,
  confidenceDroveThrough: 0.3,
  confidencePreliminary: 0.6,
};

/**
 * Client-side parking behavior analysis algorithms
 * These algorithms analyze sensor data locally on the mobile device
 * to classify parking behavior without sending raw location data to server
 */
export class ParkingValidator {

  /**
   * Calculate confidence score for a single validation event
   * Based on speed, GPS accuracy, bluetooth state, and event type
   */
  static calculateConfidenceScore(eventData: {
    speed?: number;
    accuracy?: number;
    bluetoothState?: BluetoothState;
    eventType: ValidationEventType;
  }): number {
    let score = 0.5; // Base confidence

    // Speed-based confidence
    if (eventData.speed !== undefined) {
      if (eventData.speed < 2) {
        // Very low speed suggests stationary/parking behavior
        score += 0.2;
      } else if (eventData.speed > 15) {
        // High speed suggests driving through
        score -= 0.2;
      }
      
      if (eventData.eventType === 'STATIONARY') {
        // Being stationary is strong parking indicator
        score += 0.4;
      }
    }

    // GPS accuracy affects confidence
    if (eventData.accuracy !== undefined) {
      if (eventData.accuracy <= 5) score += 0.1;
      else if (eventData.accuracy > 20) score -= 0.1;
    }

    // Bluetooth connectivity patterns
    if (eventData.bluetoothState === 'CONNECTED') {
      // Car Bluetooth often disconnects when parked and user walks away
      score += 0.1;
    }

    // Event type specific adjustments
    switch (eventData.eventType) {
      case 'WALKING':
        score += 0.2; // Walking suggests user left car
        break;
      case 'DRIVING':
        score -= 0.3; // Still driving suggests not parked
        break;
      case 'GEOFENCE_EXIT':
        score += 0.4; // Exiting lot area is strong parking completion signal
        break;
    }

    // Ensure score stays within bounds
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Analyze patterns in validation events to determine parking behavior
   * This is the core behavioral analysis algorithm that runs client-side
   */
  static analyzeEventPatterns(
    events: ValidationEvent[],
    isFinalAnalysis = false,
    thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
  ): EventPatternAnalysis {
    const speeds = events.map(e => e.speed_mph).filter(s => s !== null) as number[];
    const timeSpan = events.length > 0
      ? (new Date(events[events.length - 1].timestamp).getTime() - new Date(events[0].timestamp).getTime()) / 1000 / 60
      : 0; // minutes

    // Speed transition analysis — compare first-half average vs second-half average
    // so the full trajectory is considered, not just the endpoints.
    let speedTransitionScore = 0.5;
    if (speeds.length >= 2) {
      const mid = Math.floor(speeds.length / 2);
      const firstHalf = speeds.slice(0, mid);
      const secondHalf = speeds.slice(mid);
      const firstAvg = firstHalf.reduce((sum, s) => sum + s, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, s) => sum + s, 0) / secondHalf.length;
      const speedDrop = firstAvg - secondAvg;

      if (speedDrop > thresholds.speedDropSignificant) speedTransitionScore = 0.9; // Clear deceleration to stop
      else if (speedDrop > thresholds.speedDropMild) speedTransitionScore = 0.7;
      else if (speedDrop < -thresholds.speedIncreaseThrough) speedTransitionScore = 0.2; // Accelerating — driving through
    }

    // Dwell time analysis
    let dwellTimeScore = 0.5;
    if (timeSpan > thresholds.dwellLong) dwellTimeScore = 0.8;
    else if (timeSpan > thresholds.dwellMedium) dwellTimeScore = 0.6;
    else if (timeSpan < thresholds.dwellShort) dwellTimeScore = 0.2; // Very short visit — likely drive-through

    // Movement pattern analysis
    const movementTypes = events.map(e => e.event_type);
    const hasWalking = movementTypes.includes('WALKING');
    const hasStationary = movementTypes.includes('STATIONARY');
    const hasDriving = movementTypes.includes('DRIVING');

    let movementPatternScore = 0.5;
    if (hasWalking && hasStationary) movementPatternScore = 0.9;
    else if (hasStationary) movementPatternScore = 0.7;
    else if (hasDriving && !hasWalking) movementPatternScore = 0.2;

    // Bluetooth analysis
    const bluetoothEvents = events.filter(e => e.bluetooth_state !== null);
    let bluetoothScore = 0.5;
    if (bluetoothEvents.length > 0) {
      const hasDisconnect = bluetoothEvents.some(e => e.bluetooth_state === 'DISCONNECTED');
      if (hasDisconnect) bluetoothScore = 0.8; // Disconnect from car audio → left vehicle
    }

    // Activity recognition analysis (from SDK onActivityChange events)
    const activityEvents = events.filter(e =>
      e.event_type === 'ACTIVITY_STILL' ||
      e.event_type === 'ACTIVITY_ON_FOOT' ||
      e.event_type === 'ACTIVITY_IN_VEHICLE' ||
      e.event_type === 'DWELL'
    );
    let activityRecognitionScore = 0.5;
    if (activityEvents.length > 0) {
      const hasStill = activityEvents.some(e => e.event_type === 'ACTIVITY_STILL');
      const hasOnFoot = activityEvents.some(e => e.event_type === 'ACTIVITY_ON_FOOT');
      const hasInVehicle = activityEvents.some(e => e.event_type === 'ACTIVITY_IN_VEHICLE');
      const hasDwell = activityEvents.some(e => e.event_type === 'DWELL');

      if ((hasStill || hasDwell) && hasOnFoot) activityRecognitionScore = 0.95; // Park + walk away
      else if (hasStill || hasDwell) activityRecognitionScore = 0.8;
      else if (hasOnFoot) activityRecognitionScore = 0.7;
      else if (hasInVehicle && !hasStill) activityRecognitionScore = 0.15; // Still driving
    }

    // Weighted confidence (5 dimensions):
    // Speed 0.20, Dwell 0.20, Movement 0.15, Bluetooth 0.15, Activity 0.30
    const overallConfidence =
      speedTransitionScore * 0.20 +
      dwellTimeScore * 0.20 +
      movementPatternScore * 0.15 +
      bluetoothScore * 0.15 +
      activityRecognitionScore * 0.30;

    // Determine status based on confidence and patterns
    let status: ValidationStatus = 'UNKNOWN';
    // Not enough data to make a determination
    if (events.length < 3 && !isFinalAnalysis) status = 'INSUFFICIENT_DATA';
    else if (overallConfidence > thresholds.confidenceParked) status = 'PARKED';
    else if (overallConfidence < thresholds.confidenceDroveThrough) status = 'DROVE_THROUGH';
    else if (!isFinalAnalysis) status = 'ANALYZING';
    else status = 'SEARCHING';

    // Safe min/max via reduce — avoids RangeError from spread on large arrays
    const speedMin = speeds.reduce((a, b) => (b < a ? b : a), speeds[0]);
    const speedMax = speeds.reduce((a, b) => (b > a ? b : a), speeds[0]);

    return {
      status,
      confidenceScore: Math.round(overallConfidence * 100) / 100,
      contributesToOccupancy: status === 'PARKED',
      speedTransitionScore: Math.round(speedTransitionScore * 100) / 100,
      dwellTimeScore: Math.round(dwellTimeScore * 100) / 100,
      movementPatternScore: Math.round(movementPatternScore * 100) / 100,
      bluetoothScore: Math.round(bluetoothScore * 100) / 100,
      activityRecognitionScore: Math.round(activityRecognitionScore * 100) / 100,
      preliminaryStatus: !isFinalAnalysis ? (overallConfidence > thresholds.confidencePreliminary ? 'PARKED' : 'ANALYZING') : status,
      confidence: overallConfidence,
      metadata: {
        event_count: events.length,
        time_span_minutes: Math.round(timeSpan * 100) / 100,
        speed_range: speeds.length > 0 ? [speedMin, speedMax] : null,
        analysis_timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * @deprecated NOT cryptographically secure. Do NOT use for real device identification.
   * Device hashing for occupancy events is handled server-side via SHA-256 in
   * the backend's occupancy-events service. This function exists only for
   * local unit tests that verify hash consistency/uniqueness properties.
   *
   * Uses DJB2 (32-bit) — fast and deterministic, but trivially reversible.
   */
  static generateLocalTestHash(userId: string, salt: string = 'parking_device_salt'): string {
    const str = `${userId}_${salt}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
