import { ValidationEvent, ValidationEventType, BluetoothState, EventPatternAnalysis, ValidationStatus } from './types';

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
  static analyzeEventPatterns(events: ValidationEvent[], isFinalAnalysis = false): EventPatternAnalysis {
    const speeds = events.map(e => e.speed_mph).filter(s => s !== null) as number[];
    const timeSpan = events.length > 0 ? 
      (new Date(events[events.length - 1].timestamp).getTime() - new Date(events[0].timestamp).getTime()) / 1000 / 60 : 0; // minutes

    // Speed transition analysis
    let speedTransitionScore = 0.5;
    if (speeds.length >= 2) {
      const speedDrop = speeds[0] - speeds[speeds.length - 1];
      if (speedDrop > 10) speedTransitionScore = 0.9; // Significant speed drop
      else if (speedDrop > 5) speedTransitionScore = 0.7;
      else if (speedDrop < -5) speedTransitionScore = 0.2; // Speed increased (driving through)
    }

    // Dwell time analysis
    let dwellTimeScore = 0.5;
    if (timeSpan > 5) dwellTimeScore = 0.8; // More than 5 minutes suggests parking
    else if (timeSpan > 2) dwellTimeScore = 0.6;
    else if (timeSpan < 1) dwellTimeScore = 0.2; // Very short time suggests drive-through

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
      if (hasDisconnect) bluetoothScore = 0.8; // Bluetooth disconnect suggests leaving car
    }

    // Calculate overall confidence
    const overallConfidence = (speedTransitionScore + dwellTimeScore + movementPatternScore + bluetoothScore) / 4;

    // Determine status based on confidence and patterns
    let status: ValidationStatus = 'UNKNOWN';
    if (overallConfidence > 0.7) status = 'PARKED';
    else if (overallConfidence < 0.3) status = 'DROVE_THROUGH';
    else if (!isFinalAnalysis) status = 'ANALYZING';
    else status = 'SEARCHING';

    return {
      status,
      confidenceScore: Math.round(overallConfidence * 100) / 100,
      contributesToOccupancy: status === 'PARKED',
      speedTransitionScore: Math.round(speedTransitionScore * 100) / 100,
      dwellTimeScore: Math.round(dwellTimeScore * 100) / 100,
      movementPatternScore: Math.round(movementPatternScore * 100) / 100,
      bluetoothScore: Math.round(bluetoothScore * 100) / 100,
      preliminaryStatus: !isFinalAnalysis ? (overallConfidence > 0.6 ? 'PARKED' : 'ANALYZING') : status,
      confidence: overallConfidence,
      metadata: {
        event_count: events.length,
        time_span_minutes: Math.round(timeSpan * 100) / 100,
        speed_range: speeds.length > 0 ? [Math.min(...speeds), Math.max(...speeds)] : null,
        analysis_timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Generate a privacy-preserving device hash
   * Uses the same algorithm as the server for consistency
   */
  static generateDeviceHash(userId: string, salt: string = 'parking_device_salt'): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(`${userId}_${salt}`).digest('hex');
  }
}
