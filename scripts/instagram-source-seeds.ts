type SelectedAccount = { source_id: string; handle: string; profile_url: string; focus: string };

// Ignoring conflicts is essential: setup must not reset an existing cursor,
// collection history, retry/lease state, or a later access investigation.
export const sourceSeedUpsertOptions = { onConflict: 'id', ignoreDuplicates: true } as const;

export function instagramSourceSeeds(ownerId: string, accounts: SelectedAccount[]) {
  return accounts.map(account => ({
    id: account.source_id,
    owner_id: ownerId,
    name: `Instagram @${account.handle}`,
    url: account.profile_url,
    adapter: 'unconfigured',
    enabled: false,
    cadence_seconds: null,
    next_due_at: null,
    health_status: 'setup_needed',
    health_message: 'Selected by the user; no Meta token or live post access verified. Stories remain manual-only.',
    coverage_note: `${account.focus}. User-selected account; identity/professional eligibility unverified. Posts unconfigured; Stories manual-only.`,
  }));
}
