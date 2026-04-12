/**
 * Parking Validation Service
 * Integrates client-side behavioral analysis with the mobile app's geofencing workflow
 * 
 * This service:
 * - Collects behavioral data during parking sessions (speed, movement, bluetooth)
 * - Analyzes patterns using the @sharkpark/parking-validation package
 * - Provides validation results to include with occupancy events
 * - Maintains privacy by keeping all analysis on-device
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ParkingValidator, ValidationEvent, ValidationAnalysis } from '../validation';
import { GeofenceEvent } from '../types/location';
import { BehavioralMetrics, sharedBehavioralCollector } from './behavioralDataCollector';

interface ParkingSession {
  sessionId: string;
  lotId: string;
  startTime: string;
  events: ValidationEvent[];
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

interface ValidationEventWithMetadata extends ValidationEvent {
  sessionId: string;
  lotId: string;
}

class ParkingValidationService {
  private activeSessions = new Map<string, ParkingSession>();
  private sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private eventBuffer: ValidationEventWithMetadata[] = [];
  private isCollectingData = false;
  private behavioralCollector = sharedBehavioralCollector;
  private initPromise: Promise<void>;

  // Maximum session duration before auto-cancellation (4 hours)
  private readonly SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

  // Event listeners
  private validationCompleteListeners: ((analysis: ValidationAnalysis, lotId: string) => void)[] = [];

  constructor() {
    this.initPromise = this.loadPersistedSessions();
  }

  /**
   * Start collecting behavioral data when user enters a parking lot
   */
  async startParkingSession(geofenceEvent: GeofenceEvent): Promise<string> {
    await this.initPromise;
    if (geofenceEvent.eventType !== 'ENTER') {
      return '';
    }

    const sessionId = this.generateSessionId();
    const session: ParkingSession = {
      sessionId,
      lotId: geofenceEvent.regionId,
      startTime: geofenceEvent.timestamp,
      events: [],
      status: 'ACTIVE'
    };

    this.activeSessions.set(sessionId, session);
    this.isCollectingData = true;

    // Auto-cancel stale sessions after timeout to prevent resource leaks
    const timer = setTimeout(() => {
      this.cancelStaleSession(sessionId);
    }, this.SESSION_TIMEOUT_MS);
    this.sessionTimers.set(sessionId, timer);
    
    // Start collecting location and movement data
    this.startDataCollection(sessionId, geofenceEvent.regionId);
    
    if (__DEV__) console.log(`[ParkingValidation] Started session ${sessionId} for lot ${geofenceEvent.regionId}`);
    
    // Persist session
    await this.persistSession(session);
    
    return sessionId;
  }

  /**
   * Complete parking session and analyze behavioral patterns
   */
  async completeParkingSession(geofenceEvent: GeofenceEvent): Promise<ValidationAnalysis | null> {
    await this.initPromise;
    if (geofenceEvent.eventType !== 'EXIT') {
      return null;
    }

    const activeSession = this.findActiveSessionByLotId(geofenceEvent.regionId);
    if (!activeSession) {
      if (__DEV__) console.log(`[ParkingValidation] No active session found for lot ${geofenceEvent.regionId}`);
      return null;
    }

    // Clear the session timeout timer
    this.clearSessionTimer(activeSession.sessionId);

    // Add final exit event
    const exitEvent = this.createValidationEvent('GEOFENCE_EXIT', activeSession.sessionId, geofenceEvent.regionId);
    activeSession.events.push(exitEvent);
    
    this.isCollectingData = false;
    this.behavioralCollector.stopCollection('parkingValidation');
    activeSession.status = 'COMPLETED';
    
    // Analyze the behavioral patterns
    const analysis = ParkingValidator.analyzeEventPatterns(activeSession.events, true);
    
    if (__DEV__) console.log(`[ParkingValidation] Session ${activeSession.sessionId} analysis:`, {
      status: analysis.status,
      confidence: analysis.confidenceScore,
      contributesToOccupancy: analysis.contributesToOccupancy,
      eventCount: activeSession.events.length
    });
    
    // Notify listeners
    this.notifyValidationComplete(analysis, geofenceEvent.regionId);
    
    // Clean up session
    this.activeSessions.delete(activeSession.sessionId);
    await this.removePersistedSession(activeSession.sessionId);
    
    return analysis;
  }

  /**
   * Collect behavioral event data during active parking sessions
   */
  recordBehavioralEvent(
    eventType: ValidationEvent['event_type'], 
    metadata: {
      speed_mph?: number;
      accuracy_meters?: number;
      bluetooth_state?: ValidationEvent['bluetooth_state'];
      raw_data?: Record<string, unknown>;
    } = {}
  ): void {
    if (!this.isCollectingData || this.activeSessions.size === 0) {
      return;
    }

    // Add event to all active sessions
    this.activeSessions.forEach((session) => {
      if (session.status === 'ACTIVE') {
        const event = this.createValidationEvent(eventType, session.sessionId, session.lotId, metadata);
        session.events.push(event);
        
        // Keep events buffer manageable (last 50 events per session)
        if (session.events.length > 50) {
          session.events = session.events.slice(-50);
        }
        
        // Persist updated session
        this.persistSession(session);
      }
    });
  }

  /**
   * Get current validation status for a parking session (optional real-time analysis)
   */
  async getCurrentValidationStatus(lotId: string): Promise<ValidationAnalysis | null> {
    await this.initPromise;
    const session = this.findActiveSessionByLotId(lotId);
    if (!session || session.events.length < 3) {
      return null; // Need minimum events for analysis
    }

    try {
      // Perform preliminary analysis on current events
      const preliminaryAnalysis = ParkingValidator.analyzeEventPatterns(session.events, false);
      return preliminaryAnalysis;
    } catch (error) {
      if (__DEV__) console.error('[ParkingValidation] Error during preliminary analysis:', error);
      return null;
    }
  }

  /**
   * Register listener for validation completion
   */
  onValidationComplete(callback: (analysis: ValidationAnalysis, lotId: string) => void): void {
    this.validationCompleteListeners.push(callback);
  }

  /**
   * Remove validation completion listener
   */
  removeValidationListener(callback: (analysis: ValidationAnalysis, lotId: string) => void): void {
    const index = this.validationCompleteListeners.indexOf(callback);
    if (index > -1) {
      this.validationCompleteListeners.splice(index, 1);
    }
  }

  // --- Private Methods ---

  private startDataCollection(sessionId: string, lotId: string): void {
    this.isCollectingData = true;
    
    // Start real behavioral data collection
    this.behavioralCollector.startCollection({
      onMetricsCollected: (metrics: BehavioralMetrics) => {
        this.processBehavioralMetrics(sessionId, lotId, metrics);
      },
      onError: (error: string) => {
        if (__DEV__) console.error('[ParkingValidation] Behavioral data collection error:', error);
      }
    }, 'parkingValidation');

    // Initial geofence entry event
    const entryEvent = this.createValidationEvent('GEOFENCE_ENTER', sessionId, lotId);
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.events.push(entryEvent);
    }
  }

  /**
   * Process real behavioral metrics and create validation events
   */
  private processBehavioralMetrics(sessionId: string, lotId: string, metrics: BehavioralMetrics): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') {
      return;
    }

    // Create different types of events based on the data
    const events: ValidationEvent[] = [];

    // Speed-based events
    if (metrics.speed_mph !== null) {
      if (metrics.speed_mph < 1.0) {
        // Stationary - possible parking
        events.push(this.createValidationEvent('STATIONARY', sessionId, lotId, {
          speed_mph: metrics.speed_mph,
          accuracy_meters: metrics.accuracy_meters || undefined,
          raw_data: { 
            ...metrics.raw_data, 
            device_info: metrics.device_info 
          }
        }));
      } else if (metrics.speed_mph > 5.0) {
        // Moving fast - likely driving
        events.push(this.createValidationEvent('DRIVING', sessionId, lotId, {
          speed_mph: metrics.speed_mph,
          accuracy_meters: metrics.accuracy_meters || undefined,
          raw_data: { 
            ...metrics.raw_data, 
            device_info: metrics.device_info,
            movement_type: 'driving' 
          }
        }));
      } else {
        // Walking speed
        events.push(this.createValidationEvent('WALKING', sessionId, lotId, {
          speed_mph: metrics.speed_mph,
          accuracy_meters: metrics.accuracy_meters || undefined,
          raw_data: { 
            ...metrics.raw_data, 
            device_info: metrics.device_info,
            movement_type: 'walking' 
          }
        }));
      }
    }

    // Connectivity-based events - only if we have actual bluetooth data
    if (metrics.bluetooth_state && metrics.bluetooth_state !== null) {
      const eventType = metrics.bluetooth_state === 'CONNECTED' ? 'BLUETOOTH_CONNECT' : 'BLUETOOTH_DISCONNECT';
      events.push(this.createValidationEvent(eventType, sessionId, lotId, {
        bluetooth_state: metrics.bluetooth_state,
        raw_data: {
          ...metrics.raw_data,
          wifi_connected: metrics.wifi_connected,
          network_type: metrics.network_type,
          device_info: metrics.device_info
        }
      }));
    }

    // Add all events to the session
    session.events.push(...events);

    // Persist the updated session
    this.persistSession(session);

    if (__DEV__) console.log(`[ParkingValidation] Added ${events.length} real behavioral events to session ${sessionId}`);
  }

  private createValidationEvent(
    eventType: ValidationEvent['event_type'],
    sessionId: string,
    lotId: string,
    metadata: {
      speed_mph?: number;
      accuracy_meters?: number;
      bluetooth_state?: ValidationEvent['bluetooth_state'];
      raw_data?: Record<string, unknown>;
    } = {}
  ): ValidationEvent {
    return {
      id: `${sessionId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      event_type: eventType,
      timestamp: new Date(),
      speed_mph: metadata.speed_mph ?? null,
      accuracy_meters: metadata.accuracy_meters ?? null,
      confidence_score: this.calculateEventConfidence(eventType, metadata),
      bluetooth_state: metadata.bluetooth_state ?? null,
      raw_data: metadata.raw_data || {}
    };
  }

  private calculateEventConfidence(
    eventType: ValidationEvent['event_type'],
    metadata: {
      speed_mph?: number;
      accuracy_meters?: number;
      bluetooth_state?: ValidationEvent['bluetooth_state'];
      raw_data?: Record<string, unknown>;
    }
  ): number {
    // Use the ParkingValidator's confidence calculation
    return ParkingValidator.calculateConfidenceScore({
      speed: metadata.speed_mph,
      accuracy: metadata.accuracy_meters,
      bluetoothState: metadata.bluetooth_state || undefined,
      eventType: eventType,
    });
  }

  private clearSessionTimer(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }

  private cancelStaleSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') return;

    if (__DEV__) console.warn(`[ParkingValidation] Session ${sessionId} timed out, cancelling`);

    session.status = 'CANCELLED';
    this.activeSessions.delete(sessionId);
    this.sessionTimers.delete(sessionId);
    this.removePersistedSession(sessionId);

    // Stop collecting if no active sessions remain
    if (this.findAnyActiveSession() === undefined) {
      this.isCollectingData = false;
      this.behavioralCollector.stopCollection('parkingValidation');
    }
  }

  private findAnyActiveSession(): ParkingSession | undefined {
    for (const session of this.activeSessions.values()) {
      if (session.status === 'ACTIVE') return session;
    }
    return undefined;
  }

  private findActiveSessionByLotId(lotId: string): ParkingSession | undefined {
    for (const session of this.activeSessions.values()) {
      if (session.lotId === lotId && session.status === 'ACTIVE') {
        return session;
      }
    }
    return undefined;
  }

  private generateSessionId(): string {
    return `parking-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private notifyValidationComplete(analysis: ValidationAnalysis, lotId: string): void {
    this.validationCompleteListeners.forEach(listener => {
      try {
        listener(analysis, lotId);
      } catch (error) {
        if (__DEV__) console.error('[ParkingValidation] Error in validation listener:', error);
      }
    });
  }

  // --- Persistence Methods ---

  private async persistSession(session: ParkingSession): Promise<void> {
    try {
      const key = `parking_session_${session.sessionId}`;
      await AsyncStorage.setItem(key, JSON.stringify(session));
    } catch (error) {
      if (__DEV__) console.error('[ParkingValidation] Failed to persist session:', error);
    }
  }

  private async removePersistedSession(sessionId: string): Promise<void> {
    try {
      const key = `parking_session_${sessionId}`;
      await AsyncStorage.removeItem(key);
    } catch (error) {
      if (__DEV__) console.error('[ParkingValidation] Failed to remove persisted session:', error);
    }
  }

  private async loadPersistedSessions(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const sessionKeys = keys.filter(key => key.startsWith('parking_session_'));
      
      for (const key of sessionKeys) {
        const sessionData = await AsyncStorage.getItem(key);
        if (sessionData) {
          const session: ParkingSession = JSON.parse(sessionData);
          
          // Check if session is too old (cleanup)
          const sessionAge = Date.now() - new Date(session.startTime).getTime();
          const maxAge = 24 * 60 * 60 * 1000; // 24 hours
          
          if (sessionAge > maxAge || session.status !== 'ACTIVE') {
            await AsyncStorage.removeItem(key);
          } else {
            // Restore active session
            this.activeSessions.set(session.sessionId, session);
            if (session.status === 'ACTIVE') {
              this.isCollectingData = true;
            }
          }
        }
      }
      
      if (__DEV__) console.log(`[ParkingValidation] Restored ${this.activeSessions.size} active sessions`);
    } catch (error) {
      if (__DEV__) console.error('[ParkingValidation] Failed to load persisted sessions:', error);
    }
  }

  /**
   * Get debug info about current state
   */
  getDebugInfo(): {
    activeSessions: number;
    isCollectingData: boolean;
    sessions: Array<{ sessionId: string; lotId: string; eventCount: number; status: string }>;
  } {
    const sessionInfo = Array.from(this.activeSessions.values()).map(session => ({
      sessionId: session.sessionId,
      lotId: session.lotId,
      eventCount: session.events.length,
      status: session.status
    }));

    return {
      activeSessions: this.activeSessions.size,
      isCollectingData: this.isCollectingData,
      sessions: sessionInfo
    };
  }

  /**
   * Update location data for behavioral analysis
   * This should be called from the main location tracking service to avoid conflicts
   */
  updateLocation(locationData: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
    altitude?: number | null;
    heading?: number | null;
  }): void {
    // Pass location data to behavioral collector for speed and movement analysis
    this.behavioralCollector.updateLocation(locationData);
  }
}

// Export singleton instance
export const parkingValidationService = new ParkingValidationService();
export default parkingValidationService;
