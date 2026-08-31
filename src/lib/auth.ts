import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "./db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      organisationId: string;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    organisationId: string;
    mustChangePassword: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    organisationId: string;
    mustChangePassword: boolean;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Small closed team, no email-delivery dependency: credentials only, with a
  // JWT session in an httpOnly cookie. No self-registration — admins create
  // accounts.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Hash even when the user is missing, so a wrong email and a wrong
        // password take the same time to answer.
        const hash = user?.passwordHash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi";
        const ok = await bcrypt.compare(password, hash);
        if (!user || !ok || !user.isActive) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organisationId: user.organisationId,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.organisationId = user.organisationId;
        token.mustChangePassword = user.mustChangePassword;
      }
      // Re-read on an explicit session update so a password change or a role
      // change takes effect without forcing a sign-out.
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({ where: { id: token.id } });
        if (fresh) {
          token.role = fresh.role;
          token.organisationId = fresh.organisationId;
          token.mustChangePassword = fresh.mustChangePassword;
          token.name = fresh.name;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.organisationId = token.organisationId;
      session.user.mustChangePassword = token.mustChangePassword;
      return session;
    },
  },
});

// Re-exported so existing callers keep one import site for auth concerns.
export { PASSWORD_SALT_ROUNDS, MIN_PASSWORD_LENGTH, hashPassword } from "./password";

export function isAdmin(role: Role | undefined): boolean {
  return role === Role.ADMIN;
}
