export interface User {
  id: string;
  name: string;
  email?: string;
  eloRating: number;
  level: number;
  titles: string[];
  badges: string[];
  avatar?: string;
  podium?: string;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: number;
}

export interface Opponent {
  name: string;
  level: number;
  eloRating: number;
  avatar?: string;
}

export interface DebateResult {
  winner: 'user' | 'opponent' | 'tie';
  userScore: number;
  opponentScore: number;
  topic: string;
  duration: string;
  opponent: Opponent;
}

export interface Feedback {
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export interface PeerAward {
  award: string;
  winner: string;
}

export type Screen = 'login' | 'dashboard' | 'profile' | 'topic-selection' | 'match-type' | 'private-lobby' | 'matchmaking' | 'thinking-phase' | 'debate' | 'debate-over' | 'feedback-progression' | 'match-feedback';

export type Topic = 'Criminal Law' | 'Business Law' | 'Constitutional Law';

export interface LobbyCode {
  code: string;
  created: Date;
  players: LobbyPlayer[];
  maxPlayers: number;
  topic?: Topic;
}

export type DebatePhase = 'thinking' | 'opening' | 'argument' | 'rebuttal' | 'closing' | 'judgment' | 'discussion';

export type ConnectionQuality = 'good' | 'unstable' | 'poor';

export type MatchType = 'single' | 'multiplayer';

export type MatchFlow = 'public' | 'private';

export interface LobbyPlayer {
  id: string;
  name: string;
  level: number;
  avatar?: string;
  isUser?: boolean;
}

export interface AIJudgment {
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  overallScore: number;
  verdict: 'win' | 'loss' | 'tie';
  reasoning: string;
}

export interface PeerFeedback {
  mostPersuasive: string;
  bestRebuttal: string;
  mostCreative: string;
  bestEvidence: string;
  mostRespectful: string;
}

export interface MatchHistory {
  id: string;
  topic: Topic;
  result: 'win' | 'loss' | 'tie';
  opponent: string;
  score: number;
  opponentScore: number;
  date: string;
  duration: string;
  aiJudgment: AIJudgment;
  peerFeedback?: PeerFeedback;
  eloChange: number;
}

export interface FeedbackData {
  matchId: string;
  aiJudgment: AIJudgment;
  peerFeedback: PeerFeedback;
  userAgreeWithAI: boolean | null;
  starRating: number;
  playfulCompliment: string;
  eloGained: number;
  newEloRating: number;
  levelProgress: number;
  newLevel?: number;
}