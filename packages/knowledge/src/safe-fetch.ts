/**
 * The address guard lives in @vaani/shared so the crawler and webhook delivery
 * share one implementation. Re-exported here because this is where the crawler
 * looks for it.
 */
export * from '@vaani/shared/net-guard'
