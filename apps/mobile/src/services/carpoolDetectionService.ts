/**
 * Carpool Detection Service
 *
 * Uses multi-signal correlation to infer carpool confidence:
 * - Occupancy delta (coarse seat pressure change)
 * - Bluetooth new device appearance (passenger's phone)
 * - Motion burst (accelerometer activity)
 * - WiFi client joins (optional, soft signal)
 * - Time correlation (all signals within tight window)
 *
 * Outputs confidence score and recommended action:
 *   HIGH (>0.80):   auto-toggle carpool mode
 *   MEDIUM (0.50–0.80): prompt user "Add passenger?"
 *   LOW (<0.50):    manual-only, no auto action
 */

import { GeofenceEvent } from '../types/location';

export interface CarpoolInferenceSignals {
  occupancyDelta: number;              // seat occupancy change (e.g. +1, +2)
  occupancyBefore: number;             // occupancy before entry
  timeSinceEnter: number;              // milliseconds since ENTER event
  newBluetoothDevices: string[];       // device IDs that connected in window
  motionBurst: boolean;                // accelerometer spike detected
  wifiClientsJoined: number;           // new WiFi clients in time window
}

export interface CarpoolDetectionResult {
  confidence: number;                  // 0–1 scale
  action: 'auto_toggle' | 'prompt_user' | 'manual_only';
  estimatedPassengers: number;         // inferred passenger count (0–8)
  reasoning: string[];                 // human-readable signal explanation
  signals: CarpoolInferenceSignals;
  timestamp: string;
}

export interface CarpoolDetectionSession {
  sessionId: string;
  lotId: string;
  enterTime: number;                   // Date.now() at ENTER
  occupancyBefore: number;
  knownBluetoothDevices: Set<string>; // devices already paired before ENTER
  sessionBluetoothDevices: Set<string>; // devices seen connecting post-ENTER
  motionBurstDetected: boolean;
  wifiJoinCount: number;
  analysisResult?: CarpoolDetectionResult;
}

class CarpoolDetectionService {
  private activeSessions = new Map<string, CarpoolDetectionSession>();
  private initPromise: Promise<void>;

  // Thresholds (tunable for production calibration)
  private readonly CONFIDENCE_AUTO_TOGGLE = 0.80;
  private readonly CONFIDENCE_PROMPT = 0.50;
  private readonly OCCUPANCY_MIN_DELTA = 1; // must see occupancy increase by at least 1
  private readonly BLUETOOTH_WINDOW_MS = 15_000; // 15s window for BT connections post-ENTER
  private readonly MOTION_WINDOW_MS = 5_000; // 5s window for motion spike post-ENTER
  private readonly WIFI_WINDOW_MS = 20_000; // 20s window for WiFi joins post-ENTER

  // Confidence score weights
  private readonly WEIGHT_OCCUPANCY = 0.35;
  private readonly WEIGHT_BT_FAST = 0.40; // <10s BT connection
  private readonly WEIGHT_BT_SLOW = 0.20; // 10–30s BT connection
  private readonly WEIGHT_MOTION = 0.15;
  private readonly WEIGHT_WIFI = 0.10;

  constructor() {
    this.initPromise = Promise.resolve();
  }

  /**
   * Start a new carpool detection session when user enters a lot
   */
  async startDetectionSession(
    geofenceEvent: GeofenceEvent,
    occupancyBefore: number,
    knownBluetoothDevices: string[]
  ): Promise<string> {
    await this.initPromise;

    if (geofenceEvent.eventType !== 'ENTER') {
      return '';
    }

    const sessionId = this.generateSessionId();
    const session: CarpoolDetectionSession = {
      sessionId,
      lotId: geofenceEvent.regionId,
      enterTime: Date.now(),
      occupancyBefore,
      knownBluetoothDevices: new Set(knownBluetoothDevices),
      sessionBluetoothDevices: new Set(),
      motionBurstDetected: false,
      wifiJoinCount: 0,
    };

    this.activeSessions.set(sessionId, session);

    if (__DEV__) {
      console.log(
        `[CarpoolDetection] Started session ${sessionId} for ${geofenceEvent.regionId}. ` +
        `Known BT devices: ${knownBluetoothDevices.length}`
      );
    }

    return sessionId;
  }

  /**
   * Record a new Bluetooth device connection within this session
   */
  recordBluetoothDevice(sessionId: string, deviceId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Only count truly NEW devices (not already paired before ENTER)
    if (!session.knownBluetoothDevices.has(deviceId)) {
      session.sessionBluetoothDevices.add(deviceId);

      if (__DEV__) {
        console.log(
          `[CarpoolDetection] ${sessionId}: new BT device ${deviceId} ` +
          `(${Date.now() - session.enterTime}ms post-ENTER)`
        );
      }
    }
  }

  /**
   * Record motion burst (accelerometer spike) in this session
   */
  recordMotionBurst(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.motionBurstDetected = true;
    if (__DEV__) {
      console.log(`[CarpoolDetection] ${sessionId}: motion burst detected`);
    }
  }

  /**
   * Record WiFi client join in this session
   */
  recordWifiClientJoin(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.wifiJoinCount += 1;
    if (__DEV__) {
      console.log(`[CarpoolDetection] ${sessionId}: WiFi client joined (total: ${session.wifiJoinCount})`);
    }
  }

