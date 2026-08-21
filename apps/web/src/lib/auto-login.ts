import { authClient } from "./auth";
import { rpc } from "./rpc";

/**
 * This deployment runs on a single machine for a single person: there is no
 * multi-tenant reason to show a sign-in/sign-up screen at all. On first load
 * we transparently provision (or reuse) one local account, connect the local
 * model, and create a starter bot so the app opens straight into a working
 * chat. The credentials never leave this machine — the API only binds to
 * 127.0.0.1 — so a fixed local account is not a meaningful secret here.
 */
const LOCAL_EMAIL =
  (import.meta.env.VITE_RAKAZO_LOCAL_EMAIL as string | undefined) || "you@rakazo.local";
const LOCAL_PASSWORD =
  (import.meta.env.VITE_RAKAZO_LOCAL_PASSWORD as string | undefined) ||
  "rakazo-local-single-user-device-account";
const LOCAL_MODEL_PROVIDER =
  (import.meta.env.VITE_RAKAZO_LOCAL_MODEL_PROVIDER as string | undefined) || "";
const LOCAL_MODEL_ID = (import.meta.env.VITE_RAKAZO_LOCAL_MODEL_ID as string | undefined) || "";
const LOCAL_MODEL_KEY = (import.meta.env.VITE_RAKAZO_LOCAL_MODEL_KEY as string | undefined) || "";

let inFlight: Promise<boolean> | null = null;

/** Ensure a signed-in session exists, creating the local account on first run. */
export function ensureLocalSession(): Promise<boolean> {
  inFlight ??= runEnsureLocalSession().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runEnsureLocalSession(): Promise<boolean> {
  const signedIn = await trySignIn();
  const isNewAccount = !signedIn && (await trySignUp());
  if (!signedIn && !isNewAccount) return false;
  await provisionStarterWorkspaceIfEmpty();
  return true;
}

async function trySignIn(): Promise<boolean> {
  const result = await authClient.signIn.email({ email: LOCAL_EMAIL, password: LOCAL_PASSWORD });
  return !result.error;
}

async function trySignUp(): Promise<boolean> {
  const result = await authClient.signUp.email({
    email: LOCAL_EMAIL,
    password: LOCAL_PASSWORD,
    name: "You",
  });
  return !result.error;
}

/** Skip the onboarding wizard whenever this account has no bot yet. */
async function provisionStarterWorkspaceIfEmpty(): Promise<void> {
  if (!LOCAL_MODEL_PROVIDER || !LOCAL_MODEL_ID || !LOCAL_MODEL_KEY) return;
  try {
    const [bots, archived] = await Promise.all([rpc.bots.list(), rpc.bots.listArchived()]);
    if (bots.length > 0 || archived.length > 0) return;
    await rpc.models.connect({
      provider: LOCAL_MODEL_PROVIDER,
      apiKey: LOCAL_MODEL_KEY,
      modelId: LOCAL_MODEL_ID,
      label: "Local model",
    });
    await rpc.bots.create({ name: "Assistant", title: "Assistant", computerMode: "team" });
  } catch {
    // Best-effort: if this fails the user still lands on /onboarding, which
    // covers the same setup manually instead of the sign-up screen.
  }
}
