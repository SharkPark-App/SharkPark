import { Event } from '../types/ui';

/** Helper: returns a Date from today at the given hour */
function relativeDate(daysFromNow: number, hour = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export const upcomingEvents: Event[] = [
  {
    id: '1',
    name: 'Basketball Game vs. UCI',
    date: relativeDate(0, 19),
    location: 'Walter Pyramid',
    affectedLots: ['all'],
    description: 'Home basketball game. Expect heavy traffic near Pyramid and surrounding general lots 1-2 hours before game time.',
    impact: 'high'
  },
  {
    id: '2',
    name: 'Spring Career Fair',
    date: relativeDate(2, 10),
    location: 'USU Ballroom',
    affectedLots: ['G5', 'G7', 'G8', 'G12', 'E1', 'E2'],
    description: 'Large career fair event in USU. Central campus lots will be at maximum capacity. Employee lots E1-E2 may have overflow parking.',
    impact: 'high'
  },
  {
    id: '3',
    name: 'Final Exams Week',
    date: relativeDate(1),
    location: 'Campus-wide',
    affectedLots: ['all'],
    description: 'Finals week typically sees increased parking demand in the morning hours (7-10 AM) across all campus lots.',
    impact: 'medium'
  },
  {
    id: '4',
    name: 'Graduation Ceremony',
    date: relativeDate(5, 9),
    location: 'Walter Pyramid',
    affectedLots: ['PYR', 'G1', 'G2', 'G3', 'G14'],
    description: 'Commencement ceremony at the Pyramid. Lots near the stadium will be reserved for graduates and families. Consider using remote lots.',
    impact: 'high'
  },
  {
    id: '5',
    name: 'Faculty Development Day',
    date: relativeDate(3, 8),
    location: 'University Theater',
    affectedLots: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
    description: 'Professional development workshops for faculty and staff. Employee lots will be busier than usual throughout the day.',
    impact: 'medium'
  },
  {
    id: '6',
    name: 'Beach Volleyball Tournament',
    date: relativeDate(4, 11),
    location: 'Sand Courts',
    affectedLots: ['G13', 'G14', 'PYR'],
    description: 'Regional collegiate beach volleyball tournament. Western lots near athletic facilities will be heavily used. Tournament runs until 6 PM.',
    impact: 'medium'
  },
  {
    id: '7',
    name: 'Student Organization Fair',
    date: relativeDate(6, 12),
    location: 'Campus Quad',
    affectedLots: ['G5', 'G7', 'G10', 'G11'],
    description: 'Outdoor student activities fair on campus quad. Midday parking in central lots will be at premium capacity between 11 AM - 3 PM.',
    impact: 'medium'
  }
];