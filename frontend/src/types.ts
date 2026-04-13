export type UUID = string;

export interface LocationPoint {
  lat: number;
  lon: number;
  name?: string;
}

export interface RoutedRoute {
  geometry: LocationPoint[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface GeocodeSearchResult {
  displayName: string;
  lat: number;
  lon: number;
}

export interface Convoy {
  id: UUID;
  title: string;
  leaderId: UUID;
  startTime: string | null;
  status: string;
  privacy?: 'invite' | 'open';
  route: LocationPoint[];
  createdAt: string;
}

export interface ConvoyWithInvite extends Convoy {
  inviteCode?: string;
}

export interface ConvoyInvite {
  id: UUID;
  code: string;
  expiresAt: string;
}

export interface ConvoyMember {
  convoyId: UUID;
  userId: UUID;
  role: string;
  lastPing?: unknown;
  joinedAt: string;
  user: User;
}

export interface ConvoyDetail extends Convoy {
  inviteCode?: string;
  invites?: ConvoyInvite[];
  members?: ConvoyMember[];
}

export interface NearbyOpenConvoy {
  id: UUID;
  title: string;
  leaderId: UUID;
  status: string;
  privacy: 'open';
  startTime: string | null;
  createdAt: string;
  memberCount: number;
  routePointCount: number;
  routeLengthKm: number;
  distanceKm: number;
  startPoint: LocationPoint | null;
  endPoint: LocationPoint | null;
  closestPoint: LocationPoint;
  proximitySource: 'leader-last-ping' | 'route-point';
}

export interface ConvoyPublicPreview {
  id: UUID;
  title: string;
  leaderId: UUID;
  status: string;
  privacy: 'invite' | 'open';
  startTime: string | null;
  createdAt: string;
  leader: User;
  memberCount: number;
  routePointCount: number;
  routeLengthKm: number;
  route: LocationPoint[];
  startPoint: LocationPoint | null;
  endPoint: LocationPoint | null;
  inviteRequired: boolean;
  alreadyJoined: boolean;
}

export interface PollOption {
  id: UUID;
  text: string;
  votes: number;
}

export interface Poll {
  id: UUID;
  convoyId: UUID;
  createdById: UUID;
  question: string;
  status: 'open' | 'closed' | string;
  createdAt: string;
  options: PollOption[];
  myVoteOptionId: UUID | null;
}

export interface ConvoyEvent {
  id: UUID;
  convoyId: UUID;
  createdById: UUID | null;
  type: string;
  title: string;
  payload?: unknown;
  createdAt: string;
}

export interface User {
  id: UUID;
  name?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string | null;
  createdAt?: string;
}

export interface ChatMessage {
  id: UUID;
  convoyId: UUID;
  userId: UUID;
  text: string;
  createdAt: string;
}

export interface AuthSession {
  sessionId: UUID;
}

export interface AuthToken {
  token: string;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  battery: number | null;
  ts: string;
}

export interface Track {
  userId: UUID;
  points: TrackPoint[];
}
