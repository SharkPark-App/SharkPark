/**
 * Prisma Seed Script
 *
 * Populates PostgreSQL with realistic test data for development:
 * - 1 school (CSULB)
 * - 28 parking lots with CSULB-accurate locations and capacities
 * - 5 user profiles with favorites
 * - 4 campus events with parking impacts
 * - Weather data
 * - 7 days of historical occupancy snapshots
 * - Sample occupancy events (ENTER/EXIT from geofencing)
 * - Device deduplication records
 *
 * Usage: pnpm db:seed
 */

import 'dotenv/config';
import { PrismaClient, LotType, UserType, ConfidenceLevel, CampusEventType, ImpactLevel, EventType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// Prisma v7: "client" engine requires a driver adapter for direct DB connections
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────

function generateGeofence(centerLat: number, centerLng: number, radiusMeters = 50) {
  const latOffset = radiusMeters / 111000;
  const lngOffset = radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180));
  return [
    { lat: centerLat + latOffset, lng: centerLng - lngOffset },
    { lat: centerLat + latOffset, lng: centerLng + lngOffset },
    { lat: centerLat - latOffset, lng: centerLng + lngOffset },
    { lat: centerLat - latOffset, lng: centerLng - lngOffset },
    { lat: centerLat + latOffset, lng: centerLng - lngOffset },
  ];
}

// ────────────────────────────────────────────────────────────
// Parking Lot Data (30 CSULB lots)
// ────────────────────────────────────────────────────────────

interface LotSeed {
  lot_id: string;
  lot_name: string;
  display_name: string;
  lot_number: string;
  lot_type: LotType;
  capacity: number;
  current_occupancy: number;
  location_description: string;
  building_proximity: string[];
  center_lat: number;
  center_lng: number;
  geofence_radius: number;
  permit_types: string[];
  daily_permit_allowed: boolean;
  daily_rate?: number;
  hours_weekday: object;
  hours_saturday: object | string;
  hours_sunday: object | string;
  ev_charging_stations: number;
  motorcycle_spaces: number;
  accessible_spaces: number;
  has_lighting: boolean;
  has_cameras: boolean;
  has_emergency_phone: boolean;
  is_covered: boolean;
  is_paved: boolean;
  levels?: number;
  penetration_rate: number;
  avg_turnover_minutes: number;
  confidence: ConfidenceLevel;
}

