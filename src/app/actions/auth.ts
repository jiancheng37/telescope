"use server";

import { signIn, signOut } from "@/auth";
import { dashboardUrl } from "@/lib/app-url";
import { siteUrl } from "@/lib/site-url";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: dashboardUrl() });
}

export async function signOutCurrentUser() {
  await signOut({ redirectTo: siteUrl });
}
