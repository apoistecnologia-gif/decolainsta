# Read-only adapter for existing Followers Auto Follow agent

The PhantomBuster workspace already has one agent named "Untitled Instagram
Followers Auto Follow" in manual/OFF mode. Its ID was read from the user's
connected provider dashboard; do not invent, create, duplicate or launch it.

The user's **self-reported** Instagram session actor is `@contateste6699`.
The reference for followers is `@mameto_lueji`. These are different concepts:
- `Instagram Followers Auto Follow.js` accepts ONE SOURCE REFERENCE and then
  itself chooses a follower of that source to follow.
- `Instagram Auto Follow.js` accepts the chosen individual recipient.
- The existing social pilot's `/api/operator/social-pilot` launch flow expects
  a specific indexed target. It MUST NOT launch this new agent as if it were
  that script: the recipient is not under our control.

Read-only `GET /api/operator/followers-auto-follow-readiness` checks:
administrator authentication + Preview, account ownership, saved reference
association, agent script, same saved reference, manual launch, an explicitly
stored limit of exactly ONE profile. It never launches the Phantom and never
returns session cookies, agent arguments or keys. Unsupported provider fields
are treated as NOT verified. Provider session owner identity is NOT verifiable
using this agent's metadata (cookie is opaque); the UI labels it self-reported.

After provider config is verified, reconcile actual action results before
enabling the follow action. A successful API launch request is never evidence
of a successful Instagram follow. No follow-back or unfollow flow is enabled.

Current setup: FIVE out of FIVE Phantom slots used; do not create extra agents.
No social-action flags are enabled. Existing 6-hour audience importer continues
to be independent and read only.
