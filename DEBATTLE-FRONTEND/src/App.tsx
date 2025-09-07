import React, { useState } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { MainDashboard } from "./components/MainDashboard";
import { DebateInterface } from "./components/DebateInterface";
import { UserProfile } from "./components/UserProfile";
import { MatchTypeScreen } from "./components/MatchTypeScreen";
import { PrivateLobbyScreen } from "./components/PrivateLobbyScreen";
import { MatchmakingScreen } from "./components/MatchmakingScreen";
import { TopicSelectionScreen } from "./components/TopicSelectionScreen";
import { ThinkingPhaseScreen } from "./components/ThinkingPhaseScreen";
import { DebateOverScreen } from "./components/DebateOverScreen";
import { FeedbackProgressionScreen } from "./components/FeedbackProgressionScreen";
import { MatchFeedbackScreen } from "./components/MatchFeedbackScreen";
import { Screen, User, MatchType, MatchFlow } from "./types";
DEBATTLE-FRONTEND\components\ui\accordion.tsx
export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>("login");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentMatchType, setCurrentMatchType] = useState<MatchType>("single");
  const [currentMatchFlow, setCurrentMatchFlow] = useState<MatchFlow>("public");
  const [currentMatchId, setCurrentMatchId] = useState<string>("1");

  // Mock user data
  const [user, setUser] = useState<User>({
    id: "1",
    name: "Alex Debater",
    email: "alex@example.com",
    eloRating: 1425,
    level: 12,
    titles: ["New Debater", "Level Napkin"],
    badges: ["New Debater", "Level Napkin", "Rising Star"],
    avatar: "default",
    podium: "classic",
    wins: 34,
    losses: 18,
    totalMatches: 52,
    winRate: 65.4,
  });

  const handleLogin = (userData: any) => {
    setUser(userData);
    setIsLoggedIn(true);
    setCurrentScreen("dashboard");
  };

  const handleScreenChange = (
    screen: Screen,
    matchType?: MatchType,
    matchFlow?: MatchFlow,
    matchId?: string
  ) => {
    if (matchType) {
      setCurrentMatchType(matchType);
    }
    if (matchFlow) {
      setCurrentMatchFlow(matchFlow);
    }
    if (matchId) {
      setCurrentMatchId(matchId);
    }
    setCurrentScreen(screen);
  };

  const handleUserUpdate = (userData: Partial<User>) => {
    setUser((prev) => ({ ...prev, ...userData }));
  };

  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  switch (currentScreen) {
    case "dashboard":
      return <MainDashboard user={user} onScreenChange={handleScreenChange} />;
    case "profile":
      return <UserProfile user={user} onScreenChange={handleScreenChange} />;
    case "topic-selection":
      return (
        <TopicSelectionScreen
          user={user}
          onScreenChange={handleScreenChange}
          currentFlow={currentMatchFlow}
        />
      );
    case "match-type":
      return (
        <MatchTypeScreen
          user={user}
          onScreenChange={handleScreenChange}
          currentFlow={currentMatchFlow}
        />
      );
    case "private-lobby":
      return (
        <PrivateLobbyScreen
          user={user}
          matchType={currentMatchType}
          onScreenChange={handleScreenChange}
        />
      );
    case "matchmaking":
      return (
        <MatchmakingScreen
          user={user}
          matchType={currentMatchType}
          onScreenChange={handleScreenChange}
        />
      );
    case "thinking-phase":
      return (
        <ThinkingPhaseScreen
          user={user}
          matchType={currentMatchType}
          onScreenChange={handleScreenChange}
        />
      );
    case "debate":
      return (
        <DebateInterface
          user={user}
          matchType={currentMatchType}
          onScreenChange={handleScreenChange}
        />
      );
    case "debate-over":
      return (
        <DebateOverScreen user={user} onScreenChange={handleScreenChange} />
      );
    case "feedback-progression":
      return (
        <FeedbackProgressionScreen
          user={user}
          onScreenChange={handleScreenChange}
          onUserUpdate={handleUserUpdate}
        />
      );
    case "match-feedback":
      return (
        <MatchFeedbackScreen
          user={user}
          matchId={currentMatchId}
          onScreenChange={handleScreenChange}
        />
      );
    default:
      return <MainDashboard user={user} onScreenChange={handleScreenChange} />;
  }
}
