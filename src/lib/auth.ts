import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Role, SignInOutcome } from "@prisma/client";
import { prisma } from "./db";
import { recordSignIn } from "./sign-ins";
import { hashPassword } from "./password";
import { ALLOWED_GOOGLE_DOMAIN, isAllowedGoogleProfile } from "./session-rules";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      organisationId: string;
      mustChangePassword: boolean;
      /** When this session was issued, in ms. Compared against force sign-out. */
      issuedAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    organisationId: string;
    mustChangePassword: boolean;
    issuedAt?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    organisationId: string;
    mustChangePassword: boolean;
    issuedAt?: number;
  }
}

/** Google sign-in is offered only when a client is configured. */
export const googleSignInEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Small closed team, no email-delivery dependency: a password, or Google for
  // anyone in the company Workspace. Either way only an account an admin has
  // created can sign in — there is no self-registration. JWT session in an
  // httpOnly cookie; the 12-hour idle limit and force sign-out are enforced in
  // lib/guards.ts against the database, because a JWT can't be recalled.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    ...(googleSignInEnabled
      ? [
          Google({
            // `hd` narrows Google's account chooser to the Workspace; the
            // signIn callback below is what actually enforces it.
            authorization: { params: { hd: ALLOWED_GOOGLE_DOMAIN, prompt: "select_account" } },
          }),
        ]
      : []),
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

        // An email with no account is not logged: there is nobody to attribute
        // it to, and keeping whatever a stranger typed into a login box is a
        // liability rather than an audit trail.
        if (user) {
          await recordSignIn(prisma, {
            userId: user.id,
            organisationId: user.organisationId,
            outcome: !ok
              ? SignInOutcome.WRONG_PASSWORD
              : !user.isActive
                ? SignInOutcome.DEACTIVATED
                : SignInOutcome.SUCCESS,
          });
        }

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
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      if (!isAllowedGoogleProfile(profile)) return "/login?error=google-domain";

      const email = profile!.email!.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return "/login?error=google-no-account";

      await recordSignIn(prisma, {
        userId: user.id,
        organisationId: user.organisationId,
        outcome: user.isActive ? SignInOutcome.SUCCESS : SignInOutcome.DEACTIVATED,
      });
      if (!user.isActive) return "/login?error=google-no-account";

      // Somebody who signs in with Google never needs the temporary password an
      // admin gave them. Retire it rather than leave it working unseen, and
      // skip the forced change: they can't change a password they don't use.
      if (user.mustChangePassword) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            mustChangePassword: false,
            passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
          },
        });
      }
      return true;
    },
    async jwt({ token, user, account, trigger }) {
      if (user && account?.provider === "google") {
        // `user` here is Google's profile; the account is ours, found by email.
        const record = await prisma.user.findUniqueOrThrow({ where: { email: user.email!.toLowerCase() } });
        token.id = record.id;
        token.name = record.name;
        token.role = record.role;
        token.organisationId = record.organisationId;
        token.mustChangePassword = record.mustChangePassword;
        token.issuedAt = Date.now();
      } else if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.organisationId = user.organisationId;
        token.mustChangePassword = user.mustChangePassword;
        token.issuedAt = Date.now();
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
      session.user.issuedAt = token.issuedAt;
      return session;
    },
  },
});

// Re-exported so existing callers keep one import site for auth concerns.
export { PASSWORD_SALT_ROUNDS, MIN_PASSWORD_LENGTH, hashPassword } from "./password";

export function isAdmin(role: Role | undefined): boolean {
  return role === Role.ADMIN;
}