const parkingLots: LotSeed[] = [
  // ===== STUDENT LOTS (G LOTS) =====
  {
    lot_id: 'G1', lot_name: 'Lot G1', display_name: 'Lot G1 - East Campus', lot_number: 'G1',
    lot_type: LotType.STUDENT, capacity: 231, current_occupancy: 182,
    location_description: 'East Campus - Near Japanese Garden',
    building_proximity: ['ECS', 'Japanese Garden', 'East Walkway'],
    center_lat: 33.7838, center_lng: -118.1089, geofence_radius: 50,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 4, accessible_spaces: 8,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.15,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G2', lot_name: 'Lot G2', display_name: 'Lot G2 - Walter Pyramid', lot_number: 'G2',
    lot_type: LotType.STUDENT, capacity: 419, current_occupancy: 307,
    location_description: 'East Campus - Walter Pyramid',
    building_proximity: ['Walter Pyramid', 'Athletics', 'Tennis Courts'],
    center_lat: 33.7825, center_lng: -118.1098, geofence_radius: 70,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '06:00', close: '23:00' },
    hours_saturday: { open: '06:00', close: '23:00' },
    hours_sunday: { open: '08:00', close: '22:00' },
    ev_charging_stations: 0, motorcycle_spaces: 8, accessible_spaces: 12,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.18,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G3', lot_name: 'Lot G3', display_name: 'Lot G3 - East Campus', lot_number: 'G3',
    lot_type: LotType.STUDENT, capacity: 230, current_occupancy: 176,
    location_description: 'East Campus',
    building_proximity: ['East Campus Buildings'],
    center_lat: 33.7830, center_lng: -118.1075, geofence_radius: 60,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 6, accessible_spaces: 9,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.12,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G4', lot_name: 'Lot G4', display_name: 'Lot G4 - Central Campus', lot_number: 'G4',
    lot_type: LotType.STUDENT, capacity: 463, current_occupancy: 331,
    location_description: 'Central Campus',
    building_proximity: ['USU', 'Library', 'Admin Building'],
    center_lat: 33.7819, center_lng: -118.1134, geofence_radius: 80,
    permit_types: ['Gold', 'Green', 'Daily'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 15, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G5', lot_name: 'Lot G5', display_name: 'Lot G5 - West Campus', lot_number: 'G5',
    lot_type: LotType.STUDENT, capacity: 120, current_occupancy: 82,
    location_description: 'West Campus',
    building_proximity: ['West Campus Buildings'],
    center_lat: 33.7805, center_lng: -118.1165, geofence_radius: 55,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.10,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G7', lot_name: 'Lot G7', display_name: 'Lot G7 - Engineering', lot_number: 'G7',
    lot_type: LotType.STUDENT, capacity: 751, current_occupancy: 613,
    location_description: 'East Campus - Engineering Complex',
    building_proximity: ['Engineering', 'Computer Science', 'CEAC'],
    center_lat: 33.7842, center_lng: -118.1115, geofence_radius: 65,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '20:00' },
    hours_sunday: { open: '10:00', close: '18:00' },
    ev_charging_stations: 31, motorcycle_spaces: 7, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.16,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G8', lot_name: 'Lot G8', display_name: 'Lot G8 - Student Health', lot_number: 'G8',
    lot_type: LotType.STUDENT, capacity: 720, current_occupancy: 548,
    location_description: 'West Campus - Student Health Center',
    building_proximity: ['Student Health', 'Recreation Center'],
    center_lat: 33.7812, center_lng: -118.1145, geofence_radius: 60,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 2, motorcycle_spaces: 6, accessible_spaces: 9,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.14,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G9', lot_name: 'Lot G9', display_name: 'Lot G9 - Library', lot_number: 'G9',
    lot_type: LotType.STUDENT, capacity: 405, current_occupancy: 347,
    location_description: 'West Campus - University Library',
    building_proximity: ['Library', 'Academic Buildings'],
    center_lat: 33.7817, center_lng: -118.1152, geofence_radius: 70,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '06:00', close: '23:00' },
    hours_saturday: { open: '07:00', close: '23:00' },
    hours_sunday: { open: '09:00', close: '22:00' },
    ev_charging_stations: 0, motorcycle_spaces: 8, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.19,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G10', lot_name: 'Lot G10', display_name: 'Lot G10 - South Campus', lot_number: 'G10',
    lot_type: LotType.STUDENT, capacity: 19, current_occupancy: 15,
    location_description: 'South Campus', building_proximity: ['South Campus Buildings'],
    center_lat: 33.7798, center_lng: -118.1120, geofence_radius: 55,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 3,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.11,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G11', lot_name: 'Lot G11', display_name: 'Lot G11 - Palo Verde', lot_number: 'G11',
    lot_type: LotType.STUDENT, capacity: 319, current_occupancy: 229,
    location_description: 'East Campus - Palo Verde',
    building_proximity: ['Palo Verde', 'Student Housing'],
    center_lat: 33.7845, center_lng: -118.1070, geofence_radius: 50,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 4, accessible_spaces: 34,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.09,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'G12', lot_name: 'Lot G12', display_name: 'Lot G12 - North Campus', lot_number: 'G12',
    lot_type: LotType.STUDENT, capacity: 628, current_occupancy: 455,
    location_description: 'North Campus',
    building_proximity: ['North Campus Buildings'],
    center_lat: 33.7855, center_lng: -118.1130, geofence_radius: 45,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 14, motorcycle_spaces: 3, accessible_spaces: 19,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.08,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'G14', lot_name: 'Lot G14', display_name: 'Lot G14 - Beachside', lot_number: 'G14',
    lot_type: LotType.STUDENT, capacity: 262, current_occupancy: 197,
    location_description: 'West Campus - Near PCH',
    building_proximity: ['Beach Access', 'West Gate'],
    center_lat: 33.7790, center_lng: -118.1175, geofence_radius: 60,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '07:00', close: '22:00' },
    hours_sunday: { open: '08:00', close: '20:00' },
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 8,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.13,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.MEDIUM,
  },
  // ===== EMPLOYEE LOTS =====
  {
    lot_id: 'E1', lot_name: 'Lot E1', display_name: 'Lot E1 - Faculty/Staff', lot_number: 'E1',
    lot_type: LotType.EMPLOYEE, capacity: 440, current_occupancy: 359,
    location_description: 'Central Campus - Admin Area',
    building_proximity: ['Administration', 'Faculty Offices'],
    center_lat: 33.7822, center_lng: -118.1128, geofence_radius: 40,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 12,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.22,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E2', lot_name: 'Lot E2', display_name: 'Lot E2 - Faculty/Staff', lot_number: 'E2',
    lot_type: LotType.EMPLOYEE, capacity: 269, current_occupancy: 221,
    location_description: 'East Campus - Faculty',
    building_proximity: ['Engineering Faculty', 'Science Faculty'],
    center_lat: 33.7835, center_lng: -118.1105, geofence_radius: 35,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 21,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.25,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E3', lot_name: 'Lot E3', display_name: 'Lot E3 - Faculty/Staff', lot_number: 'E3',
    lot_type: LotType.EMPLOYEE, capacity: 65, current_occupancy: 49,
    location_description: 'West Campus - Faculty',
    building_proximity: ['Liberal Arts', 'Education'],
    center_lat: 33.7810, center_lng: -118.1155, geofence_radius: 45,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 3, accessible_spaces: 3,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E4', lot_name: 'Lot E4', display_name: 'Lot E4 - Faculty/Staff', lot_number: 'E4',
    lot_type: LotType.EMPLOYEE, capacity: 81, current_occupancy: 67,
    location_description: 'Central Campus - Faculty',
    building_proximity: ['Admin Building', 'President Office'],
    center_lat: 33.7820, center_lng: -118.1140, geofence_radius: 60,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '08:00', close: '22:00' },
    hours_sunday: { open: '08:00', close: '20:00' },
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.30,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E5', lot_name: 'Lot E5', display_name: 'Lot E5 - Faculty/Staff', lot_number: 'E5',
    lot_type: LotType.EMPLOYEE, capacity: 66, current_occupancy: 54,
    location_description: 'North Campus - Faculty',
    building_proximity: ['Science Buildings', 'Research Labs'],
    center_lat: 33.7850, center_lng: -118.1125, geofence_radius: 30,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.28,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'E6', lot_name: 'Lot E6', display_name: 'Lot E6 - Faculty/Staff', lot_number: 'E6',
    lot_type: LotType.EMPLOYEE, capacity: 240, current_occupancy: 194,
    location_description: 'Central Campus - Faculty',
    building_proximity: ['Music', 'Theatre Arts'],
    center_lat: 33.7815, center_lng: -118.1138, geofence_radius: 40,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 14,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.18,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'E7', lot_name: 'Lot E7', display_name: 'Lot E7 - Faculty/Staff', lot_number: 'E7',
    lot_type: LotType.EMPLOYEE, capacity: 91, current_occupancy: 70,
    location_description: 'South Campus - Faculty',
    building_proximity: ['South Campus Faculty Offices'],
    center_lat: 33.7795, center_lng: -118.1135, geofence_radius: 30,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 8,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.15,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  // ===== ADDITIONAL STUDENT LOTS =====
  {
    lot_id: 'G6', lot_name: 'Lot G6', display_name: 'Lot G6 - South Campus', lot_number: 'G6',
    lot_type: LotType.STUDENT, capacity: 793, current_occupancy: 599,
    location_description: 'South Campus',
    building_proximity: ['Kinesiology', 'Gymnasium'],
    center_lat: 33.7800, center_lng: -118.1110, geofence_radius: 55,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.11,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G13', lot_name: 'Lot G13', display_name: 'Lot G13 - Upper Campus', lot_number: 'G13',
    lot_type: LotType.STUDENT, capacity: 304, current_occupancy: 226,
    location_description: 'Upper Campus',
    building_proximity: ['Upper Campus Buildings'],
    center_lat: 33.7860, center_lng: -118.1100, geofence_radius: 50,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 3, accessible_spaces: 5,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.08,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E8', lot_name: 'Lot E8', display_name: 'Lot E8 - Faculty/Staff', lot_number: 'E8',
    lot_type: LotType.EMPLOYEE, capacity: 380, current_occupancy: 285,
    location_description: 'North Campus - Faculty',
    building_proximity: ['Research Park'],
    center_lat: 33.7858, center_lng: -118.1115, geofence_radius: 25,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 13, motorcycle_spaces: 1, accessible_spaces: 7,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E9', lot_name: 'Lot E9', display_name: 'Lot E9 - Faculty/Staff', lot_number: 'E9',
    lot_type: LotType.EMPLOYEE, capacity: 167, current_occupancy: 138,
    location_description: 'North Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    center_lat: 33.7841, center_lng: -118.1153, geofence_radius: 32,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '18:00' },
    hours_saturday: 'CLOSED', hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 13,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.03,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E10', lot_name: 'Lot E10', display_name: 'Lot E10 - Faculty/Staff', lot_number: 'E10',
    lot_type: LotType.EMPLOYEE, capacity: 183, current_occupancy: 118,
    location_description: 'South Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    center_lat: 33.7825, center_lng: -118.1135, geofence_radius: 35,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '18:00' },
    hours_saturday: 'CLOSED', hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 22,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.04,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E11', lot_name: 'Lot E11', display_name: 'Lot E11 - Faculty/Staff', lot_number: 'E11',
    lot_type: LotType.EMPLOYEE, capacity: 98, current_occupancy: 80,
    location_description: 'Central Campus - Faculty',
    building_proximity: ['Faculty Offices', 'Admin Building'],
    center_lat: 33.7835, center_lng: -118.1140, geofence_radius: 40,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '18:00' },
    hours_saturday: 'CLOSED', hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 5,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.05,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  // ===== NAMED LOTS =====
  {
    lot_id: 'PVN', lot_name: 'Palo Verde North', display_name: 'Palo Verde North - North Campus', lot_number: 'PVN',
    lot_type: LotType.STUDENT, capacity: 1400, current_occupancy: 910,
    location_description: 'North Campus - Palo Verde Structure',
    building_proximity: ['Palo Verde North', 'Recreation Center'],
    center_lat: 33.7850, center_lng: -118.1170, geofence_radius: 50,
    permit_types: ['Gold', 'Green', 'Resident'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 3, accessible_spaces: 32,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, levels: 5, penetration_rate: 0.10,
    avg_turnover_minutes: 720, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'PVS', lot_name: 'Palo Verde South', display_name: 'Palo Verde South - South Campus', lot_number: 'PVS',
    lot_type: LotType.STUDENT, capacity: 1410, current_occupancy: 914,
    location_description: 'South Campus - Palo Verde Structure',
    building_proximity: ['Palo Verde South', 'Recreation Center'],
    center_lat: 33.7820, center_lng: -118.1175, geofence_radius: 48,
    permit_types: ['Gold', 'Green', 'Resident'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 2, motorcycle_spaces: 2, accessible_spaces: 10,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, levels: 5, penetration_rate: 0.09,
    avg_turnover_minutes: 720, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'PYR', lot_name: 'Pyramid Parking Structure', display_name: 'Pyramid Structure - Event Parking', lot_number: 'PYR',
    lot_type: LotType.STUDENT, capacity: 3000, current_occupancy: 2373,
    location_description: 'East Campus - Near Walter Pyramid',
    building_proximity: ['Walter Pyramid', 'Athletics', 'Sports Facilities'],
    center_lat: 33.7825, center_lng: -118.1095, geofence_radius: 65,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 10.00,
    hours_weekday: { open: '06:00', close: '23:00' },
    hours_saturday: { open: '06:00', close: '23:00' },
    hours_sunday: { open: '10:00', close: '22:00' },
    ev_charging_stations: 2, motorcycle_spaces: 6, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, levels: 5, penetration_rate: 0.16,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
];

// ────────────────────────────────────────────────────────────
// Test Users
// ────────────────────────────────────────────────────────────

const testUsers = [
  {
    email: 'charles.milton@csulb.edu', user_type: UserType.STUDENT,
    first_name: 'Charles', last_name: 'Milton', phone: '+15625551234',
    created_at: new Date('2025-09-01'),
    notification_preferences: { favorites_filling: true, favorites_clearing: true, surge_alerts: true, event_alerts: true },
    favorites: ['G1', 'G7', 'G4'],
  },
  {
    email: 'lawrence.degoma@csulb.edu', user_type: UserType.STUDENT,
    first_name: 'Lawrence', last_name: 'Degoma', phone: '+15625551235',
    created_at: new Date('2025-09-01'),
    notification_preferences: { favorites_filling: true, favorites_clearing: false, surge_alerts: true, event_alerts: true },
    favorites: ['G2', 'G9'],
  },
  {
    email: 'ly.nguyen@csulb.edu', user_type: UserType.EMPLOYEE,
    first_name: 'Ly', last_name: 'Nguyen', phone: '+15625551236',
    created_at: new Date('2025-09-05'),
    notification_preferences: { favorites_filling: true, favorites_clearing: true, surge_alerts: false, event_alerts: true },
    favorites: ['E1', 'E3', 'G4'],
  },
  {
    email: 'zachary.padilla@csulb.edu', user_type: UserType.STUDENT,
    first_name: 'Zachary', last_name: 'Padilla', phone: '+15625551237',
    created_at: new Date('2025-09-02'),
    notification_preferences: { favorites_filling: true, favorites_clearing: true, surge_alerts: true, event_alerts: false },
    favorites: ['G7', 'G8', 'E2'],
  },
  {
    email: 'charles.m2@csulb.edu', user_type: UserType.EMPLOYEE,
    first_name: 'Charles', last_name: 'Milton', phone: '+15625551238',
    created_at: new Date('2025-09-10'),
    notification_preferences: { favorites_filling: false, favorites_clearing: false, surge_alerts: true, event_alerts: true },
    favorites: ['E3', 'E5', 'G14'],
  },
];

// ────────────────────────────────────────────────────────────
// Campus Events (mapped to CampusEventType enum)
// ────────────────────────────────────────────────────────────

const campusEvents = [
  {
    event_name: "Men's Basketball vs UC Irvine",
    event_type: CampusEventType.ATHLETIC,
    location: 'Walter Pyramid',
    start_time: new Date('2025-12-15T19:00:00Z'),
    end_time: new Date('2025-12-15T21:30:00Z'),
    expected_attendance: 4500,
    impacts: [
      { lot_id: 'G2', impact_level: ImpactLevel.HIGH, expected_increase_percent: 40 },
      { lot_id: 'G1', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 25 },
      { lot_id: 'G7', impact_level: ImpactLevel.LOW, expected_increase_percent: 10 },
      { lot_id: 'G4', impact_level: ImpactLevel.LOW, expected_increase_percent: 15 },
    ],
  },
  {
    event_name: 'Spring Commencement 2025',
    event_type: CampusEventType.ACADEMIC,
    location: 'Walter Pyramid',
    start_time: new Date('2025-05-17T09:00:00Z'),
    end_time: new Date('2025-05-17T18:00:00Z'),
    expected_attendance: 12000,
    impacts: [
      { lot_id: 'G2', impact_level: ImpactLevel.HIGH, expected_increase_percent: 50 },
      { lot_id: 'G1', impact_level: ImpactLevel.HIGH, expected_increase_percent: 50 },
      { lot_id: 'G7', impact_level: ImpactLevel.HIGH, expected_increase_percent: 35 },
      { lot_id: 'G4', impact_level: ImpactLevel.HIGH, expected_increase_percent: 40 },
      { lot_id: 'G3', impact_level: ImpactLevel.HIGH, expected_increase_percent: 30 },
      { lot_id: 'G9', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 20 },
    ],
  },
  {
    event_name: 'Winter Concert Series',
    event_type: CampusEventType.PERFORMANCE,
    location: 'University Theatre',
    start_time: new Date('2025-12-20T19:30:00Z'),
    end_time: new Date('2025-12-20T21:30:00Z'),
    expected_attendance: 800,
    impacts: [
      { lot_id: 'G9', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 15 },
      { lot_id: 'G4', impact_level: ImpactLevel.LOW, expected_increase_percent: 10 },
    ],
  },
  {
    event_name: 'Spring Career Fair',
    event_type: CampusEventType.ACADEMIC,
    location: 'USU Ballroom',
    start_time: new Date('2025-01-15T10:00:00Z'),
    end_time: new Date('2025-01-15T16:00:00Z'),
    expected_attendance: 2500,
    impacts: [
      { lot_id: 'G4', impact_level: ImpactLevel.HIGH, expected_increase_percent: 30 },
      { lot_id: 'G5', impact_level: ImpactLevel.HIGH, expected_increase_percent: 28 },
      { lot_id: 'G9', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 15 },
      { lot_id: 'G10', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 10 },
    ],
  },
];

// ────────────────────────────────────────────────────────────
// Seed Functions
// ────────────────────────────────────────────────────────────

async function main() {
  console.log('[seed] SharkPark PostgreSQL Database Seeding\n');

  // 1. Clear existing data (cascade)
  console.log('[seed] Clearing existing data...');
  await prisma.deviceState.deleteMany();
  await prisma.occupancyEvent.deleteMany();
  await prisma.occupancySnapshot.deleteMany();
  await prisma.eventImpact.deleteMany();
  await prisma.userFavorite.deleteMany();
  await prisma.predictionShortTerm.deleteMany();
  await prisma.predictionLongTerm.deleteMany();
  await prisma.campusEvent.deleteMany();
  await prisma.weather.deleteMany();
  await prisma.academicCalendar.deleteMany();
  await prisma.campusClosure.deleteMany();
  await prisma.user.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.school.deleteMany();
  console.log('[seed] Cleared.\n');

  // 2. Create School
  console.log('[seed] Creating school...');
  const school = await prisma.school.create({
    data: {
      school_name: 'California State University, Long Beach',
      short_name: 'CSULB',
      timezone: 'America/Los_Angeles',
    },
  });
  console.log(`[seed] Created school: ${school.short_name} (${school.id})\n`);

  // 3. Seed Lots
  console.log('[seed] Seeding parking lots...');
  const lotMap = new Map<string, string>(); // lot_id -> prisma id

  for (const lot of parkingLots) {
    const created = await prisma.lot.create({
      data: {
        school_id: school.id,
        lot_id: lot.lot_id,
        lot_name: lot.lot_name,
        display_name: lot.display_name,
        lot_number: lot.lot_number,
        lot_type: lot.lot_type,
        capacity: lot.capacity,
        current_occupancy: lot.current_occupancy,
        location_description: lot.location_description,
        building_proximity: lot.building_proximity,
        center_lat: lot.center_lat,
        center_lng: lot.center_lng,
        geofence_polygon: generateGeofence(lot.center_lat, lot.center_lng, lot.geofence_radius),
        geofence_radius: lot.geofence_radius,
        permit_types: lot.permit_types,
        daily_permit_allowed: lot.daily_permit_allowed,
        daily_rate: lot.daily_rate,
        hours_weekday: lot.hours_weekday,
        hours_saturday: lot.hours_saturday,
        hours_sunday: lot.hours_sunday,
        ev_charging_stations: lot.ev_charging_stations,
        motorcycle_spaces: lot.motorcycle_spaces,
        accessible_spaces: lot.accessible_spaces,
        has_lighting: lot.has_lighting,
        has_cameras: lot.has_cameras,
        has_emergency_phone: lot.has_emergency_phone,
        is_covered: lot.is_covered,
        is_paved: lot.is_paved,
        levels: lot.levels,
        penetration_rate: lot.penetration_rate,
        avg_turnover_minutes: lot.avg_turnover_minutes,
        confidence: lot.confidence,
      },
    });
    lotMap.set(lot.lot_id, created.id);
  }
  console.log(`[seed] Seeded ${parkingLots.length} parking lots\n`);

  // 4. Seed Users & Favorites
  console.log('[seed] Seeding users...');
  let totalFavorites = 0;

  for (const user of testUsers) {
    const created = await prisma.user.create({
      data: {
        school_id: school.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        user_type: user.user_type,
        phone: user.phone,
        notification_preferences: user.notification_preferences,
        created_at: user.created_at,
        last_login: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      },
    });

    for (const favLotId of user.favorites) {
      const lotDbId = lotMap.get(favLotId);
      if (!lotDbId) continue;

      await prisma.userFavorite.create({
        data: {
          user_id: created.id,
          lot_id: lotDbId,
          added_at: new Date(user.created_at.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000),
        },
      });
      totalFavorites++;
    }
  }
  console.log(`[seed] Seeded ${testUsers.length} users with ${totalFavorites} favorites\n`);

  // 5. Seed Campus Events & Impacts
  console.log('[seed] Seeding campus events...');
  let totalImpacts = 0;

  for (const event of campusEvents) {
    const created = await prisma.campusEvent.create({
      data: {
        school_id: school.id,
        event_name: event.event_name,
        event_type: event.event_type,
        location: event.location,
        start_time: event.start_time,
        end_time: event.end_time,
        expected_attendance: event.expected_attendance,
      },
    });

    for (const impact of event.impacts) {
      const lotDbId = lotMap.get(impact.lot_id);
      if (!lotDbId) continue;

      await prisma.eventImpact.create({
        data: {
          event_id: created.id,
          lot_id: lotDbId,
          impact_level: impact.impact_level,
          expected_increase_percent: impact.expected_increase_percent,
        },
      });
      totalImpacts++;
    }
  }
  console.log(`[seed] Seeded ${campusEvents.length} events with ${totalImpacts} impacts\n`);

  // 6. Seed Weather
  console.log('[seed] Seeding weather data...');
  await prisma.weather.create({
    data: {
      school_id: school.id,
      timestamp: new Date(),
      temperature_f: 68,
      feels_like_f: 66,
      humidity_percent: 55,
      wind_speed_mph: 8,
      conditions: 'Partly Cloudy',
      precipitation_probability: 0.10,
      is_raining: false,
    },
  });
  console.log('[seed] Seeded weather data\n');

  // 7. Seed Historical Occupancy Snapshots (7 days, every 15 min during operating hours)
  console.log('[seed] Seeding historical occupancy snapshots...');
  const sampleLotIds = ['G1', 'G2', 'G4', 'G7', 'G9'];
  const now = new Date();
  const snapshotRows: {
    lot_id: string; timestamp: Date; occupancy: number; available: number;
    occupancy_rate: number; confidence: ConfidenceLevel; is_campus_open: boolean;
  }[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);

    for (let hour = 6; hour < 22; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timestamp = new Date(date);
        timestamp.setHours(hour, minute, 0, 0);

        for (const lotId of sampleLotIds) {
          const lot = parkingLots.find(l => l.lot_id === lotId);
          if (!lot) continue;
          const lotDbId = lotMap.get(lotId);
          if (!lotDbId) continue;

          const isPeak = (hour >= 8 && hour <= 10) || (hour >= 12 && hour <= 14);
          const baseRate = isPeak ? 0.85 : 0.60;
          const variance = Math.random() * 0.15;
          const occRate = Math.min(0.98, Math.max(0.30, baseRate + variance));
          const occupancy = Math.floor(lot.capacity * occRate);
          const available = lot.capacity - occupancy;

          snapshotRows.push({
            lot_id: lotDbId,
            timestamp,
            occupancy,
            available,
            occupancy_rate: Math.round(occRate * 1000) / 1000,
            confidence: lot.confidence,
            is_campus_open: true,
          });
        }
      }
    }
  }

  // Batch insert in chunks of 500
  for (let i = 0; i < snapshotRows.length; i += 500) {
    await prisma.occupancySnapshot.createMany({ data: snapshotRows.slice(i, i + 500) });
  }
  console.log(`[seed] Seeded ${snapshotRows.length} historical occupancy snapshots\n`);

  // 8. Seed Occupancy Events (last 24 hours)
  console.log('[seed] Seeding occupancy events...');
  const sampleDeviceHashes = [
    '5de210df8a7e4b2c9f1a3d5e7b9c1d3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d',
    '7f3a1b5c9d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4',
    '9e5c3a1d7f2b8e4a0c6d2f8a4b0e6c2d8f4a0b6c2e8d4f0a6b2c8e4d0f6a2b8',
    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    'b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
  ];
  const eventRows: {
    lot_id: string; event_type: EventType; device_hash: string; timestamp: Date;
  }[] = [];

  for (let hourOffset = 0; hourOffset < 24; hourOffset++) {
    const eventTime = new Date(now.getTime() - hourOffset * 60 * 60 * 1000);
    const hour = eventTime.getHours();
    if (hour < 6 || hour >= 22) continue;

    for (const lotId of sampleLotIds) {
      const lotDbId = lotMap.get(lotId);
      if (!lotDbId) continue;

      const numEvents = Math.floor(Math.random() * 4) + 2;
      for (let i = 0; i < numEvents; i++) {
        const deviceHash = sampleDeviceHashes[Math.floor(Math.random() * sampleDeviceHashes.length)];
        const eventType = Math.random() > 0.5 ? EventType.ENTER : EventType.EXIT;
        const minuteOffset = Math.floor(Math.random() * 60);
        const eventTimestamp = new Date(eventTime.getTime() - minuteOffset * 60 * 1000);

        eventRows.push({
          lot_id: lotDbId,
          event_type: eventType,
          device_hash: deviceHash,
          timestamp: eventTimestamp,
        });
      }
    }
  }

  // Batch insert
  await prisma.occupancyEvent.createMany({ data: eventRows });
  console.log(`[seed] Seeded ${eventRows.length} occupancy events\n`);

  // 9. Seed Device State (deduplication records)
  console.log('[seed] Seeding device state records...');
  const deviceStateRows: {
    device_hash: string; lot_id: string; last_event_type: EventType; updated_at: Date;
  }[] = [];

  for (const deviceHash of sampleDeviceHashes) {
    for (const lotId of sampleLotIds.slice(0, 2)) {
      const lotDbId = lotMap.get(lotId);
      if (!lotDbId) continue;

      deviceStateRows.push({
        device_hash: deviceHash,
        lot_id: lotDbId,
        last_event_type: Math.random() > 0.5 ? EventType.ENTER : EventType.EXIT,
        updated_at: new Date(now.getTime() - Math.floor(Math.random() * 60) * 60 * 1000),
      });
    }
  }

  await prisma.deviceState.createMany({ data: deviceStateRows });
  console.log(`[seed] Seeded ${deviceStateRows.length} device state records\n`);

  // 10. Verify
  const counts = {
    schools: await prisma.school.count(),
    lots: await prisma.lot.count(),
    users: await prisma.user.count(),
    favorites: await prisma.userFavorite.count(),
    events: await prisma.campusEvent.count(),
    impacts: await prisma.eventImpact.count(),
    weather: await prisma.weather.count(),
    snapshots: await prisma.occupancySnapshot.count(),
    occEvents: await prisma.occupancyEvent.count(),
    deviceStates: await prisma.deviceState.count(),
  };

  console.log('[seed] Database Summary:');
  Object.entries(counts).forEach(([key, count]) => {
    console.log(`[seed]   ${key}: ${count}`);
  });

  console.log('\n[seed] Seeding complete!');
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
