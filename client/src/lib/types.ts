// الأنواع المشتركة بين صفحات الـ client — مطابقة لريسبونس الـ API

export const SPECIALTIES = [
  "Frontend", "Backend", "Full Stack", "DevOps", "Mobile",
  "AI/ML", "Data Engineer", "UI/UX", "QA/Testing", "Security",
] as const;
export type Specialty = (typeof SPECIALTIES)[number];
export type Availability = "OPEN_TO_WORK" | "NOT_LOOKING" | "FREELANCE_ONLY";

export interface Skill {
  name: string;
  years: number;
}

export interface Profile {
  id: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  yearsExperience: number | null;
  specialty: Specialty | null;
  availability: Availability;
  websiteUrl: string | null;
  githubUrl: string | null;
  skills: Skill[];
}

export interface Candidate {
  id: string;
  username: string;
  displayName: string | null;
  headline: string | null;
  avatarUrl: string | null;
  location: string | null;
  yearsExperience: number | null;
  specialty: Specialty | null;
  availability: Availability;
  skills: Skill[];
}

export type PostType = "TEXT" | "SNIPPET" | "QUESTION";

export interface PostAuthor {
  username: string;
  profile: { displayName: string; avatarUrl: string | null; headline: string | null };
}

export interface Post {
  id: string;
  type: PostType;
  title: string | null;
  body: string;
  codeLanguage: string | null;
  codeContent: string | null;
  imageUrl?: string | null;
  createdAt: string;
  author: PostAuthor;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string; profile: { displayName: string; avatarUrl: string | null } };
}

// "2h ago" style — من غير مكتبة خارجية
export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

// ---------- Phase 6: Communities & Notifications ----------

export const COMMUNITY_CATEGORIES = ["Frontend", "Backend", "AI & ML", "DevOps", "Mobile", "Data"] as const;
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];

export interface CommunityListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  memberCount: number;
  joinedByMe: boolean;
}

export interface CommunityMemberPreview {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: "MEMBER" | "ADMIN";
}

export interface CommunityDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  memberCount: number;
  joinedByMe: boolean;
  memberPreview: CommunityMemberPreview[];
}

export type NotificationType = "POST_LIKE" | "POST_COMMENT" | "COMMUNITY_JOIN";

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

// ---------- Group 2: Friends, Follows, Groups ----------

export interface UserCard {
  id: string;
  username: string;
  profile: { displayName: string; avatarUrl: string | null; headline: string | null };
}

export type FriendState = "none" | "friends" | "request_sent" | "request_received";

export interface RelationStatus {
  friendState: FriendState;
  following: boolean;
}

// ---------- Group 3: Pages ----------

export const PAGE_CATEGORIES = ["Company", "Project", "Open Source", "Community", "Product"] as const;
export type PageCategory = (typeof PAGE_CATEGORIES)[number];

export interface PageListItem {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  category: string;
  avatarUrl: string | null;
  followerCount: number;
  followedByMe: boolean;
}

export interface PageDetail extends PageListItem {
  createdAt: string;
  isAdmin: boolean;
}

// ---------- Group 4: GitHub projects, Reputation, Shortlist ----------

export interface GitHubProject {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  updatedAt: string;
}

export interface ShortlistCandidate {
  id: string;
  note: string | null;
  createdAt: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  specialty: string | null;
  yearsExperience: number | null;
  availability: string | null;
}
