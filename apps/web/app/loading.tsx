import { LoadingScreen } from './loading-screen'

/**
 * Shown by Next while a route is being prepared — moving between the landing
 * page, the console and the signed-in pages — so a navigation never shows a
 * blank page.
 */
export default function Loading() {
  return <LoadingScreen label="Opening" />
}
