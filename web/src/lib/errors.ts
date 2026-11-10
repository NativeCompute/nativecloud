export class ApiError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? messageOf(code));
  }
  get head(): string {
    return this.code.replace(/^nc:/, "").split(":")[0] ?? "";
  }
  get what(): string {
    return this.code.replace(/^nc:/, "").split(":")[1] ?? "";
  }
}

const invalid: Record<string, string> = {
  name: "Names need 1 to 80 characters.",
  email: "That doesn't look like an email address.",
  role: "Pick admin, member or guest.",
  owner: "The owner can't do that. Hand the organization over first.",
  member: "That person is already in this organization, or isn't in it.",
  spaces: "Pick at least one space in this organization.",
  slug: "Web addresses use lower case letters, digits and dashes, and must be free.",
  personal: "That can't be done with My cloud.",
  not_deleted: "Move it to Recently deleted first.",
  code: "That code is wrong or has expired.",
  verifier: "That sign-in code is wrong or has expired. Start again from the app.",
  challenge: "This sign-in link is broken. Start again from the app.",
  plan: "That plan doesn't exist.",
  settings: "Those settings aren't valid.",
  invite: "That invite is no longer open.",
};

const limit: Record<string, string> = {
  projects: "This plan's number of cloud scripts is reached.",
  storage: "This plan's storage is full.",
  orgs: "You own as many organizations as your plan allows.",
  spaces: "This organization has as many spaces as its plan allows.",
  members: "This organization has as many people as its plan allows.",
  snapshots: "This script has as many named snapshots as the plan allows.",
  devices: "This account is signed in on as many computers as it may be. Sign one out on the Computers page.",
};

const auth: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  weak_password: "Use at least 10 characters, with upper and lower case letters and a digit.",
  otp_expired: "That code is wrong or has expired. Send a new one.",
  user_already_exists: "There's already an account with that email. Sign in instead.",
  email_exists: "There's already an account with that email. Sign in instead.",
  same_password: "Choose a password you haven't used here before.",
  email_address_invalid: "Check the email address.",
  signup_disabled: "New accounts are closed for now.",
  user_banned: "This account is suspended. Contact hello@nativecompute.com.",
  over_email_send_rate_limit: "We've sent a lot of emails. Wait a minute and try again.",
  over_request_rate_limit: "That was a lot at once. Wait a minute and try again.",
  reauthentication_needed: "Enter the code we just emailed you to confirm it's you.",
  reauthentication_not_valid: "That confirmation code is wrong or has expired.",
  email_not_confirmed: "Confirm your email first. Enter the code we sent you.",
};

export function messageOf(code: string): string {
  const c = code.replace(/^nc:/, "");
  const [head, what = ""] = c.split(":");
  switch (head) {
    case "auth":
      return "Your session ended. Sign in again.";
    case "forbidden":
      return "Your role here doesn't allow that.";
    case "not_found":
      return "It may have been deleted, or you no longer have access.";
    case "unconfirmed":
      return "Confirm your email first.";
    case "rate":
      return "That was a lot at once. Wait a minute and try again.";
    case "locked":
      return "Someone is editing it right now. Try again when they're done.";
    case "reauth":
      return "For your safety, enter your password again first.";
    case "suspended":
      return "This account or organization is suspended. Contact hello@nativecompute.com.";
    case "invalid":
      return invalid[what] ?? `NativeCloud didn't accept that (${what}).`;
    case "limit":
      return limit[what] ?? `The plan's limit for ${what} is reached.`;
    case "offline":
      return "NativeCloud can't be reached. Check your connection and try again.";
    default:
      return auth[c] ?? (c ? `Something went wrong (${c}). Try again in a moment.` : "Something went wrong. Try again in a moment.");
  }
}

export function toError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const o = (e ?? {}) as Record<string, unknown>;
  const text = String(o.message ?? o.error ?? o.msg ?? "");
  if (text.startsWith("nc:")) return new ApiError(text);
  const code = String(o.code ?? o.error_code ?? "");
  if (code && auth[code]) return new ApiError(code);
  const lower = text.toLowerCase();
  if (lower.includes("invalid login")) return new ApiError("invalid_credentials");
  if (lower.includes("email not confirmed")) return new ApiError("email_not_confirmed");
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed")) return new ApiError("nc:offline");
  if (lower.includes("jwt") && lower.includes("expired")) return new ApiError("nc:auth");
  if (code === "weak_password" || (lower.includes("password") && lower.includes("weak"))) return new ApiError("weak_password");
  if (lower.includes("token has expired") || lower.includes("otp")) return new ApiError("otp_expired");
  return new ApiError(code || "server", text ? `Something went wrong: ${text}` : undefined);
}
