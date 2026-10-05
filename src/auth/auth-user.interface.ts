export type UserRole = 'superadmin' | 'dispatcher' | 'news_editor';

export interface AuthUser {
  id: string;
  login: string;
  role: UserRole;
}