  /**
   * Analyze carpool confidence based on collected signals
   */
  async analyzeCarpool(
    sessionId: string,
    occupancyAfter: number
  ): Promise<CarpoolDetectionResult | null> {
    await this.initPromise;

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (__DEV__) console.log(`[CarpoolDetection] No session found: ${sessionId}`);
      return null;
    }

    const timeSinceEnter = Date.now() - session.enterTime;
    const occupancyDelta = occupancyAfter - session.occupancyBefore;

    // Build signal data
    const signals: CarpoolInferenceSignals = {
      occupancyDelta,
      occupancyBefore: session.occupancyBefore,
      timeSinceEnter,
      newBluetoothDevices: Array.from(session.sessionBluetoothDevices),
      motionBurst: session.motionBurstDetected,
      wifiClientsJoined: session.wifiJoinCount,
    };

    // === CONFIDENCE SCORING ===
    let confidence = 0;
    const reasoning: string[] = [];

    // NO OCCUPANCY INCREASE = STRONG SIGNAL AGAINST CARPOOL
    if (occupancyDelta <= 0) {
      reasoning.push('No occupancy increase detected');
      const result: CarpoolDetectionResult = {
        confidence: 0,
        action: 'manual_only',
        estimatedPassengers: 0,
        reasoning,
        signals,
        timestamp: new Date().toISOString(),
      };
      session.analysisResult = result;
      return result;
    }

    // OCCUPANCY SIGNAL: baseline that occupancy increased
    if (timeSinceEnter < 15_000) {
      confidence += this.WEIGHT_OCCUPANCY;
      reasoning.push(
        `Occupancy +${occupancyDelta} within ${(timeSinceEnter / 1000).toFixed(1)}s of ENTER`
      );
    }

    // BLUETOOTH SIGNAL: new devices connected
    if (signals.newBluetoothDevices.length > 0) {
      if (timeSinceEnter < 10_000) {
        confidence += this.WEIGHT_BT_FAST;
        reasoning.push(
          `${signals.newBluetoothDevices.length} new BT device(s) connected very fast ` +
          `(${(timeSinceEnter / 1000).toFixed(1)}s)`
        );
      } else if (timeSinceEnter < 30_000) {
        confidence += this.WEIGHT_BT_SLOW;
        reasoning.push(
          `${signals.newBluetoothDevices.length} new BT device(s) connected (delayed: ` +
          `${(timeSinceEnter / 1000).toFixed(1)}s)`
        );
      }
    }

    // MOTION SIGNAL: accelerometer spike near ENTER
    if (signals.motionBurst && timeSinceEnter < this.MOTION_WINDOW_MS) {
      confidence += this.WEIGHT_MOTION;
      reasoning.push('Motion burst detected near ENTER');
    }

    // WiFi SIGNAL: multiple clients joined
    if (signals.wifiClientsJoined >= 2 && timeSinceEnter < this.WIFI_WINDOW_MS) {
      confidence += this.WEIGHT_WIFI;
      reasoning.push(`${signals.wifiClientsJoined} WiFi client(s) joined`);
    }

    // Estimate passenger count based on occupancy delta and detection quality
    let estimatedPassengers = Math.min(occupancyDelta, 8); // cap at 8
    if (confidence > this.CONFIDENCE_AUTO_TOGGLE && signals.newBluetoothDevices.length > 0) {
      // High-confidence detection with actual BT device evidence
      estimatedPassengers = Math.min(occupancyDelta, signals.newBluetoothDevices.length + 1);
    }

    // === DECISION ===
    let action: 'auto_toggle' | 'prompt_user' | 'manual_only';
    if (confidence > this.CONFIDENCE_AUTO_TOGGLE) {
      action = 'auto_toggle';
    } else if (confidence > this.CONFIDENCE_PROMPT) {
      action = 'prompt_user';
    } else {
      action = 'manual_only';
    }

    const result: CarpoolDetectionResult = {
      confidence,
      action,
      estimatedPassengers,
      reasoning,
      signals,
      timestamp: new Date().toISOString(),
    };

    session.analysisResult = result;

    if (__DEV__) {
      console.log(
        `[CarpoolDetection] Analysis complete: ` +
        `confidence=${confidence.toFixed(2)}, action=${action}, ` +
        `passengers=${estimatedPassengers}, occupancyDelta=${occupancyDelta}`
      );
      console.log(`  Reasoning: ${reasoning.join(' | ')}`);
    }

    return result;
  }

  /**
   * Clean up session after analysis
   */
  endDetectionSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    if (__DEV__) console.log(`[CarpoolDetection] Ended session ${sessionId}`);
  }

  /**
   * Retrieve the latest analysis result for a session (if available)
   */
  getSessionResult(sessionId: string): CarpoolDetectionResult | undefined {
    const session = this.activeSessions.get(sessionId);
    return session?.analysisResult;
  }

  private generateSessionId(): string {
    return `carpool-${this.generateUuidV4()}`;
  }

  private generateUuidV4(): string {
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (!c?.getRandomValues) {
      throw new Error(
        '[CarpoolDetection] crypto.getRandomValues unavailable; ensure ' +
          "`import 'react-native-get-random-values';` is loaded before app bootstrap",
      );
    }
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

const carpoolDetectionService = new CarpoolDetectionService();
export default carpoolDetectionService;
