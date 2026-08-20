import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { trustedAuthRedirect } from "@/lib/auth-redirect";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    redirect: trustedAuthRedirect,
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
