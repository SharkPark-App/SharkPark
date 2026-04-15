/**
 * Leave Detection Service
 * Detects predictive leave intent using behavioral patterns:
 * - Walking back to car (movement toward parked location)
 * - Bluetooth reconnecting (car connectivity)
 * - Sudden increase in speed (driving away)
 * - Time-based patterns and dwell duration
 * 
 * Integrates with parking validation system to provide real-time occupancy updates
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BehavioralMetrics, sharedBehavioralCollector } from './behavioralDataCollector';
import { haversineDistance } from '../utils/geoHelpers';
import { GeofenceEvent } from '../types/location';

export interface LeaveIntentSignal {
  type: 'WALKING_TO_CAR' | 'BLUETOOTH_RECONNECT' | 'SPEED_INCREASE' | 'MOVEMENT_PATTERN' | 'TIME_BASED' | 'ACTIVITY_VEHICLE';
  confidence: number; // 0-1 scale
  timestamp: Date;
  metadata: {
    speed_mph?: number;
    bluetooth_state?: string;
    movement_direction?: 'TOWARD_CAR' | 'AWAY_FROM_CAR' | 'UNKNOWN';
    time_since_park?: number; // minutes
    activity_type?: string;
    activity_confidence?: number;
    raw_data?: Record<string, unknown>;
  };
}

export interface LeaveIntentAnalysis {
  intent_probability: number; // 0-1 overall probability of leaving soon
  confidence_level: 'LOW' | 'MEDIUM' | 'HIGH';
  primary_signals: LeaveIntentSignal[];
  estimated_leave_time?: number; // minutes until likely departure
  should_notify_occupancy: boolean;
  analysis_metadata: {
    session_duration_minutes: number;
    signal_count: number;
    last_updated: string;
  };
}

export interface LeaveSession {
  sessionId: string;
  lotId: string;
  startTime: Date;
  parkedLocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  status: 'MONITORING' | 'INTENT_DETECTED' | 'LEAVING' | 'COMPLETED';
  signals: LeaveIntentSignal[];
  lastAnalysis?: LeaveIntentAnalysis;
  callbacks?: LeaveDetectionCallbacks;
}

interface LeaveDetectionCallbacks {
  onLeaveIntentDetected: (analysis: LeaveIntentAnalysis, lotId: string) => void;
  onLeaveConfirmed: (sessionId: string, lotId: string) => void;
  onError: (error: string) => void;
}

class LeaveDetectionService {
  private activeSessions = new Map<string, LeaveSession>();
  private behavioralCollector = sharedBehavioralCollector;
  private initPromise: Promise<void>;
  private lastLocation: { latitude: number; longitude: number } | null = null;

  // Minimum interval between signals of the same type to prevent duplicate emissions (60s)
  private readonly SIGNAL_DEDUP_INTERVAL_MS = 60 * 1000;

  // Leave detection thresholds
  private readonly INTENT_PROBABILITY_THRESHOLD = 0.6;
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.8;
  private readonly SPEED_INCREASE_THRESHOLD = 15; // mph - sudden driving speed
  private readonly WALKING_SPEED_RANGE = [2, 5]; // mph - walking back to car
  private readonly MIN_MONITORING_TIME = 5; // minutes before considering leave intent

  constructor() {
    this.initPromise = this.loadPersistedSessions();
  }

  /**
   * Start monitoring for leave intent when user parks
   */
  async startLeaveMonitoring(
    geofenceEvent: GeofenceEvent,
    callbacks: LeaveDetectionCallbacks,
    parkedLocation?: { latitude: number; longitude: number; accuracy: number }
  ): Promise<string> {
    await this.initPromise;
    if (geofenceEvent.eventType !== 'ENTER') {
      return '';
    }

    const sessionId = this.generateSessionId();
    
    const session: LeaveSession = {
      sessionId,
      lotId: geofenceEvent.regionId,
      startTime: new Date(),
      parkedLocation,
      status: 'MONITORING',
      signals: [],
      callbacks,
    };

    this.activeSessions.set(sessionId, session);
    await this.persistSession(session);

    // Start behavioral data collection for leave detection
    this.startDataCollection(sessionId);

    if (__DEV__) console.log(`[LeaveDetection] Started monitoring session ${sessionId} for lot ${geofenceEvent.regionId}`);
    return sessionId;
  }

  /**
   * Stop monitoring and complete leave detection
   */
  async completeLeaveMonitoring(geofenceEvent: GeofenceEvent): Promise<LeaveIntentAnalysis | null> {
    await this.initPromise;
    if (geofenceEvent.eventType !== 'EXIT') {
      return null;
    }

    const session = this.findActiveSessionByLotId(geofenceEvent.regionId);
    if (!session) {
      if (__DEV__) console.log(`[LeaveDetection] No active session found for lot ${geofenceEvent.regionId}`);
      return null;
    }

    session.status = 'COMPLETED';

    // Final analysis
    const finalAnalysis = this.analyzeLeaveIntent(session);
    session.lastAnalysis = finalAnalysis;

    if (__DEV__) console.log(`[LeaveDetection] Session ${session.sessionId} completed:`, {
      intent_probability: finalAnalysis.intent_probability,
      confidence_level: finalAnalysis.confidence_level,
      signal_count: finalAnalysis.primary_signals.length
    });

    // Notify the session's own callbacks
    session.callbacks?.onLeaveConfirmed(session.sessionId, session.lotId);

    // Clean up
    this.activeSessions.delete(session.sessionId);
    await this.removePersistedSession(session.sessionId);

    // Only stop behavioral collection when the LAST monitoring session finishes
    const hasRemainingMonitoring = [...this.activeSessions.values()].some(
      s => s.status === 'MONITORING'
    );
    if (!hasRemainingMonitoring) {
      this.behavioralCollector.stopCollection('leaveDetection');
    }

    return finalAnalysis;
  }

  /**
   * Get current leave intent analysis for a lot
   */
  async getCurrentLeaveIntent(lotId: string): Promise<LeaveIntentAnalysis | null> {
    await this.initPromise;
    const session = this.findActiveSessionByLotId(lotId);
    if (!session || session.signals.length < 2) {
      return null; // Need minimum signals for analysis
    }

    return this.analyzeLeaveIntent(session);
  }

  // --- Private Methods ---

  private startDataCollection(sessionId: string): void {
    // Start behavioral data collection
    this.behavioralCollector.startCollection({
      onMetricsCollected: (metrics: BehavioralMetrics) => {
        this.processBehavioralMetrics(sessionId, metrics);
      },
      onError: (error: string) => {
        if (__DEV__) console.error('[LeaveDetection] Behavioral data collection error:', error);
        const session = this.activeSessions.get(sessionId);
        session?.callbacks?.onError(error);
      }
    }, 'leaveDetection');
  }

  private processBehavioralMetrics(sessionId: string, metrics: BehavioralMetrics): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'MONITORING') {
      return;
    }

    const signals: LeaveIntentSignal[] = [];
    const currentTime = new Date();
    const sessionDuration = (currentTime.getTime() - session.startTime.getTime()) / (1000 * 60); // minutes

    // Skip analysis if too early (avoid false positives)
    if (sessionDuration < this.MIN_MONITORING_TIME) {
      return;
    }

    // 1. Speed-based leave intent detection
    if (metrics.speed_mph !== null) {
      // Sudden speed increase - driving away
      if (metrics.speed_mph > this.SPEED_INCREASE_THRESHOLD) {
        signals.push({
          type: 'SPEED_INCREASE',
          confidence: Math.min(0.9, metrics.speed_mph / 25), // Higher speed = higher confidence
          timestamp: currentTime,
          metadata: {
            speed_mph: metrics.speed_mph,
            time_since_park: sessionDuration,
            raw_data: metrics.raw_data
          }
        });
      }

      // Walking speed - potentially walking to car
      if (metrics.speed_mph >= this.WALKING_SPEED_RANGE[0] && 
          metrics.speed_mph <= this.WALKING_SPEED_RANGE[1]) {
        
        const movementDirection = this.analyzeMovementDirection(session);
        
        signals.push({
          type: 'WALKING_TO_CAR',
          confidence: movementDirection === 'TOWARD_CAR' ? 0.7 : 0.3,
          timestamp: currentTime,
          metadata: {
            speed_mph: metrics.speed_mph,
            movement_direction: movementDirection,
            time_since_park: sessionDuration,
            raw_data: metrics.raw_data
          }
        });
      }
    }

    // 2. Bluetooth reconnection detection
    if (metrics.bluetooth_state === 'CONNECTED') {
      // Check if this is a state change from previous readings
      const recentSignals = session.signals.filter(s => 
        (currentTime.getTime() - s.timestamp.getTime()) < (5 * 60 * 1000) // last 5 minutes
      );
      
      const hadBluetoothDisconnected = recentSignals.some(s => 
        s.metadata.bluetooth_state === 'DISCONNECTED'
      );

      if (hadBluetoothDisconnected) {
        signals.push({
          type: 'BLUETOOTH_RECONNECT',
          confidence: 0.8, // High confidence - strong leave indicator
          timestamp: currentTime,
          metadata: {
            bluetooth_state: metrics.bluetooth_state,
            time_since_park: sessionDuration,
            raw_data: metrics.raw_data
          }
        });
      }
    }

    // 3. Time-based leave probability
    if (sessionDuration > 30) { // After 30 minutes, increasing leave probability
      const timeBasedConfidence = Math.min(0.6, (sessionDuration - 30) / 60); // Gradually increases
      
      signals.push({
        type: 'TIME_BASED',
        confidence: timeBasedConfidence,
        timestamp: currentTime,
        metadata: {
          time_since_park: sessionDuration,
          raw_data: { session_duration_factor: timeBasedConfidence }
        }
      });
    }

    // Deduplicate: skip signal types that were already emitted within the dedup window
    const dedupedSignals = signals.filter(signal => {
      const lastOfType = [...session.signals].reverse().find(s => s.type === signal.type);
      if (!lastOfType) return true;
      return (currentTime.getTime() - lastOfType.timestamp.getTime()) >= this.SIGNAL_DEDUP_INTERVAL_MS;
    });

    // Add signals to session
    session.signals.push(...dedupedSignals);

    // Analyze current intent
    const analysis = this.analyzeLeaveIntent(session);
    session.lastAnalysis = analysis;

    // Check if we should notify about leave intent
    if (analysis.should_notify_occupancy && analysis.confidence_level !== 'LOW') {
      session.callbacks?.onLeaveIntentDetected(analysis, session.lotId);
    }

    // Persist updated session
    this.persistSession(session);

    if (__DEV__) console.log(`[LeaveDetection] Added ${dedupedSignals.length}/${signals.length} signals (deduped). Intent probability: ${Math.round(analysis.intent_probability * 100)}%`);
  }

  private analyzeLeaveIntent(session: LeaveSession): LeaveIntentAnalysis {
    const currentTime = new Date();
    const sessionDuration = (currentTime.getTime() - session.startTime.getTime()) / (1000 * 60); // minutes
    
    // Get recent signals (last 10 minutes for analysis)
    const recentSignals = session.signals.filter(signal => 
      (currentTime.getTime() - signal.timestamp.getTime()) < (10 * 60 * 1000)
    );

    if (recentSignals.length === 0) {
      return this.createEmptyAnalysis(sessionDuration);
    }

    // Weight different signal types (reweighted for activity recognition)
    const signalWeights: Record<LeaveIntentSignal['type'], number> = {
      'ACTIVITY_VEHICLE': 0.35,    // Strongest — native SDK vehicle detection
      'BLUETOOTH_RECONNECT': 0.25, // Strong — reconnected to car
      'SPEED_INCREASE': 0.20,      // Strong — driving speed detected
      'WALKING_TO_CAR': 0.10,      // Moderate — walking toward parked location
      'MOVEMENT_PATTERN': 0.05,    // Weak — general movement
      'TIME_BASED': 0.05           // Weak — time-based probability
    };

    // Calculate weighted probability.
    // Bluetooth corroboration: BLUETOOTH_RECONNECT alone is unreliable (could be
    // AirPods, headphones, etc.). Only count it when accompanied by at least one
    // other signal type (e.g. WALKING_TO_CAR, SPEED_INCREASE, ACTIVITY_VEHICLE).
    const hasCorroboratingSignal = recentSignals.some(s =>
      s.type !== 'BLUETOOTH_RECONNECT' && s.type !== 'TIME_BASED'
    );

    let totalWeight = 0;
    let weightedScore = 0;

    recentSignals.forEach(signal => {
      let weight = signalWeights[signal.type] || 0.1;

      // Downweight uncorroborated Bluetooth to near-zero
      if (signal.type === 'BLUETOOTH_RECONNECT' && !hasCorroboratingSignal) {
        weight = 0.02; // Effectively ignored without corroboration
      }

      totalWeight += weight;
      weightedScore += signal.confidence * weight;
    });

    const intentProbability = totalWeight > 0 ? Math.min(1.0, weightedScore / totalWeight) : 0;

    // Determine confidence level
    let confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (intentProbability >= this.HIGH_CONFIDENCE_THRESHOLD) confidenceLevel = 'HIGH';
    else if (intentProbability >= this.INTENT_PROBABILITY_THRESHOLD) confidenceLevel = 'MEDIUM';

    // Should notify occupancy system?
    const shouldNotify = intentProbability >= this.INTENT_PROBABILITY_THRESHOLD && 
                        recentSignals.length >= 2 &&
                        sessionDuration >= this.MIN_MONITORING_TIME;

    // Estimate leave time based on signals
    let estimatedLeaveTime: number | undefined;
    if (intentProbability > 0.7) {
      const activityVehicle = recentSignals.find(s => s.type === 'ACTIVITY_VEHICLE');
      const bluetoothReconnect = recentSignals.find(s => s.type === 'BLUETOOTH_RECONNECT');
      const speedIncrease = recentSignals.find(s => s.type === 'SPEED_INCREASE');
      
      if (speedIncrease || activityVehicle) estimatedLeaveTime = 1; // Already driving
      else if (bluetoothReconnect) estimatedLeaveTime = 3; // Getting in car
      else estimatedLeaveTime = 5; // Walking to car
    }

    return {
      intent_probability: Math.round(intentProbability * 100) / 100,
      confidence_level: confidenceLevel,
      primary_signals: recentSignals.slice(0, 5), // Top 5 most recent
      estimated_leave_time: estimatedLeaveTime,
      should_notify_occupancy: shouldNotify,
      analysis_metadata: {
        session_duration_minutes: Math.round(sessionDuration * 100) / 100,
        signal_count: recentSignals.length,
        last_updated: currentTime.toISOString()
      }
    };
  }

  private analyzeMovementDirection(
    session: LeaveSession
  ): 'TOWARD_CAR' | 'AWAY_FROM_CAR' | 'UNKNOWN' {
    // Compute actual distance between current position and parked location.
    // If the user is getting closer, they're walking toward their car.
    if (!session.parkedLocation || !this.lastLocation) {
      return 'UNKNOWN';
    }

    const distanceToCar = haversineDistance(
      this.lastLocation.latitude,
      this.lastLocation.longitude,
      session.parkedLocation.latitude,
      session.parkedLocation.longitude,
    );

    // Within 50m of parked location → likely approaching car
    if (distanceToCar < 50) return 'TOWARD_CAR';
    // More than 200m away → likely walking away
    if (distanceToCar > 200) return 'AWAY_FROM_CAR';
    // In between → ambiguous
    return 'UNKNOWN';
  }

  private createEmptyAnalysis(sessionDuration: number): LeaveIntentAnalysis {
    return {
      intent_probability: 0,
      confidence_level: 'LOW',
      primary_signals: [],
      should_notify_occupancy: false,
      analysis_metadata: {
        session_duration_minutes: Math.round(sessionDuration * 100) / 100,
        signal_count: 0,
        last_updated: new Date().toISOString()
      }
    };
  }

  private findActiveSessionByLotId(lotId: string): LeaveSession | undefined {
    for (const session of this.activeSessions.values()) {
      if (session.lotId === lotId && session.status === 'MONITORING') {
        return session;
      }
    }
    return undefined;
  }

  private generateSessionId(): string {
    return `leave-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  // --- Persistence Methods ---

  private async persistSession(session: LeaveSession): Promise<void> {
    try {
      await AsyncStorage.setItem(
        `leave_session_${session.sessionId}`,
        JSON.stringify({
          ...session,
          callbacks: undefined, // functions are not serializable
          startTime: session.startTime.toISOString(),
          signals: session.signals.map(signal => ({
            ...signal,
            timestamp: signal.timestamp.toISOString()
          }))
        })
      );
    } catch (error) {
      if (__DEV__) console.error('[LeaveDetection] Failed to persist session:', error);
    }
  }

  private async removePersistedSession(sessionId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`leave_session_${sessionId}`);
    } catch (error) {
      if (__DEV__) console.error('[LeaveDetection] Failed to remove persisted session:', error);
    }
  }

  private async loadPersistedSessions(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const leaveSessionKeys = keys.filter(key => key.startsWith('leave_session_'));
      
      for (const key of leaveSessionKeys) {
        const sessionData = await AsyncStorage.getItem(key);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          const session: LeaveSession = {
            ...parsed,
            startTime: new Date(parsed.startTime),
            signals: parsed.signals.map((signal: LeaveIntentSignal) => ({
              ...signal,
              timestamp: new Date(signal.timestamp)
            }))
          };
          
          // Only restore recent sessions (within last 24 hours)
          const age = Date.now() - session.startTime.getTime();
          if (age < 24 * 60 * 60 * 1000) {
            this.activeSessions.set(session.sessionId, session);
          } else {
            // Clean up old sessions
            await AsyncStorage.removeItem(key);
          }
        }
      }
      
      if (__DEV__) console.log(`[LeaveDetection] Restored ${this.activeSessions.size} active sessions`);
    } catch (error) {
      if (__DEV__) console.error('[LeaveDetection] Failed to load persisted sessions:', error);
    }
  }

  /**
   * Get debug info about current state
   */
  getDebugInfo(): {
    activeSessions: number;
    isMonitoring: boolean;
    sessions: Array<{ sessionId: string; lotId: string; signalCount: number; status: string }>;
  } {
    return {
      activeSessions: this.activeSessions.size,
      isMonitoring: [...this.activeSessions.values()].some(s => s.status === 'MONITORING'),
      sessions: Array.from(this.activeSessions.values()).map(session => ({
        sessionId: session.sessionId,
        lotId: session.lotId,
        signalCount: session.signals.length,
        status: session.status
      }))
    };
  }

  /**
   * Update location data for behavioral analysis.
   * Stores the latest position for movement direction analysis (haversine TOWARD_CAR).
   *
   * NOTE: The behavioral collector is called directly by the provider’s
   * handleLocationUpdate — do NOT forward here (it would triple-fire
   * collectAndSendMetrics, inflating signal counts and battery usage).
   */
  updateLocation(locationData: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
    altitude?: number | null;
    heading?: number | null;
  }): void {
    // Track latest position for movement direction analysis
    this.lastLocation = { latitude: locationData.latitude, longitude: locationData.longitude };
  }

  /**
   * Process SDK onActivityChange events for leave detection.
   * Emits ACTIVITY_VEHICLE signal when in_vehicle activity is detected.
   */
  processActivityChange(activity: string, confidence: number): void {
    const currentTime = new Date();

    for (const session of this.activeSessions.values()) {
      if (session.status !== 'MONITORING') continue;

      const sessionDuration = (currentTime.getTime() - session.startTime.getTime()) / (1000 * 60);
      if (sessionDuration < this.MIN_MONITORING_TIME) continue;

      // in_vehicle/automotive → strong leave indicator
      const lowerActivity = activity.toLowerCase();
      if (lowerActivity === 'in_vehicle' || lowerActivity === 'automotive') {
        const normalizedConfidence = Math.min(confidence, 100) / 100;
        const signal: LeaveIntentSignal = {
          type: 'ACTIVITY_VEHICLE',
          confidence: normalizedConfidence,
          timestamp: currentTime,
          metadata: {
            activity_type: activity,
            activity_confidence: confidence,
            time_since_park: sessionDuration,
          },
        };

        // Dedup: skip if same type emitted within dedup window
        const lastOfType = [...session.signals].reverse().find(s => s.type === 'ACTIVITY_VEHICLE');
        if (lastOfType && (currentTime.getTime() - lastOfType.timestamp.getTime()) < this.SIGNAL_DEDUP_INTERVAL_MS) {
          continue;
        }

        session.signals.push(signal);

        const analysis = this.analyzeLeaveIntent(session);
        session.lastAnalysis = analysis;

        if (analysis.should_notify_occupancy && analysis.confidence_level !== 'LOW') {
          session.callbacks?.onLeaveIntentDetected(analysis, session.lotId);
        }

        this.persistSession(session);

        if (__DEV__) {
          console.log(`[LeaveDetection] ACTIVITY_VEHICLE signal: ${activity} (${confidence}%) for lot ${session.lotId}`);
        }
      }

      // on_foot/walking → emit WALKING_TO_CAR signal
      if (lowerActivity === 'on_foot' || lowerActivity === 'walking') {
        const normalizedConfidence = Math.min(confidence, 100) / 100;
        const signal: LeaveIntentSignal = {
          type: 'WALKING_TO_CAR',
          confidence: normalizedConfidence * 0.7,
          timestamp: currentTime,
          metadata: {
            activity_type: activity,
            activity_confidence: confidence,
            movement_direction: sessionDuration > 15 ? 'TOWARD_CAR' : 'UNKNOWN',
            time_since_park: sessionDuration,
          },
        };

        const lastOfType = [...session.signals].reverse().find(s => s.type === 'WALKING_TO_CAR');
        if (lastOfType && (currentTime.getTime() - lastOfType.timestamp.getTime()) < this.SIGNAL_DEDUP_INTERVAL_MS) {
          continue;
        }

        session.signals.push(signal);

        const analysis = this.analyzeLeaveIntent(session);
        session.lastAnalysis = analysis;

        if (analysis.should_notify_occupancy && analysis.confidence_level !== 'LOW') {
          session.callbacks?.onLeaveIntentDetected(analysis, session.lotId);
        }

        this.persistSession(session);
      }
    }
  }

  /**
   * Process SDK onMotionChange events for leave detection.
   */
  processMotionChange(isMoving: boolean): void {
    // Motion change is supplementary — triggers re-analysis of existing signals
    if (!isMoving) return; // Only care about transitioning TO moving

    const currentTime = new Date();

    for (const session of this.activeSessions.values()) {
      if (session.status !== 'MONITORING') continue;

      const sessionDuration = (currentTime.getTime() - session.startTime.getTime()) / (1000 * 60);
      if (sessionDuration < this.MIN_MONITORING_TIME) continue;

      const signal: LeaveIntentSignal = {
        type: 'MOVEMENT_PATTERN',
        confidence: 0.4,
        timestamp: currentTime,
        metadata: {
          time_since_park: sessionDuration,
          raw_data: { motion_change: 'stationary_to_moving' },
        },
      };

      const lastOfType = [...session.signals].reverse().find(s => s.type === 'MOVEMENT_PATTERN');
      if (lastOfType && (currentTime.getTime() - lastOfType.timestamp.getTime()) < this.SIGNAL_DEDUP_INTERVAL_MS) {
        continue;
      }

      session.signals.push(signal);

      const analysis = this.analyzeLeaveIntent(session);
      session.lastAnalysis = analysis;

      if (analysis.should_notify_occupancy && analysis.confidence_level !== 'LOW') {
        session.callbacks?.onLeaveIntentDetected(analysis, session.lotId);
      }

      this.persistSession(session);
    }
  }
}

// Export singleton instance
export const leaveDetectionService = new LeaveDetectionService();
export default leaveDetectionService;

// Export class and types for testing
export { LeaveDetectionService };
