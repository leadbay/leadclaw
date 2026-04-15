import { LeadbayClient } from "./client.js";
import { registerListLenses } from "./tools/list-lenses.js";
import { registerDiscoverLeads } from "./tools/discover-leads.js";
import { registerGetLeadProfile } from "./tools/get-lead-profile.js";
import { registerQualifyLead } from "./tools/qualify-lead.js";
import { registerEnrichContacts } from "./tools/enrich-contacts.js";
import { registerGetContacts } from "./tools/get-contacts.js";
import { registerAddNote } from "./tools/add-note.js";
import { registerGetQuota } from "./tools/get-quota.js";

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

// OpenClaw plugin entry point
// The definePluginEntry import depends on the OpenClaw SDK version.
// If the SDK provides a different entry mechanism, adapt accordingly.

export async function register(api: any) {
  const region = await api.config.get("leadbay.region");
  const baseUrl =
    (await api.config.get("leadbay.baseUrl")) ?? REGIONS[region];

  if (!baseUrl) {
    throw new Error(
      'Missing leadbay.region config. Set it to "us" or "fr" in your OpenClaw plugin settings.'
    );
  }

  let token = await api.config.get("leadbay.token");

  if (!token) {
    // Login-once flow: prompt for credentials, authenticate, store only the token
    const email = await api.config.prompt(
      "leadbay.email",
      "Leadbay email address:"
    );
    const password = await api.config.prompt(
      "leadbay.password",
      "Leadbay password:",
      { secret: true }
    );

    const res = await fetch(`${baseUrl}/1.5/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      throw new Error("Login failed. Check your email and password.");
    }

    const data = await res.json();
    token = data.token;
    await api.config.set("leadbay.token", token);
    // Credentials are not stored
  }

  if (typeof token !== "string" || !token.startsWith("u.")) {
    throw new Error(
      "Invalid token format. Expected a Leadbay user token (u.xxx). Clear leadbay.token and re-authenticate."
    );
  }

  const client = new LeadbayClient(baseUrl, token);

  // Read-only tools (enabled by default)
  registerListLenses(api, client);
  registerDiscoverLeads(api, client);
  registerGetLeadProfile(api, client);
  registerGetContacts(api, client);
  registerGetQuota(api, client);

  // Write tools (optional: true — user must explicitly enable)
  registerQualifyLead(api, client);
  registerEnrichContacts(api, client);
  registerAddNote(api, client);
}
