import type { NextAuthConfig } from "next-auth";

// Lightweight config for middleware (no bcrypt/prisma imports)
export const authConfig = {
  session: { strategy: "jwt" as const },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }: { token: Record<string, unknown>; user?: { id?: string } }) {
      if (user) token.userId = user.id;
      return token;
    },
    session({ session, token }: { session: Record<string, unknown> & { user: Record<string, unknown> }; token: Record<string, unknown> }) {
      if (token.userId) session.user.id = token.userId;
      return session;
    },
    authorized({ auth }: { auth: { user?: unknown } | null }) {
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
