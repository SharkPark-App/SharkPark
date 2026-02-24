import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { ValidationEvent, ParkingSession, BluetoothState, ValidationStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { CreateValidationEventDto } from './dto/create-validation-event.dto';
import { StartParkingSessionDto } from './dto/start-parking-session.dto';
import { EndParkingSessionDto } from './dto/end-parking-session.dto';

@Injectable()
export class ParkingValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a validation event from mobile device sensors
   * Includes algorithmic confidence scoring based on sensor data
   */
  async recordValidationEvent(dto: CreateValidationEventDto): Promise<ValidationEvent> {
    try {
      // Generate a device hash if not provided (for privacy)
      const deviceHash = dto.deviceHash || this.generateDeviceHash(dto.userId);

      // Look up the lot UUID from the lot_id string
      const lot = await this.prisma.lot.findFirst({
        where: { lot_id: dto.lotId },
        select: { id: true },
      });

      if (!lot) {
        throw new Error(`Lot ${dto.lotId} not found`);
      }

      const event = await this.prisma.validationEvent.create({
        data: {
          device_hash: deviceHash,
          lot_id: lot.id, // Use the UUID, not the lot_id string
          event_type: dto.eventType,
          timestamp: new Date(),
          speed_mph: dto.speed,
          accuracy_meters: dto.accuracy,
          confidence_score: this.calculateConfidenceScore(dto),
          bluetooth_state: dto.bluetoothState as BluetoothState,
          raw_data: dto.rawData ? JSON.stringify(dto.rawData) : undefined,
        },
      });

      // Trigger analysis if there's an active session
      await this.analyzeActiveSession(deviceHash, lot.id);

      return event;
    } catch (error) {
      console.error('Error recording validation event:', error);
      throw error;
    }
  }

  /**
   * Start a new parking session when entering lot geofence
   */
  async startParkingSession(dto: StartParkingSessionDto): Promise<ParkingSession> {
    try {
      const deviceHash = this.generateDeviceHash(dto.userId);
      
      // Look up the lot UUID from the lot_id string
      const lot = await this.prisma.lot.findFirst({
        where: { lot_id: dto.lotId },
        select: { id: true },
      });

      if (!lot) {
        throw new Error(`Lot ${dto.lotId} not found`);
      }
      
      const session = await this.prisma.parkingSession.create({
        data: {
          device_hash: deviceHash,
          lot_id: lot.id, // Use the UUID, not the lot_id string
          enter_time: dto.timestamp ? new Date(dto.timestamp) : new Date(),
          validation_status: 'ANALYZING' as ValidationStatus,
        },
      });

      return session;
    } catch (error) {
      console.error('Error starting parking session:', error);
      throw error;
    }
  }

  /**
   * End parking session and perform final validation analysis
   */
  async endParkingSession(dto: EndParkingSessionDto): Promise<void> {
    try {
      // Find the active session
      const session = await this.prisma.parkingSession.findFirst({
        where: {
          id: dto.sessionId,
          exit_time: null,
        },
      });

      if (!session) {
        throw new Error('No active parking session found');
      }

      // Perform comprehensive analysis
      const analysisResult = await this.performSessionAnalysis(session.id);

      // Update session with exit time and analysis results
      await this.prisma.parkingSession.update({
        where: { id: session.id },
        data: {
          exit_time: new Date(),
          validation_status: analysisResult.status as ValidationStatus,
          confidence_score: analysisResult.confidenceScore,
          occupancy_contribution: analysisResult.contributesToOccupancy,
          speed_transition_score: analysisResult.speedTransitionScore,
          dwell_time_score: analysisResult.dwellTimeScore,
          movement_pattern_score: analysisResult.movementPatternScore,
          bluetooth_score: analysisResult.bluetoothScore,
          validation_metadata: analysisResult.metadata,
        },
      });
    } catch (error) {
      console.error('Error ending parking session:', error);
      throw error;
    }
  }

  /**
   * Get validation statistics for a specific lot
   */
  async getLotValidationStats(lotId: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Look up the lot UUID from the lot_id string
    const lot = await this.prisma.lot.findFirst({
      where: { lot_id: lotId },
      select: { id: true },
    });

    if (!lot) {
      throw new Error(`Lot ${lotId} not found`);
    }

    const sessions = await this.prisma.parkingSession.findMany({
      where: {
        lot_id: lot.id, // Use the UUID
        enter_time: { gte: since },
      },
    });

    // Aggregate statistics
    const totalSessions = sessions.length;
    const statusCounts = sessions.reduce((acc: Record<string, number>, session) => {
      acc[session.validation_status] = (acc[session.validation_status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const averageConfidence = sessions
      .filter((s) => s.confidence_score !== null)
      .reduce((sum, s, _, arr) => sum + (s.confidence_score || 0) / arr.length, 0);

    return {
      total_sessions: totalSessions,
      parked: statusCounts.PARKED || 0,
      drove_through: statusCounts.DROVE_THROUGH || 0,
      searching: statusCounts.SEARCHING || 0,
      unknown: statusCounts.UNKNOWN || 0,
      analyzing: statusCounts.ANALYZING || 0,
      average_confidence: Math.round(averageConfidence * 100) / 100,
    };
  }

  /**
   * Generate privacy-preserving device hash
   */
  private generateDeviceHash(userId: string): string {
    return crypto.createHash('sha256')
      .update(userId + process.env.DEVICE_HASH_SALT || 'default_salt')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Calculate confidence score based on sensor data and patterns
   * Uses algorithmic approach without ML dependencies
   */
  private calculateConfidenceScore(dto: CreateValidationEventDto): number {
    let score = 0.5; // Base confidence

    // Speed-based confidence adjustments
    if (dto.speed !== undefined) {
      if (dto.eventType === 'SPEED_CHANGE') {
        // Speed dropping to walking pace indicates parking
        if (dto.speed <= 3) score += 0.3;
        // Speed remaining high suggests driving through
        else if (dto.speed > 15) score -= 0.2;
      }
      
      if (dto.eventType === 'STATIONARY') {
        // Being stationary is strong parking indicator
        score += 0.4;
      }
    }

    // GPS accuracy affects confidence
    if (dto.accuracy !== undefined) {
      if (dto.accuracy <= 5) score += 0.1;
      else if (dto.accuracy > 20) score -= 0.1;
    }

    // Bluetooth connectivity patterns
    if (dto.bluetoothState === 'CONNECTED') {
      // Car Bluetooth often disconnects when parked and user walks away
      score += 0.1;
    }

    // Event type specific adjustments
    switch (dto.eventType) {
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
   * Analyze active parking session based on accumulated validation events
   */
  private async analyzeActiveSession(deviceHash: string, lotUuid: string): Promise<void> {
    try {
      const activeSession = await this.prisma.parkingSession.findFirst({
        where: {
          device_hash: deviceHash,
          lot_id: lotUuid, // This is already the UUID
          exit_time: null,
        },
        orderBy: { enter_time: 'desc' },
      });

      if (!activeSession) return;

      // Get recent validation events for this session
      const events = await this.prisma.validationEvent.findMany({
        where: {
          device_hash: deviceHash,
          lot_id: lotUuid, // This is already the UUID
          timestamp: { gte: activeSession.enter_time },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (events.length < 3) return; // Need sufficient data points

      // Analyze patterns in the events
      const analysis = this.analyzeEventPatterns(events);

      // Update session with preliminary analysis
      await this.prisma.parkingSession.update({
        where: { id: activeSession.id },
        data: {
          validation_status: analysis.preliminaryStatus as ValidationStatus,
          confidence_score: analysis.confidence,
          validation_metadata: analysis.metadata,
        },
      });
    } catch (error) {
      console.error('Error analyzing active session:', error);
    }
  }

  /**
   * Perform comprehensive analysis of parking session
   */
  private async performSessionAnalysis(sessionId: string) {
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    const events = await this.prisma.validationEvent.findMany({
      where: {
        device_hash: session.device_hash,
        lot_id: session.lot_id,
        timestamp: {
          gte: session.enter_time,
          lte: session.exit_time || new Date(),
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    return this.analyzeEventPatterns(events, true);
  }

  /**
   * Analyze patterns in validation events to determine parking behavior
   */
  private analyzeEventPatterns(events: ValidationEvent[], isFinalAnalysis = false) {
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
    let status = 'UNKNOWN';
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
}
