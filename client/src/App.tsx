import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RecruiterRoute } from "./components/RecruiterRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AuthCallback from "./pages/AuthCallback";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Feed from "./pages/Feed";
import Messages from "./pages/Messages";
import EditProfile from "./pages/EditProfile";
import TalentSearch from "./pages/TalentSearch";
import CandidateDetail from "./pages/CandidateDetail";
import Communities from "./pages/Communities";
import CommunityDetail from "./pages/CommunityDetail";
import UserProfile from "./pages/UserProfile";
import Friends from "./pages/Friends";
import Pages from "./pages/Pages";
import PageDetail from "./pages/PageDetail";
import Onboarding from "./pages/Onboarding";
import Shortlist from "./pages/Shortlist";

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route path="/feed" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
          <Route path="/communities" element={<ProtectedRoute><Communities /></ProtectedRoute>} />
          <Route path="/communities/:slug" element={<ProtectedRoute><CommunityDetail /></ProtectedRoute>} />
          <Route path="/u/:username" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
          <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
          <Route path="/pages" element={<ProtectedRoute><Pages /></ProtectedRoute>} />
          <Route path="/pages/:slug" element={<ProtectedRoute><PageDetail /></ProtectedRoute>} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/shortlist" element={<RecruiterRoute><Shortlist /></RecruiterRoute>} />

          {/* المرحلة 5 — recruiters بس */}
          <Route path="/talent" element={<RecruiterRoute><TalentSearch /></RecruiterRoute>} />
          <Route path="/talent/:username" element={<RecruiterRoute><CandidateDetail /></RecruiterRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  );
}
