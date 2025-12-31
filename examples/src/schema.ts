/**
 * Trip Budget - duet-kit example with nested fields
 */

import { createDuet, field, z } from 'duet-kit';

// Nested schema for accommodation
const accommodationSchema = z.object({
  type: z.enum(['hotel', 'airbnb', 'hostel', 'resort']),
  budgetPerNight: z.number().min(0).max(10000),
  stars: z.number().min(1).max(5).optional(),
});

// One call creates everything: store hook + LLM bridge + schema
export const useTripStore = createDuet('TripBudget', {
  destination: field(z.string().min(1), 'Destination', 'Tokyo, Japan'),
  days: field(z.number().min(1).max(365), 'Duration (days)', 7),
  travelers: field(z.number().min(1).max(20), 'Travelers', 2),
  totalBudget: field(z.number().min(0).max(1000000), 'Total Budget ($)', 5000),
  
  // Nested field - accommodation details
  accommodation: field(accommodationSchema, 'Accommodation', {
    type: 'hotel',
    budgetPerNight: 150,
    stars: 3,
  }),
  
  tripType: field(
    z.enum(['leisure', 'adventure', 'business', 'romantic']),
    'Trip Type',
    'leisure'
  ),
}, { persist: 'duet-kit-example' });

// JSON Patch examples:
// - Flat field:   [{ "op": "replace", "path": "/destination", "value": "Paris" }]
// - Nested field: [{ "op": "replace", "path": "/accommodation/type", "value": "airbnb" }]
// - Nested field: [{ "op": "replace", "path": "/accommodation/budgetPerNight", "value": 200 }]
