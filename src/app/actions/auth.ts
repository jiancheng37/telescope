"use server";

import { signIn, signOut } from "@/auth";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/app" });
}

export async function signOutCurrentUser() {
  await signOut({ redirectTo: "/" });
}
