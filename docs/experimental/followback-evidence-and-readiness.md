# Evidence-aware relationships — Preview only

No automatic Instagram follow/unfollow is enabled by this change.

- A completed PhantomBuster run is provider-reported, not independently verified.
- Owner visual observations (requested, following, none) remain separate from provider evidence.
- Follow-back yes/no/unknown is an owner visual observation, allowed only
  after relationship "following" has been observed. Each change adds a
  dedicated account-scoped immutable ActivityLog entry with server timestamp.
- Changing the relationship removes any prior follow-back observation.
- The existing pure 48-hour gate remains fail-closed without independent
  follow evidence; no automatic unfollow is scheduled.
- A new GET endpoint /api/reference-relationships?accountId=... returns
  aggregated counts for an authenticated owner of that account, Preview only.
  It never exposes recipient usernames, cookies or provider arguments.
- Simple customer UI renders observed requests, owner-observed following,
  and independently confirmed follow count separately. It contains no
  candidate selection or automation controls.
- No schema migration, agent launch, auto schedule or production change.
