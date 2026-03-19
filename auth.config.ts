import type { NextAuthConfig, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

export const authConfig = {
  session: { strategy: "jwt" as const },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }: { token: JWT; user?: { id?: string } }) {
      if (user) token.userId = user.id;
      return token;
    },
    session({ session, token }: { session: Session; token: JWT }) {
      if (token.userId) session.user.id = token.userId as string;
      return session;
    },
    authorized({ auth }: { auth: Session | null }) {
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
